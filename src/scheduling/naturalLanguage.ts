/**
 * Deterministic natural-language datetime grammar.
 *
 * WHAT THIS IS, AND WHAT IT REPLACES
 * ---------------------------------------------------------------------------
 * The legacy prototype negotiated bookings by letting the model interpret
 * phrases like "tomorrow afternoon", "next Tuesday morning", "in a couple of
 * hours" and "end of the week". The IDEA was right and is preserved here. The
 * IMPLEMENTATION is not: this is a closed, hand-written grammar with no model
 * in the loop, no wall-clock read, and no guessing. The same input and the same
 * `now` always produce the same output, which is what makes a callback time
 * auditable.
 *
 * THE RULE THAT SHAPES EVERY DECISION BELOW
 * ---------------------------------------------------------------------------
 * A wrong callback time is worse than a clarifying question. So anything this
 * grammar cannot resolve CONFIDENTLY is refused, and the caller turns the
 * refusal into `INVALID_FORMAT`. Four refusals are deliberate and easy to
 * mistake for gaps:
 *
 *  1. A bare 12-hour clock time with no meridiem and no day part - "at 3" - is
 *     REFUSED. 03:00 and 15:00 are twelve hours apart and the cost of guessing
 *     wrong is a phone call in the middle of the night.
 *  2. A contradiction - "tomorrow morning at 3pm", "tomorrow in two hours" - is
 *     REFUSED rather than resolved by precedence.
 *  3. Vague intent - "sometime next week", "later", "soon" - is REFUSED, and so
 *     is a leftover period word: "next week" names a period, not a moment.
 *  4. ANY token no rule accounted for is REFUSED. See below - this one is new,
 *     and it is the reason this file was rewritten.
 *
 * FAIL CLOSED. THE DEFECT THIS REPLACES
 * ---------------------------------------------------------------------------
 * The previous implementation normalised the input, ran a sequence of regexes,
 * blanked each match out of a `remaining` string, and then checked what
 * survived against exactly two safety nets: `/\d/` and an ENGLISH-ONLY list of
 * period words. Everything else in `remaining` was silently discarded.
 *
 * Put together with the `implicit_today` branch - "a time with no named day
 * means TODAY" - that produced a live product hazard. `מחר ב-15:00`
 * ("tomorrow at 15:00") had its digits recognised, its Hebrew day word silently
 * dropped, and resolved to TODAY with `ok: true` and every downstream check
 * passing: a validated, persisted, audit-trailed booking one calendar day
 * early, with no warning anywhere. Arabic, Russian and French phrases carrying
 * a digit clock time did the same thing. Reproduced in
 * `FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 8.3.
 *
 * So the rule is now: **a phrase may resolve only if EVERY non-whitespace
 * token was consumed by a rule.** Anything left over refuses, in every
 * language, including languages this grammar will never learn - because the
 * rule is general and knows nothing about alphabets.
 *
 * That could not be a one-line check, because English phrases that resolve
 * correctly already leave tokens behind: "call me back tomorrow afternoon at 3"
 * leaves `call`, `me` and `back`. The distinction this file implements is
 * between
 *
 *      "this token was discarded by a rule somebody wrote down"
 *      "this token was discarded because nobody looked at it"
 *
 * so each locale declares its CARRIER tokens explicitly, and consuming one is a
 * recorded grammar event that appears in the provenance next to every other
 * match. `docs/DECISIONS.md` § 9 records the reasoning.
 *
 * NO LANGUAGE-SPECIFIC LITERAL LIVES IN THIS FILE
 * ---------------------------------------------------------------------------
 * The weekday table, the offset patterns, the day-part and named-time
 * alternations, the vagueness markers, the period words, the clock prefixes and
 * the carriers are all DATA, in `src/scheduling/lexicon/<code>.ts`. This file
 * consumes a registry of them and matches against the UNION, refusing when two
 * registered locales would read a token as different days or different times.
 * Adding a third locale is adding a module and registering it; there is nothing
 * here to edit. `tests/scheduling/localeLexicon.test.ts` proves that by
 * registering a synthetic third locale at runtime.
 *
 * TOKENS, NOT SUBSTRINGS
 * ---------------------------------------------------------------------------
 * Matching is on whole tokens. JavaScript's `\b` is defined on ASCII word
 * characters, so a regex grammar cannot be extended to Hebrew by adding
 * alternatives to it - `\bמחר\b` never matches anything. Token equality works
 * in every script, and it also makes "every token was accounted for" an exact
 * statement rather than a guess about leftover whitespace.
 *
 * WEEKDAY SEMANTICS (documented because they are a judgement call)
 * ---------------------------------------------------------------------------
 *  - `tuesday`, `this tuesday`, `on tuesday` -> the soonest future Tuesday,
 *    EXCLUDING today. Said on a Tuesday, "call me Tuesday" means the next one.
 *  - `next tuesday` -> the Tuesday of the following ISO week (week starts
 *    Monday). On Wednesday 04 Mar, `thursday` is 05 Mar and `next thursday`
 *    is 12 Mar.
 *  - `end of the week` -> Friday of the CURRENT ISO week when that is today or
 *    later, otherwise Friday of the next one.
 *
 * These are locale-agnostic arithmetic, applied to whichever locale's word
 * matched. Which days a business actually works is POLICY and lives in
 * `businessHours`, not here.
 */
import { DateTime } from 'luxon';

import { REGISTERED_LEXICONS } from './lexicon/index.js';
import { normalizeScript } from './lexicon/script.js';
import type {
  ClockPrefixEntry,
  DayAnchorEntry,
  DayPartEntry,
  FixedDurationEntry,
  LocaleLexicon,
  MeridiemEntry,
  NamedTimeEntry,
  OffsetUnit,
  OffsetUnitEntry,
  QuantityEntry,
  WeekdayEntry,
  WeekdayModifierEntry,
} from './lexicon/types.js';
import type { DayPartName, DayPartsPolicy, DayPartWindow } from './policy.js';

/** A concrete wall-clock target in the contact's zone. Not yet an instant. */
export interface LocalWallTimeTarget {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  readonly day: number;
  /** 0-23. */
  readonly hour: number;
  readonly minute: number;
}

/**
 * The locale recorded for a rule that belongs to no language.
 *
 * ISO-8601 dates and bare digit clock times are not English and not Hebrew.
 * Marking them explicitly is better than attributing them to whichever lexicon
 * happened to be first in the registry.
 */
export const LOCALE_AGNOSTIC = '*';

/**
 * One thing the grammar did, and which locale's lexicon told it to.
 *
 * Every consumed token produces one of these - INCLUDING carrier tokens, whose
 * `rule` is `carrier`. That is the whole point: "discarded by a rule somebody
 * wrote down" has to be distinguishable, in the receipt, from "discarded
 * because nobody looked at it".
 */
export interface LexiconEvent {
  /** `day_anchor`, `weekday`, `day_part`, `named_time`, `clock_time`, `carrier`, ... */
  readonly rule: string;
  /** The lexicon that supplied the form, or `*` for a locale-agnostic rule. */
  readonly locale: string;
  /** The form as DECLARED in the lexicon. */
  readonly form: string;
  /** The text actually consumed from the input. */
  readonly text: string;
}

/** How the grammar got to its answer. Copied into `ValidationProvenance.notes`. */
export interface NaturalLanguageInterpretation {
  /** Grammar rules that fired, in the order they were applied. */
  readonly matched: readonly string[];
  readonly dayAnchor?: string;
  readonly dayPart?: DayPartName;
  readonly timeAnchor?: string;
  /** The normalised text the grammar actually worked on. */
  readonly normalized: string;
  /** Locales whose lexicon supplied at least one match, in first-match order. */
  readonly locales: readonly string[];
  /** Every grammar event, in order, with the locale that produced it. */
  readonly lexicon: readonly LexiconEvent[];
  /** Carrier/filler tokens discarded BY RULE rather than by omission. */
  readonly carriers: readonly string[];
  /** Tokens no rule accounted for. Always empty on a successful parse. */
  readonly leftover: readonly string[];
  /** Script-normalisation steps that actually changed the raw input. */
  readonly scriptNormalization: readonly string[];
}

export type NaturalLanguageParse =
  | {
      readonly ok: true;
      /** A wall-clock intent: still has to survive the DST existence checks. */
      readonly kind: 'LOCAL_WALL_TIME';
      readonly target: LocalWallTimeTarget;
      readonly interpretation: NaturalLanguageInterpretation;
    }
  | {
      readonly ok: true;
      /**
       * An ELAPSED duration ("in two hours"). The instant is already determined,
       * so the DST gap/repeat questions simply do not arise for it - asking
       * whether 01:30 happens twice is meaningless when the contact asked for
       * "sixty minutes from now".
       */
      readonly kind: 'ELAPSED_FROM_NOW';
      readonly epochMillis: number;
      readonly interpretation: NaturalLanguageInterpretation;
    }
  | {
      readonly ok: false;
      /** Safe to hand back to the model as a tool error - it names the fix. */
      readonly reason: string;
      readonly interpretation: NaturalLanguageInterpretation;
    };

export interface ParseNaturalLanguageOptions {
  /** `now`, already converted into the target zone. The grammar's only anchor. */
  readonly nowLocal: DateTime;
  readonly dayParts: DayPartsPolicy;
  /**
   * The lexicons to match against. Defaults to `REGISTERED_LEXICONS`.
   *
   * Present so that a test can register a third locale WITHOUT editing this
   * file, which is how the locale-agnosticism claim is proved rather than
   * asserted. Production callers never pass it.
   */
  readonly lexicons?: readonly LocaleLexicon[];
}

// ---------------------------------------------------------------------------
// The lexicon index: forms flattened, normalised and sorted longest-first
// ---------------------------------------------------------------------------

/** One declared form, ready to match. */
interface FormEntry<TValue> {
  readonly locale: string;
  /** The form as written in the lexicon. */
  readonly form: string;
  /** The form, normalised and split into the tokens it must match. */
  readonly tokens: readonly string[];
  /**
   * What this form MEANS, as a comparable string.
   *
   * Two entries agree when their keys are equal. Cross-locale ambiguity is
   * defined entirely in terms of this: a token two locales key differently is
   * refused; one they key identically is not an ambiguity at all.
   */
  readonly valueKey: string;
  /** How the reading is described in a refusal a human reads. */
  readonly reading: string;
  readonly value: TValue;
}

interface FormSpec<TValue> {
  readonly forms: readonly string[];
  readonly valueKey: string;
  readonly reading: string;
  readonly value: TValue;
}

interface FormHit<TValue> {
  readonly length: number;
  /** Every entry that matched this span, across every registered locale. */
  readonly entries: readonly FormEntry<TValue>[];
}

interface LexiconIndex {
  readonly lexicons: readonly LocaleLexicon[];
  readonly dayAnchors: readonly FormEntry<DayAnchorEntry>[];
  readonly weekdays: readonly FormEntry<WeekdayEntry>[];
  readonly modifiersBefore: readonly FormEntry<WeekdayModifierEntry>[];
  readonly modifiersAfter: readonly FormEntry<WeekdayModifierEntry>[];
  readonly maxModifierTokens: number;
  readonly dayParts: readonly FormEntry<DayPartEntry>[];
  readonly namedTimes: readonly FormEntry<NamedTimeEntry>[];
  readonly clockPrefixesStandalone: readonly FormEntry<ClockPrefixEntry>[];
  readonly clockPrefixesAttaching: readonly FormEntry<ClockPrefixEntry>[];
  readonly clockSuffixes: readonly FormEntry<null>[];
  readonly meridiems: readonly FormEntry<MeridiemEntry>[];
  readonly offsetPrefixes: readonly FormEntry<null>[];
  readonly offsetSofteners: readonly FormEntry<null>[];
  readonly offsetQuantities: readonly FormEntry<QuantityEntry>[];
  readonly offsetUnits: readonly FormEntry<OffsetUnitEntry>[];
  readonly fixedDurations: readonly FormEntry<FixedDurationEntry>[];
  readonly vagueness: readonly FormEntry<null>[];
  readonly periods: readonly FormEntry<null>[];
  readonly carriers: readonly FormEntry<null>[];
  /** Everything except carriers, for the cross-locale ambiguity pre-pass. */
  readonly semantic: readonly FormEntry<unknown>[];
  /** Locale code -> whether its offsets must be introduced by a prefix. */
  readonly offsetPrefixRequired: ReadonlyMap<string, boolean>;
}

/** Built once per registry array. Lexicons are frozen data, so this is safe. */
const INDEX_CACHE = new WeakMap<object, LexiconIndex>();

function normalizeForm(form: string): string[] {
  return normalizeScript(form)
    .text.toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function collect<TValue>(
  lexicons: readonly LocaleLexicon[],
  specsOf: (lexicon: LocaleLexicon) => readonly FormSpec<TValue>[],
): FormEntry<TValue>[] {
  const entries: FormEntry<TValue>[] = [];
  for (const lexicon of lexicons) {
    for (const spec of specsOf(lexicon)) {
      for (const form of spec.forms) {
        const tokens = normalizeForm(form);
        if (tokens.length === 0) continue;
        entries.push({
          locale: lexicon.locale,
          form,
          tokens,
          valueKey: spec.valueKey,
          reading: spec.reading,
          value: spec.value,
        });
      }
    }
  }
  // Longest first, so `tuesday` is never shadowed by `tue` and
  // `אחרי הצהריים` (afternoon) is never read as `הצהריים` (noon).
  return entries.sort((a, b) => b.tokens.length - a.tokens.length || b.form.length - a.form.length);
}

function simpleSpecs(forms: readonly string[], valueKey: string, reading: string): FormSpec<null>[] {
  return forms.map((form) => ({ forms: [form], valueKey, reading, value: null }));
}

function buildIndex(lexicons: readonly LocaleLexicon[]): LexiconIndex {
  const dayAnchors = collect<DayAnchorEntry>(lexicons, (lexicon) =>
    lexicon.dayAnchors.map((entry) => ({
      forms: entry.forms,
      valueKey:
        entry.kind === 'END_OF_WEEK' ? 'day_anchor:end_of_week' : `day_anchor:day_offset:${String(entry.offsetDays)}`,
      reading: `the day anchor "${entry.label}"`,
      value: entry,
    })),
  );

  const weekdays = collect<WeekdayEntry>(lexicons, (lexicon) =>
    lexicon.weekdays.map((entry) => ({
      forms: entry.forms,
      valueKey: `weekday:${String(entry.isoWeekday)}`,
      reading: `the weekday with ISO number ${String(entry.isoWeekday)}`,
      value: entry,
    })),
  );

  const modifiers = (position: 'BEFORE' | 'AFTER'): FormEntry<WeekdayModifierEntry>[] =>
    collect<WeekdayModifierEntry>(lexicons, (lexicon) =>
      lexicon.weekdayModifiers
        .filter((entry) => entry.position === position)
        .map((entry) => ({
          forms: entry.forms,
          valueKey: `weekday_modifier:${entry.kind}`,
          reading: `a "${entry.kind.toLowerCase()}" weekday modifier`,
          value: entry,
        })),
    );

  const modifiersBefore = modifiers('BEFORE');
  const modifiersAfter = modifiers('AFTER');

  const dayParts = collect<DayPartEntry>(lexicons, (lexicon) =>
    lexicon.dayParts.map((entry) => ({
      forms: entry.forms,
      valueKey: `day_part:${entry.dayPart}:${String(entry.impliesToday)}`,
      reading: `the ${entry.dayPart}${entry.impliesToday ? ' of today' : ''}`,
      value: entry,
    })),
  );

  const namedTimes = collect<NamedTimeEntry>(lexicons, (lexicon) =>
    lexicon.namedTimes.map((entry) => ({
      forms: entry.forms,
      valueKey: `named_time:${String(entry.hour)}:${String(entry.minute)}`,
      reading: `the named time ${pad(entry.hour)}:${pad(entry.minute)}`,
      value: entry,
    })),
  );

  const clockPrefixes = (attaching: boolean): FormEntry<ClockPrefixEntry>[] =>
    collect<ClockPrefixEntry>(lexicons, (lexicon) =>
      lexicon.clockPrefixes
        .filter((entry) => entry.attaches === attaching)
        .map((entry) => ({
          forms: entry.forms,
          valueKey: 'clock_prefix',
          reading: 'a clock-time preposition',
          value: entry,
        })),
    );

  const offsetQuantities = collect<QuantityEntry>(lexicons, (lexicon) =>
    lexicon.relativeOffset.quantities.map((entry) => ({
      forms: entry.forms,
      valueKey: `quantity:${String(entry.value)}`,
      reading: `the quantity ${String(entry.value)}`,
      value: entry,
    })),
  );

  const offsetUnits = collect<OffsetUnitEntry>(lexicons, (lexicon) =>
    lexicon.relativeOffset.units.map((entry) => ({
      forms: entry.forms,
      valueKey: `offset_unit:${entry.unit}`,
      reading: `the unit "${entry.unit}"`,
      value: entry,
    })),
  );

  const fixedDurations = collect<FixedDurationEntry>(lexicons, (lexicon) =>
    lexicon.relativeOffset.fixedDurations.map((entry) => ({
      forms: entry.forms,
      valueKey: `fixed_duration:${String(entry.value)}:${entry.unit}`,
      reading: `${String(entry.value)} ${entry.unit}(s)`,
      value: entry,
    })),
  );

  const carriers = collect<null>(lexicons, (lexicon) =>
    simpleSpecs(lexicon.carriers, 'carrier', 'a filler word'),
  );

  const index: LexiconIndex = {
    lexicons,
    dayAnchors,
    weekdays,
    modifiersBefore,
    modifiersAfter,
    maxModifierTokens: Math.max(
      1,
      ...[...modifiersBefore, ...modifiersAfter].map((entry) => entry.tokens.length),
    ),
    dayParts,
    namedTimes,
    clockPrefixesStandalone: clockPrefixes(false),
    clockPrefixesAttaching: clockPrefixes(true),
    clockSuffixes: collect<null>(lexicons, (lexicon) =>
      simpleSpecs(lexicon.clockSuffixes, 'clock_suffix', 'an o-clock marker'),
    ),
    meridiems: collect<MeridiemEntry>(lexicons, (lexicon) =>
      lexicon.meridiems.map((entry) => ({
        forms: entry.forms,
        valueKey: `meridiem:${entry.meridiem}`,
        reading: `"${entry.meridiem}"`,
        value: entry,
      })),
    ),
    offsetPrefixes: collect<null>(lexicons, (lexicon) =>
      simpleSpecs(lexicon.relativeOffset.prefixes, 'offset_prefix', 'an offset preposition'),
    ),
    offsetSofteners: collect<null>(lexicons, (lexicon) =>
      simpleSpecs(lexicon.relativeOffset.softeners, 'offset_softener', 'an approximation word'),
    ),
    offsetQuantities,
    offsetUnits,
    fixedDurations,
    vagueness: collect<null>(lexicons, (lexicon) =>
      simpleSpecs(lexicon.vaguenessMarkers, 'vagueness', 'a vagueness marker'),
    ),
    periods: collect<null>(lexicons, (lexicon) =>
      simpleSpecs(lexicon.periodTokens, 'period', 'a period rather than a moment'),
    ),
    carriers,
    semantic: [],
    offsetPrefixRequired: new Map(
      lexicons.map((lexicon) => [lexicon.locale, lexicon.relativeOffset.prefixRequired] as const),
    ),
  };

  // Everything a reader could take as naming a day or a time. Carriers are
  // excluded on purpose: a filler word cannot make a phrase ambiguous.
  const semantic: FormEntry<unknown>[] = [
    ...index.dayAnchors,
    ...index.weekdays,
    ...index.modifiersBefore,
    ...index.modifiersAfter,
    ...index.dayParts,
    ...index.namedTimes,
    ...index.clockPrefixesStandalone,
    ...index.clockPrefixesAttaching,
    ...index.clockSuffixes,
    ...index.meridiems,
    ...index.offsetPrefixes,
    ...index.offsetSofteners,
    ...index.offsetQuantities,
    ...index.offsetUnits,
    ...index.fixedDurations,
    ...index.vagueness,
    ...index.periods,
  ].sort((a, b) => b.tokens.length - a.tokens.length || b.form.length - a.form.length);

  return { ...index, semantic };
}

function indexFor(lexicons: readonly LocaleLexicon[]): LexiconIndex {
  const cached = INDEX_CACHE.get(lexicons);
  if (cached) return cached;
  const built = buildIndex(lexicons);
  INDEX_CACHE.set(lexicons, built);
  return built;
}

// ---------------------------------------------------------------------------
// Token matching
// ---------------------------------------------------------------------------

/**
 * The longest form matching at `start`, together with EVERY entry that matched
 * that same span - which is what the cross-locale ambiguity rule inspects.
 */
function matchAt<TValue>(
  tokens: readonly string[],
  consumed: readonly boolean[],
  start: number,
  entries: readonly FormEntry<TValue>[],
): FormHit<TValue> | undefined {
  let bestLength = 0;
  const best: FormEntry<TValue>[] = [];
  for (const entry of entries) {
    const length = entry.tokens.length;
    if (bestLength > 0 && length < bestLength) break; // sorted longest-first
    if (start + length > tokens.length) continue;
    let matches = true;
    for (let offset = 0; offset < length; offset += 1) {
      if (consumed[start + offset] || tokens[start + offset] !== entry.tokens[offset]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    if (length > bestLength) {
      bestLength = length;
      best.length = 0;
    }
    best.push(entry);
  }
  return bestLength === 0 ? undefined : { length: bestLength, entries: best };
}

/** The first position at which any of `entries` matches. */
function findFirst<TValue>(
  tokens: readonly string[],
  consumed: readonly boolean[],
  entries: readonly FormEntry<TValue>[],
): { start: number; hit: FormHit<TValue> } | undefined {
  for (let start = 0; start < tokens.length; start += 1) {
    if (consumed[start]) continue;
    const hit = matchAt(tokens, consumed, start, entries);
    if (hit) return { start, hit };
  }
  return undefined;
}

function textOf(tokens: readonly string[], start: number, length: number): string {
  return tokens.slice(start, start + length).join(' ');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseNaturalLanguageDateTime(
  raw: string,
  options: ParseNaturalLanguageOptions,
): NaturalLanguageParse {
  const index = indexFor(options.lexicons ?? REGISTERED_LEXICONS);
  const script = normalizeScript(raw);
  const normalized = normalizeGrammar(script.text);
  const tokens = normalized.length === 0 ? [] : normalized.split(' ');
  const consumed: boolean[] = tokens.map(() => false);
  const events: LexiconEvent[] = [];
  const matched: string[] = [];

  const record = (rule: string, locale: string, form: string, start: number, length: number): string => {
    const text = textOf(tokens, start, length);
    for (let offset = 0; offset < length; offset += 1) consumed[start + offset] = true;
    events.push({ rule, locale, form, text });
    return text;
  };

  const leftoverTokens = (): string[] => tokens.filter((_token, position) => !consumed[position]);

  const describe = (extra?: Partial<NaturalLanguageInterpretation>): NaturalLanguageInterpretation => ({
    matched: [...matched],
    normalized,
    locales: [...new Set(events.map((event) => event.locale))].filter((locale) => locale !== LOCALE_AGNOSTIC),
    lexicon: [...events],
    carriers: events.filter((event) => event.rule === 'carrier').map((event) => event.text),
    leftover: leftoverTokens(),
    scriptNormalization: script.applied,
    ...extra,
  });

  if (tokens.length === 0) {
    return { ok: false, reason: 'The proposed value is empty.', interpretation: describe() };
  }

  // ---- cross-locale ambiguity ----------------------------------------------
  // Run before anything is consumed, so the question asked is "how would the
  // grammar read this token", not "how did it happen to read it".
  const conflict = detectLocaleConflict(tokens, index);
  if (conflict) {
    return {
      ok: false,
      reason:
        `"${raw}" is ambiguous across the languages this scheduler knows: "${conflict.text}" is ` +
        `${conflict.first.reading} in ${localeName(index, conflict.first.locale)} and ` +
        `${conflict.second.reading} in ${localeName(index, conflict.second.locale)}. ` +
        'Ask the contact to state the day and the time explicitly.',
      interpretation: describe(),
    };
  }

  // ---- vagueness -----------------------------------------------------------
  const vague = findFirst(tokens, consumed, index.vagueness);
  if (vague) {
    return {
      ok: false,
      reason:
        `"${raw}" is too vague to schedule (matched "${textOf(tokens, vague.start, vague.hit.length)}"). ` +
        'Ask for a specific day and a specific time, for example "Tuesday at 2pm".',
      interpretation: describe(),
    };
  }

  // ---- day parts (and `tonight`, which is a day part AND a day anchor) ------
  let dayPart: DayPartName | undefined;
  let dayPartImpliesToday = false;
  let dayPartTodayLabel: string | undefined;
  const dayPartHit = findFirst(tokens, consumed, index.dayParts);
  if (dayPartHit) {
    const entry = dayPartHit.hit.entries[0];
    if (entry) {
      dayPart = entry.value.dayPart;
      dayPartImpliesToday = entry.value.impliesToday;
      dayPartTodayLabel = entry.value.impliesTodayLabel;
      const text = record('day_part', entry.locale, entry.form, dayPartHit.start, dayPartHit.hit.length);
      matched.push(`day_part:${text}`);
    }
  }

  // ---- named clock times ---------------------------------------------------
  let explicitHour: number | undefined;
  let explicitMinute = 0;
  let explicitMeridiem: 'am' | 'pm' | undefined;
  let timeAnchor: string | undefined;

  const namedTimeHit = findFirst(tokens, consumed, index.namedTimes);
  if (namedTimeHit) {
    const entry = namedTimeHit.hit.entries[0];
    if (entry) {
      explicitHour = entry.value.hour;
      explicitMinute = entry.value.minute;
      // A named time is introduced the same way a digit one is - `at midnight`,
      // `בחצות` - so the preposition in front of it belongs to this rule. It
      // used to survive as a leftover, which only went unnoticed because
      // leftovers were being thrown away.
      const introducer = precedingClockPrefix(tokens, consumed, index, namedTimeHit.start);
      if (introducer) {
        record('clock_prefix', introducer.locale, introducer.form, introducer.start, introducer.length);
      }
      const text = record('named_time', entry.locale, entry.form, namedTimeHit.start, namedTimeHit.hit.length);
      timeAnchor = text;
      matched.push(`named_time:${text}`);
    }
  }

  // ---- ISO calendar date (a day anchor, not a slot on its own) -------------
  // Locale-agnostic: ISO-8601 is a standard, not a language.
  let anchorDate: DateTime | undefined;
  let dayAnchor: string | undefined;

  for (let position = 0; position < tokens.length; position += 1) {
    if (consumed[position]) continue;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tokens[position] ?? '');
    if (!iso) continue;
    const candidate = DateTime.fromObject(
      { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) },
      { zone: options.nowLocal.zone },
    );
    if (!candidate.isValid) {
      return {
        ok: false,
        reason: `"${iso[0]}" is not a real calendar date.`,
        interpretation: describe({ ...(dayPart ? { dayPart } : {}) }),
      };
    }
    anchorDate = candidate;
    dayAnchor = `iso_date:${iso[0]}`;
    record('iso_date', LOCALE_AGNOSTIC, 'YYYY-MM-DD', position, 1);
    matched.push(dayAnchor);
    break;
  }

  // ---- relative offset -----------------------------------------------------
  let elapsedMinutes: number | undefined;
  let shiftDays: number | undefined;

  const offset = matchRelativeOffset(tokens, consumed, index);
  if (offset) {
    if (offset.value <= 0) {
      return {
        ok: false,
        reason: `Could not read a quantity from "${textOf(tokens, offset.start, offset.length)}".`,
        interpretation: describe({ ...(dayPart ? { dayPart } : {}) }),
      };
    }
    if (offset.unit === 'minute') elapsedMinutes = offset.value;
    else if (offset.unit === 'hour') elapsedMinutes = offset.value * 60;
    else if (offset.unit === 'day') shiftDays = offset.value;
    else shiftDays = offset.value * 7;

    for (const part of offset.parts) {
      record(part.rule, part.locale, part.form, part.start, part.length);
    }
    matched.push(`relative_offset:${String(offset.value)}_${offset.unitLabel}`);
  }

  // ---- day anchors ---------------------------------------------------------
  if (!anchorDate) {
    const resolved = matchDayAnchor(tokens, consumed, index, options.nowLocal);
    if (resolved) {
      anchorDate = resolved.date;
      dayAnchor = resolved.label;
      for (const part of resolved.parts) {
        record(part.rule, part.locale, part.form, part.start, part.length);
      }
      matched.push(resolved.label);
    }
  }
  if (!anchorDate && dayPartImpliesToday) {
    anchorDate = options.nowLocal.startOf('day');
    dayAnchor = dayPartTodayLabel ?? 'today';
  }

  // ---- clock time ----------------------------------------------------------
  if (explicitHour === undefined) {
    const clock = matchClockTime(tokens, consumed, index, dayPart !== undefined);
    if (clock) {
      if (clock.hour > 23 || clock.minute > 59) {
        return {
          ok: false,
          reason: `"${textOf(tokens, clock.start, clock.length)}" is not a real clock time.`,
          interpretation: describe({ ...(dayPart ? { dayPart } : {}) }),
        };
      }
      explicitHour = clock.hour;
      explicitMinute = clock.minute;
      explicitMeridiem = clock.meridiem;
      timeAnchor = record('clock_time', clock.locale, clock.form, clock.start, clock.length);
      matched.push(`clock_time:${timeAnchor}`);
    }
  }

  // ---- carrier / filler tokens ---------------------------------------------
  // LAST, after every rule that could have wanted them, so a declared filler
  // can never shadow a real match: `a` is a quantity in "in a couple of hours"
  // and a carrier only where the offset rule did not take it.
  for (let position = 0; position < tokens.length; position += 1) {
    if (consumed[position]) continue;
    const hit = matchAt(tokens, consumed, position, index.carriers);
    const entry = hit?.entries[0];
    if (!hit || !entry) continue;
    const text = record('carrier', entry.locale, entry.form, position, hit.length);
    matched.push(`carrier:${entry.locale}:${text}`);
    position += hit.length - 1;
  }

  const interpretation = (): NaturalLanguageInterpretation =>
    describe({
      ...(dayAnchor ? { dayAnchor } : {}),
      ...(dayPart ? { dayPart } : {}),
      ...(timeAnchor ? { timeAnchor } : {}),
    });

  // ---- FAIL CLOSED: nothing may survive unaccounted for --------------------
  const leftover = leftoverTokens();
  const everyTokenConsumed = leftover.length === 0;
  if (leftover.some((token) => /\d/.test(token))) {
    return {
      ok: false,
      reason:
        `"${raw}" contains a number this scheduler could not interpret ` +
        `(left over: "${leftover.join(' ')}"). Ask for an explicit day and time.`,
      interpretation: interpretation(),
    };
  }
  if (leftover.some((token) => index.periods.some((entry) => entry.tokens.length === 1 && entry.tokens[0] === token))) {
    return {
      ok: false,
      reason:
        `"${raw}" names a period rather than a moment. ` +
        'Ask for a specific day and time, for example "Tuesday at 2pm".',
      interpretation: interpretation(),
    };
  }
  if (leftover.length > 0) {
    // THE RULE THIS FILE EXISTS FOR. No alphabet is named here and none ever
    // will be: a word no lexicon claimed is a word nobody checked, and a
    // booking must not rest on one. `מחר`, `غدا`, `завтра` and `demain` are all
    // refused by this one branch, and each refusal names the word.
    return {
      ok: false,
      reason:
        `"${raw}" contains words this scheduler could not account for ` +
        `(left over: "${leftover.join(' ')}"). Every word has to be understood before a time can be ` +
        'booked, so this is refused rather than guessed. Ask for a specific day and a specific time, ' +
        'for example "Tuesday at 2pm".',
      interpretation: interpretation(),
    };
  }

  // ---- contradictions ------------------------------------------------------
  if (elapsedMinutes !== undefined && (anchorDate || dayPart || explicitHour !== undefined)) {
    return {
      ok: false,
      reason: `"${raw}" mixes a relative offset with an absolute day or time. Ask for one or the other.`,
      interpretation: interpretation(),
    };
  }
  if (shiftDays !== undefined && dayAnchor !== undefined) {
    return {
      ok: false,
      reason: `"${raw}" mixes a relative day offset with a named day. Ask for one or the other.`,
      interpretation: interpretation(),
    };
  }

  // ---- assemble ------------------------------------------------------------
  if (elapsedMinutes !== undefined) {
    return {
      ok: true,
      kind: 'ELAPSED_FROM_NOW',
      epochMillis: options.nowLocal.plus({ minutes: elapsedMinutes }).toMillis(),
      interpretation: interpretation(),
    };
  }

  let date: DateTime;
  if (shiftDays !== undefined) {
    // A day/week offset keeps the WALL-CLOCK time of day, which is what "in
    // three days" means to a person, and is why it is not an elapsed duration.
    date = options.nowLocal.plus({ days: shiftDays }).startOf('day');
  } else if (anchorDate) {
    date = anchorDate;
  } else if (everyTokenConsumed && (explicitHour !== undefined || dayPart !== undefined)) {
    // THE MOST DANGEROUS BRANCH IN THIS FILE. A time with no named day means
    // TODAY - which is right for "at 9am" and catastrophically wrong for a
    // phrase whose day word was thrown away. It is guarded on
    // `everyTokenConsumed` so the guarantee is stated where the decision is
    // made, not only in the refusal above.
    //
    // It is deliberately not rolled forward to tomorrow: if it has already
    // passed, the caller's `in_the_future` check rejects it with a precise
    // reason instead of this grammar guessing.
    date = options.nowLocal.startOf('day');
    dayAnchor = 'implicit_today';
    matched.push(dayAnchor);
  } else {
    return {
      ok: false,
      reason: `"${raw}" does not name a day or a time this scheduler can resolve.`,
      interpretation: interpretation(),
    };
  }

  let hour: number;
  let minute: number;

  if (explicitHour !== undefined) {
    const resolvedHour = resolveHour(explicitHour, explicitMeridiem, dayPart, options.dayParts);
    if (!resolvedHour.ok) {
      return { ok: false, reason: resolvedHour.reason, interpretation: interpretation() };
    }
    hour = resolvedHour.hour;
    minute = explicitMinute;
    matched.push(`hour_resolution:${resolvedHour.how}`);
  } else if (dayPart !== undefined) {
    const preferred = splitLocalTime(options.dayParts[dayPart].preferredLocal);
    hour = preferred.hour;
    minute = preferred.minute;
    matched.push(`day_part_preferred:${dayPart}@${options.dayParts[dayPart].preferredLocal}`);
  } else if (shiftDays !== undefined) {
    hour = options.nowLocal.hour;
    minute = options.nowLocal.minute;
    matched.push('kept_current_time_of_day');
  } else {
    return {
      ok: false,
      reason: `"${raw}" names a day but no time. A date without a time is not a slot.`,
      interpretation: interpretation(),
    };
  }

  return {
    ok: true,
    kind: 'LOCAL_WALL_TIME',
    target: { year: date.year, month: date.month, day: date.day, hour, minute },
    interpretation: interpretation(),
  };
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * Grammar-level normalisation, applied AFTER `normalizeScript`.
 *
 * Case folding and sentence punctuation only. Everything the old `normalize()`
 * did beyond this - rewriting `p.m.`, deleting `o'clock`, turning `half an
 * hour` into `in 30 minutes`, collapsing `a couple of` - has become declared
 * lexicon data, because a rewrite is a silent edit of what the contact said and
 * this grammar now has to account for every word of it.
 */
function normalizeGrammar(text: string): string {
  return text
    .toLowerCase()
    .replace(/[,!?;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One span a composite rule consumed, so the caller can record it. */
interface ConsumedPart {
  readonly rule: string;
  readonly locale: string;
  readonly form: string;
  readonly start: number;
  readonly length: number;
}

/**
 * The standalone clock preposition immediately before `start`, if there is one.
 *
 * `at midnight` and `בחצות` introduce a named time exactly the way `at 15:00`
 * introduces a digit one, so the word belongs to whichever rule takes the time.
 */
function precedingClockPrefix(
  tokens: readonly string[],
  consumed: readonly boolean[],
  index: LexiconIndex,
  start: number,
): ConsumedPart | undefined {
  for (const entry of index.clockPrefixesStandalone) {
    const length = entry.tokens.length;
    if (start - length < 0) continue;
    const hit = matchAt(tokens, consumed, start - length, index.clockPrefixesStandalone);
    if (!hit || hit.length !== length) continue;
    const matchedEntry = hit.entries[0];
    if (!matchedEntry) continue;
    return {
      rule: 'clock_prefix',
      locale: matchedEntry.locale,
      form: matchedEntry.form,
      start: start - length,
      length,
    };
  }
  return undefined;
}

function localeName(index: LexiconIndex, locale: string): string {
  return index.lexicons.find((lexicon) => lexicon.locale === locale)?.displayName ?? locale;
}

/**
 * The cross-locale ambiguity pre-pass.
 *
 * Walks the tokens greedily, longest-match-first, over every SEMANTIC form in
 * every registered lexicon, and reports the first span two locales would read
 * differently. Spans inside a longer match are never inspected, so a
 * disagreement buried in a phrase that matched as a whole cannot cause a
 * spurious refusal.
 */
function detectLocaleConflict(
  tokens: readonly string[],
  index: LexiconIndex,
): { text: string; first: FormEntry<unknown>; second: FormEntry<unknown> } | undefined {
  const nothingConsumed = tokens.map(() => false);
  let position = 0;
  while (position < tokens.length) {
    const hit = matchAt(tokens, nothingConsumed, position, index.semantic);
    if (!hit) {
      position += 1;
      continue;
    }
    for (const first of hit.entries) {
      for (const second of hit.entries) {
        if (first.locale === second.locale || first.valueKey === second.valueKey) continue;
        return { text: textOf(tokens, position, hit.length), first, second };
      }
    }
    position += hit.length;
  }
  return undefined;
}

interface OffsetMatch {
  readonly start: number;
  readonly length: number;
  readonly value: number;
  readonly unit: OffsetUnit;
  /** What goes in the `relative_offset:` label - the words actually used. */
  readonly unitLabel: string;
  readonly parts: readonly ConsumedPart[];
}

/** Plural unit names for offsets declared as a whole duration (`half an hour`). */
const CANONICAL_UNIT_LABEL: Record<OffsetUnit, string> = {
  minute: 'minutes',
  hour: 'hours',
  day: 'days',
  week: 'weeks',
};

function matchRelativeOffset(
  tokens: readonly string[],
  consumed: readonly boolean[],
  index: LexiconIndex,
): OffsetMatch | undefined {
  for (let start = 0; start < tokens.length; start += 1) {
    if (consumed[start]) continue;
    const found = matchOffsetAt(tokens, consumed, index, start);
    if (found) return found;
  }
  return undefined;
}

function matchOffsetAt(
  tokens: readonly string[],
  consumed: readonly boolean[],
  index: LexiconIndex,
  start: number,
): OffsetMatch | undefined {
  const parts: ConsumedPart[] = [];
  let cursor = start;

  const prefixHit = matchAt(tokens, consumed, cursor, index.offsetPrefixes);
  const prefixEntry = prefixHit?.entries[0];
  if (prefixHit && prefixEntry) {
    parts.push({
      rule: 'offset_prefix',
      locale: prefixEntry.locale,
      form: prefixEntry.form,
      start: cursor,
      length: prefixHit.length,
    });
    cursor += prefixHit.length;
  }

  const softenerHit = matchAt(tokens, consumed, cursor, index.offsetSofteners);
  const softenerEntry = softenerHit?.entries[0];
  if (softenerHit && softenerEntry) {
    parts.push({
      rule: 'offset_softener',
      locale: softenerEntry.locale,
      form: softenerEntry.form,
      start: cursor,
      length: softenerHit.length,
    });
    cursor += softenerHit.length;
  }

  // A whole duration in one phrase: `half an hour`, and Hebrew's DUAL forms
  // (שעתיים = two hours) which have no separable quantity at all.
  const fixedHit = matchAt(tokens, consumed, cursor, index.fixedDurations);
  const fixedEntry = fixedHit?.entries[0];
  if (fixedHit && fixedEntry && (prefixEntry !== undefined || fixedEntry.value.prefixOptional)) {
    parts.push({
      rule: 'fixed_duration',
      locale: fixedEntry.locale,
      form: fixedEntry.form,
      start: cursor,
      length: fixedHit.length,
    });
    return {
      start,
      length: cursor + fixedHit.length - start,
      value: fixedEntry.value.value,
      unit: fixedEntry.value.unit,
      unitLabel: CANONICAL_UNIT_LABEL[fixedEntry.value.unit],
      parts,
    };
  }

  // Otherwise: a quantity, written in digits or in words, then a unit.
  let value: number;
  const digits = /^\d{1,4}$/.exec(consumed[cursor] ? '' : (tokens[cursor] ?? ''));
  if (digits) {
    value = Number(digits[0]);
    parts.push({ rule: 'offset_quantity', locale: LOCALE_AGNOSTIC, form: 'N', start: cursor, length: 1 });
    cursor += 1;
  } else {
    const quantityHit = matchAt(tokens, consumed, cursor, index.offsetQuantities);
    const quantityEntry = quantityHit?.entries[0];
    if (!quantityHit || !quantityEntry) return undefined;
    value = quantityEntry.value.value;
    parts.push({
      rule: 'offset_quantity',
      locale: quantityEntry.locale,
      form: quantityEntry.form,
      start: cursor,
      length: quantityHit.length,
    });
    cursor += quantityHit.length;
  }

  const unitHit = matchAt(tokens, consumed, cursor, index.offsetUnits);
  const unitEntry = unitHit?.entries[0];
  if (!unitHit || !unitEntry) return undefined;
  if (prefixEntry === undefined && (index.offsetPrefixRequired.get(unitEntry.locale) ?? true)) return undefined;

  parts.push({
    rule: 'offset_unit',
    locale: unitEntry.locale,
    form: unitEntry.form,
    start: cursor,
    length: unitHit.length,
  });

  return {
    start,
    length: cursor + unitHit.length - start,
    value,
    unit: unitEntry.value.unit,
    unitLabel: textOf(tokens, cursor, unitHit.length),
    parts,
  };
}

interface DayAnchorMatch {
  readonly date: DateTime;
  readonly label: string;
  readonly parts: readonly ConsumedPart[];
}

function matchDayAnchor(
  tokens: readonly string[],
  consumed: readonly boolean[],
  index: LexiconIndex,
  nowLocal: DateTime,
): DayAnchorMatch | undefined {
  const anchor = findFirst(tokens, consumed, index.dayAnchors);
  const anchorEntry = anchor?.hit.entries[0];
  if (anchor && anchorEntry) {
    const parts: ConsumedPart[] = [
      {
        rule: 'day_anchor',
        locale: anchorEntry.locale,
        form: anchorEntry.form,
        start: anchor.start,
        length: anchor.hit.length,
      },
    ];
    if (anchorEntry.value.kind === 'END_OF_WEEK') {
      const friday = nowLocal.startOf('week').plus({ days: 4 }).startOf('day');
      const date = friday < nowLocal.startOf('day') ? friday.plus({ weeks: 1 }) : friday;
      return { date, label: anchorEntry.value.label, parts };
    }
    return {
      date: nowLocal.plus({ days: anchorEntry.value.offsetDays ?? 0 }).startOf('day'),
      label: anchorEntry.value.label,
      parts,
    };
  }

  const weekday = findFirst(tokens, consumed, index.weekdays);
  const weekdayEntry = weekday?.hit.entries[0];
  if (!weekday || !weekdayEntry) return undefined;

  const parts: ConsumedPart[] = [];
  let isNext = false;

  // Modifiers BEFORE the weekday, as a run: `on`, `this`, `next`, `the`.
  let boundary = weekday.start;
  for (;;) {
    let taken: { length: number; entry: FormEntry<WeekdayModifierEntry> } | undefined;
    for (let length = index.maxModifierTokens; length >= 1; length -= 1) {
      if (boundary - length < 0) continue;
      const hit = matchAt(tokens, consumed, boundary - length, index.modifiersBefore);
      const entry = hit?.entries[0];
      if (hit && entry && hit.length === length) {
        taken = { length, entry };
        break;
      }
    }
    if (!taken) break;
    boundary -= taken.length;
    if (taken.entry.value.kind === 'NEXT') isNext = true;
    parts.push({
      rule: 'weekday_modifier',
      locale: taken.entry.locale,
      form: taken.entry.form,
      start: boundary,
      length: taken.length,
    });
  }

  parts.push({
    rule: 'weekday',
    locale: weekdayEntry.locale,
    form: weekdayEntry.form,
    start: weekday.start,
    length: weekday.hit.length,
  });

  // And modifiers AFTER it, which is where Hebrew puts them: יום חמישי הבא.
  const afterAt = weekday.start + weekday.hit.length;
  const afterHit = matchAt(tokens, consumed, afterAt, index.modifiersAfter);
  const afterEntry = afterHit?.entries[0];
  if (afterHit && afterEntry) {
    if (afterEntry.value.kind === 'NEXT') isNext = true;
    parts.push({
      rule: 'weekday_modifier',
      locale: afterEntry.locale,
      form: afterEntry.form,
      start: afterAt,
      length: afterHit.length,
    });
  }

  const target = weekdayEntry.value.isoWeekday;
  const date = isNext
    ? nowLocal
        .startOf('week')
        .plus({ weeks: 1, days: target - 1 })
        .startOf('day')
    : nowLocal.plus({ days: (target - nowLocal.weekday + 7) % 7 || 7 }).startOf('day');

  return {
    date,
    label: `${isNext ? 'next_' : ''}weekday:${textOf(tokens, weekday.start, weekday.hit.length)}`,
    parts,
  };
}

interface ClockMatch {
  readonly start: number;
  readonly length: number;
  readonly hour: number;
  readonly minute: number;
  readonly meridiem: 'am' | 'pm' | undefined;
  /** The locale whose preposition introduced it, or `*` for bare digits. */
  readonly locale: string;
  readonly form: string;
}

/** `15:00`, `3pm`, `12.30`, and the `ב`/`@`-prefixed spellings of each. */
function parseClockDigits(
  text: string,
  index: LexiconIndex,
): { hour: number; minute: number | undefined; meridiem: 'am' | 'pm' | undefined } | undefined {
  const parsed = /^(\d{1,2})(?:[:.](\d{2}))?(.*)$/.exec(text);
  if (!parsed) return undefined;
  const tail = parsed[3] ?? '';
  let meridiem: 'am' | 'pm' | undefined;
  if (tail.length > 0) {
    const entry = index.meridiems.find((candidate) => candidate.tokens.length === 1 && candidate.tokens[0] === tail);
    if (!entry) return undefined;
    meridiem = entry.value.meridiem;
  }
  return {
    hour: Number(parsed[1]),
    minute: parsed[2] === undefined ? undefined : Number(parsed[2]),
    meridiem,
  };
}

function parseClockToken(
  text: string,
  index: LexiconIndex,
): { core: NonNullable<ReturnType<typeof parseClockDigits>>; prefix?: FormEntry<ClockPrefixEntry> } | undefined {
  const direct = parseClockDigits(text, index);
  if (direct) return { core: direct };
  for (const entry of index.clockPrefixesAttaching) {
    if (entry.tokens.length !== 1 || !text.startsWith(entry.tokens[0] ?? '')) continue;
    const afterPrefix = text.slice((entry.tokens[0] ?? '').length);
    for (const separator of entry.value.attachedSeparators ?? ['']) {
      if (!afterPrefix.startsWith(separator)) continue;
      const rest = afterPrefix.slice(separator.length);
      if (rest.length === 0) continue;
      const core = parseClockDigits(rest, index);
      if (core) return { core, prefix: entry };
    }
  }
  return undefined;
}

/**
 * The first clock time in the phrase, or nothing.
 *
 * "First" is deliberate and matches the behaviour this replaces: a bare number
 * that is NOT marked as a time stops the search rather than letting a later
 * number be promoted. Otherwise "the 15th, tomorrow at 3pm" would quietly
 * become 15:00.
 */
function matchClockTime(
  tokens: readonly string[],
  consumed: readonly boolean[],
  index: LexiconIndex,
  hasDayPart: boolean,
): ClockMatch | undefined {
  for (let start = 0; start < tokens.length; start += 1) {
    if (consumed[start]) continue;

    let cursor = start;
    const prefixHit = matchAt(tokens, consumed, cursor, index.clockPrefixesStandalone);
    const prefixEntry = prefixHit?.entries[0];
    if (prefixHit && prefixEntry) cursor += prefixHit.length;

    if (cursor >= tokens.length || consumed[cursor]) continue;
    const parsed = parseClockToken(tokens[cursor] ?? '', index);
    if (!parsed) continue;

    let end = cursor;
    let meridiem = parsed.core.meridiem;

    if (meridiem === undefined && end + 1 < tokens.length && !consumed[end + 1]) {
      const meridiemHit = matchAt(tokens, consumed, end + 1, index.meridiems);
      const meridiemEntry = meridiemHit?.entries[0];
      if (meridiemHit && meridiemEntry) {
        meridiem = meridiemEntry.value.meridiem;
        end += meridiemHit.length;
      }
    }

    let hasSuffix = false;
    if (end + 1 < tokens.length && !consumed[end + 1]) {
      const suffixHit = matchAt(tokens, consumed, end + 1, index.clockSuffixes);
      if (suffixHit) {
        hasSuffix = true;
        end += suffixHit.length;
      }
    }

    const introduced = prefixEntry !== undefined || parsed.prefix !== undefined;
    const hasMinutes = parsed.core.minute !== undefined;

    // A bare number is only read as a time when something marks it as one.
    // Otherwise "the 15th" would silently become 15:00.
    const looksLikeATime =
      meridiem !== undefined || hasMinutes || introduced || parsed.core.hour >= 13 || hasDayPart || hasSuffix;
    if (!looksLikeATime) return undefined;

    const source = prefixEntry ?? parsed.prefix;
    return {
      start,
      length: end - start + 1,
      hour: parsed.core.hour,
      minute: parsed.core.minute ?? 0,
      meridiem,
      locale: source?.locale ?? LOCALE_AGNOSTIC,
      form: source?.form ?? 'HH:mm',
    };
  }
  return undefined;
}

type HourResolution = { ok: true; hour: number; how: string } | { ok: false; reason: string };

/**
 * Turn a written hour into a 24-hour hour, or refuse.
 *
 * The meridiem rules, in order:
 *  - explicit `am`/`pm` always wins, and `12am` is 00:00 while `12pm` is 12:00;
 *  - an hour of 0 or 13..23 is already unambiguous;
 *  - `12` with no meridiem is read as noon;
 *  - 1..11 with no meridiem is resolved ONLY by a day part, and only when
 *    exactly one of {h, h+12} falls inside that day part's window;
 *  - otherwise it is refused.
 */
function resolveHour(
  hour: number,
  meridiem: 'am' | 'pm' | undefined,
  dayPart: DayPartName | undefined,
  dayParts: DayPartsPolicy,
): HourResolution {
  if (meridiem !== undefined) {
    if (hour > 12) {
      return { ok: false, reason: `"${hour}${meridiem}" is not a real 12-hour clock time.` };
    }
    const resolved = meridiem === 'am' ? hour % 12 : (hour % 12) + 12;
    if (dayPart !== undefined && !isInsideDayPart(resolved, dayParts[dayPart])) {
      return {
        ok: false,
        reason:
          `"${hour}${meridiem}" is ${pad(resolved)}:00, which is not in the ${dayPart} ` +
          `(${dayParts[dayPart].startLocal}-${dayParts[dayPart].endLocal}). ` +
          'Ask the contact which one they meant.',
      };
    }
    return { ok: true, hour: resolved, how: `explicit_${meridiem}` };
  }

  if (hour === 0 || hour >= 13) {
    return { ok: true, hour, how: 'unambiguous_24h' };
  }

  if (hour === 12) {
    if (dayPart !== undefined && !isInsideDayPart(12, dayParts[dayPart])) {
      return {
        ok: false,
        reason: `"12" reads as noon, which is not in the ${dayPart}. Ask the contact which one they meant.`,
      };
    }
    return { ok: true, hour: 12, how: 'noon' };
  }

  if (dayPart !== undefined) {
    const window = dayParts[dayPart];
    const candidates = [hour, hour + 12].filter((candidate) => isInsideDayPart(candidate, window));
    const only = candidates[0];
    if (candidates.length === 1 && only !== undefined) {
      return { ok: true, hour: only, how: `day_part_${dayPart}` };
    }
    return {
      ok: false,
      reason:
        `"${hour}" in the ${dayPart} (${window.startLocal}-${window.endLocal}) could mean ` +
        `${pad(hour)}:00 or ${pad(hour + 12)}:00. Ask the contact to say am or pm.`,
    };
  }

  return {
    ok: false,
    reason:
      `"${hour}" could mean ${pad(hour)}:00 or ${pad(hour + 12)}:00 and nothing in the request ` +
      'settles it. Ask the contact to say am or pm.',
  };
}

function isInsideDayPart(hour: number, window: DayPartWindow): boolean {
  const start = splitLocalTime(window.startLocal);
  const end = splitLocalTime(window.endLocal);
  const minutes = hour * 60;
  return minutes >= start.hour * 60 + start.minute && minutes < end.hour * 60 + end.minute;
}

export function splitLocalTime(value: string): { hour: number; minute: number } {
  const [hourPart, minutePart] = value.split(':');
  return { hour: Number(hourPart), minute: Number(minutePart) };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
