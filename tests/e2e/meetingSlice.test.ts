/**
 * The mirror image of the headline test: the same slice, ending in a persisted
 * Meeting instead of a promised callback.
 *
 * The interesting difference is the availability check. A meeting occupies a
 * calendar slot, so `no_busy_conflict` runs and a clashing time is refused - a
 * callback skips that check on purpose, because a busy diary is not a reason to
 * refuse to phone someone. Both behaviours are asserted here, side by side,
 * because the asymmetry is a product decision rather than an accident.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { summarizeChain } from '../../src/app/auditReport.js';
import { parseValidationProvenance } from '../../src/domain/provenance.js';
import { scriptedArgs, type ScriptedStep } from '../../src/llm/scriptedLlmProvider.js';
import type { Conversation } from '../../src/domain/entities.js';
import { createSliceHarness, positionsInOrder, SLICE_NOW_UTC, type SliceHarness } from './support.js';

const THE_UTTERANCE = 'Can we get a proper intro call in the diary for tomorrow at 10am?';

/** Thursday 2026-03-05, 10:00 EST = 15:00 UTC. Written out by hand. */
const TOMORROW_AT_10_UTC = '2026-03-05T15:00:00.000Z';

function meetingScript(contactId: string, when = 'tomorrow at 10am'): ScriptedStep[] {
  return [
    {
      assistantText: 'Let me check that time and get it booked.',
      toolCalls: [
        {
          toolCallId: 'call_check_1',
          toolName: 'check_availability',
          argumentsJson: scriptedArgs({ contact_id: contactId, when, duration_minutes: 30 }),
        },
      ],
    },
    {
      assistantText: 'That works - booking it now.',
      toolCalls: [
        {
          toolCallId: 'call_book_1',
          toolName: 'schedule_meeting',
          argumentsJson: scriptedArgs({
            contact_id: contactId,
            when,
            title: 'Intro call - Northwind',
            duration_minutes: 30,
            description: 'Walk through the platform and answer pricing questions.',
          }),
        },
      ],
    },
    {
      assistantText: "Done - you're in the diary for tomorrow, Thursday the 5th, at 10 in the morning your time.",
    },
  ];
}

describe('end-to-end: booking a meeting', () => {
  let harness: SliceHarness;
  let conversation: Conversation;

  beforeEach(async () => {
    harness = await createSliceHarness({ label: 'e2e-meeting' });
    conversation = await harness.startConversation();
    harness.llm.setScript(meetingScript(harness.world.contact.id));
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  const runTurn = () => harness.runtime.agent.handleTurn({ conversationId: conversation.id, utterance: THE_UTTERANCE });

  it('checks availability, then persists a Meeting at the validated instant', async () => {
    const turn = await runTurn();

    expect(turn.toolOutcomes.map((outcome) => outcome.toolName)).toEqual([
      'check_availability',
      'schedule_meeting',
    ]);
    expect(turn.toolOutcomes.every((outcome) => outcome.ok)).toBe(true);

    // The availability check consulted the provider and booked nothing.
    const check = turn.toolOutcomes[0];
    if (check?.ok) {
      expect(check.data['available']).toBe(true);
      expect(check.data['booked']).toBe(false);
      expect(check.data['checked_against']).toBe(harness.providers.availability.name());
    }

    const meetings = await harness.db.meetings.listByContact(harness.world.contact.id);
    expect(meetings).toHaveLength(1);
    const meeting = meetings[0]!;

    expect(meeting.status).toBe('SCHEDULED');
    expect(meeting.startUtc).toBe(TOMORROW_AT_10_UTC);
    expect(meeting.endUtc).toBe('2026-03-05T15:30:00.000Z');
    expect(meeting.timezone).toBe('America/New_York');
    expect(meeting.title).toBe('Intro call - Northwind');
    expect(meeting.conversationId).toBe(conversation.id);
    expect(meeting.calendarConnectionId).toBe(harness.world.calendarConnection.id);

    // NOT NULL by schema, and genuinely a receipt.
    const provenance = parseValidationProvenance(meeting.validationProvenanceJson);
    expect(provenance.rawProposedValue).toBe('tomorrow at 10am');
    expect(provenance.nowUtc).toBe(SLICE_NOW_UTC);
    expect(provenance.checks.map((check2) => check2.name)).toContain('no_busy_conflict');
    expect(provenance.checks.every((check2) => check2.passed)).toBe(true);

    // The external calendar was written last, and its id came back.
    expect(meeting.externalCalendarEventId).not.toBeNull();
  });

  it('records the required audit events, in order, ending in a persisted Meeting', async () => {
    const turn = await runTurn();

    const chain = await harness.db.audit.listByCorrelationId(turn.correlationId);
    const types = chain.map((event) => event.type);

    expect(
      positionsInOrder(types, [
        'UTTERANCE_RECEIVED',
        'AGENT_DECISION',
        'TOOL_CALL_REQUESTED',
        'TOOL_CALL_VALIDATED',
        'ENTITY_PERSISTED',
      ]),
      `audit chain was: ${types.join(' -> ')}`,
    ).not.toBeNull();

    // The calendar provider was consulted, and that is on the record.
    expect(types).toContain('PROVIDER_INVOKED');
    expect(chain.map((event) => event.sequence)).toEqual(chain.map((_, index) => index + 1));

    const summary = summarizeChain(chain);
    expect(summary.whatWasSaid).toContain(THE_UTTERANCE);
    expect(summary.whatToolsWereCalled.map((call) => call.tool)).toEqual([
      'check_availability',
      'schedule_meeting',
    ]);
    expect(summary.whatWasPersisted.map((row) => row.subjectType)).toContain('MEETING');
    expect(summary.whatWasRefused).toEqual([]);

    // "Why is this meeting in the diary?" answered from the row itself.
    const meeting = (await harness.db.meetings.listByContact(harness.world.contact.id))[0]!;
    const bySubject = await harness.db.audit.listBySubject('MEETING', meeting.id);
    expect(bySubject.map((event) => event.type)).toContain('ENTITY_PERSISTED');
  });

  it('is readable from a freshly constructed client against the same file', async () => {
    await runTurn();
    const reopened = harness.testDb.openAnotherClient();

    const meetings = await reopened.meetings.listByContact(harness.world.contact.id);
    expect(meetings).toHaveLength(1);
    expect(meetings[0]?.startUtc).toBe(TOMORROW_AT_10_UTC);

    const rebuilt = await reopened.conversations.requireByIdWithTurns(conversation.id);
    const toolNames = rebuilt.turns.filter((t) => t.role === 'TOOL').map((t) => t.toolName);
    expect(toolNames).toEqual(['check_availability', 'schedule_meeting']);
  });

  it('refuses a meeting that clashes with a busy interval, and writes nothing', async () => {
    // 14:00-16:00 New York on 2026-03-05 is blocked in the diary.
    const busy = await createSliceHarness({
      label: 'e2e-meeting-busy',
      providers: {
        availability: {
          options: {
            busyIntervals: [{ startUtc: '2026-03-05T19:00:00.000Z', endUtc: '2026-03-05T21:00:00.000Z' }],
          },
        },
      },
    });

    try {
      const busyConversation = await busy.startConversation();
      busy.llm.setScript(meetingScript(busy.world.contact.id, 'tomorrow at 2pm'));

      const before = await busy.countDomainRows();
      const turn = await busy.runtime.agent.handleTurn({
        conversationId: busyConversation.id,
        utterance: 'Can we do 2pm tomorrow?',
      });

      const check = turn.toolOutcomes[0];
      expect(check?.ok).toBe(false);
      if (check && !check.ok) {
        expect(check.code).toBe('CONFLICT_WITH_BUSY_INTERVAL');
        // The reason names the clash, so the model can offer another time.
        expect(check.reason).toContain('already taken');
        expect(check.retryable).toBe(true);
      }

      // Nothing was booked, and nothing was written.
      expect(await busy.countDomainRows()).toEqual(before);
      expect(await busy.db.meetings.listByContact(busy.world.contact.id)).toHaveLength(0);

      const types = (await busy.db.audit.listByCorrelationId(turn.correlationId)).map((event) => event.type);
      expect(types).toContain('TOOL_CALL_REJECTED');
      expect(types).not.toContain('ENTITY_PERSISTED');
    } finally {
      await busy.cleanup();
    }
  });

  it('reschedules and then cancels through the scheduling service', async () => {
    await runTurn();
    const meeting = (await harness.db.meetings.listByContact(harness.world.contact.id))[0]!;

    harness.llm.setScript([
      {
        assistantText: 'No problem, let me move that.',
        toolCalls: [
          {
            toolCallId: 'call_resched_1',
            toolName: 'reschedule_meeting',
            argumentsJson: scriptedArgs({
              meeting_id: meeting.id,
              when: 'tomorrow at 11am',
              reason: 'Contact has a conflict at 10.',
            }),
          },
        ],
      },
      { assistantText: 'Moved to 11 in the morning your time.' },
    ]);

    const moved = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Actually, could we make it 11 instead?',
    });
    expect(moved.toolOutcomes[0]?.ok).toBe(true);

    const rescheduled = await harness.db.meetings.requireById(meeting.id);
    expect(rescheduled.status).toBe('RESCHEDULED');
    expect(rescheduled.startUtc).toBe('2026-03-05T16:00:00.000Z');

    harness.llm.setScript([
      {
        assistantText: 'Understood - I will take that out of the diary.',
        toolCalls: [
          {
            toolCallId: 'call_cancel_1',
            toolName: 'cancel_meeting',
            argumentsJson: scriptedArgs({ meeting_id: meeting.id, reason: 'Contact asked to cancel.' }),
          },
        ],
      },
      { assistantText: 'That is cancelled.' },
    ]);

    const cancelled = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Something has come up, can we cancel for now?',
    });
    expect(cancelled.toolOutcomes[0]?.ok).toBe(true);
    expect((await harness.db.meetings.requireById(meeting.id)).status).toBe('CANCELLED');

    // Still exactly one meeting row: rescheduling moves it, it does not clone it.
    expect(await harness.db.meetings.listByContact(harness.world.contact.id)).toHaveLength(1);
  });

  it('refuses to change a meeting belonging to another contact', async () => {
    await runTurn();
    const meeting = (await harness.db.meetings.listByContact(harness.world.contact.id))[0]!;

    // A second world in the same database, with its own contact and its own
    // conversation. Its agent must not be able to touch the first one's diary.
    const other = await import('../../src/app/seedSliceWorld.js').then((module) =>
      module.seedSliceWorld(harness.db, { suffix: 'second', contactPhoneE164: '+12125550199' }),
    );
    const otherConversation = await harness.runtime.conversations.start({
      organizationId: other.organization.id,
      contactId: other.contact.id,
      aiAgentId: other.aiAgent.id,
      agentConfigurationId: other.agentConfiguration.id,
    });

    harness.llm.setScript([
      {
        assistantText: 'Let me move that for you.',
        toolCalls: [
          {
            toolCallId: 'call_crosstalk_1',
            toolName: 'cancel_meeting',
            argumentsJson: scriptedArgs({ meeting_id: meeting.id, reason: 'not mine to cancel' }),
          },
        ],
      },
      { assistantText: 'Sorry, I could not do that.' },
    ]);

    const turn = await harness.runtime.agent.handleTurn({
      conversationId: otherConversation.id,
      utterance: 'Cancel my meeting please.',
    });

    const outcome = turn.toolOutcomes[0];
    expect(outcome?.ok).toBe(false);
    if (outcome && !outcome.ok) expect(outcome.code).toBe('POLICY_VIOLATION');

    // The other organization's meeting is untouched.
    expect((await harness.db.meetings.requireById(meeting.id)).status).toBe('SCHEDULED');
  });
});
