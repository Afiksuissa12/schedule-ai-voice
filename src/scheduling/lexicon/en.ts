/**
 * The English lexicon.
 *
 * PROVENANCE OF EVERY WORD IN THIS FILE
 * ---------------------------------------------------------------------------
 * Nothing here is new vocabulary. Every form is transcribed from the literals
 * that used to live inside `naturalLanguage.ts` - `WEEKDAY_NUMBERS`,
 * `NUMBER_WORDS`, `RELATIVE_OFFSET_RE`, `VAGUENESS_MARKERS`,
 * `LEFTOVER_BLOCKLIST_RE`, `TIME_RE`, the day-part and named-time alternations,
 * and the rewrite rules inside `normalize()`. The English behaviour of the
 * grammar is therefore preserved, and `tests/scheduling/naturalLanguage.test.ts`
 * passes unchanged.
 *
 * THE ONE GENUINELY NEW FIELD IS `carriers`, AND IT IS THE POINT
 * ---------------------------------------------------------------------------
 * `call me back tomorrow afternoon at 3` has always resolved, and three of its
 * words - `call`, `me`, `back` - have always been dropped on the floor. The old
 * grammar dropped them by NOT LOOKING: whatever survived its regexes was thrown
 * away unless it happened to contain a digit or one of five English period
 * words. That is the same mechanism that threw away `מחר` and booked the wrong
 * day (`docs/DECISIONS.md` § 9).
 *
 * The new rule is fail-closed: every token must be accounted for. So the words
 * English is allowed to ignore have to be WRITTEN DOWN, and ignoring one is a
 * recorded grammar event rather than an accident. That is what this list is.
 *
 * It is deliberately short. A carrier list that grows to cover any sentence is
 * a fail-open rule with extra steps; when in doubt the phrase should refuse and
 * the contact should be asked again.
 */
import type { LocaleLexicon } from './types.js';

export const EN_LEXICON: LocaleLexicon = {
  locale: 'en',
  displayName: 'English',

  dayAnchors: [
    // Longest first is not required - the engine always prefers the longest
    // match at a position - but `the day after tomorrow` is listed above
    // `tomorrow` anyway so a reader can see the trap being handled.
    {
      forms: ['the day after tomorrow', 'day after tomorrow'],
      label: 'day_after_tomorrow',
      kind: 'RELATIVE_DAY',
      offsetDays: 2,
    },
    { forms: ['tomorrow'], label: 'tomorrow', kind: 'RELATIVE_DAY', offsetDays: 1 },
    { forms: ['today'], label: 'today', kind: 'RELATIVE_DAY', offsetDays: 0 },
    {
      forms: ['end of the week', 'end of the business week', 'end of week', 'end of business week'],
      label: 'end_of_week',
      kind: 'END_OF_WEEK',
    },
  ],

  weekdays: [
    { forms: ['monday', 'mondays', 'mon'], isoWeekday: 1 },
    { forms: ['tuesday', 'tuesdays', 'tues', 'tue'], isoWeekday: 2 },
    { forms: ['wednesday', 'wednesdays', 'weds', 'wed'], isoWeekday: 3 },
    { forms: ['thursday', 'thursdays', 'thurs', 'thur', 'thu'], isoWeekday: 4 },
    { forms: ['friday', 'fridays', 'fri'], isoWeekday: 5 },
    { forms: ['saturday', 'saturdays', 'sat'], isoWeekday: 6 },
    { forms: ['sunday', 'sundays', 'sun'], isoWeekday: 7 },
  ],

  // Transcribed from the old `WEEKDAY_RE` prefix group
  // `(?:(?:on|this|next|coming|the)\s+)*`. Only `next` changed the arithmetic
  // there, and only `next` changes it here.
  weekdayModifiers: [
    { forms: ['next'], kind: 'NEXT', position: 'BEFORE' },
    { forms: ['this', 'coming', 'on', 'the'], kind: 'THIS', position: 'BEFORE' },
  ],

  dayParts: [
    { forms: ['morning'], dayPart: 'morning', impliesToday: false },
    { forms: ['afternoon'], dayPart: 'afternoon', impliesToday: false },
    { forms: ['evening'], dayPart: 'evening', impliesToday: false },
    // `tonight` is a day part AND a day anchor, which is why it carries its own
    // anchor label rather than falling into the implicit-today branch.
    { forms: ['tonight'], dayPart: 'evening', impliesToday: true, impliesTodayLabel: 'tonight' },
  ],

  namedTimes: [
    { forms: ['noon', 'midday'], hour: 12, minute: 0 },
    { forms: ['midnight'], hour: 0, minute: 0 },
  ],

  // From `TIME_RE`'s `(?:\b(at|@|around|about)\s*)?`. `@` is the only one that
  // can sit against the digits inside a single token, and the old `\s*` let it.
  clockPrefixes: [
    { forms: ['at', 'around', 'about'], attaches: false },
    { forms: ['@'], attaches: true, attachedSeparators: [''] },
  ],

  // `normalize()` used to delete `o'clock` with `\bo'?\s*clock\b`. Deleting a
  // token is exactly what this change exists to stop, so it is a declared
  // suffix instead: it is consumed by a rule, recorded, and it marks the number
  // in front of it as a clock time.
  clockSuffixes: ["o'clock", 'oclock', 'o clock'],

  // `normalize()` rewrote `a.m.`/`p.m.` before matching. The spellings are
  // declared instead, so nothing is rewritten behind the reader's back.
  meridiems: [
    { forms: ['am', 'a.m.', 'a.m', 'am.'], meridiem: 'am' },
    { forms: ['pm', 'p.m.', 'p.m', 'pm.'], meridiem: 'pm' },
  ],

  relativeOffset: {
    prefixes: ['in'],
    softeners: ['about', 'around', 'roughly'],
    // `RELATIVE_OFFSET_RE` began `\bin\s+`, so English has always required the
    // introducing word. Left as it was.
    prefixRequired: true,
    quantities: [
      // The multi-token spellings `normalize()` used to rewrite into single
      // words (`a couple of` -> `couple`, `a few` -> `few`) are declared as
      // forms, which is the same vocabulary with the rewrite removed.
      { forms: ['a couple of', 'a couple', 'couple', 'two'], value: 2 },
      { forms: ['a few', 'few', 'three'], value: 3 },
      { forms: ['a', 'an', 'one'], value: 1 },
      { forms: ['four'], value: 4 },
      { forms: ['five'], value: 5 },
      { forms: ['six'], value: 6 },
      { forms: ['seven'], value: 7 },
      { forms: ['eight'], value: 8 },
      { forms: ['nine'], value: 9 },
      { forms: ['ten'], value: 10 },
      { forms: ['eleven'], value: 11 },
      { forms: ['twelve'], value: 12 },
    ],
    units: [
      { forms: ['minutes', 'minute', 'mins', 'min'], unit: 'minute' },
      { forms: ['hours', 'hour', 'hrs', 'hr'], unit: 'hour' },
      { forms: ['days', 'day'], unit: 'day' },
      { forms: ['weeks', 'week'], unit: 'week' },
    ],
    // `normalize()` rewrote `half an hour` into `in 30 minutes`, which is why
    // it resolves without an introducing `in`. Declared with
    // `prefixOptional: true` so that behaviour is preserved and visible.
    fixedDurations: [{ forms: ['half an hour'], value: 30, unit: 'minute', prefixOptional: true }],
  },

  /**
   * Words English PERMITS around a scheduling phrase and discards on purpose.
   *
   * Consumed last, after every rule that could want them, so a carrier can
   * never shadow a real match - `a` is a quantity word in `in a couple of
   * hours` and a carrier only when the offset rule did not want it.
   */
  carriers: [
    'a',
    'an',
    'the',
    'please',
    'call',
    'ring',
    'phone',
    'dial',
    'speak',
    'talk',
    'chat',
    'back',
    'again',
    'me',
    'my',
    'our',
    'us',
    'we',
    'i',
    'you',
    'your',
    'lets',
    "let's",
    'can',
    'could',
    'would',
    'shall',
    'will',
    'and',
    'so',
    'then',
    'just',
    'to',
    'for',
    'of',
    // `on` is also a weekday modifier (`on friday`). The weekday rule runs
    // first, so it is only ever consumed as a carrier where no weekday wanted
    // it - `tomorrow at 3pm on the 15th`, where `15th` is then the leftover
    // that refuses.
    'on',
    'ok',
    'okay',
    'sure',
    'thanks',
    'thank',
  ],

  // Transcribed verbatim from `VAGUENESS_MARKERS`.
  vaguenessMarkers: [
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
  ],

  // Transcribed verbatim from `LEFTOVER_BLOCKLIST_RE`.
  periodTokens: [
    'week',
    'weeks',
    'month',
    'months',
    'year',
    'years',
    'quarter',
    'quarters',
    'fortnight',
    'fortnights',
  ],
};
