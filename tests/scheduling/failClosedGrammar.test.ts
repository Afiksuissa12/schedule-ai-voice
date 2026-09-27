/**
 * The fail-closed rule, the carrier design, and the locale registry.
 *
 * WHAT IS BEING PROVED HERE
 * ---------------------------------------------------------------------------
 * `tests/scheduling/hebrewGrammar.test.ts` proves the grammar now understands
 * Hebrew. This file proves the more important half: that it refuses everything
 * it does NOT understand, in languages it will never learn, and that it does so
 * because of a general rule rather than because somebody added an alphabet to a
 * list.
 *
 * Teaching the resolver Hebrew fixes one language. Failing closed fixes every
 * other one at the same time, and it is the part that would still be right if
 * this product were sold in Warsaw tomorrow.
 *
 * `now` is Wednesday 2026-03-04, 10:00 Asia/Jerusalem - the instant § 8.3
 * reproduced the defect at, so "the day the broken resolver picked" is
 * 2026-03-04 and every wrong answer is recognisable on sight.
 */
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../src/ports/clock.js';
import { DateTimeResolver } from '../../src/scheduling/dateTimeResolver.js';
import { EN_LEXICON, HE_LEXICON, REGISTERED_LEXICONS } from '../../src/scheduling/lexicon/index.js';
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

// ---------------------------------------------------------------------------
// 1. Fail closed, in languages this grammar does not know and never will
// ---------------------------------------------------------------------------

describe('a digit clock time in an unknown language', () => {
  /**
   * Each of these is "tomorrow at 15:00" in a language no lexicon is
   * registered for, carrying the one thing the old grammar COULD read: digits.
   * Every one of them used to resolve to 2026-03-04 with `ok: true`.
   */
  const UNKNOWN_LANGUAGE_PHRASES: readonly { language: string; when: string; dayWord: string }[] = [
    { language: 'Arabic', when: 'غدا في 15:00', dayWord: 'غدا' },
    { language: 'Russian', when: 'завтра в 15:00', dayWord: 'завтра' },
    { language: 'French', when: 'demain à 15:00', dayWord: 'demain' },
  ];

  it.each(UNKNOWN_LANGUAGE_PHRASES)('refuses the $language phrase rather than resolving it', ({ when }) => {
    const result = resolve(when);

    expect(result.ok, `"${when}" must not resolve`).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('INVALID_FORMAT');
  });

  it.each(UNKNOWN_LANGUAGE_PHRASES)('names the leftover word in the $language refusal', ({ when, dayWord }) => {
    const result = resolve(when);
    if (result.ok) throw new Error('unreachable');

    // A refusal that does not say WHICH word it could not read is a refusal
    // nobody can act on - not the contact, not the model, not an auditor.
    expect(result.reason).toContain(dayWord);
    expect(result.reason).toMatch(/could not account for/);
  });

  it.each(UNKNOWN_LANGUAGE_PHRASES)('never reaches the implicit-today branch for $language', ({ when }) => {
    const parsed = parse(when);
    if (parsed.ok) throw new Error(`"${when}" must not resolve`);

    // THE defect, stated as a property. A day word that was thrown away must
    // never be able to turn into "the contact meant today".
    expect(parsed.interpretation.dayAnchor).not.toBe('implicit_today');
    expect(parsed.interpretation.matched).not.toContain('implicit_today');
  });

  it('refuses because of the general rule, not because these alphabets are listed', () => {
    // The proof is that the SAME branch refuses invented words in the Latin
    // alphabet. Nothing in the code names a script.
    const invented = resolve('qqzzx wibble flurm at 15:00');
    expect(invented.ok).toBe(false);
    if (invented.ok) throw new Error('unreachable');
    expect(invented.reason).toContain('qqzzx wibble flurm');

    const sources = [...REGISTERED_LEXICONS.map((lexicon) => lexicon.locale)];
    expect(sources).toEqual(['en', 'he']);
  });

  it('refuses digits this grammar has never been shown, rather than guessing at them', () => {
    // Arabic-Indic digits are deliberately NOT normalised: inventing an
    // untested digit rule would be the same class of mistake as the one being
    // fixed. It fails closed instead.
    const result = resolve('غدا ١٥:٠٠');
    expect(result.ok).toBe(false);
  });
});

describe('the leftover safety nets that already existed keep their own reasons', () => {
  const refusalFor = (raw: string): string => {
    const result = resolve(raw);
    if (result.ok) throw new Error(`expected "${raw}" to be refused`);
    return result.reason;
  };

  it('still reports a leftover NUMBER as a number, not as an unknown word', () => {
    expect(refusalFor('tomorrow at 3pm on the 15th')).toMatch(/could not interpret/);
  });

  it('still reports a leftover PERIOD as a period', () => {
    expect(refusalFor('next week')).toMatch(/names a period rather than a moment/);
    expect(refusalFor('שבוע הבא')).toMatch(/names a period rather than a moment/);
  });

  it('still refuses vague intent with the vagueness reason', () => {
    expect(refusalFor('call me back sometime tomorrow')).toMatch(/too vague to schedule/);
  });

  it('still refuses a contradiction with the contradiction reason', () => {
    expect(refusalFor('tomorrow in two hours')).toMatch(/mixes a relative offset/);
    expect(refusalFor('tomorrow morning at 3pm')).toMatch(/not in the morning/);
  });

  it('still refuses gibberish, which is the floor of the grammar', () => {
    expect(refusalFor('qqzzx wibble flurm')).toContain('qqzzx wibble flurm');
  });
});

// ---------------------------------------------------------------------------
// 2. Carriers: discarded by a rule, not by omission
// ---------------------------------------------------------------------------

describe('carrier tokens', () => {
  it('lets the accepted English phrasing keep working, unchanged', () => {
    const result = resolve('call me back tomorrow afternoon at 3');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.startLocal).toBe('2026-03-05T15:00');
  });

  it('RECORDS each one rather than dropping it silently', () => {
    const parsed = parse('call me back tomorrow afternoon at 3');
    if (!parsed.ok) throw new Error('unreachable');

    // This is the distinction the whole change is built on: a token discarded
    // by a rule somebody wrote down leaves a trace; a token discarded because
    // nobody looked at it is what booked the wrong day.
    expect(parsed.interpretation.carriers).toEqual(['call', 'me', 'back']);
    expect(parsed.interpretation.matched).toContain('carrier:en:call');
    expect(parsed.interpretation.lexicon).toContainEqual({
      rule: 'carrier',
      locale: 'en',
      form: 'back',
      text: 'back',
    });
  });

  it('leaves nothing unaccounted for on a phrase that resolves', () => {
    for (const phrase of ['call me back tomorrow afternoon at 3', 'תתקשר אליי מחר ב-15:00', 'at 9am']) {
      const parsed = parse(phrase);
      expect(parsed.ok, phrase).toBe(true);
      expect(parsed.interpretation.leftover, phrase).toEqual([]);
    }
  });

  it('never lets a carrier shadow a real match', () => {
    // `a` is a declared English carrier AND the quantity word in "in a couple
    // of hours". Carriers are consumed last, so the offset rule gets it first.
    const parsed = parse('in a couple of hours');
    if (!parsed.ok) throw new Error('unreachable');
    expect(parsed.interpretation.matched).toContain('relative_offset:2_hours');
    expect(parsed.interpretation.carriers).toEqual([]);
  });

  it('still refuses a phrase made only of carriers, because it names no time', () => {
    const parsed = parse('call me back please');
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.interpretation.leftover).toEqual([]);
    expect(parsed.reason).toMatch(/does not name a day or a time/);
  });
});

describe('the implicit-today branch', () => {
  it('still applies when the whole phrase was consumed', () => {
    const parsed = parse('at 9am');
    if (!parsed.ok) throw new Error('unreachable');
    expect(parsed.interpretation.dayAnchor).toBe('implicit_today');
  });

  it('is unreachable whenever anything at all was left over', () => {
    // Belt and braces: the leftover rule refuses first, and the branch itself
    // is guarded, so the guarantee is stated where the decision is made.
    for (const phrase of ['מחר ב-15:00 blorp', 'غدا في 15:00', 'zzz at 15:00']) {
      const parsed = parse(phrase);
      expect(parsed.ok, phrase).toBe(false);
      expect(parsed.interpretation.matched, phrase).not.toContain('implicit_today');
    }
  });

  it('commits to no instant at all, where it used to commit to the wrong day', () => {
    const result = resolve('غدا في 15:00');
    expect(result.ok).toBe(false);

    // Nothing to persist, so nothing to dial. The receipt still explains
    // itself: the failed check is the parse, and the leftover is named.
    expect(result.provenance.resolvedStartUtc).toBeUndefined();
    expect(result.provenance.resolvedEndUtc).toBeUndefined();
    expect(result.provenance.checks.at(-1)).toMatchObject({ name: 'parse_proposed_value', passed: false });
    expect(result.provenance.notes?.['interpretation']).toMatchObject({ leftover: ['غدا', 'في'] });

    // And `nowUtc` is the only place the old wrong day appears anywhere.
    expect(result.provenance.nowUtc).toContain(THE_DAY_THE_BROKEN_RESOLVER_PICKED);
  });
});

// ---------------------------------------------------------------------------
// 3. The registry: a third locale, and the cross-locale ambiguity rule
// ---------------------------------------------------------------------------

/**
 * A synthetic third locale, with invented words so it cannot collide with a
 * real one by accident.
 *
 * It exists to prove a claim that would otherwise be untestable until a third
 * real language arrived: that adding a locale is adding DATA, and that
 * `naturalLanguage.ts` needs no edit to understand it.
 */
const INVENTED_BASE: LocaleLexicon = {
  locale: 'xx',
  displayName: 'Invented (test only)',
  dayAnchors: [{ forms: ['zolra'], label: 'tomorrow', kind: 'RELATIVE_DAY', offsetDays: 1 }],
  weekdays: [{ forms: ['quorda'], isoWeekday: 4 }],
  weekdayModifiers: [],
  dayParts: [{ forms: ['vesper'], dayPart: 'evening', impliesToday: false }],
  namedTimes: [],
  clockPrefixes: [{ forms: ['klo'], attaches: false }],
  clockSuffixes: [],
  meridiems: [],
  relativeOffset: {
    prefixes: ['fum'],
    softeners: [],
    prefixRequired: true,
    quantities: [{ forms: ['dua'], value: 2 }],
    units: [{ forms: ['horan'], unit: 'hour' }],
    fixedDurations: [],
  },
  carriers: ['plim'],
  vaguenessMarkers: ['gloop'],
  periodTokens: ['sennik'],
};

describe('the resolver is locale-agnostic', () => {
  const withInvented = [EN_LEXICON, HE_LEXICON, INVENTED_BASE];

  it('understands a locale it has never been compiled against, with no resolver change', () => {
    const parsed = parse('plim zolra klo 15:00', withInvented);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.kind !== 'LOCAL_WALL_TIME') throw new Error('unreachable');

    expect(parsed.target).toMatchObject({ year: 2026, month: 3, day: 5, hour: 15, minute: 0 });
    expect(parsed.interpretation.locales).toEqual(['xx']);
    expect(parsed.interpretation.carriers).toEqual(['plim']);
  });

  it('applies every rule to it - weekdays, day parts, offsets, vagueness, periods', () => {
    const weekday = parse('quorda klo 15:00', withInvented);
    expect(weekday.ok && weekday.kind === 'LOCAL_WALL_TIME' && weekday.target.day).toBe(5);

    const dayPart = parse('zolra vesper', withInvented);
    expect(dayPart.ok && dayPart.kind === 'LOCAL_WALL_TIME' && dayPart.target.hour).toBe(18);

    const offset = parse('fum dua horan', withInvented);
    expect(offset.ok && offset.kind).toBe('ELAPSED_FROM_NOW');

    const vague = parse('gloop zolra', withInvented);
    expect(vague.ok).toBe(false);
    if (!vague.ok) expect(vague.reason).toMatch(/too vague/);

    const period = parse('sennik', withInvented);
    expect(period.ok).toBe(false);
    if (!period.ok) expect(period.reason).toMatch(/names a period/);
  });

  it('leaves the registered locales behaving exactly as they did', () => {
    const english = parse('call me back tomorrow afternoon at 3', withInvented);
    const hebrew = parse('מחר ב-15:00', withInvented);
    expect(english.ok && english.kind === 'LOCAL_WALL_TIME' && english.target.hour).toBe(15);
    expect(hebrew.ok && hebrew.kind === 'LOCAL_WALL_TIME' && hebrew.target.day).toBe(5);
  });
});

describe('cross-locale ambiguity', () => {
  /** Reads `tomorrow` as the day after tomorrow. A genuine disagreement. */
  const DISAGREES_ON_THE_DAY: LocaleLexicon = {
    ...INVENTED_BASE,
    locale: 'xd',
    displayName: 'Disagreeing (test only)',
    dayAnchors: [{ forms: ['tomorrow'], label: 'day_after_tomorrow', kind: 'RELATIVE_DAY', offsetDays: 2 }],
  };

  /** Reads `tomorrow` exactly as English does. Agreement, not ambiguity. */
  const AGREES_ON_THE_DAY: LocaleLexicon = {
    ...INVENTED_BASE,
    locale: 'xa',
    displayName: 'Agreeing (test only)',
    dayAnchors: [{ forms: ['tomorrow'], label: 'tomorrow', kind: 'RELATIVE_DAY', offsetDays: 1 }],
  };

  /** Reads `afternoon` as a DAY, where English reads it as a time of day. */
  const DISAGREES_ON_THE_KIND: LocaleLexicon = {
    ...INVENTED_BASE,
    locale: 'xk',
    displayName: 'Cross-kind (test only)',
    dayAnchors: [{ forms: ['afternoon'], label: 'today', kind: 'RELATIVE_DAY', offsetDays: 0 }],
  };

  it('REFUSES a token two locales would read as different days', () => {
    const parsed = parse('tomorrow at 3pm', [EN_LEXICON, HE_LEXICON, DISAGREES_ON_THE_DAY]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.reason).toMatch(/ambiguous across the languages/);
    expect(parsed.reason).toContain('tomorrow');
    expect(parsed.reason).toContain('English');
    expect(parsed.reason).toContain('Disagreeing (test only)');
  });

  it('REFUSES a token one locale reads as a day and another as a time of day', () => {
    const parsed = parse('tomorrow afternoon', [EN_LEXICON, HE_LEXICON, DISAGREES_ON_THE_KIND]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.reason).toMatch(/ambiguous across the languages/);
    expect(parsed.reason).toContain('afternoon');
  });

  it('does NOT treat agreement as ambiguity - the negative case', () => {
    // Two locales claiming the same token with the same meaning is not a
    // conflict, and refusing it would make the registry unusable.
    const parsed = parse('tomorrow at 3pm', [EN_LEXICON, HE_LEXICON, AGREES_ON_THE_DAY]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.kind !== 'LOCAL_WALL_TIME') throw new Error('unreachable');
    expect(parsed.target).toMatchObject({ year: 2026, month: 3, day: 5, hour: 15 });
    // Registry order breaks the tie, so the recorded form is English's.
    expect(parsed.interpretation.locales).toEqual(['en']);
  });

  it('does not fire for the two locales that are actually registered', () => {
    // `en` and `he` use disjoint scripts, so there is no token to disagree
    // about today. That is a fact about this registry, not about the rule -
    // which is why both sides are tested against a synthetic locale above.
    for (const phrase of ['tomorrow at 3pm', 'מחר ב-15:00', 'call me back מחר ב-16:00', 'מחר at 3pm']) {
      expect(parse(phrase).ok, phrase).toBe(true);
    }
  });
});
