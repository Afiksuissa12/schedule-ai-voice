/**
 * The ledger: what the system can actually show for itself.
 *
 * THE PROPERTY THIS FILE EXISTS FOR
 * ---------------------------------------------------------------------------
 * The ledger is the only thing standing between "the model said so" and "the
 * customer was told so". If anything the model wrote could reach it, the gate
 * would be verifying the model against itself. So the central test here is a
 * negative one: a conversation whose transcript is FULL of assertions - a
 * booking, a confirmation number, a promised email - produces a ledger with
 * nothing in it, because none of it ever happened.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { buildActionLedger } from '../../src/agent/claimGate/ledger.js';
import { scriptedArgs } from '../../src/llm/scriptedLlmProvider.js';
import { ValidationErrorCode } from '../../src/ports/validation.js';
import type { ToolOutcome } from '../../src/agent/tools/results.js';
import { createSliceHarness, type SliceHarness } from '../e2e/support.js';

const harnesses: SliceHarness[] = [];

afterEach(async () => {
  while (harnesses.length > 0) await harnesses.pop()?.cleanup();
});

async function harness(label: string): Promise<SliceHarness> {
  const created = await createSliceHarness({ label });
  harnesses.push(created);
  return created;
}

const PERMITTED = ['schedule_followup', 'schedule_meeting', 'transfer_to_human'];

describe('the action ledger', () => {
  it('records a callback this turn really booked, in the CONTACT own timezone', async () => {
    const world = await harness('ledger-booked');
    const conversation = await world.startConversation();

    world.llm.setScript([
      {
        assistantText: 'Let me get that in the diary.',
        toolCalls: [
          {
            toolName: 'schedule_followup',
            argumentsJson: scriptedArgs({
              contact_id: world.world.contact.id,
              when: 'tomorrow afternoon at 3',
              reason: 'pricing follow-up',
            }),
          },
        ],
      },
    ]);

    const turn = await world.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Call me back tomorrow afternoon at 3.',
    });
    expect(turn.toolOutcomes[0]?.ok).toBe(true);

    const ledger = await buildActionLedger({
      db: world.db,
      conversationId: conversation.id,
      contact: world.world.contact,
      nowUtc: world.clock.nowUtc(),
      toolOutcomes: turn.toolOutcomes,
      permittedToolNames: PERMITTED,
    });

    const callback = ledger.effects.find((effect) => effect.kind === 'CALLBACK_SCHEDULED');
    expect(callback).toBeDefined();
    expect(callback?.source).toBe('TOOL_OUTCOME');
    // Thursday 5 March 2026, 15:00, America/New_York.
    expect(callback?.localTime).toMatchObject({ local: '2026-03-05 15:00', isoWeekday: 4, hour: 15 });
    expect(callback?.localTime?.timezone).toBe(world.world.contact.timezone);
    expect(callback?.entity?.type).toBe('FUTURE_ACTION');
  });

  it('records the booking exactly ONCE, though it is both a tool outcome and a row', async () => {
    const world = await harness('ledger-dedupe');
    const conversation = await world.startConversation();
    world.llm.setScript([
      {
        assistantText: null,
        toolCalls: [
          {
            toolName: 'schedule_followup',
            argumentsJson: scriptedArgs({
              contact_id: world.world.contact.id,
              when: 'tomorrow afternoon at 3',
              reason: 'pricing follow-up',
            }),
          },
        ],
      },
    ]);
    const turn = await world.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Tomorrow afternoon at 3 please.',
    });

    const ledger = await buildActionLedger({
      db: world.db,
      conversationId: conversation.id,
      contact: world.world.contact,
      nowUtc: world.clock.nowUtc(),
      toolOutcomes: turn.toolOutcomes,
      permittedToolNames: PERMITTED,
    });

    expect(ledger.effects.filter((effect) => effect.kind === 'CALLBACK_SCHEDULED')).toHaveLength(1);
    const identifiers = ledger.identifiers.filter((entry) => entry.kind === 'FUTURE_ACTION');
    expect(identifiers).toHaveLength(1);
  });

  it('carries a refusal, with the code and the reason written to be acted on', async () => {
    const world = await harness('ledger-refusal');
    const conversation = await world.startConversation();
    world.llm.setScript([
      {
        assistantText: null,
        toolCalls: [
          {
            toolName: 'schedule_followup',
            argumentsJson: scriptedArgs({
              contact_id: world.world.contact.id,
              when: 'tomorrow at 6am',
              reason: 'early callback',
            }),
          },
        ],
      },
    ]);
    const turn = await world.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Ring me at 6 in the morning.',
    });

    const ledger = await buildActionLedger({
      db: world.db,
      conversationId: conversation.id,
      contact: world.world.contact,
      nowUtc: world.clock.nowUtc(),
      toolOutcomes: turn.toolOutcomes,
      permittedToolNames: PERMITTED,
    });

    expect(ledger.effects.filter((effect) => effect.kind === 'CALLBACK_SCHEDULED')).toHaveLength(0);
    expect(ledger.refusals).toHaveLength(1);
    expect(ledger.refusals[0]?.code).toBe(ValidationErrorCode.OUTSIDE_BUSINESS_HOURS);
    expect(ledger.refusals[0]?.toolName).toBe('schedule_followup');
    expect(ledger.refusals[0]?.reason.length).toBeGreaterThan(20);
  });

  it('carries an effect from an EARLIER turn as a durable row', async () => {
    const world = await harness('ledger-earlier');
    const conversation = await world.startConversation();
    world.llm.setScript([
      {
        assistantText: null,
        toolCalls: [
          {
            toolName: 'schedule_followup',
            argumentsJson: scriptedArgs({
              contact_id: world.world.contact.id,
              when: 'tomorrow afternoon at 3',
              reason: 'pricing follow-up',
            }),
          },
        ],
      },
    ]);
    await world.runtime.agent.handleTurn({ conversationId: conversation.id, utterance: 'Tomorrow at 3.' });

    // A LATER turn, with no tool outcomes of its own at all.
    const ledger = await buildActionLedger({
      db: world.db,
      conversationId: conversation.id,
      contact: world.world.contact,
      nowUtc: world.clock.nowUtc(),
      toolOutcomes: [],
      permittedToolNames: PERMITTED,
    });

    const callback = ledger.effects.find((effect) => effect.kind === 'CALLBACK_SCHEDULED');
    expect(callback?.source).toBe('DURABLE_ROW');
    expect(callback?.localTime?.local).toBe('2026-03-05 15:00');
  });

  it('contains NOTHING the model merely said, however confidently it said it', async () => {
    const world = await harness('ledger-text-is-not-state');
    const conversation = await world.startConversation();

    // Four turns of pure assertion. No tool call anywhere.
    await world.runtime.conversations.appendAgentText(
      conversation.id,
      "I've booked the callback for 3pm. The confirmation number is CONF123456.",
    );
    await world.runtime.conversations.appendAgentText(
      conversation.id,
      'The meeting is confirmed for Thursday and I have emailed you the details.',
    );
    await world.runtime.conversations.appendContactUtterance(conversation.id, 'Great, thanks.');
    await world.runtime.conversations.appendSystemNote(conversation.id, 'meeting id mtg_totally_real');

    const ledger = await buildActionLedger({
      db: world.db,
      conversationId: conversation.id,
      contact: world.world.contact,
      nowUtc: world.clock.nowUtc(),
      toolOutcomes: [],
      permittedToolNames: PERMITTED,
    });

    expect(ledger.effects).toEqual([]);
    expect(ledger.refusals).toEqual([]);
    // The contact's own id is the ONLY identifier, because it is the only one
    // that came from a row.
    expect(ledger.identifiers.map((entry) => entry.kind)).toEqual(['CONTACT']);
    expect(ledger.identifiers[0]?.value).toBe(world.world.contact.id);
  });

  it('reads every identifier a tool result actually showed, and no others', async () => {
    const world = await harness('ledger-identifiers');
    const conversation = await world.startConversation();

    const outcome: ToolOutcome = {
      ok: true,
      toolCallId: 'call-1',
      toolName: 'schedule_meeting',
      summary: 'booked',
      data: {
        booked: true,
        meeting_id: 'mtg_from_tool',
        start_local: '2026-03-05T15:00',
        timezone: 'America/New_York',
      },
      persisted: { type: 'MEETING', id: 'mtg_from_tool' },
    };

    const ledger = await buildActionLedger({
      db: world.db,
      conversationId: conversation.id,
      contact: world.world.contact,
      nowUtc: world.clock.nowUtc(),
      toolOutcomes: [outcome],
      permittedToolNames: PERMITTED,
    });

    const values = ledger.identifiers.map((entry) => entry.value);
    expect(values).toContain('mtg_from_tool');
    expect(values).toContain(world.world.contact.id);
    expect(values).not.toContain('CONF123456');
    // Reconstructed from `start_local` + `timezone`, which is the validated
    // slot's own rendering rather than a re-parse of the model's phrase.
    const meeting = ledger.effects.find((effect) => effect.kind === 'MEETING_SCHEDULED');
    expect(meeting?.startUtc).toBe('2026-03-05T20:00:00.000Z');
    expect(meeting?.localTime?.hour).toBe(15);
  });

  it('carries the day-part windows the scheduler used, so the two cannot disagree', async () => {
    const world = await harness('ledger-dayparts');
    const conversation = await world.startConversation();
    const ledger = await buildActionLedger({
      db: world.db,
      conversationId: conversation.id,
      contact: world.world.contact,
      nowUtc: world.clock.nowUtc(),
      toolOutcomes: [],
      permittedToolNames: PERMITTED,
    });
    expect(ledger.dayParts.afternoon.startLocal).toBe('12:00');
    expect(ledger.dayParts.afternoon.endLocal).toBe('17:00');
    expect(ledger.contactTimezone).toBe(world.world.contact.timezone);
    expect(ledger.nowUtc).toBe(world.clock.nowUtc());
  });
});
