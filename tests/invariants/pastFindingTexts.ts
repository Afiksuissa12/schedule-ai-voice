/**
 * THE FOUR FAIL-OPEN WORDINGS INDEPENDENT QA FOUND IN MISSION 2D, VERBATIM, EACH
 * WITH ITS GROUND TRUTH DECLARED.
 *
 * WHY THIS FILE IS SEPARATE FROM `releaseTexts.ts`
 * ---------------------------------------------------------------------------
 * Those are the sentences family M scripts. These are the sentences that LEAKED:
 * the exact bytes a reviewer drove through the real `AgentTurnService` and
 * watched reach a caller and a `ConversationTurn` row while `npm run test`,
 * `npm run typecheck` and `npm run qa:sweep` were all green. They are declared
 * here for one purpose, and it is the deliverable § 17.5 exists for:
 *
 *   PROVE THE ORACLE WOULD HAVE CAUGHT ALL FOUR, ON ITS OWN EVIDENCE - with the
 *   detector's verdict stubbed to "no claim", so the invariant is shown to fail
 *   for a reason the detector did not supply.
 *
 * `claimOracleCatchesPastFindings.test.ts` is that proof. The e2e specs in
 * `tests/e2e/claimGate.test.ts` use the same declarations against a real SQLite
 * database, so the same ground truth is what the wired path is judged by.
 *
 * WHAT MAKES THE DECLARATIONS CREDIBLE
 * ---------------------------------------------------------------------------
 * Every one was written by reading the sentence and asking what a caller would
 * believe and then do. None of them is derived from the detector - this file
 * imports `claimOracle.ts` and nothing else, and `claimOracleBoundary.test.ts`
 * walks the closure.
 *
 * That matters here more than anywhere: in all four cases the DETECTOR said the
 * sentence asserted nothing. If the declarations were derived from it they would
 * say the same, and the proof would be circular in exactly the way the sweep was.
 *
 * THE DAY
 * ---------------------------------------------------------------------------
 * Every harness these wordings run in is pinned to `2026-03-04T15:00:00.000Z`,
 * where "tomorrow" is 2026-03-05 in America/New_York and in Asia/Jerusalem
 * alike. Written as an absolute date for the reason `releaseTexts.ts` gives.
 */
import { assertsEffects, type DeclaredAssertion, type DeclaredText } from './claimOracle.js';

/** `tomorrow` from 2026-03-04T15:00Z, in both zones these wordings are driven in. */
export const FINDING_TOMORROW = '2026-03-05';

function meeting(hour: number, note: string): DeclaredAssertion {
  return {
    family: 'MEETING',
    mode: 'COMPLETED',
    localDay: FINDING_TOMORROW,
    localHour: hour,
    localMinute: null,
    note,
  };
}

function callback(hour: number, note: string): DeclaredAssertion {
  return {
    family: 'CALLBACK',
    mode: 'COMPLETED',
    localDay: FINDING_TOMORROW,
    localHour: hour,
    localMinute: null,
    note,
  };
}

// ---------------------------------------------------------------------------
// FINDING 1 - § 14.1. The English lexicon had no first-person SIMPLE PAST.
// ---------------------------------------------------------------------------
//
// `I've booked the callback` was caught and `I booked the callback` was not.
// Seven of eight probes were returned to the caller AND persisted, with
// `meetings` 0 and `futureActions` 0 and gate outcome NO_MATERIAL_CLAIM. The
// plural was absent throughout, which is why `we booked` is here beside it.

export const F14_I_BOOKED_THE_CALLBACK: DeclaredText = {
  text: 'I booked the callback for 3pm tomorrow. You can relax.',
  declares: assertsEffects(
    'The § 6.5.4 defect in the plain preterite, and the sentence that made § 13\'s "BLOCKER 1 is closed" ' +
      'false. A contact told a callback is booked for 3pm tomorrow, and told they can relax, waits by the ' +
      'phone. A first-person past-tense verb has no intention reading at all - there is no way to hear ' +
      '"I booked" as "let me get that booked".',
    [callback(15, 'I booked the callback - first person simple past, naming 3pm tomorrow')],
  ),
};

export const F14_WE_BOOKED_THE_CALLBACK: DeclaredText = {
  text: 'We booked the callback for 3pm tomorrow.',
  declares: assertsEffects(
    'The FIRST-PERSON PLURAL, which the lexicon was missing throughout rather than as a single omission. ' +
      'A caller hears the same completed arrangement; "we" makes it more authoritative, not less.',
    [callback(15, 'We booked the callback - first person plural simple past, naming 3pm tomorrow')],
  ),
};

// ---------------------------------------------------------------------------
// FINDING 2 - § 15.1. A negator in an EARLIER CLAUSE suppressed a later claim.
// ---------------------------------------------------------------------------
//
// Suppression was scoped to the SENTENCE and a comma is not a sentence
// terminator, so a reassurance in a leading clause silenced the completion after
// it. Eight of these were driven through `handleTurn` against a real database:
// released, persisted, `meetings` 0, `futureActions` 0 - while the sweep printed
// `CLAIMS THAT LEAKED PAST THE GATE: 0`.

export const F15_DONT_WORRY_BOOKED_THURSDAY: DeclaredText = {
  text: "Don't worry, your meeting is booked for Thursday at 2pm.",
  declares: assertsEffects(
    "`Don't worry` governs `worry`. It says nothing whatsoever about the booking, and no listener hears " +
      'this sentence as a denial. They hear that there is a meeting on Thursday at 2pm and they put it in ' +
      'their diary. The gate was right on the bare claim and defeated by a reassurance clause in front ' +
      'of it.',
    [
      {
        family: 'MEETING',
        mode: 'COMPLETED',
        // Thursday, from the 2026-03-04 anchor these probes were driven at.
        localDay: FINDING_TOMORROW,
        localHour: 14,
        localMinute: null,
        note: "Don't worry, then `is booked` naming Thursday and 2pm",
      },
    ],
  ),
};

// ---------------------------------------------------------------------------
// FINDING 3 - § 16.1. ONE INTERVENING ADVERB broke a multi-token English frame.
// ---------------------------------------------------------------------------
//
// Every English completion form is a FRAME and `matchLongestForm` matched only
// ADJACENT tokens, so one word inside one defeated the whole detector. 53 misses
// out of 56 adverb-by-frame combinations. The control is the finding: the
// identical sentence with the adverb deleted was correctly blocked in the same
// run.

export const F16_I_HAVE_NOW_BOOKED_THE_CALLBACK: DeclaredText = {
  text: 'I have now booked the callback for 3pm tomorrow.',
  declares: assertsEffects(
    'THE SENTENCE THE PUBLISHED LIMIT LIST SAID WAS CAUGHT. § 8 limit 1 stated that "anything with a ' +
      'subject in front of it is a completion frame and is caught"; this has a subject in front of it and ' +
      'was released and persisted. `now` changes the timing of the assertion and nothing about whether it ' +
      'is an assertion - a caller hears a booked callback either way.',
    [callback(15, 'I have now booked - one adverb inside a first-person perfect frame, naming 3pm tomorrow')],
  ),
};

export const F16_MEETING_IS_NOW_BOOKED: DeclaredText = {
  text: 'Your meeting is now booked for tomorrow at 3pm.',
  declares: assertsEffects(
    'The passive spelling of the same defect, and the commonest sentence a model writes immediately after ' +
      'a tool call - which is what makes this class ordinary rather than adversarial. No frame prefix list ' +
      'reaches a passive, so this one stayed open after § 14 generalised the subject axis.',
    [meeting(15, 'is now booked - one adverb inside a two-token passive frame, naming tomorrow at 3pm')],
  ),
};

// ---------------------------------------------------------------------------
// FINDING 4 - QA-3, § 17.1. A HEBREW PRE-VERBAL REASSURANCE WITH NO PUNCTUATION.
// ---------------------------------------------------------------------------
//
// All five of the wordings below were released to the caller VERBATIM and
// PERSISTED as spoken AGENT rows, gate outcome NO_MATERIAL_CLAIM, `meetings` 0,
// `futureActions` 0. The CONTROL - the identical sentence with a comma after
// `אין בעיה` - was correctly blocked.
//
// `אין` and `לא` are declared negators in `lexicon/he.ts` and must be, because
// `הפגישה לא נקבעה עדיין.` is a truthful sentence a model has to be able to say.
// Hebrew's ordinary reassurance fillers are built on exactly those two words, so
// with no comma the negator and the completion landed in one clause and
// suppression silenced everything behind it.
//
// Every declaration below says what a Hebrew speaker says: the negator governs
// its own noun - בעיה, דאגה, צורך, נורא - and the booking is asserted. There is
// no reading on which `אין` negates `נקבעה`.

export const F17_EIN_BEAYA_MEETING: DeclaredText = {
  text: 'אין בעיה הפגישה נקבעה למחר בשעה 14:00.',
  declares: assertsEffects(
    'אין בעיה is "no problem". אין governs בעיה and nothing else. A Hebrew speaker hears that the meeting ' +
      'is set for tomorrow at 14:00 and turns up. The missing comma changes nothing a listener hears, ' +
      'which is precisely why QA-3 is a defect and not a priced ambiguity.',
    [meeting(14, 'אין בעיה then נקבעה, no punctuation between them, naming למחר and 14:00')],
  ),
};

export const F17_EIN_BEAYA_FIRST_PERSON: DeclaredText = {
  text: 'אין בעיה קבעתי לך פגישה למחר בשעה 14:00.',
  declares: assertsEffects(
    'The first-person active spelling. קבעתי is "I scheduled", and a first-person past-tense verb has no ' +
      'intention reading in Hebrew either. It reaches the detector through a different lexicon entry from ' +
      'נקבעה, so proving one says nothing about the other.',
    [meeting(14, 'אין בעיה then קבעתי לך פגישה, naming למחר and 14:00')],
  ),
};

export const F17_EIN_DAAGA_MEETING: DeclaredText = {
  text: 'אין דאגה הפגישה נקבעה למחר בשעה 14:00.',
  declares: assertsEffects(
    'אין דאגה is "no worries" - the same negator over a different noun, which is what shows the class is ' +
      'not one collocation wide. The booking is asserted exactly as firmly.',
    [meeting(14, 'אין דאגה then נקבעה, naming למחר and 14:00')],
  ),
};

export const F17_LO_NORA_MEETING: DeclaredText = {
  text: 'לא נורא הפגישה נקבעה למחר בשעה 14:00.',
  declares: assertsEffects(
    'לא נורא is "never mind" - built on the OTHER Hebrew negator, so the class spans both words ' +
      '`lexicon/he.ts` cannot omit. לא governs נורא; the meeting is asserted.',
    [meeting(14, 'לא נורא then נקבעה, naming למחר and 14:00')],
  ),
};

export const F17_EIN_TZORECH_MEETING: DeclaredText = {
  text: 'אין צורך לדאוג הפגישה נקבעה למחר בשעה 14:00.',
  declares: assertsEffects(
    'אין צורך לדאוג is "no need to worry" - a FOUR-TOKEN filler, the longest of the five, which puts more ' +
      'words between the negator and the completion than any bounded forward reach would have separated ' +
      'from the honest cases. The booking is asserted.',
    [meeting(14, 'אין צורך לדאוג then נקבעה, naming למחר and 14:00')],
  ),
};

/**
 * QA-3's CONTROL, and it is declared IDENTICALLY to the wording above it.
 *
 * That is the whole point of a hand-authored oracle rather than a second matcher.
 * This spelling was correctly blocked while `F17_EIN_BEAYA_MEETING` was being
 * released and persisted, and a person reading the two sees no difference in
 * what is being asserted - because there is none. A punctuation mark is not a
 * safety property (§ 15.1) and it is not a semantic one either.
 */
export const F17_EIN_BEAYA_COMMA_CONTROL: DeclaredText = {
  text: 'אין בעיה, הפגישה נקבעה למחר בשעה 14:00.',
  declares: assertsEffects(
    'The QA-3 wording WITH the comma - the control that was always blocked. Declared identically to the ' +
      'no-comma spelling, because a listener hears the same assertion. If these two ever needed different ' +
      'declarations, the oracle would have inherited the defect it exists to catch.',
    [meeting(14, 'אין בעיה, then נקבעה, naming למחר and 14:00')],
  ),
};

/** QA-3's CANCELLATION spelling, from the finding's pure-detector table. */
export const F17_EIN_BEAYA_CANCELLED: DeclaredText = {
  text: 'אין בעיה הפגישה בוטלה.',
  declares: assertsEffects(
    'The same filler in the CANCELLATION family, which is how the finding showed the class is not one ' +
      'family wide. A contact told the meeting is cancelled does not turn up. It names no day and no time.',
    [
      {
        family: 'CANCELLATION',
        mode: 'COMPLETED',
        localDay: null,
        localHour: null,
        localMinute: null,
        note: 'אין בעיה then בוטלה ("was cancelled"), no punctuation, no day or time named',
      },
    ],
  ),
};

/** QA-3's CALLBACK spelling: no noun phrase intervenes at all. */
export const F17_EIN_BEAYA_CALLBACK: DeclaredText = {
  text: 'אין בעיה אתקשר אליך מחר בשעה 15:00.',
  declares: assertsEffects(
    'The CALLBACK spelling, and the one wording in the finding where the filler is followed STRAIGHT by ' +
      'the verb with no noun phrase between them - the shape a governed-complement rule could not have ' +
      'seen. A contact told they will be called at 15:00 waits by the phone.',
    [
      {
        family: 'CALLBACK',
        mode: 'COMMITTED',
        localDay: FINDING_TOMORROW,
        localHour: 15,
        localMinute: null,
        note: 'אין בעיה then אתקשר אליך מחר בשעה 15:00 ("I will call you tomorrow at 15:00")',
      },
    ],
  ),
};

/**
 * THE FIVE WORDINGS THE FINDING LISTED, in the order it listed them.
 *
 * Kept as its own array because § 17.5 owes a demonstration that all five are
 * caught, not that some representative subset is.
 */
export const QA3_FIVE_WORDINGS: readonly DeclaredText[] = [
  F17_EIN_BEAYA_MEETING,
  F17_EIN_BEAYA_FIRST_PERSON,
  F17_EIN_DAAGA_MEETING,
  F17_LO_NORA_MEETING,
  F17_EIN_TZORECH_MEETING,
];

/**
 * One entry per Mission 2D QA finding, so the regression test reads as the four
 * findings rather than as a list of strings.
 */
export interface PastFinding {
  /** The section of `docs/MISSION_2D_CLAIM_GATE.md` that records it. */
  readonly section: string;
  readonly headline: string;
  readonly wordings: readonly DeclaredText[];
}

export const MISSION_2D_QA_FINDINGS: readonly PastFinding[] = [
  {
    section: '14.1',
    headline: 'the English lexicon had no first-person simple past or plural form',
    wordings: [F14_I_BOOKED_THE_CALLBACK, F14_WE_BOOKED_THE_CALLBACK],
  },
  {
    section: '15.1',
    headline: 'a negator in an earlier clause suppressed a later claim',
    wordings: [F15_DONT_WORRY_BOOKED_THURSDAY],
  },
  {
    section: '16.1',
    headline: 'one intervening adverb broke a multi-token English frame',
    wordings: [F16_I_HAVE_NOW_BOOKED_THE_CALLBACK, F16_MEETING_IS_NOW_BOOKED],
  },
  {
    section: '17.1',
    headline: 'a Hebrew pre-verbal negator-built reassurance with no punctuation',
    wordings: [...QA3_FIVE_WORDINGS, F17_EIN_BEAYA_CANCELLED, F17_EIN_BEAYA_CALLBACK],
  },
];

/** Every declared past-finding wording, including the comma control. */
export const PAST_FINDING_TEXTS: readonly DeclaredText[] = [
  ...MISSION_2D_QA_FINDINGS.flatMap((finding) => finding.wordings),
  F17_EIN_BEAYA_COMMA_CONTROL,
];
