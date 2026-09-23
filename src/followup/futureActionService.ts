/**
 * `FutureActionService` - making a promise durable at the moment it is made.
 *
 * FOUNDER RULE THIS IMPLEMENTS
 * ---------------------------------------------------------------------------
 * "Follow-up is a first-class, durable capability from the start. A scheduled
 * future action such as CALL_CONTACT at a validated future datetime and
 * timezone must persist independently of any LLM context window. Never rely on
 * the model remembering a promised callback."
 *
 * So: the instant the agent says "I'll call you back Tuesday at 2", a row exists
 * with a validated `scheduledForUtc`, the timezone it was agreed in, a
 * self-sufficient payload, and its `ValidationProvenance`. Nothing about that
 * promise lives in memory. Delete every object in the process and the callback
 * still happens - `tests/scheduling/dueActionRunner.restart.test.ts` proves it.
 *
 * SAME DISCIPLINE AS MEETINGS
 * ---------------------------------------------------------------------------
 * Validate first; on ok:false persist nothing but a `VALIDATION_REJECTED` audit
 * event; on ok:true write the row and its `FUTURE_ACTION_SCHEDULED` event in ONE
 * transaction.
 *
 * WHICH CHECKS RUN, AND WHY THEY DIFFER FROM A MEETING
 * ---------------------------------------------------------------------------
 * A callback is not a calendar booking. It does not occupy a slot, so by
 * default the busy-interval check does NOT run (`checkAvailability` defaults to
 * false) - refusing to phone someone because a meeting is in the diary would be
 * wrong. Business hours DO run by default: nobody wants a sales call at 04:00.
 * Anything skipped is named in `provenance.notes.skippedChecks`, so a reader can
 * always tell a check that passed from one that never ran.
 */
import type { AuditRecorder } from '../audit/types.js';
import type { Database } from '../db/database.js';
import type { Repositories } from '../db/repositories/index.js';
import type { FutureAction } from '../domain/entities.js';
import type { FutureActionType } from '../domain/enums.js';
import { parseValidationProvenance } from '../domain/provenance.js';
import type { Clock, IsoUtcString } from '../ports/clock.js';
import type { ValidationProvenance, ValidationResult } from '../ports/validation.js';
import { validationFailed, validationOk, ValidationErrorCode } from '../ports/validation.js';
import { buildProvenance, ValidationCheckLog } from '../scheduling/checkLog.js';
import type { ResolvedSlot } from '../scheduling/dateTimeResolver.js';
import { assertResolutionsAgree } from '../scheduling/pinnedSlot.js';
import { schedulingPolicyFromAgentConfiguration } from '../scheduling/policy.js';
import { SCHEDULING_VALIDATOR_VERSION, type SchedulingValidator } from '../scheduling/schedulingValidator.js';
import { ConflictError } from '../shared/errors.js';
import { stringifyJson } from '../shared/json.js';
import { CallContactPayloadSchema, type CallContactPayload } from './payloads.js';

export interface FutureActionProposal {
  readonly raw: string;
  readonly timezone?: string;
  readonly durationMinutes?: number;
}

export interface ScheduleFutureActionInput {
  readonly organizationId: string;
  readonly contactId: string;
  readonly conversationId?: string | null;
  /** The configuration pinned to this conversation. The ONLY policy source. */
  readonly agentConfigurationId: string;
  /** Only `CALL_CONTACT` is executable in this slice. Defaults to it. */
  readonly type?: FutureActionType;
  readonly proposal: FutureActionProposal;
  /**
   * The instant the CALLER pinned for the whole turn.
   *
   * When present it is the only `now` this call uses: the clock is not read
   * again, so the proposal cannot resolve against a later instant than the one
   * the caller already validated and audited. See `pinnedSlot.ts`.
   *
   * Absent - a direct call that has pinned nothing - the clock is read once.
   */
  readonly nowUtc?: IsoUtcString;
  /**
   * The slot the caller ALREADY validated against `nowUtc`.
   *
   * Supplied purely so the service's own re-validation can be checked against
   * it. A disagreement is refused rather than persisted.
   */
  readonly validatedSlot?: ResolvedSlot;
  /** Why the callback was promised. Ends up in the payload and in audit summaries. */
  readonly reason?: string;
  /** Originating number. Falls back to the runner's configured number. */
  readonly fromE164?: string;
  readonly maxAttempts?: number;
  readonly idempotencyKey?: string | null;
  readonly correlationId: string;
  readonly toolCallId?: string | null;
  /** Default true. */
  readonly checkBusinessHours?: boolean;
  /** Default FALSE - a callback does not occupy a calendar slot. */
  readonly checkAvailability?: boolean;
  /** Required when `checkAvailability` is true. */
  readonly calendarRef?: string;
}

export interface ScheduledFutureAction {
  readonly futureAction: FutureAction;
  readonly slot: ResolvedSlot;
  readonly reusedExisting: boolean;
  readonly payload: CallContactPayload;
}

export interface FutureActionServiceOptions {
  readonly db: Database;
  readonly clock: Clock;
  readonly validator: SchedulingValidator;
}

export class FutureActionService {
  private readonly db: Database;
  private readonly clock: Clock;
  private readonly validator: SchedulingValidator;

  constructor(options: FutureActionServiceOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.validator = options.validator;
  }

  async schedule(input: ScheduleFutureActionInput): Promise<ValidationResult<ScheduledFutureAction>> {
    const checks = new ValidationCheckLog();
    // The caller's pinned instant when there is one. Reading the clock here
    // instead would re-resolve the raw phrase against a LATER `now` than the one
    // the caller validated and audited - see `pinnedSlot.ts`.
    const nowUtc = input.nowUtc ?? this.clock.nowUtc();
    const type = input.type ?? 'CALL_CONTACT';

    const reject = async (
      code: (typeof ValidationErrorCode)[keyof typeof ValidationErrorCode],
      reason: string,
      timezone: string,
      provenance?: ValidationProvenance,
      // NULL when the contact could not be resolved: `AuditEvent.contactId` is a
      // real foreign key, and an audit write must never fail because the thing
      // it is reporting on does not exist.
      contactId: string | null = input.contactId,
    ): Promise<ValidationResult<ScheduledFutureAction>> => {
      const receipt =
        provenance ??
        buildProvenance(
          {
            validatorVersion: SCHEDULING_VALIDATOR_VERSION,
            nowUtc,
            rawProposedValue: input.proposal.raw,
            resolvedTimezone: timezone,
          },
          checks,
        );
      await this.recordRejection(input, code, reason, receipt, contactId);
      return validationFailed(code, reason, receipt);
    };

    // ---- idempotent replay --------------------------------------------------
    if (input.idempotencyKey) {
      const existing = await this.db.futureActions.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        checks.pass(
          'idempotency_replay',
          `idempotencyKey "${input.idempotencyKey}" already produced future action ${existing.id}`,
        );
        return validationOk(
          {
            futureAction: existing,
            slot: this.slotFromRow(existing),
            reusedExisting: true,
            payload: CallContactPayloadSchema.parse(JSON.parse(existing.payloadJson)),
          },
          parseValidationProvenance(existing.validationProvenanceJson),
        );
      }
    }

    if (type !== 'CALL_CONTACT') {
      return reject(
        ValidationErrorCode.POLICY_VIOLATION,
        `FutureAction type ${type} is defined in the schema but is not executable in this slice. ` +
          'Only CALL_CONTACT is dispatched by DueActionRunner.',
        input.proposal.timezone ?? 'UTC',
      );
    }

    // ---- preconditions ------------------------------------------------------
    const contact = await this.db.contacts.findById(input.contactId);
    if (!contact || contact.organizationId !== input.organizationId) {
      checks.fail(
        'contact_exists',
        `Contact ${input.contactId} does not exist in organization ${input.organizationId}.`,
      );
      return reject(
        ValidationErrorCode.UNKNOWN_CONTACT,
        `Contact ${input.contactId} does not exist in this organization.`,
        input.proposal.timezone ?? 'UTC',
        undefined,
        null,
      );
    }
    checks.pass('contact_exists', `contact ${contact.id} (${contact.primaryPhoneE164}, ${contact.timezone})`);

    const configuration = await this.db.agentConfigurations.requireById(input.agentConfigurationId);
    const policy = schedulingPolicyFromAgentConfiguration(configuration);
    checks.pass(
      'agent_configuration_loaded',
      `AgentConfiguration ${configuration.id} v${configuration.version}: ` +
        `minLeadTime=${policy.minLeadTimeMinutes}min, horizon=${policy.maxSchedulingHorizonDays}d`,
    );

    const timezone = input.proposal.timezone ?? contact.timezone ?? policy.defaultTimezone;

    // ---- the deterministic datetime gate ------------------------------------
    const validated = await this.validator.validate({
      proposal: {
        raw: input.proposal.raw,
        timezone,
        ...(input.proposal.durationMinutes !== undefined ? { durationMinutes: input.proposal.durationMinutes } : {}),
      },
      policy,
      checkBusinessHours: input.checkBusinessHours ?? true,
      checkAvailability: input.checkAvailability ?? false,
      ...(input.calendarRef ? { calendarRef: input.calendarRef } : {}),
      nowUtc,
    });

    if (!validated.ok) {
      return reject(validated.code, validated.reason, timezone, mergeProvenance(checks, validated.provenance));
    }

    const slot = validated.value;
    // Same `now`, same phrase, same policy - so this must be the same slot the
    // caller validated. Checked before the transaction opens, so a disagreement
    // costs a loud failure and not a row the audit trail contradicts.
    assertResolutionsAgree('schedule_followup', input.validatedSlot, slot, nowUtc);
    const provenance = mergeProvenance(checks, validated.provenance);

    const payload: CallContactPayload = CallContactPayloadSchema.parse({
      version: 1,
      correlationId: input.correlationId,
      toE164: contact.primaryPhoneE164,
      ...(input.fromE164 ? { fromE164: input.fromE164 } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      toolCallId: input.toolCallId ?? null,
      scheduledForLocal: slot.startLocal,
    });

    // ---- persist: row + its audit event, atomically -------------------------
    try {
      const futureAction = await this.db.withTransaction(async (tx) => {
        const created = await tx.futureActions.create({
          organizationId: input.organizationId,
          contactId: contact.id,
          conversationId: input.conversationId ?? null,
          type: 'CALL_CONTACT',
          scheduledForUtc: slot.startUtc,
          timezone: slot.timezone,
          status: 'PENDING',
          ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
          payloadJson: stringifyJson(payload),
          idempotencyKey: input.idempotencyKey ?? null,
          validationProvenanceJson: stringifyJson(provenance),
        });

        // ---------------------------------------------------------------
        // ADDITIVE CHANGE, requested by MISSION-48d6ff04-AUTO-AGENT through
        // the coordination mailbox and announced there before it was made.
        //
        // A FutureAction row is a persisted domain row exactly as a Meeting
        // is, and `MeetingSchedulingService` already emits ENTITY_PERSISTED
        // for its own. Without this event, `audit.listBySubject('FUTURE_ACTION',
        // id)` could not answer "which event wrote this row?" in the same
        // vocabulary the meeting path uses, and an agent turn's chain read
        // TOOL_CALL_VALIDATED -> FUTURE_ACTION_SCHEDULED with the persistence
        // step missing between them.
        //
        // It is recorded on the SAME transaction, immediately before
        // FUTURE_ACTION_SCHEDULED, so the row and both events commit together.
        // Nothing else in this service changed.
        // ---------------------------------------------------------------
        await tx.audit.record({
          type: 'ENTITY_PERSISTED',
          organizationId: input.organizationId,
          correlationId: input.correlationId,
          conversationId: input.conversationId ?? null,
          contactId: contact.id,
          toolCallId: input.toolCallId ?? null,
          subjectType: 'FUTURE_ACTION',
          subjectId: created.id,
          summary: `FutureAction ${created.type} persisted for ${slot.startLocal} ${slot.timezone}`,
          detailJson: {
            futureActionId: created.id,
            type: created.type,
            scheduledForUtc: created.scheduledForUtc,
            timezone: created.timezone,
            status: created.status,
            idempotencyKey: created.idempotencyKey,
          },
          occurredAt: nowUtc,
        });

        await tx.audit.record({
          type: 'FUTURE_ACTION_SCHEDULED',
          organizationId: input.organizationId,
          correlationId: input.correlationId,
          conversationId: input.conversationId ?? null,
          contactId: contact.id,
          toolCallId: input.toolCallId ?? null,
          subjectType: 'FUTURE_ACTION',
          subjectId: created.id,
          summary: `CALL_CONTACT scheduled for ${slot.startLocal} ${slot.timezone} (${slot.startUtc})`,
          detailJson: {
            futureActionId: created.id,
            scheduledForUtc: created.scheduledForUtc,
            timezone: created.timezone,
            maxAttempts: created.maxAttempts,
            payload,
            provenance,
            proposal: input.proposal,
          },
          occurredAt: nowUtc,
        });

        return created;
      });

      return validationOk({ futureAction, slot, reusedExisting: false, payload }, provenance);
    } catch (error) {
      if (error instanceof ConflictError && input.idempotencyKey) {
        const existing = await this.db.futureActions.findByIdempotencyKey(input.idempotencyKey);
        if (existing) {
          return validationOk(
            {
              futureAction: existing,
              slot: this.slotFromRow(existing),
              reusedExisting: true,
              payload: CallContactPayloadSchema.parse(JSON.parse(existing.payloadJson)),
            },
            parseValidationProvenance(existing.validationProvenanceJson),
          );
        }
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------

  private slotFromRow(row: FutureAction): ResolvedSlot {
    const provenance = parseValidationProvenance(row.validationProvenanceJson);
    return {
      startUtc: row.scheduledForUtc,
      endUtc: provenance.resolvedEndUtc ?? row.scheduledForUtc,
      timezone: row.timezone,
      startLocal: '',
      endLocal: '',
      durationMinutes: 0,
      interpretation: { source: 'ISO_INSTANT', matched: ['persisted_row'], utcOffset: '' },
    };
  }

  private async recordRejection(
    input: ScheduleFutureActionInput,
    code: string,
    reason: string,
    provenance: ValidationProvenance,
    contactId: string | null = input.contactId,
  ): Promise<void> {
    await (this.db as Repositories).audit.record({
      type: 'VALIDATION_REJECTED',
      organizationId: input.organizationId,
      correlationId: input.correlationId,
      conversationId: input.conversationId ?? null,
      contactId,
      toolCallId: input.toolCallId ?? null,
      subjectType: 'CONTACT',
      subjectId: input.contactId,
      summary: `Refused to schedule follow-up "${input.proposal.raw}": ${code}`,
      detailJson: { code, reason, provenance, proposal: input.proposal, requestedContactId: input.contactId },
      occurredAt: provenance.nowUtc,
    } satisfies Parameters<AuditRecorder['record']>[0]);
  }
}

/** Service preconditions first, then the datetime pipeline's own checks. */
function mergeProvenance(serviceChecks: ValidationCheckLog, downstream: ValidationProvenance): ValidationProvenance {
  return { ...downstream, checks: [...serviceChecks.snapshot(), ...downstream.checks] };
}
