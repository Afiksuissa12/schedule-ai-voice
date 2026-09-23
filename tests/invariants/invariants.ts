/**
 * THE INVARIANTS: properties that must hold for EVERY scenario in the sweep.
 *
 * An invariant is not an expected value. It is a sentence that stays true no
 * matter which of the 509 inputs produced the state being examined - "IF a
 * meeting was persisted THEN it sits inside the configured business hours",
 * never "scenario B-mt-nyc-n01 books 2026-03-05T19:00Z". That conditional shape
 * is what lets one function police a matrix that no one could enumerate by
 * hand, and it is the part of the legacy harness's philosophy worth carrying
 * forward.
 *
 * INDEPENDENT ORACLES, ON PURPOSE
 * ---------------------------------------------------------------------------
 * Several checks here re-derive with Luxon something `src/scheduling` also
 * computes - business-hours containment and interval overlap in particular.
 * That duplication is deliberate and it is NOT the "do not reimplement domain
 * logic in tests" that the mission forbids. The forbidden thing is
 * reimplementing the resolver in order to PREDICT what the system will output,
 * because then the test only proves two copies of the same idea agree. What
 * happens here is the opposite: the system produces a row by whatever route it
 * likes, and an independent, deliberately naive reader then checks a property
 * of that row. If `checkBusinessHours` had an off-by-one, calling it here would
 * hide the bug; measuring the persisted row with a different tool finds it.
 *
 * Checks that would require predicting an outcome are simply not asserted. The
 * sweep reports what happened instead, and `report.ts` surfaces the
 * distribution so a reviewer can see the corpus is not all refusals.
 */
import { DateTime, IANAZone } from 'luxon';

import { ValidationProvenanceSchema } from '../../src/domain/provenance.js';
import { NON_DECISION_MAKER_SCORE_CEILING } from '../../src/agent/tools/qualificationRubric.js';
import { VALIDATION_ERROR_CODES } from '../../src/ports/validation.js';
import type { ScenarioObservation } from './runner.js';
import type { Scenario } from './scenarios.js';

/** One invariant's verdict for one scenario. */
export interface InvariantResult {
  readonly invariant: string;
  readonly scenarioId: string;
  /** False only for a genuine violation. */
  readonly passed: boolean;
  /**
   * True when the invariant had nothing to examine - e.g. a meeting invariant
   * on a scenario that persisted no meeting. Tracked separately from `passed`
   * so the report can never present "nothing to check" as evidence of health.
   */
  readonly applicable: boolean;
  readonly detail: string;
}

export interface Invariant {
  readonly id: string;
  readonly title: string;
  /** Why this property must hold. Reproduced in the sweep report. */
  readonly because: string;
  check(observation: ScenarioObservation, scenario: Scenario): InvariantResult[];
}

// ---------------------------------------------------------------------------
// Small helpers. Kept deliberately obvious - an oracle nobody can read is not
// an oracle.
// ---------------------------------------------------------------------------

function pass(invariant: string, scenarioId: string, detail: string): InvariantResult {
  return { invariant, scenarioId, passed: true, applicable: true, detail };
}

function fail(invariant: string, scenarioId: string, detail: string): InvariantResult {
  return { invariant, scenarioId, passed: false, applicable: true, detail };
}

function notApplicable(invariant: string, scenarioId: string, detail: string): InvariantResult {
  return { invariant, scenarioId, passed: true, applicable: false, detail };
}

/** A real IANA zone name, per the tz database - not an offset like `-05:00`. */
function isRealIanaZone(zone: string): boolean {
  if (zone === 'UTC') return true;
  if (/^[+-]\d{2}:?\d{2}$/.test(zone)) return false;
  return IANAZone.isValidZone(zone);
}

/** Do `[aStart, aEnd)` and `[bStart, bEnd)` share any instant? */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return (
    DateTime.fromISO(bStart).toMillis() < DateTime.fromISO(aEnd).toMillis() &&
    DateTime.fromISO(bEnd).toMillis() > DateTime.fromISO(aStart).toMillis()
  );
}

interface BusinessWindow {
  readonly isoWeekday: number;
  readonly startLocal: string;
  readonly endLocal: string;
}

function windowsFrom(businessHoursJson: string): {
  windows: BusinessWindow[];
  timezone: string | undefined;
  holidays: string[];
} {
  const parsed = JSON.parse(businessHoursJson) as {
    windows?: BusinessWindow[];
    timezone?: string;
    holidayDatesLocal?: string[];
  };
  return {
    windows: parsed.windows ?? [],
    timezone: parsed.timezone,
    holidays: parsed.holidayDatesLocal ?? [],
  };
}

function minutesOf(localTime: string): number {
  const [hours, minutes] = localTime.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Every event whose `detailJson` carries a `code`, paired with that code. */
function codesInAudit(observation: ScenarioObservation, types: readonly string[]): string[] {
  const codes: string[] = [];
  for (const event of observation.auditEvents) {
    if (!types.includes(event.type)) continue;
    try {
      const detail = JSON.parse(event.detailJson) as { code?: unknown };
      if (typeof detail.code === 'string') codes.push(detail.code);
    } catch {
      // A malformed detailJson is itself a finding; INV-06 reports it as a
      // missing code rather than throwing here.
    }
  }
  return codes;
}

/** Is `expected` an ordered subsequence of `types`? (Not adjacency.) */
export function containsInOrder(types: readonly string[], expected: readonly string[]): boolean {
  if (expected.length === 0) return true;
  let cursor = 0;
  for (const type of types) {
    if (type === expected[cursor]) cursor += 1;
    if (cursor === expected.length) return true;
  }
  return false;
}

function sameCounts(a: Record<string, number>, b: Record<string, number>): string[] {
  const differences: string[] = [];
  for (const key of Object.keys(a)) {
    if (a[key] !== b[key]) differences.push(`${key}: ${a[key]} -> ${b[key]}`);
  }
  return differences;
}

// ---------------------------------------------------------------------------
// INV-01
// ---------------------------------------------------------------------------

const futureActionIsFutureDated: Invariant = {
  id: 'INV-01-followup-is-validated-future-instant',
  title: "Every persisted FutureAction is scheduled strictly after the validator's `now`, in a real IANA zone",
  because:
    "The Founder's headline property: a promised callback that is not in the future is a promise the " +
    'system cannot keep, and a zone that is really a UTC offset carries no DST rule, so next March it ' +
    'would fire an hour out.',
  check(observation, scenario) {
    if (observation.futureActions.length === 0) {
      return [notApplicable(this.id, observation.scenarioId, 'no FutureAction persisted')];
    }
    return observation.futureActions.map((action) => {
      // WHY NOT `createdAt`
      // -------------------------------------------------------------------
      // The mission words this invariant as "scheduledForUtc strictly greater
      // than its createdAt". Read literally against this schema that compares
      // two different KINDS of time, and it fails for every row in the sweep.
      //
      // The foundation deliberately separates the two, and `AuditEvent` shows
      // the pattern explicitly by carrying BOTH: `occurredAt` is domain time
      // and comes from the injected `Clock`, while `createdAt` is
      // `@default(now())` - the physical instant the row reached the disk.
      // Under a `FixedClock` set to March 2026 those diverge by design: the
      // row is inserted at the real wall clock, whatever today happens to be.
      //
      // So the domain time a follow-up was decided at is not `createdAt`; it
      // is `ValidationProvenance.nowUtc`, the exact instant the validator
      // measured the proposal against. That is what this asserts, and it is
      // the STRONGER claim - it pins the follow-up to the validated `now`
      // rather than to whenever the insert happened to land. It is also
      // cross-checked against the scenario's own clock setting below, so the
      // system cannot satisfy it by writing a convenient receipt.
      //
      // This divergence was reported to MISSION-48d6ff04-AUTO-FOUNDATION and
      // is recorded in docs/DECISIONS.md.
      const provenance = ValidationProvenanceSchema.safeParse(JSON.parse(action.validationProvenanceJson));
      if (!provenance.success) {
        return fail(
          this.id,
          observation.scenarioId,
          `FutureAction ${action.id} has no readable provenance to establish the decision instant`,
        );
      }

      const scheduled = DateTime.fromISO(action.scheduledForUtc).toMillis();
      const decidedAt = DateTime.fromISO(provenance.data.nowUtc).toMillis();
      if (!(scheduled > decidedAt)) {
        return fail(
          this.id,
          observation.scenarioId,
          `FutureAction ${action.id}: scheduledForUtc ${action.scheduledForUtc} is not strictly after the ` +
            `validated now ${provenance.data.nowUtc}`,
        );
      }
      // Independently sourced: the clock the turn actually ran at, from the
      // scenario definition rather than from anything the system wrote.
      if (!(scheduled > DateTime.fromISO(scenario.nowUtc).toMillis())) {
        return fail(
          this.id,
          observation.scenarioId,
          `FutureAction ${action.id}: scheduledForUtc ${action.scheduledForUtc} is not strictly after the ` +
            `scenario's now ${scenario.nowUtc}`,
        );
      }
      if (!isRealIanaZone(action.timezone)) {
        return fail(
          this.id,
          observation.scenarioId,
          `FutureAction ${action.id}: timezone "${action.timezone}" is not a real IANA zone`,
        );
      }
      return pass(
        this.id,
        observation.scenarioId,
        `FutureAction ${action.id} at ${action.scheduledForUtc} (${action.timezone}), decided at ` +
          provenance.data.nowUtc,
      );
    });
  },
};

// ---------------------------------------------------------------------------
// INV-02
// ---------------------------------------------------------------------------

const meetingIsWellFormedAndInHours: Invariant = {
  id: 'INV-02-meeting-bounds-and-business-hours',
  title: 'Every persisted Meeting has startUtc < endUtc, a real IANA zone, and sits inside configured hours',
  because:
    'A meeting outside the hours the organization configured is the 6am sales call the policy exists to ' +
    'prevent, and it must be impossible to reach through any combination of zone, DST and phrasing.',
  check(observation) {
    if (observation.meetings.length === 0) {
      return [notApplicable(this.id, observation.scenarioId, 'no Meeting persisted')];
    }
    const { windows, timezone: policyZone, holidays } = windowsFrom(observation.businessHoursJson);

    return observation.meetings.map((meeting) => {
      if (!(DateTime.fromISO(meeting.startUtc) < DateTime.fromISO(meeting.endUtc))) {
        return fail(
          this.id,
          observation.scenarioId,
          `Meeting ${meeting.id}: startUtc ${meeting.startUtc} is not before endUtc ${meeting.endUtc}`,
        );
      }
      if (!isRealIanaZone(meeting.timezone)) {
        return fail(
          this.id,
          observation.scenarioId,
          `Meeting ${meeting.id}: timezone "${meeting.timezone}" is not a real IANA zone`,
        );
      }

      // Business hours are wall-clock, and are read in the policy's own zone
      // when it names one, otherwise in the CONTACT'S PERSISTED zone.
      //
      // This used to read `policyZone ?? meeting.timezone`, and that was the
      // oracle agreeing with the bug rather than catching it. `Meeting.timezone`
      // is the zone the slot was AGREED in, which a model can influence through
      // the optional `timezone` argument - so measuring the window in it asks
      // "was this inside business hours according to the zone whoever booked it
      // nominated?", which is always yes. `observation.contact.timezone` comes
      // off the contact row and the model cannot reach it. See INV-14.
      const zone = policyZone ?? observation.contact.timezone;
      const startLocal = DateTime.fromISO(meeting.startUtc, { zone });
      const endLocal = DateTime.fromISO(meeting.endUtc, { zone });
      const date = startLocal.toFormat('yyyy-LL-dd');

      if (holidays.includes(date)) {
        return fail(this.id, observation.scenarioId, `Meeting ${meeting.id} lands on configured holiday ${date}`);
      }

      const sameDay = windows.filter((window) => window.isoWeekday === startLocal.weekday);
      if (sameDay.length === 0) {
        return fail(
          this.id,
          observation.scenarioId,
          `Meeting ${meeting.id} is on ${startLocal.weekdayLong} (${date} ${zone}), which has no ` +
            `configured business-hours window`,
        );
      }
      if (endLocal.toFormat('yyyy-LL-dd') !== date) {
        return fail(
          this.id,
          observation.scenarioId,
          `Meeting ${meeting.id} runs past local midnight (${startLocal.toISO()} -> ${endLocal.toISO()})`,
        );
      }

      const startMinutes = startLocal.hour * 60 + startLocal.minute;
      const endMinutes = endLocal.hour * 60 + endLocal.minute;
      const fits = sameDay.some(
        (window) =>
          startMinutes >= minutesOf(window.startLocal) &&
          startMinutes < minutesOf(window.endLocal) &&
          endMinutes <= minutesOf(window.endLocal),
      );
      if (!fits) {
        return fail(
          this.id,
          observation.scenarioId,
          `Meeting ${meeting.id} at ${startLocal.toFormat('ccc HH:mm')}-${endLocal.toFormat('HH:mm')} ${zone} ` +
            `fits no configured window (${sameDay.map((w) => `${w.startLocal}-${w.endLocal}`).join(', ')})`,
        );
      }
      return pass(
        this.id,
        observation.scenarioId,
        `Meeting ${meeting.id} at ${startLocal.toFormat('ccc HH:mm')} ${zone}`,
      );
    });
  },
};

// ---------------------------------------------------------------------------
// INV-03
// ---------------------------------------------------------------------------

const meetingDoesNotOverlapBusy: Invariant = {
  id: 'INV-03-no-meeting-over-a-busy-interval',
  title: 'No persisted Meeting overlaps a BusyInterval the AvailabilityProvider reports for its window',
  because:
    'Double-booking is the failure a customer notices first. The legacy prototype invented availability, ' +
    'so it could never prove a clash was detected rather than imagined; here the provider is asked again, ' +
    'after the fact, over the exact window that was booked.',
  check(observation) {
    if (observation.meetings.length === 0) {
      return [notApplicable(this.id, observation.scenarioId, 'no Meeting persisted')];
    }
    return observation.meetings.map((meeting, index) => {
      const busy = observation.busyOverMeetings[index] ?? [];
      const clashing = busy.filter((interval) =>
        overlaps(meeting.startUtc, meeting.endUtc, interval.startUtc, interval.endUtc),
      );
      if (clashing.length > 0) {
        return fail(
          this.id,
          observation.scenarioId,
          `Meeting ${meeting.id} [${meeting.startUtc}, ${meeting.endUtc}) overlaps ` +
            clashing.map((i) => `[${i.startUtc}, ${i.endUtc})`).join(', '),
        );
      }
      return pass(
        this.id,
        observation.scenarioId,
        `Meeting ${meeting.id} clear of ${busy.length} reported interval(s)`,
      );
    });
  },
};

// ---------------------------------------------------------------------------
// INV-04
// ---------------------------------------------------------------------------

const everyScheduledRowCarriesItsReceipt: Invariant = {
  id: 'INV-04-provenance-matches-persisted-instant',
  title: 'No Meeting or FutureAction exists without a provenance whose resolved instant IS the persisted instant',
  because:
    'This is the mechanical form of "no LLM-proposed datetime is ever persisted without being resolved and ' +
    'validated". A receipt that disagrees with the row it justifies is worse than no receipt, because it ' +
    'looks like evidence.',
  check(observation, scenario) {
    const rows: { kind: string; id: string; json: string; start: string; end: string | null }[] = [
      ...observation.meetings.map((meeting) => ({
        kind: 'Meeting',
        id: meeting.id,
        json: meeting.validationProvenanceJson,
        start: meeting.startUtc,
        end: meeting.endUtc as string | null,
      })),
      ...observation.futureActions.map((action) => ({
        kind: 'FutureAction',
        id: action.id,
        json: action.validationProvenanceJson,
        start: action.scheduledForUtc,
        end: null,
      })),
    ];
    if (rows.length === 0) {
      return [notApplicable(this.id, observation.scenarioId, 'no scheduled row persisted')];
    }

    return rows.map((row) => {
      if (row.json.trim().length === 0) {
        return fail(this.id, observation.scenarioId, `${row.kind} ${row.id} has an EMPTY provenance`);
      }
      const parsed = ValidationProvenanceSchema.safeParse(JSON.parse(row.json));
      if (!parsed.success) {
        return fail(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id} provenance is not a valid receipt: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.')} ${issue.message}`)
            .join('; ')}`,
        );
      }
      const provenance = parsed.data;
      if (provenance.checks.length === 0) {
        return fail(this.id, observation.scenarioId, `${row.kind} ${row.id} provenance records no checks`);
      }
      if (provenance.resolvedStartUtc === undefined) {
        return fail(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id} provenance has no resolvedStartUtc, yet an instant was persisted`,
        );
      }
      if (DateTime.fromISO(provenance.resolvedStartUtc).toMillis() !== DateTime.fromISO(row.start).toMillis()) {
        return fail(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id}: provenance says ${provenance.resolvedStartUtc} but the row says ${row.start}`,
        );
      }
      if (
        row.end !== null &&
        provenance.resolvedEndUtc !== undefined &&
        DateTime.fromISO(provenance.resolvedEndUtc).toMillis() !== DateTime.fromISO(row.end).toMillis()
      ) {
        return fail(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id}: provenance end ${provenance.resolvedEndUtc} but the row ends ${row.end}`,
        );
      }
      // The contact's own words must survive into the receipt verbatim. This is
      // what an auditor asking "why did you call them then?" actually reads.
      if (observation.rawProposedValue !== null && provenance.rawProposedValue !== observation.rawProposedValue) {
        return fail(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id}: the model proposed "${observation.rawProposedValue}" but the receipt ` +
            `preserved "${provenance.rawProposedValue}"`,
        );
      }
      if (!isRealIanaZone(provenance.resolvedTimezone)) {
        return fail(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id}: receipt resolved a non-IANA zone "${provenance.resolvedTimezone}"`,
        );
      }
      // Replay is what makes the receipt useful: `nowUtc` must be the instant
      // the scenario actually ran at, not a wall clock somebody read.
      if (provenance.nowUtc !== scenario.nowUtc) {
        return fail(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id}: receipt nowUtc ${provenance.nowUtc} is not the scenario's ${scenario.nowUtc}`,
        );
      }
      return pass(
        this.id,
        observation.scenarioId,
        `${row.kind} ${row.id}: ${provenance.checks.length} checks, "${provenance.rawProposedValue}" -> ${row.start}`,
      );
    });
  },
};

// ---------------------------------------------------------------------------
// INV-05
// ---------------------------------------------------------------------------

const rejectionWritesNothing: Invariant = {
  id: 'INV-05-rejected-call-mutates-nothing',
  title: 'A rejected tool call leaves every domain row count exactly unchanged',
  because:
    'The mission states it directly: a tool call must never mutate persisted state without passing ' +
    'validation. Counting all eight tables rather than the one the tool names is the point - a handler ' +
    'that wrote a Lead on its way to refusing would still be a breach.',
  check(observation) {
    if (observation.outcome !== 'REJECTED') {
      return [notApplicable(this.id, observation.scenarioId, `outcome was ${observation.outcome}`)];
    }
    const differences = sameCounts(
      observation.rowsBefore as unknown as Record<string, number>,
      observation.rowsAfter as unknown as Record<string, number>,
    );
    if (differences.length > 0) {
      return [
        fail(
          this.id,
          observation.scenarioId,
          `rejected with ${observation.errorCode} but rows changed: ${differences.join(', ')}`,
        ),
      ];
    }
    return [pass(this.id, observation.scenarioId, `rejected with ${observation.errorCode}; all 8 tables unchanged`)];
  },
};

// ---------------------------------------------------------------------------
// INV-06
// ---------------------------------------------------------------------------

/** The ordered spine every write must be explained by. */
const PERSISTED_CHAIN = [
  'UTTERANCE_RECEIVED',
  'AGENT_DECISION',
  'TOOL_CALL_REQUESTED',
  'TOOL_CALL_VALIDATED',
  'ENTITY_PERSISTED',
] as const;

const everyOutcomeIsExplained: Invariant = {
  id: 'INV-06-audit-chain-explains-the-outcome',
  title: 'A write has the full ordered audit chain; a refusal carries a specific ValidationErrorCode',
  because:
    'The slice is only worth anything if it can explain why it scheduled or planned to contact this person ' +
    'at that time. Asserted as an ordered SUBSEQUENCE, not adjacency, so adding an event that improves the ' +
    'trail can never fail the build.',
  check(observation) {
    if (observation.outcome === 'PERSISTED') {
      if (!containsInOrder(observation.auditTypes, PERSISTED_CHAIN)) {
        return [
          fail(
            this.id,
            observation.scenarioId,
            `persisted, but the chain is missing part of ${PERSISTED_CHAIN.join(' -> ')}; got ` +
              observation.auditTypes.join(' -> '),
          ),
        ];
      }
      if (observation.futureActions.length > 0) {
        const withFollowup = [...PERSISTED_CHAIN, 'FUTURE_ACTION_SCHEDULED'];
        if (!containsInOrder(observation.auditTypes, withFollowup)) {
          return [
            fail(
              this.id,
              observation.scenarioId,
              `a FutureAction was persisted but FUTURE_ACTION_SCHEDULED does not follow ENTITY_PERSISTED; got ` +
                observation.auditTypes.join(' -> '),
            ),
          ];
        }
      }
      return [pass(this.id, observation.scenarioId, `chain: ${observation.auditTypes.join(' -> ')}`)];
    }

    if (observation.outcome === 'REJECTED') {
      const codes = codesInAudit(observation, ['TOOL_CALL_REJECTED', 'VALIDATION_REJECTED']);
      if (codes.length === 0) {
        return [
          fail(
            this.id,
            observation.scenarioId,
            `refused with ${observation.errorCode} but no TOOL_CALL_REJECTED / VALIDATION_REJECTED event ` +
              `carries a code; got ${observation.auditTypes.join(' -> ')}`,
          ),
        ];
      }
      const unknown = codes.filter((code) => !(VALIDATION_ERROR_CODES as readonly string[]).includes(code));
      if (unknown.length > 0) {
        return [
          fail(
            this.id,
            observation.scenarioId,
            `refusal recorded code(s) outside ValidationErrorCode: ${unknown.join(', ')}`,
          ),
        ];
      }
      if (!observation.auditTypes.includes('UTTERANCE_RECEIVED')) {
        return [fail(this.id, observation.scenarioId, 'refusal chain does not start from an UTTERANCE_RECEIVED')];
      }
      return [pass(this.id, observation.scenarioId, `refusal recorded as ${codes.join(', ')}`)];
    }

    if (observation.outcome === 'ACCEPTED_NO_WRITE') {
      const ok = containsInOrder(observation.auditTypes, [
        'UTTERANCE_RECEIVED',
        'TOOL_CALL_REQUESTED',
        'TOOL_CALL_VALIDATED',
        'TOOL_CALL_EXECUTED',
      ]);
      return ok
        ? [pass(this.id, observation.scenarioId, 'read-only tool validated and executed on the record')]
        : [
            fail(
              this.id,
              observation.scenarioId,
              `a read-only tool ran without the validated/executed chain; got ${observation.auditTypes.join(' -> ')}`,
            ),
          ];
    }

    return [notApplicable(this.id, observation.scenarioId, `outcome was ${observation.outcome}`)];
  },
};

// ---------------------------------------------------------------------------
// INV-07
// ---------------------------------------------------------------------------

const replayIsIdempotent: Invariant = {
  id: 'INV-07-replay-creates-no-duplicate',
  title: 'Replaying the identical tool call creates no second Meeting or FutureAction',
  because:
    'A model that does not see a tool result will say it again. If that books a second meeting, the ' +
    'contact gets two calendar invitations and the system has lied to somebody.',
  check(observation, scenario) {
    if (!scenario.replay) {
      return [notApplicable(this.id, observation.scenarioId, 'not a replay scenario')];
    }
    if (observation.replayRowsAfter === null) {
      return [fail(this.id, observation.scenarioId, 'replay scenario produced no second observation')];
    }
    const differences = sameCounts(
      observation.rowsAfter as unknown as Record<string, number>,
      observation.replayRowsAfter as unknown as Record<string, number>,
    );
    if (differences.length > 0) {
      return [
        fail(
          this.id,
          observation.scenarioId,
          `the second identical dispatch changed row counts: ${differences.join(', ')}`,
        ),
      ];
    }
    if (observation.meetings.length > 1 || observation.futureActions.length > 1) {
      return [
        fail(
          this.id,
          observation.scenarioId,
          `contact holds ${observation.meetings.length} meetings and ` +
            `${observation.futureActions.length} future actions after one agreement`,
        ),
      ];
    }
    return [
      pass(
        this.id,
        observation.scenarioId,
        `replayed; still ${observation.meetings.length} meeting(s), ${observation.futureActions.length} action(s)`,
      ),
    ];
  },
};

// ---------------------------------------------------------------------------
// INV-08
// ---------------------------------------------------------------------------

const decisionMakerCapHolds: Invariant = {
  id: 'INV-08-decision-maker-score-cap',
  title: 'A contact who cannot sign never carries a stored score above the documented ceiling',
  because:
    'Carried forward from the legacy rubric. The cap exists so an enthusiastic non-buyer cannot be ' +
    'promoted into a sales queue by a flattering model, and it is read from the PERSISTED contact row, ' +
    'never from what the model asserted in the call.',
  check(observation) {
    if (observation.qualificationStates.length === 0) {
      return [notApplicable(this.id, observation.scenarioId, 'no QualificationState persisted')];
    }
    return observation.qualificationStates.map((state) => {
      if (state.cappedScore > state.rawScore) {
        return fail(
          this.id,
          observation.scenarioId,
          `QualificationState ${state.id}: cappedScore ${state.cappedScore} exceeds rawScore ${state.rawScore}`,
        );
      }
      if (state.score !== state.cappedScore) {
        return fail(
          this.id,
          observation.scenarioId,
          `QualificationState ${state.id}: effective score ${state.score} is not the capped ${state.cappedScore}`,
        );
      }
      // The flag on the ROW is the authority, not the one on the state.
      if (!observation.contact.isDecisionMaker) {
        if (state.cappedScore > NON_DECISION_MAKER_SCORE_CEILING) {
          return fail(
            this.id,
            observation.scenarioId,
            `contact is not a decision maker, yet cappedScore is ${state.cappedScore} ` +
              `(ceiling ${NON_DECISION_MAKER_SCORE_CEILING}, rawScore ${state.rawScore})`,
          );
        }
        return pass(
          this.id,
          observation.scenarioId,
          `non-decision-maker capped at ${state.cappedScore} from raw ${state.rawScore}`,
        );
      }
      return pass(
        this.id,
        observation.scenarioId,
        `decision maker scored ${state.cappedScore} (raw ${state.rawScore}), cap not engaged`,
      );
    });
  },
};

// ---------------------------------------------------------------------------
// INV-11 (supporting): the direction a dimension was willing to commit to.
// ---------------------------------------------------------------------------

const declaredDirectionHolds: Invariant = {
  id: 'INV-11-declared-direction-holds',
  title: 'Where a scenario commits to ACCEPT or REJECT, the system agrees',
  because:
    'Most scenarios honestly declare EITHER, because the answer depends on the weekday and the policy. ' +
    'The ones that do commit - a 2019 instant, an unknown tool, a withheld tool - are unconditional, and ' +
    'a sweep that only asserted structural invariants would not notice if they started being accepted.',
  check(observation, scenario) {
    if (scenario.direction === 'EITHER') {
      return [notApplicable(this.id, observation.scenarioId, 'declared EITHER')];
    }
    if (observation.outcome === 'ERROR') {
      return [fail(this.id, observation.scenarioId, `turn threw: ${observation.error}`)];
    }
    const accepted = observation.outcome === 'PERSISTED' || observation.outcome === 'ACCEPTED_NO_WRITE';
    if (scenario.direction === 'REJECT' && accepted) {
      return [fail(this.id, observation.scenarioId, `declared REJECT but the system accepted it`)];
    }
    if (scenario.direction === 'ACCEPT' && !accepted) {
      return [
        fail(
          this.id,
          observation.scenarioId,
          `declared ACCEPT but the system refused with ${observation.errorCode}`,
        ),
      ];
    }
    return [pass(this.id, observation.scenarioId, `declared ${scenario.direction}, got ${observation.outcome}`)];
  },
};

// ---------------------------------------------------------------------------
// INV-12 (supporting): a zone without DST must never produce a DST error.
// ---------------------------------------------------------------------------

const dstCodesOnlyInDstZones: Invariant = {
  id: 'INV-12-no-dst-errors-in-zones-without-dst',
  title: 'NONEXISTENT_LOCAL_TIME and AMBIGUOUS_LOCAL_TIME appear only for zones that observe DST',
  because:
    'UTC and Asia/Kolkata have no transitions at all. If either ever produced a DST code it would mean the ' +
    'gap and fold checks are keyed off something other than the zone actually in play.',
  check(observation, scenario) {
    const zone = scenario.world.contactTimezone;
    const zoneObservesDst = zone !== 'UTC' && zone !== 'Asia/Kolkata';
    if (zoneObservesDst) {
      return [notApplicable(this.id, observation.scenarioId, `${zone} observes DST`)];
    }
    const dstCodes = ['NONEXISTENT_LOCAL_TIME', 'AMBIGUOUS_LOCAL_TIME'];
    if (observation.errorCode !== null && dstCodes.includes(observation.errorCode)) {
      return [
        fail(this.id, observation.scenarioId, `${zone} has no DST but the system returned ${observation.errorCode}`),
      ];
    }
    return [pass(this.id, observation.scenarioId, `${zone}: no DST code`)];
  },
};

// ---------------------------------------------------------------------------
// INV-13 (supporting): no scenario may throw.
// ---------------------------------------------------------------------------

const noTurnThrows: Invariant = {
  id: 'INV-13-refusals-are-values-not-exceptions',
  title: 'No turn in the sweep throws; every refusal comes back as a structured outcome',
  because:
    'A refusal that escapes as an exception loses the audit event and the tool result the model needs to ' +
    'ask a better question. Exceptions are reserved for our own faults, and none should occur here.',
  check(observation) {
    if (observation.outcome === 'ERROR') {
      return [fail(this.id, observation.scenarioId, `turn threw: ${observation.error}`)];
    }
    return [pass(this.id, observation.scenarioId, `stopReason ${observation.stopReason}`)];
  },
};

// ---------------------------------------------------------------------------
// INV-14: the one the 509-scenario sweep used to be blind to.
// ---------------------------------------------------------------------------

const scheduledInstantsSitInsideTheContactsOwnHours: Invariant = {
  id: 'INV-14-hours-hold-in-the-contacts-persisted-zone',
  title:
    'Every persisted Meeting and FutureAction sits inside configured business hours when RENDERED IN THE ' +
    "CONTACT'S PERSISTED TIMEZONE",
  because:
    'A business-hours window is meaningless until you say whose wall clock it is measured on, and whoever ' +
    'gets to answer that gets to decide the verdict. Every time-bearing tool takes an optional `timezone` ' +
    'argument the MODEL fills in, and it used to decide both which instant a phrase named AND which window ' +
    'that instant was judged against - so a courteous "10am" in a zone the model chose booked a real US ' +
    'contact for 23:30 their own time with `business_hours: passed` written into the receipt. This ' +
    'invariant takes the persisted instant and re-reads it on the clock of the person who will actually ' +
    "be phoned, using `Contact.timezone` off the row. The row's OWN `timezone` column is deliberately not " +
    'consulted: that is the value the model can influence, so trusting it would make the oracle agree with ' +
    'the bug. Overlaps INV-02 for meetings on purpose - INV-02 checks a row is well formed, this checks ' +
    'the guardrail was anchored, and it is the only invariant that asks the question of a FutureAction.',
  check(observation) {
    const rows: { kind: string; id: string; startUtc: string; endUtc: string | null; storedZone: string }[] = [
      ...observation.meetings.map((meeting) => ({
        kind: 'Meeting',
        id: meeting.id,
        startUtc: meeting.startUtc,
        endUtc: meeting.endUtc as string | null,
        storedZone: meeting.timezone,
      })),
      ...observation.futureActions.map((action) => ({
        kind: 'FutureAction',
        id: action.id,
        startUtc: action.scheduledForUtc,
        // A FutureAction has no end column. Only the start is checked, and the
        // detail says so rather than quietly implying the end was covered.
        endUtc: null,
        storedZone: action.timezone,
      })),
    ];
    if (rows.length === 0) {
      return [notApplicable(this.id, observation.scenarioId, 'no scheduled row persisted')];
    }

    const { windows, timezone: policyZone, holidays } = windowsFrom(observation.businessHoursJson);
    // The two model-unreachable sources, in the order the application uses them.
    const zone = policyZone ?? observation.contact.timezone;
    const anchorSource = policyZone === undefined ? 'Contact.timezone' : 'BusinessHoursPolicy.timezone';

    return rows.map((row) => {
      const startLocal = DateTime.fromISO(row.startUtc, { zone });
      if (!startLocal.isValid) {
        return fail(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id}: ${row.startUtc} could not be read in ${zone} (from ${anchorSource})`,
        );
      }
      const date = startLocal.toFormat('yyyy-LL-dd');
      const overrode = row.storedZone !== zone ? ` [stored zone ${row.storedZone} differs from the anchor]` : '';

      if (holidays.includes(date)) {
        return fail(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id} falls on configured holiday ${date} in ${zone}${overrode}`,
        );
      }

      const sameDay = windows.filter((window) => window.isoWeekday === startLocal.weekday);
      if (sameDay.length === 0) {
        return fail(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id} is a ${startLocal.weekdayLong} (${date} ${zone}), which has no configured ` +
            `business-hours window${overrode}`,
        );
      }

      const startMinutes = startLocal.hour * 60 + startLocal.minute;
      const fitsStart = sameDay.some(
        (window) => startMinutes >= minutesOf(window.startLocal) && startMinutes < minutesOf(window.endLocal),
      );
      if (!fitsStart) {
        return fail(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id} starts at ${startLocal.toFormat('ccc HH:mm')} ${zone} - which is the clock ` +
            `of the person who will be contacted - and that is outside every configured window ` +
            `(${sameDay.map((window) => `${window.startLocal}-${window.endLocal}`).join(', ')})${overrode}`,
        );
      }

      if (row.endUtc !== null) {
        const endLocal = DateTime.fromISO(row.endUtc, { zone });
        const endMinutes =
          endLocal.toFormat('yyyy-LL-dd') === date ? endLocal.hour * 60 + endLocal.minute : 24 * 60 + 1;
        const fitsEnd = sameDay.some(
          (window) =>
            startMinutes >= minutesOf(window.startLocal) &&
            startMinutes < minutesOf(window.endLocal) &&
            endMinutes <= minutesOf(window.endLocal),
        );
        if (!fitsEnd) {
          return fail(
            this.id,
            observation.scenarioId,
            `${row.kind} ${row.id} runs to ${endLocal.toFormat('ccc HH:mm')} ${zone}, past every configured ` +
              `window${overrode}`,
          );
        }
      }

      return pass(
        this.id,
        observation.scenarioId,
        `${row.kind} ${row.id} at ${startLocal.toFormat('ccc HH:mm')} ${zone} (anchor: ${anchorSource})` +
          `${overrode}${row.endUtc === null ? '; start only, the row has no end column' : ''}`,
      );
    });
  },
};

// ---------------------------------------------------------------------------

/**
 * Invariants 09 (determinism) and 10 (no network I/O) are properties of the
 * SWEEP AS A WHOLE rather than of a single scenario, so they cannot be
 * expressed as a per-scenario `check`. They live in `sweep.test.ts` and
 * `networkTrap.ts`, and the report names them alongside these so the numbered
 * list the mission asked for stays complete.
 */
export const INVARIANTS: readonly Invariant[] = [
  futureActionIsFutureDated,
  meetingIsWellFormedAndInHours,
  meetingDoesNotOverlapBusy,
  everyScheduledRowCarriesItsReceipt,
  rejectionWritesNothing,
  everyOutcomeIsExplained,
  replayIsIdempotent,
  decisionMakerCapHolds,
  declaredDirectionHolds,
  dstCodesOnlyInDstZones,
  noTurnThrows,
  scheduledInstantsSitInsideTheContactsOwnHours,
];

/** Run every invariant over every observation. */
export function checkAll(
  observations: readonly ScenarioObservation[],
  scenarios: readonly Scenario[],
): InvariantResult[] {
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const results: InvariantResult[] = [];
  for (const observation of observations) {
    const scenario = byId.get(observation.scenarioId);
    if (scenario === undefined) {
      throw new Error(`Observation for unknown scenario "${observation.scenarioId}"`);
    }
    for (const invariant of INVARIANTS) {
      results.push(...invariant.check(observation, scenario));
    }
  }
  return results;
}

/** Only the genuine violations, for a failure message. */
export function violations(results: readonly InvariantResult[]): InvariantResult[] {
  return results.filter((result) => !result.passed);
}
