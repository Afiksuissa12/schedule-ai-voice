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

/** A month name, so `5 March` can be compared against a resolved instant. */
export interface MonthEntry {
  readonly forms: readonly string[];
  /** 1 = January, Luxon's numbering. */
  readonly month: number;
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
   * Tokens that reverse the sense of a completion form in the same CLAUSE.
   *
   * Clause-scoped and precedence-scoped, and `../detector.ts` argues both at
   * length. `אין דאגה,` is a different CLAUSE from `הפגישה נקבעה בהצלחה`, which
   * is why the real `aya-expanse:8b` defect is caught with `אין` declared here
   * and - unlike the first revision of this gate - is caught whether the model
   * wrote `!` or `,` between the two.
   */
  readonly negators: readonly string[];
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
}
