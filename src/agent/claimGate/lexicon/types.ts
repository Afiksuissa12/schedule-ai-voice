/**
 * The declarative shape of one locale's CLAIM vocabulary.
 *
 * WHY THIS IS DATA AND NOT A REGEX
 * ---------------------------------------------------------------------------
 * The defect this gate exists to close was recorded in two languages at once
 * (`docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` §§ 6.2 and 6.5.4): an English
 * model said a callback was booked when no tool call had been made, and a Hebrew
 * model said a meeting was scheduled when no tool call had been made. A detector
 * built as English regexes with Hebrew alternatives bolted on would repeat the
 * exact mistake Mission 2B fixed in the scheduling resolver - JavaScript's `\b`
 * is defined on ASCII word characters, so `\bנקבעה\b` never matches, and an
 * English grammar cannot be extended to Hebrew by adding alternatives to it
 * (`src/scheduling/lexicon/types.ts`).
 *
 * So this file follows the Mission 2B pattern exactly: a locale is DATA, the
 * engine (`../detector.ts`) holds no language-specific literal, and adding a
 * third language is adding a module and registering it.
 *
 * THE TWO LANGUAGES NEED DIFFERENT SHAPES, AND THAT IS THE ARGUMENT
 * ---------------------------------------------------------------------------
 * English asserts completion with a FRAME - `is booked`, `has been confirmed`,
 * `you are all set` - and the bare participle `booked` is ambiguous between a
 * completed effect and an intention (`let me get that booked`). Hebrew asserts
 * completion with a single inflected word - `נקבעה`, `בוטלה`, `אושרה` - because
 * the passive past is carried by the morphology.
 *
 * A single field shape that covered both without a lexicon would have to be
 * either English-shaped (and miss every Hebrew form) or single-token (and fire
 * on `booked` in `let me get that booked`). Declaring the forms per locale is
 * what lets each language be described the way it actually works.
 *
 * FORMS ARE MATCHED AS WHOLE TOKEN SEQUENCES, NEVER AS SUBSTRINGS
 * ---------------------------------------------------------------------------
 * Every `forms` entry is a space-separated token sequence in the shape
 * `normalizeScript` + lower-casing produce, and the engine prefers the LONGEST
 * form that matches at a position. `'has been booked'` matches three
 * consecutive tokens; `'נקבעה'` matches one. Token equality works in every
 * script, which is the whole reason it is used.
 */

/**
 * The kind of real-world effect a claim is about.
 *
 * `ANY` is for forms that assert completion without naming what completed -
 * English `all set`, Hebrew `סגרנו`. They are satisfied by any state-changing
 * effect in the ledger, and by nothing else: an availability check is not an
 * effect a contact can be told is "all set", because nothing was booked.
 */
export type ClaimEffectFamily =
  | 'MEETING'
  | 'RESCHEDULE'
  | 'CANCELLATION'
  | 'CALLBACK'
  | 'MESSAGE'
  | 'RECORD'
  | 'HANDOVER'
  | 'ANY';

/**
 * Whether the form says the effect HAS happened or WILL happen.
 *
 * Both are material, and the brief is explicit that `will call` counts. The
 * distinction is kept because it is what a regeneration instruction has to
 * report accurately: "you said a callback exists" and "you said you would place
 * one" are different sentences to correct.
 */
export type ClaimAssertionMode = 'COMPLETED' | 'COMMITTED';

/** One way this locale asserts that a material effect is real. */
export interface CompletionMarkerEntry {
  readonly forms: readonly string[];
  readonly family: ClaimEffectFamily;
  readonly mode: ClaimAssertionMode;
}

/**
 * A bare completion verb form, which is a claim ONLY beside a domain object.
 *
 * WHY THIS EXISTS AS WELL AS `CompletionMarkerEntry`
 * ---------------------------------------------------------------------------
 * `booked` cannot be a completion form on its own: `let me get that booked` is the
 * HONEST wording, and `../lexicon/en.ts` argues at length why firing on the bare
 * participle would get this gate switched off. That exclusion is what made every
 * English form a multi-token FRAME, and a frame is defeatable - twice over, by the
 * same mechanism one word narrower each time:
 *
 *   I have booked your meeting for Thursday.                    a frame, caught
 *   I have now booked your meeting for Thursday.                one skipped token
 *   I have finally AND officially booked your meeting.           a clause joiner, which
 *                                                               may never be skipped
 *   Your meeting has, at long last, finally been booked.         four skipped tokens
 *
 * The first was a live leak (`docs/MISSION_2D_CLAIM_GATE.md` § 16.1). The bounded-run
 * rule closed it, and left the last two as stated misses - which is the same shape of
 * residual the previous two fixes left, and the shape the next reviewer found each
 * time.
 *
 * WHAT THIS RULE ADDS, AND THE ONE THING THAT MAKES IT SAFE
 * ---------------------------------------------------------------------------
 * A bare participle is ambiguous between a completion and an INTENTION. What
 * disambiguates it is not the distance to an auxiliary - it is whether the sentence
 * names a thing this system can actually create. `let me get that booked` has no
 * such object; `I have finally and officially booked your MEETING` does.
 *
 * So a participle within a bounded distance of a `domainObject` is a claim, no matter
 * how the words in between are arranged, and the engine then applies the same three
 * suppression rules plus `frameBlockers` to the whole clause. That resolves the
 * ambiguity in the direction the brief requires - uncertainty is treated as
 * unsupported - and the cost of being wrong is one regeneration of a sentence a
 * supported ledger would have released unchanged.
 *
 * This rule is a FALLBACK: `../detector.ts` runs it only in a clause where no
 * completion frame matched, so it cannot double-count a claim a frame already found
 * and cannot change any verdict a frame already produced.
 */
export interface CompletionParticipleEntry {
  readonly forms: readonly string[];
  readonly family: ClaimEffectFamily;
  readonly mode: ClaimAssertionMode;
}

/**
 * A noun naming something this system can actually create or change.
 *
 * KEPT NARROW ON PURPOSE, and the narrowness is the precision argument. `details`,
 * `options`, `time` and `price` are deliberately absent: `I have checked and confirmed
 * your DETAILS` asserts nothing this gate is about, and a list that included `details`
 * would flag it. What is here is what a tool in this system writes a row for - a
 * meeting, a callback, a diary entry - plus the message families nothing can send,
 * which is why a promise about one is unsupportable by construction.
 *
 * `family` refines the participle's own family when the participle is generic. `booked`
 * is MEETING by default and `booked ... callback` is CALLBACK, which is strictly better
 * than the frames manage (§ 8 limit 9 exists because a frame cannot see its object).
 * `ANY` means "do not refine".
 */
export interface DomainObjectEntry {
  readonly forms: readonly string[];
  readonly family: ClaimEffectFamily;
}

/**
 * What a carrier token DOES in the stretch between a suppressor and the form it
 * may govern.
 *
 * WHY THE CARRIER LIST HAD TO GROW A ROLE - THE FIFTH FAIL-OPEN DEFECT
 * ---------------------------------------------------------------------------
 * `suppressionCarriers` answered one question - may a negator be carried ACROSS
 * this token - and answering only that made the list fail open against a filler
 * built ENTIRELY out of carriers. `not` is a declared negator, `at` and `all` are
 * declared carriers, `i` is a declared carrier: so `Not at all I have booked your
 * meeting for Thursday at 2pm.` had nothing but carrier material between the
 * negator and the frame, `reachesForward` said the negator governed it, and the
 * sentence was RELEASED to the caller and PERSISTED against an empty ledger.
 * Independent QA drove six English and seven Hebrew wordings of that shape
 * through the real `AgentTurnService`; `docs/MISSION_2D_CLAIM_GATE.md` § 18 has
 * the table. The comma version was blocked in the same run, which is the third
 * time this gate's verdict has turned on a punctuation mark.
 *
 * `MAX_CARRIERS_A_SUPPRESSOR_MAY_REACH_ACROSS` was named in `../detector.ts` as
 * the mitigation for exactly this case and it does not mitigate it: the leaking
 * fillers are two to four tokens long and sit comfortably inside the bound.
 *
 * WHY A ROLE AND NOT A SHORTER CARRIER LIST
 * ---------------------------------------------------------------------------
 * Deleting `at`, `all`, `else`, `more`, `כלום` or `יותר` from the carrier lists
 * would close the leaks and break honest wording: `Nothing at all has been booked
 * yet.`, `Nothing at all is booked yet.` and `לא צריך כלום הפגישה לא נקבעה עדיין.`
 * are all clean today and all need those tokens carried across. The structural
 * difference between the honest set and the leaking set is not the vocabulary and
 * not the distance - it is that a NEW PREDICATION intervenes in the leaking ones
 * and does not in the honest ones. Deciding that needs to know what each token
 * IS, so each group now says so.
 *
 * THE DEFAULT IS THE FAIL-SAFE ANSWER. `role` is optional and an entry that omits
 * it is `SUBJECT` - "this token might head a fresh subject" - which ENDS a
 * negator's reach and therefore costs one regeneration of a sentence that was
 * true. A group mis-declared as `MODIFIER`, `VERB` or `PREPOSITION` is the
 * direction that costs coverage, so those three are the ones a reader should
 * check, and `en.ts` and `he.ts` argue each group where it is declared.
 */
export type SuppressionCarrierRole =
  /**
   * May head a fresh clause SUBJECT: the pronouns, and (supplied by the engine)
   * the domain-object nouns. A subject standing where the suppressor is still
   * looking for its PREDICATE is a new clause, and the suppressor does not reach
   * into it.
   */
  | 'SUBJECT'
  /**
   * An auxiliary, a copula or a transitive verb. It SATISFIES the predicate the
   * suppressor was looking for and takes what follows as its complement, which is
   * why `I don't have your meeting booked.` stays clean: `your meeting` is the
   * object of `have`, not the subject of a new clause.
   */
  | 'VERB'
  /**
   * Takes exactly ONE noun phrase as its complement, so the NP after it belongs to
   * the suppressor's own phrase rather than starting a new clause. `Nothing in the
   * diary is booked.` and `None of your meetings are booked.` are what this buys.
   */
  | 'PREPOSITION'
  /**
   * An adverb, a quantifier or a particle. It heads nothing and satisfies nothing:
   * `at all`, `else`, `more`, `יותר`. This is the class the leaking fillers are
   * built out of.
   */
  | 'MODIFIER';

/**
 * One group of carrier tokens, with what they do.
 *
 * `forms` is matched exactly as every other `forms` field is - whole tokens, in
 * the shape `normalizeScript` plus lower-casing produce.
 */
export interface SuppressionCarrierEntry {
  readonly forms: readonly string[];
  /** Defaults to `SUBJECT`, which is the fail-safe answer. See the role type. */
  readonly role?: SuppressionCarrierRole;
}

/**
 * A written contraction that fuses a COPULA or an AUXILIARY onto the word before it.
 *
 * WHY THIS FIELD EXISTS - THE EIGHTH FAIL-OPEN DEFECT, AND IT IS THE FIRST ONE
 * ABOUT TOKENISATION
 * ---------------------------------------------------------------------------
 * `../text.ts` keeps an apostrophe INSIDE a token on purpose, so `you're` and
 * `o'clock` stay whole. The consequence nobody followed through is that a copula
 * fused to a NOUN subject is inside the noun's token too:
 *
 *     Your meeting is booked for Thursday at 2pm.       DETECTED  (the A/B control)
 *     Your meeting's booked for Thursday at 2pm.        RELEASED, persisted
 *     Your appointment's confirmed for Thursday at 2pm. RELEASED, persisted
 *     The meeting's been booked for Thursday at 2pm.    RELEASED, persisted
 *     Your callback's arranged for 3pm tomorrow.        RELEASED, persisted
 *
 * Independent QA drove all four through the real `AgentTurnService`, the real
 * `ToolDispatcher` and real SQLite: every one reached the caller with
 * `outcome=NO_MATERIAL_CLAIM`, was persisted as a spoken AGENT turn, and left zero
 * domain rows behind it. The control was blocked in the same run.
 *
 * BOTH routes to the claim fail on the same token. The FRAME route, because
 * `is booked` needs an `is` token and the copula is fused into `meeting's`. And the
 * bare-participle fallback (§ 16.3b), which exists precisely to catch a participle
 * whose frame was defeated, because `domainObjects` declares `meeting` and the token
 * says `meeting's`.
 *
 * `en.ts` had ALREADY reasoned about exactly this tokenisation: `that's`, `it's` and
 * `you're` are listed there as whole completion forms, with the argument written
 * beside them. It was applied only to PRONOUN subjects. A noun subject is the
 * commonest third-person spelling a model writes.
 *
 * WHY THIS IS A CLITIC AND NOT THREE MORE NOUNS
 * ---------------------------------------------------------------------------
 * Listing `meeting's`, `appointment's` and `callback's` would be the § 16.6 pattern
 * for the eighth time - an enumeration exactly as wide as its author's imagination,
 * with the next noun leaking. The apostrophe clitic is a property of the WRITING
 * SYSTEM and not of the vocabulary, so it is declared once here and the engine reads
 * a token that carries it BOTH as itself and as its stem plus the copula. Nothing
 * downstream learns a noun list.
 *
 * THE INCOMPLETENESS OF THIS LIST IS ON THE FAIL-OPEN SIDE, which is why it is two
 * entries long and about morphology rather than about words. A clitic nobody declares
 * is a miss; a copula nobody declares is a miss. Both are checkable by asking what
 * apostrophe contractions the language has, which is a closed question in a way
 * "which nouns does a model write" is not.
 *
 * Empty is the right answer for a locale that writes no such contraction. Hebrew
 * declares it empty and means it: Hebrew has no standing copula in the present tense,
 * so there is nothing for an apostrophe to fuse.
 */
export interface CopulaCliticEntry {
  /** The written suffix, apostrophe included, lower-cased - `'s`. */
  readonly suffix: string;
  /**
   * The whole tokens this suffix may stand for. One extra reading of the sentence
   * per entry, unioned with the text as written.
   *
   * `'s` is `is` and `has` and a possessive and `let us`, and no rule can tell them
   * apart without a parser this gate does not have. So both verbal readings are
   * declared, the possessive needs no entry because reading it as a copula produces
   * no completion frame, and the residue is resolved in the fail-safe direction: an
   * extra reading may only ADD suspicion, so a wrong one costs at most one
   * regeneration of a true sentence and can never release a false one.
   */
  readonly copulas: readonly string[];
}

/**
 * How this locale spells the FIRST PERSON SINGULAR and PLURAL of the same verb.
 *
 * WHY THIS FIELD EXISTS - THE OTHER HALF OF THE EIGHTH FINDING, AND IT IS AN AXIS
 * AND NOT A WORD LIST
 * ---------------------------------------------------------------------------
 * `he.ts` paired singular and plural for two verbs and carried ONE member for four
 * others, and every missing member was a released, persisted false claim:
 *
 *     ביטלנו את הפגישה שלך.                    RELEASED, persisted (ביטלתי was listed)
 *     שלחנו לך אישור במייל.                    RELEASED, persisted (שלחתי was listed)
 *     רשמנו אותך לפגישה מחר בשעה 14:00.        RELEASED, persisted (רשמתי was listed)
 *     שינינו את הפגישה ליום חמישי בשעה 14:00.  RELEASED, persisted (שיניתי was listed)
 *     סגרתי לך את הפגישה למחר בשעה 14:00.      RELEASED, persisted (סגרנו was listed)
 *     ביטלתי את הפגישה שלך.                    the A/B control - blocked, same run
 *
 * The last one is the asymmetry in the OTHER direction, which is what shows this is
 * not "Hebrew needs more plurals": it is that the two numbers were written down
 * independently, so they drifted. `סידרתי` was added by § 4 for exactly this reason,
 * one verb over, four QA rounds earlier. Hebrew has no `completionParticiples` - and
 * says so, deliberately - so there is no second route and a missing member is a total
 * miss.
 *
 * WHAT THIS FIELD IS FOR, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * The FIX is that each locale now GENERATES both numbers from one declaration, so the
 * two cannot drift: `he.ts` declares `['ביטלתי', 'ביטלנו']` as a pair and crosses it
 * into `completionMarkers`, exactly as `en.ts` crosses its subject prefixes across its
 * verbs. Generation makes drift impossible rather than merely detectable, which is why
 * it is the mechanism and this field is not.
 *
 * What this field adds is the PROOF that nothing escaped the generator. It declares
 * how the language marks the person/number axis - a suffix or a prefix, and its two
 * spellings - so a test can walk every completion form the locale declares, ask which
 * ones are first person, and require the counterpart to be declared too, in the same
 * family and the same mode. A hand-written entry that slips past the generator then
 * fails a test instead of reaching a caller.
 *
 * THE FAIL-SAFE DIRECTION FOR THIS FIELD IS "REQUIRE THE COUNTERPART". A marker
 * missing from a locale means the test asks for nothing and drift goes unnoticed; a
 * marker declared too widely means the test asks for a counterpart that should not
 * exist, which FAILS LOUDLY and is corrected in a minute. So a locale declares every
 * marker it can, and `notFirstPerson` - the escape hatch - carries a reason per entry
 * and is the one part of this field that has to be audited.
 */
export interface FirstPersonNumberMarker {
  /** Where the person/number inflection sits in the written form. */
  readonly attaches: 'PREFIX' | 'SUFFIX';
  /** How the first-person SINGULAR of a verb is spelled at that position. */
  readonly singular: string;
  /** How the first-person PLURAL of the SAME verb is spelled at that position. */
  readonly plural: string;
  /**
   * Forms this marker must NOT be read as first person, each with its reason
   * recorded beside it where the locale declares it.
   *
   * Hebrew needs this and English does not: the nif'al and pu'al passives are
   * spelled with the same `נ` and `א` that mark the first-person future, so
   * `נקבעה` ("was scheduled") is indistinguishable by prefix from a first-person
   * plural. An entry here is a place the axis test stops looking, so each one is a
   * small fail-open hole in the PROOF - never in the detector - and the list is
   * kept to the forms whose morphology genuinely collides.
   */
  readonly notFirstPerson?: readonly string[];
}

/** A month name, so `5 March` can be compared against a resolved instant. */
export interface MonthEntry {
  readonly forms: readonly string[];
  /** 1 = January, Luxon's numbering. */
  readonly month: number;
}

/**
 * A word that ANNOUNCES a day or a time is about to be named.
 *
 * WHY THIS FIELD EXISTS - THE SEVENTH FAIL-OPEN DEFECT, AND THE FIRST IN THE
 * VERIFIER RATHER THAN THE DETECTOR
 * ---------------------------------------------------------------------------
 * `detectDay` and `detectTime` read the SAME locale data the scheduling resolver
 * reads, and they read it with the opposite discipline.
 * `src/scheduling/naturalLanguage.ts` has refused any phrase carrying a token no
 * rule accounted for since § 8.3 - "a phrase may resolve only if EVERY
 * non-whitespace token was consumed by a rule" - because silently dropping a word
 * is what booked `מחר ב-15:00` for TODAY. The gate's readers dropped them: a form
 * that matched was recorded and everything else in the sentence was ignored.
 *
 * So `assertedDay` / `assertedTime` came back `null` for a phrase the detector
 * could not read, `verifier.ts` read `null` as NOTHING ASSERTED rather than as
 * UNCERTAINTY, and the claim skipped the day and time comparison entirely and was
 * certified SUPPORTED. Independent QA drove eleven such sentences through the real
 * `AgentTurnService`, the real `ToolDispatcher` and real SQLite against a booking
 * that really existed on THURSDAY AT 15:00:
 *
 *     Your meeting is booked for Thursday at half past four.    SUPPORTED, persisted
 *     Your meeting is confirmed for Thursday at two thirty.     SUPPORTED, persisted
 *     Your meeting is booked for Thursday at lunchtime.         SUPPORTED, persisted
 *     Your meeting is booked for this weekend at 3pm.           SUPPORTED, persisted
 *     Your meeting is booked for two days from now at 3pm.      SUPPORTED, persisted
 *     Your meeting is booked for Thursday at 4:30pm.            the CONTROL - blocked
 *     Your meeting is booked for Saturday at 3pm.               the CONTROL - blocked
 *
 * The two controls are the finding: the gate HAS the WRONG_DAY and WRONG_TIME
 * concepts and applies them, and the verdict turned only on whether the model
 * happened to write `4:30pm` or `half past four`. `docs/MISSION_2D_CLAIM_GATE.md`
 * § 20 has the whole table, in both languages.
 *
 * WHY AN OPENER AND NOT MORE TIME VOCABULARY
 * ---------------------------------------------------------------------------
 * The obvious patch is to teach the time lexicon `half past` and `quarter to`.
 * That is § 16.6's pattern for the eighth time: the next round arrives with
 * `twenty past three`, and every value nobody listed is a LEAK. The fix has to be
 * stated at the level of the AXIS.
 *
 * The axis is: WHERE IN A SENTENCE A DAY OR A TIME IS ALLOWED TO BE. A day and a
 * time do not float free in either registered language - they stand after a word
 * that introduces them (`at`, `on`, `for`, Hebrew's ב- and ל- prefixes). That word
 * is a closed class of PREPOSITIONS, which is exactly what the temporal NOUNS and
 * the hour SPELLINGS are not. So the locale declares the openers, the engine reads
 * the stretch after each one, and anything in it that the day and time readers did
 * not consume and that `temporalCarriers` does not permit is UNRESOLVED - which
 * the verifier then treats as uncertainty, which is unsupported, which is one
 * regeneration.
 *
 * THIS IS THE ONE ENUMERATION IN THIS FIX THAT IS NOT INVERTED, and saying so is
 * the point. A missing OPENER costs a miss: a temporal phrase introduced by a
 * preposition nobody listed is never examined. What makes that acceptable where
 * listing `half past` is not, is that the opener class is closed and tiny - a
 * language has a dozen temporal prepositions and an unbounded number of ways to
 * say an hour - and that a missing opener loses only the phrases that preposition
 * introduces, while a missing hour spelling loses that hour behind EVERY
 * preposition. `temporalCarriers`, which is the list that decides whether a slot
 * is resolved, IS inverted in the usual direction.
 *
 * `attaches` mirrors `ClockPrefixEntry` in `src/scheduling/lexicon/types.ts` and
 * exists for the same language: Hebrew writes `ב-15:00`, `ב15:00`, `בשתיים` and
 * `ליום חמישי` with the preposition FUSED to the word it introduces, so there is
 * no standing token to match and the opener has to be stripped off the front.
 */
export interface TemporalOpenerEntry {
  readonly forms: readonly string[];
  /** True when this locale writes the opener fused to the word it introduces. */
  readonly attaches: boolean;
  /** What may stand between a fused opener and its word. Defaults to `['']`. */
  readonly attachedSeparators?: readonly string[];
}

/**
 * One locale's complete claim vocabulary. Data only - no functions, no regexes,
 * no control flow.
 */
export interface ClaimLexicon {
  /** Short stable id recorded on every detected claim, e.g. `en`, `he`. */
  readonly locale: string;
  /** For an audit detail a human reads. */
  readonly displayName: string;
  readonly completionMarkers: readonly CompletionMarkerEntry[];
  /**
   * Bare completion verb forms, which assert something only beside a domain object.
   *
   * `CompletionParticipleEntry` carries the whole argument. Empty is the right answer
   * for a locale whose completion words are unambiguous on their own - Hebrew's
   * `נקבעה` is already a `completionMarker`, so Hebrew needs nothing here and
   * declares nothing.
   */
  readonly completionParticiples: readonly CompletionParticipleEntry[];
  /**
   * Nouns naming something this system can create - what a bare participle needs
   * beside it before it counts as a claim.
   *
   * Pooled across every registered locale by the engine, because real traffic writes
   * `הפגישה is now booked` - an English participle and a Hebrew object in one
   * sentence - and a per-locale view cannot pair them.
   */
  readonly domainObjects: readonly DomainObjectEntry[];
  /**
   * Forms that announce an identifier is being given out - `confirmation
   * number`, `מספר אישור`. Their presence is itself a claim: the system either
   * has an identifier to hand over or it does not.
   */
  readonly identifierMarkers: readonly string[];
  /**
   * Apostrophe contractions that fuse a copula or an auxiliary onto the word in
   * front of it, so a token carrying one is read both ways.
   *
   * `CopulaCliticEntry` carries the whole argument, including the four wordings that
   * were released and persisted because `Your meeting's booked` tokenises as
   * `meeting's` and neither the frame route nor the participle route can see a
   * `meeting` or an `is` in it.
   *
   * Pooled across every registered locale by the engine, for the same reason
   * `domainObjects` are: real traffic writes `הפגישה's booked` and worse, and a
   * per-locale view cannot read it.
   */
  readonly copulaClitics: readonly CopulaCliticEntry[];
  /**
   * How this locale spells the first person SINGULAR and PLURAL of one verb, so a
   * test can prove no completion form has one number and not the other.
   *
   * `FirstPersonNumberMarker` carries the argument and the five Hebrew wordings that
   * leaked because two numbers of the same verb were written down independently.
   * This is TEST-facing data: the detector never reads it, the locale modules
   * GENERATE both numbers from a paired declaration, and this field is what proves
   * nothing escaped the generator.
   *
   * Empty means "this locale makes no person/number distinction a test could check",
   * which is a claim about the language and not a way to opt out - the axis test
   * asserts that every registered locale declares at least one marker.
   */
  readonly firstPersonNumberMarkers: readonly FirstPersonNumberMarker[];
  /**
   * Tokens that reverse the sense of a completion form THEY GOVERN.
   *
   * Clause-scoped, precedence-scoped AND governance-scoped, and `../detector.ts`
   * argues all three at length. `אין דאגה,` is a different CLAUSE from
   * `הפגישה נקבעה בהצלחה`, which is why the real `aya-expanse:8b` defect is caught
   * with `אין` declared here and - unlike the first revision of this gate - is
   * caught whether the model wrote `!` or `,` between the two.
   *
   * GOVERNANCE IS THE THIRD NARROWING AND IT WAS THE FOURTH FAIL-OPEN DEFECT.
   * Clause scope and precedence are not enough, because Hebrew's ordinary
   * reassurance fillers are BUILT on the two words this list has to contain:
   * `אין בעיה`, `אין דאגה`, `אין צורך לדאוג`, `לא נורא`. With no punctuation
   * between the filler and the claim, the negator and the completion land in one
   * clause and the whole detector fell silent - five wordings reached real callers
   * and were persisted. `suppressionCarriers` below is what decides whether a
   * negator standing at or before a form actually GOVERNS it.
   */
  readonly negators: readonly string[];
  /**
   * Tokens a negator or a conditional may reach ACROSS on its way to the form it
   * governs. Anything else ENDS its reach.
   *
   * WHY THIS FIELD EXISTS - THE FOURTH FAIL-OPEN DEFECT IN THIS GATE
   * -------------------------------------------------------------------------
   * `negators` and `conditionalMarkers` used to suppress every completion form
   * standing at or after them in the same clause, with no bound and no test of
   * whether the negation had anything to do with the form. That is fail-OPEN BY
   * DEFAULT: any filler containing a negator word silences everything after it to
   * the end of the clause. Independent QA drove five ordinary Hebrew reassurances
   * through the real turn service and watched all five release and PERSIST a false
   * booking:
   *
   *     אין בעיה הפגישה נקבעה למחר בשעה 14:00.        RELEASED, persisted
   *     אין בעיה קבעתי לך פגישה למחר בשעה 14:00.      RELEASED, persisted
   *     אין דאגה הפגישה נקבעה למחר בשעה 14:00.        RELEASED, persisted
   *     לא נורא הפגישה נקבעה למחר בשעה 14:00.         RELEASED, persisted
   *     אין צורך לדאוג הפגישה נקבעה למחר בשעה 14:00.  RELEASED, persisted
   *     אין בעיה, הפגישה נקבעה למחר בשעה 14:00.       the CONTROL - one comma, blocked
   *
   * The class was wider than the report: `אין בעיה הפגישה בוטלה.` (CANCELLATION)
   * and `אין בעיה אתקשר אליך מחר בשעה 15:00.` (CALLBACK) missed too, while the
   * English analogue `No problem your meeting is booked for Thursday at 2pm.` was
   * caught - which localises the cause to this locale's negator list rather than to
   * the engine, because `en.ts` deliberately omits bare `no` for exactly this
   * reason and Hebrew cannot omit `אין` and `לא`.
   *
   * WHY THIS IS A LIST OF WHAT MAY BE CROSSED AND NOT A LIST OF FILLERS
   * -------------------------------------------------------------------------
   * The three previous fixes each enumerated the reported strings and the next
   * finding arrived one phrasing-shape sideways (`docs/MISSION_2D_CLAIM_GATE.md`
   * § 16.6). Listing the reassurance collocations - `אין בעיה`, `אין דאגה`, ... -
   * would be the fourth round of that: a filler nobody listed is a LEAK.
   *
   * So the enumeration is INVERTED, exactly as `frameBlockers` was. A negator
   * reaches a form only across tokens named HERE; every other token ends its
   * reach and the form is DETECTED. A word missing from this list therefore costs
   * one regeneration of a sentence that was true, and can never cost a released
   * false claim. That is the direction `../detector.ts`'s fail-safe rule requires,
   * and it is the only reason an enumeration is acceptable at all here.
   *
   * WHAT BELONGS HERE: PRE-PREDICATE MATERIAL, AND NOTHING ELSE
   * -------------------------------------------------------------------------
   * A completion form is a PREDICATE, and in both registered languages negation is
   * pre-predicate. What may legitimately stand between a negator and the predicate
   * it negates is closed-class: subject and object pronouns, auxiliaries,
   * prepositions, quantifiers and a handful of light adjectives. That is why this
   * list is enumerable in a way the reassurance nouns and the adverbs are not - it
   * is a function-word inventory, not an open class.
   *
   * The engine ADDS, from every registered locale and without being asked:
   * `frameDeterminers` (a possessive or an article is noun-phrase material -
   * `Once your meeting is booked` has to stay clean), `domainObjects` (the head of
   * the very noun phrase the predication is about), `negators`,
   * `conditionalMarkers` (a second negator between the first and the verb is part
   * of the same negation - `הפגישה עדיין לא נקבעה`) and `frameBlockers` (a modal
   * or an intention verb IS the pre-predicate slot - `I need to get your meeting
   * booked`). Declaring any of those again here would be duplication.
   *
   * A locale MUST still answer for the rest, which is why the field is required.
   * The one class that is NOT function words is named where it is declared: the
   * verbs an identifier MARKER is the object of (`I cannot GIVE you a confirmation
   * number`), because a marker is a noun phrase rather than a predicate and the
   * verb the negator really negates stands between the two. `en.ts` lists those
   * with that argument beside them.
   *
   * Empty is NOT a plausible answer for a natural language, and a locale that
   * declares it empty gets the strictest possible rule: only an ADJACENT negator
   * suppresses. That is safe, so it is allowed - it simply costs precision.
   *
   * EACH GROUP NOW CARRIES A ROLE, AND THAT IS THE § 18 FIX. Crossing a token and
   * being carried past a whole new clause are different things, and a list that
   * only answered the first fell open to a filler built ENTIRELY out of carriers:
   * `Not at all I have booked your meeting for Thursday at 2pm.` and
   * `לא צריך כלום הפגישה נקבעה למחר בשעה 14:00.` both released and persisted a
   * false booking. `SuppressionCarrierRole` carries that argument; the groups here
   * were already separated by comment in both locale files, so what changed is
   * that the separation is DATA the engine can read rather than prose a reader can.
   */
  readonly suppressionCarriers: readonly SuppressionCarrierEntry[];
  /**
   * The negators that can themselves BE the subject of the predicate they look
   * for - English `nothing`, `none`, `nobody`.
   *
   * WHY THIS TINY LIST EXISTS, AND WHY IT IS THE ONE THAT DECIDES `Not at all`
   * -------------------------------------------------------------------------
   * A negator that OPENS its clause and cannot be a subject has no subject: it is
   * a stand-alone negative reply, and `at all`, `צריך כלום`, `yet` and the rest of
   * its modifiers are the only thing it governs. `Not at all` is the single most
   * ordinary English answer to "thank you", and everything after it is a new
   * sentence the speaker did not bother to punctuate. The same holds for every
   * Hebrew negator, because Hebrew is pro-drop and `לא צריך כלום` is impersonal -
   * which is why `he.ts` declares this empty and means it.
   *
   * `nothing`, `none` and `nobody` are the exception and they are the reason the
   * rule cannot simply be "a clause-initial negator governs nothing". In
   * `Nothing at all has been booked yet.` the negator IS the subject and
   * `has been booked` is its predicate, so the negation genuinely reaches - and
   * that sentence is one of the honest controls this fix may not break.
   *
   * A MISSING ENTRY COSTS A REGENERATION, NEVER A LEAK, which is the only reason
   * an enumeration is acceptable here: a subject-capable negator left off this
   * list is treated as a stand-alone reply, its reach stops at its own modifiers,
   * and the completion after it is DETECTED. Adding a negator that is NOT
   * subject-capable is the direction that costs coverage.
   */
  readonly subjectNegators: readonly string[];
  /**
   * Forms that make a completion form CONDITIONAL rather than asserted -
   * `once`, `as soon as`, `shall i`.
   *
   * Deliberately narrow. Politeness (`let me`, `happy to`) is NOT here: the
   * completion forms are explicit enough that a hedged sentence does not match
   * one in the first place, and a broad hedge list would suppress real claims.
   */
  readonly conditionalMarkers: readonly string[];
  /**
   * This locale's own clause-joining words: English `but`, `so`, Hebrew `אבל`.
   *
   * WHY THESE ARE DATA AND NOT PUNCTUATION
   * -------------------------------------------------------------------------
   * `text.ts` can find a clause boundary wherever a model typed a comma, a dash
   * or a colon, because punctuation is not a language. It cannot find the one in
   * `I cannot take payments but I have booked your meeting for Thursday` - the
   * same leak with the comma left out - because `but` is English and `text.ts`
   * holds no English. So the conjunctions live here, per locale, and the engine
   * layers them onto the punctuation clauses it was given.
   *
   * KEPT SHORT ON PURPOSE. Every entry NARROWS the reach of a negator, which can
   * only ever turn a missed claim into a detected one - never the reverse - so
   * the risk a wrong entry carries is a truthful sentence being checked against
   * the ledger it agrees with, which costs nothing. The list is still short
   * because a reader has to be able to check it: these are the words that join
   * two independent clauses, not every connective in the language.
   *
   * Empty is a valid answer for a locale whose conjunctions attach to the word
   * they introduce rather than standing alone.
   */
  readonly clauseBreakers: readonly string[];
  /**
   * Tokens that may not stand INSIDE a completion frame.
   *
   * WHY A FRAME HAS TO TOLERATE INTERRUPTION AT ALL
   * -------------------------------------------------------------------------
   * English asserts completion with a multi-token frame, and a model writes an
   * adverb into the middle of it: `is NOW booked`, `has NOW been booked`, `I have
   * SUCCESSFULLY booked`. Adjacent-only matching made one such word defeat the
   * whole detector - seven wordings of that shape were released to real callers
   * and persisted with an empty ledger, while `Your meeting is booked for
   * tomorrow at 3pm.` with the adverb deleted was correctly blocked. So a bounded
   * run of tokens may be skipped inside a frame (`../text.ts`,
   * `FrameGapAllowance`), and Hebrew is barely affected because its passive past
   * is one word.
   *
   * WHY THE LIST IS OF BLOCKERS AND NOT OF SKIPPABLE WORDS
   * -------------------------------------------------------------------------
   * The defect above was FIRST patched by hand-listing three adverbial spellings
   * into the English subject prefixes, which is why exactly those three were
   * caught. Listing what may be skipped repeats that: an adverb nobody thought of
   * is a LEAK. Listing what may NOT be skipped inverts the failure: a word missing
   * from this list costs one regeneration of a sentence that was true, and never a
   * released false claim. That is the direction `../detector.ts`'s fail-safe rule
   * requires, and it is the only reason an enumeration is acceptable here.
   *
   * The engine ALREADY blocks this locale's `negators`, `conditionalMarkers` and
   * `clauseBreakers` - `I have NOT booked anything` and `I have checked AND
   * confirmed` must not become frames - so this list carries only what those three
   * do not: the locale's MODAL and INTENTION words, which are what turn a
   * completion frame back into a plan (`I can HAVE that BOOKED for you`, `is BEING
   * booked`).
   *
   * Blockers are pooled across every registered locale, for the same reason
   * `clauseBreakers` are: this system's real traffic puts an English `and` inside
   * a Hebrew sentence.
   *
   * Empty is a valid answer for a locale whose completion forms are all single
   * words, since a one-token form has no inside.
   */
  readonly frameBlockers: readonly string[];
  /**
   * Words that may not stand INSIDE a completion frame but are ordinary in front of
   * one: this locale's determiners, possessives and object markers.
   *
   * WHY THIS IS SEPARATE FROM `frameBlockers`
   * -------------------------------------------------------------------------
   * `frameBlockers` change a clause's MOOD - a modal or an intention verb turns a
   * completion into a plan wherever it stands, so the engine tests for one both
   * inside a frame and in front of it, and the bare-participle rule tests the whole
   * clause. A determiner does none of that. `That is now booked.` asserts a booking
   * and `that` is simply its subject, so a determiner in FRONT of a frame must
   * silence nothing.
   *
   * What a determiner does mark is NOUN-PHRASE material, and that has no business
   * interior to a verb phrase. The sentence that forced this field is
   * `I will have your call back booked shortly.` - an honest intention, in which the
   * frame `i will call` closed across `have your` and reported a callback promise.
   * The frame is spurious precisely because a possessive sits in the middle of it.
   *
   * KEPT SHORT, and only what is unambiguous. `that` and `this` are here as
   * determiners; they are also pronouns, and both readings are noun-phrase material,
   * so neither reading belongs inside a verb frame.
   *
   * Empty is a valid answer for a locale that marks definiteness with an affix
   * rather than a standing word.
   */
  readonly frameDeterminers: readonly string[];
  readonly months: readonly MonthEntry[];
  /**
   * Suffixes that turn a number into a day of the month - English `5th`.
   * Empty for a locale that does not write them.
   */
  readonly ordinalSuffixes: readonly string[];
  /**
   * The words that announce a day or a time follows.
   *
   * `TemporalOpenerEntry` carries the whole argument, including why this is the
   * one list here that is not inverted. Empty is a valid answer only for a locale
   * that marks a temporal phrase some other way; for a locale that writes
   * prepositions, an empty list means no temporal phrase is ever examined and the
   * § 20 defect is open in that language.
   */
  readonly temporalOpeners: readonly TemporalOpenerEntry[];
  /**
   * What may stand inside a temporal phrase WITHOUT naming a day or a time.
   *
   * WHY THIS IS A LIST OF WHAT IS PERMITTED AND NOT A LIST OF WHAT LEAKED
   * -------------------------------------------------------------------------
   * This is the field that decides the § 20 verdict, so it is the one that has to
   * be INVERTED. `detectDay` and `detectTime` consume what they understood; every
   * remaining token in the stretch after a `temporalOpeners` word is a word the
   * gate did not read, and the safe reading of an unread word standing where a day
   * or an hour belongs is "this might BE the day or the hour, and I cannot check
   * it". So a token is accounted for only when a rule consumed it or when it is
   * named here, and anything else makes the claim's day and time UNRESOLVED.
   *
   * A word missing from this list therefore costs ONE REGENERATION of a sentence
   * that was true, and can never cost a released false claim. That is the same
   * direction `frameBlockers` and `suppressionCarriers` are written in, and the
   * only direction `../detector.ts`'s fail-safe rule permits an enumeration at
   * all. It is also, exactly, `LocaleLexicon.carriers` in
   * `src/scheduling/lexicon/types.ts` - the list the resolver has had since § 8.3,
   * for the same reason, doing the same job one layer up.
   *
   * WHAT BELONGS HERE: the function words and the light nouns that stand inside a
   * `for ...` or `at ...` phrase without being any part of the answer - articles,
   * `of`, `o'clock`, `sharp`, `time`, the object pronouns. NOT a temporal noun.
   * `weekend`, `week`, `month`, `lunchtime`, `midday`, `quarter`, `half` and every
   * spelled-out hour are deliberately ABSENT, and adding one would re-open the
   * defect this field exists to close in the one direction that releases a false
   * sentence to a customer.
   *
   * The engine ADDS, from every registered locale and without being asked, exactly
   * two of the existing fields: `frameDeterminers` (an article or a possessive is
   * noun-phrase material and names no hour) and `domainObjects` (`in the DIARY` and
   * `for your MEETING` are the two commonest non-temporal complements in this
   * system's own traffic). Declaring either again here would be duplication that
   * can drift.
   *
   * `suppressionCarriers` is DELIBERATELY NOT POOLED, and the reason is a live
   * fail-open one rather than a matter of taste. That list is a function-word
   * inventory assembled for a different question, and it contains `one` - which is
   * an HOUR. Pooling it would account for `at one` and certify a 15:00 booking
   * described as one o'clock, which is the § 20 defect surviving its own fix. The
   * pronouns this field really does need are therefore written out per locale
   * below, where a reader can see which ones were chosen.
   */
  readonly temporalCarriers: readonly string[];
  /**
   * Words that END a temporal phrase by introducing something that is not one.
   *
   * `Your meeting is booked for Thursday at 2pm with Jordan Miller.` is the
   * sentence this exists for: `with` starts a companion, not an hour, and without
   * it the slot opened by `at` would run on into a person's name and report it as
   * an unread day. The locale's `clauseBreakers` are pooled in by the engine
   * already - `and`, `but`, `so`, `אבל` - because a new clause ends a temporal
   * phrase whatever else it does.
   *
   * Inverted in the safe direction like `temporalCarriers`: a missing ender lets a
   * slot run one phrase too far and costs one regeneration of a true sentence. It
   * can never cost a leak, because a slot that runs too FAR reports MORE, never
   * less.
   */
  readonly temporalSlotEnders: readonly string[];
}
