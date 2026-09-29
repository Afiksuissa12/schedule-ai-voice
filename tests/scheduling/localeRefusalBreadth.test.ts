/**
 * REFUSALS AT BREADTH: the half of the fix that is not about Hebrew.
 *
 * WHAT THIS ADDS TO `failClosedGrammar.test.ts`
 * ---------------------------------------------------------------------------
 * That file proves the fail-closed rule with three unknown languages and a
 * synthetic locale, which is the right size for a unit test of the rule. This
 * file is the regression net around it, and it differs in three ways:
 *
 *  1. BREADTH OF SCRIPT. Arabic, Russian and French are the languages the
 *     Founder Review names, and they are all written in alphabets a reader
 *     might imagine someone eventually adding to the grammar. The interesting
 *     claim is about the ones nobody will: Han, Hangul, Greek, Thai,
 *     Devanagari, Georgian, Ethiopic, Armenian, an invented Latin word, and an
 *     emoji. If the rule is general, none of those needs a line of code.
 *
 *  2. BREADTH OF AMBIGUITY KIND. `en` and `he` use disjoint scripts, so no
 *     real token can trigger the cross-locale ambiguity rule today. It is
 *     exercised against synthetic locales across EVERY kind of disagreement the
 *     rule recognises - day anchor, weekday, day part, named time, offset unit,
 *     offset quantity, and kind-versus-kind - each with an AGREEMENT control,
 *     because a rule that refuses everything is not a rule.
 *
 *  3. ONE PROPERTY ASSERTED OVER ALL OF IT. Every refusal in this file is
 *     checked against the same three statements, rather than each case being
 *     spot-checked for whichever one its author remembered:
 *
 *       (a) it refuses, with INVALID_FORMAT;
 *       (b) the reason NAMES the token it could not account for;
 *       (c) it never, under any circumstances, becomes "the contact meant
 *           today".
 *
 * (c) is the one that matters. The § 8.3 defect was not that the grammar failed
 * to understand `מחר` - it was that failing to understand it silently produced
 * a booking. A refusal nobody can act on is a nuisance; a wrong day is a
 * customer on the phone at the wrong time.
 *
 * `now` is Wednesday 2026-03-04, 10:00 Asia/Jerusalem - the instant the defect
 * was reproduced at - so the wrong answer, 2026-03-04, is recognisable on
 * sight, and it is asserted to appear nowhere.
 */
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../src/ports/clock.js';
import { DateTimeResolver } from '../../src/scheduling/dateTimeResolver.js';
import { EN_LEXICON, HE_LEXICON } from '../../src/scheduling/lexicon/index.js';
import type { LocaleLexicon } from '../../src/scheduling/lexicon/types.js';
import { parseNaturalLanguageDateTime } from '../../src/scheduling/naturalLanguage.js';
import { DEFAULT_DAY_PARTS, schedulingPolicy } from '../../src/scheduling/policy.js';

/** Wednesday 2026-03-04, 10:00 Asia/Jerusalem. */
const NOW_UTC = '2026-03-04T08:00:00.000Z';
const JERUSALEM = 'Asia/Jerusalem';
/** The calendar day the English-only resolver used to land on. */
const THE_DAY_THE_BROKEN_RESOLVER_PICKED = '2026-03-04';

const resolver = new DateTimeResolver(new FixedClock(NOW_UTC));
const policy = schedulingPolicy({ defaultTimezone: JERUSALEM, defaultMeetingDurationMinutes: 30 });
const nowLocal = DateTime.fromISO(NOW_UTC, { zone: 'utc' }).setZone(JERUSALEM);

function resolve(raw: string) {
  return resolver.resolve({ raw, timezone: JERUSALEM }, { policy });
}

function parse(raw: string, lexicons?: readonly LocaleLexicon[]) {
  return parseNaturalLanguageDateTime(raw, {
    nowLocal,
    dayParts: DEFAULT_DAY_PARTS,
    ...(lexicons ? { lexicons } : {}),
  });
}

/**
 * The three statements every refusal in this file has to satisfy.
 *
 * Written once and applied everywhere, so no case can be added that quietly
 * only checks the easy part.
 */
function assertRefusedAndNeverToday(raw: string, mustName: string, context: string): void {
  const result = resolve(raw);

  // (a) refused
  expect(result.ok, `${context}: "${raw}" must be refused, not resolved`).toBe(false);
  if (result.ok) throw new Error('unreachable');
  expect(result.code, context).toBe('INVALID_FORMAT');

  // (b) the reason names the evidence
  expect(
    result.reason,
    `${context}: the refusal must name "${mustName}" - a refusal nobody can act on helps nobody. ` +
      `Got: ${result.reason}`,
  ).toContain(mustName);

  // (c) never today, by any route
  expect(result.provenance.resolvedStartUtc, `${context}: nothing may be resolved`).toBeUndefined();
  const parsed = parse(raw);
  expect(parsed.ok, context).toBe(false);
  expect(parsed.interpretation.dayAnchor, `${context}: must NOT fall through to today`).not.toBe('implicit_today');
  expect(parsed.interpretation.matched, context).not.toContain('implicit_today');
  expect(
    JSON.stringify(result.provenance.notes ?? {}),
    `${context}: the day the broken resolver picked must appear nowhere in the receipt`,
  ).not.toContain(THE_DAY_THE_BROKEN_RESOLVER_PICKED);
}

// ---------------------------------------------------------------------------
// 1. Unknown-language tokens
// ---------------------------------------------------------------------------

interface UnknownLanguageCase {
  readonly script: string;
  /** "tomorrow at 15:00", or as near as makes no difference, in that script. */
  readonly when: string;
  /** The token no lexicon claims, which the refusal must quote. */
  readonly leftover: string;
  readonly note: string;
}

/**
 * Every one of these carries the one thing the OLD grammar could read - a digit
 * clock time - next to a day word it could not. That combination is precisely
 * what used to produce `implicit_today` and a booking a day early, in any
 * language at all. `docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 8.3.
 */
const UNKNOWN_LANGUAGE_CASES: readonly UnknownLanguageCase[] = [
  {
    script: 'Arabic',
    when: 'غدا في 15:00',
    leftover: 'غدا',
    note: 'Named in the Founder Review. Right-to-left, like Hebrew, but no lexicon claims it.',
  },
  {
    script: 'Russian (Cyrillic)',
    when: 'завтра в 15:00',
    leftover: 'завтра',
    note: 'Named in the Founder Review.',
  },
  {
    script: 'French (Latin)',
    when: 'demain à 15:00',
    leftover: 'demain',
    note: 'Named in the Founder Review. The SAME alphabet English uses, so nothing about the script saves it.',
  },
  {
    script: 'Japanese (Han)',
    when: '明日 15:00',
    leftover: '明日',
    note: 'A script no lexicon here will ever cover. One token, no spaces, ideographic.',
  },
  {
    script: 'Korean (Hangul)',
    when: '내일 15:00',
    leftover: '내일',
    note: 'A second never-covered script, syllabic rather than ideographic.',
  },
  {
    script: 'Greek',
    when: 'αύριο στις 15:00',
    leftover: 'αύριο',
    note: 'Two unknown tokens, so the refusal has to quote more than one word.',
  },
  {
    script: 'Thai',
    when: 'พรุ่งนี้ 15:00',
    leftover: 'พรุ่งนี้',
    note: 'An abugida written without spaces between words.',
  },
  {
    script: 'Hindi (Devanagari)',
    when: 'कल 15:00',
    leftover: 'कल',
    note: 'A very short token - two code points - so a length heuristic could not have caught it.',
  },
  {
    script: 'Georgian',
    when: 'ხვალ 15:00',
    leftover: 'ხვალ',
    note: 'A unicameral alphabet, which nothing in the grammar has an opinion about.',
  },
  {
    script: 'Amharic (Ethiopic)',
    when: 'ነገ 15:00',
    leftover: 'ነገ',
    note: 'A syllabary outside every plane the other cases live in.',
  },
  {
    script: 'Armenian',
    when: 'վաղը 15:00',
    leftover: 'վաղը',
    note: 'A tenth script, for the same reason as the ninth: the rule names none of them.',
  },
  {
    script: 'an invented Latin word',
    when: 'nāækt 15:00',
    leftover: 'nāækt',
    note: 'THE CONTROL FOR THE WHOLE BLOCK. Latin letters, diacritics, no language at all - so the ' +
      'refusals above cannot be explained by "non-Latin scripts are blocked somewhere".',
  },
  {
    script: 'an emoji',
    when: '🗓️ 15:00',
    leftover: '🗓️',
    note: 'Not a script any lexicon will ever cover, and a real thing that arrives from a chat channel.',
  },
];

describe('an unknown-language day word next to a digit clock time', () => {
  it.each(UNKNOWN_LANGUAGE_CASES)('$script: refuses, names the leftover, and never becomes today', (unknown) => {
    assertRefusedAndNeverToday(unknown.when, unknown.leftover, `${unknown.script} - ${unknown.note}`);
  });

  it.each(UNKNOWN_LANGUAGE_CASES)('$script: the leftover is recorded as evidence, not just described', (unknown) => {
    // The receipt has to carry the token as DATA, so an auditor or a monitoring
    // job can count them without regexing a human sentence.
    const parsed = parse(unknown.when);
    expect(parsed.ok).toBe(false);
    expect(parsed.interpretation.leftover, unknown.when).toContain(unknown.leftover);
    expect(parsed.interpretation.locales, 'no lexicon may claim to have understood this').not.toContain('he');

    const notes = resolve(unknown.when).provenance.notes?.['interpretation'] as
      | { leftover?: string[] }
      | undefined;
    expect(notes?.leftover, unknown.when).toContain(unknown.leftover);
  });

  it('covers the three languages the Founder Review names, and at least four never-covered scripts', () => {
    const scripts = UNKNOWN_LANGUAGE_CASES.map((unknown) => unknown.script);
    expect(scripts.some((script) => script.startsWith('Arabic'))).toBe(true);
    expect(scripts.some((script) => script.startsWith('Russian'))).toBe(true);
    expect(scripts.some((script) => script.startsWith('French'))).toBe(true);
    // Scripts that are not Latin, Hebrew, Arabic or Cyrillic - i.e. ones no
    // lexicon in this product's plausible future covers.
    const neverCovered = UNKNOWN_LANGUAGE_CASES.filter((unknown) =>
      /Han|Hangul|Greek|Thai|Devanagari|Georgian|Ethiopic|Armenian|emoji/.test(unknown.script),
    );
    expect(neverCovered.length).toBeGreaterThanOrEqual(4);
  });

  it('refuses digits it has never been shown, rather than guessing at them', () => {
    // Arabic-Indic digits are deliberately NOT normalised (`script.ts`):
    // inventing an untested digit rule would be the same class of mistake as
    // the one being fixed.
    assertRefusedAndNeverToday('غدا ١٥:٠٠', '١٥:٠٠', 'Arabic-Indic digits');
  });

  it('refuses an unknown word even when the REST of the phrase is perfectly good Hebrew', () => {
    // The dangerous shape: enough is understood to look like a successful
    // parse, and one token is not. This is `מחר ב-15:00` with a single word of
    // noise, and it must not book anything.
    assertRefusedAndNeverToday('מחר ב-15:00 blorp', 'blorp', 'good Hebrew plus one unknown token');
    assertRefusedAndNeverToday('מחר אחרי הצהריים, בשתיים', 'בשתיים', 'an hour spelled out in Hebrew words');
  });

  it('refuses an unknown word even when the rest is perfectly good English', () => {
    assertRefusedAndNeverToday('tomorrow at 15:00 blorp', 'blorp', 'good English plus one unknown token');
  });

  it('CONTROL: the very same phrases with the unknown token removed DO resolve', () => {
    // Without this, every assertion above would be satisfied by a resolver that
    // refused absolutely everything.
    for (const [raw, expected] of [
      ['מחר ב-15:00', '2026-03-05T15:00'],
      ['tomorrow at 15:00', '2026-03-05T15:00'],
      ['מחר אחרי הצהריים', '2026-03-05T14:00'],
    ] as const) {
      const result = resolve(raw);
      expect(result.ok, raw).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.value.startLocal, raw).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Cross-locale ambiguity, across every kind of disagreement
// ---------------------------------------------------------------------------

/**
 * A synthetic locale with nothing in it. Each case below fills in exactly one
 * field, so the disagreement under test is the only thing that differs.
 *
 * Its own vocabulary is invented (`klo`, `fum`) so it cannot collide with a
 * real locale by accident.
 */
const EMPTY_SYNTHETIC: LocaleLexicon = {
  locale: 'xx',
  displayName: 'Synthetic (test only)',
  dayAnchors: [],
  weekdays: [],
  weekdayModifiers: [],
  dayParts: [],
  namedTimes: [],
  clockPrefixes: [{ forms: ['klo'], attaches: false }],
  clockSuffixes: [],
  meridiems: [],
  relativeOffset: {
    prefixes: ['fum'],
    softeners: [],
    prefixRequired: true,
    quantities: [],
    units: [],
    fixedDurations: [],
  },
  carriers: [],
  vaguenessMarkers: [],
  periodTokens: [],
};

interface AmbiguityCase {
  readonly key: string;
  /** What kind of thing the two locales disagree about. */
  readonly kind: string;
  readonly phrase: string;
  /** The token they disagree on. The refusal must quote it. */
  readonly token: string;
  /** A locale that reads `token` DIFFERENTLY from a registered one. */
  readonly disagrees: LocaleLexicon;
  /** A locale that reads `token` exactly as the registered one does. */
  readonly agrees: LocaleLexicon;
}

const AMBIGUITY_CASES: readonly AmbiguityCase[] = [
  {
    key: 'a1-day-anchor',
    kind: 'the same word naming a DIFFERENT DAY',
    phrase: 'tomorrow at 3pm',
    token: 'tomorrow',
    disagrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xd',
      displayName: 'Off-by-one (test only)',
      dayAnchors: [{ forms: ['tomorrow'], label: 'day_after_tomorrow', kind: 'RELATIVE_DAY', offsetDays: 2 }],
    },
    agrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xa',
      displayName: 'Agreeing (test only)',
      dayAnchors: [{ forms: ['tomorrow'], label: 'tomorrow', kind: 'RELATIVE_DAY', offsetDays: 1 }],
    },
  },
  {
    key: 'a2-kind-versus-kind',
    kind: 'a DAY in one language and a TIME OF DAY in the other',
    phrase: 'tomorrow afternoon',
    token: 'afternoon',
    disagrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xk',
      displayName: 'Cross-kind (test only)',
      dayAnchors: [{ forms: ['afternoon'], label: 'today', kind: 'RELATIVE_DAY', offsetDays: 0 }],
    },
    agrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xj',
      displayName: 'Same-kind (test only)',
      dayParts: [{ forms: ['afternoon'], dayPart: 'afternoon', impliesToday: false }],
    },
  },
  {
    key: 'a3-weekday',
    kind: 'a DIFFERENT WEEKDAY',
    phrase: 'friday at 3pm',
    token: 'friday',
    disagrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xw',
      displayName: 'Wrong-weekday (test only)',
      weekdays: [{ forms: ['friday'], isoWeekday: 1 }],
    },
    agrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xv',
      displayName: 'Right-weekday (test only)',
      weekdays: [{ forms: ['friday'], isoWeekday: 5 }],
    },
  },
  {
    key: 'a4-day-part',
    kind: 'a DIFFERENT PART OF THE DAY',
    phrase: 'tomorrow morning',
    token: 'morning',
    disagrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xp',
      displayName: 'Wrong-daypart (test only)',
      dayParts: [{ forms: ['morning'], dayPart: 'evening', impliesToday: false }],
    },
    agrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xo',
      displayName: 'Right-daypart (test only)',
      dayParts: [{ forms: ['morning'], dayPart: 'morning', impliesToday: false }],
    },
  },
  {
    key: 'a5-named-time',
    kind: 'a DIFFERENT NAMED HOUR - twelve hours apart',
    phrase: 'tomorrow at noon',
    token: 'noon',
    disagrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xn',
      displayName: 'Midnight-noon (test only)',
      namedTimes: [{ forms: ['noon'], hour: 0, minute: 0 }],
    },
    agrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xm',
      displayName: 'Same-noon (test only)',
      namedTimes: [{ forms: ['noon'], hour: 12, minute: 0 }],
    },
  },
  {
    key: 'a6-offset-unit',
    kind: 'a DIFFERENT UNIT for a relative offset',
    phrase: 'in 3 hours',
    token: 'hours',
    disagrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xu',
      displayName: 'Hours-are-days (test only)',
      relativeOffset: {
        ...EMPTY_SYNTHETIC.relativeOffset,
        units: [{ forms: ['hours'], unit: 'day' }],
      },
    },
    agrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xt',
      displayName: 'Hours-are-hours (test only)',
      relativeOffset: {
        ...EMPTY_SYNTHETIC.relativeOffset,
        units: [{ forms: ['hours'], unit: 'hour' }],
      },
    },
  },
  {
    key: 'a7-offset-quantity',
    kind: 'a DIFFERENT QUANTITY',
    phrase: 'in two hours',
    token: 'two',
    disagrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xq',
      displayName: 'Two-is-three (test only)',
      relativeOffset: {
        ...EMPTY_SYNTHETIC.relativeOffset,
        quantities: [{ forms: ['two'], value: 3 }],
      },
    },
    agrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xr',
      displayName: 'Two-is-two (test only)',
      relativeOffset: {
        ...EMPTY_SYNTHETIC.relativeOffset,
        quantities: [{ forms: ['two'], value: 2 }],
      },
    },
  },
  {
    key: 'a8-hebrew-token',
    kind: 'a HEBREW token a third locale reads differently',
    phrase: 'מחר ב-15:00',
    token: 'מחר',
    disagrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xh',
      displayName: 'Hebrew-disagreeing (test only)',
      dayAnchors: [{ forms: ['מחר'], label: 'today', kind: 'RELATIVE_DAY', offsetDays: 0 }],
    },
    agrees: {
      ...EMPTY_SYNTHETIC,
      locale: 'xg',
      displayName: 'Hebrew-agreeing (test only)',
      dayAnchors: [{ forms: ['מחר'], label: 'tomorrow', kind: 'RELATIVE_DAY', offsetDays: 1 }],
    },
  },
];

describe('a genuinely cross-locale-ambiguous phrase refuses', () => {
  it.each(AMBIGUITY_CASES)('$key: $kind', (ambiguity) => {
    const parsed = parse(ambiguity.phrase, [EN_LEXICON, HE_LEXICON, ambiguity.disagrees]);

    expect(parsed.ok, `"${ambiguity.phrase}" is ambiguous (${ambiguity.kind}) and must refuse`).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.reason).toMatch(/ambiguous across the languages/);
    expect(parsed.reason, 'the refusal must quote the disputed token').toContain(ambiguity.token);
    expect(parsed.reason, 'and must name the disagreeing locale, so a reader knows who to ask').toContain(
      ambiguity.disagrees.displayName,
    );

    // The property that matters: an ambiguity is not an excuse to pick one.
    expect(parsed.interpretation.dayAnchor).not.toBe('implicit_today');
    expect(parsed.interpretation.matched).not.toContain('implicit_today');
    expect(parsed.interpretation.matched, 'nothing may be consumed before the ambiguity is reported').toEqual([]);
  });

  it.each(AMBIGUITY_CASES)('$key: CONTROL - agreement is not ambiguity', (ambiguity) => {
    // A registry rule that refused whenever two locales claimed a token would
    // make the registry unusable the moment a second locale existed.
    const parsed = parse(ambiguity.phrase, [EN_LEXICON, HE_LEXICON, ambiguity.agrees]);
    expect(
      parsed.ok,
      `"${ambiguity.phrase}" must still resolve when the third locale AGREES about "${ambiguity.token}"`,
    ).toBe(true);
  });

  it.each(AMBIGUITY_CASES)('$key: CONTROL - the phrase resolves with the real registry', (ambiguity) => {
    // And the disagreement is caused by the synthetic locale, not by the
    // phrase being broken in the first place.
    expect(parse(ambiguity.phrase).ok, ambiguity.phrase).toBe(true);
  });

  it('covers every kind of disagreement the rule distinguishes', () => {
    const kinds = AMBIGUITY_CASES.map((ambiguity) => ambiguity.kind).join(' | ');
    for (const required of ['DIFFERENT DAY', 'TIME OF DAY', 'WEEKDAY', 'PART OF THE DAY', 'NAMED HOUR', 'UNIT', 'QUANTITY']) {
      expect(kinds, `no ambiguity case covers ${required}`).toContain(required);
    }
  });

  it('does not fire for the two locales that are actually registered', () => {
    // `en` and `he` use disjoint scripts, so nothing real triggers the rule
    // today. That is a fact about this registry, not about the rule - which is
    // exactly why every case above uses a synthetic locale.
    for (const phrase of [
      'tomorrow at 3pm',
      'מחר ב-15:00',
      'call me back מחר ב-16:00',
      'מחר at 3pm',
      'יום חמישי ב-15:00',
      'בעוד שעתיים',
    ]) {
      expect(parse(phrase).ok, phrase).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The one property that ties the whole file together
// ---------------------------------------------------------------------------

describe('nothing in this file can ever become "the contact meant today"', () => {
  it('no refused phrase produces an implicit-today anchor, under either registry', () => {
    const everyRefusal: { raw: string; lexicons?: readonly LocaleLexicon[] }[] = [
      ...UNKNOWN_LANGUAGE_CASES.map((unknown) => ({ raw: unknown.when })),
      { raw: 'غدا ١٥:٠٠' },
      { raw: 'מחר ב-15:00 blorp' },
      { raw: 'tomorrow at 15:00 blorp' },
      { raw: 'מחר אחרי הצהריים, בשתיים' },
      ...AMBIGUITY_CASES.map((ambiguity) => ({
        raw: ambiguity.phrase,
        lexicons: [EN_LEXICON, HE_LEXICON, ambiguity.disagrees] as readonly LocaleLexicon[],
      })),
    ];

    const fellThrough = everyRefusal.filter((candidate) => {
      const parsed = parse(candidate.raw, candidate.lexicons);
      return parsed.ok || parsed.interpretation.matched.includes('implicit_today');
    });

    expect(
      fellThrough.map((candidate) => candidate.raw),
      'a phrase the grammar could not read has become a booking. This is the § 8.3 defect.',
    ).toEqual([]);
    expect(everyRefusal.length, 'the list must not be empty, or this asserts nothing').toBeGreaterThan(20);
  });

  it('implicit-today still works where it is CORRECT, so the guard is not a blanket ban', () => {
    // `at 9am` names a time and no day. Every token is accounted for, so today
    // is the right reading and it must survive.
    const parsed = parse('at 9am');
    expect(parsed.ok).toBe(true);
    expect(parsed.interpretation.dayAnchor).toBe('implicit_today');
    expect(parsed.interpretation.leftover).toEqual([]);

    const result = resolve('at 9am');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // Today, on the contact's clock, and deliberately NOT rolled forward:
    // 09:00 Jerusalem is an hour before `now`, and the grammar leaves that for
    // `SchedulingValidator`'s `in_the_future` check to refuse with a precise
    // code rather than guessing that the contact meant tomorrow.
    expect(result.value.startLocal).toBe(`${THE_DAY_THE_BROKEN_RESOLVER_PICKED}T09:00`);
    expect(result.value.interpretation.dayAnchor).toBe('implicit_today');
  });
});
