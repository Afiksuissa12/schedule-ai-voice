/**
 * The declarative shape of one locale's scheduling lexicon.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * `naturalLanguage.ts` used to carry its vocabulary as English string literals:
 * a weekday table, a relative-offset regex, day-part and named-time
 * alternations, a vagueness list and an English-only leftover blocklist. That
 * had two consequences, and the second one was a live product hazard:
 *
 *  1. Nothing but English could ever be understood.
 *  2. A word the grammar did not know was SILENTLY DISCARDED. A Hebrew phrase
 *     whose clock time was written in digits therefore lost its day word, kept
 *     its digits, and resolved to TODAY with `ok: true` - a validated booking
 *     one calendar day early. See `docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md`
 *     § 8.3 and `docs/DECISIONS.md` § 9.
 *
 * The fix for (1) is this file: a locale is DATA, not control flow. A lexicon
 * module exports one `LocaleLexicon` and nothing else. The resolver consumes a
 * registry of them and contains no language-specific literal, so adding a third
 * locale is adding a module and registering it - never a resolver edit.
 * `tests/scheduling/localeLexicon.test.ts` proves that claim by registering a
 * synthetic third locale at runtime.
 *
 * THE RULE EVERY FIELD HERE SERVES
 * ---------------------------------------------------------------------------
 * A phrase may resolve only if EVERY non-whitespace token was accounted for by
 * some rule somebody wrote down. That is why `carriers` exists and why it is a
 * first-class field rather than an implementation detail: "call me back
 * tomorrow afternoon at 3" is a perfectly good instruction whose first three
 * words mean nothing to a scheduler, and the difference that matters is between
 *
 *    "this token was discarded by a rule somebody wrote down"   (carrier)
 *    "this token was discarded because nobody looked at it"     (the defect)
 *
 * Consuming a carrier is a recorded grammar event and appears in the
 * provenance. Anything left over refuses.
 *
 * FORMS ARE MATCHED AS WHOLE TOKENS, NEVER AS SUBSTRINGS
 * ---------------------------------------------------------------------------
 * Every `forms` array holds space-separated token sequences, already in the
 * shape `normalizeScript` + lower-casing produce. A form of `'day after
 * tomorrow'` matches three consecutive tokens; `'tomorrow'` matches one. The
 * engine always prefers the LONGEST form that matches at a position, which is
 * what keeps `'אחרי הצהריים'` (afternoon) from being read as `'הצהריים'`
 * (noon), and `'tuesday'` from being shadowed by `'tue'`.
 *
 * Substring matching is deliberately NOT used. JavaScript's `\b` is defined on
 * ASCII word characters, so `\bמחר\b` never matches - an English-only grammar
 * expressed in regexes cannot be extended to Hebrew by adding alternatives to
 * it. Token equality works in every script.
 */
import type { DayPartName } from '../policy.js';

/** The four units a relative offset can be expressed in. */
export type OffsetUnit = 'minute' | 'hour' | 'day' | 'week';

/**
 * A named day that is a fixed number of days from `now`, or the end of the
 * current week.
 *
 * `label` is CANONICAL and language-neutral on purpose: `dayAnchor: 'tomorrow'`
 * means the same thing in a receipt whether the contact said `tomorrow` or
 * `מחר`, and the locale that supplied the word is recorded separately.
 */
export interface DayAnchorEntry {
  readonly forms: readonly string[];
  readonly label: 'today' | 'tomorrow' | 'day_after_tomorrow' | 'end_of_week';
  readonly kind: 'RELATIVE_DAY' | 'END_OF_WEEK';
  /** Required for `RELATIVE_DAY`. 0 = today, 1 = tomorrow, 2 = the day after. */
  readonly offsetDays?: number;
}

/** A weekday name in one locale. `isoWeekday` is Luxon's: 1 = Monday, 7 = Sunday. */
export interface WeekdayEntry {
  readonly forms: readonly string[];
  readonly isoWeekday: number;
}

/**
 * A word that changes which instance of a weekday is meant.
 *
 * `position` exists because the word does not sit in the same place in every
 * language: English puts it before (`next thursday`), Hebrew after
 * (`יום חמישי הבא`). Encoding that as data is the whole point - a resolver that
 * hard-coded "look one token to the left" would be an English resolver wearing
 * a lexicon.
 */
export interface WeekdayModifierEntry {
  readonly forms: readonly string[];
  readonly kind: 'NEXT' | 'THIS';
  readonly position: 'BEFORE' | 'AFTER';
}

/**
 * A part of the day. `impliesToday` marks the forms that name a day part AND
 * the current day at once - English `tonight`, Hebrew `הערב`.
 */
export interface DayPartEntry {
  readonly forms: readonly string[];
  readonly dayPart: DayPartName;
  readonly impliesToday: boolean;
  /** Recorded as the day anchor when `impliesToday` fires. */
  readonly impliesTodayLabel?: string;
}

/** A clock time that has a name rather than digits - `noon`, `חצות`. */
export interface NamedTimeEntry {
  readonly forms: readonly string[];
  readonly hour: number;
  readonly minute: number;
}

/**
 * A word that introduces a clock time.
 *
 * `attaches` is data because languages disagree about whitespace: English
 * writes `at 15:00` as two tokens and `@3pm` as one; Hebrew writes the same
 * thing as `ב-15:00`, `ב־15:00` (maqaf), `ב15:00` or `ב 15:00`.
 * `attachedSeparators` lists what may sit between the prefix and the digits
 * inside a single token - `''` for none, `'-'` for the hyphen the maqaf
 * normalises to.
 */
export interface ClockPrefixEntry {
  readonly forms: readonly string[];
  readonly attaches: boolean;
  readonly attachedSeparators?: readonly string[];
}

/** `am` / `pm` and their punctuated spellings. */
export interface MeridiemEntry {
  readonly forms: readonly string[];
  readonly meridiem: 'am' | 'pm';
}

/** A written number usable as an offset quantity - `two`, `a couple of`. */
export interface QuantityEntry {
  readonly forms: readonly string[];
  readonly value: number;
}

/** A unit name for a relative offset - `hours`, `שעות`. */
export interface OffsetUnitEntry {
  readonly forms: readonly string[];
  readonly unit: OffsetUnit;
}

/**
 * A phrase that IS a whole quantity-and-unit with nothing to parse out of it.
 *
 * Two kinds of language need this and neither is exotic: English idiom
 * (`half an hour`) and Hebrew's DUAL number, where "two hours" is one word,
 * `שעתיים`, with no separable quantity at all.
 *
 * `prefixOptional` preserves an existing English behaviour exactly:
 * `half an hour` resolves on its own, while `in 30 minutes` needs its `in`.
 */
export interface FixedDurationEntry {
  readonly forms: readonly string[];
  readonly value: number;
  readonly unit: OffsetUnit;
  readonly prefixOptional: boolean;
}

/** Everything the relative-offset rule needs from one locale. */
export interface RelativeOffsetLexicon {
  /** Words that introduce an offset - `in`, `בעוד`. */
  readonly prefixes: readonly string[];
  /** Hedges that may sit between the prefix and the quantity - `about`, `בערך`. */
  readonly softeners: readonly string[];
  /**
   * Whether a quantity-and-unit offset MUST be introduced by a prefix. English
   * requires it (`2 hours` on its own is a duration, not an instruction), and
   * so does Hebrew. It is a per-locale statement rather than a resolver rule
   * because a locale that marks the offset on the unit itself would not need
   * one.
   */
  readonly prefixRequired: boolean;
  readonly quantities: readonly QuantityEntry[];
  readonly units: readonly OffsetUnitEntry[];
  readonly fixedDurations: readonly FixedDurationEntry[];
}

/**
 * One locale's complete scheduling vocabulary. Data only - no functions, no
 * regexes, no control flow.
 */
export interface LocaleLexicon {
  /** Short stable id recorded in the provenance, e.g. `en`, `he`. */
  readonly locale: string;
  /** For refusal messages a human reads. */
  readonly displayName: string;
  readonly dayAnchors: readonly DayAnchorEntry[];
  readonly weekdays: readonly WeekdayEntry[];
  readonly weekdayModifiers: readonly WeekdayModifierEntry[];
  readonly dayParts: readonly DayPartEntry[];
  readonly namedTimes: readonly NamedTimeEntry[];
  readonly clockPrefixes: readonly ClockPrefixEntry[];
  /** Words that follow a number and mark it as a clock time - `o'clock`. */
  readonly clockSuffixes: readonly string[];
  readonly meridiems: readonly MeridiemEntry[];
  readonly relativeOffset: RelativeOffsetLexicon;
  /**
   * Tokens this locale PERMITS to be present and discards on purpose.
   *
   * Consumed last, after every rule that could want them, so a carrier can
   * never shadow a real match. Every one consumed is a recorded grammar event.
   */
  readonly carriers: readonly string[];
  /** Phrases that mean the contact has not actually named a time. */
  readonly vaguenessMarkers: readonly string[];
  /** Words naming a PERIOD rather than a moment - `week`, `חודש`. */
  readonly periodTokens: readonly string[];
}
