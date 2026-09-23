/**
 * THE REJECTION SUITE: every way a model can misbehave, and proof that none of
 * them reach the database.
 *
 * WHAT EACH TEST ASSERTS, WITHOUT EXCEPTION
 * ---------------------------------------------------------------------------
 *  1. The tool call was refused with a SPECIFIC `ValidationErrorCode` - not a
 *     generic failure. A code the model can act on is the difference between
 *     "ask them am or pm" and "try again and hope".
 *  2. ZERO domain rows were created. Counted across every table a tool could
 *     write: meetings, future actions, qualification states, calls, call
 *     outcomes, tasks, leads, contacts. Not "no meeting" - nothing at all.
 *  3. A `TOOL_CALL_REJECTED` or `VALIDATION_REJECTED` event was recorded,
 *     carrying that code, so the refusal is as explainable as an acceptance.
 *  4. No `ENTITY_PERSISTED` or `FUTURE_ACTION_SCHEDULED` appears in the chain.
 *
 * Point 2 is the one that matters most. A system that refuses loudly but leaves
 * a half-written row behind has not refused.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ADVERSARIAL, scriptedArgs, type ScriptedToolCall } from '../../src/llm/scriptedLlmProvider.js';
import { TOOL_NAMES } from '../../src/agent/tools/definitions.js';
import type { Conversation } from '../../src/domain/entities.js';
import { createSliceHarness, type DomainRowCounts, type SliceHarness } from './support.js';

interface RejectionCase {
  readonly name: string;
  readonly why: string;
  readonly call: (contactId: string) => ScriptedToolCall;
  readonly expectedCode: string;
  /** Substring the refusal must contain, so the model is told what to do. */
  readonly reasonContains?: string;
  /** Tools this conversation's configuration permits. Defaults to all nine. */
  readonly allowedTools?: readonly string[];
}

const CASES: readonly RejectionCase[] = [
  {
    name: 'a tool that does not exist',
    why: 'The model invented a capability. It must not be able to reach one by naming it.',
    call: (contactId) => ADVERSARIAL.unknownTool(contactId),
    expectedCode: 'UNSUPPORTED_TOOL',
    reasonContains: 'There is no tool called',
  },
  {
    name: 'arguments that are not JSON',
    why: 'Real models emit malformed tool arguments. Parsing must fail safely, not partially.',
    call: () => ADVERSARIAL.malformedArgumentsJson(),
    expectedCode: 'SCHEMA_VIOLATION',
    reasonContains: 'not valid JSON',
  },
  {
    name: 'a required field missing',
    why: 'A callback with no time is not a callback, and must not become one with a default.',
    call: (contactId) => ADVERSARIAL.missingRequiredField(contactId),
    expectedCode: 'SCHEMA_VIOLATION',
    reasonContains: 'when',
  },
  {
    name: 'a datetime in the past',
    why: 'Nobody can be called back in 2019. A past instant must never be silently rolled forward.',
    call: (contactId) => ADVERSARIAL.datetimeInThePast(contactId),
    expectedCode: 'IN_THE_PAST',
  },
  {
    name: 'a timezone that does not exist',
    why: 'An unknown zone must be refused, not quietly replaced with UTC or the local default.',
    call: (contactId) => ADVERSARIAL.bogusTimezone(contactId),
    expectedCode: 'UNKNOWN_TIMEZONE',
    reasonContains: 'Unknown timezone',
  },
  {
    name: 'a contact id the model invented',
    why: 'THE anti-fabrication gate. A guessed id must not be able to reach a stranger.',
    call: () => ADVERSARIAL.fabricatedContactId(),
    expectedCode: 'UNKNOWN_CONTACT',
    reasonContains: 'Do not guess an id',
  },
  {
    name: 'a time outside business hours',
    why: 'A 6am sales call is a real harm. The policy comes from the persisted configuration.',
    call: (contactId) => ADVERSARIAL.outsideBusinessHours(contactId),
    expectedCode: 'OUTSIDE_BUSINESS_HOURS',
  },
  {
    name: 'a real tool the configuration does not permit',
    why: 'allowedToolsJson is policy. Offering the model fewer tools is a courtesy; this is the control.',
    call: (contactId) => ADVERSARIAL.toolNotPermittedByConfiguration(contactId),
    expectedCode: 'POLICY_VIOLATION',
    reasonContains: 'not enabled for this conversation',
    allowedTools: ['get_contact_context', 'check_availability', 'schedule_followup'],
  },
  {
    name: 'a follow-up type the slice declares but cannot execute',
    why: 'A silent no-op is forbidden. An unexecutable action must refuse in structured, audited form.',
    call: (contactId) => ADVERSARIAL.unsupportedFollowupType(contactId),
    expectedCode: 'POLICY_VIOLATION',
    reasonContains: 'not executable in this slice',
  },
  {
    name: 'an ambiguous time with no am or pm',
    why: 'The resolver refuses rather than guessing, and names the question the model should ask.',
    call: (contactId) => ({
      toolName: 'schedule_followup',
      argumentsJson: scriptedArgs({ contact_id: contactId, when: 'tomorrow at 3', reason: 'callback' }),
    }),
    expectedCode: 'INVALID_FORMAT',
    reasonContains: 'am',
  },
  {
    name: 'a time beyond the configured horizon',
    why: 'The horizon comes from the persisted AgentConfiguration, not from a constant.',
    call: (contactId) => ({
      toolName: 'schedule_followup',
      argumentsJson: scriptedArgs({ contact_id: contactId, when: '2031-06-11T14:00', reason: 'callback' }),
    }),
    expectedCode: 'BEYOND_HORIZON',
  },
  {
    name: 'a meeting id the model invented',
    why: 'The same fabrication gate, on the other subject kind.',
    call: () => ({
      toolName: 'cancel_meeting',
      argumentsJson: scriptedArgs({ meeting_id: 'meeting_the_model_invented', reason: 'they cancelled' }),
    }),
    expectedCode: 'POLICY_VIOLATION',
    reasonContains: 'There is no meeting',
  },
  {
    name: 'an extra argument the tool never declared',
    why: 'Schemas are closed. A model that invents an argument is told so rather than quietly trimmed.',
    call: (contactId) => ({
      toolName: 'schedule_followup',
      argumentsJson: scriptedArgs({
        contact_id: contactId,
        when: 'tomorrow at 3pm',
        override_business_hours: true,
        skip_validation: true,
      }),
    }),
    expectedCode: 'SCHEMA_VIOLATION',
  },
];

describe('end-to-end: every adversarial turn is refused, and writes nothing', () => {
  for (const testCase of CASES) {
    describe(testCase.name, () => {
      let harness: SliceHarness;
      let conversation: Conversation;
      let before: DomainRowCounts;

      beforeEach(async () => {
        harness = await createSliceHarness({
          label: `e2e-adv-${testCase.expectedCode.toLowerCase()}`,
          ...(testCase.allowedTools ? { world: { allowedTools: testCase.allowedTools } } : {}),
        });
        conversation = await harness.startConversation();
        harness.llm.setScript([
          {
            assistantText: 'Let me sort that out for you.',
            toolCalls: [testCase.call(harness.world.contact.id)],
          },
          { assistantText: 'Sorry - I was not able to arrange that.' },
        ]);
        before = await harness.countDomainRows();
      });

      afterEach(async () => {
        await harness.cleanup();
      });

      it(`is refused with ${testCase.expectedCode} and persists nothing (${testCase.why})`, async () => {
        const turn = await harness.runtime.agent.handleTurn({
          conversationId: conversation.id,
          utterance: 'Whatever is easiest, just get it done.',
        });

        // 1. a specific code, and a reason the model can act on
        const outcome = turn.toolOutcomes[0];
        expect(outcome, 'expected exactly one tool outcome').toBeDefined();
        expect(outcome?.ok, `unexpectedly succeeded: ${JSON.stringify(outcome)}`).toBe(false);
        if (outcome?.ok) return;

        expect(outcome?.code).toBe(testCase.expectedCode);
        expect(outcome?.reason.length ?? 0).toBeGreaterThan(20);
        if (testCase.reasonContains) {
          expect(outcome?.reason).toContain(testCase.reasonContains);
        }

        // 2. ZERO domain rows created, across every table a tool could write
        expect(await harness.countDomainRows()).toEqual(before);

        // 3. the refusal is on the record, with the code
        const chain = await harness.db.audit.listByCorrelationId(turn.correlationId);
        const types = chain.map((event) => event.type);
        expect(types.some((type) => type === 'TOOL_CALL_REJECTED' || type === 'VALIDATION_REJECTED')).toBe(true);

        const rejection = chain.find(
          (event) => event.type === 'TOOL_CALL_REJECTED' || event.type === 'VALIDATION_REJECTED',
        );
        expect(rejection?.detailJson).toContain(testCase.expectedCode);

        // 4. nothing was persisted, said by the chain itself
        expect(types).not.toContain('ENTITY_PERSISTED');
        expect(types).not.toContain('FUTURE_ACTION_SCHEDULED');

        // ...and the raw arguments were recorded before they were judged, so an
        // auditor sees what the model actually emitted.
        const requested = chain.find((event) => event.type === 'TOOL_CALL_REQUESTED');
        expect(requested).toBeDefined();
        expect(requested?.detailJson).toContain('rawArgumentsJson');

        // The refusal reached the model as a TOOL turn it can read next time.
        const turns = await harness.db.conversationTurns.listByConversation(conversation.id);
        const toolResult = turns.find((t) => t.role === 'TOOL');
        expect(toolResult?.rawPayloadJson).toContain(testCase.expectedCode);
      });
    });
  }
});

describe('end-to-end: the turn loop is bounded', () => {
  let harness: SliceHarness;
  let conversation: Conversation;

  beforeEach(async () => {
    // A model that never stops asking: `repeat-last` makes it genuinely
    // unbounded, so only application code can end this.
    harness = await createSliceHarness({
      label: 'e2e-loop-cap',
      maxToolIterations: 3,
      llm: { onExhausted: 'repeat-last' },
    });
    conversation = await harness.startConversation();

    harness.llm.setScript([
      {
        assistantText: 'Let me check that.',
        toolCalls: [
          {
            toolName: 'get_contact_context',
            argumentsJson: scriptedArgs({ contact_id: harness.world.contact.id }),
          },
        ],
      },
    ]);
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it('stops at the cap, refuses the outstanding calls, and says so on the record', async () => {
    const before = await harness.countDomainRows();

    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Tell me everything you know about me.',
    });

    expect(turn.stopReason).toBe('ITERATION_CAP_REACHED');
    expect(turn.iterations).toBe(3);
    // Three model calls, no more. The cap is a number in code, not a request.
    expect(harness.llm.callCount).toBe(3);

    const refused = turn.toolOutcomes.filter((outcome) => !outcome.ok);
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.every((outcome) => !outcome.ok && outcome.code === 'POLICY_VIOLATION')).toBe(true);

    const chain = await harness.db.audit.listByCorrelationId(turn.correlationId);
    const capRejection = chain.find(
      (event) => event.type === 'TOOL_CALL_REJECTED' && event.summary.includes('cap'),
    );
    expect(capRejection).toBeDefined();
    expect(capRejection?.detailJson).toContain('POLICY_VIOLATION');

    // `get_contact_context` reads only; nothing was written on any iteration.
    expect(await harness.countDomainRows()).toEqual(before);

    // The transcript explains why the turn ended, rather than simply stopping.
    const turns = await harness.db.conversationTurns.listByConversation(conversation.id);
    const systemNote = turns.find((t) => t.role === 'SYSTEM');
    expect(systemNote?.text).toContain('cap');
  });
});

describe('end-to-end: get_contact_context returns persisted facts only', () => {
  let harness: SliceHarness;

  beforeEach(async () => {
    harness = await createSliceHarness({ label: 'e2e-context-facts' });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it('ignores everything the model asserted earlier in the conversation', async () => {
    const conversation = await harness.startConversation();

    // Turn one: the model states a series of confident falsehoods out loud and
    // they are persisted as AGENT turns, exactly as a real transcript would.
    harness.llm.setScript([
      {
        assistantText:
          'Great - so you are the CFO at Initech, your budget is $250,000, you are in Tokyo, and we already ' +
          'have you down for Friday at 4.',
      },
    ]);
    await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Remind me what you have on file?',
    });

    // Turn two: it asks what is actually on file.
    harness.llm.setScript([
      {
        assistantText: 'Let me check the record.',
        toolCalls: [
          {
            toolCallId: 'call_ctx_1',
            toolName: 'get_contact_context',
            argumentsJson: scriptedArgs({ contact_id: harness.world.contact.id }),
          },
        ],
      },
      { assistantText: 'Here is what we have.' },
    ]);
    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'What do you actually have on file for me?',
    });

    const outcome = turn.toolOutcomes[0];
    expect(outcome?.ok).toBe(true);
    if (!outcome?.ok) return;

    const serialized = JSON.stringify(outcome.data);
    // None of the model's inventions survived.
    expect(serialized).not.toContain('Initech');
    expect(serialized).not.toContain('250,000');
    expect(serialized).not.toContain('Tokyo');

    // What IS there came from rows.
    expect(outcome.data['contact_id']).toBe(harness.world.contact.id);
    expect(outcome.data['full_name']).toBe(harness.world.contact.fullName);
    expect(outcome.data['timezone']).toBe('America/New_York');
    expect(outcome.data['source']).toBe('database');
    // Nothing is booked, because nothing was ever booked.
    expect(outcome.data['upcoming_meetings']).toEqual([]);
    expect(outcome.data['promised_callbacks']).toEqual([]);
    expect(outcome.data['qualification']).toBeNull();

    // The phone number is masked: the model never needs to dial.
    expect(outcome.data['phone']).not.toBe(harness.world.contact.primaryPhoneE164);
    expect(String(outcome.data['phone'])).toContain('•');
  });
});

describe('the tool contract', () => {
  it('declares exactly the nine Founder-named tools', () => {
    expect([...TOOL_NAMES].sort()).toEqual(
      [
        'cancel_meeting',
        'check_availability',
        'get_contact_context',
        'record_call_outcome',
        'reschedule_meeting',
        'schedule_followup',
        'schedule_meeting',
        'transfer_to_human',
        'update_qualification',
      ].sort(),
    );
  });
});
