/**
 * Schema round-trip: every model can be written and read back with its values
 * intact, its enums typed, and its foreign keys real.
 *
 * "Round-trip" is not busywork here. The SQLite columns behind the enums are
 * plain strings and the instants are stored as `DateTime`; these tests are what
 * prove the mapping layer does not quietly lose a timezone, coerce an enum, or
 * drop a nullable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseJsonWith } from '../../src/shared/json.js';
import { BusinessHoursPolicySchema } from '../../src/domain/businessHours.js';
import { createTestDatabase, type TestDatabase } from '../helpers/testDb.js';
import { FIXTURE, testProvenanceJson, type TestFixtures } from '../helpers/fixtures.js';

let harness: TestDatabase;
let fixtures: TestFixtures;

beforeAll(async () => {
  harness = await createTestDatabase({ label: 'schema-round-trip' });
  fixtures = await harness.seedFixtures();
});

afterAll(async () => {
  await harness.cleanup();
});

describe('Organization', () => {
  it('round-trips', async () => {
    const found = await harness.db.organizations.requireById(fixtures.organization.id);
    expect(found.name).toBe(FIXTURE.organizationName);
    expect(found.defaultTimezone).toBe('America/New_York');
    expect(found.createdAt).toMatch(/Z$/);
    expect(found.updatedAt).toMatch(/Z$/);
  });
});

describe('User', () => {
  it('round-trips with a typed role and a real organization FK', async () => {
    const found = await harness.db.users.requireById(fixtures.user.id);
    expect(found.role).toBe('OWNER');
    expect(found.isActive).toBe(true);
    expect(found.organizationId).toBe(fixtures.organization.id);
  });

  it('refuses a user whose organization does not exist', async () => {
    await expect(
      harness.db.users.create({
        organizationId: 'org-that-does-not-exist',
        email: 'nobody@acme.test',
        fullName: 'Nobody',
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('AiAgent + AgentConfiguration', () => {
  it('round-trips the agent', async () => {
    const found = await harness.db.aiAgents.requireById(fixtures.aiAgent.id);
    expect(found.status).toBe('ACTIVE');
    expect(found.description).toBe('Books qualified meetings and plans follow-ups.');
  });

  it('round-trips the scheduling policy the scheduling layer reads', async () => {
    const config = await harness.db.agentConfigurations.requireActiveByAgentId(fixtures.aiAgent.id);
    expect(config.minLeadTimeMinutes).toBe(30);
    expect(config.maxSchedulingHorizonDays).toBe(180);
    expect(config.systemPromptRef).toBe('sales-scheduler@v1');

    const policy = parseJsonWith(config.businessHoursJson, BusinessHoursPolicySchema, 'businessHoursJson');
    expect(policy.windows).toHaveLength(5);
    expect(policy.windows.map((window) => window.isoWeekday)).toEqual([1, 2, 3, 4, 5]);
    expect(policy.windows[0]).toMatchObject({ startLocal: '09:00', endLocal: '17:00' });

    const allowedTools = parseJsonWith(config.allowedToolsJson, z.array(z.string()), 'allowedToolsJson');
    expect(allowedTools).toContain('schedule_meeting');
  });

  it('enforces one configuration per (agent, version)', async () => {
    await expect(
      harness.db.agentConfigurations.create({
        aiAgentId: fixtures.aiAgent.id,
        version: FIXTURE.agentConfigVersion,
        systemPromptRef: 'duplicate@v1',
        businessHoursJson: '{"version":1,"windows":[],"holidayDatesLocal":[]}',
        defaultTimezone: 'UTC',
        minLeadTimeMinutes: 30,
        maxSchedulingHorizonDays: 180,
        allowedToolsJson: '[]',
      }),
    ).rejects.toThrow(/unique constraint/i);
  });
});

describe('Contact', () => {
  it('round-trips, preserving a non-UTC timezone', async () => {
    const found = await harness.db.contacts.requireById(fixtures.contact.id);
    expect(found.timezone).toBe('America/New_York');
    expect(found.primaryPhoneE164).toBe(FIXTURE.contactPhoneE164);
    expect(found.isDecisionMaker).toBe(true);
    expect(found.email).toBe('jordan@prospect.test');
    expect(found.notes).toBeNull();
  });

  it('is findable by phone within its organization', async () => {
    const found = await harness.db.contacts.findByPhone(fixtures.organization.id, FIXTURE.contactPhoneE164);
    expect(found?.id).toBe(fixtures.contact.id);
  });

  it('rejects a phone number that is not E.164', async () => {
    await expect(
      harness.db.contacts.create({
        organizationId: fixtures.organization.id,
        fullName: 'Bad Number',
        primaryPhoneE164: '(212) 555-0147',
        timezone: 'America/New_York',
      }),
    ).rejects.toThrow(/E\.164/);
  });

  it('rejects a timezone that is not a real IANA zone', async () => {
    await expect(
      harness.db.contacts.create({
        organizationId: fixtures.organization.id,
        fullName: 'Bad Zone',
        primaryPhoneE164: '+12125550188',
        timezone: 'Pacific/Atlantis',
      }),
    ).rejects.toThrow(/IANA timezone/);
  });

  it('rejects a UTC offset masquerading as a timezone', async () => {
    await expect(
      harness.db.contacts.create({
        organizationId: fixtures.organization.id,
        fullName: 'Offset Only',
        primaryPhoneE164: '+12125550189',
        timezone: '-05:00',
      }),
    ).rejects.toThrow(/IANA timezone/);
  });
});

describe('Lead', () => {
  it('round-trips with a typed status and an owner', async () => {
    const lead = await harness.db.leads.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      source: 'inbound_web_form',
      status: 'QUALIFYING',
      ownerUserId: fixtures.user.id,
      notes: 'Asked about pricing.',
    });

    const found = await harness.db.leads.requireById(lead.id);
    expect(found.status).toBe('QUALIFYING');
    expect(found.ownerUserId).toBe(fixtures.user.id);
    expect(found.source).toBe('inbound_web_form');
  });
});

describe('QualificationState', () => {
  it('records the raw score, the capped score and the effective score separately', async () => {
    // The legacy rubric capped the score for a non-decision-maker. The row has
    // to record BOTH numbers so an auditor can see the rubric's output and what
    // policy did to it.
    const state = await harness.db.qualificationStates.upsertForContact({
      contactId: fixtures.contact.id,
      rawScore: 82,
      cappedScore: 49,
      band: 'LOW',
      isDecisionMaker: false,
      rubricVersion: 'rubric@v1',
      factorsJson: '[{"name":"budget","contribution":30}]',
      updatedByToolCallId: 'tool_abc',
    });

    expect(state.rawScore).toBe(82);
    expect(state.cappedScore).toBe(49);
    expect(state.score).toBe(49);
    expect(state.band).toBe('LOW');

    const reread = await harness.db.qualificationStates.requireByContactId(fixtures.contact.id);
    expect(reread.id).toBe(state.id);
    expect(reread.rawScore).toBe(82);
  });

  it('is one row per contact - a second write updates rather than duplicates', async () => {
    const updated = await harness.db.qualificationStates.upsertForContact({
      contactId: fixtures.contact.id,
      rawScore: 90,
      cappedScore: 90,
      band: 'HIGH',
      isDecisionMaker: true,
      rubricVersion: 'rubric@v1',
      factorsJson: '[{"name":"budget","contribution":40}]',
    });
    expect(updated.score).toBe(90);
    expect(updated.band).toBe('HIGH');
  });

  it('refuses a capped score higher than the raw score', async () => {
    await expect(
      harness.db.qualificationStates.upsertForContact({
        contactId: fixtures.contact.id,
        rawScore: 10,
        cappedScore: 99,
        band: 'HIGH',
        isDecisionMaker: true,
        rubricVersion: 'rubric@v1',
        factorsJson: '[]',
      }),
    ).rejects.toThrow(/cap can only lower a score/);
  });
});

describe('Conversation + ConversationTurn', () => {
  it('round-trips a conversation with its ordered turns', async () => {
    const conversation = await harness.db.conversations.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      aiAgentId: fixtures.aiAgent.id,
      agentConfigurationId: fixtures.agentConfiguration.id,
      channel: 'VOICE',
      startedAt: '2026-03-04T15:00:00.000Z',
    });

    expect(conversation.status).toBe('ACTIVE');
    expect(conversation.startedAt).toBe('2026-03-04T15:00:00.000Z');
    expect(conversation.endedAt).toBeNull();

    await harness.db.conversationTurns.appendTurn({
      conversationId: conversation.id,
      role: 'CONTACT',
      text: 'Can we meet next Wednesday at 2pm?',
    });
    await harness.db.conversationTurns.appendTurn({
      conversationId: conversation.id,
      role: 'AGENT',
      text: 'Let me check that slot.',
      toolName: 'schedule_meeting',
      toolCallId: 'tool_1',
      rawPayloadJson: '{"startLocal":"2026-03-11T14:00","timezone":"America/New_York"}',
    });
    // A pure tool turn carries no natural-language text at all.
    await harness.db.conversationTurns.appendTurn({
      conversationId: conversation.id,
      role: 'TOOL',
      toolName: 'schedule_meeting',
      toolCallId: 'tool_1',
      rawPayloadJson: '{"ok":true}',
    });

    const withTurns = await harness.db.conversations.requireByIdWithTurns(conversation.id);
    expect(withTurns.turns.map((turn) => turn.index)).toEqual([0, 1, 2]);
    expect(withTurns.turns.map((turn) => turn.role)).toEqual(['CONTACT', 'AGENT', 'TOOL']);
    expect(withTurns.turns[2]?.text).toBeNull();
    expect(withTurns.turns[1]?.rawPayloadJson).toContain('America/New_York');

    const byToolCall = await harness.db.conversationTurns.findByToolCallId('tool_1');
    expect(byToolCall).toHaveLength(2);
  });

  it('makes turn order a database invariant, not an array position', async () => {
    const conversation = await harness.db.conversations.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      aiAgentId: fixtures.aiAgent.id,
    });

    await harness.db.conversationTurns.createAtIndex({
      conversationId: conversation.id,
      index: 0,
      role: 'SYSTEM',
      text: 'first',
    });

    await expect(
      harness.db.conversationTurns.createAtIndex({
        conversationId: conversation.id,
        index: 0,
        role: 'CONTACT',
        text: 'collides',
      }),
    ).rejects.toThrow(/unique constraint/i);
  });

  it('completes a conversation with an endedAt and a summary', async () => {
    const conversation = await harness.db.conversations.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      aiAgentId: fixtures.aiAgent.id,
    });

    const completed = await harness.db.conversations.complete(
      conversation.id,
      '2026-03-04T15:12:00.000Z',
      'Booked a meeting.',
    );

    expect(completed.status).toBe('COMPLETED');
    expect(completed.endedAt).toBe('2026-03-04T15:12:00.000Z');
    expect(completed.summary).toBe('Booked a meeting.');
  });
});

describe('Call + CallOutcome', () => {
  it('round-trips a call and its single outcome', async () => {
    const call = await harness.db.calls.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      direction: 'OUTBOUND',
      providerName: 'deterministic-test',
      providerCallId: 'call-ext-1',
      status: 'IN_PROGRESS',
      startedAt: '2026-03-04T15:00:00.000Z',
    });

    expect(call.direction).toBe('OUTBOUND');
    expect(call.startedAt).toBe('2026-03-04T15:00:00.000Z');

    const outcome = await harness.db.callOutcomes.upsertForCall({
      callId: call.id,
      outcome: 'VOICEMAIL',
      notes: 'Left a message.',
      recordedByToolCallId: 'tool_outcome_1',
    });
    expect(outcome.outcome).toBe('VOICEMAIL');

    const updated = await harness.db.calls.update(call.id, {
      status: 'COMPLETED',
      endedAt: '2026-03-04T15:02:30.000Z',
      durationSeconds: 150,
    });
    expect(updated.status).toBe('COMPLETED');
    expect(updated.durationSeconds).toBe(150);

    const found = await harness.db.calls.findByProviderCallId('deterministic-test', 'call-ext-1');
    expect(found?.id).toBe(call.id);

    // One outcome per call: a second write updates the same row.
    const revised = await harness.db.callOutcomes.upsertForCall({ callId: call.id, outcome: 'CONNECTED' });
    expect(revised.id).toBe(outcome.id);
    expect(revised.outcome).toBe('CONNECTED');
  });
});

describe('CalendarConnection', () => {
  it('round-trips the deterministic test connection', async () => {
    const found = await harness.db.calendarConnections.requireById(fixtures.calendarConnection.id);
    expect(found.provider).toBe('DETERMINISTIC_TEST');
    expect(found.status).toBe('TEST_DOUBLE');
    expect(found.calendarRef).toBe(FIXTURE.calendarRef);
    // Token storage is deferred pending Founder approval of a secrets
    // mechanism; there is deliberately nowhere to put one.
    expect(found.externalAccountRef).toBeNull();
  });

  it('finds a usable connection for the organization', async () => {
    const usable = await harness.db.calendarConnections.findUsableByOrganization(fixtures.organization.id);
    expect(usable?.id).toBe(fixtures.calendarConnection.id);
  });
});

describe('Meeting', () => {
  it('round-trips, preserving UTC instants and the agreed timezone', async () => {
    const meeting = await harness.db.meetings.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      conversationId: null,
      calendarConnectionId: fixtures.calendarConnection.id,
      title: 'Intro call',
      startUtc: '2026-03-11T18:00:00.000Z',
      endUtc: '2026-03-11T18:30:00.000Z',
      timezone: 'America/New_York',
      idempotencyKey: 'meeting-round-trip-1',
      validationProvenanceJson: testProvenanceJson(),
    });

    const found = await harness.db.meetings.requireById(meeting.id);
    expect(found.startUtc).toBe('2026-03-11T18:00:00.000Z');
    expect(found.endUtc).toBe('2026-03-11T18:30:00.000Z');
    expect(found.timezone).toBe('America/New_York');
    expect(found.status).toBe('SCHEDULED');
    expect(found.calendarConnectionId).toBe(fixtures.calendarConnection.id);
  });

  it('is retrievable by idempotency key, and the key is unique', async () => {
    // SELF-SUFFICIENT ON PURPOSE - see the note on FutureAction's key test below.
    // This used to look up `meeting-round-trip-1`, which only exists because the
    // PREVIOUS test created it, so under `--sequence.shuffle` it failed with
    // "expected null not to be null". It now writes the row it then reads back.
    const key = 'meeting-idempotency-key-guard';
    const created = await harness.db.meetings.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      title: 'Idempotency key guard',
      startUtc: '2026-03-12T18:00:00.000Z',
      endUtc: '2026-03-12T18:30:00.000Z',
      timezone: 'America/New_York',
      idempotencyKey: key,
      validationProvenanceJson: testProvenanceJson(),
    });

    const byKey = await harness.db.meetings.findByIdempotencyKey(key);
    expect(byKey).not.toBeNull();
    expect(byKey?.id).toBe(created.id);

    await expect(
      harness.db.meetings.create({
        organizationId: fixtures.organization.id,
        contactId: fixtures.contact.id,
        title: 'Duplicate',
        startUtc: '2026-03-12T18:00:00.000Z',
        endUtc: '2026-03-12T18:30:00.000Z',
        timezone: 'America/New_York',
        idempotencyKey: key,
        validationProvenanceJson: testProvenanceJson(),
      }),
    ).rejects.toThrow(/unique constraint/i);
  });

  it('refuses an end that is not after the start', async () => {
    await expect(
      harness.db.meetings.create({
        organizationId: fixtures.organization.id,
        contactId: fixtures.contact.id,
        title: 'Backwards',
        startUtc: '2026-03-11T18:30:00.000Z',
        endUtc: '2026-03-11T18:00:00.000Z',
        timezone: 'America/New_York',
        validationProvenanceJson: testProvenanceJson(),
      }),
    ).rejects.toThrow(/strictly after/);
  });

  it('finds overlapping meetings and ignores cancelled ones', async () => {
    // SELF-SUFFICIENT ON PURPOSE. This used to look for `meeting-round-trip-1`,
    // a row the FIRST test in this describe creates, so under `--sequence.shuffle`
    // it failed with "expected [] to include 'meeting-round-trip-1'". It now
    // creates the 18:00-18:30 meeting whose boundaries it is reasoning about.
    const key = 'meeting-overlap-guard';
    await harness.db.meetings.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      title: 'Overlap guard',
      startUtc: '2026-03-11T18:00:00.000Z',
      endUtc: '2026-03-11T18:30:00.000Z',
      timezone: 'America/New_York',
      idempotencyKey: key,
      validationProvenanceJson: testProvenanceJson(),
    });

    const overlapping = await harness.db.meetings.listOverlapping(
      fixtures.organization.id,
      '2026-03-11T18:15:00.000Z',
      '2026-03-11T19:00:00.000Z',
    );
    expect(overlapping.map((meeting) => meeting.idempotencyKey)).toContain(key);

    const adjacent = await harness.db.meetings.listOverlapping(
      fixtures.organization.id,
      '2026-03-11T18:30:00.000Z',
      '2026-03-11T19:00:00.000Z',
    );
    // Half-open intervals: a meeting ending exactly when the window opens does
    // not overlap it.
    expect(adjacent.map((meeting) => meeting.idempotencyKey)).not.toContain(key);
  });
});

describe('FutureAction', () => {
  it('round-trips with its retry and lease bookkeeping', async () => {
    const action = await harness.db.futureActions.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      type: 'CALL_CONTACT',
      scheduledForUtc: '2026-03-06T14:00:00.000Z',
      timezone: 'America/New_York',
      payloadJson: '{"reason":"contact asked for a call back Friday morning"}',
      idempotencyKey: 'future-round-trip-1',
      validationProvenanceJson: testProvenanceJson(),
    });

    const found = await harness.db.futureActions.requireById(action.id);
    expect(found.type).toBe('CALL_CONTACT');
    expect(found.status).toBe('PENDING');
    expect(found.attempts).toBe(0);
    expect(found.maxAttempts).toBe(3);
    expect(found.leaseExpiresAt).toBeNull();
    expect(found.scheduledForUtc).toBe('2026-03-06T14:00:00.000Z');
    expect(found.timezone).toBe('America/New_York');
  });

  it('enforces a unique idempotency key', async () => {
    // SELF-SUFFICIENT ON PURPOSE - IT DID NOT USED TO BE.
    //
    // This test used to collide with `future-round-trip-1`, the key the PREVIOUS
    // test's row happens to hold. That made it pass only when it ran second, and
    // it is a real order dependence rather than a style point: run this file with
    // `--sequence.shuffle` and either this test passes vacuously (its `create`
    // succeeds because nothing had taken the key yet, so `rejects` fails) or the
    // round-trip test above collides on a key it did not expect to exist. Both
    // were observed; `docs/MISSION_2G_VERIFIER_ROUND.md` § 11 records the run.
    //
    // It now establishes its own precondition, which also makes it a STRONGER
    // test: it proves the constraint directly, over two rows it created itself,
    // instead of inferring it from a sibling test's leftover state.
    const key = 'future-unique-key-guard';
    const base = {
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      scheduledForUtc: '2026-03-07T14:00:00.000Z',
      timezone: 'America/New_York',
      payloadJson: '{}',
      idempotencyKey: key,
      validationProvenanceJson: testProvenanceJson(),
    } as const;

    const first = await harness.db.futureActions.create({ ...base, type: 'CALL_CONTACT' });
    expect(first.idempotencyKey).toBe(key);

    await expect(
      harness.db.futureActions.create({ ...base, type: 'SEND_FOLLOWUP_MESSAGE' }),
    ).rejects.toThrow(/unique constraint/i);
  });
});

describe('Task', () => {
  it('round-trips and can hang off a FutureAction', async () => {
    const action = await harness.db.futureActions.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      type: 'INTERNAL_TASK',
      scheduledForUtc: '2026-03-09T14:00:00.000Z',
      timezone: 'America/New_York',
      payloadJson: '{"title":"Send the pricing deck"}',
      validationProvenanceJson: testProvenanceJson(),
    });

    const task = await harness.db.tasks.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      futureActionId: action.id,
      assignedToUserId: fixtures.user.id,
      title: 'Send the pricing deck',
      dueAtUtc: '2026-03-09T17:00:00.000Z',
    });

    const found = await harness.db.tasks.requireById(task.id);
    expect(found.status).toBe('OPEN');
    expect(found.futureActionId).toBe(action.id);
    expect(found.assignedToUserId).toBe(fixtures.user.id);
    expect(found.dueAtUtc).toBe('2026-03-09T17:00:00.000Z');

    const done = await harness.db.tasks.update(task.id, { status: 'DONE' });
    expect(done.status).toBe('DONE');
  });
});

describe('AuditEvent', () => {
  it('round-trips through the recorder', async () => {
    const event = await harness.db.audit.record({
      type: 'ENTITY_PERSISTED',
      organizationId: fixtures.organization.id,
      correlationId: 'corr-round-trip',
      contactId: fixtures.contact.id,
      subjectType: 'CONTACT',
      subjectId: fixtures.contact.id,
      summary: 'Contact persisted',
      detailJson: { table: 'Contact' },
    });

    expect(event.sequence).toBe(1);
    expect(event.type).toBe('ENTITY_PERSISTED');
    expect(event.occurredAt).toBe('2026-03-04T15:00:00.000Z');

    const chain = await harness.db.audit.listByCorrelationId('corr-round-trip');
    expect(chain).toHaveLength(1);
    expect(chain[0]?.detailJson).toBe('{"table":"Contact"}');
  });
});
