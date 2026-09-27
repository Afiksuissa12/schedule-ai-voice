/**
 * HEBREW-VERSUS-ENGLISH PARITY: the same request, said twice, must name the
 * same instant.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `hebrewGrammar.test.ts`
 * ---------------------------------------------------------------------------
 * `tests/scheduling/hebrewGrammar.test.ts` proves that each Hebrew form
 * resolves to the instant a human worked out by hand, at ONE pinned `now` in
 * ONE zone. That is the right shape for a grammar test and it is not enough for
 * a regression net, because the defect being guarded against
 * (`FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 8.3) was not "Hebrew resolves to
 * a slightly wrong hour". It was "Hebrew and English, meaning the same thing,
 * resolved to DIFFERENT DAYS, and only the English one was ever checked".
 *
 * So this file asserts a RELATION rather than a value: for a translated pair,
 *
 *     resolve(hebrew, now, zone)  ===  resolve(english, now, zone)
 *
 * on the resolved UTC instant AND on the local calendar day in the contact's
 * zone, across a matrix of `now` instants and contact time zones. A relation is
 * what survives a tzdata update, a DST rule change or a new `now`: nobody has
 * to re-compute 350 expected wall-clock strings by hand, and no expectation in
 * here can quietly become a lie the way a hard-coded instant can.
 *
 * The English half is the control. English is the language that already worked,
 * `tests/scheduling/naturalLanguage.test.ts` pins its behaviour independently,
 * and so a divergence found here is a statement about the Hebrew half — or
 * about a change that broke both, which the English suite would then also
 * report.
 *
 * WHERE THE HEBREW COMES FROM
 * ---------------------------------------------------------------------------
 * Every Hebrew string below is taken from this repository:
 * `src/scheduling/lexicon/he.ts` (the declared forms), `hebrewGrammar.test.ts`,
 * `src/eval/corpus/scenarios.he.ts` and the Founder Review's § 8.3 table. None
 * of it was retyped from a brief.
 *
 * WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT
 * ---------------------------------------------------------------------------
 * Asserted: `ok`, the resolved UTC instant, the local calendar day in the
 * contact's zone, and — when both sides refuse — the same `ValidationErrorCode`.
 *
 * NOT asserted: `startLocal` formatting, `interpretation.matched`,
 * `timeAnchor`, the refusal wording. Those are incidental, they legitimately
 * differ between the two languages (the recorded `timeAnchor` for `מחר ב-15:00`
 * is `ב-15:00` and for `tomorrow at 15:00` is `at 15:00`), and pinning them
 * would make the file fail for improvements rather than for regressions.
 *
 * PAIRS THAT ARE NOT EXPECTED TO MATCH ARE STILL HERE
 * ---------------------------------------------------------------------------
 * Three of them, in `DIVERGENT_PAIRS`, each with the reason written down and
 * each asserted in its divergent shape. Omitting them would have been the
 * easier choice and the dishonest one: a reader would have no way to tell a
 * deliberate asymmetry from an untested one.
 *
 * This test uses `DateTimeResolver` directly rather than the validator, so no
 * business-hours, lead-time or horizon policy can turn a parity question into a
 * policy question. Those are the sweep's job (`tests/invariants/`).
 */
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../src/ports/clock.js';
import { DateTimeResolver } from '../../src/scheduling/dateTimeResolver.js';
import { schedulingPolicy } from '../../src/scheduling/policy.js';

// ---------------------------------------------------------------------------
// The matrix axes
// ---------------------------------------------------------------------------

interface NowCase {
  readonly key: string;
  readonly nowUtc: string;
  readonly rationale: string;
}

/**
 * The `now` instants the pairs are crossed with.
 *
 * Every claim in `rationale` is re-derived from Luxon in the first `describe`
 * below, so a comment here can never quietly stop being true.
 */
const NOWS: readonly NowCase[] = [
  {
    key: 'n1-hebrew-corpus-now',
    nowUtc: '2026-03-04T08:00:00.000Z',
    rationale:
      'Wednesday 10:00 Asia/Jerusalem - the exact instant § 8.3 reproduced the wrong-day booking at, ' +
      'and the pinned `now` of the Hebrew corpus.',
  },
  {
    key: 'n2-repo-baseline',
    nowUtc: '2026-03-04T15:00:00.000Z',
    rationale: 'The baseline the rest of the repository uses: Wednesday 10:00 America/New_York.',
  },
  {
    key: 'n3-contact-past-midnight',
    nowUtc: '2026-03-04T22:30:00.000Z',
    rationale:
      'The contact is already on the NEXT calendar day in Asia/Jerusalem (00:30 Thursday) while UTC is ' +
      'still on Wednesday. A grammar anchored on the UTC day rather than the contact clock gets every ' +
      'day word one day wrong here.',
  },
  {
    key: 'n4-contact-before-midnight',
    nowUtc: '2026-03-05T04:30:00.000Z',
    rationale:
      'The mirror image: 23:30 Wednesday in America/New_York while UTC has already rolled to Thursday.',
  },
  {
    key: 'n5-saturday',
    nowUtc: '2026-03-07T17:00:00.000Z',
    rationale: 'A SATURDAY, so "tomorrow" is a Sunday and the weekday arithmetic wraps the week.',
  },
  {
    key: 'n6-month-end',
    nowUtc: '2026-06-30T14:00:00.000Z',
    rationale: 'Tuesday 30 June: "tomorrow" rolls the month over, and Auckland is already on 1 July.',
  },
];

interface ZoneCase {
  readonly zone: string;
  readonly rationale: string;
}

/**
 * The contact zones.
 *
 * Chosen so that the offset sign, the DST hemisphere and the whole-hour
 * assumption are all varied, and so that at least one zone's local calendar day
 * differs from the UTC day at several of the instants above.
 */
const ZONES: readonly ZoneCase[] = [
  { zone: 'Asia/Jerusalem', rationale: 'The zone the defect was found in. Absent from the invariant sweep.' },
  { zone: 'America/New_York', rationale: 'The fixture zone, and a negative UTC offset.' },
  { zone: 'Pacific/Auckland', rationale: 'UTC+12/+13, southern hemisphere: the far side of the date line.' },
  { zone: 'Pacific/Honolulu', rationale: 'UTC-10 with no DST at all - the widest negative offset in the suite.' },
  { zone: 'Asia/Kolkata', rationale: 'UTC+05:30 - a HALF-HOUR offset, which breaks whole-hour arithmetic.' },
  { zone: 'UTC', rationale: 'The degenerate case. It must go through the same code, not a shortcut.' },
];

interface ParityPair {
  readonly key: string;
  /** What an Israeli contact says. */
  readonly hebrew: string;
  /** The same instruction in English. */
  readonly english: string;
  /** Which required coverage class this pair discharges. */
  readonly covers: string;
}

/**
 * The translated pairs. Each one must resolve to the SAME instant.
 *
 * `covers` names the class from the mission brief that the pair discharges, so
 * a reviewer can check the list is complete without reading the strings.
 */
const PARITY_PAIRS: readonly ParityPair[] = [
  // --- the tomorrow forms, in every written spelling of the preposition -----
  { key: 'p01-tomorrow-hyphen', hebrew: 'מחר ב-15:00', english: 'tomorrow at 15:00', covers: 'tomorrow + digit clock time, ASCII hyphen' },
  { key: 'p02-tomorrow-maqaf', hebrew: 'מחר ב־15:00', english: 'tomorrow at 15:00', covers: 'tomorrow + digit clock time, U+05BE MAQAF' },
  { key: 'p03-tomorrow-nosep', hebrew: 'מחר ב15:00', english: 'tomorrow at 15:00', covers: 'tomorrow + digit clock time, NO separator' },
  { key: 'p04-tomorrow-space', hebrew: 'מחר ב 15:00', english: 'tomorrow at 15:00', covers: 'tomorrow + digit clock time, separated by a space' },
  { key: 'p05-tomorrow-beshaa', hebrew: 'מחר בשעה 15:00', english: 'tomorrow at 15:00', covers: 'tomorrow + the "at the hour" word' },
  { key: 'p06-tomorrow-lamed', hebrew: 'מחר ל-15:00', english: 'tomorrow at 15:00', covers: 'tomorrow + the ל- preposition' },
  { key: 'p07-tomorrow-niqqud', hebrew: 'מָחָר ב-15:00', english: 'tomorrow at 15:00', covers: 'tomorrow written WITH niqqud' },
  { key: 'p08-today', hebrew: 'היום ב-15:00', english: 'today at 15:00', covers: 'today' },
  { key: 'p09-day-after-tomorrow', hebrew: 'מחרתיים ב-15:00', english: 'the day after tomorrow at 15:00', covers: 'day after tomorrow' },

  // --- weekday forms, bare / with preposition / with the modifier ----------
  { key: 'p10-weekday-bare', hebrew: 'יום חמישי ב-15:00', english: 'thursday at 15:00', covers: 'weekday, bare frame' },
  { key: 'p11-weekday-preposition', hebrew: 'ביום חמישי ב-15:00', english: 'on thursday at 15:00', covers: 'weekday WITH the preposition' },
  { key: 'p12-weekday-ordinal', hebrew: 'חמישי ב-15:00', english: 'thursday at 15:00', covers: 'weekday, bare ordinal' },
  { key: 'p13-weekday-next', hebrew: 'יום חמישי הבא ב-15:00', english: 'next thursday at 15:00', covers: 'weekday + NEXT modifier (after in he, before in en)' },
  { key: 'p14-weekday-sunday', hebrew: 'יום ראשון ב-15:00', english: 'sunday at 15:00', covers: 'weekday at the Hebrew week start, which is ISO 7' },
  { key: 'p15-end-of-week', hebrew: 'סוף השבוע ב-15:00', english: 'end of the week at 15:00', covers: 'end of week' },

  // --- day parts -----------------------------------------------------------
  { key: 'p16-morning', hebrew: 'מחר בבוקר', english: 'tomorrow morning', covers: 'day part: morning, preferred hour' },
  { key: 'p17-afternoon', hebrew: 'מחר אחרי הצהריים', english: 'tomorrow afternoon', covers: 'day part: afternoon, two Hebrew tokens' },
  { key: 'p18-evening', hebrew: 'מחר בערב', english: 'tomorrow evening', covers: 'day part: evening' },
  { key: 'p19-tonight', hebrew: 'הערב', english: 'tonight', covers: 'day part that IMPLIES today' },
  { key: 'p20-daypart-settles-hour', hebrew: 'מחר ב-9:00 בבוקר', english: 'tomorrow at 9am', covers: 'day part disambiguating a 1..11 hour' },

  // --- named times ---------------------------------------------------------
  { key: 'p21-noon', hebrew: 'מחר בצהריים', english: 'tomorrow at noon', covers: 'named time: noon' },
  { key: 'p22-midnight', hebrew: 'מחר בחצות', english: 'tomorrow at midnight', covers: 'named time: midnight' },

  // --- relative offsets, including the dual and half-hour forms ------------
  { key: 'p23-offset-minutes', hebrew: 'בעוד 30 דקות', english: 'in 30 minutes', covers: 'offset in minutes' },
  { key: 'p24-offset-hours', hebrew: 'בעוד 3 שעות', english: 'in 3 hours', covers: 'offset in hours' },
  { key: 'p25-offset-words', hebrew: 'בעוד שלוש שעות', english: 'in three hours', covers: 'offset with the quantity spelled out' },
  { key: 'p26-dual-hours', hebrew: 'בעוד שעתיים', english: 'in two hours', covers: 'the DUAL: two hours as one word' },
  { key: 'p27-dual-days', hebrew: 'בעוד יומיים', english: 'in two days', covers: 'the DUAL: two days as one word' },
  { key: 'p28-dual-weeks', hebrew: 'בעוד שבועיים', english: 'in two weeks', covers: 'the DUAL: two weeks as one word' },
  { key: 'p29-half-hour', hebrew: 'חצי שעה', english: 'half an hour', covers: 'the half-hour form, which needs no introducing word' },
  { key: 'p30-offset-lead-short', hebrew: 'בעוד 5 דקות', english: 'in 5 minutes', covers: 'a short offset, under every configured minimum lead time' },

  // --- date-only and date-plus-time ---------------------------------------
  { key: 'p31-date-plus-time', hebrew: '2026-04-17 ב-14:00', english: '2026-04-17 at 14:00', covers: 'explicit ISO date PLUS a time' },
  { key: 'p32-date-only-word', hebrew: 'מחר', english: 'tomorrow', covers: 'DATE-ONLY: a named day with no time, which is not a slot' },
  { key: 'p33-date-only-weekday', hebrew: 'יום חמישי', english: 'thursday', covers: 'DATE-ONLY: a weekday with no time' },
  { key: 'p34-date-only-end-of-week', hebrew: 'סוף השבוע', english: 'end of the week', covers: 'DATE-ONLY: end of week with no time' },

  // --- code-switched, the way an Israeli business call actually sounds ----
  { key: 'p35-mixed-callback', hebrew: 'call me back מחר ב-16:00', english: 'call me back tomorrow at 16:00', covers: 'mixed: English carriers, Hebrew day word and time' },
  { key: 'p36-mixed-english-time', hebrew: 'מחר at 3pm', english: 'tomorrow at 3pm', covers: 'mixed: Hebrew day word, English time' },
  { key: 'p37-mixed-hebrew-carriers', hebrew: 'תתקשר אליי מחר ב-15:00', english: 'call me tomorrow at 15:00', covers: 'mixed: Hebrew carriers on both sides' },
];

interface DivergentPair {
  readonly key: string;
  readonly hebrew: string;
  readonly english: string;
  /** Why these two are NOT the same, stated as a product decision. */
  readonly why: string;
  /** What the Hebrew side must do instead. */
  readonly hebrewMustRefuseNaming: string;
  /**
   * The refusal codes the ENGLISH side is allowed to produce anywhere in the
   * matrix. Empty means it must resolve everywhere.
   *
   * Expressed as an allowlist rather than as "it resolves", because the matrix
   * deliberately contains a `now` whose tomorrow is a spring-forward day: at
   * `n5-saturday` in America/New_York, `tomorrow at 2:30am` is 02:30 on
   * 2026-03-08, which does not exist. That is the English side reaching the DST
   * check, which is the whole point of the divergence - not a second exception.
   */
  readonly englishMayRefuseWith: readonly string[];
}

/**
 * Pairs that are translations of one another and are NOT expected to resolve
 * identically, each with the reason.
 *
 * They are asserted, not omitted. An untested asymmetry and a documented one
 * look exactly the same in a test file that simply leaves the case out, and the
 * whole point of this exercise is that the difference has to be visible.
 */
const DIVERGENT_PAIRS: readonly DivergentPair[] = [
  {
    key: 'd1-bare-hour-has-no-hebrew-meridiem',
    hebrew: 'מחר ב-9:00',
    english: 'tomorrow at 9am',
    why:
      'Hebrew has no am/pm. `9:00` with nothing to settle it could be 09:00 or 21:00, and the resolver ' +
      'refuses a 1..11 hour nothing settles - in EVERY language, by the same code. English carries `am`, ' +
      'so it resolves. This is the pre-existing English rule applying unchanged, not a Hebrew gap: ' +
      '`p20-daypart-settles-hour` is the same hour with a day part attached, and it IS a parity pair. ' +
      'docs/DECISIONS.md § 9.9.',
    hebrewMustRefuseNaming: '09:00 or 21:00',
    englishMayRefuseWith: [],
  },
  {
    key: 'd2-hour-spelled-out-in-hebrew-words',
    hebrew: 'מחר אחרי הצהריים, בשתיים',
    english: 'tomorrow afternoon at 2pm',
    why:
      'An hour spelled out in Hebrew WORDS is deliberately out of the lexicon. `מחר` and ' +
      '`אחרי הצהריים` are both understood; `בשתיים` is not, and guessing that it means 14:00 rather ' +
      'than 02:00 is exactly the guess the fail-closed rule exists to refuse. The refusal names the ' +
      'word. docs/DECISIONS.md § 9.9.',
    hebrewMustRefuseNaming: 'בשתיים',
    englishMayRefuseWith: [],
  },
  {
    key: 'd3-early-morning-hour-is-unreachable-in-hebrew',
    hebrew: 'מחר ב-2:30',
    english: 'tomorrow at 2:30am',
    why:
      'The consequence of d1 at the hour that matters most for DST: 02:30 is inside every northern and ' +
      'southern spring-forward gap, and Hebrew cannot name it at all - no declared day part covers ' +
      '02:00 and there is no am/pm to settle 2 against 14. English carries `am`, so it resolves ' +
      'ordinarily and, on a transition day, reaches the DST existence check and refuses with ' +
      'NONEXISTENT_LOCAL_TIME instead. THE COVERAGE LIMIT THIS EXPOSES, STATED RATHER THAN HIDDEN: ' +
      'the Hebrew natural-language path cannot reach a 01:00-03:00 local time, which is where every ' +
      'northern and southern DST transition sits, so the gap and repeat classes cannot be driven from ' +
      'Hebrew digits. `tests/scheduling/localeTimezoneBoundaries.test.ts` states that limit and proves ' +
      'the Hebrew grammar reaches the same DST check by a route that IS expressible - a named midnight ' +
      'in a zone whose transition happens at midnight.',
    hebrewMustRefuseNaming: '02:00 or 14:00',
    englishMayRefuseWith: ['NONEXISTENT_LOCAL_TIME', 'AMBIGUOUS_LOCAL_TIME'],
  },
];

// ---------------------------------------------------------------------------

const POLICY_FOR = (zone: string) =>
  schedulingPolicy({ defaultTimezone: zone, defaultMeetingDurationMinutes: 30 });

function resolve(nowUtc: string, zone: string, raw: string) {
  return new DateTimeResolver(new FixedClock(nowUtc)).resolve({ raw, timezone: zone }, { policy: POLICY_FOR(zone) });
}

/** The two things the mission asks to be compared, and nothing incidental. */
interface Reading {
  readonly ok: boolean;
  /** `ValidationErrorCode` when refused, else null. */
  readonly code: string | null;
  /** The resolved instant, or null. */
  readonly startUtc: string | null;
  /** The calendar day that instant falls on IN THE CONTACT'S ZONE. */
  readonly localDay: string | null;
}

function read(nowUtc: string, zone: string, raw: string): Reading {
  const result = resolve(nowUtc, zone, raw);
  if (!result.ok) return { ok: false, code: result.code, startUtc: null, localDay: null };
  return {
    ok: true,
    code: null,
    startUtc: result.value.startUtc,
    localDay: DateTime.fromISO(result.value.startUtc, { zone }).toFormat('yyyy-LL-dd'),
  };
}

// ---------------------------------------------------------------------------

describe('the parity matrix describes itself truthfully', () => {
  it('has a unique key for every pair, and enough of them to be a matrix', () => {
    const keys = [...PARITY_PAIRS, ...DIVERGENT_PAIRS].map((pair) => pair.key);
    expect(new Set(keys).size, 'pair keys must be unique - they are quoted in every failure').toBe(keys.length);
    expect(PARITY_PAIRS.length * NOWS.length * ZONES.length).toBeGreaterThan(1000);
  });

  it('covers every class the regression brief names', () => {
    const covered = PARITY_PAIRS.map((pair) => pair.covers).join(' | ');
    for (const required of [
      'tomorrow',
      'weekday',
      'preposition',
      'day part',
      'named time',
      'offset',
      'DUAL',
      'half-hour',
      'DATE-ONLY',
      'ISO date PLUS a time',
      'mixed',
      'MAQAF',
      'NO separator',
    ]) {
      expect(covered, `no parity pair covers "${required}"`).toContain(required);
    }
  });

  it('re-derives every factual claim the `now` instants make', () => {
    const at = (nowUtc: string, zone: string) => DateTime.fromISO(nowUtc, { zone: 'utc' }).setZone(zone);

    // n1 really is Wednesday 10:00 in Jerusalem.
    expect(at('2026-03-04T08:00:00.000Z', 'Asia/Jerusalem').toFormat("EEEE HH:mm")).toBe('Wednesday 10:00');
    // n2 really is Wednesday 10:00 in New York.
    expect(at('2026-03-04T15:00:00.000Z', 'America/New_York').toFormat("EEEE HH:mm")).toBe('Wednesday 10:00');
    // n3: Jerusalem has already turned the page; UTC has not.
    expect(at('2026-03-04T22:30:00.000Z', 'Asia/Jerusalem').toFormat('yyyy-LL-dd')).toBe('2026-03-05');
    expect(at('2026-03-04T22:30:00.000Z', 'UTC').toFormat('yyyy-LL-dd')).toBe('2026-03-04');
    // n4: the mirror - New York is a day behind UTC.
    expect(at('2026-03-05T04:30:00.000Z', 'America/New_York').toFormat('yyyy-LL-dd')).toBe('2026-03-04');
    expect(at('2026-03-05T04:30:00.000Z', 'UTC').toFormat('yyyy-LL-dd')).toBe('2026-03-05');
    // n5 really is a Saturday everywhere in the matrix except across the line.
    expect(at('2026-03-07T17:00:00.000Z', 'America/New_York').weekdayLong).toBe('Saturday');
    // n6: Auckland is already on 1 July while UTC is on 30 June.
    expect(at('2026-06-30T14:00:00.000Z', 'Pacific/Auckland').toFormat('yyyy-LL-dd')).toBe('2026-07-01');
    expect(at('2026-06-30T14:00:00.000Z', 'UTC').toFormat('yyyy-LL-dd')).toBe('2026-06-30');
  });

  it('crosses a half-hour offset, both hemispheres and a zone with no DST', () => {
    expect(DateTime.fromISO('2026-03-04T15:00:00.000Z', { zone: 'Asia/Kolkata' }).offset % 60).not.toBe(0);
    // Auckland is on summer time in March and standard time in July: southern.
    expect(DateTime.fromISO('2026-03-04T15:00:00.000Z', { zone: 'Pacific/Auckland' }).offset).toBe(13 * 60);
    expect(DateTime.fromISO('2026-07-04T15:00:00.000Z', { zone: 'Pacific/Auckland' }).offset).toBe(12 * 60);
    // Honolulu never moves.
    expect(DateTime.fromISO('2026-01-04T15:00:00.000Z', { zone: 'Pacific/Honolulu' }).offset).toBe(
      DateTime.fromISO('2026-07-04T15:00:00.000Z', { zone: 'Pacific/Honolulu' }).offset,
    );
  });
});

// ---------------------------------------------------------------------------

describe('Hebrew and English translations resolve to the SAME instant', () => {
  for (const now of NOWS) {
    for (const zone of ZONES) {
      it(`${now.key} / ${zone.zone}: every translated pair agrees`, () => {
        const divergences: string[] = [];

        for (const pair of PARITY_PAIRS) {
          const he = read(now.nowUtc, zone.zone, pair.hebrew);
          const en = read(now.nowUtc, zone.zone, pair.english);

          if (he.ok !== en.ok || he.startUtc !== en.startUtc || he.localDay !== en.localDay || he.code !== en.code) {
            divergences.push(
              `  [${pair.key}] ${pair.covers}\n` +
                `      he "${pair.hebrew}" -> ${describeReading(he)}\n` +
                `      en "${pair.english}" -> ${describeReading(en)}`,
            );
          }
        }

        expect(
          divergences,
          divergences.length === 0
            ? ''
            : `\n${divergences.length} translated pair(s) did NOT resolve identically at ` +
              `now=${now.nowUtc} in ${zone.zone}:\n${divergences.join('\n')}\n` +
              'This is the § 8.3 defect class. Do NOT relax the assertion - report it against the resolver.\n',
        ).toEqual([]);
      });
    }
  }

  it('the matrix is not vacuously green: most pairs actually resolve somewhere', () => {
    // A parity assertion over two phrases that both refuse everywhere is
    // satisfied and proves nothing. This is the guard against that.
    let resolved = 0;
    let total = 0;
    for (const now of NOWS) {
      for (const zone of ZONES) {
        for (const pair of PARITY_PAIRS) {
          total += 1;
          if (read(now.nowUtc, zone.zone, pair.hebrew).ok) resolved += 1;
        }
      }
    }
    expect(total).toBe(NOWS.length * ZONES.length * PARITY_PAIRS.length);
    // The four DATE-ONLY pairs must refuse by design, so the ceiling is 33/37.
    expect(resolved / total, 'too many pairs refuse for the parity claim to mean anything').toBeGreaterThan(0.85);
  });
});

function describeReading(reading: Reading): string {
  return reading.ok ? `${reading.startUtc} (local day ${reading.localDay})` : `REFUSED ${reading.code}`;
}

// ---------------------------------------------------------------------------

describe('the day a translated pair names is the same day in the contact zone', () => {
  // The parity block above compares the two readings with each other. This one
  // compares BOTH of them against the contact's own calendar, which is the
  // thing a customer experiences: a booking is wrong when it lands on a day
  // they did not name, not when two internal values disagree.
  const RELATIVE_DAY_PAIRS: readonly { pair: ParityPair; offsetDays: number }[] = [
    { pair: PARITY_PAIRS.find((p) => p.key === 'p08-today') as ParityPair, offsetDays: 0 },
    { pair: PARITY_PAIRS.find((p) => p.key === 'p01-tomorrow-hyphen') as ParityPair, offsetDays: 1 },
    { pair: PARITY_PAIRS.find((p) => p.key === 'p09-day-after-tomorrow') as ParityPair, offsetDays: 2 },
  ];

  for (const now of NOWS) {
    for (const zone of ZONES) {
      it(`${now.key} / ${zone.zone}: today / tomorrow / the day after land on the contact's own dates`, () => {
        const contactToday = DateTime.fromISO(now.nowUtc, { zone: 'utc' }).setZone(zone.zone).startOf('day');

        for (const { pair, offsetDays } of RELATIVE_DAY_PAIRS) {
          const expected = contactToday.plus({ days: offsetDays }).toFormat('yyyy-LL-dd');
          for (const [language, raw] of [
            ['he', pair.hebrew],
            ['en', pair.english],
          ] as const) {
            const reading = read(now.nowUtc, zone.zone, raw);
            expect(reading.ok, `${pair.key} (${language}) "${raw}" should resolve`).toBe(true);
            expect(
              reading.localDay,
              `${pair.key} (${language}) "${raw}" landed on ${reading.localDay} but the contact named ` +
                `${expected} in ${zone.zone}`,
            ).toBe(expected);
          }
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------

describe('pairs that are deliberately NOT identical', () => {
  for (const divergent of DIVERGENT_PAIRS) {
    it(`${divergent.key}: the Hebrew side refuses, and here is why`, () => {
      for (const now of NOWS) {
        for (const zone of ZONES) {
          const result = resolve(now.nowUtc, zone.zone, divergent.hebrew);
          expect(result.ok, `"${divergent.hebrew}" must refuse. ${divergent.why}`).toBe(false);
          if (result.ok) throw new Error('unreachable');
          expect(result.code).toBe('INVALID_FORMAT');
          expect(
            result.reason,
            `the refusal must name what it could not settle. ${divergent.why}`,
          ).toContain(divergent.hebrewMustRefuseNaming);
        }
      }
    });

    it(`${divergent.key}: the English side behaves as documented, and differs`, () => {
      // Pinned so that a future change which "fixes" parity by breaking the
      // English half cannot pass this file, and so that the divergence is
      // asserted to EXIST rather than merely tolerated.
      for (const now of NOWS) {
        for (const zone of ZONES) {
          const english = resolve(now.nowUtc, zone.zone, divergent.english);
          const where = `"${divergent.english}" at ${now.key}/${zone.zone}. ${divergent.why}`;

          if (!english.ok) {
            expect(divergent.englishMayRefuseWith, where).toContain(english.code);
            // Whatever it refuses for, it is never the Hebrew side's reason.
            expect(english.code, where).not.toBe('INVALID_FORMAT');
          }

          const hebrew = resolve(now.nowUtc, zone.zone, divergent.hebrew);
          expect(hebrew.ok, where).toBe(false);
          if (hebrew.ok) throw new Error('unreachable');
          expect(
            english.ok || english.code !== hebrew.code,
            `${divergent.key} is declared DIVERGENT, but both sides behaved identically at ` +
              `${now.key}/${zone.zone}. If the divergence has been closed, MOVE THE PAIR into ` +
              'PARITY_PAIRS rather than leaving a stale exception here.',
          ).toBe(true);
        }
      }
    });
  }

  it('d1 has a parity-holding counterpart, so the asymmetry is about am/pm and nothing else', () => {
    // `מחר ב-9:00` refuses; `מחר ב-9:00 בבוקר` - the same hour with the day
    // part that settles it - is a full parity pair. If that stopped holding,
    // the divergence above would no longer be the documented one.
    const counterpart = PARITY_PAIRS.find((pair) => pair.key === 'p20-daypart-settles-hour') as ParityPair;
    for (const zone of ZONES) {
      const he = read('2026-03-04T08:00:00.000Z', zone.zone, counterpart.hebrew);
      const en = read('2026-03-04T08:00:00.000Z', zone.zone, counterpart.english);
      expect(he.ok, counterpart.hebrew).toBe(true);
      expect(he.startUtc).toBe(en.startUtc);
    }
  });
});
