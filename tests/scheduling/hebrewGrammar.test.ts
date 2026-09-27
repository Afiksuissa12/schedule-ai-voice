/**
 * The Hebrew half of the grammar, against the exact instant the defect was
 * reproduced at.
 *
 * `now` is Wednesday 2026-03-04, 10:00 Asia/Jerusalem (08:00Z) - the pinned
 * `now` of the Hebrew corpus, `tests/e2e/hebrewDigitClockTime.test.ts` and
 * `FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 8.3. So `מחר` is THURSDAY
 * 2026-03-05, and every expectation below can be checked by hand.
 *
 * The strings are the repository's own. `מחר`, `ב-15:00`, `יום חמישי`,
 * `אחרי הצהריים`, `בשתיים` and `שבוע הבא` are lifted from
 * `src/eval/corpus/scenarios.he.ts` and the Founder Review; the rest are the
 * regular variants of those, which is what `src/scheduling/lexicon/he.ts`
 * documents.
 *
 * A NOTE ON THE HOURS USED HERE
 * ---------------------------------------------------------------------------
 * Hebrew has no am/pm, and this grammar refuses an hour of 1..11 that nothing
 * settles - in EVERY language, by the same code, for the same reason: 09:00 and
 * 21:00 are twelve hours apart. So `מחר ב-9:00` refuses and `מחר ב-9:00 בבוקר`
 * resolves. That is the pre-existing English rule applying unchanged, not a
 * Hebrew gap, and it is exercised below rather than dodged.
 */
import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../src/ports/clock.js';
import { DateTimeResolver } from '../../src/scheduling/dateTimeResolver.js';
import { schedulingPolicy } from '../../src/scheduling/policy.js';

/** Wednesday 2026-03-04, 10:00 Asia/Jerusalem. */
const NOW_UTC = '2026-03-04T08:00:00.000Z';
const JERUSALEM = 'Asia/Jerusalem';

const resolver = new DateTimeResolver(new FixedClock(NOW_UTC));
const policy = schedulingPolicy({ defaultTimezone: JERUSALEM, defaultMeetingDurationMinutes: 30 });

function resolve(raw: string) {
  return resolver.resolve({ raw, timezone: JERUSALEM }, { policy });
}

/** The local wall-clock start, which is what the contact actually agreed to. */
function localOf(raw: string): string {
  const result = resolve(raw);
  if (!result.ok) {
    throw new Error(`expected "${raw}" to resolve, got ${result.code}: ${result.reason}`);
  }
  return result.value.startLocal;
}

function refused(raw: string) {
  const result = resolve(raw);
  expect(result.ok, `expected "${raw}" to be refused`).toBe(false);
  if (result.ok) throw new Error('unreachable');
  expect(result.code).toBe('INVALID_FORMAT');
  return result;
}

describe('Hebrew day anchors', () => {
  it('resolves today, tomorrow and the day after tomorrow', () => {
    expect(localOf('היום ב-15:00')).toBe('2026-03-04T15:00');
    expect(localOf('מחר ב-15:00')).toBe('2026-03-05T15:00');
    expect(localOf('מחרתיים ב-15:00')).toBe('2026-03-06T15:00');
  });

  it('resolves every spelling of "tomorrow at 15:00" to the same instant', () => {
    // THE DEFECT, in all of its shapes. Each of these used to resolve to
    // 2026-03-04 - today - with ok:true and every downstream check passing.
    const SPELLINGS = [
      'מחר ב-15:00', // hyphen
      'מחר ב־15:00', // U+05BE MAQAF
      'מחר ב15:00', // no separator
      'מחר ב 15:00', // separated by a space
      'מחר בשעה 15:00', // the word "at the hour"
      'למחר ב-15:00', // the ל- prefix on the day word
      'מָחָר ב-15:00', // with niqqud
      '‏מחר ב-15:00‎', // wrapped in bidi marks
    ];

    for (const spelling of SPELLINGS) {
      expect(localOf(spelling), spelling).toBe('2026-03-05T15:00');
    }
  });

  it('resolves the end of the week through the same rule English uses', () => {
    // Friday of the current ISO week. WHICH days the business works is policy,
    // and the business-hours check has its own say about that.
    expect(localOf('סוף השבוע ב-15:00')).toBe('2026-03-06T15:00');
    expect(localOf('בסוף השבוע ב-15:00')).toBe('2026-03-06T15:00');
  });
});

describe('Hebrew weekdays', () => {
  it('reads a bare weekday as the soonest FUTURE one, excluding today', () => {
    // now is Wednesday 2026-03-04, so יום רביעי means the NEXT Wednesday.
    expect(localOf('יום חמישי ב-15:00')).toBe('2026-03-05T15:00');
    expect(localOf('יום שישי ב-15:00')).toBe('2026-03-06T15:00');
    expect(localOf('יום ראשון ב-15:00')).toBe('2026-03-08T15:00');
    expect(localOf('יום שני ב-15:00')).toBe('2026-03-09T15:00');
    expect(localOf('יום שלישי ב-15:00')).toBe('2026-03-10T15:00');
    expect(localOf('יום רביעי ב-15:00')).toBe('2026-03-11T15:00');
    expect(localOf('שבת ב-15:00')).toBe('2026-03-07T15:00');
  });

  it('accepts the with-preposition forms', () => {
    expect(localOf('ביום חמישי ב-15:00')).toBe('2026-03-05T15:00');
    expect(localOf('ביום ראשון ב-15:00')).toBe('2026-03-08T15:00');
    expect(localOf('בשבת ב-15:00')).toBe('2026-03-07T15:00');
  });

  it('accepts the bare ordinal forms', () => {
    expect(localOf('חמישי ב-15:00')).toBe('2026-03-05T15:00');
    expect(localOf('ראשון ב-15:00')).toBe('2026-03-08T15:00');
  });

  it('reads the modifier that follows the weekday, which is where Hebrew puts it', () => {
    // English says `next thursday`; Hebrew says `יום חמישי הבא`. The lexicon
    // declares the position, so the arithmetic is the same code either way.
    expect(localOf('יום חמישי הבא ב-15:00')).toBe('2026-03-12T15:00');
    expect(localOf('יום חמישי הקרוב ב-15:00')).toBe('2026-03-05T15:00');
  });
});

describe('Hebrew day parts and named times', () => {
  it('uses the documented preferred hour when no clock time is given', () => {
    expect(localOf('מחר בבוקר')).toBe('2026-03-05T09:00');
    expect(localOf('מחר אחרי הצהריים')).toBe('2026-03-05T14:00');
    expect(localOf('מחר בערב')).toBe('2026-03-05T18:00');
  });

  it('treats הערב as this evening - a day part AND today, exactly like "tonight"', () => {
    expect(localOf('הערב')).toBe('2026-03-04T18:00');
    expect(localOf('הערב ב-20:00')).toBe('2026-03-04T20:00');
  });

  it('disambiguates a bare hour using the day part', () => {
    expect(localOf('מחר ב-9:00 בבוקר')).toBe('2026-03-05T09:00');
    expect(localOf('מחר אחרי הצהריים ב-3:00')).toBe('2026-03-05T15:00');
  });

  it('reads noon and midnight as named times, not as day parts', () => {
    expect(localOf('מחר בצהריים')).toBe('2026-03-05T12:00');
    expect(localOf('מחר בחצות')).toBe('2026-03-05T00:00');
  });

  it('never lets אחרי הצהריים (afternoon) collapse into הצהריים (noon)', () => {
    // The two-token day part must win over the one-token named time. If it did
    // not, "tomorrow afternoon" would silently become 12:00.
    expect(localOf('מחר אחרי הצהריים')).toBe('2026-03-05T14:00');
    expect(localOf('מחר לפני הצהריים')).toBe('2026-03-05T09:00');
  });
});

describe('Hebrew relative offsets', () => {
  it('resolves minutes, hours, days and weeks', () => {
    expect(localOf('בעוד 30 דקות')).toBe('2026-03-04T10:30');
    expect(localOf('בעוד 3 שעות')).toBe('2026-03-04T13:00');
    expect(localOf('בעוד 3 ימים')).toBe('2026-03-07T10:00');
    expect(localOf('בעוד 2 שבועות')).toBe('2026-03-18T10:00');
  });

  it('resolves the DUAL forms, which are one word with no separable quantity', () => {
    // שעתיים is "two hours". There is no `2` in it to parse out, which is why
    // a <prefix><quantity><unit> pattern could never have expressed it.
    expect(localOf('בעוד שעתיים')).toBe('2026-03-04T12:00');
    expect(localOf('בעוד יומיים')).toBe('2026-03-06T10:00');
    expect(localOf('בעוד שבועיים')).toBe('2026-03-18T10:00');
  });

  it('resolves the half-hour form, the counterpart of English "half an hour"', () => {
    expect(localOf('בעוד חצי שעה')).toBe('2026-03-04T10:30');
    expect(localOf('חצי שעה')).toBe('2026-03-04T10:30');
  });

  it('reads a bare unit after the preposition as one of it', () => {
    expect(localOf('בעוד שעה')).toBe('2026-03-04T11:00');
    expect(localOf('בעוד יום')).toBe('2026-03-05T10:00');
    expect(localOf('עוד 45 דקות')).toBe('2026-03-04T10:45');
  });

  it('reads the quantity written in Hebrew words', () => {
    expect(localOf('בעוד שלוש שעות')).toBe('2026-03-04T13:00');
    expect(localOf('בעוד עשר דקות')).toBe('2026-03-04T10:10');
  });
});

describe('Hebrew dates, and Hebrew mixed with English', () => {
  it('accepts an explicit calendar date with a Hebrew clock time', () => {
    expect(localOf('2026-04-17 ב-14:00')).toBe('2026-04-17T14:00');
  });

  it('refuses a date with no time, exactly as it does in English', () => {
    expect(refused('2026-04-17').reason).toMatch(/no time/);
  });

  it('resolves the code-switched shapes an Israeli business call actually uses', () => {
    expect(localOf('call me back מחר ב-16:00')).toBe('2026-03-05T16:00');
    expect(localOf('מחר at 3pm')).toBe('2026-03-05T15:00');
    expect(localOf('call me מחר at 15:00')).toBe('2026-03-05T15:00');
    expect(localOf('תתקשר אליי מחר ב-15:00')).toBe('2026-03-05T15:00');
    expect(localOf('בוא נקבע ל-15:00 מחר')).toBe('2026-03-05T15:00');
  });
});

describe('Hebrew refusals - the same rules, in the other language', () => {
  it('refuses an hour that nothing settles, because Hebrew has no am or pm either', () => {
    expect(refused('מחר ב-9:00').reason).toMatch(/09:00 or 21:00/);
  });

  it('refuses a period rather than a moment', () => {
    expect(refused('שבוע הבא').reason).toMatch(/period rather than a moment/);
    expect(refused('החודש הבא').reason).toMatch(/period rather than a moment/);
  });

  it('refuses vague intent even when other tokens would parse', () => {
    refused('תתקשר אליי מתישהו מחר');
    refused('תתקשר אליי בקרוב');
    refused('אולי מחר');
  });

  it('refuses a contradiction', () => {
    expect(refused('מחר בעוד שעתיים').reason).toMatch(/mixes a relative offset/);
  });

  it('refuses an hour spelled out in words, naming the word it could not read', () => {
    // `בשתיים` is "at two". This grammar covers digit clock times, not written
    // hours, and guessing that שתיים means 14:00 rather than 02:00 is exactly
    // the guess it exists to refuse. The refusal NAMES the word.
    const result = refused('מחר אחרי הצהריים, בשתיים');
    expect(result.reason).toContain('בשתיים');
    expect(result.reason).toMatch(/could not account for/);
  });
});

describe('Hebrew provenance', () => {
  it('names the locale whose lexicon understood the phrase', () => {
    const result = resolve('תתקשר אליי מחר ב-15:00');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    expect(result.value.interpretation.locales).toEqual(['he']);
    expect(result.value.interpretation.lexicon).toContainEqual({
      rule: 'day_anchor',
      locale: 'he',
      form: 'מחר',
      text: 'מחר',
    });
  });

  it('records BOTH locales for a code-switched phrase, in match order', () => {
    const result = resolve('call me back מחר ב-16:00');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    expect(result.value.interpretation.locales).toEqual(['he', 'en']);
    expect(result.value.interpretation.carriers).toEqual(['call', 'me', 'back']);
  });

  it('records the script normalisation that fired, in the receipt notes', () => {
    const result = resolve('מָחָר ב־15:00');
    expect(result.ok).toBe(true);
    const notes = result.provenance.notes?.['interpretation'] as { scriptNormalization?: string[] } | undefined;

    expect(notes?.scriptNormalization).toEqual(['strip_hebrew_marks', 'maqaf_to_hyphen']);
  });

  it('keeps the canonical, language-neutral day anchor label', () => {
    // `dayAnchor: 'tomorrow'` means the same thing in a receipt whether the
    // contact said `tomorrow` or `מחר`. The locale is recorded separately.
    const hebrew = resolve('מחר ב-15:00');
    const english = resolve('tomorrow at 15:00');
    expect(hebrew.ok && hebrew.value.interpretation.dayAnchor).toBe('tomorrow');
    expect(english.ok && english.value.interpretation.dayAnchor).toBe('tomorrow');
  });
});
