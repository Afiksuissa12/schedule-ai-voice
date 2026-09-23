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
 * WHAT THE MODEL MAY AND MAY NOT INFLUENCE
 * ---------------------------------------------------------------------------
 * The model supplies exactly two things that reach this class: the raw phrase
 * (`proposal.raw`) and, optionally, the zone that phrase is to be READ in
 * (`proposal.timezone`). It supplies nothing else, and in particular it does not
 * supply the zone the BUSINESS-HOURS WINDOW is read in. Those are two different
 * questions and the second one is the guardrail:
 *
 *   - `proposal.timezone`            -> which instant "10am" means.
 *   - `persistedContactTimezone`     -> whose office hours that instant is then
 *     (via `businessHoursAnchor`)       judged against.
 *
 * Letting the first answer the second is how an LLM gets a real contact dialled
 * at 23:30 their own time with every check reporting green: assert a zone in
 * which the instant looks like mid-morning, and the window follows the
 * assertion. `persistedContactTimezone` is therefore a REQUIRED input, so a
 * caller cannot omit it and fall back to whatever the model said.
 *
 * PURITY
 * ---------------------------------------------------------------------------
 * A validation is a pure function of (proposal, `now` from the injected Clock,
 * policy from the persisted AgentConfiguration, the contact's persisted zone,
 * availability snapshot). It reads no wall clock and writes no state - including
 * no audit events. The SERVICES decide what a verdict means and record it; the
 * validator only decides.
 */
import { DateTime } from 'luxon';

import type { AvailabilityProvider, BusyInterval } from '../ports/availability.js';
import type { Clock, IsoUtcString } from '../ports/clock.js';
import type { ValidationProvenance, ValidationResult } from '../ports/validation.js';
import { validationFailed, validationOk, ValidationErrorCode } from '../ports/validation.js';
import { isValidIanaTimezone } from '../shared/time.js';
import { businessHoursAnchor, checkBusinessHours } from './businessHours.js';
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
   * `Contact.timezone`, read off the persisted contact row.
   *
   * REQUIRED, and deliberately so. `proposal.timezone` may carry a zone the
   * MODEL asserted; this one may not. The business-hours window is read in the
   * zone `businessHoursAnchor` derives from this value and the policy, never in
   * `proposal.timezone` - otherwise the model chooses its own window and the
   * guardrail evaporates. Making it a required field rather than an optional one
   * with a convenient default means a new call site that forgets it fails
   * `npm run typecheck` instead of silently reopening that hole.
   */
  readonly persistedContactTimezone: string;
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
    // MILLISECONDS, not rounded minutes.
    //
    // `Math.round` here used to let a shortfall of up to 30 seconds through the
    // gate below - 29.5 minutes of lead rounds to 30 and cleared a 30-minute
    // minimum - and then wrote "lead time 30 min >= 30 min" into the receipt.
    // That is worse than the leak: `ValidationProvenance` is supposed to be
    // re-runnable by hand, and a receipt that rounds the deciding quantity in
    // the direction that makes the decision look correct cannot be re-run. The
    // comparison is exact and the recorded number is the true one.
    const leadMillis = startMillis - nowMillis;
    const minLeadMillis = policy.minLeadTimeMinutes * MS_PER_MINUTE;
    const leadMinutes = formatMinutes(leadMillis);

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
    if (leadMillis < minLeadMillis) {
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
    //
    // Evaluated in the ANCHOR zone, which comes from the persisted policy or the
    // persisted contact row and NEVER from `slot.timezone`. A model may still
    // say which zone its "10am" is meant in - that is a legitimate thing for a
    // travelling contact to tell us - but it does not get to say which window
    // the resulting instant is then judged against. See `businessHoursAnchor`.
    if (wantsBusinessHours) {
      const anchor = businessHoursAnchor(policy.businessHours, {
        persistedContactTimezone: input.persistedContactTimezone,
        agentDefaultTimezone: policy.defaultTimezone,
      });

      if (!isValidIanaTimezone(anchor.timezone)) {
        // A configuration error, not a contact error. Refusing loudly beats
        // evaluating a wall-clock window in a zone this runtime cannot read -
        // which would silently produce an unusable weekday and "pass".
        const detail =
          `The business-hours anchor zone "${anchor.timezone}" (from the ${anchor.source}) is not an IANA ` +
          'zone this runtime knows, so the window cannot be read in it.';
        checks.fail('business_hours', detail);
        return validationFailed(ValidationErrorCode.POLICY_VIOLATION, detail, provenanceFor());
      }

      const startLocal = DateTime.fromMillis(startMillis, { zone: anchor.timezone });
      const endLocal = DateTime.fromMillis(Date.parse(slot.endUtc), { zone: anchor.timezone });
      const verdict = checkBusinessHours(policy.businessHours, startLocal, endLocal);

      // Recorded in full so an auditor can see BOTH clocks: the one the slot was
      // agreed in and the one the guardrail was applied in. When they differ,
      // `slotTimezoneWasOverridden` says so in as many words, because "the model
      // asserted a zone" is exactly the fact a reviewer wants surfaced.
      notes.businessHours = {
        anchorTimezone: anchor.timezone,
        anchorSource: anchor.source,
        persistedContactTimezone: input.persistedContactTimezone,
        slotTimezone: slot.timezone,
        slotTimezoneWasOverridden: slot.timezone !== anchor.timezone,
        startLocalInAnchorZone: startLocal.toFormat("yyyy-LL-dd'T'HH:mm"),
        endLocalInAnchorZone: endLocal.toFormat("yyyy-LL-dd'T'HH:mm"),
      };

      const explained =
        `${verdict.detail} Evaluated in ${anchor.timezone} (the ${anchor.source} zone), where the slot ` +
        `reads ${startLocal.toFormat("yyyy-LL-dd'T'HH:mm")}-${endLocal.toFormat('HH:mm')}; it was agreed ` +
        `in ${slot.timezone}.`;

      if (!verdict.ok) {
        checks.fail('business_hours', explained);
        return validationFailed(
          ValidationErrorCode.OUTSIDE_BUSINESS_HOURS,
          `That is outside business hours: ${verdict.detail}`,
          provenanceFor(),
        );
      }
      checks.pass('business_hours', explained);
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
 * A duration in milliseconds, as minutes, exactly.
 *
 * Whole minutes render as `30`; anything else keeps the precision that decided
 * the verdict - `29.5`, `0.017`. Never rounds: this string goes into
 * `ValidationProvenance`, where a tidier number would be a false one.
 */
function formatMinutes(millis: number): string {
  const minutes = millis / MS_PER_MINUTE;
  if (Number.isInteger(minutes)) return String(minutes);
  return String(Number(minutes.toFixed(6)));
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
