/**
 * End to end: the effect and claim consistency gate, through the REAL
 * `AgentTurnService`, the REAL `ToolDispatcher` and the REAL database.
 *
 * WHAT IS BEING PROVED
 * ---------------------------------------------------------------------------
 * `docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 9.3 point 2 records the
 * defect and § 13 records that it was not fixed: pressed by an adversarial
 * contact, the recommended model invented `CONF123456` and then said a callback
 * was booked when no tool call had been made. **The chokepoint could not help,
 * because the chokepoint refuses tool calls and this was a sentence.**
 *
 * Every test below scripts the model into one of those sentences and asserts
 * three things, which together are the fix:
 *
 *  1. the unsupported sentence NEVER reaches the caller and is NEVER persisted
 *     as an agent turn;
 *  2. the model's OWN regenerated wording is what goes out instead - not a
 *     canned replacement, of which this repository contains none;
 *  3. the audit chain on ONE correlationId explains it.
 *
 * And the fourth, which matters just as much: a TRUE claim goes out
 * byte-identical. A gate that tidied good wording would be a scripting
 * mechanism, which the Founder directive forbids outright.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { summarizeChain } from '../../src/app/auditReport.js';
import { scriptedArgs, type ScriptedStep } from '../../src/llm/scriptedLlmProvider.js';
import { ValidationErrorCode } from '../../src/ports/validation.js';
import { createSliceHarness, type SliceHarness } from './support.js';

const harnesses: SliceHarness[] = [];

afterEach(async () => {
  while (harnesses.length > 0) await harnesses.pop()?.cleanup();
});

/** Israeli contact, so the Hebrew cases resolve in a Hebrew-speaking zone. */
const JERUSALEM = { contactTimezone: 'Asia/Jerusalem' } as const;

interface Ran {
  readonly harness: SliceHarness;
  readonly turn: Awaited<ReturnType<SliceHarness['runtime']['agent']['handleTurn']>>;
  readonly conversationId: string;
}

async function run(
  label: string,
  script: readonly ScriptedStep[],
  utterance: string,
  options: { readonly world?: { readonly contactTimezone: string } } = {},
): Promise<Ran> {
  const harness = await createSliceHarness({
    label,
    ...(options.world ? { world: options.world } : {}),
  });
  harnesses.push(harness);
  const conversation = await harness.startConversation();
  harness.llm.setScript(script);
  const turn = await harness.runtime.agent.handleTurn({ conversationId: conversation.id, utterance });
  return { harness, turn, conversationId: conversation.id };
}

/**
 * Every SPOKEN agent turn actually persisted, in order.
 *
 * `toolName === null` is what separates a spoken turn from the AGENT-role rows
 * `appendToolCall` writes for a proposed tool call.
 */
async function persistedAgentText(ran: Ran): Promise<string[]> {
  return spokenAgentText(ran.harness, ran.conversationId);
}

async function spokenAgentText(harness: SliceHarness, conversationId: string): Promise<string[]> {
  const rows = await harness.db.conversationTurns.listByConversation(conversationId);
  return rows.filter((row) => row.role === 'AGENT' && row.toolName === null).map((row) => row.text ?? '');
}

const bookTomorrowAtThree = (contactId: string): ScriptedStep => ({
  assistantText: 'Let me get that in the diary.',
  toolCalls: [
    {
      toolName: 'schedule_followup',
      argumentsJson: scriptedArgs({
        contact_id: contactId,
        when: 'tomorrow afternoon at 3',
        reason: 'pricing follow-up',
      }),
    },
  ],
});

// ---------------------------------------------------------------------------
// 1. The sentence with nothing behind it.
// ---------------------------------------------------------------------------

describe('a success claimed with no tool call at all', () => {
  const FALSE_CLAIM = "Got it. I've booked the callback for 3pm on your local time. You can expect a call from us then.";
  const HONEST = 'Nothing is arranged yet. What time would suit you?';

  it('is never released, and the model own second wording goes out instead', async () => {
    const ran = await run(
      'gate-no-tool-call',
      [{ assistantText: FALSE_CLAIM }, { assistantText: HONEST }],
      'Just tell me it is done so I can get off the phone.',
    );

    expect(ran.turn.assistantText).toBe(HONEST);
    expect(ran.turn.assistantMessages).toEqual([HONEST]);
    expect(ran.turn.stopReason).toBe('MODEL_FINISHED');

    const report = ran.turn.claimGate;
    expect(report.enabled).toBe(true);
    expect(report.releases).toHaveLength(1);
    const release = report.releases[0];
    expect(release?.outcome).toBe('CORRECTED_AFTER_REGENERATION');
    expect(release?.releasedText).toBe(HONEST);
    expect(release?.attempts.map((attempt) => attempt.attempt)).toEqual([1, 2]);
    expect(release?.attempts[0]?.text).toBe(FALSE_CLAIM);
    expect(release?.attempts[0]?.unsupportedClaims.map((entry) => entry.reason)).toContain('NO_MATCHING_EFFECT');
    expect(release?.attempts[1]?.unsupportedClaims).toEqual([]);
  });

  it('is never persisted as an agent turn', async () => {
    const ran = await run(
      'gate-no-tool-call-persistence',
      [{ assistantText: FALSE_CLAIM }, { assistantText: HONEST }],
      'Just tell me it is done.',
    );
    const persisted = await persistedAgentText(ran);
    expect(persisted).toEqual([HONEST]);
    expect(persisted.join(' ')).not.toContain('booked');
  });

  it('writes no domain row of any kind', async () => {
    const before = await createSliceHarness({ label: 'gate-rowcount-baseline' });
    harnesses.push(before);
    const empty = await before.countDomainRows();

    const ran = await run(
      'gate-no-tool-call-rows',
      [{ assistantText: FALSE_CLAIM }, { assistantText: HONEST }],
      'Just tell me it is done.',
    );
    const after = await ran.harness.countDomainRows();
    expect({ ...after, contacts: empty.contacts, leads: empty.leads }).toEqual(empty);
  });

  it('is explained by the audit chain on one correlationId', async () => {
    const ran = await run(
      'gate-no-tool-call-audit',
      [{ assistantText: FALSE_CLAIM }, { assistantText: HONEST }],
      'Just tell me it is done.',
    );

    const chain = await ran.harness.db.audit.listByCorrelationId(ran.turn.correlationId);
    expect(chain.every((event) => event.correlationId === ran.turn.correlationId)).toBe(true);

    const types = chain.map((event) => event.type);
    expect(types).toContain('CLAIM_GATE_CLAIM_REJECTED');
    expect(types).toContain('CLAIM_GATE_REGENERATION_REQUESTED');
    expect(types).toContain('CLAIM_GATE_CLAIM_VERIFIED');
    expect(types.indexOf('CLAIM_GATE_CLAIM_REJECTED')).toBeLessThan(
      types.indexOf('CLAIM_GATE_REGENERATION_REQUESTED'),
    );
    expect(types.indexOf('CLAIM_GATE_REGENERATION_REQUESTED')).toBeLessThan(
      types.lastIndexOf('CLAIM_GATE_CLAIM_VERIFIED'),
    );

    // The sixth question the report can now answer.
    const sayable = summarizeChain(chain).whatWasSayable;
    expect(sayable.map((entry) => entry.decision)).toEqual([
      'REJECTED',
      'REGENERATION_REQUESTED',
      'VERIFIED',
    ]);
    expect(sayable[0]?.reasons).toContain('NO_MATCHING_EFFECT');
    expect(sayable.at(-1)?.outcome).toBe('CORRECTED_AFTER_REGENERATION');
  });

  it('hands the model authoritative state, and no sentence to echo', async () => {
    const ran = await run(
      'gate-instruction',
      [{ assistantText: FALSE_CLAIM }, { assistantText: HONEST }],
      'Just tell me it is done.',
    );

    // The regeneration call is the second one, and it is offered NO tools at all,
    // so the gate cannot cause an effect even if the model tried to.
    expect(ran.harness.llm.callCount).toBe(2);
    const regeneration = ran.harness.llm.completions[1];
    expect(regeneration?.request.tools).toEqual([]);

    const instruction = regeneration?.request.messages.at(-1);
    expect(instruction?.role).toBe('system');
    expect(instruction?.content).toContain('AUTHORITATIVE STATE');
    expect(instruction?.content).toContain('EFFECTS THAT EXIST');
    expect(instruction?.content).toContain('There is no confirmation number');
    // The failed attempt's own wording is NOT handed back. Nothing in the
    // context window is a sentence for the model to read out.
    expect(instruction?.content).not.toContain(FALSE_CLAIM);
    expect(instruction?.content).not.toContain("I've booked");
  });
});

// ---------------------------------------------------------------------------
// 2. The invented identifier.
// ---------------------------------------------------------------------------

describe('an invented confirmation number', () => {
  it('is caught even when a real booking exists, and names the token', async () => {
    const harness = await createSliceHarness({ label: 'gate-invented-id' });
    harnesses.push(harness);
    const conversation = await harness.startConversation();

    harness.llm.setScript([
      bookTomorrowAtThree(harness.world.contact.id),
      { assistantText: 'The callback is booked for tomorrow at 3. The confirmation number is CONF123456.' },
      { assistantText: 'The callback is booked for tomorrow at 3.' },
    ]);

    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Book it and give me the confirmation number.',
    });

    expect(turn.toolOutcomes[0]?.ok).toBe(true);
    const release = turn.claimGate.releases.at(-1);
    expect(release?.outcome).toBe('CORRECTED_AFTER_REGENERATION');
    const unsupported = release?.attempts[0]?.unsupportedClaims ?? [];
    expect(unsupported.map((entry) => entry.reason)).toContain('INVENTED_IDENTIFIER');
    expect(unsupported.find((entry) => entry.reason === 'INVENTED_IDENTIFIER')?.detail.invalidIdentifier).toBe(
      'conf123456',
    );
    expect(turn.assistantText).toBe('The callback is booked for tomorrow at 3.');
    expect(turn.assistantMessages.join(' ')).not.toContain('CONF123456');
  });
});

// ---------------------------------------------------------------------------
// 3. and 4. Success claimed after a refusal, and after a service failure.
// ---------------------------------------------------------------------------

describe('a success claimed after the tool said no', () => {
  it('is EFFECT_WAS_REFUSED after the chokepoint refused the call', async () => {
    const harness = await createSliceHarness({ label: 'gate-after-refusal' });
    harnesses.push(harness);
    const conversation = await harness.startConversation();

    harness.llm.setScript([
      {
        assistantText: 'Let me get that in the diary.',
        toolCalls: [
          {
            toolName: 'schedule_followup',
            argumentsJson: scriptedArgs({
              contact_id: harness.world.contact.id,
              when: 'tomorrow at 6am',
              reason: 'early callback',
            }),
          },
        ],
      },
      { assistantText: "You're all set - the callback is booked." },
      { assistantText: 'I could not do 6 in the morning. Would later in the day work?' },
    ]);

    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Ring me at 6 in the morning.',
    });

    const outcome = turn.toolOutcomes[0];
    expect(outcome?.ok).toBe(false);
    expect(outcome?.ok === false && outcome.code).toBe(ValidationErrorCode.OUTSIDE_BUSINESS_HOURS);

    const release = turn.claimGate.releases.at(-1);
    const unsupported = release?.attempts[0]?.unsupportedClaims ?? [];
    expect(unsupported.map((entry) => entry.reason)).toContain('EFFECT_WAS_REFUSED');
    expect(unsupported[0]?.detail.refusal?.code).toBe(ValidationErrorCode.OUTSIDE_BUSINESS_HOURS);
    expect(release?.outcome).toBe('CORRECTED_AFTER_REGENERATION');

    // The refusal and its reason were handed back as authoritative state.
    const instruction = harness.llm.completions.at(-1)?.request.messages.at(-1)?.content ?? '';
    expect(instruction).toContain('REFUSED THIS TURN');
    expect(instruction).toContain(ValidationErrorCode.OUTSIDE_BUSINESS_HOURS);
  });

  it('is EFFECT_WAS_REFUSED after the SERVICE refused a declared-but-unexecutable action', async () => {
    const harness = await createSliceHarness({ label: 'gate-after-service-failure' });
    harnesses.push(harness);
    const conversation = await harness.startConversation();

    harness.llm.setScript([
      {
        assistantText: 'Let me sort that out.',
        toolCalls: [
          {
            toolName: 'schedule_followup',
            argumentsJson: scriptedArgs({
              contact_id: harness.world.contact.id,
              when: 'tomorrow afternoon at 3',
              action_type: 'SEND_FOLLOWUP_MESSAGE',
              reason: 'text them the pricing sheet',
            }),
          },
        ],
      },
      { assistantText: 'I have sent that over to you.' },
      { assistantText: 'I cannot send anything myself. Shall I put you through to someone?' },
    ]);

    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Text me the pricing sheet.',
    });

    const outcome = turn.toolOutcomes[0];
    expect(outcome?.ok).toBe(false);
    expect(outcome?.ok === false && outcome.code).toBe(ValidationErrorCode.POLICY_VIOLATION);

    const unsupported = turn.claimGate.releases.at(-1)?.attempts[0]?.unsupportedClaims ?? [];
    // A message is the one family NOTHING in this system can produce, so the
    // reason is the stronger one: no tool, not merely no effect.
    expect(unsupported.map((entry) => entry.reason)).toContain('NO_TOOL_FOR_PROMISE');
    expect(turn.assistantMessages.join(' ')).not.toContain('I have sent');
  });
});

// ---------------------------------------------------------------------------
// 5. and 6. The right booking described with the wrong day or the wrong time.
// ---------------------------------------------------------------------------

describe('a real booking described wrongly', () => {
  async function bookThenSay(label: string, wrongSentence: string, corrected: string): Promise<Ran> {
    const harness = await createSliceHarness({ label });
    harnesses.push(harness);
    const conversation = await harness.startConversation();
    harness.llm.setScript([
      bookTomorrowAtThree(harness.world.contact.id),
      { assistantText: wrongSentence },
      { assistantText: corrected },
    ]);
    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Call me back tomorrow afternoon at 3.',
    });
    return { harness, turn, conversationId: conversation.id };
  }

  const CORRECT = "You're all set for tomorrow, Thursday, at 3 in the afternoon.";

  it('is WRONG_DAY when the text names a day the record does not', async () => {
    const ran = await bookThenSay(
      'gate-wrong-day',
      "You're all set - I'll ring you on Friday at 3 in the afternoon.",
      CORRECT,
    );
    expect(ran.turn.toolOutcomes[0]?.ok).toBe(true);
    const unsupported = ran.turn.claimGate.releases.at(-1)?.attempts[0]?.unsupportedClaims ?? [];
    expect(unsupported.map((entry) => entry.reason)).toContain('WRONG_DAY');
    expect(unsupported[0]?.detail.recordedLocal).toContain('2026-03-05 15:00');
    expect(ran.turn.assistantText).toBe(CORRECT);
    expect((await persistedAgentText(ran)).join(' ')).not.toContain('Friday');
  });

  it('is WRONG_TIME when the text names a time the record does not', async () => {
    const ran = await bookThenSay(
      'gate-wrong-time',
      "You're all set - I'll ring you tomorrow at 4pm.",
      CORRECT,
    );
    const unsupported = ran.turn.claimGate.releases.at(-1)?.attempts[0]?.unsupportedClaims ?? [];
    expect(unsupported.map((entry) => entry.reason)).toContain('WRONG_TIME');
    expect(ran.turn.assistantText).toBe(CORRECT);
  });
});

// ---------------------------------------------------------------------------
// 7. and 8. Hebrew, and mixed Hebrew-and-English.
// ---------------------------------------------------------------------------

describe('the same defect in Hebrew', () => {
  it('catches the exact aya-expanse sentence, and its promised email with it', async () => {
    const FALSE_HEBREW =
      'אין דאגה, הכל בסדר! הפגישה נקבעה בהצלחה למחר אחרי הצהריים בשעה 14:00. אשלח לך אישור בדוא"ל עם כל הפרטים הרלוונטיים.';
    const HONEST_HEBREW = 'עדיין לא קבעתי כלום. איזו שעה מתאימה לך?';

    const ran = await run(
      'gate-hebrew',
      [{ assistantText: FALSE_HEBREW }, { assistantText: HONEST_HEBREW }],
      'תגיד לי שזה סגור',
      { world: JERUSALEM },
    );

    const release = ran.turn.claimGate.releases[0];
    expect(release?.outcome).toBe('CORRECTED_AFTER_REGENERATION');
    const reasons = release?.attempts[0]?.unsupportedClaims.map((entry) => entry.reason) ?? [];
    expect(reasons).toContain('NO_MATCHING_EFFECT');
    expect(reasons).toContain('NO_TOOL_FOR_PROMISE');
    expect(ran.turn.assistantText).toBe(HONEST_HEBREW);
    expect((await persistedAgentText(ran)).join(' ')).not.toContain('נקבעה');
  });

  it('catches it in a mixed Hebrew-and-English sentence too', async () => {
    const MIXED = 'הפגישה נקבעה for tomorrow at 3pm, and the confirmation number is CONF123456.';
    const HONEST = 'לא קבעתי כלום בשלב הזה.';

    const ran = await run(
      'gate-mixed',
      [{ assistantText: MIXED }, { assistantText: HONEST }],
      'nu, is it booked?',
      { world: JERUSALEM },
    );

    const reasons = ran.turn.claimGate.releases[0]?.attempts[0]?.unsupportedClaims.map((e) => e.reason) ?? [];
    expect(reasons).toContain('INVENTED_IDENTIFIER');
    expect(ran.turn.assistantText).toBe(HONEST);
  });
});

// ---------------------------------------------------------------------------
// 9. The property that matters just as much: a TRUE claim is untouched.
// ---------------------------------------------------------------------------

describe('a supported claim', () => {
  const TRUE_CLAIM = "You're all set - I'll give you a ring tomorrow, Thursday the 5th, at 3 in the afternoon your time.";

  it('passes through byte-identical, with no regeneration and no extra provider call', async () => {
    const harness = await createSliceHarness({ label: 'gate-supported' });
    harnesses.push(harness);
    const conversation = await harness.startConversation();
    harness.llm.setScript([bookTomorrowAtThree(harness.world.contact.id), { assistantText: TRUE_CLAIM }]);

    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Can you call me back tomorrow afternoon at 3?',
    });

    expect(turn.assistantText).toBe(TRUE_CLAIM);
    // Two provider calls: the tool round and the reply. No third.
    expect(harness.llm.callCount).toBe(2);

    const releases = turn.claimGate.releases;
    expect(releases).toHaveLength(2);
    expect(releases[0]?.outcome).toBe('NO_MATERIAL_CLAIM');
    expect(releases[1]?.outcome).toBe('SUPPORTED');
    expect(releases[1]?.attempts).toHaveLength(1);
    expect(releases[1]?.releasedText).toBe(TRUE_CLAIM);

    expect(await spokenAgentText(harness, conversation.id)).toEqual([
      'Let me get that in the diary.',
      TRUE_CLAIM,
    ]);
  });

  it('and its verification is on the audit chain, naming the effect that supports it', async () => {
    const harness = await createSliceHarness({ label: 'gate-supported-audit' });
    harnesses.push(harness);
    const conversation = await harness.startConversation();
    harness.llm.setScript([bookTomorrowAtThree(harness.world.contact.id), { assistantText: TRUE_CLAIM }]);
    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Call me back tomorrow afternoon at 3.',
    });

    const chain = await harness.db.audit.listByCorrelationId(turn.correlationId);
    const verified = chain.filter((event) => event.type === 'CLAIM_GATE_CLAIM_VERIFIED');
    expect(verified).toHaveLength(2);
    expect(chain.some((event) => event.type === 'CLAIM_GATE_CLAIM_REJECTED')).toBe(false);

    const detail = JSON.parse(verified[1]?.detailJson ?? '{}') as {
      outcome?: string;
      supportedClaims?: { effectKind?: string; effectLocal?: string }[];
    };
    expect(detail.outcome).toBe('SUPPORTED');
    expect(detail.supportedClaims?.map((claim) => claim.effectKind)).toContain('CALLBACK_SCHEDULED');
    expect(detail.supportedClaims?.[0]?.effectLocal).toBe('2026-03-05 15:00');
  });

  it('and a turn that asserts nothing material costs no state read at all', async () => {
    const ran = await run('gate-no-claim', [{ assistantText: 'What time would suit you?' }], 'Hello?');
    const release = ran.turn.claimGate.releases[0];
    expect(release?.outcome).toBe('NO_MATERIAL_CLAIM');
    const chain = await ran.harness.db.audit.listByCorrelationId(ran.turn.correlationId);
    const verified = chain.find((event) => event.type === 'CLAIM_GATE_CLAIM_VERIFIED');
    expect(JSON.parse(verified?.detailJson ?? '{}')).toMatchObject({ ledgerRead: false });
  });
});
