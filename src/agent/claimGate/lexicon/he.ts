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

/**
 * One verb's first person, SINGULAR and PLURAL, written down together.
 *
 * WHY THIS TYPE EXISTS - THE EIGHTH FAIL-OPEN DEFECT, AND HEBREW'S HALF OF IT
 * ---------------------------------------------------------------------------
 * This file used to declare first-person forms one string at a time, so the two
 * numbers of the same verb were independent facts and they drifted. Two verbs had
 * both (קבעתי/קבענו, סידרתי/סידרנו) and four had one, and every missing member was
 * a false claim RELEASED to a caller and PERSISTED as a spoken agent turn with zero
 * domain rows behind it:
 *
 *     ביטלנו את הפגישה שלך.                    RELEASED  (ביטלתי was listed)
 *     שלחנו לך אישור במייל.                    RELEASED  (שלחתי was listed)
 *     רשמנו אותך לפגישה מחר בשעה 14:00.        RELEASED  (רשמתי was listed)
 *     שינינו את הפגישה ליום חמישי בשעה 14:00.  RELEASED  (שיניתי was listed)
 *     סגרתי לך את הפגישה למחר בשעה 14:00.      RELEASED  (סגרנו was listed)
 *     ביטלתי את הפגישה שלך.                    the A/B control - blocked, same run
 *
 * The last row is the asymmetry pointing the other way, which is what shows the
 * defect is drift and not "Hebrew needs more plurals". `סידרתי` was added by § 14.3
 * for exactly this reason, one verb over, four independent QA rounds earlier - and
 * the round that added it did not ask whether the same gap existed anywhere else.
 *
 * WHY A PAIR AND NOT A LONGER LIST
 * ---------------------------------------------------------------------------
 * A longer list is the § 16.6 pattern: it closes the five wordings somebody reported
 * and the sixth verb drifts the same way. A PAIR makes drift impossible instead of
 * merely detectable - there is no way to write one member of `bothNumbers` without
 * writing the other, because the type will not let you. `tests/agent/
 * claimGateDetector.test.ts` then proves that nothing reached `completionMarkers` by
 * any other route, using `firstPersonNumberMarkers` below.
 *
 * Hebrew has no `completionParticiples` - deliberately, and this file says why - so
 * a missing completion form here has no second route and the miss is total. That is
 * the reason this file is the one that needed the pair.
 */
type FirstPersonPair = readonly [singular: string, plural: string];

/** Both members of every pair, flattened into the `forms` list of one family. */
function bothNumbers(...pairs: readonly FirstPersonPair[]): readonly string[] {
  return pairs.flatMap((pair) => [pair[0], pair[1]]);
}

export const HE_CLAIM_LEXICON: ClaimLexicon = {
  locale: 'he',
  displayName: 'Hebrew',

  completionMarkers: [
    // ---- a meeting exists -------------------------------------------------
    // נקבעה is the exact word `aya-expanse:8b` used for a meeting that did not
    // exist: "הפגישה נקבעה בהצלחה למחר אחרי הצהריים בשעה 14:00" (§ 6.2).
    // רשמנו was MISSING while רשמתי was here, and `רשמנו אותך לפגישה מחר בשעה
    // 14:00.` reached a caller and was persisted. `bothNumbers` is why it cannot
    // happen again for these two verbs.
    {
      forms: [
        'נקבעה',
        'נקבעו',
        'אושרה',
        'אושרו',
        'מאושרת',
        'הוזמנה',
        'נרשמה',
        ...bothNumbers(['קבעתי', 'קבענו'], ['רשמתי', 'רשמנו']),
      ],
      family: 'MEETING',
      mode: 'COMPLETED',
    },

    // ---- a meeting moved --------------------------------------------------
    // שינינו was MISSING while שיניתי was here.
    {
      forms: ['הועברה', 'הוזזה', 'נדחתה', ...bothNumbers(['שיניתי', 'שינינו'])],
      family: 'RESCHEDULE',
      mode: 'COMPLETED',
    },

    // ---- a meeting is off -------------------------------------------------
    // ביטלנו was MISSING while ביטלתי was here, and `ביטלנו את הפגישה שלך.` reached
    // a caller while the identical sentence with ביטלתי was blocked in the same run.
    { forms: ['בוטלה', 'בוטלו', ...bothNumbers(['ביטלתי', 'ביטלנו'])], family: 'CANCELLATION', mode: 'COMPLETED' },

    // ---- a callback exists, or is promised --------------------------------
    // The FUTURE first person, which was already paired in both verbs - א- is the
    // singular prefix and נ- the plural. Written through `bothNumbers` anyway, so
    // that "it happened to be complete" becomes "it cannot be otherwise".
    {
      forms: [...bothNumbers(['אתקשר', 'נתקשר'], ['אחזור אליך', 'נחזור אליך']), 'תקבל שיחה', 'תקבלי שיחה'],
      family: 'CALLBACK',
      mode: 'COMMITTED',
    },

    // ---- something was sent, or will be ----------------------------------
    // אשלח is the second half of the same `aya-expanse:8b` turn: "אשלח לך אישור
    // בדוא\"ל" - an email this agent has no tool to send.
    //
    // שלחנו was MISSING while שלחתי was here, and `שלחנו לך אישור במייל.` reached a
    // caller and was persisted.
    { forms: ['נשלח', 'נשלחה', ...bothNumbers(['שלחתי', 'שלחנו'])], family: 'MESSAGE', mode: 'COMPLETED' },
    // THE ONE PAIR THAT CANNOT BE WRITTEN AS A PAIR, stated rather than left to be
    // discovered. The plural of `אשלח` is `נשלח`, which is spelled identically to the
    // nif'al passive `נשלח` ("was sent") in the COMPLETED entry above. So "we will
    // send you a confirmation" IS detected - as MESSAGE/COMPLETED rather than
    // MESSAGE/COMMITTED, which is the same family, the same unsupportable effect and
    // the same verdict; only the audit's `mode` differs. Declaring `נשלח` here as
    // well would add a second entry that can never win a longest-match tie and would
    // read as coverage this file does not have. `firstPersonNumberMarkers` records
    // both spellings as exempt from the prefix axis, with this as the reason.
    { forms: ['אשלח', ...bothNumbers(['אשלח לך', 'נשלח לך'])], family: 'MESSAGE', mode: 'COMMITTED' },

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
    //
    // סגרתי was MISSING while סגרנו was here - the drift pointing the other way -
    // and `סגרתי לך את הפגישה למחר בשעה 14:00.` reached a caller and was persisted.
    {
      forms: [
        'הכל מסודר',
        'הכל סגור',
        'זה סגור',
        'מסודר',
        ...bothNumbers(['סגרתי', 'סגרנו'], ['סידרתי', 'סידרנו']),
      ],
      family: 'ANY',
      mode: 'COMPLETED',
    },
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

  // EMPTY, and it is a fact about the language rather than an omission. The § 21
  // clitic is an apostrophe fusing a standing auxiliary onto the word in front of it,
  // and Hebrew has no standing copula in the present tense to fuse - `הפגישה נקבעה`
  // is subject and verb with nothing between them. Hebrew's own apostrophe (גרש) is a
  // letter-modifier inside a word (`ג'ון`) and never a contraction of two words, and
  // `normalizeScript` has already dealt with it by the time a token is compared. This
  // is the same asymmetry the header argues for `completionParticiples`, arriving a
  // fourth time: English needs machinery Hebrew's morphology provides for free.
  //
  // The engine POOLS clitics across every registered locale, so an English `'s`
  // inside a Hebrew sentence is still read - which is what a code-switched
  // `הפגישה's booked` needs, and it needs nothing from this file.
  copulaClitics: [],

  // HOW HEBREW MARKS FIRST PERSON SINGULAR AGAINST PLURAL. `types.ts`
  // (`FirstPersonNumberMarker`) carries the argument: this is TEST data, and the
  // mechanism that makes drift impossible is `bothNumbers` at the top of this file.
  //
  //  - THE PAST SUFFIX is the axis the five leaked wordings sit on, and it is
  //    unambiguous: a Hebrew verb ending in -תי is first person singular past and one
  //    ending in -נו is first person plural past. No form in this file ends either
  //    way for any other reason, which is why it needs no exemptions.
  //  - THE FUTURE PREFIX is the same axis one tense over, and it is NOT unambiguous:
  //    the nif'al and pu'al passives are spelled with the same נ- and א- that mark
  //    person in the future. Every exemption below is one of those, and each one is a
  //    place the axis test stops looking rather than a place the detector stops
  //    reading. They are listed rather than the marker being dropped, because without
  //    the marker `אתקשר` could lose `נתקשר` and no test would notice.
  firstPersonNumberMarkers: [
    { attaches: 'SUFFIX', singular: 'תי', plural: 'נו' },
    {
      attaches: 'PREFIX',
      singular: 'א',
      plural: 'נ',
      notFirstPerson: [
        // nif'al passive past - "was scheduled", "was sent", "was registered",
        // "was postponed". The נ- is the binyan, not a person.
        'נקבעה',
        'נקבעו',
        'נשלחה',
        'נרשמה',
        'נרשם',
        'נדחתה',
        // Both readings at once, and the MESSAGE COMMITTED entry says what follows
        // from it: `נשלח` is the nif'al passive AND the first-person plural future
        // of `אשלח`, and it is declared once, as the passive.
        'נשלח',
        'אשלח',
        // pu'al passive past - "was approved". The א- is the root's first letter.
        'אושרה',
        'אושרו',
      ],
    },
  ],

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
  //
  // EVERY GROUP DECLARES ITS ROLE, AND HEBREW IS WHERE § 18 WAS MEASURED SECOND.
  // The § 17 rule asked only "may a negator be carried across this token", and a
  // filler built ENTIRELY out of tokens this file declares silenced the clause
  // behind it: `לא צריך כלום הפגישה נקבעה למחר בשעה 14:00.` released and persisted
  // a false booking, with `לא` a declared negator, `צריך` a declared
  // `frameBlocker` and `כלום` declared right here. Seven Hebrew wordings of that
  // shape were driven end to end. `types.ts` (`SuppressionCarrierRole`) carries the
  // argument; the roles below are what let the engine see that `לא צריך כלום` is a
  // complete impersonal clause and `הפגישה נקבעה` is a new one.
  //
  //  - THE INFLECTED PREPOSITIONS are `MODIFIER` rather than `PREPOSITION`, and
  //    that is not a slip: `לי`, `לך`, `לו` are preposition and pronoun fused into
  //    one token, so the phrase is already COMPLETE and there is no following noun
  //    phrase for it to consume. Declaring them `PREPOSITION` would let them
  //    swallow the subject of the next clause.
  //  - THE STANDING PRONOUNS are `SUBJECT`, which is the default, so they say
  //    nothing.
  //  - THE EXISTENTIAL AND THE COPULAR PAST are `VERB`: `יש`, `היה`, `הייתה`,
  //    `יהיה` satisfy the predicate a negator is looking for, which is why
  //    `לא היה כלום הפגישה נקבעה` needs `הפגישה` to be read as a NEW subject
  //    rather than as more of the same clause.
  //  - THE QUANTIFIERS are `MODIFIER` - `שום`, `כל`, `עוד`, `יותר`. This is the
  //    group `לא צריך יותר ...` is built out of.
  //  - `כלום`, `אחד` and `אחת` stay `SUBJECT`. They are PRONOUNS - `כלום לא נקבע`
  //    is a sentence with `כלום` as its subject - and `SUBJECT` is the fail-safe
  //    answer besides.
  //  - THE LIGHT PREPOSITIONS that really do take a following noun phrase are
  //    `PREPOSITION`.
  suppressionCarriers: [
    // ---- the inflected prepositions, which are single tokens in Hebrew -----
    {
      role: 'MODIFIER',
      forms: ['לי', 'לך', 'לו', 'לה', 'לנו', 'לכם', 'להם', 'בי', 'בו', 'בה', 'עלי', 'עליך', 'ממני', 'ממך'],
    },
    // ---- standing pronouns: `SUBJECT`, which is the default ----------------
    { forms: ['אני', 'אנחנו', 'אתה', 'את', 'הוא', 'היא', 'הם', 'הן', 'זה', 'זאת', 'זו'] },
    // ---- the existential and the copular past ------------------------------
    { role: 'VERB', forms: ['יש', 'היה', 'הייתה', 'יהיה'] },
    // ---- the quantifiers Hebrew negation is built with ---------------------
    { role: 'MODIFIER', forms: ['שום', 'כל', 'עוד', 'יותר'] },
    // ---- the negative-polarity pronouns, which really are pronouns ---------
    { forms: ['כלום', 'אחד', 'אחת'] },
    // ---- the light prepositions that stand alone ---------------------------
    { role: 'PREPOSITION', forms: ['עם', 'בשביל', 'מול', 'אצל'] },
  ],

  // EMPTY, AND THAT IS THE WHOLE POINT FOR HEBREW. `subjectNegators` names the
  // negators that can themselves be the SUBJECT of the predicate they negate -
  // English `nothing`, `none`, `nobody`. Hebrew has none: `לא` is a verbal
  // negator, `אין` is an existential, and `טרם`, `עדיין`, `בלי`, `ללא` and `אף`
  // are adverbial or prepositional. None of them is ever a subject.
  //
  // Hebrew is also PRO-DROP, which is what makes this matter more here than in
  // English: `לא צריך כלום` is a complete impersonal clause with no overt subject
  // at all, and `קבעתי` after it is a complete clause with its subject in the
  // morphology. So a clause-initial Hebrew negator governs its own modifiers and
  // stops, and the seven wordings QA drove end to end are all closed by that one
  // statement rather than by listing `לא צריך כלום`, `לא היה כלום` and the rest.
  subjectNegators: [],

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

  // THE § 20 AXIS IN HEBREW, AND IT IS NOT THE SAME SHAPE AS ENGLISH'S.
  //
  // English announces a time with a standing preposition - `at`, `for`, `on`.
  // Hebrew fuses it: ב- and ל- are one-letter prefixes written onto the front of
  // the word they introduce, so `בשתיים` ("at two"), `ליום חמישי` ("for Thursday")
  // and `לסוף השבוע` ("for the end of the week") carry no separate token at all.
  // A standing-word opener list would find NOTHING in any of them, which is
  // precisely how § 16.6 went wrong: a fix written in English shape and declared
  // done.
  //
  // So the prefixes are declared as ATTACHING, exactly as
  // `src/scheduling/lexicon/he.ts` declares the same two letters as attaching
  // `clockPrefixes` for `ב-15:00`. The engine strips the prefix and asks whether
  // what is left is something a rule read or something `temporalCarriers` permits.
  // `בשתיים` leaves `שתיים` - an hour spelled in letters, which this system
  // deliberately does not resolve (that file says so) - so the claim is
  // unresolved, which is the right answer for a phrase whose hour nothing here
  // can check.
  //
  // `בשעה`, `בתאריך` and `במועד` are declared as STANDING forms as well, because a
  // model writes them whole and the longest match at a position should take the
  // whole word rather than splitting `ב` off it.
  //
  // THE COST OF THE FUSED PREFIX IS REAL AND IT IS ACCEPTED. Hebrew writes
  // ordinary adverbials the same way - `בהצלחה` ("successfully"), `בקלות`,
  // `בשמחה` - so those look exactly like a fused temporal phrase and are
  // unresolvable by the same rule. They are listed in `temporalCarriers` below by
  // name. One that nobody listed costs a regeneration of a true sentence, which is
  // the direction every list in this file is written in.
  temporalOpeners: [
    { forms: ['בשעה', 'בתאריך', 'במועד', 'בסביבות', 'סביב', 'עד'], attaches: false },
    { forms: ['ב', 'ל'], attaches: true, attachedSeparators: ['', '-'] },
  ],

  // What may stand inside a Hebrew temporal phrase without being the day or the
  // hour. `types.ts` argues the inversion; what follows is what Hebrew needs.
  //
  // THE FUSED-PREFIX REMAINDERS are the bulk of it and they are the price of the
  // opener rule above: `לך` and `לכם` ("to you") are a preposition and a pronoun in
  // one token, `בהצלחה` and `בהחלט` are adverbials, `בבקשה` is "please". Each is a
  // word the ב-/ל- rule will strip a prefix off, and each names no time.
  //
  // THE CLASSIFIERS are the second group. Hebrew says `ליום חמישי` - "for the day
  // Thursday" - so `יום` stands between the opener and the weekday; `שעה` does the
  // same for a clock time. Both are listed because the weekday and the hour beside
  // them ARE read, and the classifier is the only leftover.
  //
  // DELIBERATELY ABSENT, exactly as in `en.ts`: `סוף`, `תחילת`, `אמצע`, `השבוע`,
  // `שבוע`, `חודש`, `חצי`, `רבע`, `רביע`, and every hour spelled in letters -
  // `אחת`, `שתיים`, `שלוש`, `ארבע` ... Those are the words that make
  // `לסוף השבוע` and `בשתיים וחצי` assertions about WHEN, and they are the reason
  // those two sentences must not be certified. `וחצי` ("and a half") is absent for
  // the same reason.
  // The engine pools this locale's determiners, domain objects, completion forms,
  // identifier markers, negators, conditionals, blockers, clause joiners and
  // suppression carriers in as well, and Hebrew is where that matters most:
  // without `negators` pooled, the fused ל- opener would split `לא` into a
  // preposition and the letter `א` and report it, on 855 corpus rows. The engine
  // then DROPS any pooled form the scheduling lexicon reads as naming a when, which
  // is why `אחת` and `שתיים` are not permitted by the back door.
  temporalCarriers: [
    // ---- the classifiers a day or an hour stands behind --------------------
    // `יום` and `שעה` are `relativeOffset.units` in `src/scheduling/lexicon/he.ts`,
    // so the engine's filter would drop them; they are re-permitted here because
    // Hebrew says `ליום חמישי` ("for the day Thursday") and `בשעה 14:00`, where the
    // classifier is the only leftover beside a weekday and an hour that ARE read.
    'יום', 'ליום', 'ביום', 'שעה', 'השעה', 'תאריך', 'מועד',
    // ---- fused pronouns: preposition and person in one token ---------------
    'ך', 'כם', 'כן', 'י', 'נו', 'ו', 'ה', 'הם', 'לך', 'לכם', 'לי', 'לנו', 'לו', 'לה', 'להם', 'אליך', 'אליכם',
    // ---- the ordinary ב- adverbials, which look like a fused time ----------
    'הצלחה', 'החלט', 'קלות', 'שמחה', 'בקשה', 'וודאי', 'ודאי', 'סדר', 'דיוק', 'זמן', 'כלל',
    'בהצלחה', 'בהחלט', 'בקלות', 'בשמחה', 'בבקשה', 'בוודאי', 'בדיוק', 'בזמן', 'בסדר', 'בכלל',
    // ---- the reassurance nouns, and the infinitives of worrying -----------
    // DELIBERATELY ABSENT from `suppressionCarriers` above, and that must not
    // change: `אין בעיה הפגישה נקבעה למחר.` is a DETECTED claim precisely because
    // `בעיה` ends the negator's reach. They are permitted HERE because the two
    // lists answer different questions - there, whether a negator governs a
    // predicate; here, whether a word could be an hour. `בעיה` could not.
    // Measured: without them the ב-/ל- rule reported `עיה`, `דאוג` and `התקשר` on
    // 900 corpus rows, all of them honest Hebrew reassurance wording.
    'בעיה', 'עיה', 'דאגה', 'אגה', 'צורך', 'ורך', 'נורא', 'מה',
    'לדאוג', 'דאוג', 'להתקשר', 'התקשר', 'לשלוח', 'שלוח', 'לבדוק', 'בדוק', 'לקבוע', 'קבוע',
    // ---- the frame adverbs, which are the corpus's own Hebrew adverb axis ---
    // `ADVERB_FRAME_MATRIX` crosses these with every Hebrew frame, so a slot that
    // runs into one of them reports on 48 committed rows. None of them is a time.
    'כבר', 'עכשיו', 'סופית', 'רשמית', 'שוב',
    // ---- nouns a ב- prefix is written onto in this system's own traffic ------
    // `במערכת` ("in the system"), `בדוא"ל` ("by e-mail" - the token is `דוא`
    // because `readTokens` splits on the quote).
    // `ל` stands alone here because `readTokens` splits `בדוא"ל` on the quote,
    // leaving the ־ל as its own token.
    'מערכת', 'דוא', 'ל',
    // ---- politeness ---------------------------------------------------------
    'תודה', 'אוקיי', 'מעולה', 'סבבה',
  ],

  // What ends a Hebrew temporal phrase by introducing something else: the
  // companion (`עם`), the subject-matter prepositions, and `אחרי`/`לפני` - which
  // are the direct counterparts of English `after` and `before` and are here for
  // the same reason `en.ts` gives, namely that they introduce an anchor this gate
  // cannot resolve at all.
  //
  // `אחרי הצהריים` ("afternoon") is NOT lost to this: it is a `dayPart` form in
  // `src/scheduling/lexicon/he.ts`, so `detectTime` consumes both its tokens
  // before the slot rule ever looks at them, and a consumed token is never an
  // ender. `tests/claimGate/claimGateCorpus.ts` asserts that sentence by name.
  temporalSlotEnders: ['עם', 'לגבי', 'בנוגע', 'בקשר', 'אחרי', 'לפני', 'אם'],
};
