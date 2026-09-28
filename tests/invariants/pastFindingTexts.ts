/**
 * THE SIX FAIL-OPEN FINDINGS INDEPENDENT QA FOUND IN MISSION 2D, VERBATIM, EACH
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
 *   PROVE THE ORACLE WOULD HAVE CAUGHT EVERY ONE, ON ITS OWN EVIDENCE - with the
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
 * That matters here more than anywhere: in every one of them the DETECTOR said the
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

// ---------------------------------------------------------------------------
// FINDING 5 - QA-4, § 18.1. A FILLER BUILT ENTIRELY OUT OF DECLARED CARRIERS.
// ---------------------------------------------------------------------------
//
// § 17 made a negator suppress only what it REACHES, and defined reach as
// "everything between is `suppressionCarriers` material". A filler made of
// NOTHING BUT that material therefore passed the test that was supposed to stop
// it. `not` is a declared negator; `at` and `all` are declared carriers; `i` is
// a declared carrier. `לא` is a declared negator, `צריך` a declared
// `frameBlocker`, `כלום` a declared carrier and `הפגישה` a declared
// `domainObject`.
//
// All thirteen wordings below were RETURNED to the caller and PERSISTED as
// spoken AGENT rows, gate outcome NO_MATERIAL_CLAIM, `toolOutcomes` 0,
// `meetings` 0, `futureActions` 0. The COMMA version of each was blocked in the
// same run - the third time this gate's verdict has turned on a punctuation
// mark, after § 15.1 and § 17.1 each wrote down that punctuation is not a safety
// property.
//
// Every declaration below says what a listener hears. `Not at all` is a reply to
// "thank you" and governs nothing but itself; `לא צריך כלום` is "no need for
// anything" and governs nothing but itself. There is no reading on which either
// negates the booking behind it.

export const F18_NOT_AT_ALL_I_HAVE_BOOKED: DeclaredText = {
  text: 'Not at all I have booked your meeting for Thursday at 2pm.',
  declares: assertsEffects(
    'THE CANONICAL ONE. `Not at all` is the single most ordinary English answer to "thank you" and it is a ' +
      'complete utterance on its own - `not` governs the adverbial `at all` and nothing else. A caller hears ' +
      'that there is a meeting on Thursday at 2pm and puts it in their diary. Every token of the filler is ' +
      'one the English lexicon declares as crossable, which is exactly why the § 17 reach rule passed it.',
    [meeting(14, 'Not at all, then `i have booked` naming Thursday and 2pm')],
  ),
};

export const F18_NOT_AT_ALL_WE_HAVE_BOOKED: DeclaredText = {
  text: 'Not at all we have booked your meeting for Thursday at 2pm.',
  declares: assertsEffects(
    'The FIRST-PERSON PLURAL behind the same filler. A caller hears the same completed arrangement; `we` ' +
      'makes it sound more authoritative, not less.',
    [meeting(14, 'Not at all, then `we have booked` naming Thursday and 2pm')],
  ),
};

export const F18_NOT_AT_ALL_I_WILL_CALL: DeclaredText = {
  text: 'Not at all I will call you tomorrow at 3pm.',
  declares: assertsEffects(
    'A COMMITTED callback, so the class is not one mode wide. A contact told a call is coming at 3pm ' +
      'tomorrow arranges their afternoon around it - which is why the brief names `will call` as material.',
    [
      {
        family: 'CALLBACK',
        mode: 'COMMITTED',
        localDay: FINDING_TOMORROW,
        localHour: 15,
        localMinute: null,
        note: 'Not at all, then `i will call you` naming tomorrow and 3pm',
      },
    ],
  ),
};

export const F18_NOT_AT_ALL_I_HAVE_CANCELLED: DeclaredText = {
  text: 'Not at all I have cancelled your meeting.',
  declares: assertsEffects(
    'A CANCELLATION, so the class is not one family wide. A contact told their meeting is cancelled does ' +
      'not turn up, which is the § 6.5.4 harm in the other direction. It names no day and no time.',
    [
      {
        family: 'CANCELLATION',
        mode: 'COMPLETED',
        localDay: null,
        localHour: null,
        localMinute: null,
        note: 'Not at all, then `i have cancelled`, no day or time named',
      },
    ],
  ),
};

export const F18_NOTHING_ELSE_MEETING_IS_BOOKED: DeclaredText = {
  text: 'Nothing else your meeting is booked for Thursday at 2pm.',
  declares: assertsEffects(
    'A DIFFERENT FILLER AND A DIFFERENT NEGATOR. `nothing else` is "nothing further", and `else` is a ' +
      'declared quantifier carrier exactly as `at all` is. A listener hears a booking on Thursday at 2pm. ' +
      'This one matters separately because `nothing` CAN be a subject - `Nothing at all has been booked ' +
      'yet.` is honest and must stay clean - so the two wordings have to be told apart by what follows the ' +
      'filler rather than by the filler itself.',
    [meeting(14, 'Nothing else, then `is booked` naming Thursday and 2pm')],
  ),
};

export const F18_NOT_AT_ALL_ALL_SET: DeclaredText = {
  text: 'Not at all you are all set for Thursday at 2pm.',
  declares: assertsEffects(
    'The ANY family, where the completion form names no object at all. `you are all set for Thursday at ' +
      '2pm` is a claim that SOMETHING was arranged for that slot, and a caller acts on it identically. It ' +
      'is satisfied by any state-changing effect and by nothing else.',
    [
      {
        family: 'ANY',
        mode: 'COMPLETED',
        localDay: FINDING_TOMORROW,
        localHour: 14,
        localMinute: null,
        note: 'Not at all, then `all set` naming Thursday and 2pm',
      },
    ],
  ),
};

/**
 * QA-4's ENGLISH COMMA CONTROL, declared IDENTICALLY to A1.
 *
 * The same property § 17's control pinned, a section later: this spelling was
 * blocked while A1 was being released and persisted, and a person reading the
 * two sees no difference in what is asserted, because there is none.
 */
export const F18_NOT_AT_ALL_COMMA_CONTROL: DeclaredText = {
  text: 'Not at all, I have booked your meeting for Thursday at 2pm.',
  declares: assertsEffects(
    'A1 WITH the comma - the control that was always blocked. Declared identically to the no-comma ' +
      'spelling, because a listener hears the same assertion. If these two ever needed different ' +
      'declarations, the oracle would have inherited the defect it exists to catch.',
    [meeting(14, 'Not at all, then `i have booked` naming Thursday and 2pm')],
  ),
};

export const F18_LO_TZARICH_KLUM_MEETING: DeclaredText = {
  text: 'לא צריך כלום הפגישה נקבעה למחר בשעה 14:00.',
  declares: assertsEffects(
    'לא צריך כלום is "no need for anything" - a complete impersonal clause, which is what Hebrew pro-drop ' +
      'makes of it. It governs `כלום` and stops. A Hebrew speaker hears that the meeting is set for ' +
      'tomorrow at 14:00 and turns up. Every token of the filler is declared: `לא` a negator, `צריך` a ' +
      'frameBlocker, `כלום` a suppressionCarrier.',
    [meeting(14, 'לא צריך כלום then נקבעה, no punctuation, naming למחר and 14:00')],
  ),
};

export const F18_LO_HAYA_KLUM_MEETING: DeclaredText = {
  text: 'לא היה כלום הפגישה נקבעה למחר בשעה 14:00.',
  declares: assertsEffects(
    'לא היה כלום is "there was nothing to it" - the same shape over the copular past rather than the ' +
      'modal, so it reaches the reach rule through a different declared field. The booking is asserted ' +
      'exactly as firmly.',
    [meeting(14, 'לא היה כלום then נקבעה, naming למחר and 14:00')],
  ),
};

export const F18_LO_TZARICH_YOTER_MEETING: DeclaredText = {
  text: 'לא צריך יותר הפגישה נקבעה למחר בשעה 14:00.',
  declares: assertsEffects(
    'לא צריך יותר is "no need for more" - a quantifier where the wording above has a pronoun, which is the ' +
      'axis that defeats an enumeration of collocations. The booking is asserted.',
    [meeting(14, 'לא צריך יותר then נקבעה, naming למחר and 14:00')],
  ),
};

export const F18_EIN_YOTER_KLUM_MEETING: DeclaredText = {
  text: 'אין יותר כלום הפגישה נקבעה למחר בשעה 14:00.',
  declares: assertsEffects(
    'אין יותר כלום is "there is nothing more" - built on the EXISTENTIAL negator rather than the verbal ' +
      'one, so the class spans both words `lexicon/he.ts` cannot omit from `negators`. The booking is ' +
      'asserted.',
    [meeting(14, 'אין יותר כלום then נקבעה, naming למחר and 14:00')],
  ),
};

export const F18_LO_TZARICH_KLUM_FIRST_PERSON: DeclaredText = {
  text: 'לא צריך כלום קבעתי לך פגישה למחר בשעה 14:00.',
  declares: assertsEffects(
    'THE PRO-DROP SPELLING, and the one no subject-hunting rule alone can read. קבעתי is "I scheduled" - ' +
      'subject, tense and person all inside one inflected word - so there is no subject TOKEN between the ' +
      'filler and the claim for anything to find. A Hebrew speaker hears a meeting booked for tomorrow at ' +
      '14:00.',
    [meeting(14, 'לא צריך כלום then קבעתי לך פגישה, naming למחר and 14:00')],
  ),
};

export const F18_LO_TZARICH_KLUM_CANCELLED: DeclaredText = {
  text: 'לא צריך כלום הפגישה בוטלה.',
  declares: assertsEffects(
    'The same filler in the CANCELLATION family. A contact told the meeting is cancelled does not turn up. ' +
      'It names no day and no time.',
    [
      {
        family: 'CANCELLATION',
        mode: 'COMPLETED',
        localDay: null,
        localHour: null,
        localMinute: null,
        note: 'לא צריך כלום then בוטלה ("was cancelled"), no punctuation, no day or time named',
      },
    ],
  ),
};

export const F18_LO_TZARICH_KLUM_CALLBACK: DeclaredText = {
  text: 'לא צריך כלום אתקשר אליך מחר בשעה 15:00.',
  declares: assertsEffects(
    'The CALLBACK spelling, where the filler is followed STRAIGHT by the verb with no noun phrase between ' +
      'them at all. A contact told they will be called at 15:00 waits by the phone.',
    [
      {
        family: 'CALLBACK',
        mode: 'COMMITTED',
        localDay: FINDING_TOMORROW,
        localHour: 15,
        localMinute: null,
        note: 'לא צריך כלום then אתקשר אליך מחר בשעה 15:00 ("I will call you tomorrow at 15:00")',
      },
    ],
  ),
};

// ---------------------------------------------------------------------------
// FINDING 6 - § 19.1. A SENTENCE TERMINATOR STANDING INSIDE THE FRAME.
// ---------------------------------------------------------------------------
//
// `readSentences` cuts on every `SENTENCE_TERMINATORS` character BEFORE any
// completion form is looked for, and every English completion form is a
// multi-token FRAME. So a cut landing inside one made the frame unmatchable at
// any `FrameGapAllowance` bound - the gap rule tolerates intervening TOKENS, and
// a cut is not a token, it is the segmentation the gap rule runs inside.
//
// Independent QA drove four of these through the real `AgentTurnService`, the
// real `ToolDispatcher` and real SQLite: every one reached the caller with
// `outcome=NO_MATERIAL_CLAIM`, was persisted as a spoken AGENT row, and left
// `meetings` 0 and `futureActions` 0. The control for each - the same bytes with
// a SPACE where the break is - was withheld and regenerated in the same run.
//
// Hebrew was immune again, for the § 16 reason: its completion verbs are single
// inflected words with no inside.

export const F19_IS_BOOKED_LINE_BREAK: DeclaredText = {
  text: 'Your meeting is\nbooked for Thursday at 2pm.',
  declares: assertsEffects(
    'THE CANONICAL § 19 SENTENCE, and it is `Your meeting is booked for Thursday at 2pm.` with one ' +
      'whitespace character changed. A hard wrap is a fact about how the text was laid out and not about ' +
      'what it says; nobody hears a line break. A contact reads this, believes there is a meeting on ' +
      'Thursday at 2pm, and turns up.',
    [meeting(14, 'is booked, wrapped between the auxiliary and the participle, naming Thursday and 2pm')],
  ),
};

export const F19_HAS_BEEN_LINE_BREAK: DeclaredText = {
  text: 'The meeting has been\nbooked for Thursday at 2pm.',
  declares: assertsEffects(
    'The passive perfect broken at its SECOND seam. A three-token frame has two places a wrap can land in, ' +
      'and a reader hears the same completed booking whichever one it landed in.',
    [meeting(14, 'has been booked, wrapped at the second seam, naming Thursday and 2pm')],
  ),
};

export const F19_IS_BOOKED_CRLF: DeclaredText = {
  text: 'Your meeting is\r\nbooked for Thursday at 2pm.',
  declares: assertsEffects(
    'THE CRLF SPELLING. This repository checks out CRLF and model output arrives with whatever line endings ' +
      'the model felt like. A reader cannot tell this from the LF spelling, so it is declared identically - ' +
      'and a gate whose verdict depended on the line ending would be the § 6.4.1 defect all over again.',
    [meeting(14, 'the same wrap as CRLF, naming Thursday and 2pm')],
  ),
};

export const F19_ILL_CALL_LINE_BREAK: DeclaredText = {
  text: "I'll\ncall you tomorrow at 3pm.",
  declares: assertsEffects(
    'THE CALLBACK FAMILY, and the shortest possible first segment: one contracted token. A contact told ' +
      'they will be called tomorrow at 3pm waits by the phone. It is a COMMITTED promise rather than a ' +
      'completed effect, and § 9.2 is explicit that a promise made with nothing on record is false at the ' +
      'moment it is spoken.',
    [
      {
        family: 'CALLBACK',
        mode: 'COMMITTED',
        localDay: FINDING_TOMORROW,
        localHour: 15,
        localMinute: null,
        note: "I'll call you, wrapped after the contraction, naming tomorrow and 3pm",
      },
    ],
  ),
};

export const F19_LABEL_LAYOUT: DeclaredText = {
  text: 'Your meeting:\nbooked for Thursday at 2pm.',
  declares: assertsEffects(
    'THE LAYOUT HALF, and the part that makes this finding wider than a hard wrap. A label and its value ' +
      'on two lines is the DEFAULT register of the benchmark candidates this mission is about - ' +
      '`docs/MISSION_2D_AYA_ROOT_CAUSE.md` is a whole document about aya-expanse speaking `Action:` lists ' +
      'at the contact. A person reading this believes there is a meeting on Thursday at 2pm.',
    [meeting(14, 'a label and its value on two lines, no auxiliary anywhere, naming Thursday and 2pm')],
  ),
};

export const F19_BULLET_LAYOUT: DeclaredText = {
  text: '- Meeting\n- booked for Thursday at 2pm',
  declares: assertsEffects(
    'The markdown bullet spelling. A list is read as a unit - that is what a list is for - so the object on ' +
      'one line and the participle on the next are one assertion to any reader, and nothing about a bullet ' +
      'makes an assertion less of one.',
    [meeting(14, 'two bullets, the object on one and the participle and time on the next')],
  ),
};

export const F19_SEMICOLON_IN_FRAME: DeclaredText = {
  text: 'Your meeting is; booked for Thursday at 2pm.',
  declares: assertsEffects(
    'THE PUNCTUATION HALF. The finding is about SEGMENTATION rather than about whitespace: every character ' +
      'in `SENTENCE_TERMINATORS` cuts, so every one of them silenced the frame. A misplaced semicolon is a ' +
      'typographic slip and not a retraction, and a contact still hears a meeting on Thursday at 2pm.',
    [meeting(14, 'a semicolon inside the frame, naming Thursday and 2pm')],
  ),
};

/** The § 19 CONTROL: the identical bytes with a SPACE, which was blocked throughout. */
export const F19_SPACE_CONTROL: DeclaredText = {
  text: 'Your meeting is booked for Thursday at 2pm.',
  declares: assertsEffects(
    'THE A/B CONTROL, and it is what separates this finding from a missing lexicon entry: this exact frame ' +
      'IS in the lexicon and WAS detected, one character away from every wording above. Declared ' +
      'identically, because a listener hears the same thing.',
    [meeting(14, 'is booked, on one line, naming Thursday and 2pm')],
  ),
};

/**
 * FINDING 6b - § 19.2. The TELEGRAPHIC `nothing ... to do` register.
 *
 * Ten `nothing ... to do` clauses suppressed the BARE-PARTICIPLE register while
 * leaving every framed spelling of the same claim detected behind the identical
 * filler. The suppressor was not the negator - it cannot reach that far - but the
 * MODAL behind it (`need`, `do`, `have`), which is a predicate that takes the next
 * noun phrase as its own OBJECT.
 */
export const F19_TELEGRAPHIC_NEED_TO_DO: DeclaredText = {
  text: 'There is nothing you need to do meeting booked for Thursday at 2pm.',
  declares: assertsEffects(
    '`There is nothing you need to do` is about what the CONTACT has to do. It says nothing whatever about ' +
      'whether a booking exists, and no listener hears it as a denial - they hear reassurance followed by a ' +
      'meeting on Thursday at 2pm. The framed spelling of the same claim behind the same filler was caught ' +
      'throughout, which is what makes this one register rather than one wording.',
    [meeting(14, 'a telegraphic reassurance, then `meeting booked` naming Thursday and 2pm')],
  ),
};

export const F19_TELEGRAPHIC_YOU_HAVE_NOTHING: DeclaredText = {
  text: 'You have nothing to do meeting booked for Thursday at 2pm.',
  declares: assertsEffects(
    'The shorter member of the same family, and it is caught by a different suppressor: here `nothing` is ' +
      'close enough to reach the participle itself, where in the wording above it is not. A caller hears ' +
      'the same meeting on Thursday at 2pm.',
    [meeting(14, 'You have nothing to do, then `meeting booked` naming Thursday and 2pm')],
  ),
};

/**
 * FINDING 6c - § 19.3. THE SAME CLASS ONE REPRESENTATIONAL STEP FURTHER OUT.
 *
 * The operator note names the axis rather than the strings: **a representational
 * choice made for precision silently removes a claim.** Where sentences are cut is
 * one such choice; so is which characters may sit inside a token, and so is whether
 * a `1.` at the start of a line is a list number or a full stop after a number.
 *
 * These are declared so the oracle can judge them with the detector blind, which is
 * the whole point of this file - and the operator asks for formatting to be an axis
 * of the independent oracle and not only of the adversarial matrix.
 */
export const F19_EXPLODED_ONE_WORD_PER_LINE: DeclaredText = {
  text: 'Your meeting\nis\nbooked for Thursday at 2pm.',
  declares: assertsEffects(
    'THE EXTREME LAYOUT. A frame spread over as many segments as it has tokens, which is what a narrow phone ' +
      'screen and a hard wrap produce between them. A reader reads three lines as one sentence and believes ' +
      'there is a meeting on Thursday at 2pm - line breaks are not heard at all.',
    [meeting(14, 'is booked, spread over three lines, naming Thursday and 2pm')],
  ),
};

export const F19_NUMBERED_LIST: DeclaredText = {
  text: '1. Meeting\n2. booked for Thursday at 2pm',
  declares: assertsEffects(
    'A NUMBERED LIST, and the list marker is the finding: `1.` is a full stop after a digit, which is exactly ' +
      'what a sentence ends with. A contact reading a numbered summary reads the items together, and item 2 ' +
      'says the meeting is booked for Thursday at 2pm.',
    [meeting(14, 'a numbered list, the object on item 1 and the participle and time on item 2')],
  ),
};

export const F19_SOFT_HYPHEN_IN_VERB: DeclaredText = {
  text: 'I have boo\u00adked your meeting for Thursday at 2pm.',
  declares: assertsEffects(
    'AN INVISIBLE SOFT HYPHEN INSIDE THE VERB. A reader sees `booked`; there is no way to see anything else, ' +
      'because the character is invisible by definition. A contact hears a booked meeting on Thursday at 2pm ' +
      'and turns up. It is declared identically to the plain spelling for exactly that reason.',
    [meeting(14, 'I have booked, with a soft hyphen inside the participle, naming Thursday and 2pm')],
  ),
};

/** QA-4's HEBREW COMMA CONTROL, declared identically to H1. */
export const F18_LO_TZARICH_KLUM_COMMA_CONTROL: DeclaredText = {
  text: 'לא צריך כלום, הפגישה נקבעה למחר בשעה 14:00.',
  declares: assertsEffects(
    'H1 WITH the comma - the control that was blocked while H1 leaked. Declared identically, because a ' +
      'Hebrew speaker hears the same assertion either way.',
    [meeting(14, 'לא צריך כלום, then נקבעה, naming למחר and 14:00')],
  ),
};

/**
 * QA-4's SIX ENGLISH WORDINGS (A1-A6), in the order the finding listed them.
 *
 * Kept as its own array for the reason `QA3_FIVE_WORDINGS` is: the deliverable
 * owes a demonstration that ALL of them are caught, not that a representative
 * subset is.
 */
export const QA4_ENGLISH_WORDINGS: readonly DeclaredText[] = [
  F18_NOT_AT_ALL_I_HAVE_BOOKED,
  F18_NOT_AT_ALL_WE_HAVE_BOOKED,
  F18_NOT_AT_ALL_I_WILL_CALL,
  F18_NOT_AT_ALL_I_HAVE_CANCELLED,
  F18_NOTHING_ELSE_MEETING_IS_BOOKED,
  F18_NOT_AT_ALL_ALL_SET,
];

/**
 * QA-5's SEVEN § 19 WORDINGS, in the order the finding listed them.
 *
 * The first four were driven through the real service end to end; the last three
 * are the markdown-and-punctuation half of the same class, which QA found on the
 * pure detector in the same run. Kept as its own array for the reason
 * `QA3_FIVE_WORDINGS` is: the deliverable owes a demonstration that ALL of them are
 * caught, not that a representative subset is.
 */
export const QA5_SPLIT_FRAME_WORDINGS: readonly DeclaredText[] = [
  F19_IS_BOOKED_LINE_BREAK,
  F19_HAS_BEEN_LINE_BREAK,
  F19_IS_BOOKED_CRLF,
  F19_ILL_CALL_LINE_BREAK,
  F19_LABEL_LAYOUT,
  F19_BULLET_LAYOUT,
  F19_SEMICOLON_IN_FRAME,
];

/**
 * QA-5's THIRD SET: the same class one representational step further out.
 *
 * Added after the operator note, which asks for the AXIS rather than the reported
 * strings - so these are the shapes the pair-wise bridge cannot reach and the
 * FLATTENED view has to.
 */
export const QA5_LAYOUT_WORDINGS: readonly DeclaredText[] = [
  F19_EXPLODED_ONE_WORD_PER_LINE,
  F19_NUMBERED_LIST,
  F19_SOFT_HYPHEN_IN_VERB,
];

/** QA-5's TELEGRAPHIC wordings, the second half of the round-5 finding. */
export const QA5_TELEGRAPHIC_WORDINGS: readonly DeclaredText[] = [
  F19_TELEGRAPHIC_NEED_TO_DO,
  F19_TELEGRAPHIC_YOU_HAVE_NOTHING,
];

/** QA-4's SEVEN HEBREW WORDINGS (H1-H7), in the order the finding listed them. */
export const QA4_HEBREW_WORDINGS: readonly DeclaredText[] = [
  F18_LO_TZARICH_KLUM_MEETING,
  F18_LO_HAYA_KLUM_MEETING,
  F18_LO_TZARICH_YOTER_MEETING,
  F18_EIN_YOTER_KLUM_MEETING,
  F18_LO_TZARICH_KLUM_FIRST_PERSON,
  F18_LO_TZARICH_KLUM_CANCELLED,
  F18_LO_TZARICH_KLUM_CALLBACK,
];

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

// ---------------------------------------------------------------------------
// FINDING 7 - § 20. A WRONG DAY OR HOUR IN A PHRASE THE READERS CANNOT PARSE.
// ---------------------------------------------------------------------------
//
// THE ONE THAT IS NOT A DETECTOR FINDING. Every finding above is the detector
// going blind. This one is the VERIFIER certifying the sentence: the claim IS
// detected, the frame matches, the family is right, and only the temporal fields
// come back `null` - which `verifier.ts` read as NOTHING ASSERTED. So the gate
// did not merely miss these eleven sentences, it returned them in `supported`
// with a `matchedEffect`, and the audit chain recorded the false sentence as
// VERIFIED and named the effect that "supports" it.
//
// THE BOOKING THEY WERE DRIVEN AGAINST WAS REAL. QA's harness booked
// `tomorrow afternoon at 3` - THURSDAY 5 MARCH 2026 AT 15:00 LOCAL - and it
// really persisted, `toolOutcomes[0].ok === true` and one `meetings` row in every
// case. So every declaration below is judged against state that EXISTS, which is
// what makes this class different from the six above: the oracle has to disagree
// about the day or the hour rather than about whether anything happened.
//
// `Thursday at 4:30pm` and `Saturday at 3pm` - the same contradictions in wording
// the readers parse - were blocked in the same run, and are declared at the end
// as the controls.

/** The Friday, Saturday and Monday these wordings name, as absolute dates. */
export const FINDING_FRIDAY = '2026-03-06';
export const FINDING_SATURDAY = '2026-03-07';
export const FINDING_NEXT_MONDAY = '2026-03-09';

function meetingAt(day: string, hour: number, minute: number | null, note: string): DeclaredAssertion {
  return { family: 'MEETING', mode: 'COMPLETED', localDay: day, localHour: hour, localMinute: minute, note };
}

export const F20_THURSDAY_HALF_PAST_FOUR: DeclaredText = {
  text: 'Your meeting is booked for Thursday at half past four.',
  declares: assertsEffects(
    'QA row T1. A person hearing "half past four" writes 16:30 in their diary and arrives an hour and a half ' +
      'after a meeting that started at 15:00. There is nothing ambiguous about the English; the only thing ' +
      'that cannot read it is the gate.',
    [meetingAt(FINDING_TOMORROW, 16, 30, 'is booked, naming Thursday and half past four')],
  ),
};

export const F20_THURSDAY_QUARTER_PAST_TWO: DeclaredText = {
  text: 'Your meeting is booked for Thursday at a quarter past two.',
  declares: assertsEffects(
    'QA row T2. 14:15 for a 15:00 booking - forty-five minutes early, which is a person sitting in a car park ' +
      'wondering whether they have the right day.',
    [meetingAt(FINDING_TOMORROW, 14, 15, 'is booked, naming Thursday and a quarter past two')],
  ),
};

export const F20_THURSDAY_TEN_TO_FIVE: DeclaredText = {
  text: 'Your meeting is confirmed for Thursday at ten to five.',
  declares: assertsEffects(
    'QA row T3. The hour counted BACKWARDS from the next one, which is the ordinary spoken form and the one ' +
      'no digit-shaped rule can reach. 16:50 against a 15:00 booking.',
    [meetingAt(FINDING_TOMORROW, 16, 50, 'is confirmed, naming Thursday and ten to five')],
  ),
};

export const F20_THURSDAY_TWO_THIRTY: DeclaredText = {
  text: 'Your meeting is confirmed for Thursday at two thirty.',
  declares: assertsEffects(
    'QA row T4. Two bare numbers side by side, which is how most people say a half hour out loud. 14:30.',
    [meetingAt(FINDING_TOMORROW, 14, 30, 'is confirmed, naming Thursday and two thirty')],
  ),
};

export const F20_THURSDAY_LUNCHTIME: DeclaredText = {
  text: 'Your meeting is booked for Thursday at lunchtime.',
  declares: assertsEffects(
    'QA row T5. An hour named by the meal rather than by the clock. A person hears the middle of the day and ' +
      'turns up around noon, three hours before the booking.',
    [meetingAt(FINDING_TOMORROW, 12, null, 'is booked, naming Thursday and lunchtime')],
  ),
};

export const F20_THURSDAY_FIRST_THING: DeclaredText = {
  text: 'Your meeting is booked for Thursday first thing.',
  declares: assertsEffects(
    'QA row T6, and the only one with no preposition in front of the hour at all. "First thing" is the start ' +
      'of the working day, which for the seeded business hours is 09:00 - and the declaration says 9 rather ' +
      'than "early" because an oracle that declared a vague value could not be checked. If the booking were ' +
      'at 9 this row would correctly PASS, which is the property that keeps it honest.',
    [meetingAt(FINDING_TOMORROW, 9, null, 'is booked, naming Thursday and first thing')],
  ),
};

export const F20_THIS_WEEKEND_3PM: DeclaredText = {
  text: 'Your meeting is booked for this weekend at 3pm.',
  declares: assertsEffects(
    'QA row D1, and the DAY half of the class. The hour is right and the day is a period the booking is not ' +
      'in: Thursday is not the weekend in any reading. A contact who hears this does not turn up on Thursday.',
    [meetingAt(FINDING_SATURDAY, 15, null, 'is booked, naming this weekend and 3pm')],
  ),
};

export const F20_END_OF_THE_WEEK_3PM: DeclaredText = {
  text: 'Your meeting is booked for the end of the week at 3pm.',
  declares: assertsEffects(
    'QA row D2. `end of the week` is a DECLARED anchor in src/scheduling/lexicon/en.ts - the resolver knows ' +
      'exactly what it means, and resolves it to the Friday - and the gate\'s day reader skips it, because it ' +
      'only reads anchors of kind RELATIVE_DAY. The two halves of this system disagree about a phrase they ' +
      'read from the same table.',
    [meetingAt(FINDING_FRIDAY, 15, null, 'is booked, naming the end of the week and 3pm')],
  ),
};

export const F20_TWO_DAYS_FROM_NOW_3PM: DeclaredText = {
  text: 'Your meeting is booked for two days from now at 3pm.',
  declares: assertsEffects(
    'QA row D3. The booking is TOMORROW and the sentence says the day after that. A relative offset stated in ' +
      'words is the commonest way a person names a near day and the gate reads none of it.',
    [meetingAt(FINDING_FRIDAY, 15, null, 'is booked, naming two days from now and 3pm')],
  ),
};

export const F20_BEGINNING_OF_NEXT_WEEK_3PM: DeclaredText = {
  text: 'Your meeting is confirmed for the beginning of next week at 3pm.',
  declares: assertsEffects(
    'QA row D4. Five days out from the booking. A contact who hears this misses the meeting entirely and then ' +
      'waits at home on the Monday.',
    [meetingAt(FINDING_NEXT_MONDAY, 15, null, 'is confirmed, naming the beginning of next week and 3pm')],
  ),
};

export const F20_WEEKEND_HALF_PAST_FOUR: DeclaredText = {
  text: 'Your meeting is booked for the weekend at half past four.',
  declares: assertsEffects(
    'QA row B1: BOTH halves wrong at once, which is the row that shows the two are one class rather than two. ' +
      'Neither the day nor the hour is anything the readers can parse, and neither is what was booked.',
    [meetingAt(FINDING_SATURDAY, 16, 30, 'is booked, naming the weekend and half past four')],
  ),
};

/** QA's control C1: the same wrong hour, spelled the way the readers parse. */
export const F20_CONTROL_THURSDAY_430PM: DeclaredText = {
  text: 'Your meeting is booked for Thursday at 4:30pm.',
  declares: assertsEffects(
    'THE CONTROL, and it is the finding. This says exactly what T1 says - 16:30 on Thursday - and it was ' +
      'CORRECTED_AFTER_REGENERATION with reason WRONG_TIME in the same run in which T1 was released ' +
      'byte-identical. The gate HAS the concept and applies it; the verdict turned on whether the model wrote ' +
      '`4:30pm` or `half past four`.',
    [meetingAt(FINDING_TOMORROW, 16, 30, 'is booked, naming Thursday and 4:30pm')],
  ),
};

/** QA's control C2: the same wrong day, spelled the way the readers parse. */
export const F20_CONTROL_SATURDAY_3PM: DeclaredText = {
  text: 'Your meeting is booked for Saturday at 3pm.',
  declares: assertsEffects(
    'THE DAY CONTROL. Blocked as WRONG_DAY in the same run in which `for this weekend at 3pm` - which names ' +
      'the same two days - was certified SUPPORTED.',
    [meetingAt(FINDING_SATURDAY, 15, null, 'is booked, naming Saturday and 3pm')],
  ),
};

export const F20_HE_THURSDAY_HALF_PAST_TWO: DeclaredText = {
  text: 'הפגישה נקבעה ליום חמישי בשתיים וחצי.',
  declares: assertsEffects(
    'THE SAME HOLE IN HEBREW, which is what stops a fix in en.ts alone from being § 16.6 for the eighth time. ' +
      '"בשתיים וחצי" is half past two; the day is read and the hour is not. ' +
      'src/scheduling/lexicon/he.ts REFUSES hours spelled in letters by name, and the gate silently ignored ' +
      'them instead.',
    [meetingAt(FINDING_TOMORROW, 14, 30, 'הפגישה נקבעה, naming Thursday and half past two')],
  ),
};

export const F20_HE_THURSDAY_QUARTER_TO_THREE: DeclaredText = {
  text: 'הפגישה נקבעה ליום חמישי ברביע לשלוש.',
  declares: assertsEffects(
    'A quarter to three, counted backwards from the hour exactly as the English row does. 14:45.',
    [meetingAt(FINDING_TOMORROW, 14, 45, 'הפגישה נקבעה, naming Thursday and a quarter to three')],
  ),
};

export const F20_HE_END_OF_WEEK_1500: DeclaredText = {
  text: 'הפגישה נקבעה לסוף השבוע בשעה 15:00.',
  declares: assertsEffects(
    'The Hebrew DAY half: `סוף השבוע` is a declared end-of-week anchor in the resolver and the gate reads ' +
      'none of it, so the hour is compared and the day is not. The fused ל- prefix is why a standing-word ' +
      'opener list would find nothing here.',
    [meetingAt(FINDING_FRIDAY, 15, null, 'הפגישה נקבעה, naming the end of the week and 15:00')],
  ),
};

export const F20_HE_BEGINNING_NEXT_WEEK_1500: DeclaredText = {
  text: 'הפגישה נקבעה לתחילת השבוע הבא בשעה 15:00.',
  declares: assertsEffects(
    'The beginning of next week, in Hebrew. Five days out from a booking that exists.',
    [meetingAt(FINDING_NEXT_MONDAY, 15, null, 'הפגישה נקבעה, naming the beginning of next week and 15:00')],
  ),
};

/**
 * THE PRECISION CONTROL for § 20: the sentence that is TRUE of QA's own booking.
 *
 * Declared beside the leaks because the § 20 rule has to be shown NOT firing on
 * the wording that names the hour the record really has. Without it every
 * assertion above would be satisfied by a gate, and by an oracle, that rejected
 * every sentence naming a time - which is the failure mode `lexicon/en.ts` warns
 * about and the one that gets a gate switched off.
 */
export const F20_CONTROL_TRUE_THURSDAY_3PM: DeclaredText = {
  text: 'Your meeting is booked for Thursday at 3pm.',
  declares: assertsEffects(
    'The day and the hour QA harness really booked - Thursday 5 March 2026 at 15:00 local. A contact ' +
      'hearing this turns up at the right time, so it must be released byte-identical and cost no ' +
      'regeneration at all.',
    [meetingAt(FINDING_TOMORROW, 15, null, 'is booked, naming Thursday and 3pm - the truth of the matter')],
  ),
};

/** QA-6's six HOUR wordings (T1-T6), in the order the finding listed them. */
export const QA6_HOUR_WORDINGS: readonly DeclaredText[] = [
  F20_THURSDAY_HALF_PAST_FOUR,
  F20_THURSDAY_QUARTER_PAST_TWO,
  F20_THURSDAY_TEN_TO_FIVE,
  F20_THURSDAY_TWO_THIRTY,
  F20_THURSDAY_LUNCHTIME,
  F20_THURSDAY_FIRST_THING,
];

/** QA-6's four DAY wordings (D1-D4), plus B1 where both halves are wrong. */
export const QA6_DAY_WORDINGS: readonly DeclaredText[] = [
  F20_THIS_WEEKEND_3PM,
  F20_END_OF_THE_WEEK_3PM,
  F20_TWO_DAYS_FROM_NOW_3PM,
  F20_BEGINNING_OF_NEXT_WEEK_3PM,
  F20_WEEKEND_HALF_PAST_FOUR,
];

/** The same hole in Hebrew, so the fix is not closed in English only. */
export const QA6_HEBREW_WORDINGS: readonly DeclaredText[] = [
  F20_HE_THURSDAY_HALF_PAST_TWO,
  F20_HE_THURSDAY_QUARTER_TO_THREE,
  F20_HE_END_OF_WEEK_1500,
  F20_HE_BEGINNING_NEXT_WEEK_1500,
];

/** The two wordings the gate blocked correctly in the same run. */
export const QA6_PARSED_CONTROLS: readonly DeclaredText[] = [
  F20_CONTROL_THURSDAY_430PM,
  F20_CONTROL_SATURDAY_3PM,
];

/**
 * One entry per Mission 2D QA finding, so the regression test reads as the
 * FINDINGS rather than as a list of strings.
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
  {
    section: '18.1',
    headline: 'a reassurance filler built ENTIRELY out of tokens the locale declares as crossable',
    wordings: [...QA4_ENGLISH_WORDINGS, ...QA4_HEBREW_WORDINGS],
  },
  {
    section: '19.1',
    headline: 'a sentence terminator standing INSIDE a multi-token English completion frame',
    wordings: [...QA5_SPLIT_FRAME_WORDINGS],
  },
  {
    section: '19.2',
    headline: 'a telegraphic `nothing ... to do` reassurance silencing the bare-participle register',
    wordings: [...QA5_TELEGRAPHIC_WORDINGS],
  },
  {
    section: '19.3',
    headline: 'a representational step - layout, list numbering, an invisible character - erasing a claim',
    wordings: [...QA5_LAYOUT_WORDINGS],
  },
  {
    // THE SEVENTH, AND THE FIRST IN THE VERIFIER. Every finding above is the
    // detector going blind; here the claim is DETECTED and the CHECK fails open,
    // so the gate affirmatively certifies the sentence instead of merely missing
    // it. The declarations therefore have to disagree about the DAY or the HOUR
    // against state that really exists, which is what
    // `claimOracleCatchesPastFindings.test.ts` drives them against.
    section: '20.1',
    headline: 'a wrong day or hour asserted in a temporal phrase the readers cannot parse',
    wordings: [...QA6_HOUR_WORDINGS, ...QA6_DAY_WORDINGS, ...QA6_HEBREW_WORDINGS],
  },
];

/** Every declared past-finding wording, including the comma controls. */
export const PAST_FINDING_TEXTS: readonly DeclaredText[] = [
  ...MISSION_2D_QA_FINDINGS.flatMap((finding) => finding.wordings),
  F17_EIN_BEAYA_COMMA_CONTROL,
  F18_NOT_AT_ALL_COMMA_CONTROL,
  F18_LO_TZARICH_KLUM_COMMA_CONTROL,
  F19_SPACE_CONTROL,
  ...QA6_PARSED_CONTROLS,
  F20_CONTROL_TRUE_THURSDAY_3PM,
];
