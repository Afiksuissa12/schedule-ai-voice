/**
 * PORT: validation results and their provenance.
 *
 * THE KEYSTONE OF THE MISSION.
 *
 * An LLM may propose "next Tuesday at 2pm". Application code must decide
 * whether that is a real instant, in a real timezone, not in the past, not
 * inside a DST gap, far enough away, not beyond the horizon, inside business
 * hours, and not conflicting with a busy interval. `ValidationResult` is how
 * that decision is returned, and `ValidationProvenance` is the receipt.
 *
 * `Meeting.validationProvenanceJson` and `FutureAction.validationProvenanceJson`
 * are NOT NULL columns holding a serialized `ValidationProvenance`. That is what
 * turns "never trust an LLM-generated datetime blindly" from an aspiration into
 * a database invariant: the row cannot exist unless the receipt exists.
 */
import type { IsoUtcString } from './clock.js';

/**
 * Why a validation failed. Exhaustive by design - callers should `switch` over
 * this and the compiler should complain when a new code appears.
 */
export const VALIDATION_ERROR_CODES = [
  /** The proposed value is not parseable at all. */
  'INVALID_FORMAT',
  /** The timezone is not a zone this runtime knows. */
  'UNKNOWN_TIMEZONE',
  /** The local time occurs twice (DST fall-back) and no offset disambiguates it. */
  'AMBIGUOUS_LOCAL_TIME',
  /** The local time does not exist (DST spring-forward gap). */
  'NONEXISTENT_LOCAL_TIME',
  /** The instant is before `now`. */
  'IN_THE_PAST',
  /** Sooner than `AgentConfiguration.minLeadTimeMinutes` from `now`. */
  'BELOW_MIN_LEAD_TIME',
  /** Further out than `AgentConfiguration.maxSchedulingHorizonDays` from `now`. */
  'BEYOND_HORIZON',
  /** Outside the configured business hours policy. */
  'OUTSIDE_BUSINESS_HOURS',
  /** Overlaps a `BusyInterval` reported by the AvailabilityProvider. */
  'CONFLICT_WITH_BUSY_INTERVAL',
  /** The referenced contact does not exist, or is not in this organization. */
  'UNKNOWN_CONTACT',
  /** The model asked for a tool that is not in `AgentConfiguration.allowedToolsJson`. */
  'UNSUPPORTED_TOOL',
  /** Tool arguments failed their JSON schema. */
  'SCHEMA_VIOLATION',
  /** Structurally valid but forbidden by policy. */
  'POLICY_VIOLATION',
] as const;

export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

export const ValidationErrorCode = {
  INVALID_FORMAT: 'INVALID_FORMAT',
  UNKNOWN_TIMEZONE: 'UNKNOWN_TIMEZONE',
  AMBIGUOUS_LOCAL_TIME: 'AMBIGUOUS_LOCAL_TIME',
  NONEXISTENT_LOCAL_TIME: 'NONEXISTENT_LOCAL_TIME',
  IN_THE_PAST: 'IN_THE_PAST',
  BELOW_MIN_LEAD_TIME: 'BELOW_MIN_LEAD_TIME',
  BEYOND_HORIZON: 'BEYOND_HORIZON',
  OUTSIDE_BUSINESS_HOURS: 'OUTSIDE_BUSINESS_HOURS',
  CONFLICT_WITH_BUSY_INTERVAL: 'CONFLICT_WITH_BUSY_INTERVAL',
  UNKNOWN_CONTACT: 'UNKNOWN_CONTACT',
  UNSUPPORTED_TOOL: 'UNSUPPORTED_TOOL',
  SCHEMA_VIOLATION: 'SCHEMA_VIOLATION',
  POLICY_VIOLATION: 'POLICY_VIOLATION',
} as const satisfies Record<ValidationErrorCode, ValidationErrorCode>;

/** One deterministic check that was actually run, in the order it ran. */
export interface ValidationCheck {
  /** Stable check identifier, e.g. `parse_iso`, `min_lead_time`, `business_hours`. */
  readonly name: string;
  readonly passed: boolean;
  /** Human-readable explanation. Include the numbers the check compared. */
  readonly detail?: string;
}

/**
 * The receipt for a validation decision.
 *
 * Everything needed to re-run the decision by hand and get the same answer:
 * which validator, against which `now`, on exactly what the LLM proposed, in
 * which resolved zone, and which checks ran in which order.
 */
export interface ValidationProvenance {
  /** Version of the validator that produced this, e.g. `datetime-validator@1`. */
  readonly validatorVersion: string;
  /** The `now` the validator used, taken from an injected `Clock`. */
  readonly nowUtc: IsoUtcString;
  /**
   * EXACTLY what the LLM proposed, before any normalisation. Stored verbatim -
   * if the model said "next tuesdayy at 2", that typo belongs here.
   */
  readonly rawProposedValue: string;
  /** The IANA zone the validator resolved and why it chose it. */
  readonly resolvedTimezone: string;
  /** Resolved start instant, when the validation produced one. */
  readonly resolvedStartUtc?: IsoUtcString;
  /** Resolved end instant, when the validation produced one. */
  readonly resolvedEndUtc?: IsoUtcString;
  /** Ordered list of the checks that ran. Order is part of the evidence. */
  readonly checks: ReadonlyArray<ValidationCheck>;
  /** Optional free-form extras, e.g. the busy intervals consulted. */
  readonly notes?: Record<string, unknown>;
}

export interface ValidationSuccess<T> {
  readonly ok: true;
  readonly value: T;
  readonly provenance: ValidationProvenance;
}

export interface ValidationFailure {
  readonly ok: false;
  readonly code: ValidationErrorCode;
  /** Human-readable reason, safe to feed back to the model as a tool error. */
  readonly reason: string;
  readonly provenance: ValidationProvenance;
}

/**
 * The shared result type returned everywhere a datetime or a tool call is
 * validated. Note that BOTH arms carry provenance: a rejection has to be as
 * explainable as an acceptance.
 */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

// ---------------------------------------------------------------------------
// Small helpers. Deliberately pure and dependency-free so every layer can use
// them without pulling anything in.
// ---------------------------------------------------------------------------

export function validationOk<T>(value: T, provenance: ValidationProvenance): ValidationSuccess<T> {
  return { ok: true, value, provenance };
}

export function validationFailed(
  code: ValidationErrorCode,
  reason: string,
  provenance: ValidationProvenance,
): ValidationFailure {
  return { ok: false, code, reason, provenance };
}

export function isValidationSuccess<T>(result: ValidationResult<T>): result is ValidationSuccess<T> {
  return result.ok;
}

export function isValidationFailure<T>(result: ValidationResult<T>): result is ValidationFailure {
  return !result.ok;
}

/** The first failed check, which is normally the one that caused the rejection. */
export function firstFailedCheck(provenance: ValidationProvenance): ValidationCheck | undefined {
  return provenance.checks.find((check) => !check.passed);
}
