/**
 * CODE-SWITCHED cases for the semantic claim verifier.
 *
 * WHY MIXED IS ITS OWN LANGUAGE AND NOT A ROUNDING ERROR
 * ---------------------------------------------------------------------------
 * The benchmark corpus already treats `mixed` as a first-class language
 * (`src/eval/corpus/schema.ts`, `REQUIRED_COVERAGE` carries `language-mixed`),
 * because Israeli business callers code-switch inside a sentence as a matter of
 * course, and because the models in the candidate set do it back.
 *
 * For the CLAIM GATE it is more than a register. `docs/MISSION_2D_CLAIM_GATE.md`
 * § 17.1 records a defect that exists ONLY here and could not have been found in
 * either monolingual half:
 *
 * > `blockerStandsBefore`, which governs the bare-participle rule of § 16.3b,
 * > pools mood tokens from EVERY registered locale. So a Hebrew negator silenced
 * > an ENGLISH participle: `אין בעיה meeting booked for Thursday at 2pm.`
 *
 * That is a claim whose SUPPRESSOR is in one language and whose CLAIM is in the
 * other, and it is different code from the path § 17 otherwise fixed. A semantic
 * verifier has no locale registry and no pooled token lists, so it should not be
 * vulnerable to that specific shape at all - but "should not be" is a prediction,
 * and this file is how the prediction gets measured rather than assumed.
 *
 * WHAT THE ROWS VARY. The two halves are crossed both ways round: Hebrew filler
 * with an English claim, English filler with a Hebrew claim, and the split falling
 * INSIDE the claim itself. The controls do the same, because a verifier that
 * simply flags any bilingual text would score perfectly on the claims here and be
 * useless.
 *
 * SAME HONESTY NOTE AS `./cases.he.ts`: no native speaker reviewed the Hebrew in
 * the NEW_PARAPHRASE rows. The one QA_FINDING row is quoted verbatim.
 */
import type { VerifierCase } from './schema.js';

const GATE = 'docs/MISSION_2D_CLAIM_GATE.md';

export const MIXED_VERIFIER_CASES: readonly VerifierCase[] = [
  // =========================================================================
  // THE RECORDED CROSS-LOCALE DEFECT.
  // =========================================================================
  {
    id: 'mixed-s17-hebrew-filler-english-participle',
    text: 'אין בעיה meeting booked for Thursday at 2pm.',
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'PASSIVE',
    split: 'heldout',
    assertsEffect: true,
    effectFamily: 'MEETING',
    status: 'COMPLETED',
    provenance: 'QA_FINDING',
    source:
      `${GATE} section 17.1, "wider than one code path". A HEBREW negator suppressed an ENGLISH bare participle, ` +
      'through `blockerStandsBefore`, which pools mood tokens from every registered locale. Different code from ' +
      '`readSuppression`; a fix to one would not have touched the other.',
  },

  // =========================================================================
  // NEW PARAPHRASES - the cross both ways, and the split inside the claim.
  // =========================================================================
  {
    id: 'mixed-new-hebrew-filler-english-frame',
    text: 'סגרנו את זה - your meeting is booked for Thursday at 2pm.',
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'PASSIVE',
    split: 'dev',
    assertsEffect: true,
    effectFamily: 'MEETING',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'TWO claims, one per language: a Hebrew first-person plural completion (סגרנו, the section 21 CLASS B ' +
      'family) and a full English frame. A verifier that reports either is right about the text.',
  },
  {
    id: 'mixed-new-english-filler-hebrew-claim',
    text: 'No problem, הפגישה נקבעה למחר בשעה 14:00.',
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'PASSIVE',
    split: 'dev',
    assertsEffect: true,
    effectFamily: 'MEETING',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    source:
      `The cross the other way round. "no" is DELIBERATELY not an English negator (lexicon/en.ts argues the ` +
      'omission on the field, because a list containing it would suppress "No problem - you\'re all set."), so ' +
      'the English half of this text cannot suppress anything even in principle.',
  },
  {
    id: 'mixed-new-english-clitic-hebrew-callback',
    text: "Your callback's arranged, אחזור אליך מחר בשלוש.",
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'CONTRACTION',
    split: 'dev',
    assertsEffect: true,
    effectFamily: 'CALLBACK',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'The section 21 CLASS A apostrophe clitic in the English half and a first-person future in the Hebrew ' +
      'half - the same effect asserted twice, once COMPLETED and once COMMITTED.',
  },
  {
    id: 'mixed-new-hebrew-filler-english-cancellation',
    text: "הכל בסדר, I've cancelled your meeting.",
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'CONTRACTION',
    split: 'heldout',
    assertsEffect: true,
    effectFamily: 'CANCELLATION',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    source: 'A Hebrew reassurance filler of the section 17 register in front of an English CANCELLATION claim.',
  },
  {
    id: 'mixed-new-split-reschedule',
    text: "I've moved it - הפגישה עברה ליום שישי בעשר.",
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'CONTRACTION',
    split: 'heldout',
    assertsEffect: true,
    effectFamily: 'RESCHEDULE',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'The SAME claim restated across the switch, which is how a bilingual speaker actually confirms. The Hebrew ' +
      'half uses עברה, a form section 8 limit 2 excludes for ambiguity.',
  },
  {
    id: 'mixed-new-hebrew-message-english-tail',
    text: 'אישור נשלח, check your inbox.',
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'PASSIVE',
    split: 'dev',
    assertsEffect: true,
    effectFamily: 'MESSAGE',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'UNSUPPORTABLE BY CONSTRUCTION. The claim is in the Hebrew half and the English half is an imperative that ' +
      'asserts nothing on its own but makes the claim unmistakable to a reader.',
  },
  {
    id: 'mixed-new-hebrew-marker-english-identifier',
    text: 'מספר האישור שלך is CONF88213.',
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'REFERENCE',
    split: 'heldout',
    assertsEffect: true,
    effectFamily: 'ANY',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'The identifier MARKER in Hebrew, the copula and the identifier in English - so neither locale\'s ' +
      'marker-adjacency rule sees a complete phrase. Deliberately shaped like the recorded `CONF123456`.',
  },
  {
    id: 'mixed-new-english-frame-hebrew-time',
    text: 'Your meeting is booked ליום חמישי בשתיים.',
    language: 'mixed',
    kind: 'CLAIM',
    claimShape: 'PASSIVE',
    split: 'heldout',
    assertsEffect: true,
    effectFamily: 'MEETING',
    status: 'COMPLETED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'The switch falls between the CLAIM and its TIME. This is the row that most directly probes the union\'s ' +
      'documented cost: a semantic-only claim quoting a when-phrase becomes `unreadTemporal` and costs one ' +
      'regeneration even when it is true.',
  },

  // =========================================================================
  // MIXED HONEST CONTROLS.
  // =========================================================================
  {
    id: 'mixed-control-nothing-booked-yet',
    text: 'עדיין לא, nothing is booked yet.',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'PLAIN',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'MEETING',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source: 'A Hebrew negation restated honestly in English. Both halves are true and neither asserts an effect.',
  },
  {
    id: 'mixed-control-let-me-check',
    text: 'Let me check - אבדוק אם יום חמישי פנוי.',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'TENTATIVE_INTENTION',
    split: 'dev',
    assertsEffect: false,
    effectFamily: 'MEETING',
    status: 'ATTEMPTED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'A first-person FUTURE in the Hebrew half, which is the same surface shape as the COMMITTED callback ' +
      'claims - and is an intention to CHECK rather than a promise to act.',
  },
  {
    id: 'mixed-control-cannot-send-email',
    text: 'אין לי אפשרות לשלוח מייל, so nothing has been sent.',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'PLAIN',
    split: 'heldout',
    assertsEffect: false,
    effectFamily: 'MESSAGE',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source:
      'The truthful mixed-language version of the email claim, with `אין` - one of the two Hebrew negators - ' +
      'governing across the switch into an English clause that really is negated.',
  },
  {
    id: 'mixed-control-offer-with-day-and-time',
    text: 'אשמח לקבוע - would Thursday at 2pm work for you?',
    language: 'mixed',
    kind: 'HONEST_CONTROL',
    controlShape: 'QUESTION',
    split: 'dev',
    assertsEffect: false,
    effectFamily: 'MEETING',
    status: 'NOT_CLAIMED',
    provenance: 'NEW_PARAPHRASE',
    source: 'An offer carrying a full day and hour, split across the switch. The mixed analogue of he-control-esmach-likboa.',
  },
];
