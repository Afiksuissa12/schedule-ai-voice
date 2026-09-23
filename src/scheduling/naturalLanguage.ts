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
 * refusal into `INVALID_FORMAT`. Three refusals are deliberate and easy to
 * mistake for gaps:
 *
 *  1. A bare 12-hour clock time with no meridiem and no day part - "at 3" - is
 *     REFUSED. 03:00 and 15:00 are twelve hours apart and the cost of guessing
 *     wrong is a phone call in the middle of the night.
 *  2. A contradiction - "tomorrow morning at 3pm", "tomorrow in two hours" - is
 *     REFUSED rather than resolved by precedence.
 *  3. Vague intent - "sometime next week", "later", "soon" - is REFUSED. It is
 *     also refused when a leftover number or a bare "week"/"month"/"year" token
 *     survives parsing, which is the safety net for phrasings this grammar has
 *     never seen.
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
 */
import { DateTime } from 'luxon';

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

/** How the grammar got to its answer. Copied into `ValidationProvenance.notes`. */
export interface NaturalLanguageInterpretation {
  /** Grammar rules that fired, in the order they were applied. */
  readonly matched: readonly string[];
  readonly dayAnchor?: string;
  readonly dayPart?: DayPartName;
  readonly timeAnchor?: string;
  /** The normalised text the grammar actually worked on. */
  readonly normalized: string;
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
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const WEEKDAY_NUMBERS: Record<string, number> = {
  monday: 1,
  mondays: 1,
  mon: 1,
  tuesday: 2,
  tuesdays: 2,
  tues: 2,
  tue: 2,
  wednesday: 3,
  wednesdays: 3,
  weds: 3,
  wed: 3,
  thursday: 4,
  thursdays: 4,
  thurs: 4,
  thur: 4,
  thu: 4,
  friday: 5,
  fridays: 5,
  fri: 5,
  saturday: 6,
  saturdays: 6,
  sat: 6,
  sunday: 7,
  sundays: 7,
  sun: 7,
};

/** Longest-first so `tuesday` is never shadowed by `tue`. */
const WEEKDAY_ALTERNATION = Object.keys(WEEKDAY_NUMBERS)
  .sort((a, b) => b.length - a.length)
  .join('|');

const WEEKDAY_RE = new RegExp(
  String.raw`\b((?:(?:on|this|next|coming|the)\s+)*)(${WEEKDAY_ALTERNATION})\b`,
);

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  couple: 2,
  two: 2,
  few: 3,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const RELATIVE_OFFSET_RE = new RegExp(
  String.raw`\bin\s+(?:about\s+|around\s+|roughly\s+)?(\d{1,4}|${Object.keys(NUMBER_WORDS).join('|')})\s*` +
    String.raw`(minutes|minute|mins|min|hours|hour|hrs|hr|days|day|weeks|week)\b`,
);

/**
 * Phrases that signal the contact has NOT actually named a time. Matching any
 * of these refuses the whole input even when other tokens would have parsed -
 * "call me back tomorrow sometime" is not a scheduling instruction.
 */
const VAGUENESS_MARKERS = [
  'sometime',
  'some time',
  'any time',
  'anytime',
  'whenever',
  'later on',
  'later',
  'soon',
  'asap',
  'shortly',
  'in a bit',
  'in a while',
  'eventually',
  'around then',
  'or so',
  'ish',
];

/**
 * Tokens that must not survive parsing. A leftover `week` means the contact
 * said something like "next week" that this grammar deliberately does not
 * resolve to a single instant.
 */
const LEFTOVER_BLOCKLIST_RE = /\b(weeks?|months?|years?|quarters?|fortnights?)\b/;

const TIME_RE = /(?:\b(at|@|around|about)\s*)?\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseNaturalLanguageDateTime(
  raw: string,
  options: ParseNaturalLanguageOptions,
): NaturalLanguageParse {
  const normalized = normalize(raw);
  const matched: string[] = [];
  let remaining = normalized;

  const describe = (extra?: Partial<NaturalLanguageInterpretation>): NaturalLanguageInterpretation => ({
    matched: [...matched],
    normalized,
    ...extra,
  });

  if (normalized.length === 0) {
    return { ok: false, reason: 'The proposed value is empty.', interpretation: describe() };
  }

  for (const marker of VAGUENESS_MARKERS) {
    if (new RegExp(String.raw`\b${marker.replace(/ /g, String.raw`\s+`)}\b`).test(normalized)) {
      return {
        ok: false,
        reason:
          `"${raw}" is too vague to schedule (matched "${marker}"). ` +
          'Ask for a specific day and a specific time, for example "Tuesday at 2pm".',
        interpretation: describe(),
      };
    }
  }

  // ---- day parts (and `tonight`, which is a day part AND a day anchor) ------
  let dayPart: DayPartName | undefined;
  let dayPartImpliesToday = false;
  const dayPartMatch = /\b(morning|afternoon|evening|tonight)\b/.exec(remaining);
  if (dayPartMatch?.[1]) {
    dayPart = dayPartMatch[1] === 'tonight' ? 'evening' : (dayPartMatch[1] as DayPartName);
    dayPartImpliesToday = dayPartMatch[1] === 'tonight';
    matched.push(`day_part:${dayPartMatch[1]}`);
    remaining = blank(remaining, dayPartMatch);
  }

  // ---- named clock times ---------------------------------------------------
  let explicitHour: number | undefined;
  let explicitMinute = 0;
  let explicitMeridiem: 'am' | 'pm' | undefined;
  let timeAnchor: string | undefined;

  const namedTimeMatch = /\b(noon|midday|midnight)\b/.exec(remaining);
  if (namedTimeMatch?.[1]) {
    explicitHour = namedTimeMatch[1] === 'midnight' ? 0 : 12;
    explicitMinute = 0;
    timeAnchor = namedTimeMatch[1];
    matched.push(`named_time:${namedTimeMatch[1]}`);
    remaining = blank(remaining, namedTimeMatch);
  }

  // ---- ISO calendar date (a day anchor, not a slot on its own) -------------
  let anchorDate: DateTime | undefined;
  let dayAnchor: string | undefined;

  const isoDateMatch = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(remaining);
  if (isoDateMatch) {
    const candidate = DateTime.fromObject(
      { year: Number(isoDateMatch[1]), month: Number(isoDateMatch[2]), day: Number(isoDateMatch[3]) },
      { zone: options.nowLocal.zone },
    );
    if (!candidate.isValid) {
      return {
        ok: false,
        reason: `"${isoDateMatch[0]}" is not a real calendar date.`,
        interpretation: describe({ ...(dayPart ? { dayPart } : {}) }),
      };
    }
    anchorDate = candidate;
    dayAnchor = `iso_date:${isoDateMatch[0]}`;
    matched.push(dayAnchor);
    remaining = blank(remaining, isoDateMatch);
  }

  // ---- relative offset -----------------------------------------------------
  let elapsedMinutes: number | undefined;
  let shiftDays: number | undefined;

  const offsetMatch = RELATIVE_OFFSET_RE.exec(remaining);
  if (offsetMatch?.[1] && offsetMatch[2]) {
    const rawQuantity = offsetMatch[1];
    const quantity = /^\d+$/.test(rawQuantity) ? Number(rawQuantity) : NUMBER_WORDS[rawQuantity];
    if (quantity === undefined || quantity <= 0) {
      return {
        ok: false,
        reason: `Could not read a quantity from "${offsetMatch[0]}".`,
        interpretation: describe({ ...(dayPart ? { dayPart } : {}) }),
      };
    }
    const unit = offsetMatch[2];
    if (unit.startsWith('min')) {
      elapsedMinutes = quantity;
    } else if (unit.startsWith('h')) {
      elapsedMinutes = quantity * 60;
    } else if (unit.startsWith('d')) {
      shiftDays = quantity;
    } else {
      shiftDays = quantity * 7;
    }
    matched.push(`relative_offset:${quantity}_${unit}`);
    remaining = blank(remaining, offsetMatch);
  }

  // ---- day anchors ---------------------------------------------------------
  if (!anchorDate) {
    const resolved = matchDayAnchor(remaining, options.nowLocal);
    if (resolved) {
      anchorDate = resolved.date;
      dayAnchor = resolved.label;
      matched.push(resolved.label);
      remaining = resolved.remaining;
    }
  }
  if (!anchorDate && dayPartImpliesToday) {
    anchorDate = options.nowLocal.startOf('day');
    dayAnchor = 'tonight';
  }

  // ---- clock time ----------------------------------------------------------
  if (explicitHour === undefined) {
    const timeMatch = TIME_RE.exec(remaining);
    if (timeMatch?.[2]) {
      const hour = Number(timeMatch[2]);
      const minute = timeMatch[3] === undefined ? 0 : Number(timeMatch[3]);
      const meridiem = timeMatch[4] as 'am' | 'pm' | undefined;
      const introducedByAt = timeMatch[1] !== undefined;
      const hasMinutes = timeMatch[3] !== undefined;

      // A bare number is only read as a time when something marks it as one.
      // Otherwise "the 15th" would silently become 15:00.
      const looksLikeATime = meridiem !== undefined || hasMinutes || introducedByAt || hour >= 13 || dayPart !== undefined;
      if (looksLikeATime) {
        if (hour > 23 || minute > 59) {
          return {
            ok: false,
            reason: `"${timeMatch[0].trim()}" is not a real clock time.`,
            interpretation: describe({ ...(dayPart ? { dayPart } : {}) }),
          };
        }
        explicitHour = hour;
        explicitMinute = minute;
        explicitMeridiem = meridiem;
        timeAnchor = timeMatch[0].trim();
        matched.push(`clock_time:${timeAnchor}`);
        remaining = blank(remaining, timeMatch);
      }
    }
  }

  const interpretation = (): NaturalLanguageInterpretation =>
    describe({
      ...(dayAnchor ? { dayAnchor } : {}),
      ...(dayPart ? { dayPart } : {}),
      ...(timeAnchor ? { timeAnchor } : {}),
    });

  // ---- safety nets ---------------------------------------------------------
  if (/\d/.test(remaining)) {
    return {
      ok: false,
      reason:
        `"${raw}" contains a number this scheduler could not interpret ` +
        `(left over: "${remaining.trim().replace(/\s+/g, ' ')}"). Ask for an explicit day and time.`,
      interpretation: interpretation(),
    };
  }
  if (LEFTOVER_BLOCKLIST_RE.test(remaining)) {
    return {
      ok: false,
      reason:
        `"${raw}" names a period rather than a moment. ` +
        'Ask for a specific day and time, for example "Tuesday at 2pm".',
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
  } else if (explicitHour !== undefined || dayPart !== undefined) {
    // A time with no named day means TODAY. It is deliberately not rolled
    // forward to tomorrow: if it has already passed, the caller's `in_the_future`
    // check rejects it with a precise reason instead of this grammar guessing.
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

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\ba\.m\.?/g, 'am')
    .replace(/\bp\.m\.?/g, 'pm')
    .replace(/\bo'?\s*clock\b/g, ' ')
    .replace(/\bhalf an hour\b/g, 'in 30 minutes')
    .replace(/\ba couple of\b/g, 'couple')
    .replace(/\ba couple\b/g, 'couple')
    .replace(/\ba few\b/g, 'few')
    .replace(/[,!?;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Replace a match with spaces so later patterns cannot re-read it. */
function blank(text: string, match: RegExpExecArray): string {
  const start = match.index;
  return `${text.slice(0, start)}${' '.repeat(match[0].length)}${text.slice(start + match[0].length)}`;
}

function matchDayAnchor(
  text: string,
  nowLocal: DateTime,
): { date: DateTime; label: string; remaining: string } | undefined {
  const dayAfter = /\b(?:the\s+)?day after tomorrow\b/.exec(text);
  if (dayAfter) {
    return {
      date: nowLocal.plus({ days: 2 }).startOf('day'),
      label: 'day_after_tomorrow',
      remaining: blank(text, dayAfter),
    };
  }

  const tomorrow = /\btomorrow\b/.exec(text);
  if (tomorrow) {
    return { date: nowLocal.plus({ days: 1 }).startOf('day'), label: 'tomorrow', remaining: blank(text, tomorrow) };
  }

  const today = /\btoday\b/.exec(text);
  if (today) {
    return { date: nowLocal.startOf('day'), label: 'today', remaining: blank(text, today) };
  }

  const endOfWeek = /\bend of (?:the )?(?:business )?week\b/.exec(text);
  if (endOfWeek) {
    const friday = nowLocal.startOf('week').plus({ days: 4 }).startOf('day');
    const date = friday < nowLocal.startOf('day') ? friday.plus({ weeks: 1 }) : friday;
    return { date, label: 'end_of_week', remaining: blank(text, endOfWeek) };
  }

  const weekday = WEEKDAY_RE.exec(text);
  if (weekday?.[2]) {
    const target = WEEKDAY_NUMBERS[weekday[2]];
    if (target === undefined) {
      return undefined;
    }
    const isNext = /\bnext\b/.test(weekday[1] ?? '');
    const date = isNext
      ? nowLocal.startOf('week').plus({ weeks: 1, days: target - 1 }).startOf('day')
      : nowLocal
          .plus({ days: ((target - nowLocal.weekday + 7) % 7 || 7) })
          .startOf('day');
    return {
      date,
      label: `${isNext ? 'next_' : ''}weekday:${weekday[2]}`,
      remaining: blank(text, weekday),
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
