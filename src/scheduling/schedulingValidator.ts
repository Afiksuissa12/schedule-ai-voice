/**
 * `SchedulingValidator` - the gate every proposed datetime passes through.
 *
 * FOUNDER RULE THIS IMPLEMENTS
 * ---------------------------------------------------------------------------
 * "Never trust an LLM-generated datetime blindly." Nothing in this codebase may
 * persist a Meeting or a FutureAction without a success from here, and the
 * receipt it returns is written into the NOT NULL `validationProvenanceJson`
 * column, so the invariant is enforced by the database rather than by
 * discipline.
 *
 * THE CHECK ORDER IS PART OF THE CONTRACT
 * ---------------------------------------------------------------------------
 * See `SCHEDULING_CHECK_NAMES` in `checkLog.ts`. Cheap structural questions
 * first, provider I/O last, so a malformed proposal never costs a provider call
 * and the first failed check always names the real reason:
 *
 *   1. timezone_is_iana        -> UNKNOWN_TIMEZONE
 *   2. parse_proposed_value    -> INVALID_FORMAT
 *   3. local_time_exists       -> NONEXISTENT_LOCAL_TIME
 *   4. local_time_unambiguous  -> AMBIGUOUS_LOCAL_TIME
 *   5. in_the_future           -> IN_THE_PAST
 *   6. min_lead_time           -> BELOW_MIN_LEAD_TIME
 *   7. within_horizon          -> BEYOND_HORIZON
 *   8. business_hours          -> OUTSIDE_BUSINESS_HOURS
 *   9. no_busy_conflict        -> CONFLICT_WITH_BUSY_INTERVAL
 *
 * PURITY
 * ---------------------------------------------------------------------------
 * A validation is a pure function of (proposal, `now` from the injected Clock,
 * policy from the persisted AgentConfiguration, availability snapshot). It
 * reads no wall clock and writes no state - including no audit events. The
 * SERVICES decide what a verdict means and record it; the validator only
 * decides.
 */
import { DateTime } from 'luxon';

import type { AvailabilityProvider, BusyInterval } from '../ports/availability.js';
import type { Clock, IsoUtcString } from '../ports/clock.js';
import type { ValidationProvenance, ValidationResult } from '../ports/validation.js';
import { validationFailed, validationOk, ValidationErrorCode } from '../ports/validation.js';
import { businessHoursTimezone, checkBusinessHours } from './businessHours.js';
import { buildProvenance, ValidationCheckLog } from './checkLog.js';
import { DateTimeResolver, type DateTimeProposal, type ResolvedSlot } from './dateTimeResolver.js';
import type { SchedulingPolicy } from './policy.js';

export const SCHEDULING_VALIDATOR_VERSION = 'scheduling-validator@1';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

export interface SchedulingValidatorOptions {
  /** The ONLY source of `now`. Never `Date.now()`. */
  readonly clock: Clock;
  /** Consulted for busy intervals. A deterministic double in this mission. */
  readonly availability: AvailabilityProvider;
  /** Override for tests; defaults to a resolver over the same clock. */
  readonly resolver?: DateTimeResolver;
  readonly validatorVersion?: string;
}

export interface ValidateSlotInput {
  readonly proposal: DateTimeProposal;
  /** From `schedulingPolicyFromAgentConfiguration`. Never from the model. */
  readonly policy: SchedulingPolicy;
  /**
   * Calendar to consult, from `CalendarConnection.calendarRef`. Required when
   * the availability check runs.
   */
  readonly calendarRef?: string;
  /** Default true. */
  readonly checkBusinessHours?: boolean;
  /**
   * Default true when `calendarRef` is supplied, false otherwise.
   *
   * Follow-up CALLS legitimately set this false: a callback does not occupy a
   * calendar slot, so a busy interval is not a reason to refuse to phone
   * someone. Whatever is skipped is named in `provenance.notes.skippedChecks`,
   * so a reader can always tell a check that passed from one that never ran.
   */
  readonly checkAvailability?: boolean;
  /** Overrides `clock.nowUtc()`. Use only to replay a recorded decision. */
  readonly nowUtc?: IsoUtcString;
}

export class SchedulingValidator {
  private readonly clock: Clock;
  private readonly availability: AvailabilityProvider;
  private readonly resolver: DateTimeResolver;
  private readonly validatorVersion: string;

  constructor(options: SchedulingValidatorOptions) {
    this.clock = options.clock;
    this.availability = options.availability;
    this.resolver = options.resolver ?? new DateTimeResolver(options.clock);
    this.validatorVersion = options.validatorVersion ?? SCHEDULING_VALIDATOR_VERSION;
  }

  async validate(input: ValidateSlotInput): Promise<ValidationResult<ResolvedSlot>> {
    const checks = new ValidationCheckLog();
    const nowUtc = input.nowUtc ?? this.clock.nowUtc();
    const { policy, proposal } = input;

    const wantsBusinessHours = input.checkBusinessHours ?? true;
    const wantsAvailability = input.checkAvailability ?? input.calendarRef !== undefined;
    const skippedChecks: string[] = [];
    if (!wantsBusinessHours) skippedChecks.push('business_hours');
    if (!wantsAvailability) skippedChecks.push('no_busy_conflict');

    // ---- checks 1-4: parse and timezone-resolve ---------------------------
    const resolved = this.resolver.resolve(proposal, {
      policy,
      nowUtc,
      checks,
      validatorVersion: this.validatorVersion,
    });
    if (!resolved.ok) {
      return resolved;
    }

    const slot = resolved.value;
    const notes: Record<string, unknown> = { ...(resolved.provenance.notes ?? {}) };
    if (skippedChecks.length > 0) {
      notes.skippedChecks = skippedChecks;
    }
    notes.policy = {
      agentConfigurationId: policy.agentConfigurationId,
      agentConfigurationVersion: policy.agentConfigurationVersion,
      minLeadTimeMinutes: policy.minLeadTimeMinutes,
      maxSchedulingHorizonDays: policy.maxSchedulingHorizonDays,
    };

    const provenanceFor = (): ValidationProvenance =>
      buildProvenance(
        {
          validatorVersion: this.validatorVersion,
          nowUtc,
          rawProposedValue: proposal.raw,
          resolvedTimezone: slot.timezone,
          resolvedStartUtc: slot.startUtc,
          resolvedEndUtc: slot.endUtc,
          notes,
        },
        checks,
      );

    const nowMillis = Date.parse(nowUtc);
    const startMillis = Date.parse(slot.startUtc);
    const leadMinutes = Math.round((startMillis - nowMillis) / MS_PER_MINUTE);

    // ---- check 5: strictly in the future ----------------------------------
    if (startMillis <= nowMillis) {
      const detail = `${slot.startUtc} (${slot.startLocal} ${slot.timezone}) is not after now (${nowUtc}).`;
      checks.fail('in_the_future', detail);
      return validationFailed(
        ValidationErrorCode.IN_THE_PAST,
        `${detail} Ask the contact for a future time.`,
        provenanceFor(),
      );
    }
    checks.pass('in_the_future', `${slot.startUtc} is ${leadMinutes} min after now (${nowUtc})`);

    // ---- check 6: minimum lead time ---------------------------------------
    if (leadMinutes < policy.minLeadTimeMinutes) {
      const detail = `lead time ${leadMinutes} min is below the configured minimum of ${policy.minLeadTimeMinutes} min.`;
      checks.fail('min_lead_time', detail);
      return validationFailed(
        ValidationErrorCode.BELOW_MIN_LEAD_TIME,
        `That is too soon: ${detail}`,
        provenanceFor(),
      );
    }
    checks.pass('min_lead_time', `lead time ${leadMinutes} min >= ${policy.minLeadTimeMinutes} min`);

    // ---- check 7: scheduling horizon --------------------------------------
    // Measured in fixed 24-hour days from `now`, deliberately NOT in calendar
    // days: a horizon that moves by an hour twice a year is not a horizon.
    const horizonMillis = nowMillis + policy.maxSchedulingHorizonDays * MS_PER_DAY;
    const daysOut = (startMillis - nowMillis) / MS_PER_DAY;
    if (startMillis > horizonMillis) {
      const detail =
        `${slot.startUtc} is ${daysOut.toFixed(2)} days out, beyond the configured horizon of ` +
        `${policy.maxSchedulingHorizonDays} days (${new Date(horizonMillis).toISOString()}).`;
      checks.fail('within_horizon', detail);
      return validationFailed(
        ValidationErrorCode.BEYOND_HORIZON,
        `That is too far ahead: ${detail}`,
        provenanceFor(),
      );
    }
    checks.pass(
      'within_horizon',
      `${daysOut.toFixed(2)} days out <= ${policy.maxSchedulingHorizonDays} day horizon`,
    );

    // ---- check 8: business hours ------------------------------------------
    if (wantsBusinessHours) {
      const zone = businessHoursTimezone(policy.businessHours, slot.timezone);
      const startLocal = DateTime.fromMillis(startMillis, { zone });
      const endLocal = DateTime.fromMillis(Date.parse(slot.endUtc), { zone });
      const verdict = checkBusinessHours(policy.businessHours, startLocal, endLocal);
      notes.businessHoursTimezone = zone;

      if (!verdict.ok) {
        checks.fail('business_hours', verdict.detail);
        return validationFailed(
          ValidationErrorCode.OUTSIDE_BUSINESS_HOURS,
          `That is outside business hours: ${verdict.detail}`,
          provenanceFor(),
        );
      }
      checks.pass('business_hours', verdict.detail);
    }

    // ---- check 9: availability --------------------------------------------
    if (wantsAvailability) {
      if (input.calendarRef === undefined) {
        // A configuration error, not a contact error: refusing loudly beats
        // quietly "passing" an availability check that never ran.
        checks.fail('no_busy_conflict', 'availability check requested but no calendarRef was supplied');
        return validationFailed(
          ValidationErrorCode.POLICY_VIOLATION,
          'Availability checking was requested but no calendar was supplied to check against.',
          provenanceFor(),
        );
      }

      const busy = await this.availability.getBusyIntervals({
        calendarRef: input.calendarRef,
        fromUtc: slot.startUtc,
        toUtc: slot.endUtc,
      });

      notes.availabilityProvider = this.availability.name();
      notes.busyIntervalsConsulted = busy;

      const conflict = busy.find((interval) => overlaps(slot.startUtc, slot.endUtc, interval));
      if (conflict) {
        const detail =
          `${slot.startUtc}/${slot.endUtc} overlaps a busy interval ` +
          `${conflict.startUtc}/${conflict.endUtc} reported by ${this.availability.name()}.`;
        checks.fail('no_busy_conflict', detail);
        return validationFailed(
          ValidationErrorCode.CONFLICT_WITH_BUSY_INTERVAL,
          `That time is already taken: ${detail}`,
          provenanceFor(),
        );
      }
      checks.pass(
        'no_busy_conflict',
        `${busy.length} busy interval(s) consulted via ${this.availability.name()}, none overlapping`,
      );
    }

    return validationOk(slot, provenanceFor());
  }
}

/**
 * Half-open overlap: `[aStart, aEnd)` against `[bStart, bEnd)`.
 *
 * Adjacency is NOT a conflict. A meeting ending at 13:00 does not clash with a
 * busy interval starting at 13:00, and that is tested.
 */
export function overlaps(startUtc: IsoUtcString, endUtc: IsoUtcString, interval: BusyInterval): boolean {
  const start = Date.parse(startUtc);
  const end = Date.parse(endUtc);
  const busyStart = Date.parse(interval.startUtc);
  const busyEnd = Date.parse(interval.endUtc);
  return start < busyEnd && end > busyStart;
}
