/**
 * The Hebrew claim lexicon.
 *
 * WHERE THESE STRINGS CAME FROM
 * ---------------------------------------------------------------------------
 * Hebrew is easy to get subtly wrong by retyping it, so the forms below are
 * taken from this repository's own files or are the regular inflections of
 * words already in them:
 *
 *   נקבעה, אשלח, אישור, בדוא"ל, הפגישה   - the `aya-expanse:8b` transcript
 *                                          quoted verbatim in
 *                                          `docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md`
 *                                          § 6.2
 *   סגרנו                                - `tests/e2e/hebrewDigitClockTime.test.ts`
 *                                          and `src/eval/corpus/scenarios.he.ts`
 *   מחר, ב-15:00, אחרי הצהריים, יום חמישי - `src/scheduling/lexicon/he.ts`, which
 *                                          is where the day and time vocabulary
 *                                          stays; this file does not duplicate it
 *   לא, אין, טרם, עדיין                   - ordinary negation, and `אין` appears
 *                                          in the § 6.2 transcript
 *
 * The rest are the regular verbal inflections of those: the passive past
 * (נקבעה / בוטלה / אושרה / הועברה / נשלחה), the first person future (אשלח /
 * אתקשר), and the first person past (קבעתי / ביטלתי / שלחתי).
 *
 * HEBREW NEEDS NO FRAME, AND THAT IS WHY THE LEXICON IS PER LOCALE
 * ---------------------------------------------------------------------------
 * English `booked` is ambiguous and needs `is booked` to become a claim. Hebrew
 * נקבעה is not ambiguous: the passive past is in the morphology, and there is no
 * reading of it that means "let me arrange it". So the Hebrew forms are single
 * words where the English forms are three, and neither language is being
 * described in the other's shape. That is the whole point of
 * `src/scheduling/lexicon/` and it is the point here.
 *
 * WHAT IS DELIBERATELY NOT HERE, AND WHY
 * ---------------------------------------------------------------------------
 *  - נקבע, the MASCULINE passive past. It collides with the cohortative "let's
 *    schedule", and `src/scheduling/lexicon/he.ts` already declares נקבע as a
 *    CARRIER token on exactly that reading. A form that is a completed booking
 *    in one reading and a proposal in another must not decide whether a sentence
 *    reaches a contact, so the feminine נקבעה (which agrees with הפגישה, the
 *    word a model actually uses) and the plural נקבעו are here and the
 *    ambiguous masculine is not. A model writing הפגישה נקבע - wrong agreement -
 *    is therefore missed, and that is recorded as a known limit.
 *  - העברתי. It means both "I transferred [to a colleague]" and "I moved [the
 *    meeting]", so it cannot say which family it belongs to.
 *  - תועדו, the RECORD plural. `tests/claimGate/claimGateCorpus.ts` records it as
 *    a miss and it stays one here; it is the same shape of gap סידרתי was and it
 *    is not in this fix's scope.
 *  - Clock times, weekdays, day anchors and day parts. Those come from
 *    `src/scheduling/lexicon/he.ts` through the verifier, so the gate and the
 *    resolver cannot disagree about what מחר means.
 */
import type { ClaimLexicon } from './types.js';

export const HE_CLAIM_LEXICON: ClaimLexicon = {
  locale: 'he',
  displayName: 'Hebrew',

  completionMarkers: [
    // ---- a meeting exists -------------------------------------------------
    // נקבעה is the exact word `aya-expanse:8b` used for a meeting that did not
    // exist: "הפגישה נקבעה בהצלחה למחר אחרי הצהריים בשעה 14:00" (§ 6.2).
    {
      forms: ['נקבעה', 'נקבעו', 'קבעתי', 'קבענו', 'אושרה', 'אושרו', 'מאושרת', 'הוזמנה', 'רשמתי', 'נרשמה'],
      family: 'MEETING',
      mode: 'COMPLETED',
    },

    // ---- a meeting moved --------------------------------------------------
    { forms: ['הועברה', 'הוזזה', 'שיניתי', 'נדחתה'], family: 'RESCHEDULE', mode: 'COMPLETED' },

    // ---- a meeting is off -------------------------------------------------
    { forms: ['בוטלה', 'בוטלו', 'ביטלתי'], family: 'CANCELLATION', mode: 'COMPLETED' },

    // ---- a callback exists, or is promised --------------------------------
    { forms: ['אתקשר', 'נתקשר', 'אחזור אליך', 'נחזור אליך', 'תקבל שיחה', 'תקבלי שיחה'], family: 'CALLBACK', mode: 'COMMITTED' },

    // ---- something was sent, or will be ----------------------------------
    // אשלח is the second half of the same `aya-expanse:8b` turn: "אשלח לך אישור
    // בדוא\"ל" - an email this agent has no tool to send.
    { forms: ['נשלח', 'נשלחה', 'שלחתי'], family: 'MESSAGE', mode: 'COMPLETED' },
    { forms: ['אשלח', 'נשלח לך', 'אשלח לך'], family: 'MESSAGE', mode: 'COMMITTED' },

    // ---- something was written down --------------------------------------
    { forms: ['תועד', 'תועדה', 'נרשם'], family: 'RECORD', mode: 'COMPLETED' },

    // ---- a person is taking it over --------------------------------------
    { forms: ['יחזרו אליך', 'יחזור אליך', 'תחזור אליך'], family: 'HANDOVER', mode: 'COMMITTED' },

    // ---- completion with nothing named -----------------------------------
    // סגרנו is colloquial and means "we have closed it". It is included rather
    // than excluded on the fail-safe rule: a contact who hears it takes it as a
    // settled arrangement, so the system should be able to show one.
    //
    // סידרתי / סידרנו are the first-person past of the same root as מסודר, which
    // was already here as the adjective. They were missing, and independent QA
    // showed `סידרתי לך פגישה למחר בשעה 15:00.` reaching a contact end to end with
    // nothing booked. They belong in ANY rather than in MEETING for the same
    // reason מסודר does: the verb says something was arranged and does not say
    // what, so any state-changing effect should satisfy it.
    { forms: ['סגרנו', 'הכל מסודר', 'הכל סגור', 'זה סגור', 'מסודר', 'סידרתי', 'סידרנו'], family: 'ANY', mode: 'COMPLETED' },
  ],

  identifierMarkers: ['מספר אישור', 'קוד אישור', 'מספר הזמנה', 'מספר סידורי', 'מספר האישור', 'אסמכתא'],

  negators: ['לא', 'אין', 'אינה', 'איני', 'טרם', 'עדיין', 'בלי', 'ללא', 'אף'],

  conditionalMarkers: ['אם', 'כאשר', 'ברגע', 'האם', 'אולי', 'במידה'],

  // Hebrew's standalone clause-joiners, coordinating (אבל, אך, אז) and
  // subordinating (כי). The coordinating ו is a PREFIX - it attaches to the word it
  // introduces and never stands as its own token - so only the words that do stand
  // alone are here, plus ולכן, which is that prefix already fused into a word a
  // model writes whole.
  //
  // אלא ("but rather") is absent on purpose: it appears almost only after a
  // negation it belongs to (`לא X אלא Y`), so breaking the clause there would be
  // separating a negator from the thing it really negates.
  clauseBreakers: ['אבל', 'אך', 'אז', 'לכן', 'ולכן', 'כי'],

  months: [
    { forms: ['ינואר'], month: 1 },
    { forms: ['פברואר'], month: 2 },
    { forms: ['מרץ', 'מרס'], month: 3 },
    { forms: ['אפריל'], month: 4 },
    { forms: ['מאי'], month: 5 },
    { forms: ['יוני'], month: 6 },
    { forms: ['יולי'], month: 7 },
    { forms: ['אוגוסט'], month: 8 },
    { forms: ['ספטמבר'], month: 9 },
    { forms: ['אוקטובר'], month: 10 },
    { forms: ['נובמבר'], month: 11 },
    { forms: ['דצמבר'], month: 12 },
  ],

  // Hebrew writes the day of the month in digits or in letters, not with an
  // ordinal suffix, so there is nothing to declare here.
  ordinalSuffixes: [],
};
