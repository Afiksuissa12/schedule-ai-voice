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
  readonly months: readonly MonthEntry[];
  /**
   * Suffixes that turn a number into a day of the month - English `5th`.
   * Empty for a locale that does not write them.
   */
  readonly ordinalSuffixes: readonly string[];
}
