/**
 * The ordered receipt builder.
 *
 * `ValidationProvenance.checks` is evidence, and its ORDER is part of the
 * evidence: "we rejected this because the timezone was not real" is a different
 * story from "we rejected this because it clashed with a busy interval, having
 * already established the zone was real". A `ValidationCheckLog` is the only way
 * checks are appended, so the order recorded is always the order they ran.
 *
 * The resolver starts a log and the validator keeps appending to the SAME log,
 * which is why a failure at any stage still carries every check that preceded
 * it.
 */
import type { IsoUtcString } from '../ports/clock.js';
import type { ValidationCheck, ValidationProvenance } from '../ports/validation.js';

/**
 * THE CANONICAL CHECK ORDER.
 *
 * Every name a check can have, in the order the pipeline runs them. Exported so
 * tests can assert the order rather than restating it, and so the agent layer
 * can render a receipt without inventing labels.
 */
export const SCHEDULING_CHECK_NAMES = [
  /** The proposed timezone is a real IANA zone name this runtime knows. */
  'timezone_is_iana',
  /** The raw proposal parsed into a concrete local wall-clock target. */
  'parse_proposed_value',
  /** That local wall-clock time actually exists (not inside a DST gap). */
  'local_time_exists',
  /** That local wall-clock time occurs only once (not a DST fall-back repeat). */
  'local_time_unambiguous',
  /** The resolved instant is strictly after `now`. */
  'in_the_future',
  /** The resolved instant respects `AgentConfiguration.minLeadTimeMinutes`. */
  'min_lead_time',
  /** The resolved instant is within `AgentConfiguration.maxSchedulingHorizonDays`. */
  'within_horizon',
  /** The slot fits inside a configured business-hours window on a business day. */
  'business_hours',
  /** The slot overlaps no `BusyInterval` reported by the AvailabilityProvider. */
  'no_busy_conflict',
] as const;

/**
 * Checks the SERVICES run around the datetime pipeline.
 *
 * These are not part of the ordered datetime sequence above - they are the
 * preconditions a service establishes before it is willing to ask the question
 * at all ("is this contact real?") or the state rules it enforces afterwards
 * ("can this meeting still be cancelled?"). They are named here so they are
 * typo-proof and so a receipt never contains an invented label.
 */
export const SERVICE_CHECK_NAMES = [
  /** The contact exists and belongs to the organization making the request. */
  'contact_exists',
  /** The agent configuration exists, so policy came from a real persisted row. */
  'agent_configuration_loaded',
  /** A calendar connection to consult and write to was found. */
  'calendar_connection_resolved',
  /** An existing row was found for this idempotency key, so nothing new is created. */
  'idempotency_replay',
  /** The meeting being rescheduled or cancelled exists. */
  'meeting_exists',
  /** The meeting is in a state that still permits the requested transition. */
  'meeting_transition_allowed',
] as const;

export type SchedulingCheckName =
  | (typeof SCHEDULING_CHECK_NAMES)[number]
  | (typeof SERVICE_CHECK_NAMES)[number];

/** Append-only, ordered list of the checks that actually ran. */
export class ValidationCheckLog {
  private readonly entries: ValidationCheck[] = [];

  pass(name: SchedulingCheckName, detail?: string): this {
    this.entries.push(detail === undefined ? { name, passed: true } : { name, passed: true, detail });
    return this;
  }

  fail(name: SchedulingCheckName, detail: string): this {
    this.entries.push({ name, passed: false, detail });
    return this;
  }

  /** A defensive copy: a receipt must not be editable after the fact. */
  snapshot(): ValidationCheck[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  get length(): number {
    return this.entries.length;
  }
}

export interface ProvenanceDraft {
  readonly validatorVersion: string;
  readonly nowUtc: IsoUtcString;
  /** EXACTLY what was proposed, before any normalisation. Typos included. */
  readonly rawProposedValue: string;
  readonly resolvedTimezone: string;
  readonly resolvedStartUtc?: IsoUtcString;
  readonly resolvedEndUtc?: IsoUtcString;
  readonly notes?: Record<string, unknown>;
}

/**
 * Freeze a draft plus a log into a `ValidationProvenance`.
 *
 * `resolvedTimezone` is forced to a non-empty string because the foundation's
 * `ValidationProvenanceSchema` requires one - and a rejection for an unknown
 * zone still has to say WHICH zone it rejected.
 */
export function buildProvenance(draft: ProvenanceDraft, checks: ValidationCheckLog): ValidationProvenance {
  const provenance: ValidationProvenance = {
    validatorVersion: draft.validatorVersion,
    nowUtc: draft.nowUtc,
    rawProposedValue: draft.rawProposedValue,
    resolvedTimezone: draft.resolvedTimezone.trim().length > 0 ? draft.resolvedTimezone : '(unresolved)',
    ...(draft.resolvedStartUtc ? { resolvedStartUtc: draft.resolvedStartUtc } : {}),
    ...(draft.resolvedEndUtc ? { resolvedEndUtc: draft.resolvedEndUtc } : {}),
    checks: checks.snapshot(),
    ...(draft.notes ? { notes: draft.notes } : {}),
  };
  return provenance;
}
