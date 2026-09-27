/**
 * `ToolDispatcher` - THE CHOKEPOINT.
 *
 * Every model-originated action in this system passes through `dispatch`.
 * There is no second path. If you are reading this file to find out how the
 * architectural rule is enforced rather than merely asserted, this is it.
 *
 * THE ORDER IS THE CONTRACT
 * ---------------------------------------------------------------------------
 *  1. `TOOL_CALL_REQUESTED`, carrying the RAW arguments exactly as the model
 *     produced them. Emitted before anything is understood, so the record
 *     survives even when the arguments turn out to be gibberish.
 *  2. Unknown tool name           -> UNSUPPORTED_TOOL
 *  3. Zod parse of the arguments  -> SCHEMA_VIOLATION
 *  4. Permitted by the pinned
 *     `AgentConfiguration`         -> POLICY_VIOLATION
 *  5. Subject resolution FROM THE DATABASE (contact / meeting)
 *                                 -> UNKNOWN_CONTACT / POLICY_VIOLATION
 *  6. Deterministic datetime validation, delegated in full to
 *     `SchedulingValidator`      -> whatever code the validator returns
 *  7. `TOOL_CALL_VALIDATED` or `TOOL_CALL_REJECTED`
 *  8. ONLY THEN: execute, via a service.
 *
 * Cheap and structural first, provider I/O last, so a malformed call never
 * costs a database round trip it did not need and never costs a provider call
 * at all.
 *
 * WHAT A REJECTION GUARANTEES
 * ---------------------------------------------------------------------------
 * No domain row is written. Not a partial one, not a "draft", not a cancelled
 * one. The only things persisted on a rejection are audit events, which is the
 * opposite of a side effect: it is the record that we refused.
 * `tests/e2e/adversarial.test.ts` asserts row counts across every domain table
 * for each rejection path, so this is checked rather than promised.
 *
 * WHY VALIDATE HERE WHEN THE SERVICES ALSO VALIDATE
 * ---------------------------------------------------------------------------
 * Deliberate belt and braces, and the belt is load-bearing. Validating at the
 * chokepoint means the services are never even ENTERED for a bad datetime, so
 * "a tool call must never directly mutate persisted state without passing
 * through validation" holds for any future service that is less careful than
 * today's two.
 *
 * Two validations are only safe if the second cannot reach a different answer
 * than the first, and that is arranged rather than hoped for. `nowUtc` is pinned
 * once per turn in `ToolDispatchContext`; the handlers THREAD that instant into
 * every service call, so the services resolve the same phrase against the same
 * `now` instead of reading the clock again; and they are handed the slot this
 * file already validated, which `assertResolutionsAgree` reconciles their answer
 * against before a row is written. The first makes the two resolutions identical
 * and the second proves it. See `src/scheduling/pinnedSlot.ts` for the failure
 * this closes - a contact speaking seconds before their own local midnight had
 * "tomorrow" validated as one day and persisted as the next.
 */
import type { AuditEventType } from '../../audit/types.js';
import type { Database } from '../../db/database.js';
import type { Meeting } from '../../domain/entities.js';
import type { ToolCallRequest } from '../../ports/llm.js';
import type { ValidationProvenance } from '../../ports/validation.js';
import { ValidationErrorCode, type ValidationErrorCode as ValidationErrorCodeType } from '../../ports/validation.js';
import type { ResolvedSlot } from '../../scheduling/dateTimeResolver.js';
import { tryParseJson } from '../../shared/json.js';
import type {
  ResolvedSubject,
  ToolDependencies,
  ToolDispatchContext,
} from './context.js';
import { findToolDefinition, type ToolDefinition } from './definitions.js';
import { TOOL_HANDLERS, isRetryable } from './handlers.js';
import { toolRejection, type ToolOutcome, type ToolRejection } from './results.js';

export interface ToolDispatcherOptions extends ToolDependencies {}

export class ToolDispatcher {
  private readonly deps: ToolDependencies;

  constructor(options: ToolDispatcherOptions) {
    this.deps = options;
  }

  /**
   * Validate and, if it survives, execute one model-proposed tool call.
   *
   * Never throws for a bad tool call - a refusal is a `ToolRejection` the model
   * can read and react to on its next turn. It DOES throw when the system
   * itself is broken (an audit write fails, the database is unreachable),
   * because a turn that cannot be explained must not continue.
   */
  async dispatch(request: ToolCallRequest, ctx: ToolDispatchContext): Promise<ToolOutcome> {
    const { toolCallId, toolName, argumentsJson } = request;

    // ---- 1. the raw request, before anything is believed -------------------
    await this.audit(ctx, 'TOOL_CALL_REQUESTED', {
      toolCallId,
      summary: `Model proposed ${toolName}`,
      detail: {
        toolName,
        // VERBATIM. Not reformatted, not re-serialized, not pretty-printed.
        // An auditor must see what the model actually emitted.
        rawArgumentsJson: argumentsJson,
        argumentsByteLength: argumentsJson.length,
        // PURELY ADDITIVE, and absent on every call where no provider reshaped
        // anything - which is every call from every provider in this repository
        // except the local Ollama one, and almost every call even there. A
        // provider is allowed to unwrap a container the model's runtime got
        // wrong (`ToolCallArgumentsNormalization` in src/ports/llm.ts says under
        // what rule), and this is where the bytes it replaced are recorded, so
        // "what did the model actually say" stays answerable from the audit
        // trail alone.
        ...(request.argumentsNormalization
          ? {
              argumentsNormalizationRule: request.argumentsNormalization.rule,
              preNormalizationArgumentsJson: request.argumentsNormalization.rawArgumentsJson,
            }
          : {}),
      },
    });

    // ---- 2. is this a tool at all? -----------------------------------------
    const definition = findToolDefinition(toolName);
    if (!definition) {
      return this.reject(ctx, toolCallId, toolName, {
        code: ValidationErrorCode.UNSUPPORTED_TOOL,
        reason:
          `There is no tool called "${toolName}". You may only use the tools you were given. ` +
          `Available: ${ctx.allowedToolNames.join(', ')}.`,
        data: { available_tools: [...ctx.allowedToolNames] },
      });
    }

    // ---- 3. do the arguments parse, and mean anything? ---------------------
    const parsedJson = tryParseJson<unknown>(argumentsJson);
    if (!parsedJson.ok) {
      return this.reject(ctx, toolCallId, toolName, {
        code: ValidationErrorCode.SCHEMA_VIOLATION,
        reason:
          `The arguments for ${toolName} were not valid JSON (${parsedJson.error}). ` +
          'Send the arguments again as a well-formed JSON object.',
        data: { parse_error: parsedJson.error },
      });
    }

    const parsedArgs = definition.schema.safeParse(parsedJson.value);
    if (!parsedArgs.success) {
      const issues = parsedArgs.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      }));
      return this.reject(ctx, toolCallId, toolName, {
        code: ValidationErrorCode.SCHEMA_VIOLATION,
        reason:
          `The arguments for ${toolName} did not match its schema: ` +
          `${issues.map((issue) => `${issue.path} - ${issue.message}`).join('; ')}.`,
        data: { issues },
      });
    }
    const args = parsedArgs.data as Record<string, unknown>;

    // ---- 4. is this tool permitted by the PINNED configuration? -------------
    if (!ctx.allowedToolNames.includes(definition.name)) {
      return this.reject(ctx, toolCallId, toolName, {
        code: ValidationErrorCode.POLICY_VIOLATION,
        reason:
          `${definition.name} is not enabled for this conversation. ` +
          `You may use: ${ctx.allowedToolNames.join(', ')}. Say what you cannot do rather than doing it.`,
        data: {
          available_tools: [...ctx.allowedToolNames],
          agent_configuration_version: ctx.agentConfiguration.version,
        },
      });
    }

    // ---- 5. which rows is this actually about? ------------------------------
    const subject = await this.resolveSubject(definition, args, ctx);
    if ('rejection' in subject) {
      return this.reject(ctx, toolCallId, toolName, subject.rejection);
    }

    // ---- 6. the deterministic datetime gate ---------------------------------
    let slot: ResolvedSlot | null = null;
    let provenance: ValidationProvenance | null = null;

    if (definition.timeBearing) {
      const validated = await this.validateTime(definition, args, ctx, subject.value);
      if ('rejection' in validated) {
        return this.reject(ctx, toolCallId, toolName, validated.rejection);
      }
      slot = validated.slot;
      provenance = validated.provenance;
    }

    // ---- 7. say, on the record, that this call may proceed ------------------
    await this.audit(ctx, 'TOOL_CALL_VALIDATED', {
      toolCallId,
      summary: slot
        ? `${definition.name} accepted; "${String(args[definition.timeBearing?.rawField ?? 'when'] ?? '')}" resolved to ${slot.startLocal} ${slot.timezone}`
        : `${definition.name} accepted`,
      detail: {
        toolName: definition.name,
        arguments: args,
        subject: {
          contactId: subject.value.contact.id,
          meetingId: subject.value.meeting?.id ?? null,
          calendarRef: subject.value.calendarRef ?? null,
        },
        ...(slot ? { slot } : {}),
        ...(provenance ? { provenance } : {}),
        mutatesState: definition.mutatesState,
      },
      subjectType: subject.value.meeting ? 'MEETING' : 'CONTACT',
      subjectId: subject.value.meeting?.id ?? subject.value.contact.id,
    });

    // ---- 8. and only now, act ----------------------------------------------
    const handler = TOOL_HANDLERS[definition.name];
    const outcome = await handler({
      definition,
      args,
      toolCallId,
      ctx,
      subject: subject.value,
      slot,
      provenance,
      deps: this.deps,
    });

    if (!outcome.ok) {
      // A service refused after the chokepoint let the call through - e.g. an
      // idempotency conflict, or a follow-up type that is declared but not
      // executable. It is still a refusal and it is recorded as one.
      await this.audit(ctx, 'TOOL_CALL_REJECTED', {
        toolCallId,
        summary: `${definition.name} refused by ${definition.name === 'schedule_followup' ? 'FutureActionService' : 'the service'}: ${outcome.code}`,
        detail: { toolName: definition.name, code: outcome.code, reason: outcome.reason, arguments: args },
        subjectType: 'CONTACT',
        subjectId: subject.value.contact.id,
      });
      return outcome;
    }

    await this.audit(ctx, 'TOOL_CALL_EXECUTED', {
      toolCallId,
      summary: outcome.summary,
      detail: {
        toolName: definition.name,
        data: outcome.data,
        persisted: outcome.persisted ?? null,
      },
      ...(outcome.persisted
        ? {
            subjectType: outcome.persisted.type as 'MEETING',
            subjectId: outcome.persisted.id,
          }
        : { subjectType: 'CONTACT' as const, subjectId: subject.value.contact.id }),
    });

    return outcome;
  }

  // -------------------------------------------------------------------------
  // Subject resolution. The answer always comes from a ROW.
  // -------------------------------------------------------------------------

  private async resolveSubject(
    definition: ToolDefinition,
    args: Record<string, unknown>,
    ctx: ToolDispatchContext,
  ): Promise<{ value: ResolvedSubject } | { rejection: RejectionSpec }> {
    const db: Database = this.deps.db;

    if (definition.subject.kind === 'contact') {
      const claimed = String(args[definition.subject.field] ?? '');
      if (claimed !== ctx.contact.id) {
        // THE ANTI-FABRICATION GATE. A model that invents, guesses, or
        // remembers-wrong a contact id cannot reach a stranger through it: the
        // only acceptable value is the contact this conversation is with.
        return {
          rejection: {
            code: ValidationErrorCode.UNKNOWN_CONTACT,
            reason:
              `There is no contact "${claimed}" in this conversation. You are speaking with contact ` +
              `${ctx.contact.id}, and that is the only id you may use. Do not guess an id.`,
            data: { expected_contact_id: ctx.contact.id, received_contact_id: claimed },
          },
        };
      }

      const connection = await db.calendarConnections.findUsableByOrganization(ctx.organizationId);
      return {
        value: {
          contact: ctx.contact,
          ...(connection
            ? { calendarRef: connection.calendarRef, calendarConnectionId: connection.id }
            : {}),
        },
      };
    }

    // ---- subject.kind === 'meeting' ----------------------------------------
    const meetingId = String(args[definition.subject.field] ?? '');
    const meeting: Meeting | null = await db.meetings.findById(meetingId);

    if (!meeting || meeting.organizationId !== ctx.organizationId) {
      return {
        rejection: {
          code: ValidationErrorCode.POLICY_VIOLATION,
          reason:
            `There is no meeting "${meetingId}". Use only a meeting id a tool result gave you in this ` +
            'conversation, or call get_contact_context to see what is actually booked.',
          data: { received_meeting_id: meetingId },
        },
      };
    }

    if (meeting.contactId !== ctx.contact.id) {
      return {
        rejection: {
          code: ValidationErrorCode.POLICY_VIOLATION,
          reason: `Meeting ${meetingId} belongs to a different contact and cannot be changed from this conversation.`,
          data: { received_meeting_id: meetingId },
        },
      };
    }

    const connection = meeting.calendarConnectionId
      ? await db.calendarConnections.findById(meeting.calendarConnectionId)
      : await db.calendarConnections.findUsableByOrganization(ctx.organizationId);

    return {
      value: {
        contact: ctx.contact,
        meeting,
        ...(connection ? { calendarRef: connection.calendarRef, calendarConnectionId: connection.id } : {}),
      },
    };
  }

  // -------------------------------------------------------------------------
  // The datetime gate. Delegated ENTIRELY to SchedulingValidator.
  //
  // There is no date arithmetic in this file, and there must never be. The only
  // decisions made here are which checks to ask for and which zone to read the
  // proposal in - and the zone comes from a persisted row, never from a
  // calculation.
  //
  // TWO ZONES, AND THEY ARE NOT INTERCHANGEABLE
  // -------------------------------------------------------------------------
  // `timezone` below is the zone the model's PHRASE is read in, and the model
  // may legitimately influence it ("I'm in Denver this week"). It goes in as
  // `proposal.timezone`. `persistedContactTimezone` is `Contact.timezone` off
  // the row, it is passed separately, and it is what the business-hours window
  // is evaluated in. Collapsing the two hands the model the guardrail: assert a
  // zone in which 23:30 reads as 10:00 and the check passes on its own terms.
  // See `businessHoursAnchor` in `src/scheduling/businessHours.ts`.
  // -------------------------------------------------------------------------

  private async validateTime(
    definition: ToolDefinition,
    args: Record<string, unknown>,
    ctx: ToolDispatchContext,
    subject: ResolvedSubject,
  ): Promise<{ slot: ResolvedSlot; provenance: ValidationProvenance } | { rejection: RejectionSpec }> {
    const timeBearing = definition.timeBearing;
    if (!timeBearing) {
      throw new Error(`validateTime called for ${definition.name}, which is not time-bearing.`);
    }

    const raw = String(args[timeBearing.rawField] ?? '');
    const override = timeBearing.timezoneField ? args[timeBearing.timezoneField] : undefined;
    const duration = timeBearing.durationField ? args[timeBearing.durationField] : undefined;

    // ---- the zone the PHRASE is read in ------------------------------------
    // Precedence: what the contact said they were in > the persisted contact row
    // > the configuration default. The MEETING's own zone wins for a reschedule,
    // because that is the zone it was agreed in.
    //
    // This is the only thing the model's `timezone` argument decides. It chooses
    // which INSTANT "10am" names; it does not choose the business-hours window
    // that instant is judged against - see `persistedContactTimezone` below.
    const timezone =
      (typeof override === 'string' && override.trim().length > 0 ? override.trim() : undefined) ??
      subject.meeting?.timezone ??
      subject.contact.timezone ??
      ctx.policy.defaultTimezone;

    if (timeBearing.checkAvailability && !subject.calendarRef) {
      return {
        rejection: {
          code: ValidationErrorCode.POLICY_VIOLATION,
          reason:
            'No calendar is connected for this organization, so availability cannot be checked and a ' +
            'meeting must not be booked blind. Offer to have a colleague arrange it.',
        },
      };
    }

    const result = await this.deps.validator.validate({
      proposal: {
        raw,
        timezone,
        ...(typeof duration === 'number' ? { durationMinutes: duration } : {}),
      },
      policy: ctx.policy,
      // FROM THE ROW, always. Never `args[timeBearing.timezoneField]`, never
      // `timezone` above, never `slot.timezone`. This is the value the
      // business-hours window is read in, and the whole point is that the model
      // cannot reach it.
      persistedContactTimezone: subject.contact.timezone,
      checkBusinessHours: timeBearing.checkBusinessHours,
      checkAvailability: timeBearing.checkAvailability,
      ...(subject.calendarRef ? { calendarRef: subject.calendarRef } : {}),
      // Pinned once per turn: the chokepoint and the service must not be able
      // to disagree about what time it is.
      nowUtc: ctx.nowUtc,
    });

    if (!result.ok) {
      return { rejection: { code: result.code, reason: result.reason, provenance: result.provenance } };
    }

    return { slot: result.value, provenance: result.provenance };
  }

  // -------------------------------------------------------------------------

  private async reject(
    ctx: ToolDispatchContext,
    toolCallId: string,
    toolName: string,
    spec: RejectionSpec,
  ): Promise<ToolRejection> {
    await this.audit(ctx, 'TOOL_CALL_REJECTED', {
      toolCallId,
      summary: `Refused ${toolName}: ${spec.code}`,
      detail: {
        toolName,
        code: spec.code,
        reason: spec.reason,
        ...(spec.provenance ? { provenance: spec.provenance } : {}),
        ...(spec.data ?? {}),
        // Stated in the event itself so a reader never has to infer it.
        domainRowsWritten: 0,
      },
      subjectType: 'CONTACT',
      subjectId: ctx.contact.id,
    });

    return toolRejection({
      toolCallId,
      toolName,
      code: spec.code,
      reason: spec.reason,
      retryable: isRetryable(spec.code),
      ...(spec.provenance ? { provenance: spec.provenance } : {}),
      ...(spec.data ? { data: spec.data } : {}),
    });
  }

  private async audit(
    ctx: ToolDispatchContext,
    type: AuditEventType,
    event: {
      toolCallId: string;
      summary: string;
      detail: Record<string, unknown>;
      subjectType?: 'CONTACT' | 'MEETING' | 'FUTURE_ACTION' | 'QUALIFICATION_STATE' | 'CALL_OUTCOME' | 'TASK';
      subjectId?: string;
    },
  ): Promise<void> {
    await this.deps.db.audit.record({
      type,
      organizationId: ctx.organizationId,
      correlationId: ctx.correlationId,
      conversationId: ctx.conversationId,
      contactId: ctx.contact.id,
      toolCallId: event.toolCallId,
      subjectType: event.subjectType ?? 'CONTACT',
      subjectId: event.subjectId ?? ctx.contact.id,
      summary: event.summary,
      detailJson: event.detail,
      occurredAt: ctx.nowUtc,
    });
  }
}

interface RejectionSpec {
  readonly code: ValidationErrorCodeType;
  readonly reason: string;
  readonly provenance?: ValidationProvenance;
  readonly data?: Record<string, unknown>;
}
