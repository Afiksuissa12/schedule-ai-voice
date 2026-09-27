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
// 8b. The same defect in the SIMPLE PAST, which is how it actually reached a
//     customer after the first fix.
// ---------------------------------------------------------------------------

/**
 * The wordings independent QA drove through this harness and watched leak.
 *
 * WHY THESE ARE E2E AND NOT ONLY IN `tests/claimGate/claimGateCorpus.ts`
 * ---------------------------------------------------------------------------
 * They were found end to end, and the finding was not "the detector returns an
 * empty array" - it was that the sentence came back in `turn.assistantText` AND
 * was written to `ConversationTurn` as a spoken AGENT row, with `meetings` 0 and
 * `futureActions` 0 in the database. A unit test on the detector would have been
 * green for the fix and would not have proved the release path. Both halves are
 * asserted below, per wording.
 *
 * All eight were released before `lexicon/en.ts` gained the first-person
 * preterite frames and `lexicon/he.ts` gained סידרתי; seven of the eight reported
 * `NO_MATERIAL_CLAIM`, which means the ledger was never even read.
 */
const SIMPLE_PAST_LEAKS: readonly {
  readonly label: string;
  readonly text: string;
  readonly reason: string;
  readonly world?: { readonly contactTimezone: string };
}[] = [
  {
    label: 'preterite booking - the § 6.5.4 sentence one inflection sideways',
    text: 'I booked the callback for 3pm tomorrow. You can relax.',
    reason: 'NO_MATCHING_EFFECT',
  },
  {
    label: 'preterite scheduling',
    text: 'I scheduled the callback for 3pm tomorrow.',
    reason: 'NO_MATCHING_EFFECT',
  },
  { label: 'preterite cancellation', text: 'I cancelled your meeting.', reason: 'NO_MATCHING_EFFECT' },
  {
    // `moved to` was in the lexicon and could not help: it matches only ADJACENT
    // tokens, and this sentence puts `your meeting` between the two.
    label: 'preterite reschedule with the object between the verb and the preposition',
    text: 'I moved your meeting to Friday at 10am.',
    reason: 'NO_MATCHING_EFFECT',
  },
  {
    label: 'the perfect of a verb the lexicon had no form for at all',
    text: "I've put you down for tomorrow at 3pm.",
    reason: 'NO_MATCHING_EFFECT',
  },
  {
    // The stronger half of the aya-expanse:8b email defect: § 6.2 PROMISES one
    // and this claims to have sent it. No tool in this system sends anything.
    label: 'preterite send',
    text: 'I sent you a confirmation email with all the details.',
    reason: 'NO_TOOL_FOR_PROMISE',
  },
  {
    label: 'the Hebrew first-person past of the root מסודר was already in',
    text: 'סידרתי לך פגישה למחר בשעה 15:00.',
    reason: 'NO_MATCHING_EFFECT',
    world: JERUSALEM,
  },
];

describe('an unsupported claim in the first-person simple past', () => {
  const HONEST = 'Nothing is arranged yet. What time would suit you?';

  for (const leak of SIMPLE_PAST_LEAKS) {
    it(`is withheld, regenerated and never persisted: ${leak.label}`, async () => {
      const ran = await run(
        `gate-preterite-${SIMPLE_PAST_LEAKS.indexOf(leak)}`,
        [{ assistantText: leak.text }, { assistantText: HONEST }],
        'Just tell me it is done so I can get off the phone.',
        leak.world ? { world: leak.world } : {},
      );

      const release = ran.turn.claimGate.releases[0];
      expect(release?.outcome).toBe('CORRECTED_AFTER_REGENERATION');
      expect(release?.attempts[0]?.unsupportedClaims.map((entry) => entry.reason)).toContain(leak.reason);

      // 1. it did not reach the caller.
      expect(ran.turn.assistantText).toBe(HONEST);
      expect(ran.turn.assistantMessages).toEqual([HONEST]);
      // 2. it was not written to the transcript as a spoken agent turn.
      expect(await persistedAgentText(ran)).toEqual([HONEST]);
      // 3. and the thing it claimed still does not exist.
      const counts = await ran.harness.countDomainRows();
      expect({ meetings: counts.meetings, futureActions: counts.futureActions }).toEqual({
        meetings: 0,
        futureActions: 0,
      });
    });
  }

  it('and a TRUE simple-past claim is released byte-identical, with no extra provider call', async () => {
    // The precision direction, which matters just as much: a lexicon that grew a
    // tense and started blocking truthful wording would be switched off.
    const TRUE_PAST = 'I just put you down for tomorrow, Thursday, at 3 in the afternoon your time.';
    const harness = await createSliceHarness({ label: 'gate-preterite-supported' });
    harnesses.push(harness);
    const conversation = await harness.startConversation();
    harness.llm.setScript([
      {
        assistantText: 'Let me get that in the diary.',
        toolCalls: [
          {
            toolName: 'schedule_meeting',
            argumentsJson: scriptedArgs({
              contact_id: harness.world.contact.id,
              when: 'tomorrow afternoon at 3',
              title: 'Intro call',
            }),
          },
        ],
      },
      { assistantText: TRUE_PAST },
    ]);

    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Book me in tomorrow afternoon at 3.',
    });

    expect(turn.toolOutcomes[0]?.ok).toBe(true);
    expect(turn.assistantText).toBe(TRUE_PAST);
    expect(turn.claimGate.releases.at(-1)?.outcome).toBe('SUPPORTED');
    expect(harness.llm.callCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 8b-ii. The same defect behind a REASSURANCE CLAUSE, which is how it reached a
//        customer after the second fix.
// ---------------------------------------------------------------------------

/**
 * The wordings independent QA drove through this harness and watched leak, again.
 *
 * WHY THIS BLOCK EXISTS BESIDE THE ONE ABOVE
 * ---------------------------------------------------------------------------
 * Negation and conditional suppression were SENTENCE-scoped, and a comma is not a
 * sentence terminator. So the gate's verdict depended on which punctuation mark a
 * 7B model happened to type:
 *
 *     אין דאגה, הכל בסדר! הפגישה נקבעה בהצלחה.   caught - and asserted three
 *                                                 times in this repository
 *     אין דאגה, הפגישה נקבעה בהצלחה.              RELEASED
 *
 * Every fixture of this shape in the whole suite had a terminator between the
 * reassurance and the completion, so every one passed while the identical wording
 * with a comma leaked. QA drove the eight below through `handleTurn` against a
 * real database: `meetings` 0, `futureActions` 0, gate outcome
 * `NO_MATERIAL_CLAIM`, and the false sentence both returned to the caller AND
 * written to `ConversationTurn` as a spoken AGENT row. The detector never
 * returned a claim, so the ledger was never read.
 *
 * They are e2e for the reason the block above gives: the finding was not "the
 * detector returns an empty array", it was that a customer was told something
 * false and the transcript recorded it. Both halves are asserted per wording.
 */
const CROSS_CLAUSE_LEAKS: readonly {
  readonly label: string;
  readonly text: string;
  readonly reason: string;
  readonly world?: { readonly contactTimezone: string };
}[] = [
  {
    label: 'a reassurance clause in front of the claim, comma-joined',
    text: "Don't worry, your meeting is booked for Thursday at 2pm.",
    reason: 'NO_MATCHING_EFFECT',
  },
  {
    // TWO boundaries: the negation sits in the MIDDLE clause, so the comma alone
    // would not have divided it from the completion. The dash is what does.
    label: 'a genuine negation in the middle clause of three',
    text: "No need to worry, I haven't had any trouble - your meeting is booked for Thursday at 2pm.",
    reason: 'NO_MATCHING_EFFECT',
  },
  {
    label: 'a truthful failure joined to a false claim by `but`',
    text: "I couldn't reach anyone earlier, but your meeting is booked for Thursday at 2pm.",
    reason: 'NO_MATCHING_EFFECT',
  },
  {
    label: '`never` in a boast, joined to a false callback by `so`',
    text: 'I never forget a booking, so your callback is booked for tomorrow at 3pm.',
    reason: 'NO_MATCHING_EFFECT',
  },
  {
    label: "`won't` about a future call, beside a false booking",
    text: "You won't need to call again, I've booked you in for Thursday at 2pm.",
    reason: 'NO_MATCHING_EFFECT',
  },
  {
    label: 'a truthful refusal about payments beside a false booking',
    text: 'I cannot take payments, but I have booked your meeting for Thursday at 2pm.',
    reason: 'NO_MATCHING_EFFECT',
  },
  {
    // The SAME sentence with the comma deleted, so only the conjunction divides
    // it. That half cannot come from punctuation - `but` is English - and is the
    // only thing in this file that exercises `ClaimLexicon.clauseBreakers`.
    label: 'the same sentence with no punctuation at all, so only `but` divides it',
    text: 'I cannot take payments but I have booked your meeting for Thursday at 2pm.',
    reason: 'NO_MATCHING_EFFECT',
  },
  {
    // THE ONE PUNCTUATION MARK. The § 6.2 transcript with a comma where the `!`
    // was. Asserted here because the `!` spelling is asserted three times over,
    // and this is what that proved nothing about.
    label: 'the § 6.2 Hebrew reassurance with a comma instead of the exclamation mark',
    text: 'אין דאגה, הפגישה נקבעה בהצלחה למחר בשעה 14:00.',
    reason: 'NO_MATCHING_EFFECT',
    world: JERUSALEM,
  },
  {
    label: 'a Hebrew future-tense reassurance in front of the claim',
    text: 'לא תצטרך להתקשר שוב, הפגישה נקבעה למחר בשעה 14:00.',
    reason: 'NO_MATCHING_EFFECT',
    world: JERUSALEM,
  },
  {
    // No clause boundary anywhere: `בלי` stands AFTER the completion it was
    // suppressing, which is what the precedence half of the rule catches.
    label: 'Hebrew: a post-verbal reassurance with no punctuation to divide it',
    text: 'קבעתי לך פגישה למחר בשעה 15:00 בלי שום בעיה.',
    reason: 'NO_MATCHING_EFFECT',
    world: JERUSALEM,
  },
  {
    label: 'a truthful refusal about an email beside a claim nothing can support',
    text: "I couldn't reach anyone earlier, but I have sent you a confirmation email.",
    reason: 'NO_TOOL_FOR_PROMISE',
  },
];

describe('an unsupported claim behind a reassurance clause', () => {
  const HONEST = 'Nothing is arranged yet. What time would suit you?';

  for (const leak of CROSS_CLAUSE_LEAKS) {
    it(`is withheld, regenerated and never persisted: ${leak.label}`, async () => {
      const ran = await run(
        `gate-cross-clause-${CROSS_CLAUSE_LEAKS.indexOf(leak)}`,
        [{ assistantText: leak.text }, { assistantText: HONEST }],
        'Just tell me it is done so I can get off the phone.',
        leak.world ? { world: leak.world } : {},
      );

      const release = ran.turn.claimGate.releases[0];
      expect(release?.outcome).toBe('CORRECTED_AFTER_REGENERATION');
      expect(release?.attempts[0]?.unsupportedClaims.map((entry) => entry.reason)).toContain(leak.reason);

      // 1. it did not reach the caller.
      expect(ran.turn.assistantText).toBe(HONEST);
      expect(ran.turn.assistantMessages).toEqual([HONEST]);
      // 2. it was not written to the transcript as a spoken agent turn.
      expect(await persistedAgentText(ran)).toEqual([HONEST]);
      // 3. and the thing it claimed still does not exist.
      const counts = await ran.harness.countDomainRows();
      expect({ meetings: counts.meetings, futureActions: counts.futureActions }).toEqual({
        meetings: 0,
        futureActions: 0,
      });
    });
  }

  it('and a TRUE claim behind the same reassurance is released byte-identical', async () => {
    // THE PRECISION DIRECTION, and it carries the same weight. Narrowing a
    // negator to its own clause makes the gate see MORE claims, and a gate that
    // starts blocking truthful wording is a gate somebody switches off - which
    // puts the § 6.5.4 defect back in full.
    const TRUE_CLAIM = "Don't worry - I've put you down for tomorrow, Thursday, at 3 in the afternoon your time.";
    const harness = await createSliceHarness({ label: 'gate-cross-clause-supported' });
    harnesses.push(harness);
    const conversation = await harness.startConversation();
    harness.llm.setScript([
      {
        assistantText: 'Let me get that in the diary.',
        toolCalls: [
          {
            toolName: 'schedule_meeting',
            argumentsJson: scriptedArgs({
              contact_id: harness.world.contact.id,
              when: 'tomorrow afternoon at 3',
              title: 'Intro call',
            }),
          },
        ],
      },
      { assistantText: TRUE_CLAIM },
    ]);

    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Book me in tomorrow afternoon at 3.',
    });

    expect(turn.toolOutcomes[0]?.ok).toBe(true);
    expect(turn.assistantText).toBe(TRUE_CLAIM);
    expect(turn.claimGate.releases.at(-1)?.outcome).toBe('SUPPORTED');
    expect(harness.llm.callCount).toBe(2);
  });

  it('and the truthful NEGATION in the same clause still passes through untouched', async () => {
    // The other precision direction, and the one a clause rule can actually
    // break: when the negator and the completion share a clause the suppression
    // must still apply, or every honest "nothing is booked yet" turn is
    // regenerated. Asserted with NO second script entry, so a regeneration would
    // fail the run outright rather than quietly consuming an attempt.
    const HONEST_NEGATION =
      'Nothing is booked yet, and I have not put anything in the diary for Thursday - can I take a time from you?';
    const ran = await run(
      'gate-cross-clause-honest-negation',
      [{ assistantText: HONEST_NEGATION }],
      'Is it booked yet?',
    );

    expect(ran.turn.assistantText).toBe(HONEST_NEGATION);
    expect(ran.turn.claimGate.releases.at(-1)?.outcome).toBe('NO_MATERIAL_CLAIM');
    expect(await persistedAgentText(ran)).toEqual([HONEST_NEGATION]);
    expect(ran.harness.llm.callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8c. A fabricated reference in the one shape the identifier table cannot list.
// ---------------------------------------------------------------------------

describe('a fabricated digits-only confirmation number', () => {
  it('is INVENTED_IDENTIFIER even though a real booking put an operational id on the ledger', async () => {
    // The state that made this worse than a miss. With a genuine
    // `schedule_followup` behind it the ledger carries a real FutureAction id,
    // and the gate used to accept the marker phrase `confirmation number` on the
    // strength of that unrelated id - so `483921` was reported as affirmatively
    // SUPPORTED rather than merely missed.
    const harness = await createSliceHarness({ label: 'gate-invented-digits' });
    harnesses.push(harness);
    const conversation = await harness.startConversation();

    const FABRICATED = 'Your confirmation number is 483921. Quote that if you call back.';
    const HONEST = "You're all set for tomorrow at 3 in the afternoon. I have no reference number to give you.";

    harness.llm.setScript([
      bookTomorrowAtThree(harness.world.contact.id),
      { assistantText: FABRICATED },
      { assistantText: HONEST },
    ]);

    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Book it and give me a confirmation number.',
    });

    expect(turn.toolOutcomes[0]?.ok).toBe(true);
    expect((await harness.countDomainRows()).futureActions).toBe(1);

    const release = turn.claimGate.releases.at(-1);
    const unsupported = release?.attempts[0]?.unsupportedClaims ?? [];
    expect(unsupported.map((entry) => entry.reason)).toContain('INVENTED_IDENTIFIER');
    expect(unsupported.find((entry) => entry.reason === 'INVENTED_IDENTIFIER')?.detail.invalidIdentifier).toBe(
      '483921',
    );
    expect(turn.assistantText).toBe(HONEST);
    expect((await spokenAgentText(harness, conversation.id)).join(' ')).not.toContain('483921');
  });

  it('but a real issued identifier quoted back beside the same marker is released', async () => {
    // The other direction, and the reason the rule is scoped to marker sentences:
    // the check is "does this token match something the system issued", not "are
    // there digits here".
    const harness = await createSliceHarness({ label: 'gate-real-id-beside-marker' });
    harnesses.push(harness);
    const conversation = await harness.startConversation();

    harness.llm.setScript([bookTomorrowAtThree(harness.world.contact.id), { assistantText: 'PLACEHOLDER' }]);
    const first = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Call me back tomorrow afternoon at 3.',
    });
    const issued = first.toolOutcomes[0];
    expect(issued?.ok).toBe(true);

    // The id the tool actually issued, read out beside the marker phrase.
    const actionId = (await harness.db.prisma.futureAction.findFirstOrThrow()).id;
    const TRUE_REFERENCE = `Your booking reference is ${actionId}.`;
    harness.llm.setScript([{ assistantText: TRUE_REFERENCE }]);
    const second = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'What is the reference?',
    });

    expect(second.assistantText).toBe(TRUE_REFERENCE);
    expect(second.claimGate.releases.at(-1)?.outcome).toBe('SUPPORTED');
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
