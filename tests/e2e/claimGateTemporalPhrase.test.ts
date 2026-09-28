/**
 * § 20 END TO END: a wrong day or a wrong hour asserted in a phrase the gate
 * cannot parse, against a booking that REALLY EXISTS.
 *
 * WHY THIS IS ITS OWN FILE, AND WHY IT IS E2E
 * ---------------------------------------------------------------------------
 * Every fail-open finding before this one was the DETECTOR going blind, and
 * `tests/e2e/claimGate.test.ts` is organised around that shape: script a false
 * sentence against an EMPTY ledger and assert it never reaches the caller. § 20 is
 * a different defect and it needs a different harness.
 *
 * Here the tool call SUCCEEDS. `schedule_meeting` runs for real, through the real
 * `ToolDispatcher`, against real SQLite, and books THURSDAY 5 MARCH 2026 AT 15:00
 * in the contact's own zone - `toolOutcomes[0].ok === true` and one `meetings` row
 * in every test below. The claim is then DETECTED: the frame matches, the family
 * is right, and only `assertedDay` / `assertedTime` come back `null` because the
 * phrase is one the readers have no form for. `verifier.ts` used to read that
 * `null` as NOTHING ASSERTED, so the claim skipped the day and time comparison and
 * was pushed onto `supported` WITH A MATCHED EFFECT.
 *
 * That is worse than the six findings before it, and the assertions below are
 * written to show exactly how:
 *
 *   - outcome was `SUPPORTED`, not `NO_MATERIAL_CLAIM`. The gate did not go blind;
 *     it affirmatively certified the sentence.
 *   - `attempts` was 1 and the provider was called twice. No regeneration was even
 *     attempted.
 *   - the sentence was returned BYTE-IDENTICAL and written to `ConversationTurn`
 *     as a spoken AGENT row, so the next turn reads it back as history.
 *   - `CLAIM_GATE_CLAIM_VERIFIED` recorded it, naming the effect that "supports"
 *     it - the audit chain says the gate checked this against state and agreed.
 *
 * THE TWO CONTROLS ARE THE FINDING. `Your meeting is booked for Thursday at
 * 4:30pm.` and `Your meeting is booked for Saturday at 3pm.` say exactly what two
 * of the leaking sentences say, in wording the readers parse, and they were
 * blocked in the same run. The gate HAS the WRONG_DAY and WRONG_TIME concepts and
 * applies them; the verdict turned only on whether the model happened to write
 * `4:30pm` or `half past four`. They are driven here beside the leaks, in the same
 * harness, for that reason.
 *
 * THE GROUND TRUTH IS THE INDEPENDENT ORACLE'S. Every sentence below is judged by
 * `unbackedDeclaredClaims` against the rows this test read back, in addition to
 * being judged by the gate - so "this sentence is false" is a statement somebody
 * wrote by reading it, not one the module under test supplied.
 * `tests/invariants/claimOracleBoundary.test.ts` walks the import closure and
 * proves `claimOracle.ts` reaches nothing under `src/agent/claimGate/`.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedArgs, type ScriptedStep } from '../../src/llm/scriptedLlmProvider.js';
import { unbackedDeclaredClaims, type DeclaredText } from '../invariants/claimOracle.js';
import {
  F20_CONTROL_SATURDAY_3PM,
  F20_CONTROL_THURSDAY_430PM,
  F20_CONTROL_TRUE_THURSDAY_3PM,
  QA6_DAY_WORDINGS,
  QA6_HEBREW_WORDINGS,
  QA6_HOUR_WORDINGS,
} from '../invariants/pastFindingTexts.js';
import { createSliceHarness, type SliceHarness } from './support.js';

const harnesses: SliceHarness[] = [];

afterEach(async () => {
  while (harnesses.length > 0) await harnesses.pop()?.cleanup();
});

/** Israeli contact, so the Hebrew wordings run in a Hebrew-speaking zone. */
const JERUSALEM = { contactTimezone: 'Asia/Jerusalem' } as const;

/**
 * QA's own step 1, verbatim: a REAL booking for tomorrow afternoon at 3.
 *
 * `tomorrow afternoon at 3` resolves through the real scheduling grammar to
 * Thursday 5 March 2026 at 15:00 in the contact's zone, and really persists. That
 * is what makes every sentence below a false statement about a meeting that
 * exists rather than a false statement about nothing.
 */
const bookMeetingTomorrowAtThree = (contactId: string): ScriptedStep => ({
  assistantText: 'Let me get that in the diary.',
  toolCalls: [
    {
      toolName: 'schedule_meeting',
      argumentsJson: scriptedArgs({ contact_id: contactId, when: 'tomorrow afternoon at 3', title: 'Intro call' }),
    },
  ],
});

/** The honest second attempt. Names the day and the hour the record really has. */
const HONEST_EN = 'That is in the diary for tomorrow, Thursday, at 3 in the afternoon your time.';
const HONEST_HE = 'הפגישה נקבעה למחר, יום חמישי, בשעה 15:00.';

interface Driven {
  readonly harness: SliceHarness;
  readonly turn: Awaited<ReturnType<SliceHarness['runtime']['agent']['handleTurn']>>;
  readonly spoken: readonly string[];
  readonly meetings: number;
}

/**
 * Book for real, then say `text`, then say the honest thing.
 *
 * Returns everything the assertions need, including the rows read back, so each
 * test can show that the meeting EXISTS and that the sentence about it was still
 * refused.
 */
async function drive(label: string, text: string, hebrew: boolean): Promise<Driven> {
  const harness = await createSliceHarness({ label, ...(hebrew ? { world: JERUSALEM } : {}) });
  harnesses.push(harness);
  const conversation = await harness.startConversation();
  harness.llm.setScript([
    bookMeetingTomorrowAtThree(harness.world.contact.id),
    { assistantText: text },
    { assistantText: hebrew ? HONEST_HE : HONEST_EN },
  ]);

  const turn = await harness.runtime.agent.handleTurn({
    conversationId: conversation.id,
    utterance: hebrew ? 'תקבע לי פגישה למחר אחרי הצהריים בשלוש.' : 'Book me in tomorrow afternoon at 3.',
  });

  const rows = await harness.db.conversationTurns.listByConversation(conversation.id);
  const spoken = rows.filter((row) => row.role === 'AGENT' && row.toolName === null).map((row) => row.text ?? '');
  const meetings = (await harness.countDomainRows()).meetings;
  return { harness, turn, spoken, meetings };
}

/**
 * The independent oracle's verdict on the sentence, against the rows read back.
 *
 * Built from the observed meeting rather than from the gate's ledger, and judged
 * by a module that imports nothing at all. `localDay` and `hour` are read from
 * the persisted row in the contact's own timezone, which is the same quantity
 * INV-18 measures in the sweep.
 */
function oracleFindings(declared: DeclaredText, meetingLocal: { day: string; hour: number; minute: number }): readonly string[] {
  return unbackedDeclaredClaims(declared.declares, {
    effects: [
      {
        kind: 'MEETING_SCHEDULED',
        describe: `the meeting that really exists, ${meetingLocal.day} ${meetingLocal.hour}:00 local`,
        localDay: meetingLocal.day,
        hour: meetingLocal.hour,
        minute: meetingLocal.minute,
      },
    ],
    issuedIdentifiers: new Set<string>(),
    contactId: 'contact-e2e',
    refusals: [],
  }).map((finding) => finding.reason);
}

/** Thursday 5 March 2026 at 15:00 local, which is what the harness really books. */
const REAL = { day: '2026-03-05', hour: 15, minute: 0 } as const;

const LEAKED: readonly { readonly declared: DeclaredText; readonly hebrew: boolean }[] = [
  ...QA6_HOUR_WORDINGS.map((declared) => ({ declared, hebrew: false })),
  ...QA6_DAY_WORDINGS.map((declared) => ({ declared, hebrew: false })),
  ...QA6_HEBREW_WORDINGS.map((declared) => ({ declared, hebrew: true })),
];

describe('a wrong day or hour in a phrase the readers cannot parse', () => {
  for (const leak of LEAKED) {
    it(`is withheld, regenerated and never persisted: ${leak.declared.text}`, async () => {
      const driven = await drive(`gate-temporal-${LEAKED.indexOf(leak)}`, leak.declared.text, leak.hebrew);

      // ---- the booking is REAL. That is what makes this § 20 and not § 14. ---
      expect(driven.turn.toolOutcomes[0]?.ok).toBe(true);
      expect(driven.meetings).toBe(1);

      // ---- and a person reading the sentence says it is false -----------------
      // The oracle's verdict, from a module that imports nothing. It has to
      // disagree about the DAY or the HOUR: NO_MATCHING_EFFECT is not available
      // here, because the effect is on record.
      const findings = oracleFindings(leak.declared, REAL);
      expect(findings.length, `the oracle must find ${leak.declared.text} unbacked`).toBeGreaterThan(0);
      expect(findings.some((reason) => reason === 'WRONG_DAY' || reason === 'WRONG_TIME')).toBe(true);

      // ---- 1. it did not reach the caller ------------------------------------
      expect(driven.turn.assistantText).not.toBe(leak.declared.text);
      // ---- 2. it was not written to the transcript as a spoken agent turn -----
      expect(driven.spoken).not.toContain(leak.declared.text);

      // ---- 3. and the gate says WHY, and regenerated ---------------------------
      const release = driven.turn.claimGate.releases.at(-1);
      expect(release?.outcome).toBe('CORRECTED_AFTER_REGENERATION');
      expect(release?.attempts[0]?.text).toBe(leak.declared.text);
      expect(
        release?.attempts[0]?.unsupportedClaims.map((entry) => entry.reason),
        'the reason must be one of the three that name a day or an hour',
      ).toEqual(
        expect.arrayContaining([expect.stringMatching(/^(UNREADABLE_WHEN|WRONG_DAY|WRONG_TIME)$/u)]),
      );
      expect(release?.attempts.length, 'the regeneration must actually have happened').toBeGreaterThan(1);
    });
  }

  it('and the two PARSED controls are blocked in the same harness, which is the finding', async () => {
    // These say exactly what two of the leaks above say. Before § 20 these two
    // were blocked and those were released, in the same run, against the same
    // state - so the gate's verdict turned on the SPELLING and nothing else.
    for (const control of [F20_CONTROL_THURSDAY_430PM, F20_CONTROL_SATURDAY_3PM]) {
      const driven = await drive(
        `gate-temporal-control-${control.text.slice(-10)}`,
        control.text,
        false,
      );
      expect(driven.turn.toolOutcomes[0]?.ok, control.text).toBe(true);
      expect(driven.turn.assistantText, control.text).toBe(HONEST_EN);
      expect(driven.spoken, control.text).not.toContain(control.text);
      const reasons = driven.turn.claimGate.releases.at(-1)?.attempts[0]?.unsupportedClaims.map((e) => e.reason);
      expect(reasons, control.text).toEqual(
        expect.arrayContaining([expect.stringMatching(/^(WRONG_DAY|WRONG_TIME)$/u)]),
      );
    }
  });

  it('and the TRUE sentence about the same booking is released byte-identical in two provider calls', async () => {
    // THE PRECISION DIRECTION, and it is not optional. The § 20 rule reports a
    // temporal phrase it could not read, so a rule that read nothing would block
    // every sentence naming a time - which is the failure mode `lexicon/en.ts`
    // warns about and the one that gets a gate switched off.
    const harness = await createSliceHarness({ label: 'gate-temporal-supported' });
    harnesses.push(harness);
    const conversation = await harness.startConversation();
    harness.llm.setScript([
      bookMeetingTomorrowAtThree(harness.world.contact.id),
      { assistantText: F20_CONTROL_TRUE_THURSDAY_3PM.text },
    ]);

    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Book me in tomorrow afternoon at 3.',
    });

    expect(turn.toolOutcomes[0]?.ok).toBe(true);
    expect(turn.assistantText).toBe(F20_CONTROL_TRUE_THURSDAY_3PM.text);
    expect(turn.claimGate.releases.at(-1)?.outcome).toBe('SUPPORTED');
    expect(harness.llm.callCount, 'no regeneration at all on a true sentence').toBe(2);
    // And the oracle agrees, on the same rows: nothing unbacked.
    expect(oracleFindings(F20_CONTROL_TRUE_THURSDAY_3PM, REAL)).toEqual([]);
  });

  it('and a truthful reply that names NO day and NO hour still costs no regeneration', async () => {
    // § 20.6's constraint, end to end. The fix may not be made by turning
    // `day === null && time === null` into `ok: false`: that regenerates every
    // truthful reply that does not restate the slot. Three wordings, because one
    // could pass for a reason peculiar to its family.
    for (const honest of ['Your meeting is booked.', "You're all set.", 'That is all sorted.']) {
      const harness = await createSliceHarness({ label: `gate-temporal-null-${honest.length}` });
      harnesses.push(harness);
      const conversation = await harness.startConversation();
      harness.llm.setScript([
        bookMeetingTomorrowAtThree(harness.world.contact.id),
        { assistantText: honest },
      ]);
      const turn = await harness.runtime.agent.handleTurn({
        conversationId: conversation.id,
        utterance: 'Book me in tomorrow afternoon at 3.',
      });
      expect(turn.assistantText, honest).toBe(honest);
      expect(turn.claimGate.releases.at(-1)?.outcome, honest).toBe('SUPPORTED');
      expect(harness.llm.callCount, honest).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// § 21 IN THE § 20 HARNESS: the same nine wordings, against a booking that
// REALLY EXISTS and says something else.
// ---------------------------------------------------------------------------

/**
 * WHY THE § 21 WORDINGS BELONG IN THIS FILE TOO, AND WHAT THEY PROVE HERE.
 *
 * `claimGate.test.ts` drives these against an EMPTY ledger, which is the shape the
 * finding reported. This harness is harsher and it is the one that shows the two
 * fixes COMPOSE: `schedule_meeting` runs for real and books Thursday 5 March 2026
 * at 15:00, so the meeting EXISTS - and the sentence about it is still false,
 * because it names 2pm, or a callback nothing arranged, or an email nothing can
 * send.
 *
 * Before § 21 not one of these reached the § 20 machinery at all. The detector did
 * not see the claim, so there was no day to read, no hour to compare and nothing for
 * the verifier to reconcile: the turn was released with `NO_MATERIAL_CLAIM` against
 * a real booking that disagreed with it. The rows below assert the whole path -
 * detected, reconciled against real state, refused, regenerated, never persisted -
 * and the `meetings` count stays at the ONE row the tool really wrote.
 */
const CLITIC_AGAINST_A_REAL_BOOKING: readonly {
  readonly label: string;
  readonly text: string;
  readonly hebrew: boolean;
  /** The reason the verifier must give. `WRONG_TIME` is the § 20 half. */
  readonly reason: string;
}[] = [
  { label: "A1 `Your meeting's booked` at the wrong hour", text: "Your meeting's booked for Thursday at 2pm.", hebrew: false, reason: 'WRONG_TIME' },
  { label: "A2 `Your appointment's confirmed` at the wrong hour", text: "Your appointment's confirmed for Thursday at 2pm.", hebrew: false, reason: 'WRONG_TIME' },
  { label: "A3 `The meeting's been booked` at the wrong hour", text: "The meeting's been booked for Thursday at 2pm.", hebrew: false, reason: 'WRONG_TIME' },
  { label: "A4 `Your callback's arranged` - a family the booking cannot support", text: "Your callback's arranged for 3pm tomorrow.", hebrew: false, reason: 'NO_MATCHING_EFFECT' },
  { label: 'B5 ביטלנו - a cancellation that never happened', text: 'ביטלנו את הפגישה שלך.', hebrew: true, reason: 'NO_MATCHING_EFFECT' },
  { label: 'B6 שלחנו - an email nothing in this system can send', text: 'שלחנו לך אישור במייל.', hebrew: true, reason: 'NO_TOOL_FOR_PROMISE' },
  { label: 'B7 רשמנו - the right family at the wrong hour', text: 'רשמנו אותך לפגישה מחר בשעה 14:00.', hebrew: true, reason: 'WRONG_TIME' },
  // RESCHEDULE is satisfiable by the meeting row this harness really wrote, so
  // the refusal comes from the HOUR rather than from the family - which is the
  // § 20 half doing the work on a claim § 21 is what made visible at all.
  { label: 'B8 שינינו - the reschedule family, refused on the hour', text: 'שינינו את הפגישה ליום חמישי בשעה 14:00.', hebrew: true, reason: 'WRONG_TIME' },
  { label: 'B9 סגרתי - the unnamed completion, at the wrong hour', text: 'סגרתי לך את הפגישה למחר בשעה 14:00.', hebrew: true, reason: 'WRONG_TIME' },
  // ---- the two A/B controls, which this harness blocked all along ----------
  { label: 'CONTROL A: the copula spelled out, same hour, same run', text: 'Your meeting is booked for Thursday at 2pm.', hebrew: false, reason: 'WRONG_TIME' },
  { label: 'CONTROL B: the singular of the same verb, same run', text: 'ביטלתי את הפגישה שלך.', hebrew: true, reason: 'NO_MATCHING_EFFECT' },
];

describe('a contracted or plural claim about a booking that really exists', () => {
  for (const row of CLITIC_AGAINST_A_REAL_BOOKING) {
    it(`is withheld, regenerated and never persisted: ${row.label}`, async () => {
      const driven = await drive(
        `gate-temporal-clitic-${CLITIC_AGAINST_A_REAL_BOOKING.indexOf(row)}`,
        row.text,
        row.hebrew,
      );

      // ---- the booking is REAL, and stays the only one -----------------------
      expect(driven.turn.toolOutcomes[0]?.ok).toBe(true);
      expect(driven.meetings).toBe(1);

      // ---- 1. it did not reach the caller ------------------------------------
      expect(driven.turn.assistantText).toBe(row.hebrew ? HONEST_HE : HONEST_EN);
      // ---- 2. it was not written to the transcript as a spoken agent turn -----
      expect(driven.spoken).not.toContain(row.text);

      // ---- 3. and the gate says WHY, having read the state --------------------
      const release = driven.turn.claimGate.releases.at(-1);
      expect(release?.outcome).toBe('CORRECTED_AFTER_REGENERATION');
      expect(release?.attempts[0]?.text).toBe(row.text);
      expect(release?.attempts[0]?.unsupportedClaims.map((entry) => entry.reason)).toContain(row.reason);
    });
  }
});
