/**
 * THE INVARIANTS: properties that must hold for EVERY scenario in the sweep.
 *
 * An invariant is not an expected value. It is a sentence that stays true no
 * matter which of the several hundred inputs produced the state being examined -
 * "IF a meeting was persisted THEN it sits inside the configured business
 * hours", never "scenario B-mt-nyc-n01 books 2026-03-05T19:00Z". That shape
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
import { FixedClock } from '../../src/ports/clock.js';
import { VALIDATION_ERROR_CODES } from '../../src/ports/validation.js';
import { DateTimeResolver } from '../../src/scheduling/dateTimeResolver.js';
import { DEFAULT_DAY_PARTS, schedulingPolicy } from '../../src/scheduling/policy.js';
// INV-18 reads the claim gate's DETECTOR and nothing else from that module.
//
// That boundary is the whole design of the oracle, and it is worth stating where
// somebody will see it. Detection is reused because writing a second Hebrew and
// English claim vocabulary inside the harness would be the "two copies of the
// same idea agree" failure this file's header forbids - there is no independent
// way to know that נקבעה asserts a completed booking without a Hebrew lexicon.
// SUPPORT, which is the part that decides whether a released sentence was TRUE,
// is re-derived here from rows and tool outcomes with Luxon, and never by calling
// `buildActionLedger` or `verifyClaims`. So a bug in the ledger or the verifier
// is caught; a bug in the detector is caught by
// `tests/claimGate/claimGateCorpus.ts` instead, which is a corpus with the
// answers written down. Recorded in KNOWN_COVERAGE_GAPS as well.
import {
  detectMaterialClaims,
  type AssertedDay as AssertedClaimDay,
  type AssertedTime as AssertedClaimTime,
} from '../../src/agent/claimGate/detector.js';
import type { ScenarioObservation } from './runner.js';
import { proposedWhen, type Scenario } from './scenarios.js';

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

/**
 * The grammar's own account of itself, as it is written into the receipt.
 *
 * Only the fields the three locale invariants read are declared. Everything
 * here is OPTIONAL because the ISO-instant and ISO-local paths produce no
 * natural-language interpretation at all, and an invariant must be able to tell
 * "this phrase consumed every token" from "this input never went through the
 * grammar".
 */
interface RecordedInterpretation {
  readonly matched?: readonly string[];
  readonly dayAnchor?: string;
  readonly leftover?: readonly string[];
  readonly locales?: readonly string[];
  readonly carriers?: readonly string[];
  readonly normalized?: string;
}

/** `provenance.notes.interpretation`, or null when the input was not parsed. */
function interpretationIn(notes: Record<string, unknown> | undefined): RecordedInterpretation | null {
  const candidate = notes?.['interpretation'];
  if (typeof candidate !== 'object' || candidate === null) return null;
  return candidate as RecordedInterpretation;
}

/** Every `ValidationProvenance` the dispatcher wrote into an audit event. */
function provenancesInAudit(
  observation: ScenarioObservation,
  types: readonly string[],
): { eventType: string; notes: Record<string, unknown> | undefined }[] {
  const found: { eventType: string; notes: Record<string, unknown> | undefined }[] = [];
  for (const event of observation.auditEvents) {
    if (!types.includes(event.type)) continue;
    let detail: { provenance?: unknown };
    try {
      detail = JSON.parse(event.detailJson) as { provenance?: unknown };
    } catch {
      continue; // INV-06 already reports a malformed detailJson.
    }
    const parsed = ValidationProvenanceSchema.safeParse(detail.provenance);
    if (!parsed.success) continue;
    found.push({ eventType: event.type, notes: parsed.data.notes });
  }
  return found;
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
// INV-14: the one the sweep used to be blind to.
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
// INV-15: the fail-closed rule, as a property of every accepted call.
// ---------------------------------------------------------------------------

const noAcceptedResolutionIgnoresAToken: Invariant = {
  id: 'INV-15-no-accepted-resolution-ignores-a-token',
  title: 'Every ACCEPTED natural-language `when` consumed every token of the phrase - leftover is empty',
  because:
    'This is the § 8.3 defect stated as a property rather than as a Hebrew example. The old grammar ' +
    'discarded whatever its regexes did not match, so `מחר ב-15:00` kept its digits, lost its day word, ' +
    'and fell through to "the contact meant today" - a validated, persisted, audit-trailed booking one ' +
    'calendar day early with every check green. The fix is that a phrase may resolve only if every ' +
    'non-whitespace token was consumed by a rule somebody wrote down, and `interpretation.leftover` is ' +
    'the evidence. Asserted here on the ACCEPTED side because that is where the harm is: a refusal with ' +
    'a leftover is the system working. Read from the `TOOL_CALL_VALIDATED` audit event rather than from ' +
    'the persisted row, so it also covers `check_availability`, which legitimately accepts a time and ' +
    'writes nothing. It says nothing about calls that were refused - those are covered by ' +
    'tests/scheduling/localeRefusalBreadth.test.ts, which asserts the refusal NAMES the leftover.',
  check(observation) {
    const validated = provenancesInAudit(observation, ['TOOL_CALL_VALIDATED']);
    const withGrammar = validated
      .map((entry) => interpretationIn(entry.notes))
      .filter((interpretation): interpretation is RecordedInterpretation => interpretation !== null);

    if (withGrammar.length === 0) {
      return [
        notApplicable(
          this.id,
          observation.scenarioId,
          validated.length === 0
            ? 'no tool call was validated'
            : 'the accepted `when` was an ISO instant or ISO local datetime, so no grammar ran',
        ),
      ];
    }

    return withGrammar.map((interpretation) => {
      const leftover = interpretation.leftover ?? [];
      if (leftover.length > 0) {
        return fail(
          this.id,
          observation.scenarioId,
          `an accepted resolution left ${String(leftover.length)} token(s) unaccounted for: ` +
            `"${leftover.join(' ')}" (normalized "${interpretation.normalized ?? '?'}", ` +
            `dayAnchor ${interpretation.dayAnchor ?? 'none'}). A word nobody looked at must refuse, ` +
            'not book.',
        );
      }
      // The second half of the same guarantee, stated where a reader will look
      // for it: the implicit-today branch is the one that turned a dropped day
      // word into a wrong booking, and it must be unreachable with a leftover.
      if ((interpretation.matched ?? []).includes('implicit_today') && leftover.length > 0) {
        return fail(
          this.id,
          observation.scenarioId,
          'an accepted resolution reached the implicit-today branch with tokens left over',
        );
      }
      return pass(
        this.id,
        observation.scenarioId,
        `accepted with nothing left over (locales ${(interpretation.locales ?? []).join('+') || 'none'}, ` +
          `carriers ${(interpretation.carriers ?? []).length}, dayAnchor ${interpretation.dayAnchor ?? 'none'})`,
      );
    });
  },
};

// ---------------------------------------------------------------------------
// INV-16: Hebrew and English parity.
// ---------------------------------------------------------------------------

/**
 * A resolver kept per (`now`, zone) so the parity invariant does not rebuild
 * one 132 times. Pure data in, pure data out; a cache cannot make it
 * non-deterministic.
 */
const PARITY_RESOLVERS = new Map<string, DateTimeResolver>();

function parityResolver(nowUtc: string): DateTimeResolver {
  const cached = PARITY_RESOLVERS.get(nowUtc);
  if (cached) return cached;
  const built = new DateTimeResolver(new FixedClock(nowUtc));
  PARITY_RESOLVERS.set(nowUtc, built);
  return built;
}

const hebrewAndEnglishAgree: Invariant = {
  id: 'INV-16-hebrew-and-english-parity',
  title:
    'A translated Hebrew/English pair resolves to the SAME instant under the same `now`, zone and policy',
  because:
    'The defect was never "Hebrew resolves to a slightly wrong hour". It was that the same instruction, ' +
    'said in two languages, produced two DIFFERENT CALENDAR DAYS, and only the English one was ever ' +
    'asserted. A parity claim is the only shape that catches that, and it is also the shape that ' +
    'survives a tzdata change: nobody has to recompute an expected instant. ' +
    'ON THE HONESTY OF THE ORACLE: this invariant resolves the counterpart phrase through ' +
    '`DateTimeResolver`, which is the system under test, so unlike INV-02 it is not an independent ' +
    'measurement. It cannot be - no oracle can know what a Hebrew phrase means without a Hebrew ' +
    'dictionary, and writing one here would be the reimplementation the harness forbids. What makes it ' +
    'worth having is that the claim is RELATIONAL (two inputs agree) rather than absolute (this input ' +
    'means 15:00), and that it is tied back to the front door: when the scenario persisted a row, the ' +
    'row\'s own instant is asserted to equal both sides. A change that broke Hebrew and English ' +
    'identically would pass here and fail `tests/scheduling/naturalLanguage.test.ts`, which pins ' +
    'English independently.',
  check(observation, scenario) {
    const parity = scenario.parity;
    if (parity === undefined) {
      return [notApplicable(this.id, observation.scenarioId, 'not a parity scenario')];
    }
    if (!parity.identical) {
      return [
        notApplicable(
          this.id,
          observation.scenarioId,
          `pair ${parity.key} is a DECLARED non-identical translation: ${parity.whyNotIdentical ?? 'no reason given'}`,
        ),
      ];
    }
    const raw = proposedWhen(scenario.args);
    if (raw === null) {
      return [notApplicable(this.id, observation.scenarioId, 'the call carries no `when`')];
    }

    const zone = scenario.world.contactTimezone;
    const resolver = parityResolver(scenario.nowUtc);
    const policy = schedulingPolicy({ defaultTimezone: zone, defaultMeetingDurationMinutes: 30 });
    const mine = resolver.resolve({ raw, timezone: zone }, { policy });
    const theirs = resolver.resolve({ raw: parity.counterpartRaw, timezone: zone }, { policy });

    const describe = (side: string, text: string, result: typeof mine): string =>
      result.ok
        ? `${side} "${text}" -> ${result.value.startUtc} (${result.value.startLocal} ${zone})`
        : `${side} "${text}" -> REFUSED ${result.code}`;

    if (mine.ok !== theirs.ok) {
      return [
        fail(
          this.id,
          observation.scenarioId,
          `pair ${parity.key} disagrees on WHETHER it resolves at all.\n      ` +
            `${describe(parity.side, raw, mine)}\n      ` +
            `${describe(parity.side === 'he' ? 'en' : 'he', parity.counterpartRaw, theirs)}`,
        ),
      ];
    }

    if (!mine.ok || !theirs.ok) {
      // Both refused. Parity still has something to say: they must refuse for
      // the same reason, or one language is being held to a different rule.
      const mineCode = mine.ok ? null : mine.code;
      const theirsCode = theirs.ok ? null : theirs.code;
      if (mineCode !== theirsCode) {
        return [
          fail(
            this.id,
            observation.scenarioId,
            `pair ${parity.key} refuses in both languages but for different reasons: ` +
              `${String(mineCode)} vs ${String(theirsCode)}`,
          ),
        ];
      }
      return [pass(this.id, observation.scenarioId, `pair ${parity.key}: both refused with ${String(mineCode)}`)];
    }

    if (mine.value.startUtc !== theirs.value.startUtc) {
      return [
        fail(
          this.id,
          observation.scenarioId,
          `pair ${parity.key} resolves to DIFFERENT INSTANTS.\n      ` +
            `${describe(parity.side, raw, mine)}\n      ` +
            `${describe(parity.side === 'he' ? 'en' : 'he', parity.counterpartRaw, theirs)}\n      ` +
            'This is the FOUNDER_REVIEW § 8.3 defect class. Do not relax the assertion.',
        ),
      ];
    }

    const mineDay = DateTime.fromISO(mine.value.startUtc, { zone }).toFormat('yyyy-LL-dd');
    const theirsDay = DateTime.fromISO(theirs.value.startUtc, { zone }).toFormat('yyyy-LL-dd');
    if (mineDay !== theirsDay) {
      return [
        fail(
          this.id,
          observation.scenarioId,
          `pair ${parity.key} lands on different calendar days in ${zone}: ${mineDay} vs ${theirsDay}`,
        ),
      ];
    }

    // And tie it back to what actually went through the dispatcher, so this is
    // not purely a statement about a resolver call made inside a test.
    const persisted = [
      ...observation.meetings.map((meeting) => ({ kind: 'Meeting', id: meeting.id, startUtc: meeting.startUtc })),
      ...observation.futureActions.map((action) => ({
        kind: 'FutureAction',
        id: action.id,
        startUtc: action.scheduledForUtc,
      })),
    ];
    for (const row of persisted) {
      if (DateTime.fromISO(row.startUtc).toMillis() !== DateTime.fromISO(mine.value.startUtc).toMillis()) {
        return [
          fail(
            this.id,
            observation.scenarioId,
            `pair ${parity.key}: the two phrasings agree on ${mine.value.startUtc}, but the ${row.kind} ` +
              `the dispatcher persisted says ${row.startUtc}`,
          ),
        ];
      }
    }

    return [
      pass(
        this.id,
        observation.scenarioId,
        `pair ${parity.key}: both phrasings -> ${mine.value.startUtc} (${mineDay} ${zone})` +
          (persisted.length > 0 ? `, and the persisted row agrees` : ', nothing persisted'),
      ),
    ];
  },
};

// ---------------------------------------------------------------------------
// INV-17: the resolved calendar day is the day the phrase named.
// ---------------------------------------------------------------------------

/**
 * The day-anchor labels whose meaning is FIXED ARITHMETIC on the contact's own
 * calendar, and therefore re-derivable here without knowing any vocabulary.
 *
 * The labels are canonical and language-neutral by design
 * (`docs/DECISIONS.md` § 9.7): `מחר ב-15:00` and `tomorrow at 15:00` both
 * record `tomorrow`. That is exactly what makes this oracle possible, and it is
 * why it is a locale-agnostic check rather than a Hebrew one.
 */
const DERIVABLE_DAY_OFFSETS: Readonly<Record<string, number>> = {
  today: 0,
  implicit_today: 0,
  tonight: 0,
  tomorrow: 1,
  day_after_tomorrow: 2,
};

const resolvedDayIsTheDayThePhraseNamed: Invariant = {
  id: 'INV-17-resolved-day-is-the-day-the-phrase-named',
  title: "Every persisted instant falls on the calendar day its own receipt names, read in the contact's zone",
  because:
    'The wrong-day booking is the harm, and every other invariant in this file would have reported green ' +
    'while it happened: the row was well formed, inside business hours, in the future, with a complete ' +
    'receipt - just one day early. This check takes the day anchor the receipt CLAIMS, re-derives what ' +
    'that label means by plain calendar arithmetic, and compares it with where the instant actually ' +
    'landed. It is an independent oracle in the sense that matters: it never asks the grammar what the ' +
    "phrase meant, only what the receipt said it meant. " +
    'THE ZONE IT IS EVALUATED IN: the zone the phrase was resolved in, which is ' +
    '`provenance.resolvedTimezone`. For every scenario that does not populate the optional `timezone` ' +
    "tool argument - all of them outside family J - that IS the contact's persisted zone, and this " +
    'check additionally asserts so. In family J the model asserts a different zone on the contact\'s ' +
    'behalf ("I am in Denver this week"), and there "tomorrow" means tomorrow on the clock the contact ' +
    'said they were on; INV-14 is the invariant that polices the business-hours consequence of that. ' +
    'LABELS IT CANNOT DERIVE - a weekday, `next_weekday`, `end_of_week`, or a relative offset - are ' +
    'reported as INAPPLICABLE naming the label, rather than guessed at: deriving a weekday would mean ' +
    'reimplementing the ISO-week arithmetic this sweep exists to test.',
  check(observation, scenario) {
    const rows = [
      ...observation.meetings.map((meeting) => ({
        kind: 'Meeting',
        id: meeting.id,
        startUtc: meeting.startUtc,
        json: meeting.validationProvenanceJson,
      })),
      ...observation.futureActions.map((action) => ({
        kind: 'FutureAction',
        id: action.id,
        startUtc: action.scheduledForUtc,
        json: action.validationProvenanceJson,
      })),
    ];
    if (rows.length === 0) {
      return [notApplicable(this.id, observation.scenarioId, 'no scheduled row persisted')];
    }

    const assertedZone = scenario.labels['assertedTimezone'];

    return rows.map((row) => {
      const parsed = ValidationProvenanceSchema.safeParse(JSON.parse(row.json));
      if (!parsed.success) {
        // INV-04 reports the unreadable receipt; this one has nothing to read.
        return notApplicable(this.id, observation.scenarioId, `${row.kind} ${row.id} has no readable provenance`);
      }
      const provenance = parsed.data;
      const zone = provenance.resolvedTimezone;

      // The zone the phrase was read in must be the contact's own, unless the
      // model was allowed to assert one.
      if (assertedZone === undefined && zone !== observation.contact.timezone) {
        return fail(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id}: no timezone was asserted by the model, so the phrase should have been ` +
            `read on the contact's clock (${observation.contact.timezone}); the receipt says ${zone}`,
        );
      }

      const interpretation = interpretationIn(provenance.notes);
      const anchor = interpretation?.dayAnchor;
      if (interpretation === null || anchor === undefined) {
        return notApplicable(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id}: the receipt records no day anchor (an ISO input, or a relative offset ` +
            'whose day is not named)',
        );
      }

      const landedOn = DateTime.fromISO(row.startUtc, { zone }).toFormat('yyyy-LL-dd');

      const isoDate = /^iso_date:(\d{4}-\d{2}-\d{2})$/.exec(anchor);
      if (isoDate) {
        const named = isoDate[1] as string;
        return landedOn === named
          ? pass(this.id, observation.scenarioId, `${row.kind} ${row.id}: "${anchor}" landed on ${named} ${zone}`)
          : fail(
              this.id,
              observation.scenarioId,
              `${row.kind} ${row.id}: the receipt names the calendar date ${named}, but the instant ` +
                `${row.startUtc} falls on ${landedOn} in ${zone}`,
            );
      }

      const offsetDays = DERIVABLE_DAY_OFFSETS[anchor];
      if (offsetDays === undefined) {
        return notApplicable(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id}: day anchor "${anchor}" is not one whose meaning is fixed calendar ` +
            'arithmetic (weekday / end-of-week labels are deliberately not re-derived here)',
        );
      }

      const named = DateTime.fromISO(provenance.nowUtc, { zone: 'utc' })
        .setZone(zone)
        .startOf('day')
        .plus({ days: offsetDays })
        .toFormat('yyyy-LL-dd');

      if (landedOn !== named) {
        return fail(
          this.id,
          observation.scenarioId,
          `${row.kind} ${row.id}: the receipt says the contact named "${anchor}", which is ${named} in ` +
            `${zone} counting from now=${provenance.nowUtc} - but the persisted instant ${row.startUtc} ` +
            `falls on ${landedOn}. This is a booking on the wrong calendar day ` +
            '(docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md § 8.3).',
        );
      }
      return pass(
        this.id,
        observation.scenarioId,
        `${row.kind} ${row.id}: "${anchor}" = ${named} in ${zone}, and that is where it landed`,
      );
    });
  },
};

// ---------------------------------------------------------------------------
// INV-18: the chokepoint for SENTENCES, asserted as a property.
// ---------------------------------------------------------------------------

/**
 * An effect this sweep observed for itself, in its own vocabulary.
 *
 * Deliberately NOT a `LedgerEffect`. `buildActionLedger` is the thing under
 * test, so an oracle built by calling it would prove only that two copies of the
 * same idea agree - the exact failure the header of this file warns about. These
 * are re-derived from rows read back through the repositories and from the
 * turn's own `ToolOutcome` values, with Luxon doing the timezone arithmetic
 * independently.
 */
interface ObservedEffect {
  readonly kind: string;
  readonly describe: string;
  /** `yyyy-LL-dd` in the CONTACT'S persisted zone, or null when there is no instant. */
  readonly localDay: string | null;
  readonly isoWeekday: number | null;
  readonly hour: number | null;
  readonly minute: number | null;
}

/**
 * Which observed effects would make a claim of each family TRUE.
 *
 * Written out here rather than imported from `verifier.ts` for the reason above.
 * It is the same product rule stated twice on purpose: if the gate's own table
 * were edited to make a failing claim pass, this one would still disagree.
 *
 * `MESSAGE` maps to nothing at all, and that is not an omission - there is no
 * tool in this system that sends anything, so no state whatsoever can support a
 * promise to send one.
 */
const OBSERVED_EFFECTS_FOR_FAMILY: Readonly<Record<string, readonly string[]>> = {
  MEETING: ['MEETING_SCHEDULED', 'MEETING_RESCHEDULED'],
  RESCHEDULE: ['MEETING_RESCHEDULED', 'MEETING_SCHEDULED'],
  CANCELLATION: ['MEETING_CANCELLED'],
  CALLBACK: ['CALLBACK_SCHEDULED'],
  MESSAGE: [],
  RECORD: ['QUALIFICATION_RECORDED', 'CALL_OUTCOME_RECORDED'],
  HANDOVER: ['HUMAN_HANDOVER_REQUESTED'],
  // Completion with nothing named. Satisfied by anything that CHANGED something,
  // and deliberately not by an availability check - `check_availability` books
  // nothing and says so in its own result.
  ANY: [
    'MEETING_SCHEDULED',
    'MEETING_RESCHEDULED',
    'MEETING_CANCELLED',
    'CALLBACK_SCHEDULED',
    'QUALIFICATION_RECORDED',
    'CALL_OUTCOME_RECORDED',
    'HUMAN_HANDOVER_REQUESTED',
  ],
};

function localPartsOf(instantUtc: string, zone: string): Pick<ObservedEffect, 'localDay' | 'isoWeekday' | 'hour' | 'minute'> {
  const at = DateTime.fromISO(instantUtc, { zone });
  if (!at.isValid) return { localDay: null, isoWeekday: null, hour: null, minute: null };
  return { localDay: at.toFormat('yyyy-LL-dd'), isoWeekday: at.weekday, hour: at.hour, minute: at.minute };
}

/** Everything this scenario can actually show for itself, measured independently. */
function observedEffectsOf(observation: ScenarioObservation): readonly ObservedEffect[] {
  const zone = observation.contact.timezone;
  const out: ObservedEffect[] = [];

  for (const meeting of observation.meetings) {
    out.push({
      kind:
        meeting.status === 'CANCELLED'
          ? 'MEETING_CANCELLED'
          : meeting.status === 'RESCHEDULED'
            ? 'MEETING_RESCHEDULED'
            : 'MEETING_SCHEDULED',
      describe: `Meeting ${meeting.id} (${meeting.status}) ${meeting.startUtc}`,
      ...localPartsOf(meeting.startUtc, zone),
    });
  }
  for (const action of observation.futureActions) {
    out.push({
      kind: 'CALLBACK_SCHEDULED',
      describe: `FutureAction ${action.id} ${action.scheduledForUtc}`,
      ...localPartsOf(action.scheduledForUtc, zone),
    });
  }
  for (const state of observation.qualificationStates) {
    out.push({
      kind: 'QUALIFICATION_RECORDED',
      describe: `QualificationState ${state.id}`,
      localDay: null,
      isoWeekday: null,
      hour: null,
      minute: null,
    });
  }
  for (const task of observation.tasks) {
    out.push({
      kind: 'HUMAN_HANDOVER_REQUESTED',
      describe: `Task ${task.id}`,
      localDay: null,
      isoWeekday: null,
      hour: null,
      minute: null,
    });
  }
  // Two effects change something a contact can be told about while persisting
  // nothing this sweep reads back by contact, so they are taken from the turn's
  // own successful outcomes. Refusals are deliberately NOT effects.
  for (const outcome of observation.toolOutcomes) {
    if (!outcome.ok) continue;
    if (outcome.toolName === 'record_call_outcome') {
      out.push({
        kind: 'CALL_OUTCOME_RECORDED',
        describe: `record_call_outcome ${outcome.toolCallId}`,
        localDay: null,
        isoWeekday: null,
        hour: null,
        minute: null,
      });
    }
    if (outcome.toolName === 'transfer_to_human') {
      out.push({
        kind: 'HUMAN_HANDOVER_REQUESTED',
        describe: `transfer_to_human ${outcome.toolCallId}`,
        localDay: null,
        isoWeekday: null,
        hour: null,
        minute: null,
      });
    }
  }
  return out;
}

/** Every identifier this system really issued, measured independently, lower-cased. */
function issuedIdentifiersOf(observation: ScenarioObservation): ReadonlySet<string> {
  const out = new Set<string>();
  const add = (value: string | null | undefined): void => {
    if (typeof value === 'string' && value.trim().length > 0) out.add(value.toLowerCase());
  };
  for (const meeting of observation.meetings) {
    add(meeting.id);
    add(meeting.externalCalendarEventId);
  }
  for (const action of observation.futureActions) add(action.id);
  for (const state of observation.qualificationStates) add(state.id);
  for (const task of observation.tasks) add(task.id);
  for (const outcome of observation.toolOutcomes) {
    if (outcome.ok && outcome.persisted) add(outcome.persisted.id);
  }
  // The contact's own id is unquestionably an identifier the system issued, so a
  // model repeating it has not INVENTED one. Whether it should ever be read out
  // loud is a different finding and not this invariant's.
  add(observation.contact.id);
  return out;
}

/**
 * Does one observed effect agree with the day and time a sentence named?
 *
 * All arithmetic in the CONTACT'S persisted zone, because that is the clock the
 * words will be heard on. `hourIsAmbiguous` gets the one documented allowance:
 * "at 2" for a 14:00 booking is how a person says 14:00, not a contradiction.
 */
function agreesWithAssertion(
  claim: { readonly assertedDay: AssertedClaimDay | null; readonly assertedTime: AssertedClaimTime | null },
  effect: ObservedEffect,
  nowUtc: string,
  zone: string,
): boolean {
  const day = claim.assertedDay;
  const time = claim.assertedTime;
  if (day === null && time === null) return true;

  // The sentence named a day or a time and the effect has no instant at all - a
  // handover, a recorded outcome. Nothing can confirm it, and uncertainty is
  // not support.
  if (effect.localDay === null) return false;

  if (day !== null) {
    if (day.isoWeekday !== null && day.isoWeekday !== effect.isoWeekday) return false;
    const parts = effect.localDay.split('-').map(Number);
    const [year, month, dayOfMonth] = parts as [number, number, number];
    if (day.dayOfMonth !== null && day.dayOfMonth !== dayOfMonth) return false;
    if (day.month !== null && day.month !== month) return false;
    if (day.year !== null && day.year !== year) return false;
    if (day.offsetDays !== null) {
      const expected = DateTime.fromISO(nowUtc, { zone: 'utc' })
        .setZone(zone)
        .startOf('day')
        .plus({ days: day.offsetDays })
        .toFormat('yyyy-LL-dd');
      if (expected !== effect.localDay) return false;
    }
  }

  if (time !== null) {
    if (time.dayPart !== null) {
      const window = DEFAULT_DAY_PARTS[time.dayPart as keyof typeof DEFAULT_DAY_PARTS];
      if (window !== undefined && effect.hour !== null) {
        const minutes = effect.hour * 60 + (effect.minute ?? 0);
        if (minutes < minutesOf(window.startLocal) || minutes >= minutesOf(window.endLocal)) return false;
      }
    }
    if (time.hour !== null) {
      const readings = time.hourIsAmbiguous ? [time.hour, time.hour === 12 ? 0 : time.hour + 12] : [time.hour];
      if (effect.hour === null || !readings.includes(effect.hour)) return false;
      if (time.minute !== null && effect.minute !== null && time.minute !== effect.minute) return false;
    }
  }

  return true;
}

/** Why one claim in a released sentence is not backed by anything observed. */
interface UnbackedClaim {
  readonly reason: string;
  readonly detail: string;
}

/**
 * The INDEPENDENT verdict on one piece of released text.
 *
 * Returns every claim in it that nothing observed supports. An empty array means
 * the text was safe to say.
 */
function unbackedClaimsIn(text: string, observation: ScenarioObservation, scenario: Scenario): readonly UnbackedClaim[] {
  const claims = detectMaterialClaims(text);
  if (claims.length === 0) return [];

  const effects = observedEffectsOf(observation);
  const issued = issuedIdentifiersOf(observation);
  const zone = observation.contact.timezone;
  const out: UnbackedClaim[] = [];

  for (const claim of claims) {
    const invented = claim.identifiers.find((identifier) => !issued.has(identifier.toLowerCase()));
    if (invented !== undefined) {
      out.push({
        reason: 'INVENTED_IDENTIFIER',
        detail:
          `the text read out "${invented}", which is in no tool result and no persisted row for this ` +
          `contact (the system issued ${issued.size} identifier(s) here)`,
      });
      continue;
    }

    if (claim.kind === 'IDENTIFIER_ASSERTED') {
      // A phrase announcing a reference, with no identifier beside it. Supported
      // only when the system actually has an OPERATIONAL one to give - the
      // contact's own primary key does not count as a booking reference.
      const operational = [...issued].filter((value) => value !== observation.contact.id.toLowerCase());
      if (claim.identifiers.length === 0 && operational.length === 0) {
        out.push({
          reason: 'NO_MATCHING_EFFECT',
          detail: `the text announced a reference ("${claim.matchedForm}") and this system has none to give`,
        });
      }
      continue;
    }

    const wanted = OBSERVED_EFFECTS_FOR_FAMILY[claim.family];
    if (wanted === undefined) {
      out.push({
        reason: 'UNKNOWN_FAMILY',
        detail:
          `the detector produced family "${claim.family}", which this invariant's independent table does ` +
          'not know. A new claim family was added to src/agent/claimGate/lexicon and INV-18 was not told ' +
          'about it, so it cannot judge it - which is a finding, not a pass.',
      });
      continue;
    }
    if (wanted.length === 0) {
      out.push({
        reason: 'NO_TOOL_FOR_PROMISE',
        detail:
          `the text promised a ${claim.family} ("${claim.matchedForm}"), and no tool in this system can ` +
          'produce one at all, so no state could ever support it',
      });
      continue;
    }

    const candidates = effects.filter((effect) => wanted.includes(effect.kind));
    if (candidates.length === 0) {
      const refused = observation.toolOutcomes.filter((outcome) => !outcome.ok);
      out.push({
        reason: refused.length > 0 ? 'EFFECT_WAS_REFUSED' : 'NO_MATCHING_EFFECT',
        detail:
          `the text asserted ${claim.family} ${claim.mode} ("${claim.matchedForm}") and nothing observed is ` +
          `one of ${wanted.join('/')}` +
          (refused.length > 0
            ? `; the turn's own refusals were ${refused.map((outcome) => `${outcome.toolName}:${outcome.code}`).join(', ')}`
            : '; the turn produced no refusal either, so nothing happened at all'),
      });
      continue;
    }

    if (!candidates.some((effect) => agreesWithAssertion(claim, effect, scenario.nowUtc, zone))) {
      out.push({
        reason: 'WRONG_DAY_OR_TIME',
        detail:
          `the text said ${[...(claim.assertedDay?.forms ?? []), ...(claim.assertedTime?.forms ?? [])].join(' ') || '(unspecified)'} ` +
          `but the record says ${candidates.map((effect) => `${effect.localDay} ${String(effect.hour).padStart(2, '0')}:${String(effect.minute ?? 0).padStart(2, '0')}`).join(' / ')} ` +
          `in ${zone} (${candidates.map((effect) => effect.describe).join('; ')})`,
      });
    }
  }

  return out;
}

const releasedTextAssertsNoAbsentEffect: Invariant = {
  id: 'INV-18-released-text-asserts-no-absent-effect',
  title: 'No customer-facing text the system released asserts an effect that is absent from the action ledger',
  because:
    'The chokepoint governs ACTIONS, and it held for five models across 105 scenario runs - but ' +
    'docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md § 9.4 states the boundary plainly: it governs actions, not ' +
    'sentences, and every model that said something false said it freely. Pressed by an adversarial contact ' +
    'the recommended model invented a confirmation number and then said a callback was booked, with no tool ' +
    'call on either turn (§ 6.5.4). A contact told a callback exists will act as though one does, so the ' +
    'sentence is the harm whether or not a row was written. This is the same property as INV-05 one layer up: ' +
    'INV-05 says a refused call changes no row, and this says a released sentence claims no effect that is ' +
    'not there.',
  check(observation, scenario) {
    // ---- 0. the gate has to be wired at all -----------------------------
    // Asserted as a VIOLATION rather than as inapplicable. Every scenario in
    // this sweep is built by `buildAgentRuntime`, which always constructs a gate
    // and offers no switch to turn it off, so `enabled: false` here would mean
    // the one configuration that matters had silently changed. An invariant that
    // reported that as "nothing to check" would be reporting the defect as
    // green.
    if (!observation.claimGate.enabled) {
      return [
        fail(
          this.id,
          observation.scenarioId,
          'the runtime released text with NO claim gate wired (AgentTurnResult.claimGate.enabled === false). ' +
            'buildAgentRuntime always constructs one and offers no way to disable it, so this means the ' +
            'production composition root has changed.',
        ),
      ];
    }

    // A thrown turn is INV-13's finding, not this one's. Reporting it here too
    // would double-count one defect as two.
    if (observation.outcome === 'ERROR') {
      return [notApplicable(this.id, observation.scenarioId, 'the turn threw; INV-13 reports that')];
    }

    const releases = observation.claimGate.releases;
    if (releases.length === 0) {
      return [
        notApplicable(
          this.id,
          observation.scenarioId,
          'the model produced no text at all, so nothing was released to examine',
        ),
      ];
    }

    const results: InvariantResult[] = [];

    // ---- 1. every released sentence, against independently measured state
    for (const release of releases) {
      if (release.releasedText === null) {
        // A WITHHELD release. The property holds trivially - nothing was said -
        // but the DESIGNED outcome has to hold too, and this is the only place
        // in the sweep that can check it.
        results.push(...withholdingIsWellFormed(this.id, observation, release));
        continue;
      }

      const unbacked = unbackedClaimsIn(release.releasedText, observation, scenario);

      // The gate's OWN verdict on the text it released. A non-empty
      // `unsupportedClaims` on the attempt whose text was released is a LEAK:
      // the gate found the problem and released the sentence anyway.
      const releasedAttempt = release.attempts.find((attempt) => attempt.text === release.releasedText);
      const gateFlagged = releasedAttempt?.unsupportedClaims ?? [];

      if (unbacked.length > 0) {
        results.push(
          fail(
            this.id,
            observation.scenarioId,
            `iteration ${release.iteration}: the system RELEASED text asserting ${unbacked.length} effect(s) ` +
              `that nothing in the ledger supports. ${unbacked
                .map((entry) => `[${entry.reason}] ${entry.detail}`)
                .join(' | ')}. The gate itself reported outcome ${release.outcome} with ` +
              `${gateFlagged.length} unsupported claim(s) on the released attempt, so the gate and this ` +
              "invariant's independent oracle DISAGREE - which of the two is wrong is the first thing to " +
              'establish. Released text: ' +
              JSON.stringify(release.releasedText.slice(0, 240)),
          ),
        );
        continue;
      }

      if (gateFlagged.length > 0) {
        results.push(
          fail(
            this.id,
            observation.scenarioId,
            `iteration ${release.iteration}: LEAK. The gate recorded ${gateFlagged.length} unsupported ` +
              `claim(s) (${gateFlagged.map((entry) => entry.reason).join(', ')}) on the very attempt whose ` +
              `text it released, with outcome ${release.outcome}. Released text: ` +
              JSON.stringify(release.releasedText.slice(0, 240)),
          ),
        );
        continue;
      }

      const claimCount = detectMaterialClaims(release.releasedText).length;
      results.push(
        pass(
          this.id,
          observation.scenarioId,
          `iteration ${release.iteration}: released ${release.releasedText.length} chars as ` +
            `${release.outcome}; ${claimCount} material claim(s), all backed by observed state`,
        ),
      );
    }

    // ---- 2. the caller got exactly what the gate approved ----------------
    // Without this the gate could approve one thing and `handleTurn` return
    // another, and every check above would still be green.
    const approved = releases
      .map((release) => release.releasedText)
      .filter((text): text is string => text !== null);
    const leaked = observation.assistantMessages.filter((message) => !approved.includes(message));
    if (leaked.length > 0) {
      results.push(
        fail(
          this.id,
          observation.scenarioId,
          `handleTurn returned ${leaked.length} message(s) that correspond to NO approved release. The gate ` +
            'is not on the only path from model text to a caller. ' +
            leaked.map((message) => JSON.stringify(message.slice(0, 160))).join(' | '),
        ),
      );
    }

    // A supported claim must be released BYTE-IDENTICAL. A gate that tidied
    // wording would be a scripting mechanism wearing a safety jacket, and the
    // Founder directive forbids exactly that.
    for (const release of releases) {
      if (release.releasedText === null) continue;
      if (!release.attempts.some((attempt) => attempt.text === release.releasedText)) {
        results.push(
          fail(
            this.id,
            observation.scenarioId,
            `iteration ${release.iteration}: the released text matches NONE of the ${release.attempts.length} ` +
              'attempt(s) the model produced, so the gate MODIFIED it. Either the model\'s own bytes go out ' +
              'or nothing does.',
          ),
        );
      }
    }

    // ---- 3. what family M declared must have happened --------------------
    results.push(...declaredReleaseExpectationHolds(this.id, observation, scenario));

    return results;
  },
};

/**
 * The designed exhaustion outcome, checked where the whole system is running.
 *
 * The gate task asked for this split to be asserted precisely rather than as
 * "zero rows", and it is right to: the point is not that the turn wrote nothing,
 * it is that the ONE thing it wrote is a request for a human and NOT the effect
 * that was falsely claimed.
 */
function withholdingIsWellFormed(
  id: string,
  observation: ScenarioObservation,
  release: { readonly iteration: number; readonly outcome: string; readonly attempts: readonly { readonly text: string }[] },
): InvariantResult[] {
  const out: InvariantResult[] = [];

  if (release.outcome !== 'WITHHELD_HANDED_OFF') {
    out.push(
      fail(
        id,
        observation.scenarioId,
        `iteration ${release.iteration}: released nothing but recorded outcome ${release.outcome} rather than ` +
          'WITHHELD_HANDED_OFF, so a caller cannot tell a silent turn from a spoken one',
      ),
    );
    return out;
  }

  if (observation.stopReason !== 'CLAIM_GATE_WITHHELD') {
    out.push(
      fail(
        id,
        observation.scenarioId,
        `the gate withheld this turn's text but stopReason is "${observation.stopReason}". A caller ` +
          'distinguishing a turn that said its piece from one that deliberately said nothing needs ' +
          'CLAIM_GATE_WITHHELD.',
      ),
    );
  }

  if (observation.assistantMessages.length > 0) {
    out.push(
      fail(
        id,
        observation.scenarioId,
        `the gate withheld but handleTurn still returned ${observation.assistantMessages.length} message(s): ` +
          observation.assistantMessages.map((message) => JSON.stringify(message.slice(0, 160))).join(' | '),
      ),
    );
  }

  // THE SPLIT. Exactly one Task more than before, and not one row of anything
  // else - in particular never the effect that was falsely claimed.
  const before = observation.rowsBefore as unknown as Record<string, number>;
  const after = observation.rowsAfter as unknown as Record<string, number>;
  const taskDelta = (after['tasks'] ?? 0) - (before['tasks'] ?? 0);
  if (taskDelta !== 1) {
    out.push(
      fail(
        id,
        observation.scenarioId,
        `the gate withheld and asked for a person, so exactly ONE Task must have been written; the count ` +
          `moved by ${taskDelta}. Recording a withholding only in the audit trail makes it explainable ` +
          'afterwards and actionable by nobody.',
      ),
    );
  }
  const mustNotMove = ['meetings', 'futureActions', 'qualificationStates', 'calls', 'callOutcomes'];
  const moved = mustNotMove.filter((table) => (after[table] ?? 0) !== (before[table] ?? 0));
  if (moved.length > 0) {
    out.push(
      fail(
        id,
        observation.scenarioId,
        `the gate withheld a FALSE claim and then wrote ${moved
          .map((table) => `${table} ${before[table]} -> ${after[table]}`)
          .join(', ')}. The gate must NEVER create the effect that was falsely claimed.`,
      ),
    );
  }

  // The audit trail has to explain it, on this correlation id, without anybody
  // reading the code.
  if (!observation.auditTypes.includes('CLAIM_GATE_TEXT_WITHHELD')) {
    out.push(
      fail(
        id,
        observation.scenarioId,
        `no CLAIM_GATE_TEXT_WITHHELD event on this correlation id, so an auditor cannot explain why the turn ` +
          `said nothing; got ${observation.auditTypes.join(' -> ')}`,
      ),
    );
  }
  if (!observation.auditTypes.includes('HUMAN_TRANSFER_REQUESTED')) {
    out.push(
      fail(
        id,
        observation.scenarioId,
        'the gate withheld but no HUMAN_TRANSFER_REQUESTED was recorded, so nothing says a person was asked for',
      ),
    );
  }

  if (out.length === 0) {
    out.push(
      pass(
        id,
        observation.scenarioId,
        `iteration ${release.iteration}: WITHHELD after ${release.attempts.length} attempt(s); nothing said, ` +
          'exactly one Task written, no scheduling row created, audit trail explains it',
      ),
    );
  }
  return out;
}

/**
 * Family M's declared expectation, in the shape INV-11 uses for `direction`.
 *
 * Most specs declare `EITHER`, honestly, because whether a TRUE claim is
 * releasable depends on whether the underlying booking was accepted - which is a
 * scheduling question this family is not asking. The ones that do commit are
 * unconditional, and a sweep that only checked the structural half would not
 * notice if a wrong-day claim started being released.
 */
function declaredReleaseExpectationHolds(
  id: string,
  observation: ScenarioObservation,
  scenario: Scenario,
): InvariantResult[] {
  const spec = scenario.release;
  if (spec === undefined || spec.expect === 'EITHER') return [];

  const released = observation.claimGate.releases
    .map((release) => release.releasedText)
    .filter((text): text is string => text !== null);

  if (spec.expect === 'WITHHELD') {
    if (released.length > 0) {
      return [
        fail(
          id,
          observation.scenarioId,
          `spec ${spec.key} drives ${spec.afterToolResult.length + 1} consecutive unsupported attempts, which ` +
            `is more than the regeneration bound allows, so the gate must release NOTHING - but it released ` +
            `${released.length} piece(s) of text. ${spec.rationale}`,
        ),
      ];
    }
    return [
      pass(
        id,
        observation.scenarioId,
        `spec ${spec.key}: exhausted the regeneration bound and released nothing, as designed`,
      ),
    ];
  }

  if (spec.expect === 'NOT_RELEASED') {
    // The specific wording the spec calls false must not appear in anything the
    // caller received. Checked against the TEXTS rather than against the gate's
    // outcome, because the outcome is the gate's own account of itself.
    //
    // WHICH WORDING IS FORBIDDEN COMES FROM THE SPEC, NOT FROM THE DETECTOR, AND
    // THAT WAS A REAL HOLE. A NOT_RELEASED spec carries a mixture - the false
    // wording under test, and honest filler that MUST be released - so something
    // has to say which is which. This used to do it by running the detector:
    //
    //     .filter(text => text !== null && detectMaterialClaims(text).length > 0)
    //
    // which made the check blind in exactly the direction it exists to guard. A
    // wording the detector MISSED was dropped from the forbidden list, so it could
    // not be reported as escaped, so a live fail-open detector gap was certified by
    // this invariant as zero leaks. Independent QA demonstrated that end to end -
    // eight unsupported claims released and persisted against an empty ledger while
    // the sweep printed `CLAIMS THAT LEAKED PAST THE GATE: 0`. A gap the assurance
    // layer reports as zero is worse than a declared gap.
    //
    // `ReleaseSpec.forbidden` now names the strings, so the escape check owes the
    // detector nothing. The detector's own view is still computed, for the vacuity
    // alarm below and to say whether an escape was a GATE failure or a DETECTOR one.
    const forbidden = spec.forbidden ?? [];
    if (forbidden.length === 0) {
      return [
        fail(
          id,
          observation.scenarioId,
          `spec ${spec.key} is declared NOT_RELEASED but names no forbidden wording, so this scenario checks ` +
            'nothing at all. Every NOT_RELEASED spec must list the exact text that must not reach the caller ' +
            'in `forbidden` - inferring it from the detector is what made this invariant blind to a detector ' +
            'gap in the first place (tests/invariants/dimensions.ts documents why).',
        ),
      ];
    }
    const escaped = forbidden.filter((text) => released.includes(text) || observation.assistantMessages.includes(text));
    if (escaped.length > 0) {
      const invisible = escaped.filter((text) => detectMaterialClaims(text).length === 0);
      return [
        fail(
          id,
          observation.scenarioId,
          `spec ${spec.key} declares its claim unsupportable, but the exact wording reached the caller: ` +
            `${escaped.map((text) => JSON.stringify(text.slice(0, 200))).join(' | ')}. ${spec.rationale}` +
            (invisible.length > 0
              ? ` AND ${invisible.length} of those is INVISIBLE to detectMaterialClaims, so the gate did not ` +
                'fail to stop a claim it saw - it never saw one. That is a DETECTOR gap, not a gate gap: add ' +
                'the wording to tests/claimGate/claimGateCorpus.ts MUST_FLAG and fix the rule that misses it.'
              : ''),
        ),
      ];
    }
    const visible = forbidden.filter((text) => detectMaterialClaims(text).length > 0);
    if (visible.length === 0) {
      return [
        fail(
          id,
          observation.scenarioId,
          `spec ${spec.key} is declared NOT_RELEASED, but the detector finds NO material claim in any of its ` +
            'forbidden wordings, so the gate had nothing to act on and this scenario is passing for the wrong ' +
            'reason. Either the wording no longer asserts what it used to, or a detector rule stopped firing - ' +
            'see tests/claimGate/claimGateCorpus.ts. The ESCAPE check above no longer depends on this: the ' +
            'spec names the forbidden strings, so a detector miss fails as an escape rather than disappearing.',
        ),
      ];
    }
    return [
      pass(
        id,
        observation.scenarioId,
        `spec ${spec.key}: ${forbidden.length} declared-unsupportable wording(s) kept away from the caller ` +
          `(${visible.length} of them visible to the detector)`,
      ),
    ];
  }

  // RELEASED: every text the spec scripted must have gone out, byte for byte.
  const scripted = [spec.withToolCall, ...spec.afterToolResult].filter((text): text is string => text !== null);
  const missing = scripted.filter((text) => !released.includes(text));
  if (missing.length > 0) {
    return [
      fail(
        id,
        observation.scenarioId,
        `spec ${spec.key} asserts nothing material and must be released untouched, but ${missing.length} of ` +
          `its ${scripted.length} sentence(s) never reached the caller: ` +
          `${missing.map((text) => JSON.stringify(text)).join(' | ')}. A gate that blocks ordinary ` +
          'conversation gets switched off, and then the § 6.5.4 defect is back.',
      ),
    ];
  }
  return [
    pass(
      id,
      observation.scenarioId,
      `spec ${spec.key}: all ${scripted.length} sentence(s) released byte-identical`,
    ),
  ];
}

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
  noAcceptedResolutionIgnoresAToken,
  hebrewAndEnglishAgree,
  resolvedDayIsTheDayThePhraseNamed,
  releasedTextAssertsNoAbsentEffect,
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
