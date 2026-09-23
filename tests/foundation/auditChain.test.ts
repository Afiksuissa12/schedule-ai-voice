/**
 * The audit chain.
 *
 * Acceptance criterion for this whole deliverable, stated as a sentence: the
 * events for one correlationId must be sufficient to explain WHY the system
 * scheduled, or planned to contact, this person at that time. The final test in
 * this file walks that exact chain.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { AuditEventType } from '../../src/audit/types.js';
import { AuditWriteError } from '../../src/shared/errors.js';
import { parseJson } from '../../src/shared/json.js';
import { parseValidationProvenance } from '../../src/domain/provenance.js';
import { createTestDatabase, DEFAULT_TEST_NOW_UTC, type TestDatabase } from '../helpers/testDb.js';
import { testProvenance, testProvenanceJson, type TestFixtures } from '../helpers/fixtures.js';

let harness: TestDatabase;

afterEach(async () => {
  await harness?.cleanup();
});

async function setup(label: string): Promise<TestFixtures> {
  harness = await createTestDatabase({ label });
  return harness.seedFixtures();
}

describe('sequence numbering', () => {
  it('numbers events 1..n per correlationId, in insertion order', async () => {
    const fixtures = await setup('audit-sequence');
    const correlationId = 'corr-sequence-1';

    const types = [
      AuditEventType.AGENT_TURN_STARTED,
      AuditEventType.UTTERANCE_RECEIVED,
      AuditEventType.AGENT_DECISION,
      AuditEventType.TOOL_CALL_REQUESTED,
      AuditEventType.TOOL_CALL_VALIDATED,
      AuditEventType.TOOL_CALL_EXECUTED,
      AuditEventType.ENTITY_PERSISTED,
    ];

    for (const type of types) {
      await harness.db.audit.record({
        type,
        organizationId: fixtures.organization.id,
        correlationId,
        summary: `event ${type}`,
        detailJson: { type },
      });
    }

    const chain = await harness.db.audit.listByCorrelationId(correlationId);
    expect(chain.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(chain.map((event) => event.type)).toEqual(types);
  });

  it('keeps separate correlation chains independent', async () => {
    const fixtures = await setup('audit-independent-chains');

    for (const correlationId of ['corr-a', 'corr-b']) {
      for (let index = 0; index < 3; index += 1) {
        await harness.db.audit.record({
          type: 'AGENT_DECISION',
          organizationId: fixtures.organization.id,
          correlationId,
          summary: `${correlationId} #${index}`,
          detailJson: { index },
        });
      }
    }

    const chainA = await harness.db.audit.listByCorrelationId('corr-a');
    const chainB = await harness.db.audit.listByCorrelationId('corr-b');

    expect(chainA.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(chainB.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(chainA.map((event) => event.summary)).toEqual(['corr-a #0', 'corr-a #1', 'corr-a #2']);
  });

  it('returns events in sequence order even when they share an occurredAt', async () => {
    // Everything in one agent turn can land on the same millisecond. Ordering
    // must come from `sequence`, not from a timestamp tie-break.
    const fixtures = await setup('audit-same-instant');
    const correlationId = 'corr-same-instant';

    for (let index = 0; index < 5; index += 1) {
      await harness.db.audit.record({
        type: 'PROVIDER_INVOKED',
        organizationId: fixtures.organization.id,
        correlationId,
        summary: `step ${index}`,
        detailJson: { index },
        occurredAt: DEFAULT_TEST_NOW_UTC,
      });
    }

    const chain = await harness.db.audit.listByCorrelationId(correlationId);
    expect(chain.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(chain.map((event) => event.summary)).toEqual([
      'step 0',
      'step 1',
      'step 2',
      'step 3',
      'step 4',
    ]);
    expect(new Set(chain.map((event) => event.occurredAt))).toEqual(new Set([DEFAULT_TEST_NOW_UTC]));
  });

  it('never reuses a sequence number under concurrent writes', async () => {
    const fixtures = await setup('audit-concurrent');
    const correlationId = 'corr-concurrent';

    await Promise.all(
      Array.from({ length: 12 }, (_unused, index) =>
        harness.db.audit.record({
          type: 'AGENT_DECISION',
          organizationId: fixtures.organization.id,
          correlationId,
          summary: `concurrent ${index}`,
          detailJson: { index },
        }),
      ),
    );

    const chain = await harness.db.audit.listByCorrelationId(correlationId);
    expect(chain).toHaveLength(12);
    expect(chain.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('occurredAt and the injected clock', () => {
  it('stamps occurredAt from the injected clock by default', async () => {
    const fixtures = await setup('audit-clock');

    const first = await harness.db.audit.record({
      type: 'AGENT_TURN_STARTED',
      organizationId: fixtures.organization.id,
      correlationId: 'corr-clock',
      summary: 'turn started',
      detailJson: {},
    });
    expect(first.occurredAt).toBe(DEFAULT_TEST_NOW_UTC);

    harness.clock.advance(90_000);
    const second = await harness.db.audit.record({
      type: 'AGENT_DECISION',
      organizationId: fixtures.organization.id,
      correlationId: 'corr-clock',
      summary: 'decided',
      detailJson: {},
    });
    expect(second.occurredAt).toBe('2026-03-04T15:01:30.000Z');
  });

  it('accepts an explicit occurredAt for something that happened earlier', async () => {
    const fixtures = await setup('audit-explicit-occurred-at');

    const event = await harness.db.audit.record({
      type: 'UTTERANCE_RECEIVED',
      organizationId: fixtures.organization.id,
      correlationId: 'corr-explicit',
      summary: 'utterance arrived before we got to it',
      detailJson: {},
      occurredAt: '2026-03-04T14:59:12.000Z',
    });

    expect(event.occurredAt).toBe('2026-03-04T14:59:12.000Z');
  });
});

describe('failure policy', () => {
  it('surfaces a missing correlationId instead of writing an orphan event', async () => {
    const fixtures = await setup('audit-missing-correlation');

    await expect(
      harness.db.audit.record({
        type: 'AGENT_DECISION',
        organizationId: fixtures.organization.id,
        correlationId: '',
        summary: 'no chain to belong to',
        detailJson: {},
      }),
    ).rejects.toBeInstanceOf(AuditWriteError);
  });

  it('surfaces a bad occurredAt instead of storing a broken instant', async () => {
    const fixtures = await setup('audit-bad-occurred-at');

    await expect(
      harness.db.audit.record({
        type: 'AGENT_DECISION',
        organizationId: fixtures.organization.id,
        correlationId: 'corr-bad-time',
        summary: 'unparseable',
        detailJson: {},
        occurredAt: 'yesterday-ish',
      }),
    ).rejects.toBeInstanceOf(AuditWriteError);
  });

  it('surfaces a write against a non-existent organization rather than swallowing it', async () => {
    await setup('audit-bad-org');

    await expect(
      harness.db.audit.record({
        type: 'AGENT_DECISION',
        organizationId: 'org-that-does-not-exist',
        correlationId: 'corr-bad-org',
        summary: 'orphaned',
        detailJson: {},
      }),
    ).rejects.toBeInstanceOf(AuditWriteError);
  });
});

describe('listBySubject', () => {
  it('returns every event about one domain row, oldest first', async () => {
    const fixtures = await setup('audit-by-subject');

    const meeting = await harness.db.meetings.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      title: 'Intro call',
      startUtc: '2026-03-11T18:00:00.000Z',
      endUtc: '2026-03-11T18:30:00.000Z',
      timezone: 'America/New_York',
      validationProvenanceJson: testProvenanceJson(),
    });

    await harness.db.audit.record({
      type: 'ENTITY_PERSISTED',
      organizationId: fixtures.organization.id,
      correlationId: 'corr-subject-1',
      subjectType: 'MEETING',
      subjectId: meeting.id,
      summary: 'Meeting created',
      detailJson: { status: 'SCHEDULED' },
    });

    harness.clock.advance(3_600_000);
    await harness.db.audit.record({
      type: 'TOOL_CALL_EXECUTED',
      organizationId: fixtures.organization.id,
      // A LATER, SEPARATE agent turn touching the same row.
      correlationId: 'corr-subject-2',
      subjectType: 'MEETING',
      subjectId: meeting.id,
      summary: 'Meeting rescheduled',
      detailJson: { status: 'RESCHEDULED' },
    });

    const trail = await harness.db.audit.listBySubject('MEETING', meeting.id);
    expect(trail.map((event) => event.summary)).toEqual(['Meeting created', 'Meeting rescheduled']);
    expect(trail.map((event) => event.correlationId)).toEqual(['corr-subject-1', 'corr-subject-2']);
  });
});

describe('atomicity with the domain row it explains', () => {
  it('rolls the audit events back when the transaction fails', async () => {
    const fixtures = await setup('audit-atomic');

    await expect(
      harness.db.withTransaction(async (tx) => {
        await tx.audit.record({
          type: 'FUTURE_ACTION_SCHEDULED',
          organizationId: fixtures.organization.id,
          correlationId: 'corr-rollback',
          summary: 'about to fail',
          detailJson: {},
        });
        await tx.futureActions.create({
          organizationId: fixtures.organization.id,
          contactId: 'contact-that-does-not-exist',
          type: 'CALL_CONTACT',
          scheduledForUtc: '2026-03-06T14:00:00.000Z',
          timezone: 'America/New_York',
          payloadJson: '{}',
          validationProvenanceJson: testProvenanceJson(),
        });
      }),
    ).rejects.toThrow();

    // No half-state: neither the row nor the explanation for it exists.
    const chain = await harness.db.audit.listByCorrelationId('corr-rollback');
    expect(chain).toHaveLength(0);
  });

  it('commits the domain row and its audit events together', async () => {
    const fixtures = await setup('audit-atomic-commit');

    const actionId = await harness.db.withTransaction(async (tx) => {
      const action = await tx.futureActions.create({
        organizationId: fixtures.organization.id,
        contactId: fixtures.contact.id,
        type: 'CALL_CONTACT',
        scheduledForUtc: '2026-03-06T14:00:00.000Z',
        timezone: 'America/New_York',
        payloadJson: '{"reason":"call back Friday"}',
        validationProvenanceJson: testProvenanceJson(),
      });

      await tx.audit.record({
        type: 'FUTURE_ACTION_SCHEDULED',
        organizationId: fixtures.organization.id,
        correlationId: 'corr-commit',
        contactId: fixtures.contact.id,
        subjectType: 'FUTURE_ACTION',
        subjectId: action.id,
        summary: 'Follow-up call scheduled for Friday 09:00 America/New_York',
        detailJson: { scheduledForUtc: action.scheduledForUtc },
      });

      return action.id;
    });

    expect(await harness.db.futureActions.findById(actionId)).not.toBeNull();
    const chain = await harness.db.audit.listByCorrelationId('corr-commit');
    expect(chain).toHaveLength(1);
    expect(chain[0]?.subjectId).toBe(actionId);
  });
});

describe('the chain explains the decision', () => {
  it('replays one agent turn end to end, from utterance to persisted follow-up', async () => {
    const fixtures = await setup('audit-explains');
    const correlationId = 'corr-explains-1';
    const toolCallId = 'tool_call_42';
    const rawProposed = 'next Wednesday at 2pm';

    const conversation = await harness.db.conversations.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      aiAgentId: fixtures.aiAgent.id,
      agentConfigurationId: fixtures.agentConfiguration.id,
      startedAt: DEFAULT_TEST_NOW_UTC,
    });

    const base = {
      organizationId: fixtures.organization.id,
      correlationId,
      conversationId: conversation.id,
      contactId: fixtures.contact.id,
    };

    await harness.db.audit.record({
      ...base,
      type: 'AGENT_TURN_STARTED',
      summary: 'Agent turn started',
      detailJson: { agentConfigurationId: fixtures.agentConfiguration.id },
    });
    await harness.db.audit.record({
      ...base,
      type: 'UTTERANCE_RECEIVED',
      summary: 'Contact asked to meet',
      detailJson: { text: `Can we meet ${rawProposed}?` },
    });
    await harness.db.audit.record({
      ...base,
      type: 'TOOL_CALL_REQUESTED',
      toolCallId,
      summary: 'Model proposed schedule_meeting',
      // The raw, untrusted proposal, stored exactly as the model produced it.
      detailJson: { toolName: 'schedule_meeting', argumentsJson: `{"when":"${rawProposed}"}` },
    });

    const provenance = testProvenance({ rawProposedValue: rawProposed });
    await harness.db.audit.record({
      ...base,
      type: 'PROVIDER_INVOKED',
      toolCallId,
      summary: 'Checked availability',
      detailJson: { provider: 'deterministic-test', busyIntervals: [] },
    });
    await harness.db.audit.record({
      ...base,
      type: 'TOOL_CALL_VALIDATED',
      toolCallId,
      summary: 'Proposed time passed all deterministic checks',
      detailJson: { provenance },
    });

    const meeting = await harness.db.meetings.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      conversationId: conversation.id,
      title: 'Intro call',
      startUtc: provenance.resolvedStartUtc!,
      endUtc: provenance.resolvedEndUtc!,
      timezone: provenance.resolvedTimezone,
      validationProvenanceJson: JSON.stringify(provenance),
    });

    await harness.db.audit.record({
      ...base,
      type: 'ENTITY_PERSISTED',
      toolCallId,
      subjectType: 'MEETING',
      subjectId: meeting.id,
      summary: 'Meeting persisted for Wed 2026-03-11 14:00 America/New_York',
      detailJson: { startUtc: meeting.startUtc, timezone: meeting.timezone },
    });

    // ---- The replay an auditor performs. ----
    const chain = await harness.db.audit.listByCorrelationId(correlationId);

    expect(chain.map((event) => event.type)).toEqual([
      'AGENT_TURN_STARTED',
      'UTTERANCE_RECEIVED',
      'TOOL_CALL_REQUESTED',
      'PROVIDER_INVOKED',
      'TOOL_CALL_VALIDATED',
      'ENTITY_PERSISTED',
    ]);
    expect(chain.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);

    // 1. What did the human actually say?
    const utterance = parseJson<{ text: string }>(chain[1]!.detailJson);
    expect(utterance.text).toContain(rawProposed);

    // 2. What did the model propose, verbatim and untrusted?
    const proposal = parseJson<{ toolName: string; argumentsJson: string }>(chain[2]!.detailJson);
    expect(proposal.toolName).toBe('schedule_meeting');
    expect(proposal.argumentsJson).toContain(rawProposed);

    // 3. Which checks did application code run, against which `now`?
    const validated = parseJson<{ provenance: unknown }>(chain[4]!.detailJson);
    const recordedProvenance = parseValidationProvenance(JSON.stringify(validated.provenance));
    expect(recordedProvenance.nowUtc).toBe(DEFAULT_TEST_NOW_UTC);
    expect(recordedProvenance.rawProposedValue).toBe(rawProposed);
    expect(recordedProvenance.resolvedTimezone).toBe('America/New_York');
    expect(recordedProvenance.checks.every((check) => check.passed)).toBe(true);
    expect(recordedProvenance.checks.map((check) => check.name)).toContain('business_hours');

    // 4. Which row did that produce, and does the row still carry its receipt?
    expect(chain[5]!.subjectType).toBe('MEETING');
    expect(chain[5]!.subjectId).toBe(meeting.id);
    const persisted = await harness.db.meetings.requireById(meeting.id);
    const receipt = parseValidationProvenance(persisted.validationProvenanceJson);
    expect(receipt.rawProposedValue).toBe(rawProposed);
    expect(receipt.resolvedStartUtc).toBe(persisted.startUtc);

    // And the same story is reachable from the row itself.
    const bySubject = await harness.db.audit.listBySubject('MEETING', meeting.id);
    expect(bySubject.map((event) => event.correlationId)).toEqual([correlationId]);
  });

  it('records a rejection with the same evidentiary weight as an acceptance', async () => {
    const fixtures = await setup('audit-rejection');
    const correlationId = 'corr-rejected';

    const provenance = testProvenance({
      rawProposedValue: 'tomorrow at 3am',
      resolvedStartUtc: '2026-03-05T08:00:00.000Z',
      resolvedEndUtc: '2026-03-05T08:30:00.000Z',
      checks: [
        { name: 'parse_iso', passed: true },
        { name: 'not_in_the_past', passed: true },
        { name: 'min_lead_time', passed: true },
        { name: 'within_horizon', passed: true },
        { name: 'business_hours', passed: false, detail: 'Thu 03:00 outside 09:00-17:00' },
      ],
    });

    await harness.db.audit.record({
      type: 'TOOL_CALL_REJECTED',
      organizationId: fixtures.organization.id,
      correlationId,
      contactId: fixtures.contact.id,
      toolCallId: 'tool_call_43',
      summary: 'Rejected 3am: outside business hours',
      detailJson: { code: 'OUTSIDE_BUSINESS_HOURS', provenance },
    });

    const chain = await harness.db.audit.listByCorrelationId(correlationId);
    const detail = parseJson<{ code: string; provenance: unknown }>(chain[0]!.detailJson);
    expect(detail.code).toBe('OUTSIDE_BUSINESS_HOURS');

    const recorded = parseValidationProvenance(JSON.stringify(detail.provenance));
    const failed = recorded.checks.filter((check) => !check.passed);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.name).toBe('business_hours');
    expect(failed[0]?.detail).toContain('outside 09:00-17:00');
  });
});
