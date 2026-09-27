/**
 * The Hebrew lexicon.
 *
 * WHERE THESE STRINGS CAME FROM
 * ---------------------------------------------------------------------------
 * Hebrew is easy to get subtly wrong by retyping it, so the forms below are
 * taken from this repository's own files or built out of the patterns those
 * files already demonstrate:
 *
 *   מחר, ב-15:00, יום חמישי, אחרי הצהריים, בשתיים, שבוע הבא
 *                                    - src/eval/corpus/scenarios.he.ts,
 *                                      tests/e2e/hebrewDigitClockTime.test.ts,
 *                                      FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md
 *                                      §§ 6.2 and 8.3
 *   היום, הבוקר, תתקשר, אליי, בוא, נגיד, נקבע, נדבר, אולי, תודה, אז,
 *   אוקיי, סבבה, מעולה
 *                                    - the same three sources
 *
 * The rest are the regular morphological variants of those: the ב- prefix
 * shown by ב-15:00 and בשתיים, the ה- prefix shown by הבוקר and הצהריים, the
 * יום X weekday frame shown by יום חמישי, and the -יים DUAL ending shown by
 * הצהריים and שתיים.
 *
 * THE DUAL, AND WHY IT NEEDED A FIELD OF ITS OWN
 * ---------------------------------------------------------------------------
 * Hebrew does not say "two hours" as a number plus a unit. It says שעתיים -
 * one word, no separable quantity. An offset rule shaped as
 * `<prefix><quantity><unit>`, which is what the English-only grammar was,
 * cannot express that at all. `FixedDurationEntry` is what makes שעתיים,
 * יומיים and שבועיים declarable, and it is the same field that carries
 * English's `half an hour`.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * ---------------------------------------------------------------------------
 *  - HOURS SPELLED OUT IN WORDS. בשתיים ("at two") is not a clock time in this
 *    lexicon, so `מחר אחרי הצהריים, בשתיים` resolves מחר and אחרי הצהריים and
 *    then REFUSES, naming בשתיים as the word it could not account for. That is
 *    the fail-closed rule working, not a gap being papered over: guessing that
 *    שתיים means 14:00 rather than 02:00 is exactly the kind of guess this
 *    grammar exists to refuse. Digit clock times are the required coverage and
 *    they are complete.
 *  - שני as a quantity word. It means both "two (of)" and "Monday", and the
 *    idiomatic Hebrew for "in two days" is the dual יומיים, which IS here. A
 *    form that is a weekday in one reading and a number in another is the sort
 *    of thing that should refuse rather than resolve.
 *  - Any weekday POLICY. Israeli working days differ from the seeded
 *    Monday-to-Friday business-hours policy. That is a configuration matter and
 *    is explicitly out of scope for this change; סוף השבוע therefore resolves
 *    through the same locale-agnostic end-of-ISO-week rule English uses, and
 *    the business-hours check then has its own say. See `docs/DECISIONS.md`
 *    § 9.
 */
import type { LocaleLexicon } from './types.js';

export const HE_LEXICON: LocaleLexicon = {
  locale: 'he',
  displayName: 'Hebrew',

  dayAnchors: [
    { forms: ['מחרתיים'], label: 'day_after_tomorrow', kind: 'RELATIVE_DAY', offsetDays: 2 },
    { forms: ['מחר', 'למחר'], label: 'tomorrow', kind: 'RELATIVE_DAY', offsetDays: 1 },
    { forms: ['היום'], label: 'today', kind: 'RELATIVE_DAY', offsetDays: 0 },
    { forms: ['סוף השבוע', 'בסוף השבוע', 'סוף שבוע'], label: 'end_of_week', kind: 'END_OF_WEEK' },
  ],

  /**
   * Weekday names, each in three shapes: the full יום X frame, the same frame
   * with the ב- preposition (ביום X, "on X"), and the bare ordinal.
   *
   * `isoWeekday` is Luxon's numbering, 1 = Monday .. 7 = Sunday, so the Hebrew
   * week that starts on Sunday maps onto it explicitly rather than by an offset
   * somebody has to remember.
   */
  weekdays: [
    { forms: ['יום ראשון', 'ביום ראשון', 'ראשון'], isoWeekday: 7 },
    { forms: ['יום שני', 'ביום שני', 'שני'], isoWeekday: 1 },
    { forms: ['יום שלישי', 'ביום שלישי', 'שלישי'], isoWeekday: 2 },
    { forms: ['יום רביעי', 'ביום רביעי', 'רביעי'], isoWeekday: 3 },
    { forms: ['יום חמישי', 'ביום חמישי', 'חמישי'], isoWeekday: 4 },
    { forms: ['יום שישי', 'ביום שישי', 'שישי'], isoWeekday: 5 },
    { forms: ['יום שבת', 'ביום שבת', 'בשבת', 'שבת'], isoWeekday: 6 },
  ],

  // Hebrew puts the modifier AFTER the weekday - יום חמישי הבא - which is why
  // `position` is data rather than an assumption baked into the resolver.
  weekdayModifiers: [
    { forms: ['הבא', 'הבאה'], kind: 'NEXT', position: 'AFTER' },
    { forms: ['הקרוב', 'הקרובה'], kind: 'THIS', position: 'AFTER' },
  ],

  dayParts: [
    { forms: ['בבוקר', 'הבוקר', 'בוקר', 'לפני הצהריים'], dayPart: 'morning', impliesToday: false },
    { forms: ['אחרי הצהריים', 'אחר הצהריים'], dayPart: 'afternoon', impliesToday: false },
    { forms: ['בערב', 'ערב'], dayPart: 'evening', impliesToday: false },
    // הערב is "this evening" - a day part AND today, exactly like `tonight`.
    { forms: ['הערב'], dayPart: 'evening', impliesToday: true, impliesTodayLabel: 'tonight' },
  ],

  // Listed after the day parts so it is obvious that אחרי הצהריים (afternoon,
  // two tokens) must not be read as הצהריים (noon, one token). The engine
  // always prefers the longest form at a position, and the day-part rule runs
  // first, so both defences are in place.
  namedTimes: [
    { forms: ['בצהריים', 'הצהריים', 'צהריים'], hour: 12, minute: 0 },
    { forms: ['בחצות', 'חצות'], hour: 0, minute: 0 },
  ],

  /**
   * ב is the preposition an Israeli contact actually uses for a clock time, and
   * it is written four ways: ב-15:00, ב־15:00 (maqaf, normalised to a hyphen
   * by `normalizeScript`), ב15:00 and ב 15:00. Declaring it as an ATTACHING
   * prefix with `''` and `'-'` as separators covers all four.
   */
  clockPrefixes: [
    { forms: ['ב', 'ל'], attaches: true, attachedSeparators: ['', '-'] },
    // The same two prepositions again, declared as standalone, because
    // `מחר ב 15:00` - with a space - is written that way too and must not be
    // the one spelling that fails closed.
    { forms: ['ב', 'ל'], attaches: false },
    { forms: ['בשעה', 'בסביבות', 'בערך', 'סביב'], attaches: false },
  ],

  clockSuffixes: [],

  // Hebrew writes clock times on a 24-hour clock, so there is no am/pm to
  // declare. An hour of 1..11 with no day part is therefore refused for exactly
  // the same reason it is in English, by exactly the same code.
  meridiems: [],

  relativeOffset: {
    prefixes: ['בעוד', 'עוד'],
    softeners: ['בערך', 'בסביבות'],
    prefixRequired: true,
    quantities: [
      { forms: ['אחת', 'אחד'], value: 1 },
      { forms: ['שתיים', 'שתי', 'שניים'], value: 2 },
      { forms: ['שלוש', 'שלושה'], value: 3 },
      { forms: ['ארבע', 'ארבעה'], value: 4 },
      { forms: ['חמש', 'חמישה'], value: 5 },
      { forms: ['שש', 'שישה'], value: 6 },
      { forms: ['שבע', 'שבעה'], value: 7 },
      { forms: ['שמונה'], value: 8 },
      { forms: ['תשע', 'תשעה'], value: 9 },
      { forms: ['עשר', 'עשרה'], value: 10 },
    ],
    units: [
      { forms: ['דקות', 'דקה'], unit: 'minute' },
      { forms: ['שעות', 'שעה'], unit: 'hour' },
      { forms: ['ימים', 'יום'], unit: 'day' },
      { forms: ['שבועות', 'שבוע'], unit: 'week' },
    ],
    fixedDurations: [
      // The DUAL: one word, two of the unit, no quantity to parse out.
      { forms: ['שעתיים'], value: 2, unit: 'hour', prefixOptional: false },
      { forms: ['יומיים'], value: 2, unit: 'day', prefixOptional: false },
      { forms: ['שבועיים'], value: 2, unit: 'week', prefixOptional: false },
      // The half-hour form, the direct counterpart of English `half an hour`
      // and allowed to stand on its own for the same reason.
      { forms: ['חצי שעה'], value: 30, unit: 'minute', prefixOptional: true },
      // A bare unit after בעוד means one of it - בעוד שעה, "in an hour".
      { forms: ['דקה'], value: 1, unit: 'minute', prefixOptional: false },
      { forms: ['שעה'], value: 1, unit: 'hour', prefixOptional: false },
      { forms: ['יום'], value: 1, unit: 'day', prefixOptional: false },
      { forms: ['שבוע'], value: 1, unit: 'week', prefixOptional: false },
    ],
  },

  /**
   * Words Hebrew PERMITS around a scheduling phrase and discards on purpose -
   * the imperative "call me", the "let's say" opener, and ordinary politeness.
   *
   * Kept short on the same principle as the English list: a carrier list that
   * grows to cover any sentence is a fail-open rule with extra steps.
   */
  carriers: [
    'תתקשר',
    'תתקשרי',
    'תתקשרו',
    'אליי',
    'אלי',
    'לי',
    'לנו',
    'בוא',
    'בואי',
    'בואו',
    'נגיד',
    'נקבע',
    'נדבר',
    'בבקשה',
    'תודה',
    'אז',
    'אוקיי',
    'סבבה',
    'מעולה',
  ],

  vaguenessMarkers: ['מתישהו', 'בקרוב', 'אולי', 'מאוחר יותר', 'אחר כך', 'בהזדמנות'],

  periodTokens: [
    'שבוע',
    'השבוע',
    'שבועות',
    'חודש',
    'החודש',
    'חודשים',
    'שנה',
    'השנה',
    'שנים',
    'רבעון',
    'הרבעון',
  ],
};
