/**
 * `MeetingSchedulingService` - validate, then persist, in that order, always.
 *
 * THE DISCIPLINE, STATED ONCE
 * ---------------------------------------------------------------------------
 *  - ok:false  -> NOTHING is written except a `VALIDATION_REJECTED` audit event.
 *                 No Meeting, no calendar call, no side effect of any kind. A
 *                 test asserts the domain row count is unchanged for every
 *                 rejection path.
 *  - ok:true   -> the Meeting row and the audit events that explain it
 *                 (`TOOL_CALL_VALIDATED`, `ENTITY_PERSISTED`) are written in ONE
 *                 transaction, so a Meeting nobody can account for is not a
 *                 state this system can reach. The serialized
 *                 `ValidationProvenance` goes into
 *                 `Meeting.validationProvenanceJson`, which is NOT NULL.
 *  - only THEN is the CalendarProvider invoked, and its `externalEventId`
 *    written back. The external system is the last thing touched and the first
 *    thing that may fail without corrupting our own state.
 *
 * IDEMPOTENCY
 * ---------------------------------------------------------------------------
 * `idempotencyKey` is unique in the database. Scheduling twice with the same
 * key returns the EXISTING meeting rather than creating a duplicate - checked
 * up front, and again by catching the unique-constraint conflict, so two
 * concurrent retries still cannot both win.
 *
 * DELIBERATE NON-GOAL
 * ---------------------------------------------------------------------------
 * Conflicts are detected against the `AvailabilityProvider` only. Checking the
 * organization's own previously-booked `Meeting` rows as well
 * (`meetings.listOverlapping` exists for it) is a sensible next step but is NOT
 * in this slice, and is not done silently: it is written down here.
 */
import { DateTime } from 'luxon';

import type { AuditRecorder } from '../audit/types.js';
import type { Database } from '../db/database.js';
import type { Repositories } from '../db/repositories/index.js';
import type { Contact, Meeting } from '../domain/entities.js';
import type { CalendarAttendee, CalendarProvider } from '../ports/calendar.js';
import type { Clock, IsoUtcString } from '../ports/clock.js';
import type { ValidationProvenance, ValidationResult } from '../ports/validation.js';
import { validationFailed, validationOk, ValidationErrorCode } from '../ports/validation.js';
import { parseValidationProvenance } from '../domain/provenance.js';
import { ConflictError } from '../shared/errors.js';
import { stringifyJson } from '../shared/json.js';
import { buildProvenance, ValidationCheckLog } from './checkLog.js';
import type { ResolvedSlot } from './dateTimeResolver.js';
import { assertResolutionsAgree } from './pinnedSlot.js';
import { formatOffset } from './zoneMath.js';
import { schedulingPolicyFromAgentConfiguration, type SchedulingPolicy } from './policy.js';
import { SCHEDULING_VALIDATOR_VERSION, type SchedulingValidator } from './schedulingValidator.js';

export interface MeetingProposal {
  /** EXACTLY what the model proposed. Stored verbatim in the receipt. */
  readonly raw: string;
  /** Overrides the contact's zone. Use only when the contact said so. */
  readonly timezone?: string;
  readonly durationMinutes?: number;
}

/**
 * What a caller that has ALREADY validated the proposal hands over.
 *
 * `ToolDispatcher` is that caller: it pins `now` once per turn, validates the
 * model's raw phrase against it, and audits the result. Both fields exist so
 * that the service's own re-validation uses the same `now` and can be checked
 * against the same answer. See `pinnedSlot.ts` for why.
 */
interface PinnedResolution {
  /**
   * The instant the caller pinned for the whole turn.
   *
   * When present it is the only `now` this call uses: the clock is not read
   * again, so the proposal cannot resolve against a later instant than the one
   * the caller already validated and audited.
   *
   * Absent - a direct call that has pinned nothing - the clock is read once.
   */
  readonly nowUtc?: IsoUtcString;
  /**
   * The slot the caller already validated against `nowUtc`, supplied purely so
   * the service's re-validation can be reconciled with it. A disagreement is
   * refused rather than persisted.
   */
  readonly validatedSlot?: ResolvedSlot;
}

export interface ScheduleMeetingInput extends PinnedResolution {
  readonly organizationId: string;
  readonly contactId: string;
  readonly conversationId?: string | null;
  /** The configuration pinned to this conversation. The ONLY policy source. */
  readonly agentConfigurationId: string;
  readonly proposal: MeetingProposal;
  readonly title: string;
  readonly description?: string | null;
  /** Defaults to the organization's usable connection. */
  readonly calendarConnectionId?: string | null;
  readonly attendees?: readonly CalendarAttendee[];
  /** Makes a retried tool call a no-op instead of a duplicate meeting. */
  readonly idempotencyKey?: string | null;
  /** Ties every audit event of this agent turn together. Required. */
  readonly correlationId: string;
  readonly toolCallId?: string | null;
}

export interface RescheduleMeetingInput extends PinnedResolution {
  readonly meetingId: string;
  readonly agentConfigurationId: string;
  readonly proposal: MeetingProposal;
  readonly correlationId: string;
  readonly toolCallId?: string | null;
  readonly reason?: string;
}

/**
 * Cancelling resolves no datetime, so there is no slot to reconcile - but its
 * audit events still carry an `occurredAt`, and that must be the turn's pinned
 * instant like every other event in the chain.
 */
export interface CancelMeetingInput extends Pick<PinnedResolution, 'nowUtc'> {
  readonly meetingId: string;
  readonly correlationId: string;
  readonly toolCallId?: string | null;
  readonly reason?: string;
}

export interface ScheduledMeeting {
  readonly meeting: Meeting;
  /** The slot as validated. Reconstructed from the row on an idempotent replay. */
  readonly slot: ResolvedSlot;
  /** True when an existing row was returned instead of a new one being created. */
  readonly reusedExisting: boolean;
  readonly externalCalendarEventId: string | null;
}

export interface MeetingSchedulingServiceOptions {
  readonly db: Database;
  readonly clock: Clock;
  readonly validator: SchedulingValidator;
  readonly calendar: CalendarProvider;
}

export class MeetingSchedulingService {
  private readonly db: Database;
  private readonly clock: Clock;
  private readonly validator: SchedulingValidator;
  private readonly calendar: CalendarProvider;

  constructor(options: MeetingSchedulingServiceOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.validator = options.validator;
    this.calendar = options.calendar;
  }

  // -------------------------------------------------------------------------
  // schedule
  // -------------------------------------------------------------------------

  async schedule(input: ScheduleMeetingInput): Promise<ValidationResult<ScheduledMeeting>> {
    const checks = new ValidationCheckLog();
    // The caller's pinned instant when there is one. Reading the clock here
    // instead would re-resolve the raw phrase against a LATER `now` than the one
    // the caller validated and audited - see `pinnedSlot.ts`.
    const nowUtc = input.nowUtc ?? this.clock.nowUtc();

    const reject = async (
      code: (typeof ValidationErrorCode)[keyof typeof ValidationErrorCode],
      reason: string,
      timezone: string,
      // NULL when the contact could not be resolved: `AuditEvent.contactId` is a
      // real foreign key, and an audit write must never fail because the thing
      // it is reporting on does not exist.
      contactId: string | null = input.contactId,
    ): Promise<ValidationResult<ScheduledMeeting>> => {
      const provenance = buildProvenance(
        { validatorVersion: SCHEDULING_VALIDATOR_VERSION, nowUtc, rawProposedValue: input.proposal.raw, resolvedTimezone: timezone },
        checks,
      );
      await this.recordRejection(input, code, reason, provenance, contactId);
      return validationFailed(code, reason, provenance);
    };

    // ---- idempotent replay, before anything else ---------------------------
    if (input.idempotencyKey) {
      const existing = await this.db.meetings.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        checks.pass('idempotency_replay', `idempotencyKey "${input.idempotencyKey}" already produced meeting ${existing.id}`);
        return validationOk(this.asScheduled(existing, true), parseValidationProvenance(existing.validationProvenanceJson));
      }
    }

    // ---- preconditions ------------------------------------------------------
    const contact = await this.db.contacts.findById(input.contactId);
    if (!contact || contact.organizationId !== input.organizationId) {
      checks.fail('contact_exists', `Contact ${input.contactId} does not exist in organization ${input.organizationId}.`);
      return reject(
        ValidationErrorCode.UNKNOWN_CONTACT,
        `Contact ${input.contactId} does not exist in this organization.`,
        input.proposal.timezone ?? 'UTC',
        null,
      );
    }
    checks.pass('contact_exists', `contact ${contact.id} (${contact.timezone})`);

    const policy = await this.loadPolicy(input.agentConfigurationId, checks);
    const timezone = input.proposal.timezone ?? contact.timezone ?? policy.defaultTimezone;

    const connection = input.calendarConnectionId
      ? await this.db.calendarConnections.findById(input.calendarConnectionId)
      : await this.db.calendarConnections.findUsableByOrganization(input.organizationId);

    if (!connection || connection.organizationId !== input.organizationId) {
      checks.fail(
        'calendar_connection_resolved',
        `No usable CalendarConnection for organization ${input.organizationId}.`,
      );
      return reject(
        ValidationErrorCode.POLICY_VIOLATION,
        'No calendar is connected, so availability cannot be checked and a meeting must not be booked blind.',
        timezone,
      );
    }
    checks.pass('calendar_connection_resolved', `${connection.provider} calendar "${connection.calendarRef}"`);

    // ---- the deterministic datetime gate ------------------------------------
    const validated = await this.validator.validate({
      proposal: {
        raw: input.proposal.raw,
        timezone,
        ...(input.proposal.durationMinutes !== undefined ? { durationMinutes: input.proposal.durationMinutes } : {}),
      },
      policy,
      // FROM THE ROW, never from `input.proposal.timezone`. The proposal's zone
      // decides which instant the phrase names; this one decides whose office
      // hours that instant is judged against. See `businessHoursAnchor`.
      persistedContactTimezone: contact.timezone,
      calendarRef: connection.calendarRef,
      nowUtc,
    });

    if (!validated.ok) {
      // The validator's own receipt already carries its ordered checks; merge
      // the service preconditions in FRONT of them so the story reads in order.
      const provenance = mergeProvenance(checks, validated.provenance);
      await this.recordRejection(input, validated.code, validated.reason, provenance);
      return validationFailed(validated.code, validated.reason, provenance);
    }

    const slot = validated.value;
    // Same `now`, same phrase, same policy - so this must be the same slot the
    // caller validated. Checked before the transaction opens, so a disagreement
    // costs a loud failure and not a row the audit trail contradicts.
    assertResolutionsAgree('schedule_meeting', input.validatedSlot, slot, nowUtc);
    const provenance = mergeProvenance(checks, validated.provenance);
    const provenanceJson = stringifyJson(provenance);

    // ---- persist: row + its audit events, atomically ------------------------
    let meeting: Meeting;
    try {
      meeting = await this.db.withTransaction(async (tx) => {
        const created = await tx.meetings.create({
          organizationId: input.organizationId,
          contactId: contact.id,
          conversationId: input.conversationId ?? null,
          calendarConnectionId: connection.id,
          title: input.title,
          description: input.description ?? null,
          startUtc: slot.startUtc,
          endUtc: slot.endUtc,
          timezone: slot.timezone,
          status: 'SCHEDULED',
          idempotencyKey: input.idempotencyKey ?? null,
          validationProvenanceJson: provenanceJson,
        });

        await tx.audit.record({
          type: 'TOOL_CALL_VALIDATED',
          organizationId: input.organizationId,
          correlationId: input.correlationId,
          conversationId: input.conversationId ?? null,
          contactId: contact.id,
          toolCallId: input.toolCallId ?? null,
          subjectType: 'MEETING',
          subjectId: created.id,
          summary: `Proposed time "${input.proposal.raw}" passed all ${provenance.checks.length} deterministic checks`,
          detailJson: { provenance, proposal: input.proposal, slot },
          occurredAt: nowUtc,
        });

        await tx.audit.record({
          type: 'ENTITY_PERSISTED',
          organizationId: input.organizationId,
          correlationId: input.correlationId,
          conversationId: input.conversationId ?? null,
          contactId: contact.id,
          toolCallId: input.toolCallId ?? null,
          subjectType: 'MEETING',
          subjectId: created.id,
          summary: `Meeting scheduled for ${slot.startLocal} ${slot.timezone}`,
          detailJson: {
            meetingId: created.id,
            startUtc: created.startUtc,
            endUtc: created.endUtc,
            timezone: created.timezone,
            idempotencyKey: created.idempotencyKey,
          },
          occurredAt: nowUtc,
        });

        return created;
      });
    } catch (error) {
      // Lost an idempotency race: the other writer's row is the answer.
      if (error instanceof ConflictError && input.idempotencyKey) {
        const existing = await this.db.meetings.findByIdempotencyKey(input.idempotencyKey);
        if (existing) {
          return validationOk(
            this.asScheduled(existing, true),
            parseValidationProvenance(existing.validationProvenanceJson),
          );
        }
      }
      throw error;
    }

    // ---- external system, last -----------------------------------------------
    const externalCalendarEventId = await this.pushToCalendar(
      meeting,
      slot,
      connection.calendarRef,
      input,
      contact,
      nowUtc,
    );

    const stored = externalCalendarEventId
      ? await this.db.meetings.update(meeting.id, { externalCalendarEventId })
      : meeting;

    return validationOk(
      { meeting: stored, slot, reusedExisting: false, externalCalendarEventId },
      provenance,
    );
  }

  // -------------------------------------------------------------------------
  // reschedule
  // -------------------------------------------------------------------------

  async reschedule(input: RescheduleMeetingInput): Promise<ValidationResult<ScheduledMeeting>> {
    const checks = new ValidationCheckLog();
    // The caller's pinned instant when there is one - see `schedule` above.
    const nowUtc = input.nowUtc ?? this.clock.nowUtc();

    const meeting = await this.db.meetings.findById(input.meetingId);
    if (!meeting) {
      checks.fail('meeting_exists', `Meeting ${input.meetingId} does not exist.`);
      const provenance = buildProvenance(
        { validatorVersion: SCHEDULING_VALIDATOR_VERSION, nowUtc, rawProposedValue: input.proposal.raw, resolvedTimezone: 'UTC' },
        checks,
      );
      return validationFailed(ValidationErrorCode.POLICY_VIOLATION, `Meeting ${input.meetingId} does not exist.`, provenance);
    }
    checks.pass('meeting_exists', `meeting ${meeting.id} is ${meeting.status}`);

    if (meeting.status === 'CANCELLED' || meeting.status === 'COMPLETED') {
      checks.fail('meeting_transition_allowed', `A ${meeting.status} meeting cannot be rescheduled.`);
      const provenance = buildProvenance(
        { validatorVersion: SCHEDULING_VALIDATOR_VERSION, nowUtc, rawProposedValue: input.proposal.raw, resolvedTimezone: meeting.timezone },
        checks,
      );
      await this.recordRejectionForMeeting(meeting, input.correlationId, input.toolCallId ?? null, ValidationErrorCode.POLICY_VIOLATION, `A ${meeting.status} meeting cannot be rescheduled.`, provenance, nowUtc);
      return validationFailed(
        ValidationErrorCode.POLICY_VIOLATION,
        `A ${meeting.status} meeting cannot be rescheduled.`,
        provenance,
      );
    }
    checks.pass('meeting_transition_allowed', `${meeting.status} -> RESCHEDULED is allowed`);

    const contact = await this.db.contacts.requireById(meeting.contactId);
    const policy = await this.loadPolicy(input.agentConfigurationId, checks);
    const timezone = input.proposal.timezone ?? contact.timezone ?? meeting.timezone;

    const connection = meeting.calendarConnectionId
      ? await this.db.calendarConnections.findById(meeting.calendarConnectionId)
      : await this.db.calendarConnections.findUsableByOrganization(meeting.organizationId);

    const validated = await this.validator.validate({
      proposal: {
        raw: input.proposal.raw,
        timezone,
        ...(input.proposal.durationMinutes !== undefined ? { durationMinutes: input.proposal.durationMinutes } : {}),
      },
      policy,
      // See `schedule` above. A reschedule reads the phrase in the meeting's own
      // agreed zone, but the window is still the contact's persisted one.
      persistedContactTimezone: contact.timezone,
      ...(connection ? { calendarRef: connection.calendarRef } : { checkAvailability: false }),
      nowUtc,
    });

    if (!validated.ok) {
      const provenance = mergeProvenance(checks, validated.provenance);
      await this.recordRejectionForMeeting(meeting, input.correlationId, input.toolCallId ?? null, validated.code, validated.reason, provenance, nowUtc);
      return validationFailed(validated.code, validated.reason, provenance);
    }

    const slot = validated.value;
    assertResolutionsAgree('reschedule_meeting', input.validatedSlot, slot, nowUtc);
    const provenance = mergeProvenance(checks, validated.provenance);

    const updated = await this.db.withTransaction(async (tx) => {
      const row = await tx.meetings.update(meeting.id, {
        startUtc: slot.startUtc,
        endUtc: slot.endUtc,
        timezone: slot.timezone,
        status: 'RESCHEDULED',
        validationProvenanceJson: stringifyJson(provenance),
      });

      await tx.audit.record({
        type: 'TOOL_CALL_VALIDATED',
        organizationId: meeting.organizationId,
        correlationId: input.correlationId,
        conversationId: meeting.conversationId,
        contactId: meeting.contactId,
        toolCallId: input.toolCallId ?? null,
        subjectType: 'MEETING',
        subjectId: row.id,
        summary: `Reschedule to "${input.proposal.raw}" passed all ${provenance.checks.length} deterministic checks`,
        detailJson: { provenance, proposal: input.proposal, slot, reason: input.reason ?? null },
        occurredAt: nowUtc,
      });

      await tx.audit.record({
        type: 'ENTITY_PERSISTED',
        organizationId: meeting.organizationId,
        correlationId: input.correlationId,
        conversationId: meeting.conversationId,
        contactId: meeting.contactId,
        toolCallId: input.toolCallId ?? null,
        subjectType: 'MEETING',
        subjectId: row.id,
        summary: `Meeting rescheduled from ${meeting.startUtc} to ${slot.startUtc}`,
        detailJson: { meetingId: row.id, previousStartUtc: meeting.startUtc, startUtc: row.startUtc, endUtc: row.endUtc },
        occurredAt: nowUtc,
      });

      return row;
    });

    if (updated.externalCalendarEventId && connection) {
      await this.calendar.updateEvent({
        calendarRef: connection.calendarRef,
        externalEventId: updated.externalCalendarEventId,
        startUtc: slot.startUtc,
        endUtc: slot.endUtc,
        timezone: slot.timezone,
        idempotencyKey: `reschedule:${updated.id}:${slot.startUtc}`,
      });
      await this.recordProviderInvocation(updated, input.correlationId, input.toolCallId ?? null, 'updateEvent', updated.externalCalendarEventId, nowUtc);
    }

    return validationOk(
      {
        meeting: updated,
        slot,
        reusedExisting: false,
        externalCalendarEventId: updated.externalCalendarEventId,
      },
      provenance,
    );
  }

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------

  async cancel(input: CancelMeetingInput): Promise<ValidationResult<ScheduledMeeting>> {
    const checks = new ValidationCheckLog();
    // The caller's pinned instant when there is one, so this cancellation's
    // audit events sit on the same `occurredAt` as the rest of the turn.
    const nowUtc = input.nowUtc ?? this.clock.nowUtc();

    const meeting = await this.db.meetings.findById(input.meetingId);
    if (!meeting) {
      checks.fail('meeting_exists', `Meeting ${input.meetingId} does not exist.`);
      return validationFailed(
        ValidationErrorCode.POLICY_VIOLATION,
        `Meeting ${input.meetingId} does not exist.`,
        buildProvenance(
          { validatorVersion: SCHEDULING_VALIDATOR_VERSION, nowUtc, rawProposedValue: input.reason ?? '', resolvedTimezone: 'UTC' },
          checks,
        ),
      );
    }
    checks.pass('meeting_exists', `meeting ${meeting.id} is ${meeting.status}`);

    if (meeting.status === 'CANCELLED') {
      // Idempotent: cancelling twice is not an error, and must not write again.
      checks.pass('idempotency_replay', 'meeting was already CANCELLED');
      return validationOk(this.asScheduled(meeting, true), parseValidationProvenance(meeting.validationProvenanceJson));
    }
    if (meeting.status === 'COMPLETED') {
      checks.fail('meeting_transition_allowed', 'A COMPLETED meeting cannot be cancelled.');
      const provenance = buildProvenance(
        { validatorVersion: SCHEDULING_VALIDATOR_VERSION, nowUtc, rawProposedValue: input.reason ?? '', resolvedTimezone: meeting.timezone },
        checks,
      );
      await this.recordRejectionForMeeting(meeting, input.correlationId, input.toolCallId ?? null, ValidationErrorCode.POLICY_VIOLATION, 'A COMPLETED meeting cannot be cancelled.', provenance, nowUtc);
      return validationFailed(ValidationErrorCode.POLICY_VIOLATION, 'A COMPLETED meeting cannot be cancelled.', provenance);
    }
    checks.pass('meeting_transition_allowed', `${meeting.status} -> CANCELLED is allowed`);

    const cancelled = await this.db.withTransaction(async (tx) => {
      const row = await tx.meetings.updateStatus(meeting.id, 'CANCELLED');
      await tx.audit.record({
        type: 'ENTITY_PERSISTED',
        organizationId: meeting.organizationId,
        correlationId: input.correlationId,
        conversationId: meeting.conversationId,
        contactId: meeting.contactId,
        toolCallId: input.toolCallId ?? null,
        subjectType: 'MEETING',
        subjectId: row.id,
        summary: `Meeting cancelled${input.reason ? `: ${input.reason}` : ''}`,
        detailJson: { meetingId: row.id, previousStatus: meeting.status, reason: input.reason ?? null },
        occurredAt: nowUtc,
      });
      return row;
    });

    if (cancelled.externalCalendarEventId && cancelled.calendarConnectionId) {
      const connection = await this.db.calendarConnections.findById(cancelled.calendarConnectionId);
      if (connection) {
        await this.calendar.cancelEvent({
          calendarRef: connection.calendarRef,
          externalEventId: cancelled.externalCalendarEventId,
          ...(input.reason ? { reason: input.reason } : {}),
          idempotencyKey: `cancel:${cancelled.id}`,
        });
        await this.recordProviderInvocation(cancelled, input.correlationId, input.toolCallId ?? null, 'cancelEvent', cancelled.externalCalendarEventId, nowUtc);
      }
    }

    return validationOk(
      this.asScheduled(cancelled, false),
      buildProvenance(
        { validatorVersion: SCHEDULING_VALIDATOR_VERSION, nowUtc, rawProposedValue: input.reason ?? '', resolvedTimezone: cancelled.timezone },
        checks,
      ),
    );
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  private async loadPolicy(agentConfigurationId: string, checks: ValidationCheckLog): Promise<SchedulingPolicy> {
    const configuration = await this.db.agentConfigurations.requireById(agentConfigurationId);
    const policy = schedulingPolicyFromAgentConfiguration(configuration);
    checks.pass(
      'agent_configuration_loaded',
      `AgentConfiguration ${configuration.id} v${configuration.version}: ` +
        `minLeadTime=${policy.minLeadTimeMinutes}min, horizon=${policy.maxSchedulingHorizonDays}d`,
    );
    return policy;
  }

  private async pushToCalendar(
    meeting: Meeting,
    slot: ResolvedSlot,
    calendarRef: string,
    input: ScheduleMeetingInput,
    contact: Contact,
    occurredAt: IsoUtcString,
  ): Promise<string | null> {
    if (!this.calendar.capabilities().canWrite) {
      return null;
    }

    const attendees: CalendarAttendee[] = [
      ...(input.attendees ?? []),
      ...(contact.email && !(input.attendees ?? []).some((a) => a.email === contact.email)
        ? [{ email: contact.email, displayName: contact.fullName, required: true }]
        : []),
    ];

    const ref = await this.calendar.createEvent({
      calendarRef,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      startUtc: slot.startUtc,
      endUtc: slot.endUtc,
      timezone: slot.timezone,
      attendees,
      // Scoped to the meeting id, so a retry of the calendar write is a no-op
      // even when the caller supplied no idempotency key of their own.
      idempotencyKey: input.idempotencyKey ?? `meeting:${meeting.id}`,
    });

    await this.recordProviderInvocation(
      meeting,
      input.correlationId,
      input.toolCallId ?? null,
      'createEvent',
      ref.externalEventId,
      occurredAt,
    );

    return ref.externalEventId;
  }

  private async recordProviderInvocation(
    meeting: Meeting,
    correlationId: string,
    toolCallId: string | null,
    operation: string,
    externalEventId: string,
    occurredAt: IsoUtcString,
  ): Promise<void> {
    await this.audit().record({
      type: 'PROVIDER_INVOKED',
      organizationId: meeting.organizationId,
      correlationId,
      conversationId: meeting.conversationId,
      contactId: meeting.contactId,
      toolCallId,
      subjectType: 'MEETING',
      subjectId: meeting.id,
      summary: `CalendarProvider ${this.calendar.name()}.${operation} -> ${externalEventId}`,
      detailJson: {
        provider: this.calendar.name(),
        operation,
        externalEventId,
        capabilities: this.calendar.capabilities(),
      },
      occurredAt,
    });
  }

  private async recordRejection(
    input: ScheduleMeetingInput,
    code: string,
    reason: string,
    provenance: ValidationProvenance,
    contactId: string | null = input.contactId,
  ): Promise<void> {
    await this.audit().record({
      type: 'VALIDATION_REJECTED',
      organizationId: input.organizationId,
      correlationId: input.correlationId,
      conversationId: input.conversationId ?? null,
      contactId,
      toolCallId: input.toolCallId ?? null,
      subjectType: 'CONTACT',
      subjectId: input.contactId,
      summary: `Refused to schedule "${input.proposal.raw}": ${code}`,
      detailJson: { code, reason, provenance, proposal: input.proposal, requestedContactId: input.contactId },
      occurredAt: provenance.nowUtc,
    });
  }

  private async recordRejectionForMeeting(
    meeting: Meeting,
    correlationId: string,
    toolCallId: string | null,
    code: string,
    reason: string,
    provenance: ValidationProvenance,
    occurredAt: IsoUtcString,
  ): Promise<void> {
    await this.audit().record({
      type: 'VALIDATION_REJECTED',
      organizationId: meeting.organizationId,
      correlationId,
      conversationId: meeting.conversationId,
      contactId: meeting.contactId,
      toolCallId,
      subjectType: 'MEETING',
      subjectId: meeting.id,
      summary: `Refused to change meeting ${meeting.id}: ${code}`,
      detailJson: { code, reason, provenance },
      occurredAt,
    });
  }

  private audit(): AuditRecorder {
    return (this.db as Repositories).audit;
  }

  /**
   * Rebuild a `ResolvedSlot` from a persisted row.
   *
   * Used on an idempotent replay, where the ROW is the record of what was
   * agreed. The interpretation is marked as a replay rather than invented.
   */
  private asScheduled(meeting: Meeting, reusedExisting: boolean): ScheduledMeeting {
    const start = DateTime.fromMillis(Date.parse(meeting.startUtc), { zone: meeting.timezone });
    const end = DateTime.fromMillis(Date.parse(meeting.endUtc), { zone: meeting.timezone });
    return {
      meeting,
      slot: {
        startUtc: meeting.startUtc,
        endUtc: meeting.endUtc,
        timezone: meeting.timezone,
        startLocal: start.toFormat("yyyy-LL-dd'T'HH:mm"),
        endLocal: end.toFormat("yyyy-LL-dd'T'HH:mm"),
        durationMinutes: Math.round((Date.parse(meeting.endUtc) - Date.parse(meeting.startUtc)) / 60_000),
        interpretation: {
          source: 'ISO_INSTANT',
          matched: ['persisted_row'],
          utcOffset: formatOffset(start.offset),
        },
      },
      reusedExisting,
      externalCalendarEventId: meeting.externalCalendarEventId,
    };
  }
}

/**
 * Put the service's preconditions in FRONT of the datetime pipeline's checks.
 *
 * The order in a receipt is the order things were established, and "we knew the
 * contact was real before we parsed their proposed time" is the true story.
 */
function mergeProvenance(serviceChecks: ValidationCheckLog, downstream: ValidationProvenance): ValidationProvenance {
  return {
    ...downstream,
    checks: [...serviceChecks.snapshot(), ...downstream.checks],
  };
}
