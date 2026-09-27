/**
 * LOCALE-AWARE RESOLUTION ACROSS TIME-ZONE AND DST BOUNDARIES.
 *
 * `tests/scheduling/dst.test.ts` establishes that the DST machinery is correct
 * for New York and Sydney, on the ISO-local path, in English. This file extends
 * that in the two directions the Hebrew work opened up, and it deliberately
 * keeps that file's idioms - the same `resolve(raw, timezone)` helper shape, the
 * same "TRANSITIONS USED (verified against the tz database)" header, the same
 * habit of writing the instant out rather than recomputing it - so the two read
 * as one body of work rather than two styles.
 *
 *  1. THE CONTACT'S CALENDAR DAY IS NOT THE UTC DAY. Every day word in this
 *     grammar is anchored on `now` rendered in the CONTACT'S zone. When those
 *     two disagree - and near local midnight in Asia/Jerusalem, America/New_York,
 *     Pacific/Auckland and Pacific/Honolulu they routinely do - a resolver that
 *     had quietly anchored on UTC would be exactly one day out, in exactly the
 *     way § 8.3 describes. Nothing in the old English-only suite could have
 *     noticed, because its `now` instants were all mid-morning in the fixture
 *     zone.
 *
 *  2. DST TRANSITION DAYS IN ISRAEL AND IN THE UNITED STATES. Israel is the
 *     zone the defect was found in and it had no DST coverage at all before this
 *     file: it transitions on DIFFERENT DATES from both the US and the EU
 *     (2026-03-27 and 2026-10-25), so a suite that only knew the US dates would
 *     have shipped an Israeli off-by-one hour without a single red test.
 *
 * TRANSITIONS USED (verified against the tz database, and re-derived below)
 *   Asia/Jerusalem    2026-03-27  02:00 IST  -> 03:00 IDT   (gap:    02:00-02:59)
 *   Asia/Jerusalem    2026-10-25  02:00 IDT  -> 01:00 IST   (repeat: 01:00-01:59)
 *   America/New_York  2026-03-08  02:00 EST  -> 03:00 EDT   (gap:    02:00-02:59)
 *   America/New_York  2026-11-01  02:00 EDT  -> 01:00 EST   (repeat: 01:00-01:59)
 *   Pacific/Auckland  2026-09-27  02:00 NZST -> 03:00 NZDT  (gap:    02:00-02:59)
 *   Pacific/Auckland  2026-04-05  03:00 NZDT -> 02:00 NZST  (repeat: 02:00-02:59)
 *   America/Havana    2026-03-08  00:00 CST  -> 01:00 CDT   (gap:    00:00-00:59)
 *   Pacific/Honolulu  no transitions at all
 *
 * A COVERAGE LIMIT, STATED RATHER THAN WORKED AROUND
 * ---------------------------------------------------------------------------
 * Every ordinary DST transition happens between 01:00 and 03:00 local, and the
 * Hebrew grammar cannot name an hour in that range. Hebrew has no am/pm, so a
 * digit hour of 1..11 is refused unless a declared day part settles it, and no
 * declared day part covers 02:00 (`docs/DECISIONS.md` § 9.9). `מחר ב-2:30`
 * therefore refuses with INVALID_FORMAT long before the DST existence check is
 * reached. That is correct behaviour and it is also a real limit on what this
 * file can drive from Hebrew, so:
 *
 *   - the gap and repeat classes for Israel and the US are driven through the
 *     ISO-local path (which is locale-agnostic) and the English natural-language
 *     path, exactly as `dst.test.ts` does;
 *   - the claim that a HEBREW natural-language phrase reaches the same DST
 *     checks is proved separately, in America/Havana, whose spring-forward
 *     happens at LOCAL MIDNIGHT - the one transition hour Hebrew can name,
 *     because `בחצות` is a declared named time.
 */
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../src/ports/clock.js';
import { DateTimeResolver } from '../../src/scheduling/dateTimeResolver.js';
import { schedulingPolicy } from '../../src/scheduling/policy.js';

const JERUSALEM = 'Asia/Jerusalem';
const NY = 'America/New_York';
const AUCKLAND = 'Pacific/Auckland';
const HONOLULU = 'Pacific/Honolulu';
const HAVANA = 'America/Havana';

function resolveAt(nowUtc: string, raw: string, timezone: string) {
  const resolver = new DateTimeResolver(new FixedClock(nowUtc));
  const policy = schedulingPolicy({ defaultTimezone: timezone, defaultMeetingDurationMinutes: 30 });
  return resolver.resolve({ raw, timezone }, { policy });
}

/** The calendar day an accepted slot falls on, read on the CONTACT'S clock. */
function contactLocalDay(startUtc: string, timezone: string): string {
  return DateTime.fromISO(startUtc, { zone: timezone }).toFormat('yyyy-LL-dd');
}

function mustResolve(nowUtc: string, raw: string, timezone: string) {
  const result = resolveAt(nowUtc, raw, timezone);
  if (!result.ok) {
    throw new Error(`expected "${raw}" (${timezone}, now ${nowUtc}) to resolve, got ${result.code}: ${result.reason}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// 0. The transition table above is re-derived, so a comment cannot become a lie
// ---------------------------------------------------------------------------

/** The instants either side of a wall-clock discontinuity in `zone` in 2026. */
function transitionsIn(zone: string): { before: DateTime; after: DateTime }[] {
  const found: { before: DateTime; after: DateTime }[] = [];
  let previous = DateTime.fromISO('2026-01-01T00:00:00.000Z', { zone });
  for (let hour = 1; hour < 366 * 24; hour += 1) {
    const current = previous.plus({ hours: 1 });
    if (current.offset !== previous.offset) found.push({ before: previous, after: current });
    previous = current;
  }
  return found;
}

describe('the transitions this file claims really are the transitions', () => {
  it('Asia/Jerusalem moves on 2026-03-27 and 2026-10-25, which are neither the US nor the EU dates', () => {
    const moves = transitionsIn(JERUSALEM);
    expect(moves.map((move) => move.after.toFormat('yyyy-LL-dd'))).toEqual(['2026-03-27', '2026-10-25']);
    // Spring forward: 02:00 never happens.
    expect(moves[0]?.before.toFormat('HH:mm')).toBe('01:00');
    expect(moves[0]?.after.toFormat('HH:mm')).toBe('03:00');
    // Autumn: 01:00 happens twice, at two different offsets.
    expect(moves[1]?.before.toFormat('HH:mm')).toBe('01:00');
    expect(moves[1]?.after.toFormat('HH:mm')).toBe('01:00');
    expect(moves[1]?.before.offset).not.toBe(moves[1]?.after.offset);
    // And it is NOT the same date as the US, which is the point of adding it.
    expect(moves.map((move) => move.after.toFormat('yyyy-LL-dd'))).not.toContain('2026-03-08');
  });

  it('America/New_York moves on 2026-03-08 and 2026-11-01, as tests/scheduling/dst.test.ts already says', () => {
    expect(transitionsIn(NY).map((move) => move.after.toFormat('yyyy-LL-dd'))).toEqual(['2026-03-08', '2026-11-01']);
  });

  it('Pacific/Auckland moves the other way round, and Pacific/Honolulu never moves', () => {
    const auckland = transitionsIn(AUCKLAND);
    expect(auckland.map((move) => move.after.toFormat('yyyy-LL-dd'))).toEqual(['2026-04-05', '2026-09-27']);
    // April is the southern FALL BACK and September the southern SPRING FORWARD.
    expect(auckland[0]?.after.offset).toBeLessThan(auckland[0]?.before.offset as number);
    expect(auckland[1]?.after.offset).toBeGreaterThan(auckland[1]?.before.offset as number);

    expect(transitionsIn(HONOLULU)).toEqual([]);
  });

  it("America/Havana springs forward at LOCAL MIDNIGHT, which is why it is here at all", () => {
    const moves = transitionsIn(HAVANA);
    expect(moves[0]?.after.toFormat("yyyy-LL-dd'T'HH:mm")).toBe('2026-03-08T01:00');
    // 00:00 itself does not exist on that date: the clock goes 23:00 -> 01:00.
    expect(DateTime.fromISO('2026-03-08T00:00', { zone: HAVANA }).toFormat('HH:mm')).not.toBe('00:00');
  });
});

// ---------------------------------------------------------------------------
// 1. The contact's calendar day is not the UTC day
// ---------------------------------------------------------------------------

/**
 * Each case pins a `now` at which the contact's local date and the UTC date
 * disagree, and states which local date the contact is actually on.
 *
 * `contactLocalNow` is a pure tzdata fact about (`nowUtc`, `zone`) and is
 * re-derived from Luxon before it is used, so it cannot go stale.
 */
interface MidnightCase {
  readonly key: string;
  readonly zone: string;
  readonly nowUtc: string;
  /** `yyyy-LL-dd HH:mm` the contact's clock reads at `nowUtc`. */
  readonly contactLocalNow: string;
  /** The UTC calendar date at the same instant. */
  readonly utcDate: string;
  /**
   * Whether the two calendars DISAGREE at this instant.
   *
   * `false` for the one control case, which sits thirty minutes on the other
   * side of the boundary. Without it, a failure in the boundary cases could
   * just as easily mean "day words are broken in this zone" as "day words are
   * broken when the two calendars disagree", and those need different fixes.
   */
  readonly calendarsDisagree: boolean;
  readonly rationale: string;
}

const MIDNIGHT_CASES: readonly MidnightCase[] = [
  {
    key: 'm1-jerusalem-just-after-midnight',
    zone: JERUSALEM,
    nowUtc: '2026-03-04T22:30:00.000Z',
    contactLocalNow: '2026-03-05 00:30',
    utcDate: '2026-03-04',
    calendarsDisagree: true,
    rationale:
      'THE CASE THAT MATTERS MOST. The Israeli contact has already turned the page; UTC has not. If ' +
      '`מחר` were computed from the UTC day it would name 2026-03-05, which is the contact\'s TODAY.',
  },
  {
    key: 'm2-jerusalem-just-before-midnight',
    zone: JERUSALEM,
    nowUtc: '2026-03-04T21:30:00.000Z',
    contactLocalNow: '2026-03-04 23:30',
    utcDate: '2026-03-04',
    calendarsDisagree: false,
    rationale: 'The control, thirty minutes earlier: the two dates AGREE, so a failure in m1 is about the boundary.',
  },
  {
    key: 'm3-new-york-just-before-midnight',
    zone: NY,
    nowUtc: '2026-03-05T04:30:00.000Z',
    contactLocalNow: '2026-03-04 23:30',
    utcDate: '2026-03-05',
    calendarsDisagree: true,
    rationale: 'The mirror image, on a negative offset: UTC has rolled over and the contact has not.',
  },
  {
    key: 'm4-auckland-across-the-date-line',
    zone: AUCKLAND,
    nowUtc: '2026-03-04T20:30:00.000Z',
    contactLocalNow: '2026-03-05 09:30',
    utcDate: '2026-03-04',
    calendarsDisagree: true,
    rationale: 'UTC+13: the contact is most of a day ahead, which is the widest positive disagreement in the suite.',
  },
  {
    key: 'm5-honolulu-behind-everything',
    zone: HONOLULU,
    nowUtc: '2026-03-05T05:30:00.000Z',
    contactLocalNow: '2026-03-04 19:30',
    utcDate: '2026-03-05',
    calendarsDisagree: true,
    rationale: 'UTC-10 with no DST: the widest negative disagreement, and a zone that never moves.',
  },
];

/** Day words whose meaning is fixed arithmetic on the contact's own calendar. */
const RELATIVE_DAY_PHRASES: readonly { offsetDays: number; hebrew: string; english: string }[] = [
  { offsetDays: 0, hebrew: 'היום ב-15:00', english: 'today at 15:00' },
  { offsetDays: 1, hebrew: 'מחר ב-15:00', english: 'tomorrow at 15:00' },
  { offsetDays: 2, hebrew: 'מחרתיים ב-15:00', english: 'the day after tomorrow at 15:00' },
];

describe("a day word is counted on the contact's calendar, never on UTC's", () => {
  it.each(MIDNIGHT_CASES)('$key: the two calendars behave as this case claims', (midnight) => {
    const local = DateTime.fromISO(midnight.nowUtc, { zone: 'utc' }).setZone(midnight.zone);
    expect(local.toFormat('yyyy-LL-dd HH:mm')).toBe(midnight.contactLocalNow);
    expect(DateTime.fromISO(midnight.nowUtc, { zone: 'utc' }).toFormat('yyyy-LL-dd')).toBe(midnight.utcDate);
    expect(
      local.toFormat('yyyy-LL-dd') !== midnight.utcDate,
      `${midnight.key} declares calendarsDisagree=${String(midnight.calendarsDisagree)}. ${midnight.rationale}`,
    ).toBe(midnight.calendarsDisagree);
  });

  it('the matrix contains both a disagreeing majority and at least one agreeing control', () => {
    expect(MIDNIGHT_CASES.filter((midnight) => midnight.calendarsDisagree).length).toBeGreaterThanOrEqual(4);
    expect(MIDNIGHT_CASES.filter((midnight) => !midnight.calendarsDisagree).length).toBeGreaterThanOrEqual(1);
  });

  it.each(MIDNIGHT_CASES)('$key: every day word lands on the day the CONTACT named', (midnight) => {
    const contactToday = DateTime.fromISO(midnight.nowUtc, { zone: 'utc' })
      .setZone(midnight.zone)
      .startOf('day');

    for (const phrase of RELATIVE_DAY_PHRASES) {
      const expected = contactToday.plus({ days: phrase.offsetDays }).toFormat('yyyy-LL-dd');
      for (const [language, raw] of [
        ['he', phrase.hebrew],
        ['en', phrase.english],
      ] as const) {
        const slot = mustResolve(midnight.nowUtc, raw, midnight.zone);
        expect(
          contactLocalDay(slot.startUtc, midnight.zone),
          `${midnight.key} (${language}) "${raw}": resolved ${slot.startUtc}, which is ` +
            `${contactLocalDay(slot.startUtc, midnight.zone)} in ${midnight.zone}, but the contact named ${expected}. ` +
            midnight.rationale,
        ).toBe(expected);
        // And the local wall clock is what was asked for, not a shifted one.
        expect(slot.startLocal).toBe(`${expected}T15:00`);
      }
    }
  });

  it.each(MIDNIGHT_CASES)('$key: Hebrew and English name the same instant here too', (midnight) => {
    for (const phrase of RELATIVE_DAY_PHRASES) {
      const hebrew = mustResolve(midnight.nowUtc, phrase.hebrew, midnight.zone);
      const english = mustResolve(midnight.nowUtc, phrase.english, midnight.zone);
      expect(hebrew.startUtc, `${midnight.key}: "${phrase.hebrew}" vs "${phrase.english}"`).toBe(english.startUtc);
    }
  });

  it('the UTC instant really does fall on a different UTC day from the local one, at least somewhere', () => {
    // Otherwise the block above would be asserting a property it never
    // exercised: if every resolved instant happened to share its UTC and local
    // date, a UTC-anchored bug would slip through unseen.
    const divergent = MIDNIGHT_CASES.flatMap((midnight) =>
      RELATIVE_DAY_PHRASES.map((phrase) => {
        const slot = mustResolve(midnight.nowUtc, phrase.hebrew, midnight.zone);
        return {
          key: `${midnight.key}/${phrase.offsetDays}`,
          utcDay: slot.startUtc.slice(0, 10),
          localDay: contactLocalDay(slot.startUtc, midnight.zone),
        };
      }),
    ).filter((row) => row.utcDay !== row.localDay);

    expect(divergent.length, 'no resolved slot straddled midnight, so the property was never tested').toBeGreaterThan(
      0,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. DST transition days - Israel and the United States
// ---------------------------------------------------------------------------

interface DstZoneCase {
  readonly zone: string;
  readonly label: string;
  /** A local wall time inside the spring-forward gap. */
  readonly gapLocal: string;
  /** A local wall time the autumn fall-back makes happen twice. */
  readonly repeatLocal: string;
  /** Local wall times either side of each, which must resolve ordinarily. */
  readonly aroundGap: readonly [string, string];
  readonly aroundRepeat: readonly [string, string];
}

const DST_ZONES: readonly DstZoneCase[] = [
  {
    zone: JERUSALEM,
    label: 'Israel',
    gapLocal: '2026-03-27T02:30',
    repeatLocal: '2026-10-25T01:30',
    aroundGap: ['2026-03-27T01:30', '2026-03-27T03:30'],
    aroundRepeat: ['2026-10-25T00:30', '2026-10-25T03:00'],
  },
  {
    zone: NY,
    label: 'the United States',
    gapLocal: '2026-03-08T02:30',
    repeatLocal: '2026-11-01T01:30',
    aroundGap: ['2026-03-08T01:30', '2026-03-08T03:30'],
    aroundRepeat: ['2026-11-01T00:30', '2026-11-01T03:00'],
  },
];

/** Well before every transition under test, so `in_the_future` never interferes. */
const LONG_BEFORE = '2026-01-05T12:00:00.000Z';

describe.each(DST_ZONES)('$label ($zone): the gap and the repeat', (dstZone) => {
  it('refuses a local time inside the spring-forward gap', () => {
    const result = resolveAt(LONG_BEFORE, dstZone.gapLocal, dstZone.zone);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('NONEXISTENT_LOCAL_TIME');
    expect(result.reason).toMatch(/does not exist/);
    expect(result.provenance.checks.find((check) => check.name === 'local_time_exists')?.passed).toBe(false);
  });

  it('refuses a local time inside the autumn repeat, and reports both candidates', () => {
    const result = resolveAt(LONG_BEFORE, dstZone.repeatLocal, dstZone.zone);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('AMBIGUOUS_LOCAL_TIME');
    expect(result.reason).toMatch(/happens twice/);
    const candidates = result.provenance.notes?.['ambiguousCandidatesUtc'] as string[] | undefined;
    expect(candidates).toHaveLength(2);
    // An hour apart, and both really do read as the requested wall clock.
    const [first, second] = candidates as [string, string];
    expect(DateTime.fromISO(second).diff(DateTime.fromISO(first), 'hours').hours).toBe(1);
    for (const candidate of candidates as string[]) {
      expect(DateTime.fromISO(candidate, { zone: dstZone.zone }).toFormat("yyyy-LL-dd'T'HH:mm")).toBe(
        dstZone.repeatLocal,
      );
    }
  });

  it('accepts the instants either side of each transition', () => {
    for (const local of [...dstZone.aroundGap, ...dstZone.aroundRepeat]) {
      const slot = mustResolve(LONG_BEFORE, local, dstZone.zone);
      expect(slot.startLocal, local).toBe(local);
      expect(contactLocalDay(slot.startUtc, dstZone.zone), local).toBe(local.slice(0, 10));
    }
  });

  it('keeps the WALL-CLOCK meaning of an afternoon across the transition, in BOTH languages', () => {
    // "15:00" has to stay 15:00 on the contact's clock, which means the UTC
    // instant must move by an hour. This is the assertion that would fail if
    // the Hebrew path resolved to an instant and then re-read it in the wrong
    // offset.
    const transitionDay = dstZone.gapLocal.slice(0, 10);
    const dayBefore = DateTime.fromISO(transitionDay).minus({ days: 1 }).toFormat('yyyy-LL-dd');
    // Noon on the day before the transition, in the contact's zone.
    const nowUtc = DateTime.fromISO(`${dayBefore}T12:00`, { zone: dstZone.zone }).toUTC().toISO() as string;

    const hebrew = mustResolve(nowUtc, 'מחר ב-15:00', dstZone.zone);
    const english = mustResolve(nowUtc, 'tomorrow at 15:00', dstZone.zone);

    expect(hebrew.startUtc).toBe(english.startUtc);
    expect(hebrew.startLocal).toBe(`${transitionDay}T15:00`);
    expect(contactLocalDay(hebrew.startUtc, dstZone.zone)).toBe(transitionDay);
    // 15:00 on the spring-forward day is on the SUMMER side of the jump, so the
    // offset differs from the offset `now` itself is at.
    const nowOffset = DateTime.fromISO(nowUtc, { zone: dstZone.zone }).offset;
    expect(DateTime.fromISO(hebrew.startUtc, { zone: dstZone.zone }).offset).not.toBe(nowOffset);
  });

  it('keeps the WALL-CLOCK meaning across the autumn repeat day too, in BOTH languages', () => {
    const transitionDay = dstZone.repeatLocal.slice(0, 10);
    const dayBefore = DateTime.fromISO(transitionDay).minus({ days: 1 }).toFormat('yyyy-LL-dd');
    const nowUtc = DateTime.fromISO(`${dayBefore}T12:00`, { zone: dstZone.zone }).toUTC().toISO() as string;

    for (const [hebrew, english, expectedLocal] of [
      ['מחר ב-15:00', 'tomorrow at 15:00', `${transitionDay}T15:00`],
      // Midnight on the repeat morning is BEFORE the clocks go back, so it is
      // unambiguous - the repeated hour is 01:00, not 00:00.
      ['מחר בחצות', 'tomorrow at midnight', `${transitionDay}T00:00`],
    ] as const) {
      const he = mustResolve(nowUtc, hebrew, dstZone.zone);
      const en = mustResolve(nowUtc, english, dstZone.zone);
      expect(he.startUtc, `${hebrew} vs ${english}`).toBe(en.startUtc);
      expect(he.startLocal).toBe(expectedLocal);
      expect(contactLocalDay(he.startUtc, dstZone.zone)).toBe(transitionDay);
    }
  });

  it('applies the same checks to an ENGLISH natural-language proposal that lands in the gap', () => {
    const transitionDay = dstZone.gapLocal.slice(0, 10);
    const dayBefore = DateTime.fromISO(transitionDay).minus({ days: 1 }).toFormat('yyyy-LL-dd');
    const nowUtc = DateTime.fromISO(`${dayBefore}T12:00`, { zone: dstZone.zone }).toUTC().toISO() as string;

    const result = resolveAt(nowUtc, 'tomorrow at 2:30am', dstZone.zone);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('NONEXISTENT_LOCAL_TIME');
  });

  it('the Hebrew counterpart of that phrase refuses EARLIER, and the limit is stated not hidden', () => {
    // `מחר ב-2:30` never reaches the DST check: Hebrew has no am/pm and no
    // declared day part covers 02:00, so a 1..11 hour is refused first. This
    // is the pre-existing English rule applying unchanged (docs/DECISIONS.md
    // § 9.9), and it means no Hebrew DIGIT phrase can name a 01:00-03:00 local
    // time - which is where every ordinary DST transition sits. The Hebrew
    // natural-language path into the DST checks is proved below, in a zone
    // whose transition is at midnight.
    const transitionDay = dstZone.gapLocal.slice(0, 10);
    const dayBefore = DateTime.fromISO(transitionDay).minus({ days: 1 }).toFormat('yyyy-LL-dd');
    const nowUtc = DateTime.fromISO(`${dayBefore}T12:00`, { zone: dstZone.zone }).toUTC().toISO() as string;

    const result = resolveAt(nowUtc, 'מחר ב-2:30', dstZone.zone);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('INVALID_FORMAT');
    expect(result.reason).toContain('02:00 or 14:00');
  });
});

describe('a HEBREW natural-language phrase reaches the DST checks by the same route', () => {
  /**
   * America/Havana springs forward at LOCAL MIDNIGHT on 2026-03-08: 23:00 CST
   * is followed by 01:00 CDT, so 00:00-00:59 does not exist that day. Midnight
   * is the one transition hour Hebrew can name, because `בחצות` is a declared
   * named time rather than a digit hour needing a meridiem.
   *
   * This is not a claim about Cuba. It is the only way available to prove, with
   * a real zone and real tzdata, that a phrase understood through the Hebrew
   * lexicon goes through the identical `local_time_exists` check as an English
   * one - which the four Israel/US cases above cannot show for the reason given
   * there.
   */
  const NOW_BEFORE_HAVANA_TRANSITION = '2026-03-07T17:00:00.000Z'; // 12:00 CST, Saturday

  it('refuses the Hebrew named midnight that falls inside the Havana gap', () => {
    const result = resolveAt(NOW_BEFORE_HAVANA_TRANSITION, 'מחר בחצות', HAVANA);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('NONEXISTENT_LOCAL_TIME');
    expect(result.provenance.checks.find((check) => check.name === 'local_time_exists')?.passed).toBe(false);
    // It got there by understanding the Hebrew, not by failing to.
    const interpretation = result.provenance.notes?.['interpretation'] as
      | { dayAnchor?: string; locales?: string[]; leftover?: string[] }
      | undefined;
    expect(interpretation?.dayAnchor).toBe('tomorrow');
    expect(interpretation?.locales).toEqual(['he']);
    expect(interpretation?.leftover).toEqual([]);
  });

  it('refuses the ENGLISH counterpart in exactly the same way - parity holds on the refusal', () => {
    const hebrew = resolveAt(NOW_BEFORE_HAVANA_TRANSITION, 'מחר בחצות', HAVANA);
    const english = resolveAt(NOW_BEFORE_HAVANA_TRANSITION, 'tomorrow at midnight', HAVANA);
    expect(hebrew.ok).toBe(false);
    expect(english.ok).toBe(false);
    if (hebrew.ok || english.ok) throw new Error('unreachable');
    expect(hebrew.code).toBe(english.code);
  });

  it('CONTROL: the same Hebrew phrase resolves perfectly ordinarily a week later', () => {
    // Otherwise the refusal above could be Hebrew failing for some unrelated
    // reason that happens to look like a DST refusal.
    const slot = mustResolve('2026-03-14T16:00:00.000Z', 'מחר בחצות', HAVANA);
    expect(slot.startLocal).toBe('2026-03-15T00:00');
    expect(contactLocalDay(slot.startUtc, HAVANA)).toBe('2026-03-15');
  });
});

describe('a zone with no DST never produces a DST code, in either language', () => {
  it('Pacific/Honolulu resolves the northern and southern transition local times ordinarily', () => {
    for (const local of ['2026-03-08T02:30', '2026-03-27T02:30', '2026-10-25T01:30', '2026-11-01T01:30']) {
      const slot = mustResolve(LONG_BEFORE, local, HONOLULU);
      expect(slot.startLocal, local).toBe(local);
    }
  });

  it('and the Hebrew and English day words agree there too, all year', () => {
    for (const nowUtc of [
      '2026-03-05T05:30:00.000Z',
      '2026-03-28T05:30:00.000Z',
      '2026-10-26T05:30:00.000Z',
      '2026-11-02T05:30:00.000Z',
    ]) {
      const hebrew = mustResolve(nowUtc, 'מחר ב-15:00', HONOLULU);
      const english = mustResolve(nowUtc, 'tomorrow at 15:00', HONOLULU);
      expect(hebrew.startUtc, nowUtc).toBe(english.startUtc);
      expect(hebrew.interpretation.utcOffset).toBe('-10:00');
    }
  });
});

describe('the southern hemisphere moves the other way, and Hebrew follows it', () => {
  it('Pacific/Auckland: the offset falls in April and rises in September', () => {
    const april = mustResolve(LONG_BEFORE, '2026-04-10T14:00', AUCKLAND);
    const october = mustResolve(LONG_BEFORE, '2026-10-10T14:00', AUCKLAND);
    expect(april.interpretation.utcOffset).toBe('+12:00');
    expect(october.interpretation.utcOffset).toBe('+13:00');
  });

  it('Pacific/Auckland: gap and repeat are refused, and Hebrew 15:00 still lands on the named day', () => {
    expect(resolveAt(LONG_BEFORE, '2026-09-27T02:30', AUCKLAND)).toMatchObject({
      ok: false,
      code: 'NONEXISTENT_LOCAL_TIME',
    });
    expect(resolveAt(LONG_BEFORE, '2026-04-05T02:30', AUCKLAND)).toMatchObject({
      ok: false,
      code: 'AMBIGUOUS_LOCAL_TIME',
    });

    for (const namedDay of ['2026-09-27', '2026-04-05'] as const) {
      // Two days before the transition, 12:00 local - derived rather than
      // written out, because "two days before" across a date line is exactly
      // the arithmetic a hand-written instant gets wrong.
      const nowUtc = DateTime.fromISO(`${namedDay}T12:00`, { zone: AUCKLAND })
        .minus({ days: 2 })
        .toUTC()
        .toISO() as string;

      const hebrew = mustResolve(nowUtc, 'מחרתיים ב-15:00', AUCKLAND);
      const english = mustResolve(nowUtc, 'the day after tomorrow at 15:00', AUCKLAND);
      expect(hebrew.startUtc, nowUtc).toBe(english.startUtc);
      expect(contactLocalDay(hebrew.startUtc, AUCKLAND), nowUtc).toBe(namedDay);
      expect(hebrew.startLocal).toBe(`${namedDay}T15:00`);
    }
  });
});
