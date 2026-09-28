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

  // EMPTY, and that is the whole point of this file. The participle rule exists because
  // English `booked` is ambiguous between a completion and an intention, so it cannot be
  // a completion form on its own and every English form is therefore a defeatable
  // FRAME. Hebrew has no such ambiguity: `נקבעה` IS the completion, it is already a
  // `completionMarker` above, and it is one token - so there is nothing to disambiguate
  // and nothing an adverb can get inside. Declaring participles here would add a second
  // route to a claim Hebrew already detects directly, for no coverage and some risk.
  //
  // This is the same asymmetry the header argues, arriving a third time: English needs
  // machinery that Hebrew's morphology provides for free.
  completionParticiples: [],

  // Objects ARE declared, and they are not for Hebrew's own use. The engine pools
  // domain objects across every registered locale, so these are what let an ENGLISH
  // participle pair with a Hebrew object: `הפגישה is now booked`, `קבעתי the meeting`
  // and the rest of the code-switching the eval corpus actually contains. Definite and
  // indefinite are both listed because the article is a ה- PREFIX in Hebrew and tokens
  // are whole words.
  domainObjects: [
    { forms: ['פגישה', 'הפגישה', 'פגישות', 'הפגישות', 'מפגש', 'המפגש'], family: 'MEETING' },
    { forms: ['שיחה', 'השיחה', 'שיחת', 'טלפון'], family: 'CALLBACK' },
    { forms: ['אימייל', 'האימייל', 'מייל', 'הודעה', 'ההודעה', 'דוא"ל'], family: 'MESSAGE' },
    { forms: ['יומן', 'היומן', 'תזכורת', 'התזכורת'], family: 'ANY' },
  ],

  identifierMarkers: ['מספר אישור', 'קוד אישור', 'מספר הזמנה', 'מספר סידורי', 'מספר האישור', 'אסמכתא'],

  negators: ['לא', 'אין', 'אינה', 'איני', 'טרם', 'עדיין', 'בלי', 'ללא', 'אף'],

  // WHAT A HEBREW NEGATOR MAY REACH ACROSS - and this file is where the defect that
  // made the field necessary actually lived.
  //
  // `לא` and `אין` have to be in `negators` above: `הפגישה לא נקבעה עדיין.` and
  // `אין פגישה ביומן.` are the truthful sentences a model must be able to say. And
  // Hebrew's most ordinary reassurance fillers are built on exactly those two words -
  // `אין בעיה`, `אין דאגה`, `אין שום בעיה`, `אין צורך לדאוג`, `לא נורא`. With no comma
  // between the filler and the claim, the negator and the completion land in ONE clause,
  // so clause scope (§ 15) and precedence (`at or before`) both hold and both let it
  // through. Independent QA drove five of those wordings through the real turn service
  // and every one was released to the caller AND persisted with an empty ledger, while
  // the same sentence with a comma after `אין בעיה` was correctly blocked.
  //
  // English escaped this because `en.ts` could afford to omit bare `no` from its
  // negators - it says so in its own comment. Hebrew cannot omit `אין` or `לא`, so the
  // asymmetry had to be closed in the engine's RULE rather than in the word list, which
  // is what `types.ts` (`suppressionCarriers`) describes.
  //
  // WHAT IS HERE: the closed-class material Hebrew puts between a negator and the verb
  // it negates. The inflected prepositions (`לי`, `לך`, `לו` ... - "to me", "to you"),
  // which is what `אין לי אפשרות לשלוח אימייל.` needs; the standing pronouns; the
  // copular/existential `יש` and `הוא`/`היא`; `שום` and `כלום`, the quantifier and the
  // negative-polarity pronoun that Hebrew negation is built with (`לא קבעתי כלום
  // עדיין.`); and `זה`/`זאת`. The engine adds `frameDeterminers` (`את`, `של`, the
  // possessives), `domainObjects`, `frameBlockers` (`יכול`, `צריך`, `כדי`) and the
  // negators and conditionals themselves, so none of those is repeated.
  //
  // WHAT IS DELIBERATELY NOT HERE, AND IT IS THE WHOLE POINT: `בעיה`, `דאגה`, `צורך`,
  // `נורא`, `מה`, `לדאוג`, `להתקשר`. Those are the complements the leaking fillers are
  // built out of. Each one ENDS a negator's reach, which is what makes
  // `אין בעיה הפגישה נקבעה למחר.` a detected claim with no punctuation anywhere in it.
  // Adding one of them here would re-open the defect, in the one direction that
  // releases a false sentence to a customer - so this list must never grow a noun that
  // could be a nominal predicate.
  //
  // Hebrew's infinitive is a ל- PREFIX rather than a standing word, so there is no
  // equivalent of English `to` to declare, and there is no way to enumerate the
  // infinitives. That is a stated shortfall rather than a claim of completeness, and it
  // costs precision only: an unlisted infinitive ends a negator's reach and the
  // completion after it is DETECTED, which the verifier then checks against real state.
  // It is the same shortfall `frameBlockers` records below, for the same reason.
  suppressionCarriers: [
    // ---- the inflected prepositions, which are single tokens in Hebrew -----
    'לי',
    'לך',
    'לו',
    'לה',
    'לנו',
    'לכם',
    'להם',
    'בי',
    'בו',
    'בה',
    'עלי',
    'עליך',
    'ממני',
    'ממך',
    // ---- standing pronouns -------------------------------------------------
    'אני',
    'אנחנו',
    'אתה',
    'את',
    'הוא',
    'היא',
    'הם',
    'הן',
    'זה',
    'זאת',
    'זו',
    // ---- the existential and the quantifiers Hebrew negation is built with --
    'יש',
    'היה',
    'הייתה',
    'יהיה',
    'שום',
    'כלום',
    'אחד',
    'אחת',
    'כל',
    'עוד',
    'יותר',
    // ---- the light prepositions that stand alone ---------------------------
    'עם',
    'בשביל',
    'מול',
    'אצל',
  ],

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

  // The words that may not stand inside a completion frame. Hebrew needs far less
  // of this than English does, and the reason is the reason this file exists at
  // all: the Hebrew forms above are SINGLE WORDS, and a one-token form has no
  // inside. Independent QA confirmed that directly - `הפגישה שלך כבר נקבעה` (with
  // the adverb `כבר` inside it) was detected while every English frame with the same
  // adverb inserted leaked, which is what localised that defect to English.
  //
  // So this list only guards the handful of multi-token forms - `אחזור אליך`,
  // `תקבל שיחה`, `הכל מסודר`, `אשלח לך` - and it carries the modal and intention
  // words that would turn one of those into a plan: "I can", "we can", "I need",
  // "I want", "in order to", "let us".
  //
  // Hebrew's infinitive is a ל- PREFIX rather than a standing word, so there is no
  // `to` to list here and no way to enumerate the infinitives; that is a stated
  // shortfall of this list and not a claim of completeness. It costs precision only
  // - `types.ts` explains why a missing blocker can never cost a leak.
  frameBlockers: [
    'יכול',
    'יכולה',
    'אוכל',
    'נוכל',
    'אפשר',
    'צריך',
    'צריכה',
    'רוצה',
    'מנסה',
    'אנסה',
    'ננסה',
    'עומד',
    'מתכוון',
    'כדי',
    'בוא',
    'בואי',
    'נתחיל',
  ],

  // Noun-phrase material: the accusative marker את and the standing possessives. The
  // DEFINITE article is absent because in Hebrew it is a ה- prefix fused to the word
  // it defines, so there is no token to list - which is the same reason
  // `ordinalSuffixes` is empty here and `clauseBreakers` omits the ו- prefix.
  frameDeterminers: ['את', 'של', 'שלי', 'שלך', 'שלו', 'שלה', 'שלנו', 'שלכם', 'אותו', 'אותה'],

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
