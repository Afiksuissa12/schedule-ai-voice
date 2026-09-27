/**
 * DATE-ONLY versus DATE-PLUS-TIME, in both locales.
 *
 * THE RULE BEING PROTECTED
 * ---------------------------------------------------------------------------
 * > A date without a time is not a slot.
 *
 * That has always been the English behaviour (`SCHEDULING_CONTRACT.md` § 2:
 * "a day with no time - `next tuesday`" is listed under *it refuses rather than
 * guesses*), and it is the rule most at risk from a change that teaches the
 * grammar a new language. The tempting bug is symmetrical to the § 8.3 one: a
 * new locale's day word is understood, no time is found, and something helpful
 * happens - a default hour, a roll to business-hours open, the current time of
 * day - instead of a refusal. Any of those books a call at an hour the contact
 * never agreed to.
 *
 * So both halves are asserted, in both languages, across every day form the two
 * lexicons declare:
 *
 *   DATE-ONLY      -> refused, with the SAME reason in both languages
 *   DATE-PLUS-TIME -> resolved, to the SAME instant in both languages
 *
 * and the two lists are built from the same day forms, so a form cannot appear
 * in one and be forgotten in the other.
 *
 * THE TIME HALF IS DELIBERATELY VARIED
 * ---------------------------------------------------------------------------
 * "A time" is not one thing. A day can be completed by a digit clock time, by a
 * day part (which supplies the documented preferred hour), by a named time, or
 * by a digit hour that only a day part can disambiguate. All four are crossed
 * with the day forms, because "is not a slot" has to flip to "is a slot" for
 * every one of them and for neither language only.
 *
 * `now` is Wednesday 2026-03-04, 10:00 in the contact's zone for the Jerusalem
 * case - the instant § 8.3 was reproduced at.
 */
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../src/ports/clock.js';
import { DateTimeResolver } from '../../src/scheduling/dateTimeResolver.js';
import { schedulingPolicy } from '../../src/scheduling/policy.js';

const NOW_UTC = '2026-03-04T08:00:00.000Z';
const ZONES = ['Asia/Jerusalem', 'America/New_York', 'Pacific/Auckland'] as const;

function resolve(raw: string, timezone: string) {
  return new DateTimeResolver(new FixedClock(NOW_UTC)).resolve(
    { raw, timezone },
    { policy: schedulingPolicy({ defaultTimezone: timezone, defaultMeetingDurationMinutes: 30 }) },
  );
}

/** A way of naming a DAY, in both languages. Carries no time. */
interface DayForm {
  readonly key: string;
  readonly hebrew: string;
  readonly english: string;
}

const DAY_FORMS: readonly DayForm[] = [
  { key: 'today', hebrew: 'היום', english: 'today' },
  { key: 'tomorrow', hebrew: 'מחר', english: 'tomorrow' },
  { key: 'day-after-tomorrow', hebrew: 'מחרתיים', english: 'the day after tomorrow' },
  { key: 'weekday-bare', hebrew: 'יום חמישי', english: 'thursday' },
  { key: 'weekday-preposition', hebrew: 'ביום שישי', english: 'on friday' },
  { key: 'weekday-next', hebrew: 'יום חמישי הבא', english: 'next thursday' },
  { key: 'weekday-saturday', hebrew: 'בשבת', english: 'saturday' },
  { key: 'end-of-week', hebrew: 'סוף השבוע', english: 'end of the week' },
  { key: 'iso-date', hebrew: '2026-04-17', english: '2026-04-17' },
];

/** A way of naming a TIME, in both languages, and the hour it must produce. */
interface TimeForm {
  readonly key: string;
  readonly hebrew: string;
  readonly english: string;
  /** The local wall-clock time the completed phrase must land on. */
  readonly expectedLocalTime: string;
  readonly note: string;
}

const TIME_FORMS: readonly TimeForm[] = [
  {
    key: 'digit-clock',
    hebrew: 'ב-15:00',
    english: 'at 15:00',
    expectedLocalTime: '15:00',
    note: 'The digit clock time - the exact input class § 8.3 is about.',
  },
  {
    key: 'day-part',
    hebrew: 'בבוקר',
    english: 'morning',
    expectedLocalTime: '09:00',
    note: 'A day part with no clock time, which supplies the documented preferred hour.',
  },
  {
    key: 'named-time',
    hebrew: 'בצהריים',
    english: 'at noon',
    expectedLocalTime: '12:00',
    note: 'A named time rather than digits.',
  },
  {
    key: 'digit-settled-by-day-part',
    hebrew: 'ב-9:00 בבוקר',
    english: 'at 9am',
    expectedLocalTime: '09:00',
    note:
      'A 1..11 hour, which only resolves because something settles it. Hebrew has no am/pm so it needs ' +
      'the day part; English can use either. Both must reach the same hour.',
  },
];

// ---------------------------------------------------------------------------

describe('a date WITHOUT a time is not a slot - in either language', () => {
  for (const zone of ZONES) {
    it.each(DAY_FORMS)(`${zone} / $key: both languages refuse, with the same reason`, (dayForm) => {
      for (const [language, raw] of [
        ['he', dayForm.hebrew],
        ['en', dayForm.english],
      ] as const) {
        const result = resolve(raw, zone);
        expect(
          result.ok,
          `${language} "${raw}" names a day and no time. It must be refused, not completed with a ` +
            'default hour - a call at an hour nobody agreed to is the harm this rule prevents.',
        ).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.code).toBe('INVALID_FORMAT');
        expect(result.reason, `${language} "${raw}"`).toMatch(/names a day but no time/);
        expect(result.reason, `${language} "${raw}"`).toContain('A date without a time is not a slot.');
        // Nothing was resolved, so there is nothing to persist or dial.
        expect(result.provenance.resolvedStartUtc).toBeUndefined();
      }
    });
  }

  it('the refusal is the DAY-WITHOUT-TIME one, not the fail-closed leftover one', () => {
    // These two refusals mean very different things to whoever reads the
    // receipt: "I understood you and you did not give me a time" versus "there
    // is a word here I cannot read". Collapsing them would make the Hebrew
    // coverage claim unfalsifiable, because an unimplemented day word would
    // look exactly like an implemented one with no time attached.
    for (const zone of ZONES) {
      for (const dayForm of DAY_FORMS) {
        for (const raw of [dayForm.hebrew, dayForm.english]) {
          const result = resolve(raw, zone);
          if (result.ok) throw new Error('unreachable');
          expect(result.reason, raw).not.toMatch(/could not account for/);
          const interpretation = result.provenance.notes?.['interpretation'] as
            | { leftover?: string[]; dayAnchor?: string }
            | undefined;
          expect(interpretation?.leftover, `${raw} must leave nothing unaccounted for`).toEqual([]);
          expect(interpretation?.dayAnchor, `${raw} must have been understood as a day`).toBeDefined();
        }
      }
    }
  });

  it('a Hebrew day form and its English translation refuse identically', () => {
    for (const zone of ZONES) {
      for (const dayForm of DAY_FORMS) {
        const hebrew = resolve(dayForm.hebrew, zone);
        const english = resolve(dayForm.english, zone);
        expect(hebrew.ok).toBe(false);
        expect(english.ok).toBe(false);
        if (hebrew.ok || english.ok) throw new Error('unreachable');
        expect(hebrew.code, dayForm.key).toBe(english.code);
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe('a date WITH a time is a slot - and the same slot in either language', () => {
  for (const zone of ZONES) {
    it.each(DAY_FORMS)(`${zone} / $key: every way of naming a time completes it`, (dayForm) => {
      for (const timeForm of TIME_FORMS) {
        const hebrew = resolve(`${dayForm.hebrew} ${timeForm.hebrew}`, zone);
        const english = resolve(`${dayForm.english} ${timeForm.english}`, zone);
        const context = `${dayForm.key} + ${timeForm.key} in ${zone}. ${timeForm.note}`;

        expect(hebrew.ok, `he "${dayForm.hebrew} ${timeForm.hebrew}" - ${context}`).toBe(true);
        expect(english.ok, `en "${dayForm.english} ${timeForm.english}" - ${context}`).toBe(true);
        if (!hebrew.ok || !english.ok) throw new Error('unreachable');

        // The same instant...
        expect(hebrew.value.startUtc, context).toBe(english.value.startUtc);
        // ...the same calendar day on the contact's clock...
        expect(
          DateTime.fromISO(hebrew.value.startUtc, { zone }).toFormat('yyyy-LL-dd'),
          context,
        ).toBe(DateTime.fromISO(english.value.startUtc, { zone }).toFormat('yyyy-LL-dd'));
        // ...and the wall-clock time the time form promised.
        expect(hebrew.value.startLocal.slice(11), context).toBe(timeForm.expectedLocalTime);
        expect(english.value.startLocal.slice(11), context).toBe(timeForm.expectedLocalTime);
      }
    });
  }

  it('the day half still decides the DAY - completing a phrase does not move it', () => {
    // A time form must not be able to change which day was named. Checked
    // against the relative day words, whose day is fixed arithmetic on the
    // contact's own calendar rather than anything the resolver chooses.
    const relative: readonly [string, number][] = [
      ['today', 0],
      ['tomorrow', 1],
      ['day-after-tomorrow', 2],
    ];
    for (const zone of ZONES) {
      const contactToday = DateTime.fromISO(NOW_UTC, { zone: 'utc' }).setZone(zone).startOf('day');
      for (const [key, offsetDays] of relative) {
        const dayForm = DAY_FORMS.find((candidate) => candidate.key === key) as DayForm;
        const expected = contactToday.plus({ days: offsetDays }).toFormat('yyyy-LL-dd');
        for (const timeForm of TIME_FORMS) {
          for (const raw of [`${dayForm.hebrew} ${timeForm.hebrew}`, `${dayForm.english} ${timeForm.english}`]) {
            const result = resolve(raw, zone);
            if (!result.ok) throw new Error(`"${raw}" should resolve in ${zone}`);
            expect(result.value.startLocal.slice(0, 10), `"${raw}" in ${zone}`).toBe(expected);
          }
        }
      }
    }
  });

  it('an ISO date carries a Hebrew time exactly as it carries an English one', () => {
    // The locale-agnostic half meeting the locale-aware half. `iso_date` is
    // recorded as a `*` rule, and the Hebrew preposition next to it must still
    // be consumed by the Hebrew lexicon.
    for (const zone of ZONES) {
      const result = resolve('2026-04-17 ב-14:00', zone);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.value.startLocal).toBe('2026-04-17T14:00');
      const interpretation = result.value.interpretation;
      expect(interpretation.dayAnchor).toBe('iso_date:2026-04-17');
      expect(interpretation.locales).toEqual(['he']);
      expect(interpretation.lexicon?.map((event) => event.rule)).toContain('iso_date');
    }
  });
});

// ---------------------------------------------------------------------------

describe('a date that is not a real date is refused before anything else happens', () => {
  it.each([
    ['2026-13-01 ב-14:00', 'a thirteenth month, with a Hebrew time'],
    ['2026-13-01 at 14:00', 'a thirteenth month, with an English time'],
    ['2026-02-30 ב-14:00', '30 February, with a Hebrew time'],
    ['2026-02-30 at 14:00', '30 February, with an English time'],
  ])('%s refuses (%s)', (raw) => {
    for (const zone of ZONES) {
      const result = resolve(raw, zone);
      expect(result.ok, `"${raw}" in ${zone}`).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.code).toBe('INVALID_FORMAT');
      expect(result.reason).toMatch(/is not a real calendar date/);
    }
  });

  it('a date in a format this grammar does not accept refuses, naming the leftover', () => {
    // `17/04/2026` is unambiguous to a British reader and means something else
    // to an American one. Refusing it, by the fail-closed rule, with the
    // leftover named, is the correct outcome in both languages.
    for (const raw of ['17/04/2026 ב-14:00', '17/04/2026 at 14:00']) {
      const result = resolve(raw, 'Asia/Jerusalem');
      expect(result.ok, raw).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.reason).toContain('17/04/2026');
    }
  });
});
