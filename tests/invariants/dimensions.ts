/**
 * THE DIMENSIONS OF THE SWEEP.
 *
 * The legacy prototype's QA harness ran 538 scenarios by crossing a small
 * number of carefully chosen axes rather than by writing 538 tests. This file
 * is that idea, re-expressed for this domain: every value here is a deliberate
 * choice, written down once, so that `scenarios.ts` can cross them and so a
 * reviewer can see the whole input space on one page.
 *
 * NOTHING HERE PREDICTS AN OUTCOME.
 * ---------------------------------------------------------------------------
 * That is the single most important property of this file. A dimension supplies
 * an INPUT. It never says "and therefore the system must answer X", because
 * computing the expected answer would mean reimplementing `DateTimeResolver`
 * and `SchedulingValidator` inside the test suite - and a test that reimplements
 * the thing it tests proves only that the two copies agree.
 *
 * The one thing a dimension may carry is a DIRECTION (`ACCEPT` / `REJECT` /
 * `EITHER`), and only where the direction is true for every combination it
 * appears in. "tomorrow at 2pm" is `EITHER`, not `ACCEPT`, because tomorrow may
 * be a Saturday - and discovering that is the sweep's job, not the author's.
 */
import type { DailyLocalBusyRule } from '../../src/providers/deterministicAvailabilityProvider.js';

/**
 * The seed. Every pseudo-random choice in this sweep derives from it.
 *
 * Changing it changes the generated corpus, which is why it is a constant and
 * not an environment variable: a sweep that varies run to run cannot be used to
 * reproduce a failure.
 */
export const SWEEP_SEED = 20260923;

/**
 * `mulberry32` - a small, fast, fully deterministic PRNG.
 *
 * Used only where the sweep wants VARIETY rather than COVERAGE (which rubric
 * evidence string to attach, which of several equivalent phrasings to use).
 * Every axis that must be covered exhaustively is enumerated, not sampled.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 1. Contact timezone.
// ---------------------------------------------------------------------------

export interface TimezoneDimension {
  readonly key: string;
  readonly zone: string;
  /** Why this zone earns its place in the matrix. */
  readonly rationale: string;
  /** Does this zone observe daylight saving at all? */
  readonly observesDst: boolean;
  /** A local datetime inside a DST gap, if the zone has one. */
  readonly dstGapLocal?: string;
  /** A local datetime that occurs twice, if the zone has one. */
  readonly dstAmbiguousLocal?: string;
}

export const TIMEZONES: readonly TimezoneDimension[] = [
  {
    key: 'nyc',
    zone: 'America/New_York',
    rationale: 'Northern-hemisphere DST; the fixture zone, so a bug here breaks the demo too.',
    observesDst: true,
    // 2026-03-08 02:00 EST jumps to 03:00 EDT: 02:30 never happens.
    dstGapLocal: '2026-03-08T02:30',
    // 2026-11-01 02:00 EDT falls back to 01:00 EST: 01:30 happens twice.
    dstAmbiguousLocal: '2026-11-01T01:30',
  },
  {
    key: 'lon',
    zone: 'Europe/London',
    rationale: 'DST on a DIFFERENT date from the US, so a hard-coded US transition fails here.',
    observesDst: true,
    dstGapLocal: '2026-03-29T01:30',
    dstAmbiguousLocal: '2026-10-25T01:30',
  },
  {
    key: 'syd',
    zone: 'Australia/Sydney',
    rationale: 'Southern hemisphere: DST runs the other way round, and the date line is in play.',
    observesDst: true,
    // 2026-10-04 02:00 AEST jumps to 03:00 AEDT.
    dstGapLocal: '2026-10-04T02:30',
    // 2026-04-05 03:00 AEDT falls back to 02:00 AEST.
    dstAmbiguousLocal: '2026-04-05T02:30',
  },
  {
    key: 'kol',
    zone: 'Asia/Kolkata',
    rationale: 'UTC+05:30 - a HALF-HOUR offset, which breaks any code that assumes whole hours.',
    observesDst: false,
  },
  {
    key: 'utc',
    zone: 'UTC',
    rationale: 'The degenerate case. Must still go through the same pipeline, not a shortcut.',
    observesDst: false,
  },
];

// ---------------------------------------------------------------------------
// 2. The `now` instant.
//
// Weekday/DST claims below were checked against Luxon before being written
// down; `tests/invariants/dimensions.test.ts` re-checks them on every run so a
// comment can never quietly become a lie.
// ---------------------------------------------------------------------------

export interface NowDimension {
  readonly key: string;
  readonly nowUtc: string;
  readonly rationale: string;
}

export const NOW_INSTANTS: readonly NowDimension[] = [
  {
    key: 'n01-midweek',
    nowUtc: '2026-03-04T15:00:00.000Z',
    rationale: 'Wednesday 10:00 New York. The baseline the rest of the repository uses.',
  },
  {
    key: 'n02-weekend',
    nowUtc: '2026-03-07T17:00:00.000Z',
    rationale: 'SATURDAY. "tomorrow" is a Sunday, so a weekday-only policy must refuse it.',
  },
  {
    key: 'n03-pre-us-dst',
    nowUtc: '2026-03-07T22:00:00.000Z',
    rationale: 'Hours BEFORE the 2026-03-08 US spring-forward. "tomorrow" crosses the transition.',
  },
  {
    key: 'n04-post-us-dst',
    nowUtc: '2026-03-09T13:00:00.000Z',
    rationale: 'Monday 09:00 New York, the first business day AFTER the US transition (now EDT).',
  },
  {
    key: 'n05-friday-pm-pre-eu-dst',
    nowUtc: '2026-03-27T16:00:00.000Z',
    rationale: 'FRIDAY AFTERNOON, and the last business day before the EU transition.',
  },
  {
    key: 'n06-post-eu-dst',
    nowUtc: '2026-03-30T09:00:00.000Z',
    rationale: 'Monday after Europe/London moved to BST while New York was already on EDT.',
  },
  {
    key: 'n07-pre-au-dst-end',
    nowUtc: '2026-04-03T05:00:00.000Z',
    rationale: 'Friday in Sydney, two days before AEDT ends - a southern-hemisphere FALL BACK.',
  },
  {
    key: 'n08-post-au-dst-end',
    nowUtc: '2026-04-06T05:00:00.000Z',
    rationale: 'Monday 15:00 Sydney, after AEDT ended while the north is still on summer time.',
  },
  {
    key: 'n09-month-boundary-jan',
    nowUtc: '2026-01-30T14:00:00.000Z',
    rationale: 'Friday 30 January: "tomorrow" is the 31st and the week after is February.',
  },
  {
    key: 'n10-month-boundary-jun',
    nowUtc: '2026-06-30T14:00:00.000Z',
    rationale: 'Tuesday 30 June: "tomorrow" rolls the MONTH over, and Sydney is already on 1 July.',
  },
];

// ---------------------------------------------------------------------------
// 3. The time expression the model proposes.
// ---------------------------------------------------------------------------

/**
 * What the sweep is entitled to assert about an expression's direction.
 *
 * `EITHER` is the honest default and it is used a lot. "tomorrow at 2pm" is
 * perfectly valid English and a perfectly reasonable proposal, and whether it
 * is accepted depends on the weekday, the zone, the policy and the diary. The
 * sweep therefore asserts INVARIANTS over it rather than an expected verdict.
 */
export type Direction = 'ACCEPT' | 'REJECT' | 'EITHER';

export interface ExpressionDimension {
  readonly key: string;
  /** The words the model puts in the `when` argument. */
  readonly raw: string;
  readonly direction: Direction;
  readonly rationale: string;
  /**
   * Which locale lexicons this expression is expected to exercise, if any.
   *
   * Absent for the English expressions that were here before locale support:
   * they are the baseline and nothing about them changed. Present - `['he']`,
   * `['he','en']`, or `[]` for a phrase in a language no lexicon covers - on
   * every expression added by the Hebrew work, which is what lets the report
   * show a `locales` axis and what family L selects on. It is a statement about
   * the INPUT, not a prediction of the output: an expression declaring `['he']`
   * is one written in Hebrew, not one asserted to resolve.
   */
  readonly locales?: readonly string[];
}

/** Expressions that are well-formed English and a plausible agreed time. */
export const VALID_EXPRESSIONS: readonly ExpressionDimension[] = [
  {
    key: 'e01-tomorrow-2pm',
    raw: 'tomorrow at 2pm',
    direction: 'EITHER',
    rationale: 'The ordinary case. EITHER because tomorrow may be a Saturday.',
  },
  {
    key: 'e02-tomorrow-10am',
    raw: 'tomorrow at 10am',
    direction: 'EITHER',
    rationale: 'Morning variant, to move the slot across the DST boundary differently.',
  },
  {
    key: 'e03-tomorrow-afternoon',
    raw: 'tomorrow afternoon',
    direction: 'EITHER',
    rationale: 'A DAY PART with no clock time: resolves via the documented 14:00 preference.',
  },
  {
    key: 'e04-next-tuesday-11am',
    raw: 'next tuesday at 11am',
    direction: 'EITHER',
    rationale: 'Named weekday + "next": exercises ISO-week arithmetic across a month boundary.',
  },
  {
    key: 'e05-in-three-hours',
    raw: 'in 3 hours',
    direction: 'EITHER',
    rationale: 'A pure OFFSET. Lands wherever now lands, including outside business hours.',
  },

  // -------------------------------------------------------------------------
  // Hebrew and code-switched expressions.
  //
  // APPENDED, NEVER INSERTED. Families A, B and E select from this array BY
  // INDEX (`slice(0, 3)`, `[0]`, `[3]`), so adding at the end leaves every
  // pre-existing scenario id and every pre-existing scenario byte-for-byte
  // unchanged. Anything inserted above would silently re-shuffle 200 ids and
  // make this sweep's results incomparable with the ones already reported.
  //
  // These are consumed by family L, which crosses them with its own zone and
  // `now` axes. Direction is EITHER for all of them for the usual reason: 15:00
  // on a Saturday is refused by the business-hours policy, and discovering that
  // is the sweep's job rather than the author's.
  // -------------------------------------------------------------------------
  {
    key: 'e06-he-tomorrow-digit-time',
    raw: 'מחר ב-15:00',
    direction: 'EITHER',
    locales: ['he'],
    rationale:
      'THE EXPRESSION THE WHOLE MISSION IS ABOUT. "tomorrow at 15:00" in Hebrew with the clock time in ' +
      'DIGITS. It used to resolve to TODAY with ok:true - a validated booking one calendar day early ' +
      '(docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md § 8.3). Swept, not just unit-tested, because the defect ' +
      'was invisible until it was crossed with a zone and a `now`.',
  },
  {
    key: 'e07-he-tomorrow-maqaf',
    raw: 'מחר ב־15:00',
    direction: 'EITHER',
    locales: ['he'],
    rationale:
      'The same phrase written with U+05BE MAQAF instead of an ASCII hyphen - which is what a Hebrew ' +
      'keyboard and a Hebrew-aware CRM actually produce. It reaches the grammar only because ' +
      '`normalizeScript` maps it, so this cell fails if that step is ever dropped.',
  },
  {
    key: 'e08-he-weekday-digit-time',
    raw: 'יום חמישי ב-15:00',
    direction: 'EITHER',
    locales: ['he'],
    rationale:
      'A named Hebrew weekday rather than a relative day word. § 8.3 lists this as a second wrong-day ' +
      'shape, and it exercises the weekday arithmetic on a week that starts on Sunday.',
  },
  {
    key: 'e09-he-day-part',
    raw: 'מחר אחרי הצהריים',
    direction: 'EITHER',
    locales: ['he'],
    rationale:
      'A Hebrew day part with NO clock time, so the documented preferred hour has to supply one. Also ' +
      'the pair where the two-token day part must not collapse into the one-token named time for noon.',
  },
  {
    key: 'e10-he-offset-dual',
    raw: 'בעוד שעתיים',
    direction: 'EITHER',
    locales: ['he'],
    rationale:
      "Hebrew's DUAL: one word meaning two hours, with no separable quantity. It lands wherever `now` " +
      'lands, so it crosses the business-hours boundary differently in every zone.',
  },
  {
    key: 'e11-mixed-callback',
    raw: 'call me back מחר ב-16:00',
    direction: 'EITHER',
    locales: ['he', 'en'],
    rationale:
      'The code-switched shape from `src/eval/corpus/scenarios.he.ts`: English carriers around a Hebrew ' +
      'day word and time. Two lexicons have to match in one phrase and every token still has to be ' +
      'accounted for.',
  },
  {
    key: 'e12-mixed-english-time',
    raw: 'מחר at 3pm',
    direction: 'EITHER',
    locales: ['he', 'en'],
    rationale:
      'The other half of the code switch - Hebrew day word, English clock time - and the fourth row of ' +
      "§ 8.3's parser table. The `am/pm` path has to work next to a Hebrew anchor.",
  },
];

/** Expressions that must be refused - the direction here is safe to assert. */
export const REJECTED_EXPRESSIONS: readonly ExpressionDimension[] = [
  {
    key: 'x01-past-instant',
    raw: '2019-06-11T14:00',
    direction: 'REJECT',
    rationale: 'Explicitly in the past. Must never be silently rolled forward.',
  },
  {
    key: 'x02-early-morning',
    raw: 'tomorrow at 6am',
    direction: 'REJECT',
    rationale: 'Inside the day but before any configured window. A 6am sales call is a real harm.',
  },
  {
    key: 'x03-late-night',
    raw: 'tomorrow at 11pm',
    direction: 'REJECT',
    rationale: 'After every configured window, on every policy in this matrix.',
  },
  {
    key: 'x04-evening-daypart',
    raw: 'tomorrow evening',
    direction: 'REJECT',
    rationale: 'Resolves to 18:00 and is THEN refused - never silently shifted into hours.',
  },
  {
    key: 'x05-bare-hour-no-meridiem',
    raw: 'tomorrow at 3',
    direction: 'REJECT',
    rationale: 'Genuinely ambiguous: 3am or 3pm. The resolver must ask, not guess.',
  },
  {
    key: 'x06-vague-period',
    raw: 'sometime next week',
    direction: 'REJECT',
    rationale: 'A period, not a moment. Nothing can be booked at "next week".',
  },
  {
    key: 'x07-asap',
    raw: 'asap',
    direction: 'REJECT',
    rationale: 'Intent with no time in it at all.',
  },
  {
    key: 'x08-gibberish',
    raw: 'qqzzx wibble flurm',
    direction: 'REJECT',
    rationale: 'Unparseable. The floor of the grammar: refuse rather than default to something.',
  },
  {
    key: 'x09-contradiction',
    raw: 'tomorrow morning at 3pm',
    direction: 'REJECT',
    rationale: 'Self-contradictory. A resolver that picks one half has invented intent.',
  },
  {
    key: 'x10-far-future',
    raw: '2041-09-17T14:00',
    direction: 'REJECT',
    rationale: 'Beyond every horizon in this matrix (max 365 days).',
  },

  // -------------------------------------------------------------------------
  // Refusals in, and around, the languages the lexicons cover.
  //
  // APPENDED for the reason given above `e06`: family E selects
  // `REJECTED_EXPRESSIONS[9]` by index. Family C crosses this whole array with
  // 5 zones and 2 instants, so each entry here is 10 scenarios, and each one
  // must be unconditionally refusable in EVERY zone under EVERY policy in the
  // matrix - which is why the list is refusals of the grammar rather than
  // refusals of a policy.
  // -------------------------------------------------------------------------
  {
    key: 'x11-he-unsettled-hour',
    raw: 'מחר ב-9:00',
    direction: 'REJECT',
    locales: ['he'],
    rationale:
      'Hebrew has no am/pm, so 9:00 could be 09:00 or 21:00 and nothing settles it. The SAME rule that ' +
      'refuses `tomorrow at 3` in English, applied by the same code - swept so that a future "helpful" ' +
      'Hebrew default cannot be added without turning this cell red. docs/DECISIONS.md § 9.9.',
  },
  {
    key: 'x12-he-hour-in-words',
    raw: 'מחר אחרי הצהריים, בשתיים',
    direction: 'REJECT',
    locales: ['he'],
    rationale:
      'An hour spelled out in Hebrew WORDS, deliberately out of the lexicon. Two thirds of the phrase ' +
      'IS understood, which is the dangerous shape: a grammar that refused only when it understood ' +
      'nothing would let this through. It must refuse, naming `בשתיים`.',
  },
  {
    key: 'x13-he-period-not-moment',
    raw: 'שבוע הבא',
    direction: 'REJECT',
    locales: ['he'],
    rationale:
      'A PERIOD rather than a moment, in Hebrew. The English-only leftover blocklist could not see this ' +
      'at all; the period rule is now per-locale data, and this cell is what keeps it declared.',
  },
  {
    key: 'x14-he-vague',
    raw: 'אולי מחר',
    direction: 'REJECT',
    locales: ['he'],
    rationale:
      'Hebrew vagueness ("maybe tomorrow") sitting next to a day word the grammar DOES understand. ' +
      'Understanding half a phrase is not permission to book the other half.',
  },
  {
    key: 'x15-arabic-digit-time',
    raw: 'غدا في 15:00',
    direction: 'REJECT',
    locales: [],
    rationale:
      'THE GENERALISATION OF THE DEFECT. Arabic for "tomorrow at 15:00". No lexicon covers it and none ' +
      'ever will here, so it must refuse naming the leftover rather than keeping the digits and ' +
      'dropping the day word. `locales: []` records that no lexicon is expected to claim it.',
  },
  {
    key: 'x16-russian-digit-time',
    raw: 'завтра в 15:00',
    direction: 'REJECT',
    locales: [],
    rationale: 'The same shape in Cyrillic. Named in the Founder Review alongside the Arabic case.',
  },
  {
    key: 'x17-french-digit-time',
    raw: 'demain à 15:00',
    direction: 'REJECT',
    locales: [],
    rationale:
      'The same shape in the SAME ALPHABET English uses, so nothing about the script can be what is ' +
      'refusing it.',
  },
  {
    key: 'x18-japanese-digit-time',
    raw: '明日 15:00',
    direction: 'REJECT',
    locales: [],
    rationale:
      'A script no lexicon in this product\'s plausible future covers, written without spaces. The floor ' +
      'of the claim: the rule names no alphabet, so it holds for alphabets nobody has thought about.',
  },
  {
    key: 'x19-he-plus-unknown-token',
    raw: 'מחר ב-15:00 blorp',
    direction: 'REJECT',
    locales: ['he'],
    rationale:
      'Perfectly good Hebrew plus ONE word of noise. The most dangerous shape of all, because enough is ' +
      'understood to look like a successful parse. One unaccounted token must sink the whole phrase.',
  },
];

/** Offsets small enough to fall under a configured minimum lead time. */
export const LEAD_TIME_EXPRESSIONS: readonly ExpressionDimension[] = [
  {
    key: 'l01-in-five-minutes',
    raw: 'in 5 minutes',
    direction: 'REJECT',
    rationale: 'Under every minLeadTimeMinutes in this matrix. Nobody can be ready in five minutes.',
  },
  {
    key: 'l02-in-forty-minutes',
    raw: 'in 40 minutes',
    direction: 'EITHER',
    rationale: 'Over the default 30-minute lead but UNDER the tight policy\'s 120. Policy decides.',
  },

  // APPENDED for the reason given above `e06`: families C and E select
  // `LEAD_TIME_EXPRESSIONS[0]` and `[1]` by index.
  {
    key: 'l03-he-in-five-minutes',
    raw: 'בעוד 5 דקות',
    direction: 'REJECT',
    locales: ['he'],
    rationale:
      'The Hebrew translation of l01, and the same verdict for the same reason. Lead time is a policy ' +
      'question and policy knows nothing about language, so a Hebrew phrase must be refused by the ' +
      'lead-time gate rather than by the grammar - which only happens if the grammar understood it ' +
      'first. A cell that turned INVALID_FORMAT here would mean the Hebrew offset had stopped parsing.',
  },
  {
    key: 'l04-he-in-forty-minutes',
    raw: 'בעוד 40 דקות',
    direction: 'EITHER',
    locales: ['he'],
    rationale:
      'The Hebrew translation of l02: over the default 30-minute lead, under the tight policy\'s 120. ' +
      'The point of the pair is that the POLICY decides, identically, in either language.',
  },
];

// ---------------------------------------------------------------------------
// 3a-bis. The locale axes: parity pairs, and the zones and instants family L
// crosses them with.
//
// WHY FAMILY L HAS ITS OWN ZONE AND `now` LISTS, AND WHY THAT IS A BOUND
// ---------------------------------------------------------------------------
// The obvious move would have been to add Asia/Jerusalem to `TIMEZONES`.
// Families A, B, C, D, F, H and J all iterate that array, so one extra zone
// costs 112 scenarios and two cost 224 - a 37% larger corpus, on a sweep that
// already runs against real SQLite on a memory-constrained host, to re-prove
// English behaviour in a zone that differs from the existing five only by its
// offset.
//
// So the locale work is crossed with its OWN three zones instead. That is a
// DELIBERATE BOUND, not an oversight, and it has a consequence worth stating
// plainly: the Hebrew expressions are swept in three zones, not five, and the
// two zones added here (Asia/Jerusalem, Pacific/Auckland) are NOT crossed with
// families A-K. It is repeated in `KNOWN_COVERAGE_GAPS` in `tests/qa/report.ts`
// so it appears in the printed report as well as here, and
// `tests/scheduling/localeParity.test.ts` covers six zones at the resolver
// level where a cell costs microseconds instead of a database.
// ---------------------------------------------------------------------------

export interface LocaleZoneDimension {
  readonly key: string;
  readonly zone: string;
  readonly rationale: string;
}

export const LOCALE_ZONES: readonly LocaleZoneDimension[] = [
  {
    key: 'jer',
    zone: 'Asia/Jerusalem',
    rationale:
      'THE ZONE THE DEFECT WAS FOUND IN, and one this sweep had no coverage of at all. It also ' +
      'transitions on its own DST dates, neither the US ones nor the EU ones.',
  },
  {
    key: 'nyc',
    zone: 'America/New_York',
    rationale: 'The fixture zone, so a Hebrew phrase is also swept somewhere the rest of the corpus lives.',
  },
  {
    key: 'akl',
    zone: 'Pacific/Auckland',
    rationale:
      'UTC+12/+13. The contact is on the far side of the date line from the Hebrew corpus, which is ' +
      'where a day word computed on the wrong clock goes wrong by a whole day.',
  },
];

export interface LocaleNowDimension {
  readonly key: string;
  readonly nowUtc: string;
  readonly rationale: string;
}

export const LOCALE_NOW_INSTANTS: readonly LocaleNowDimension[] = [
  {
    key: 'ln1-midweek',
    nowUtc: '2026-03-04T15:00:00.000Z',
    // Deliberately the same instant as `n01-midweek`, so a difference between
    // family L and families A/B cannot be a difference of clock.
    rationale: 'The repository baseline: Wednesday 10:00 New York, 17:00 Jerusalem, Thursday 04:00 Auckland.',
  },
  {
    key: 'ln2-across-local-midnight',
    nowUtc: '2026-03-05T04:30:00.000Z',
    rationale:
      'America/New_York is on 2026-03-04 while UTC is already on 2026-03-05. A day word computed from ' +
      'the UTC day rather than the contact clock is exactly one day out here, which is the § 8.3 shape.',
  },
];

/**
 * A Hebrew expression and its English translation, which MUST resolve to the
 * same instant under the same `now`, zone and policy.
 *
 * This is the only dimension in this file that relates two inputs to each
 * other, and it is the one `INV-16` is made of. It still predicts no outcome:
 * it says "these two mean the same thing", never "they mean 15:00".
 *
 * `identical: false` marks a pair that is a faithful translation and is NOT
 * expected to agree, with the reason. Those pairs are still swept - they have
 * to satisfy every other invariant - and `INV-16` records them as inapplicable
 * QUOTING THE REASON, so a reader of the report sees the exception rather than
 * a silent absence.
 */
export interface LocaleParityPair {
  readonly key: string;
  /** The Hebrew or code-switched side. Keyed to an `ExpressionDimension`. */
  readonly expressionKey: string;
  readonly hebrew: string;
  readonly english: string;
  readonly identical: boolean;
  /** Required when `identical` is false. */
  readonly whyNotIdentical?: string;
  readonly rationale: string;
}

export const LOCALE_PARITY_PAIRS: readonly LocaleParityPair[] = [
  {
    key: 'lp1-tomorrow-digit-time',
    expressionKey: 'e06-he-tomorrow-digit-time',
    hebrew: 'מחר ב-15:00',
    english: 'tomorrow at 15:00',
    identical: true,
    rationale:
      'The headline pair. These two resolved to DIFFERENT CALENDAR DAYS before the fix, and only the ' +
      'English one was ever asserted anywhere.',
  },
  {
    key: 'lp2-tomorrow-maqaf',
    expressionKey: 'e07-he-tomorrow-maqaf',
    hebrew: 'מחר ב־15:00',
    english: 'tomorrow at 15:00',
    identical: true,
    rationale: 'The same pair with the maqaf spelling, so script normalisation is inside the parity claim.',
  },
  {
    key: 'lp3-weekday-digit-time',
    expressionKey: 'e08-he-weekday-digit-time',
    hebrew: 'יום חמישי ב-15:00',
    english: 'thursday at 15:00',
    identical: true,
    rationale:
      'Weekday arithmetic has to be locale-agnostic: the Hebrew week starts on Sunday and the ISO week ' +
      'on Monday, and the answer must not depend on which word was used.',
  },
  {
    key: 'lp4-day-part',
    expressionKey: 'e09-he-day-part',
    hebrew: 'מחר אחרי הצהריים',
    english: 'tomorrow afternoon',
    identical: true,
    rationale:
      'A day part with no clock time. The preferred hour comes from POLICY, so the two languages must ' +
      'reach the same policy value rather than each carrying their own default.',
  },
  {
    key: 'lp5-offset-dual',
    expressionKey: 'e10-he-offset-dual',
    hebrew: 'בעוד שעתיים',
    english: 'in two hours',
    identical: true,
    rationale:
      "Hebrew's DUAL against English's quantity-plus-unit. Two entirely different grammar shapes that " +
      'have to produce one instant.',
  },
  {
    key: 'lp6-mixed-callback',
    expressionKey: 'e11-mixed-callback',
    hebrew: 'call me back מחר ב-16:00',
    english: 'call me back tomorrow at 16:00',
    identical: true,
    rationale: 'Code-switched against wholly English, with the same carriers on both sides.',
  },
  {
    key: 'lp7-mixed-english-time',
    expressionKey: 'e12-mixed-english-time',
    hebrew: 'מחר at 3pm',
    english: 'tomorrow at 3pm',
    identical: true,
    rationale: 'The other code switch: only the day word is Hebrew, and it is the word that used to vanish.',
  },
  {
    key: 'lp8-lead-time-short',
    expressionKey: 'l03-he-in-five-minutes',
    hebrew: 'בעוד 5 דקות',
    english: 'in 5 minutes',
    identical: true,
    rationale:
      'A pair that must be refused IDENTICALLY, by the lead-time gate rather than by the grammar. ' +
      'Parity is not only about what resolves.',
  },
  {
    key: 'lp9-hour-in-words',
    expressionKey: 'x12-he-hour-in-words',
    hebrew: 'מחר אחרי הצהריים, בשתיים',
    english: 'tomorrow afternoon at 2pm',
    identical: false,
    whyNotIdentical:
      'An hour spelled out in Hebrew WORDS is deliberately outside the lexicon, so the Hebrew side ' +
      'refuses naming `בשתיים` while the English side resolves. Guessing that שתיים means 14:00 rather ' +
      'than 02:00 is exactly the guess the fail-closed rule exists to refuse. docs/DECISIONS.md § 9.9. ' +
      'Swept anyway, because every OTHER invariant still has to hold for it.',
    rationale: 'The documented asymmetry, carried in the matrix rather than left out of it.',
  },
  {
    key: 'lp10-unsettled-hour',
    expressionKey: 'x11-he-unsettled-hour',
    hebrew: 'מחר ב-9:00',
    english: 'tomorrow at 9am',
    identical: false,
    whyNotIdentical:
      'Hebrew has no am/pm, so `9:00` could be 09:00 or 21:00 and is refused; English carries `am` and ' +
      'resolves. This is the pre-existing English rule applying unchanged by the same code, not a ' +
      'Hebrew gap - `מחר ב-9:00 בבוקר` resolves, and that pair holds in ' +
      '`tests/scheduling/localeParity.test.ts`. docs/DECISIONS.md § 9.9.',
    rationale: 'The second documented asymmetry, for the same reason.',
  },
];

// ---------------------------------------------------------------------------
// 3b. The timezone the MODEL asserts in the tool's `timezone` argument.
//
// This axis is here because of a real, reproduced bypass: the optional
// `timezone` argument used to decide not only which INSTANT a phrase named but
// also which wall-clock window that instant was judged against. A model could
// therefore ask for a polite-sounding "10am" in a zone half a world away and
// have a 23:30 contact-local callback recorded with `business_hours: passed`.
//
// The axis is deliberately crossed with EVERY contact zone, including zones that
// differ wildly from the contact's, and `INV-14` re-reads each persisted instant
// on the CONTACT'S OWN clock. Nothing here predicts a verdict: the committed
// cases below are a separate, hand-checked list.
// ---------------------------------------------------------------------------

/**
 * Zones a model might assert. The five sweep zones plus two that appear nowhere
 * else, so a scenario cannot accidentally assert the zone the contact is
 * already in and still count as covering the axis.
 */
export const ASSERTED_TIMEZONES: readonly string[] = [
  'America/New_York',
  'Europe/London',
  'Australia/Sydney',
  'Asia/Kolkata',
  'UTC',
  'America/Denver',
  'Asia/Tokyo',
];

/** The phrase the override axis is crossed with. Innocuous on purpose. */
export const OVERRIDE_PROBE_EXPRESSION = 'tomorrow at 10am';

/**
 * Overrides whose effect on the CONTACT'S clock was worked out by hand.
 *
 * Unlike the axis above, these DO commit to a direction, which is only safe
 * because every input is pinned: the contact is in `contactZone`, the policy is
 * `p1-default` (09:00-17:00, Mon-Fri), and `now` is `BASELINE_NOW`. The claim in
 * `contactLocalWallClock` is a pure tzdata fact about (`whenLocal`,
 * `assertedZone`, `contactZone`) - `dimensions.test.ts` re-derives every one of
 * them from Luxon, and derives the direction from the policy window, so a tzdata
 * change cannot leave a stale expectation sitting here looking authoritative.
 */
export interface TimezoneOverrideCase {
  readonly key: string;
  /** `Contact.timezone` on the persisted row. */
  readonly contactZone: string;
  /** What the model puts in the tool's `timezone` argument. */
  readonly assertedZone: string;
  /** ISO local datetime, to be read in `assertedZone`. */
  readonly whenLocal: string;
  /** `yyyy-LL-dd HH:mm` that instant reads as in `contactZone`. Re-derived. */
  readonly contactLocalWallClock: string;
  readonly direction: Direction;
  readonly rationale: string;
}

export const TIMEZONE_OVERRIDE_CASES: readonly TimezoneOverrideCase[] = [
  {
    key: 'j1-kolkata-reaches-2330-nyc',
    contactZone: 'America/New_York',
    assertedZone: 'Asia/Kolkata',
    whenLocal: '2026-03-05T10:00',
    contactLocalWallClock: '2026-03-04 23:30',
    direction: 'REJECT',
    rationale:
      'THE REPRODUCED BYPASS. A courteous "10:00" in a zone the model chose is half past eleven at ' +
      'night where the contact actually lives.',
  },
  {
    key: 'j2-tokyo-reaches-midnight-nyc',
    contactZone: 'America/New_York',
    assertedZone: 'Asia/Tokyo',
    whenLocal: '2026-03-06T14:00',
    contactLocalWallClock: '2026-03-06 00:00',
    direction: 'REJECT',
    rationale: 'The same bypass on the meeting path: a mid-afternoon Tokyo slot is midnight in New York.',
  },
  {
    key: 'j3-utc-reaches-1800-nyc',
    contactZone: 'America/New_York',
    assertedZone: 'UTC',
    whenLocal: '2026-03-05T23:00',
    contactLocalWallClock: '2026-03-05 18:00',
    direction: 'REJECT',
    rationale: 'Only an hour past close, which is the kind of near-miss a coarse check waves through.',
  },
  {
    key: 'j4-sydney-lands-exactly-on-close',
    contactZone: 'America/New_York',
    assertedZone: 'Australia/Sydney',
    whenLocal: '2026-03-05T09:00',
    contactLocalWallClock: '2026-03-04 17:00',
    direction: 'REJECT',
    rationale:
      'Lands EXACTLY on 17:00 contact-local. Windows are half-open, so a slot starting at close is ' +
      'outside - the boundary an off-by-one would get wrong in the permissive direction.',
  },
  {
    key: 'j5-denver-is-a-genuine-traveller',
    contactZone: 'America/New_York',
    assertedZone: 'America/Denver',
    whenLocal: '2026-03-05T10:00',
    contactLocalWallClock: '2026-03-05 12:00',
    direction: 'ACCEPT',
    rationale:
      'THE CONTROL. "I am in Denver this week" is the reason the argument exists. 10:00 Denver is noon ' +
      'in New York, so it must still be bookable - a fix that refused this would be a regression.',
  },
  {
    key: 'j6-london-morning-is-fine-too',
    contactZone: 'America/New_York',
    assertedZone: 'Europe/London',
    whenLocal: '2026-03-05T15:00',
    contactLocalWallClock: '2026-03-05 10:00',
    direction: 'ACCEPT',
    rationale: 'A second control, in a zone with a different DST date, so the accept is not a one-off.',
  },
];

// ---------------------------------------------------------------------------
// 3c. Sub-minute `now` instants, for the minimum-lead-time boundary.
//
// Every instant in `NOW_INSTANTS` is on a whole minute, which is why no scenario
// there could ever expose a gate that rounded the lead time to the nearest
// minute before comparing it: the rounding was invisible. These instants carry
// SECONDS, and each one is placed a known number of seconds from the 30-minute
// minimum in `p1-default`.
// ---------------------------------------------------------------------------

export interface LeadTimeBoundaryCase {
  readonly key: string;
  /** Carries seconds on purpose. */
  readonly nowUtc: string;
  /** ISO local datetime in America/New_York, the contact zone for this family. */
  readonly whenLocal: string;
  /** True lead in SECONDS against a 30-minute (1800s) minimum. Re-derived. */
  readonly leadSeconds: number;
  readonly direction: Direction;
  readonly rationale: string;
}

export const LEAD_TIME_BOUNDARY_ZONE = 'America/New_York';

export const LEAD_TIME_BOUNDARY_CASES: readonly LeadTimeBoundaryCase[] = [
  {
    key: 'k1-thirty-seconds-short',
    nowUtc: '2026-03-04T14:00:30.000Z',
    whenLocal: '2026-03-04T09:30',
    leadSeconds: 1770,
    direction: 'REJECT',
    rationale:
      'THE REPRODUCED DEFECT: 29.5 minutes. Rounding to the nearest minute made this read as 30 and ' +
      'cleared a 30-minute minimum, then wrote "30 min >= 30 min" into the audit trail.',
  },
  {
    key: 'k2-one-second-short',
    nowUtc: '2026-03-04T14:00:01.000Z',
    whenLocal: '2026-03-04T09:30',
    leadSeconds: 1799,
    direction: 'REJECT',
    rationale: 'One second short is still short. The gate is a minimum, not a rounding target.',
  },
  {
    key: 'k3-exactly-on-the-minimum',
    nowUtc: '2026-03-04T14:00:00.000Z',
    whenLocal: '2026-03-04T09:30',
    leadSeconds: 1800,
    direction: 'ACCEPT',
    rationale: 'Exactly 30 minutes. The boundary is inclusive, and tightening the comparison must not move it.',
  },
  {
    key: 'k4-one-second-over',
    nowUtc: '2026-03-04T14:29:59.000Z',
    whenLocal: '2026-03-04T10:00',
    leadSeconds: 1801,
    direction: 'ACCEPT',
    rationale: 'THE CONTROL on the other side: a second past the minimum must still be bookable.',
  },
  {
    key: 'k5-thirty-seconds-over',
    nowUtc: '2026-03-04T13:59:30.000Z',
    whenLocal: '2026-03-04T09:30',
    leadSeconds: 1830,
    direction: 'ACCEPT',
    rationale: '30.5 minutes - the mirror of k1, so the fix cannot be "reject everything near the edge".',
  },
];

// ---------------------------------------------------------------------------
// 4. AgentConfiguration policy.
// ---------------------------------------------------------------------------

export interface PolicyDimension {
  readonly key: string;
  readonly businessHoursStartLocal: string;
  readonly businessHoursEndLocal: string;
  readonly minLeadTimeMinutes: number;
  readonly maxSchedulingHorizonDays: number;
  /** `undefined` means all nine tools. */
  readonly allowedTools?: readonly string[];
  readonly rationale: string;
}

/** The tools left enabled by the `restricted` policy. `schedule_meeting` is NOT one. */
export const RESTRICTED_TOOL_ALLOWLIST = [
  'get_contact_context',
  'check_availability',
  'schedule_followup',
] as const;

export const POLICIES: readonly PolicyDimension[] = [
  {
    key: 'p1-default',
    businessHoursStartLocal: '09:00',
    businessHoursEndLocal: '17:00',
    minLeadTimeMinutes: 30,
    maxSchedulingHorizonDays: 180,
    rationale: 'The shipped defaults, exactly as `seedSliceWorld` writes them.',
  },
  {
    key: 'p2-tight',
    businessHoursStartLocal: '10:00',
    businessHoursEndLocal: '16:00',
    minLeadTimeMinutes: 120,
    maxSchedulingHorizonDays: 7,
    rationale: 'Narrow hours, two-hour lead, one-week horizon. Refuses much that p1 accepts.',
  },
  {
    key: 'p3-wide',
    businessHoursStartLocal: '08:00',
    businessHoursEndLocal: '20:00',
    minLeadTimeMinutes: 5,
    maxSchedulingHorizonDays: 365,
    rationale: 'Generous hours and horizon. Accepts much that p2 refuses - the opposite corner.',
  },
  {
    key: 'p4-restricted-tools',
    businessHoursStartLocal: '09:00',
    businessHoursEndLocal: '17:00',
    minLeadTimeMinutes: 30,
    maxSchedulingHorizonDays: 180,
    allowedTools: RESTRICTED_TOOL_ALLOWLIST,
    rationale: 'Same hours as p1, but `allowedToolsJson` withholds schedule_meeting.',
  },
];

// ---------------------------------------------------------------------------
// 5. Availability state.
//
// Expressed as LOCAL wall-clock rules in the contact's own zone, never as UTC
// instants. That is deliberate: computing the UTC instant a proposal will land
// on would mean reimplementing the resolver here in order to place a conflict
// on top of it. A local rule says "the diary is busy 14:00-15:00 their time"
// and lets the system under test do its own arithmetic.
//
// Paired with `AVAILABILITY_PROBE_EXPRESSION` + `AVAILABILITY_PROBE_MINUTES`,
// which put the proposed slot at exactly 14:00-15:00 local.
// ---------------------------------------------------------------------------

export const AVAILABILITY_PROBE_EXPRESSION = 'tomorrow at 2pm';
export const AVAILABILITY_PROBE_MINUTES = 60;

export interface AvailabilityDimension {
  readonly key: string;
  /** Built against the contact's zone by `rulesFor`. */
  readonly window: { readonly startLocal: string; readonly endLocal: string } | null;
  readonly rationale: string;
}

export const AVAILABILITY_STATES: readonly AvailabilityDimension[] = [
  {
    key: 'a1-free',
    window: null,
    rationale: 'Empty diary. The control: proves a conflict elsewhere was detected, not imagined.',
  },
  {
    key: 'a2-exact-conflict',
    window: { startLocal: '14:00', endLocal: '15:00' },
    rationale: 'The busy interval IS the proposed slot. The unmissable case.',
  },
  {
    key: 'a3-partial-overlap',
    window: { startLocal: '14:30', endLocal: '15:30' },
    rationale: 'Overlaps the second half only. Catches a comparison that tests start times alone.',
  },
  {
    key: 'a4-adjacent',
    window: { startLocal: '15:00', endLocal: '16:00' },
    rationale: 'Starts exactly where the slot ends. Half-open intervals mean this is NOT a clash.',
  },
];

/** The busy rules for one availability state, in one contact's zone. */
export function rulesFor(state: AvailabilityDimension, timezone: string): readonly DailyLocalBusyRule[] {
  if (state.window === null) return [];
  return [
    {
      timezone,
      startLocal: state.window.startLocal,
      endLocal: state.window.endLocal,
      label: state.key,
    },
  ];
}
