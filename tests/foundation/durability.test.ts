/**
 * Durability: state survives the death of the process that created it.
 *
 * This is the test that most directly kills the legacy prototype's central
 * limitation. The legacy follow-up "engine" and conversation lived in browser
 * state: close the tab and the scheduled call ceased to exist. Here the
 * simulation of a restart is deliberately brutal - write with one client,
 * DISCONNECT and DISCARD it, then construct a brand new client against the same
 * database file and expect everything back, byte for byte.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/db/database.js';
import { FixedClock } from '../../src/ports/clock.js';
import { createTestDatabase, DEFAULT_TEST_NOW_UTC, type TestDatabase } from '../helpers/testDb.js';
import { testProvenanceJson } from '../helpers/fixtures.js';

let harness: TestDatabase;

afterEach(async () => {
  await harness?.cleanup();
});

describe('FutureAction durability across a simulated process restart', () => {
  it('survives the client that created it being destroyed', async () => {
    harness = await createTestDatabase({ label: 'durability-future-action' });
    const fixtures = await harness.seedFixtures();
    const { databaseUrl } = harness;

    // ---- "process 1": schedule an autonomous follow-up, then die. ----
    const writer = harness.db;
    const scheduled = await writer.futureActions.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      type: 'CALL_CONTACT',
      scheduledForUtc: '2026-03-06T14:00:00.000Z',
      timezone: 'America/New_York',
      payloadJson: '{"reason":"contact asked for a call back Friday morning","attemptNumber":1}',
      idempotencyKey: 'followup-restart-1',
      validationProvenanceJson: testProvenanceJson(),
    });
    await writer.disconnect();

    // ---- "process 2": a brand new client, constructed from scratch. ----
    const reader = createDatabase({
      datasourceUrl: databaseUrl,
      clock: new FixedClock(DEFAULT_TEST_NOW_UTC),
    });

    try {
      const recovered = await reader.futureActions.requireById(scheduled.id);

      expect(recovered.id).toBe(scheduled.id);
      expect(recovered.status).toBe('PENDING');
      expect(recovered.type).toBe('CALL_CONTACT');
      expect(recovered.scheduledForUtc).toBe('2026-03-06T14:00:00.000Z');
      expect(recovered.timezone).toBe('America/New_York');
      expect(recovered.attempts).toBe(0);
      expect(recovered.maxAttempts).toBe(3);
      expect(recovered.payloadJson).toBe(scheduled.payloadJson);
      expect(recovered.validationProvenanceJson).toBe(scheduled.validationProvenanceJson);

      // And it is still discoverable the way a background runner finds it -
      // by querying what is due, not by remembering it.
      const due = await reader.futureActions.listDue('2026-03-06T14:00:00.000Z');
      expect(due.map((action) => action.id)).toContain(scheduled.id);

      // Idempotency also survives: a retried tool call still cannot duplicate it.
      const byKey = await reader.futureActions.findByIdempotencyKey('followup-restart-1');
      expect(byKey?.id).toBe(scheduled.id);
    } finally {
      await reader.disconnect();
    }
  });

  it('remembers a claim, so a restarted runner does not double-execute', async () => {
    harness = await createTestDatabase({ label: 'durability-claim' });
    const fixtures = await harness.seedFixtures();
    const { databaseUrl } = harness;

    const writer = harness.db;
    const action = await writer.futureActions.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      type: 'SEND_FOLLOWUP_MESSAGE',
      scheduledForUtc: '2026-03-04T14:00:00.000Z',
      timezone: 'America/New_York',
      payloadJson: '{"message":"Following up on our call"}',
      validationProvenanceJson: testProvenanceJson(),
    });

    const claimed = await writer.futureActions.claimDue({
      nowUtc: DEFAULT_TEST_NOW_UTC,
      leaseOwner: 'runner-1',
      leaseMilliseconds: 60_000,
    });
    expect(claimed.map((entry) => entry.id)).toEqual([action.id]);
    expect(claimed[0]?.attempts).toBe(1);
    await writer.disconnect();

    const reader = createDatabase({ datasourceUrl: databaseUrl, clock: new FixedClock(DEFAULT_TEST_NOW_UTC) });
    try {
      const recovered = await reader.futureActions.requireById(action.id);
      expect(recovered.status).toBe('CLAIMED');
      expect(recovered.leaseOwner).toBe('runner-1');
      expect(recovered.leaseExpiresAt).toBe('2026-03-04T15:01:00.000Z');

      // While the lease is live, a second runner must not get it.
      const stolen = await reader.futureActions.claimDue({
        nowUtc: DEFAULT_TEST_NOW_UTC,
        leaseOwner: 'runner-2',
        leaseMilliseconds: 60_000,
      });
      expect(stolen).toHaveLength(0);

      // Once the lease lapses, crash recovery lets another runner take over.
      const afterLapse = await reader.futureActions.claimDue({
        nowUtc: '2026-03-04T15:02:00.000Z',
        leaseOwner: 'runner-2',
        leaseMilliseconds: 60_000,
      });
      expect(afterLapse.map((entry) => entry.id)).toEqual([action.id]);
      expect(afterLapse[0]?.attempts).toBe(2);
      expect(afterLapse[0]?.leaseOwner).toBe('runner-2');
    } finally {
      await reader.disconnect();
    }
  });

  it('stops claiming an action once its attempt budget is exhausted', async () => {
    harness = await createTestDatabase({ label: 'durability-attempts' });
    const fixtures = await harness.seedFixtures();

    const action = await harness.db.futureActions.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      type: 'CALL_CONTACT',
      scheduledForUtc: '2026-03-04T14:00:00.000Z',
      timezone: 'America/New_York',
      maxAttempts: 2,
      payloadJson: '{"reason":"poison"}',
      validationProvenanceJson: testProvenanceJson(),
    });

    const first = await harness.db.futureActions.claimDue({
      nowUtc: DEFAULT_TEST_NOW_UTC,
      leaseOwner: 'runner-1',
      leaseMilliseconds: 1_000,
    });
    expect(first).toHaveLength(1);

    const second = await harness.db.futureActions.claimDue({
      nowUtc: '2026-03-04T15:00:05.000Z',
      leaseOwner: 'runner-1',
      leaseMilliseconds: 1_000,
    });
    expect(second).toHaveLength(1);
    expect(second[0]?.attempts).toBe(2);

    // Budget spent. A repeatedly-failing action must not loop forever.
    const third = await harness.db.futureActions.claimDue({
      nowUtc: '2026-03-04T15:00:10.000Z',
      leaseOwner: 'runner-1',
      leaseMilliseconds: 1_000,
    });
    expect(third).toHaveLength(0);

    const failed = await harness.db.futureActions.markFailed(action.id, { error: 'provider unreachable' });
    expect(failed.status).toBe('FAILED');
    expect(failed.lastError).toBe('provider unreachable');
    expect(failed.leaseOwner).toBeNull();
  });
});

describe('Conversation durability across a simulated process restart', () => {
  it('rebuilds the full ordered transcript from the database alone', async () => {
    harness = await createTestDatabase({ label: 'durability-conversation' });
    const fixtures = await harness.seedFixtures();
    const { databaseUrl } = harness;

    const writer = harness.db;
    const conversation = await writer.conversations.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      aiAgentId: fixtures.aiAgent.id,
      agentConfigurationId: fixtures.agentConfiguration.id,
      startedAt: DEFAULT_TEST_NOW_UTC,
    });

    const utterances = [
      { role: 'SYSTEM' as const, text: 'Conversation opened.' },
      { role: 'CONTACT' as const, text: 'Can we meet next Wednesday at 2pm?' },
      { role: 'AGENT' as const, text: 'Checking that slot for you.' },
      { role: 'TOOL' as const, text: null },
      { role: 'AGENT' as const, text: "You're booked for Wednesday at 2pm Eastern." },
    ];
    for (const utterance of utterances) {
      await writer.conversationTurns.appendTurn({ conversationId: conversation.id, ...utterance });
    }
    await writer.disconnect();

    const reader = createDatabase({ datasourceUrl: databaseUrl, clock: new FixedClock(DEFAULT_TEST_NOW_UTC) });
    try {
      // The LLM context window is rebuilt FROM this, never the other way around.
      const recovered = await reader.conversations.requireByIdWithTurns(conversation.id);

      expect(recovered.status).toBe('ACTIVE');
      expect(recovered.startedAt).toBe(DEFAULT_TEST_NOW_UTC);
      expect(recovered.turns).toHaveLength(utterances.length);
      expect(recovered.turns.map((turn) => turn.index)).toEqual([0, 1, 2, 3, 4]);
      expect(recovered.turns.map((turn) => turn.role)).toEqual(utterances.map((turn) => turn.role));
      expect(recovered.turns.map((turn) => turn.text)).toEqual(utterances.map((turn) => turn.text));
    } finally {
      await reader.disconnect();
    }
  });
});

describe('Meeting durability across a simulated process restart', () => {
  it('keeps the meeting AND the receipt that justifies it', async () => {
    harness = await createTestDatabase({ label: 'durability-meeting' });
    const fixtures = await harness.seedFixtures();
    const { databaseUrl } = harness;

    const provenanceJson = testProvenanceJson();
    const meeting = await harness.db.meetings.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      calendarConnectionId: fixtures.calendarConnection.id,
      title: 'Intro call',
      startUtc: '2026-03-11T18:00:00.000Z',
      endUtc: '2026-03-11T18:30:00.000Z',
      timezone: 'America/New_York',
      externalCalendarEventId: 'evt-deterministic-1',
      idempotencyKey: 'meeting-restart-1',
      validationProvenanceJson: provenanceJson,
    });
    await harness.db.disconnect();

    const reader = createDatabase({ datasourceUrl: databaseUrl, clock: new FixedClock(DEFAULT_TEST_NOW_UTC) });
    try {
      const recovered = await reader.meetings.requireById(meeting.id);
      expect(recovered.startUtc).toBe('2026-03-11T18:00:00.000Z');
      expect(recovered.timezone).toBe('America/New_York');
      expect(recovered.externalCalendarEventId).toBe('evt-deterministic-1');
      // The justification outlives the process that produced it.
      expect(recovered.validationProvenanceJson).toBe(provenanceJson);
    } finally {
      await reader.disconnect();
    }
  });
});
