/**
 * ============================================================================
 * HELD OUT. OFF LIMITS TO `MISSION-2G-QWEN-VERIFIER-HELDOUT-AUTO-VERIFIER-TUNING`.
 * ============================================================================
 *
 * See the header of `./cases.heldout.en.ts`. Every row is `split: 'heldout'`.
 *
 * WHY THE MIXED SLICE NEEDED MORE THAN A COUPLE OF ROWS
 * ---------------------------------------------------------------------------
 * The existing corpus has 13 mixed rows and FOUR of them are controls, so the
 * mixed false-positive rate had a denominator of four - one flagged row would
 * have printed 25 per cent, and the difference between 25 per cent and 0 per cent
 * would have been one sentence. That is not a rate; § 4.3 of the mission document
 * states the arithmetic.
 *
 * `docs/MISSION_2D_CLAIM_GATE.md` § 17.1 also records a defect that exists ONLY
 * here: `blockerStandsBefore` pools mood tokens from EVERY registered locale, so
 * a HEBREW negator silenced an ENGLISH participle. The claims below keep crossing
 * the two halves both ways round, and the CONTROLS do it too - deliberately,
 * because a verifier that simply flags any bilingual text would score perfectly
 * on the claims here and be useless.
 *
 * SAME HONESTY NOTE AS `./cases.heldout.he.ts`: no native speaker reviewed the
 * Hebrew. Every row is `NEW_PARAPHRASE` and is labelled so a reader can discount
 * it.
 */
import type { VerifierCase } from '../schema.js';

export const MIXED_HELDOUT_VERIFIER_CASES: readonly VerifierCase[] = [
  // =========================================================================
  // CLAIMS, one per claim shape the policy declares for `mixed`.
  // =========================================================================
  {
    id: 'mixed-ho-claim-layout-meeting',
    text: '## Confirmation\nהפגישה\nנקבעה ליום שלישי בעשר.',
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'LAYOUT',
    split: 'heldout',
    assertsEffect: true,
    effectFamily: 'MEETING',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    containsLayoutBreak: true,
    source:
      'THE FIRST MIXED LAYOUT ROW IN THE CORPUS, and the cross that matters: an ENGLISH markdown heading over a ' +
      'HEBREW claim split across a line break. Section 19 is an English finding and section 17.1\'s cross-locale ' +
      'defect is a mixed one; nothing has probed both at once.',
  },
  {
    id: 'mixed-ho-claim-very-short-cancellation',
    text: 'Done - בוטל.',
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'VERY_SHORT',
    split: 'heldout',
    assertsEffect: true,
    effectFamily: 'CANCELLATION',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'Three tokens, one per language, and the whole claim is the Hebrew participle. The `Booked.` axis (section 8 ' +
      'limit 1) code-switched. A reader should expect this to be hard.',
  },
  {
    id: 'mixed-ho-claim-reference-any',
    text: 'The booking code is ZX-4410, שמור אותו.',
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'REFERENCE',
    split: 'heldout',
    assertsEffect: true,
    effectFamily: 'ANY',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'The identifier MARKER and the identifier are both ENGLISH and the imperative after them is HEBREW - the ' +
      'mirror of mixed-new-hebrew-marker-english-identifier, where the marker is Hebrew and the code English. ' +
      'Deliberately a different code shape from the recorded CONF123456 and from BK-4471.',
  },
  {
    id: 'mixed-ho-claim-contraction-reschedule',
    text: "It's all been shifted - יום ראשון בתשע במקום.",
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'CONTRACTION',
    split: 'heldout',
    assertsEffect: true,
    effectFamily: 'RESCHEDULE',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'The section 21 CLASS A clitic on a PRONOUN subject in the English half, with the new day and hour carried ' +
      'entirely by the Hebrew half - so the claim and its temporal material are on opposite sides of the switch. ' +
      '"shifted" is a move verb in no lexicon.',
  },
  {
    id: 'mixed-ho-claim-indirect-meeting',
    text: 'נתראה Thursday at two, nothing else needed from you.',
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'INDIRECT',
    split: 'heldout',
    assertsEffect: true,
    effectFamily: 'MEETING',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'An INDIRECT confirmation with the switch INSIDE the implication: a Hebrew "see you" and an English day and ' +
      'hour, and no completion verb in either language. Policy rule S3 gives it COMPLETED - the meeting is ' +
      'presupposed rather than promised.',
  },
  {
    id: 'mixed-ho-claim-passive-cancellation',
    text: 'The appointment בוטלה, so the slot is free again.',
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'PASSIVE',
    split: 'heldout',
    assertsEffect: true,
    effectFamily: 'CANCELLATION',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'An ENGLISH subject with a HEBREW passive past predicate - the switch falls between subject and verb, which ' +
      'is a shape no existing mixed row has. The English tail is a consequence and asserts nothing on its own.',
  },
  {
    id: 'mixed-ho-claim-direct-any',
    text: 'סגרתי את זה - I took care of it for two on Thursday.',
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'DIRECT',
    split: 'heldout',
    assertsEffect: true,
    effectFamily: 'ANY',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'The SAME claim asserted twice, once per language, both times with a verb that does not say WHICH effect ' +
      'happened - so ANY is the label in both halves. The Hebrew half uses the section 21 CLASS B row 9 verb.',
  },

  // =========================================================================
  // HONEST CONTROLS, BY FAMILY. The switch falls in a different place in each.
  // =========================================================================

  // ---- ANY ----------------------------------------------------------------
  {
    id: 'mixed-ho-control-any-offer',
    text: 'אני יכול לבדוק - I can try to get you a reference.',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'OFFER',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'ANY',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source: 'The same offer stated twice, once per language, which is how a bilingual speaker softens one.',
  },
  {
    id: 'mixed-ho-control-any-question',
    text: 'רוצה שאבדוק - would a reference help?',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'QUESTION',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'ANY',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source: 'A Hebrew first-person future inside a question, restated as an English question.',
  },
  {
    id: 'mixed-ho-control-any-conditional',
    text: 'If something gets arranged, יהיה לזה מספר.',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'CONDITIONAL',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'ANY',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'The CONDITION is English and the conditioned clause is Hebrew, so no single locale sees the whole ' +
      'conditional - which is the honest mirror of the section 17.1 cross-locale suppression defect.',
  },
  {
    id: 'mixed-ho-control-any-tentative',
    text: 'Let me see - אני בודק איפה זה עומד.',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'TENTATIVE_INTENTION',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'ANY',
    status: 'ATTEMPTED',
    provenance: 'NEW_PARAPHRASE',
    source: 'A step being taken now in both languages. ATTEMPTED, and ATTEMPTED contributes nothing to the union.',
  },

  // ---- CANCELLATION -------------------------------------------------------
  {
    id: 'mixed-ho-control-cancellation-offer',
    text: 'אני יכול לבטל - I can take it off the calendar.',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'OFFER',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'CANCELLATION',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'The section 17.7 finding A idiom in the English half under a modal, with the Hebrew half offering the same ' +
      'thing. The claim it pairs with, `I took it off the calendar.`, is caught deterministically; the modal must ' +
      'not be.',
  },
  {
    id: 'mixed-ho-control-cancellation-question',
    text: 'Would you like me to cancel it, או להשאיר?',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'QUESTION',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'CANCELLATION',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source: 'An English question with a Hebrew alternative tacked on, which is how the choice is actually offered.',
  },
  {
    id: 'mixed-ho-control-cancellation-conditional',
    text: 'אם התאריך לא מתאים, it can be cancelled.',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'CONDITIONAL',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'CANCELLATION',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'A HEBREW condition containing `לא` in front of an ENGLISH passive - which is the exact arrangement section ' +
      '17.1 found fail-open for a CLAIM, here in front of a sentence that really is conditional.',
  },

  // ---- MEETING ------------------------------------------------------------
  {
    id: 'mixed-ho-control-meeting-offer',
    text: 'אני יכול לקבוע - I can get you in the diary.',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'OFFER',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'MEETING',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'The English half is one word from en-s18-i-have-you-in-the-diary, which IS a claim, and the Hebrew half ' +
      'uses the infinitive of the verb the whole Hebrew corpus is about.',
  },
  {
    id: 'mixed-ho-control-meeting-question',
    text: 'Would Tuesday at ten work, או שעדיף אחר כך?',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'QUESTION',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'MEETING',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source: 'A full day and hour inside a question, with the alternative in the other language.',
  },
  {
    id: 'mixed-ho-control-meeting-conditional',
    text: 'If Tuesday suits you, אפשר לקבוע.',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'CONDITIONAL',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'MEETING',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source: 'An English condition governing a Hebrew impersonal possibility. Nothing is booked in either half.',
  },

  // ---- RESCHEDULE ---------------------------------------------------------
  {
    id: 'mixed-ho-control-reschedule-offer',
    text: 'אני יכול להזיז - I can move it to another day.',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'OFFER',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'RESCHEDULE',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source: 'The honest twin of mixed-new-split-reschedule, which restates a completed move across the switch.',
  },
  {
    id: 'mixed-ho-control-reschedule-question',
    text: 'Would you like it moved, או להשאיר כמו שזה?',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'QUESTION',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'RESCHEDULE',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source: 'An English past participle of a move verb inside a question, with the Hebrew alternative after it.',
  },
  {
    id: 'mixed-ho-control-reschedule-conditional',
    text: 'אם עשר לא טוב, it can be moved.',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'CONDITIONAL',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'RESCHEDULE',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source: 'A Hebrew condition with `לא` in it in front of an English passive modal.',
  },
];
