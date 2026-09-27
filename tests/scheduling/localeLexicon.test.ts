/**
 * ADDING A LOCALE NEEDS NO RESOLVER EDIT. This file is the proof.
 *
 * WHAT IS BEING PROVED, AND WHY IT NEEDS ITS OWN FILE
 * ---------------------------------------------------------------------------
 * `src/scheduling/naturalLanguage.ts`, `src/scheduling/lexicon/types.ts` and
 * `src/scheduling/lexicon/index.ts` all make the same design claim in their
 * header comments: the resolver holds no language-specific literal, so adding a
 * third locale is writing a data module and registering it - never a resolver
 * edit. That claim is the whole reason root cause 2 (the English-only lexicon)
 * is considered closed rather than merely widened by one language, and it is
 * the one claim that a Hebrew test cannot make: `he` was added by the same
 * change that introduced the registry, so passing Hebrew phrases proves the
 * registry works for the two locales somebody hand-checked, not that a third
 * one needs nothing new.
 *
 * So this file registers a locale that DOES NOT EXIST in `src/` - `zz`,
 * "Volaptik", with an entirely invented vocabulary - through
 * `ParseNaturalLanguageOptions.lexicons`, and drives every rule of the grammar
 * in it: day anchors, weekdays with an AFTER-positioned modifier, day parts,
 * an implies-today day part, named times, a detached clock prefix, an ATTACHED
 * clock prefix with separators, a clock suffix, meridiems, quantity-and-unit
 * offsets with a softener, a single-word fixed duration, carriers, vagueness
 * markers and period tokens. Every form below is invented, so nothing here can
 * pass by accidentally colliding with `en` or `he`.
 *
 * THE FILE IS NOT VACUOUS, AND THAT WAS CHECKED RATHER THAN ASSUMED
 * ---------------------------------------------------------------------------
 * A test that registers a synthetic locale could pass because the resolver
 * understood the phrases some other way, or because it refused everything and
 * the assertions were too weak to notice. Dropping `ZZ_LEXICON` from `WITH_ZZ`
 * and running the file fails 23 of its 33 assertions - every positive case, and
 * every provenance check that names `zz`. The ten that survive are the two
 * registry checks, the `en`/`he` controls in § 4, and the § 3 refusals, which
 * refuse for a second reason once the vocabulary is gone.
 *
 * `tests/scheduling/localeRefusalBreadth.test.ts` also builds synthetic
 * locales, and the two do not overlap: that file drives the cross-locale
 * AMBIGUITY rule (two locales reading one token differently must refuse), which
 * is about what the union REFUSES. This file is about what a new locale
 * RESOLVES - the positive half, which is the half the three comments assert.
 *
 * WHICH LAYER THIS EXERCISES, STATED PLAINLY
 * ---------------------------------------------------------------------------
 * `lexicons` is a `parseNaturalLanguageDateTime` option and `DateTimeResolver`
 * deliberately does not forward it: production callers must never be able to
 * swap the grammar's vocabulary, so the seam stops at the grammar. A phrase is
 * therefore "resolved" here in the sense the grammar means it - down to a
 * concrete `LOCAL_WALL_TIME` target or an `ELAPSED_FROM_NOW` instant, asserted
 * field by field. The `DateTimeResolver` layer above it converts that target
 * into a UTC instant and is locale-blind by construction; `localeParity.test.ts`
 * and `localeTimezoneBoundaries.test.ts` cover that half against `en` and `he`.
 *
 * `now` is Wednesday 2026-03-04, 10:00 Asia/Jerusalem - the same instant the
 * other locale tests anchor to, so a date read across files means one thing.
 */
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { EN_LEXICON, HE_LEXICON, REGISTERED_LEXICONS } from '../../src/scheduling/lexicon/index.js';
import type { LocaleLexicon } from '../../src/scheduling/lexicon/types.js';
import {
  type LocalWallTimeTarget,
  type NaturalLanguageParse,
  parseNaturalLanguageDateTime,
} from '../../src/scheduling/naturalLanguage.js';
import { DEFAULT_DAY_PARTS } from '../../src/scheduling/policy.js';

/** Wednesday 2026-03-04, 10:00 Asia/Jerusalem. */
const NOW_UTC = '2026-03-04T08:00:00.000Z';
const JERUSALEM = 'Asia/Jerusalem';
const nowLocal = DateTime.fromISO(NOW_UTC, { zone: 'utc' }).setZone(JERUSALEM);

/**
 * A third locale that exists nowhere in `src/`.
 *
 * Every form is invented so that a passing assertion cannot be explained by an
 * accidental collision with a real lexicon - there is no language in which
 * `posmorgo` or `zo-15:00` means anything. § 0 below turns that from an
 * intention into an assertion, and it is not decoration: it is what caught
 * `min`, which `en` already declares as an abbreviation of `minute`.
 *
 * The shape is filled in COMPLETELY rather than minimally: the claim under test
 * is that the whole grammar is locale-agnostic, and a synthetic locale that
 * only declared day anchors would prove it for one rule.
 */
const ZZ_LEXICON: LocaleLexicon = {
  locale: 'zz',
  displayName: 'Volaptik (test only)',

  dayAnchors: [
    { forms: ['nunjo'], label: 'today', kind: 'RELATIVE_DAY', offsetDays: 0 },
    { forms: ['morgo'], label: 'tomorrow', kind: 'RELATIVE_DAY', offsetDays: 1 },
    { forms: ['posmorgo'], label: 'day_after_tomorrow', kind: 'RELATIVE_DAY', offsetDays: 2 },
    { forms: ['fintsemano'], label: 'end_of_week', kind: 'END_OF_WEEK' },
  ],

  weekdays: [
    { forms: ['kvindo'], isoWeekday: 4 },
    { forms: ['sesdo'], isoWeekday: 5 },
  ],

  // Both modifiers sit AFTER the weekday, as Hebrew's do and English's do not.
  // This is the field that would have had to be a resolver rule if the grammar
  // had kept English's "look one token to the left" assumption.
  weekdayModifiers: [
    { forms: ['sekva'], kind: 'NEXT', position: 'AFTER' },
    { forms: ['tiuj'], kind: 'THIS', position: 'AFTER' },
  ],

  dayParts: [
    { forms: ['matene'], dayPart: 'morning', impliesToday: false },
    { forms: ['posmeze'], dayPart: 'afternoon', impliesToday: false },
    { forms: ['vespere'], dayPart: 'evening', impliesToday: false },
    // A day part that names the current day at once - `tonight`, `הערב`.
    { forms: ['cinokte'], dayPart: 'evening', impliesToday: true, impliesTodayLabel: 'cinokte' },
  ],

  namedTimes: [
    { forms: ['mezdio'], hour: 12, minute: 0 },
    { forms: ['mezanokto'], hour: 0, minute: 0 },
  ],

  // `zo` is the attached prefix - the `ב-15:00` / `@3pm` shape - and `klok` the
  // detached one. Both spellings of the separator are declared.
  clockPrefixes: [
    { forms: ['klok'], attaches: false },
    { forms: ['zo'], attaches: true, attachedSeparators: ['', '-'] },
  ],

  clockSuffixes: ['horloĝe'],

  meridiems: [
    { forms: ['antmez'], meridiem: 'am' },
    { forms: ['postmez'], meridiem: 'pm' },
  ],

  relativeOffset: {
    prefixes: ['posten'],
    softeners: ['proksimume'],
    prefixRequired: true,
    quantities: [
      { forms: ['du'], value: 2 },
      { forms: ['tri'], value: 3 },
    ],
    units: [
      { forms: ['minutoj'], unit: 'minute' },
      { forms: ['horoj', 'horo'], unit: 'hour' },
      { forms: ['tagoj'], unit: 'day' },
      { forms: ['semanoj'], unit: 'week' },
    ],
    // One word that IS a quantity and a unit, with no separable number - the
    // Hebrew dual (`שעתיים`) and English idiom (`half an hour`) shape.
    fixedDurations: [{ forms: ['duhore'], value: 2, unit: 'hour', prefixOptional: true }],
  },

  // `mien` rather than `min`, which `en` already declares as an abbreviation of
  // `minute`. The collision test below is what caught that.
  carriers: ['bonvolu', 'telefonu', 'mien'],
  vaguenessMarkers: ['iamkiam'],
  periodTokens: ['semano'],
};

/** `en` + `he` + the synthetic third locale. The registry under test. */
const WITH_ZZ: readonly LocaleLexicon[] = [EN_LEXICON, HE_LEXICON, ZZ_LEXICON];

function parse(raw: string, lexicons: readonly LocaleLexicon[] = WITH_ZZ): NaturalLanguageParse {
  return parseNaturalLanguageDateTime(raw, { nowLocal, dayParts: DEFAULT_DAY_PARTS, lexicons });
}

/** Every form `zz` declares, flattened - used for the collision check. */
function everyFormOf(lexicon: LocaleLexicon): readonly string[] {
  const { relativeOffset } = lexicon;
  return [
    ...lexicon.dayAnchors.flatMap((entry) => entry.forms),
    ...lexicon.weekdays.flatMap((entry) => entry.forms),
    ...lexicon.weekdayModifiers.flatMap((entry) => entry.forms),
    ...lexicon.dayParts.flatMap((entry) => entry.forms),
    ...lexicon.namedTimes.flatMap((entry) => entry.forms),
    ...lexicon.clockPrefixes.flatMap((entry) => entry.forms),
    ...lexicon.clockSuffixes,
    ...lexicon.meridiems.flatMap((entry) => entry.forms),
    ...relativeOffset.prefixes,
    ...relativeOffset.softeners,
    ...relativeOffset.quantities.flatMap((entry) => entry.forms),
    ...relativeOffset.units.flatMap((entry) => entry.forms),
    ...relativeOffset.fixedDurations.flatMap((entry) => entry.forms),
    ...lexicon.carriers,
    ...lexicon.vaguenessMarkers,
    ...lexicon.periodTokens,
  ];
}

// ---------------------------------------------------------------------------
// 0. The synthetic locale is actually synthetic
// ---------------------------------------------------------------------------

describe('the synthetic locale shares no form with a real one', () => {
  it('no `zz` form appears in `en` or `he`, so nothing below can pass by collision', () => {
    const real = new Set([...everyFormOf(EN_LEXICON), ...everyFormOf(HE_LEXICON)]);
    const collisions = everyFormOf(ZZ_LEXICON).filter((form) => real.has(form));

    expect(
      collisions,
      'a `zz` form is also an `en` or `he` form, so a passing assertion below might be the real ' +
        'lexicon doing the work rather than the synthetic one. Rename the form.',
    ).toEqual([]);
  });

  it('`zz` is NOT in the production registry - this file registers it at runtime only', () => {
    expect(REGISTERED_LEXICONS.map((lexicon) => lexicon.locale)).toEqual(['en', 'he']);
  });
});

// ---------------------------------------------------------------------------
// 1. Every rule of the grammar, driven in a locale the resolver has never seen
// ---------------------------------------------------------------------------

interface WallTimeCase {
  readonly key: string;
  /** Which rule of the grammar this phrase is here to exercise. */
  readonly rule: string;
  readonly phrase: string;
  readonly expect: LocalWallTimeTarget;
  /** A `rule` value that must appear in the receipt attributed to `zz`. */
  readonly attributedRule: string;
  /** Text that must appear in some `zz` event - proves a specific form was consumed. */
  readonly attributedText?: string;
  readonly note?: string;
}

/**
 * `now` is Wednesday 2026-03-04, 10:00. So: tomorrow is the 5th (Thursday), the
 * day after is the 6th (Friday), the coming Thursday is the 5th, `sekva`
 * Thursday is the 12th, and the end of the week is Friday the 6th.
 *
 * WHY EVERY BARE HOUR BELOW CARRIES A MERIDIEM OR A DAY PART. An hour of 12 or
 * less with nothing to settle it is AMBIGUOUS and the grammar refuses it -
 * `11:00` could be 11:00 or 23:00. That rule is locale-agnostic too, so it
 * applies to `zz` exactly as it does to `en`, and the phrases here have to
 * satisfy it rather than work around it. `§ 3` asserts the refusal side.
 */
const WALL_TIME_CASES: readonly WallTimeCase[] = [
  {
    key: 'day-anchor-tomorrow-attached-clock',
    rule: 'day anchor + ATTACHED clock prefix with a separator',
    phrase: 'morgo zo-15:00',
    expect: { year: 2026, month: 3, day: 5, hour: 15, minute: 0 },
    attributedRule: 'day_anchor',
    note: 'the exact shape of the Founder case (`מחר ב-15:00`), in a language that does not exist',
  },
  {
    key: 'day-anchor-attached-clock-no-separator',
    rule: 'attached clock prefix with an EMPTY separator',
    phrase: 'morgo zo15:00',
    expect: { year: 2026, month: 3, day: 5, hour: 15, minute: 0 },
    attributedRule: 'clock_time',
  },
  {
    key: 'day-anchor-detached-clock',
    rule: 'detached clock prefix',
    phrase: 'posmorgo klok 21:30',
    expect: { year: 2026, month: 3, day: 6, hour: 21, minute: 30 },
    attributedRule: 'clock_time',
    attributedText: 'klok 21:30',
  },
  {
    key: 'today-and-named-time',
    rule: 'day anchor `today` + named time',
    phrase: 'nunjo mezdio',
    expect: { year: 2026, month: 3, day: 4, hour: 12, minute: 0 },
    attributedRule: 'named_time',
  },
  {
    key: 'weekday-this-modifier-after',
    rule: 'weekday with an AFTER-positioned THIS modifier',
    phrase: 'kvindo tiuj klok 11:00 antmez',
    expect: { year: 2026, month: 3, day: 5, hour: 11, minute: 0 },
    attributedRule: 'weekday_modifier',
    attributedText: 'tiuj',
    note: 'the soonest future Thursday is tomorrow, the 5th',
  },
  {
    key: 'weekday-next-modifier-after',
    rule: 'weekday with an AFTER-positioned NEXT modifier',
    phrase: 'kvindo sekva klok 11:00 antmez',
    expect: { year: 2026, month: 3, day: 12, hour: 11, minute: 0 },
    attributedRule: 'weekday_modifier',
    attributedText: 'sekva',
    note:
      'NEXT pushes past the soonest one, to the 12th - the arithmetic `next` has always done. The ' +
      'modifier sits AFTER the weekday here, which is the field English could not have exercised',
  },
  {
    key: 'weekday-bare',
    rule: 'bare weekday, no modifier',
    phrase: 'sesdo klok 14:00',
    expect: { year: 2026, month: 3, day: 6, hour: 14, minute: 0 },
    attributedRule: 'weekday',
  },
  {
    key: 'end-of-week',
    rule: 'END_OF_WEEK day anchor',
    phrase: 'fintsemano klok 16:00',
    expect: { year: 2026, month: 3, day: 6, hour: 16, minute: 0 },
    attributedRule: 'day_anchor',
  },
  {
    key: 'day-part-preferred-hour',
    rule: 'day part with no clock time - the policy supplies the hour',
    phrase: 'morgo posmeze',
    expect: {
      year: 2026,
      month: 3,
      day: 5,
      hour: Number(DEFAULT_DAY_PARTS.afternoon.preferredLocal.slice(0, 2)),
      minute: Number(DEFAULT_DAY_PARTS.afternoon.preferredLocal.slice(3, 5)),
    },
    attributedRule: 'day_part',
  },
  {
    key: 'day-part-with-clock',
    rule: 'day part + clock time together',
    phrase: 'morgo matene zo-08:15',
    expect: { year: 2026, month: 3, day: 5, hour: 8, minute: 15 },
    attributedRule: 'day_part',
  },
  {
    key: 'implies-today-day-part',
    rule: 'a day part that names the current day (`impliesToday`)',
    phrase: 'cinokte klok 20:00',
    expect: { year: 2026, month: 3, day: 4, hour: 20, minute: 0 },
    attributedRule: 'day_part',
    note: 'no day word at all: the day comes from the day part, as English `tonight` does',
  },
  {
    key: 'meridiem-pm',
    rule: 'meridiem `pm` on a bare hour',
    phrase: 'morgo klok 3 postmez',
    expect: { year: 2026, month: 3, day: 5, hour: 15, minute: 0 },
    attributedRule: 'clock_time',
  },
  {
    key: 'meridiem-am',
    rule: 'meridiem `am` on a bare hour',
    phrase: 'morgo klok 9 antmez',
    expect: { year: 2026, month: 3, day: 5, hour: 9, minute: 0 },
    attributedRule: 'clock_time',
  },
  {
    key: 'clock-suffix',
    rule: 'clock suffix marking a bare number as a clock time',
    phrase: 'morgo 16 horloĝe',
    expect: { year: 2026, month: 3, day: 5, hour: 16, minute: 0 },
    // A suffix-marked clock time is recorded as LOCALE-AGNOSTIC (`*`, form
    // `HH:mm`) - the digits are not Volaptik, and only the day anchor here is.
    // That is why this case names `day_anchor` and then checks separately that
    // the suffix itself was consumed.
    attributedRule: 'day_anchor',
    note: 'a suffix, unlike a prefix, sits AFTER the number - `4 o’clock`, `16 horloĝe`',
  },
  {
    key: 'day-part-disambiguates-a-suffixed-hour',
    rule: 'a day part settling an otherwise-ambiguous bare hour',
    phrase: 'morgo posmeze 4 horloĝe',
    expect: { year: 2026, month: 3, day: 5, hour: 16, minute: 0 },
    attributedRule: 'day_part',
    note: '`4` with an afternoon day part is 16:00, not 04:00 - and it is the DAY PART that says so',
  },
  {
    key: 'carriers-around-a-real-phrase',
    rule: 'carrier tokens, discarded BY RULE',
    phrase: 'bonvolu telefonu mien morgo zo-15:00',
    expect: { year: 2026, month: 3, day: 5, hour: 15, minute: 0 },
    attributedRule: 'carrier',
    note: 'three words that mean nothing to a scheduler and are permitted rather than silently dropped',
  },
];

describe('a locale the resolver has never seen resolves through every rule', () => {
  for (const testCase of WALL_TIME_CASES) {
    it(`${testCase.key}: ${testCase.rule}`, () => {
      const parsed = parse(testCase.phrase);

      expect(parsed.ok, `"${testCase.phrase}" must resolve. ${testCase.note ?? ''}`).toBe(true);
      if (!parsed.ok) throw new Error('unreachable');
      expect(parsed.kind).toBe('LOCAL_WALL_TIME');
      if (parsed.kind !== 'LOCAL_WALL_TIME') throw new Error('unreachable');

      expect(parsed.target).toEqual(testCase.expect);

      // Nothing was silently discarded - the § 8.3 rule, in a new locale.
      expect(parsed.interpretation.leftover, 'a resolved phrase must have no leftover').toEqual([]);

      // The receipt CREDITS the synthetic locale, by name, for the rule under
      // test. A grammar that resolved the phrase but recorded it as English
      // would be hiding exactly what this file exists to show.
      expect(parsed.interpretation.locales).toContain('zz');
      const attributed = parsed.interpretation.lexicon.filter(
        (event) => event.rule === testCase.attributedRule && event.locale === 'zz',
      );
      expect(
        attributed.length,
        `no \`${testCase.attributedRule}\` event was attributed to \`zz\`. Events: ` +
          JSON.stringify(parsed.interpretation.lexicon),
      ).toBeGreaterThan(0);

      if (testCase.attributedText !== undefined) {
        expect(
          attributed.map((event) => event.text),
          `\`${testCase.attributedText}\` must be the text the \`zz\` rule consumed`,
        ).toContain(testCase.attributedText);
      }
    });
  }

  it('the clock SUFFIX is consumed by rule, not left over', () => {
    const parsed = parse('morgo 16 horloĝe');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    // The suffix is part of the text the clock rule consumed. Nothing deleted
    // it behind the reader's back, which is the whole reason `clockSuffixes` is
    // declared data rather than a `normalize()` regex.
    expect(parsed.interpretation.lexicon.map((event) => event.text).join(' ')).toContain('horloĝe');
    expect(parsed.interpretation.leftover).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. The relative-offset rule
// ---------------------------------------------------------------------------

/**
 * Sub-day offsets produce an ELAPSED instant; day and week offsets produce a
 * wall time on a later calendar day, keeping the current time of day. That
 * split is a property of the grammar and not of any language, so the synthetic
 * locale has to land on both sides of it exactly as `en` and `he` do.
 */
interface ElapsedCase {
  readonly key: string;
  readonly rule: string;
  readonly phrase: string;
  readonly expectMinutesFromNow: number;
}

const ELAPSED_CASES: readonly ElapsedCase[] = [
  { key: 'quantity-and-unit', rule: 'prefix + quantity + unit', phrase: 'posten du horoj', expectMinutesFromNow: 120 },
  {
    key: 'digit-quantity',
    rule: 'prefix + DIGIT quantity + unit',
    phrase: 'posten 45 minutoj',
    expectMinutesFromNow: 45,
  },
  {
    key: 'softener-between-prefix-and-quantity',
    rule: 'a softener between the prefix and the quantity',
    phrase: 'posten proksimume du horoj',
    expectMinutesFromNow: 120,
  },
  {
    key: 'fixed-duration-without-prefix',
    rule: 'a one-word fixed duration, resolving with NO prefix (`prefixOptional`)',
    phrase: 'duhore',
    expectMinutesFromNow: 120,
  },
];

describe('the relative-offset rule works in the synthetic locale', () => {
  for (const testCase of ELAPSED_CASES) {
    it(`${testCase.key}: ${testCase.rule}`, () => {
      const parsed = parse(testCase.phrase);

      expect(parsed.ok, `"${testCase.phrase}" must resolve`).toBe(true);
      if (!parsed.ok) throw new Error('unreachable');
      expect(parsed.kind).toBe('ELAPSED_FROM_NOW');
      if (parsed.kind !== 'ELAPSED_FROM_NOW') throw new Error('unreachable');

      expect(parsed.epochMillis).toBe(nowLocal.toMillis() + testCase.expectMinutesFromNow * 60_000);
      expect(parsed.interpretation.leftover).toEqual([]);
      expect(parsed.interpretation.locales).toContain('zz');
    });
  }

  // `now` is 10:00 on Wednesday the 4th, and a day/week offset keeps that time.
  const DAY_SCALE_CASES: readonly { key: string; phrase: string; expect: LocalWallTimeTarget }[] = [
    {
      key: 'day-unit',
      phrase: 'posten proksimume tri tagoj',
      expect: { year: 2026, month: 3, day: 7, hour: 10, minute: 0 },
    },
    { key: 'week-unit', phrase: 'posten du semanoj', expect: { year: 2026, month: 3, day: 18, hour: 10, minute: 0 } },
  ];

  for (const testCase of DAY_SCALE_CASES) {
    it(`${testCase.key}: a day-scale offset becomes a wall time, keeping the time of day`, () => {
      const parsed = parse(testCase.phrase);

      expect(parsed.ok, `"${testCase.phrase}" must resolve`).toBe(true);
      if (!parsed.ok) throw new Error('unreachable');
      expect(parsed.kind).toBe('LOCAL_WALL_TIME');
      if (parsed.kind !== 'LOCAL_WALL_TIME') throw new Error('unreachable');

      expect(parsed.target).toEqual(testCase.expect);
      expect(parsed.interpretation.matched).toContain('kept_current_time_of_day');
      expect(parsed.interpretation.leftover).toEqual([]);
      expect(parsed.interpretation.locales).toContain('zz');
    });
  }

  it('an offset without its required prefix refuses - `prefixRequired` is honoured for `zz` too', () => {
    const parsed = parse('du horoj');

    expect(parsed.ok, '`du horoj` is a duration, not an instruction, and `zz` requires `posten`').toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.interpretation.dayAnchor).not.toBe('implicit_today');
  });
});

// ---------------------------------------------------------------------------
// 3. Fail-closed applies to the new locale too - it is not an English rule
// ---------------------------------------------------------------------------

describe('the new locale gets the same refusals, not a more permissive grammar', () => {
  it('a token `zz` does not declare refuses and is NAMED, even beside valid `zz` words', () => {
    const parsed = parse('morgo zo-15:00 blorp');

    expect(parsed.ok, 'an unaccounted token must refuse, in any locale').toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.reason).toContain('blorp');
    expect(parsed.interpretation.leftover).toContain('blorp');
    // The § 8.3 defect, stated for a locale nobody hand-checked.
    expect(parsed.interpretation.dayAnchor, 'must not fall through to today').not.toBe('implicit_today');
    expect(parsed.interpretation.matched).not.toContain('implicit_today');
  });

  it('an ambiguous bare hour refuses in `zz`, exactly as it does in `en`', () => {
    // The same phrase WITH a meridiem is `weekday-this-modifier-after` above and
    // resolves. So this refusal is the am/pm rule firing, not the locale failing
    // to be understood - and that rule is not an English rule either.
    const parsed = parse('kvindo tiuj klok 11:00');

    expect(parsed.ok, '11:00 could be 11:00 or 23:00 - a guess here is a customer at the wrong hour').toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.reason).toContain('11');
    expect(parsed.interpretation.dayAnchor).not.toBe('implicit_today');
  });

  it('a `zz` vagueness marker refuses: the contact has not named a time', () => {
    const parsed = parse('iamkiam');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.interpretation.dayAnchor).not.toBe('implicit_today');
  });

  it('a `zz` period token refuses rather than being read as a moment', () => {
    const parsed = parse('semano');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.interpretation.dayAnchor).not.toBe('implicit_today');
  });

  it('`zz` carriers alone are not a booking - a phrase of only filler refuses', () => {
    const parsed = parse('bonvolu telefonu min');

    expect(parsed.ok, 'filler with no day and no time must not become a time').toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.interpretation.dayAnchor).not.toBe('implicit_today');
  });
});

// ---------------------------------------------------------------------------
// 4. Registering a third locale does not disturb the two that ship
// ---------------------------------------------------------------------------

describe('the union grows without changing what `en` and `he` mean', () => {
  const PRODUCTION_PHRASES: readonly { raw: string; locale: string; expect: LocalWallTimeTarget }[] = [
    { raw: 'tomorrow at 3pm', locale: 'en', expect: { year: 2026, month: 3, day: 5, hour: 15, minute: 0 } },
    { raw: 'מחר ב-15:00', locale: 'he', expect: { year: 2026, month: 3, day: 5, hour: 15, minute: 0 } },
  ];

  for (const phrase of PRODUCTION_PHRASES) {
    it(`"${phrase.raw}" resolves identically with and without \`zz\` registered`, () => {
      const withZz = parse(phrase.raw, WITH_ZZ);
      const withoutZz = parse(phrase.raw, REGISTERED_LEXICONS);

      for (const [label, parsed] of [
        ['with zz', withZz],
        ['without zz', withoutZz],
      ] as const) {
        expect(parsed.ok, `${label}: must resolve`).toBe(true);
        if (!parsed.ok) throw new Error('unreachable');
        if (parsed.kind !== 'LOCAL_WALL_TIME') throw new Error(`${label}: expected a wall time`);
        expect(parsed.target, label).toEqual(phrase.expect);
        expect(parsed.interpretation.locales, label).toContain(phrase.locale);
        // The synthetic locale is registered but supplied nothing, so it must
        // not appear in the receipt for a phrase it did not understand.
        if (label === 'with zz') expect(parsed.interpretation.locales).not.toContain('zz');
      }
    });
  }
});
