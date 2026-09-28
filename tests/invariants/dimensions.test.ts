/**
 * The dimensions have to be TRUE, not just plausible.
 *
 * `dimensions.ts` makes factual claims in prose: that 2026-03-07T22:00Z is
 * hours before the US spring-forward, that 02:30 on 2026-03-08 never happens in
 * New York, that Asia/Kolkata has no DST. If any of those quietly stopped being
 * true - a tzdata update, a typo, a copied line - the sweep would still run and
 * still pass, while silently no longer covering the thing it claims to cover.
 * That is the worst possible failure for a QA harness: green, and meaningless.
 *
 * So every claim is re-derived here from Luxon on each run.
 */
import { DateTime, IANAZone } from 'luxon';
import { describe, expect, it } from 'vitest';

import {
  ASSERTED_TIMEZONES,
  AVAILABILITY_STATES,
  LEAD_TIME_BOUNDARY_CASES,
  LEAD_TIME_BOUNDARY_ZONE,
  LEAD_TIME_EXPRESSIONS,
  LOCALE_NOW_INSTANTS,
  LOCALE_PARITY_PAIRS,
  LOCALE_ZONES,
  NOW_INSTANTS,
  POLICIES,
  REJECTED_EXPRESSIONS,
  RELEASE_PROBE_LOCAL_DAY,
  RELEASE_PROBE_LOCAL_HOUR,
  RELEASE_SPECS,
  scriptedTextsOf,
  seededRandom,
  TIMEZONE_OVERRIDE_CASES,
  TIMEZONES,
  VALID_EXPRESSIONS,
} from './dimensions.js';
import { AMBIENT_SWEEP_TEXTS, declarationInconsistencies } from './claimOracle.js';
import {
  ALL_DECLARED_RELEASE_TEXTS,
  PROBE_DAY_FRIDAY,
  PROBE_DAY_SATURDAY,
  PROBE_DAY_THURSDAY,
  PROBE_HOUR,
  SWEEP_DECLARATIONS,
} from './releaseTexts.js';

describe('timezone dimension', () => {
  it.each(TIMEZONES)('$zone is a real IANA zone', ({ zone }) => {
    expect(zone === 'UTC' || IANAZone.isValidZone(zone)).toBe(true);
  });

  it('covers a half-hour offset, both hemispheres, and a no-DST zone', () => {
    const zones = TIMEZONES.map((timezone) => timezone.zone);
    expect(zones).toContain('America/New_York');
    expect(zones).toContain('Europe/London');
    expect(zones).toContain('Australia/Sydney');
    expect(zones).toContain('Asia/Kolkata');
    expect(zones).toContain('UTC');

    // The half-hour offset is the whole reason Kolkata is in the matrix.
    const kolkataOffset = DateTime.fromISO('2026-03-04T15:00:00.000Z', { zone: 'Asia/Kolkata' }).offset;
    expect(kolkataOffset % 60, 'Asia/Kolkata must have a non-whole-hour offset').not.toBe(0);
  });

  it.each(TIMEZONES.filter((timezone) => timezone.observesDst))(
    '$zone: the declared DST gap local time really does not exist',
    ({ zone, dstGapLocal }) => {
      const requested = dstGapLocal as string;
      const resolved = DateTime.fromISO(requested, { zone });
      // Luxon pushes a non-existent local time forward across the gap, so the
      // wall clock it lands on differs from the one that was asked for.
      expect(
        resolved.toFormat("yyyy-LL-dd'T'HH:mm"),
        `${requested} in ${zone} was expected to fall inside a DST gap`,
      ).not.toBe(requested);
    },
  );

  it.each(TIMEZONES.filter((timezone) => timezone.observesDst))(
    '$zone: the declared DST-ambiguous local time really does happen twice',
    ({ zone, dstAmbiguousLocal }) => {
      const requested = dstAmbiguousLocal as string;
      const resolved = DateTime.fromISO(requested, { zone });

      // Which of the two occurrences Luxon picks is zone-dependent - it
      // resolves New York's repeated hour to the EARLIER instant and Sydney's
      // to the LATER one. So "ambiguous" is asserted the way it is actually
      // defined: some OTHER instant an hour away shares this wall-clock time
      // under a different offset.
      const twin = [resolved.plus({ hours: 1 }), resolved.minus({ hours: 1 })].find(
        (candidate) =>
          candidate.toFormat('HH:mm') === resolved.toFormat('HH:mm') && candidate.offset !== resolved.offset,
      );

      expect(
        twin === undefined ? null : twin.toISO(),
        `${requested} in ${zone} was expected to occur twice when the clocks go back, but no second ` +
          'instant shares that wall-clock time',
      ).not.toBeNull();
    },
  );

  it.each(TIMEZONES.filter((timezone) => !timezone.observesDst))(
    '$zone genuinely has no DST, so it declares no gap or fold',
    ({ zone, dstGapLocal, dstAmbiguousLocal }) => {
      expect(dstGapLocal).toBeUndefined();
      expect(dstAmbiguousLocal).toBeUndefined();
      const january = DateTime.fromISO('2026-01-15T12:00:00.000Z', { zone }).offset;
      const july = DateTime.fromISO('2026-07-15T12:00:00.000Z', { zone }).offset;
      expect(january, `${zone} changes offset between January and July`).toBe(july);
    },
  );
});

describe('now-instant dimension', () => {
  it.each(NOW_INSTANTS)('$key is a valid UTC instant', ({ nowUtc }) => {
    expect(DateTime.fromISO(nowUtc, { zone: 'utc' }).isValid).toBe(true);
    expect(nowUtc).toMatch(/Z$/);
  });

  it('includes a Saturday, so "tomorrow" can land on a non-business day', () => {
    const weekend = NOW_INSTANTS.find((instant) => instant.key === 'n02-weekend');
    expect(DateTime.fromISO(weekend?.nowUtc as string, { zone: 'America/New_York' }).weekdayLong).toBe('Saturday');
  });

  it('includes a Friday afternoon in the contact zone', () => {
    const friday = NOW_INSTANTS.find((instant) => instant.key === 'n05-friday-pm-pre-eu-dst');
    const local = DateTime.fromISO(friday?.nowUtc as string, { zone: 'America/New_York' });
    expect(local.weekdayLong).toBe('Friday');
    expect(local.hour, 'must be an afternoon, not a morning').toBeGreaterThanOrEqual(12);
  });

  it('straddles the US spring-forward', () => {
    const before = NOW_INSTANTS.find((instant) => instant.key === 'n03-pre-us-dst')?.nowUtc as string;
    const after = NOW_INSTANTS.find((instant) => instant.key === 'n04-post-us-dst')?.nowUtc as string;
    const zone = 'America/New_York';
    expect(DateTime.fromISO(before, { zone }).isInDST, 'n03 should still be on standard time').toBe(false);
    expect(DateTime.fromISO(after, { zone }).isInDST, 'n04 should be on daylight time').toBe(true);
  });

  it('straddles the EU transition, on a different date from the US one', () => {
    const before = NOW_INSTANTS.find((instant) => instant.key === 'n05-friday-pm-pre-eu-dst')?.nowUtc as string;
    const after = NOW_INSTANTS.find((instant) => instant.key === 'n06-post-eu-dst')?.nowUtc as string;
    const zone = 'Europe/London';
    expect(DateTime.fromISO(before, { zone }).isInDST).toBe(false);
    expect(DateTime.fromISO(after, { zone }).isInDST).toBe(true);
    // And on that same pair New York has ALREADY transitioned - which is the
    // asymmetry a single hard-coded transition date would get wrong.
    expect(DateTime.fromISO(before, { zone: 'America/New_York' }).isInDST).toBe(true);
  });

  it('straddles the southern-hemisphere transition, in the other direction', () => {
    const before = NOW_INSTANTS.find((instant) => instant.key === 'n07-pre-au-dst-end')?.nowUtc as string;
    const after = NOW_INSTANTS.find((instant) => instant.key === 'n08-post-au-dst-end')?.nowUtc as string;
    const zone = 'Australia/Sydney';
    expect(DateTime.fromISO(before, { zone }).isInDST, 'AEDT before the April end').toBe(true);
    expect(DateTime.fromISO(after, { zone }).isInDST, 'AEST after it').toBe(false);
  });

  it('includes instants where "tomorrow" crosses a month boundary', () => {
    for (const key of ['n09-month-boundary-jan', 'n10-month-boundary-jun']) {
      const instant = NOW_INSTANTS.find((candidate) => candidate.key === key)?.nowUtc as string;
      const local = DateTime.fromISO(instant, { zone: 'America/New_York' });
      const inAWeek = local.plus({ days: 7 });
      expect(inAWeek.month, `${key}: a week ahead should be in the next month`).not.toBe(local.month);
    }
  });
});

describe('policy and availability dimensions', () => {
  it('spans genuinely different policies rather than four near-copies', () => {
    expect(new Set(POLICIES.map((policy) => policy.minLeadTimeMinutes)).size).toBeGreaterThan(2);
    expect(new Set(POLICIES.map((policy) => policy.maxSchedulingHorizonDays)).size).toBeGreaterThan(2);
    expect(new Set(POLICIES.map((policy) => policy.businessHoursStartLocal)).size).toBeGreaterThan(1);
    // Exactly one policy withholds tools, and it withholds schedule_meeting.
    const restricted = POLICIES.filter((policy) => policy.allowedTools !== undefined);
    expect(restricted).toHaveLength(1);
    expect(restricted[0]?.allowedTools).not.toContain('schedule_meeting');
  });

  it('describes free, exact, partial and adjacent relative to a 14:00-15:00 slot', () => {
    const named = Object.fromEntries(AVAILABILITY_STATES.map((state) => [state.key, state.window]));
    expect(named['a1-free']).toBeNull();
    expect(named['a2-exact-conflict']).toEqual({ startLocal: '14:00', endLocal: '15:00' });
    // Overlapping the back half, not the front - a start-time-only comparison
    // would miss this one.
    expect(named['a3-partial-overlap']).toEqual({ startLocal: '14:30', endLocal: '15:30' });
    // Starts exactly where the slot ends: half-open, so NOT a conflict.
    expect(named['a4-adjacent']).toEqual({ startLocal: '15:00', endLocal: '16:00' });
  });
});

describe('the timezone-override dimension', () => {
  it('asserts zones the contact is NOT in, so the axis is genuinely crossed', () => {
    const contactZones = new Set(TIMEZONES.map((timezone) => timezone.zone));
    const differing = ASSERTED_TIMEZONES.filter((zone) => !contactZones.has(zone));
    expect(
      differing.length,
      'at least one asserted zone must appear nowhere in the contact-zone axis, or every scenario could ' +
        'be asserting the zone the contact is already in',
    ).toBeGreaterThan(0);
    for (const zone of ASSERTED_TIMEZONES) {
      expect(zone === 'UTC' || IANAZone.isValidZone(zone), `${zone} is not a real IANA zone`).toBe(true);
    }
  });

  // The whole point of the committed cases is a claim about the CONTACT'S clock,
  // and that claim is a pure tzdata fact. Re-derived here so a tzdata update
  // cannot leave a stale expectation sitting in `dimensions.ts` looking correct.
  it.each(TIMEZONE_OVERRIDE_CASES)(
    '$key: $whenLocal in $assertedZone really is $contactLocalWallClock in $contactZone',
    ({ whenLocal, assertedZone, contactZone, contactLocalWallClock }) => {
      const asserted = DateTime.fromISO(whenLocal, { zone: assertedZone });
      expect(asserted.isValid, `${whenLocal} is not a valid local time in ${assertedZone}`).toBe(true);
      expect(asserted.setZone(contactZone).toFormat('yyyy-LL-dd HH:mm')).toBe(contactLocalWallClock);
    },
  );

  // And the DIRECTION follows from the policy window rather than from an author's
  // memory. `p1-default` is 09:00-17:00 Monday-Friday, windows are half-open, and
  // the default slot is 30 minutes.
  it.each(TIMEZONE_OVERRIDE_CASES)(
    '$key: the declared direction follows from where that lands in the p1 window',
    ({ contactLocalWallClock, direction }) => {
      const policy = POLICIES.find((candidate) => candidate.key === 'p1-default');
      const open = Number(policy?.businessHoursStartLocal.slice(0, 2)) * 60;
      const close = Number(policy?.businessHoursEndLocal.slice(0, 2)) * 60;
      const local = DateTime.fromFormat(contactLocalWallClock, 'yyyy-LL-dd HH:mm', { zone: 'UTC' });
      const minutes = local.hour * 60 + local.minute;
      const isBusinessDay = local.weekday <= 5;
      const inside = isBusinessDay && minutes >= open && minutes + 30 <= close;
      expect(inside ? 'ACCEPT' : 'REJECT').toBe(direction);
    },
  );
});

describe('the lead-time boundary dimension', () => {
  it('carries SECONDS, which is the whole reason it exists alongside NOW_INSTANTS', () => {
    for (const instant of NOW_INSTANTS) {
      expect(
        DateTime.fromISO(instant.nowUtc, { zone: 'utc' }).second,
        `${instant.key} is on a whole minute, so it can never probe a sub-minute rounding bug`,
      ).toBe(0);
    }
    const withSeconds = LEAD_TIME_BOUNDARY_CASES.filter(
      (boundary) => DateTime.fromISO(boundary.nowUtc, { zone: 'utc' }).second !== 0,
    );
    expect(withSeconds.length, 'the boundary family must include instants that are NOT on a whole minute')
      .toBeGreaterThan(2);
  });

  it.each(LEAD_TIME_BOUNDARY_CASES)(
    '$key: the true lead really is $leadSeconds seconds, and the direction follows from the 30-minute minimum',
    ({ nowUtc, whenLocal, leadSeconds, direction }) => {
      const minimumMinutes = POLICIES.find((policy) => policy.key === 'p1-default')?.minLeadTimeMinutes as number;
      const start = DateTime.fromISO(whenLocal, { zone: LEAD_TIME_BOUNDARY_ZONE });
      expect(start.isValid, `${whenLocal} is not valid in ${LEAD_TIME_BOUNDARY_ZONE}`).toBe(true);

      const actual = (start.toMillis() - DateTime.fromISO(nowUtc, { zone: 'utc' }).toMillis()) / 1000;
      expect(actual, 'the declared lead must be the real one').toBe(leadSeconds);
      expect(actual >= minimumMinutes * 60 ? 'ACCEPT' : 'REJECT').toBe(direction);
    },
  );
});

describe('the locale dimensions', () => {
  it('every locale zone is a real IANA zone, and Asia/Jerusalem is one of them', () => {
    for (const { zone } of LOCALE_ZONES) {
      expect(IANAZone.isValidZone(zone), `${zone} is not a real IANA zone`).toBe(true);
    }
    expect(
      LOCALE_ZONES.map((locale) => locale.zone),
      'the zone the § 8.3 defect was found in must be in the matrix',
    ).toContain('Asia/Jerusalem');
  });

  it('the locale zones add something the main timezone axis does not have', () => {
    // If every locale zone were already in `TIMEZONES` the family-local axis
    // would be pure cost. Two of the three are new, and the shared one is
    // deliberate - see the comment above `LOCALE_ZONES`.
    const swept = new Set(TIMEZONES.map((timezone) => timezone.zone));
    const added = LOCALE_ZONES.filter((locale) => !swept.has(locale.zone));
    expect(added.length, 'the locale axis must cross at least two zones the main axis never reaches')
      .toBeGreaterThanOrEqual(2);
    expect(LOCALE_ZONES.some((locale) => swept.has(locale.zone)), 'and at least one shared with it, as a control')
      .toBe(true);
  });

  it('Asia/Jerusalem transitions on its OWN dates, which is why it earns a place', () => {
    // Israel moves on neither the US date (2026-03-08) nor the EU one
    // (2026-03-29). A suite that knew only those two would ship an Israeli
    // off-by-one hour with every test green.
    const zone = 'Asia/Jerusalem';
    expect(DateTime.fromISO('2026-03-20T12:00:00.000Z', { zone }).isInDST, 'still winter time on 20 March').toBe(
      false,
    );
    expect(DateTime.fromISO('2026-03-28T12:00:00.000Z', { zone }).isInDST, 'summer time by 28 March').toBe(true);
    // And on 20 March New York has ALREADY transitioned.
    expect(DateTime.fromISO('2026-03-20T12:00:00.000Z', { zone: 'America/New_York' }).isInDST).toBe(true);
  });

  it('every locale `now` is a valid UTC instant, and one puts the contact on another calendar day', () => {
    for (const instant of LOCALE_NOW_INSTANTS) {
      expect(DateTime.fromISO(instant.nowUtc, { zone: 'utc' }).isValid).toBe(true);
      expect(instant.nowUtc).toMatch(/Z$/);
    }
    const across = LOCALE_NOW_INSTANTS.find((instant) => instant.key === 'ln2-across-local-midnight')
      ?.nowUtc as string;
    expect(DateTime.fromISO(across, { zone: 'America/New_York' }).toFormat('yyyy-LL-dd')).toBe('2026-03-04');
    expect(DateTime.fromISO(across, { zone: 'utc' }).toFormat('yyyy-LL-dd')).toBe('2026-03-05');
  });

  it('every parity pair names an expression that really is in the expression dimensions', () => {
    const declared = new Set(
      [...VALID_EXPRESSIONS, ...REJECTED_EXPRESSIONS, ...LEAD_TIME_EXPRESSIONS].map(
        (expression) => expression.key,
      ),
    );
    for (const pair of LOCALE_PARITY_PAIRS) {
      expect(declared.has(pair.expressionKey), `${pair.key} points at unknown expression ${pair.expressionKey}`)
        .toBe(true);
    }
  });

  it('every parity pair carries the SAME raw text as the expression it names', () => {
    // Otherwise family L would be sweeping one string while the dimension
    // table documented another, and the report's `expression` axis would lie.
    const byKey = new Map(
      [...VALID_EXPRESSIONS, ...REJECTED_EXPRESSIONS, ...LEAD_TIME_EXPRESSIONS].map(
        (expression) => [expression.key, expression.raw] as const,
      ),
    );
    for (const pair of LOCALE_PARITY_PAIRS) {
      expect(byKey.get(pair.expressionKey), pair.key).toBe(pair.hebrew);
    }
  });

  it('a pair that is NOT identical must say why, and one that is must not', () => {
    for (const pair of LOCALE_PARITY_PAIRS) {
      if (pair.identical) {
        expect(pair.whyNotIdentical, `${pair.key} is identical, so it must carry no exception text`)
          .toBeUndefined();
      } else {
        expect(
          pair.whyNotIdentical,
          `${pair.key} is declared NOT identical. An undocumented exception is indistinguishable from ` +
            'an untested one.',
        ).toBeTruthy();
        expect((pair.whyNotIdentical as string).length).toBeGreaterThan(80);
      }
    }
  });

  it('the parity list is mostly identical pairs, or INV-16 would be near-vacuous', () => {
    const identical = LOCALE_PARITY_PAIRS.filter((pair) => pair.identical);
    expect(identical.length).toBeGreaterThanOrEqual(6);
    expect(identical.length / LOCALE_PARITY_PAIRS.length).toBeGreaterThan(0.5);
  });

  it('the two sides of every pair are genuinely different strings, in different scripts', () => {
    const hebrewLetters = /[֐-׿]/;
    for (const pair of LOCALE_PARITY_PAIRS) {
      expect(pair.hebrew, pair.key).not.toBe(pair.english);
      expect(hebrewLetters.test(pair.hebrew), `${pair.key}: the "hebrew" side contains no Hebrew`).toBe(true);
      expect(hebrewLetters.test(pair.english), `${pair.key}: the "english" side contains Hebrew`).toBe(false);
    }
  });

  it('the locale expressions cover every class the regression brief names', () => {
    const locale = [...VALID_EXPRESSIONS, ...REJECTED_EXPRESSIONS, ...LEAD_TIME_EXPRESSIONS].filter(
      (expression) => expression.locales !== undefined,
    );
    const hebrewLetters = /[֐-׿]/;

    // Hebrew-bearing, code-switched, and unknown-language expressions all
    // present, in both the accept and the refuse direction.
    expect(locale.filter((expression) => expression.locales?.includes('he')).length).toBeGreaterThanOrEqual(8);
    expect(locale.filter((expression) => (expression.locales ?? []).length === 2).length).toBeGreaterThanOrEqual(2);
    expect(locale.filter((expression) => (expression.locales ?? []).length === 0).length).toBeGreaterThanOrEqual(4);
    expect(locale.filter((expression) => expression.direction === 'EITHER').length).toBeGreaterThanOrEqual(6);
    expect(locale.filter((expression) => expression.direction === 'REJECT').length).toBeGreaterThanOrEqual(8);

    // An expression declaring `['he']` must actually contain Hebrew, and one
    // declaring `[]` must contain none of it.
    for (const expression of locale) {
      if (expression.locales?.includes('he')) {
        expect(hebrewLetters.test(expression.raw), `${expression.key} declares he but has no Hebrew`).toBe(true);
      }
      if ((expression.locales ?? []).length === 0) {
        expect(hebrewLetters.test(expression.raw), `${expression.key} declares no locale but has Hebrew`).toBe(
          false,
        );
      }
    }
  });

  it('every dimension entry still carries a rationale that explains itself', () => {
    // The style rule this file is built on: a dimension without a reason is a
    // dimension nobody can review.
    const everything: { key: string; rationale: string }[] = [
      ...VALID_EXPRESSIONS,
      ...REJECTED_EXPRESSIONS,
      ...LEAD_TIME_EXPRESSIONS,
      ...LOCALE_ZONES,
      ...LOCALE_NOW_INSTANTS,
      ...LOCALE_PARITY_PAIRS,
    ];
    // 30 characters, not 40: `x07-asap` says "Intent with no time in it at
    // all." in 33 and that genuinely is the whole explanation. The bar is set
    // where it catches an empty or placeholder string, not where it rewards
    // padding.
    for (const entry of everything) {
      expect(entry.rationale.length, `${entry.key} has a rationale too short to explain anything`)
        .toBeGreaterThan(30);
    }
  });
});

describe('the seeded PRNG', () => {
  it('produces the same stream for the same seed, and a different one otherwise', () => {
    const a = seededRandom(20260923);
    const b = seededRandom(20260923);
    const c = seededRandom(20260924);
    const streamA = Array.from({ length: 8 }, () => a());
    const streamB = Array.from({ length: 8 }, () => b());
    const streamC = Array.from({ length: 8 }, () => c());
    expect(streamA).toEqual(streamB);
    expect(streamA).not.toEqual(streamC);
    for (const value of streamA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

/**
 * The release specs have to DECLARE what they forbid, not leave it to be inferred.
 *
 * `invariants.ts` used to work out which of a spec's texts was the false one by
 * running `detectMaterialClaims` over them - so a wording the DETECTOR missed was
 * dropped from the forbidden list and could not be reported as having escaped. The
 * effect was that INV-18 certified a live fail-open detector gap as zero leaks while
 * eight unsupported claims reached real callers
 * (`docs/MISSION_2D_CLAIM_GATE.md` § 15). `ReleaseSpec.forbidden` names the strings
 * instead, and these assertions are what stop the naming from going stale.
 */
describe('the claim-release specs', () => {
  const notReleased = RELEASE_SPECS.filter((spec) => spec.expect === 'NOT_RELEASED');

  it('has NOT_RELEASED specs at all, so the escape check is exercised', () => {
    expect(notReleased.length).toBeGreaterThanOrEqual(15);
  });

  it.each(notReleased)('$key names the exact wording it forbids', (spec) => {
    expect(
      spec.forbidden ?? [],
      `${spec.key} is NOT_RELEASED but forbids nothing, so INV-18 has nothing to keep away from the caller`,
    ).not.toEqual([]);
  });

  it.each(notReleased)('$key forbids only strings it actually scripts', (spec) => {
    // Otherwise a spec could forbid a sentence no model in it ever says and pass
    // for ever. Checked as SET MEMBERSHIP against the spec's own texts, so an edit
    // to the wording that forgets to update `forbidden` fails here by name.
    const scripted = scriptedTextsOf(spec);
    for (const declared of spec.forbidden ?? []) {
      expect(
        scripted,
        `${spec.key} forbids ${JSON.stringify(declared.text)}, which it never scripts`,
      ).toContain(declared.text);
    }
  });

  it.each(notReleased)('$key leaves at least one honest text releasable', (spec) => {
    // The other half, and the reason `forbidden` is a subset rather than the whole
    // array: a spec that forbade everything it says would be indistinguishable from
    // `WITHHELD`, and `r08` is the spec that means that.
    const scripted = scriptedTextsOf(spec);
    const forbidden = (spec.forbidden ?? []).map((declared) => declared.text);
    expect(
      scripted.filter((text) => !forbidden.includes(text)).length,
      `${spec.key} forbids every text it scripts, which is WITHHELD rather than NOT_RELEASED`,
    ).toBeGreaterThan(0);
  });

  it('declares `forbidden` for NOT_RELEASED specs and for nothing else', () => {
    for (const spec of RELEASE_SPECS) {
      if (spec.expect === 'NOT_RELEASED') continue;
      expect(
        spec.forbidden,
        `${spec.key} is ${spec.expect} but names forbidden wording, which nothing reads`,
      ).toBeUndefined();
    }
  });
});

/**
 * EVERY SCRIPTED SENTENCE IS DECLARED, AND THE DECLARATION IS WHAT INV-18 READS.
 *
 * `tsc` enforces the first half: `withToolCall` and `afterToolResult` are typed
 * `DeclaredText`, so a bare string does not compile. These assertions enforce the
 * parts a type cannot - that the index INV-18 actually looks a released sentence
 * up in contains every sentence the sweep can release, and that the declarations
 * themselves are internally honest.
 *
 * Why it matters more than it looks: INV-18 treats an UNDECLARED released text as
 * a violation. If `ALL_DECLARED_RELEASE_TEXTS` fell behind `RELEASE_SPECS`, the
 * whole sweep would go red rather than quietly passing - which is the right
 * direction, and these tests are what make the failure legible instead.
 */
describe('the declared ground truth behind INV-18', () => {
  it('covers every sentence any release spec scripts', () => {
    const missing: string[] = [];
    for (const spec of RELEASE_SPECS) {
      for (const text of scriptedTextsOf(spec)) {
        if (!SWEEP_DECLARATIONS.has(text)) missing.push(`${spec.key}: ${JSON.stringify(text)}`);
      }
    }
    expect(
      missing,
      'These scripted sentences are not in ALL_DECLARED_RELEASE_TEXTS, so INV-18 would fail every scenario ' +
        'that releases them as UNDECLARED. Add them to tests/invariants/releaseTexts.ts with their ground ' +
        'truth beside the sentence.',
    ).toEqual([]);
  });

  it('covers the two sentences families A-L release, which is ~95% of all releases', () => {
    // These come from the runner and from ScriptedLlmProvider's own fallback
    // rather than from any spec, so nothing above would notice if they were
    // dropped - and they are the most frequently released sentences in the sweep.
    // If the provider's `finalText` default ever changed, the sweep would go RED
    // rather than quiet: INV-18 treats an undeclared released sentence as a
    // violation, which is the direction that makes a drift visible.
    for (const declared of AMBIENT_SWEEP_TEXTS) {
      expect(SWEEP_DECLARATIONS.has(declared.text), `${JSON.stringify(declared.text)} is undeclared`).toBe(true);
    }
    expect(AMBIENT_SWEEP_TEXTS.length).toBe(2);
  });

  it('lists no declaration that no spec and no ambient text uses', () => {
    // The other direction. A stale declaration is harmless to the sweep and
    // corrosive to a reader: it reads as coverage of a sentence nothing says.
    const used = new Set<string>(AMBIENT_SWEEP_TEXTS.map((declared) => declared.text));
    for (const spec of RELEASE_SPECS) for (const text of scriptedTextsOf(spec)) used.add(text);
    const orphans = ALL_DECLARED_RELEASE_TEXTS.map((declared) => declared.text).filter((text) => !used.has(text));
    expect(orphans, 'declared but scripted nowhere').toEqual([]);
  });

  it.each(ALL_DECLARED_RELEASE_TEXTS)('$text is internally consistent', (declared) => {
    expect(declarationInconsistencies(declared.declares)).toEqual([]);
  });

  it('declares at least one sentence in each effect family the specs exercise', () => {
    // Non-vacuity on the AXIS rather than on the count, which is the § 17.2
    // lesson: fifty declarations of the same family would satisfy a size floor
    // and prove nothing about the classes that actually leaked.
    const families = new Set<string>();
    for (const declared of ALL_DECLARED_RELEASE_TEXTS) {
      for (const assertion of declared.declares.assertions) families.add(assertion.family);
    }
    for (const required of ['MEETING', 'CALLBACK', 'CANCELLATION', 'MESSAGE', 'HANDOVER']) {
      expect(families, `no declared sentence asserts ${required}`).toContain(required);
    }
  });

  it('declares sentences on BOTH sides of the honest/false line', () => {
    const material = ALL_DECLARED_RELEASE_TEXTS.filter((d) => d.declares.assertsMaterialEffect);
    const silent = ALL_DECLARED_RELEASE_TEXTS.filter((d) => !d.declares.assertsMaterialEffect);
    // A corpus of declarations that all said "asserts something" would make the
    // oracle a machine for failing every release, and one that all said "asserts
    // nothing" would make it silent. Both halves have to exist.
    expect(material.length).toBeGreaterThanOrEqual(30);
    expect(silent.length).toBeGreaterThanOrEqual(5);
  });

  it('agrees with dimensions.ts about which absolute day the probe resolves to', () => {
    // The declarations name absolute dates so that no resolver stands between a
    // sentence and its ground truth. This is the drift alarm for that choice:
    // `dimensions.test.ts` above re-derives the probe target from Luxon, and
    // RELEASE_PROBE_LOCAL_DAY is what it checks.
    expect(PROBE_DAY_THURSDAY).toBe(RELEASE_PROBE_LOCAL_DAY);
    expect(PROBE_HOUR).toBe(RELEASE_PROBE_LOCAL_HOUR);
    // Friday and Saturday are one and two days after the probe day, in a zone
    // where the probe day is not near a month end - checked arithmetically so a
    // future change of BASELINE_NOW cannot leave them silently wrong.
    expect(DateTime.fromISO(PROBE_DAY_THURSDAY).plus({ days: 1 }).toFormat('yyyy-LL-dd')).toBe(PROBE_DAY_FRIDAY);
    expect(DateTime.fromISO(PROBE_DAY_THURSDAY).plus({ days: 2 }).toFormat('yyyy-LL-dd')).toBe(PROBE_DAY_SATURDAY);
  });

  it('exercises the no-punctuation suppression shape in the sweep, across both languages', () => {
    // QA-3, deliverable (d). The sweep had 500 generated cross-clause rows and
    // every one of its ten joiners was punctuation or an English conjunction, so
    // the one joiner a model actually takes - none at all - was the axis nobody
    // crossed (docs/MISSION_2D_CLAIM_GATE.md § 17.2). Asserted on the AXIS
    // VALUES rather than on a count, for the same reason.
    const fillerSpecs = RELEASE_SPECS.filter((spec) => /^r4[1-9]|^r5[01]/.test(spec.key));
    expect(fillerSpecs.length).toBeGreaterThanOrEqual(11);

    const scripted = fillerSpecs.flatMap((spec) => scriptedTextsOf(spec));
    // A no-punctuation Hebrew filler, a no-punctuation English one, the comma
    // control, and an honest negation behind the same filler in each language.
    expect(scripted).toContain('אין בעיה הפגישה נקבעה ליום שישי בשעה 14:00.');
    expect(scripted).toContain("Don't worry your meeting is booked for Friday at 2pm.");
    expect(scripted).toContain('אין בעיה, הפגישה נקבעה ליום שישי בשעה 14:00.');
    expect(scripted).toContain('אין בעיה הפגישה לא נקבעה עדיין.');
    expect(scripted).toContain("Don't worry nothing is booked yet.");

    // Three effect families, so the class is not proved one family wide.
    const families = new Set<string>();
    for (const text of scripted) {
      for (const assertion of SWEEP_DECLARATIONS.get(text)?.assertions ?? []) families.add(assertion.family);
    }
    expect(families).toContain('MEETING');
    expect(families).toContain('CANCELLATION');
    expect(families).toContain('CALLBACK');

    // And both directions: wordings that must be kept away from the caller, and
    // wordings that must be released. A block with only the first half would
    // prove the gate can be made strict and nothing about whether it is usable.
    expect(fillerSpecs.some((spec) => spec.expect === 'NOT_RELEASED')).toBe(true);
    expect(fillerSpecs.some((spec) => spec.expect === 'RELEASED')).toBe(true);
    expect(fillerSpecs.some((spec) => spec.expect === 'EITHER')).toBe(true);
  });
});
