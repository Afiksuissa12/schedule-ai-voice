/**
 * The nine tool handlers.
 *
 * WHAT A HANDLER IS RESPONSIBLE FOR
 * ---------------------------------------------------------------------------
 * Almost nothing, and that is the design. By the time a handler runs, the
 * dispatcher has already: parsed the arguments against the tool's Zod schema,
 * confirmed the tool is permitted by the pinned `AgentConfiguration`, resolved
 * the subject rows from the DATABASE, and - for anything time-bearing - run the
 * full `SchedulingValidator` pipeline and been handed a `ResolvedSlot`.
 *
 * So a handler translates an already-validated request into a service call and
 * shapes the answer. It does not parse, it does not re-derive a datetime, and
 * it does not write a time-bearing row itself.
 *
 * THE ONE RULE WORTH REPEATING
 * ---------------------------------------------------------------------------
 * `get_contact_context` returns PERSISTED FACTS ONLY. Not what the model
 * asserted three turns ago, not what it inferred, not a merge of the two. Every
 * field in its result is read from a row. That is what makes it a defence
 * against fabrication rather than an amplifier of it.
 */
import { DateTime } from 'luxon';

import type { z } from 'zod';

import type { BusinessProfile } from '../../context/businessProfile.js';
import { ValidationErrorCode } from '../../ports/validation.js';
import { stringifyJson } from '../../shared/json.js';
import { deriveIdempotencyKey } from '../../shared/ids.js';
import type { ToolHandler, ToolHandlerInput } from './context.js';
import type {
  CancelMeetingArgsSchema,
  CheckAvailabilityArgsSchema,
  GetContactContextArgsSchema,
  RecordCallOutcomeArgsSchema,
  RescheduleMeetingArgsSchema,
  ScheduleFollowupArgsSchema,
  ScheduleMeetingArgsSchema,
  ToolName,
  TransferToHumanArgsSchema,
  UpdateQualificationArgsSchema,
} from './definitions.js';
import { explainScoring, scoreQualification } from './qualificationRubric.js';
import { toolRejection, toolSuccess, type ToolOutcome } from './results.js';

/** Narrow already-parsed arguments to their schema's output type. */
function argsOf<S extends z.ZodTypeAny>(input: ToolHandlerInput): z.infer<S> {
  return input.args as z.infer<S>;
}

/** A slot the dispatcher promised to have validated. Absent = programmer error. */
function requireSlot(input: ToolHandlerInput) {
  if (!input.slot) {
    // Not a model error: a time-bearing tool whose definition forgot to declare
    // `timeBearing` would land here, and it must fail loudly in development.
    throw new Error(
      `Tool ${input.definition.name} ran without a validated slot. Its definition must declare timeBearing.`,
    );
  }
  return input.slot;
}

/** "Thursday 5 March at 15:00 (America/New_York)" - how a time is spoken back. */
function describeLocal(startUtc: string, timezone: string): string {
  return `${DateTime.fromMillis(Date.parse(startUtc), { zone: timezone }).toFormat(
    "cccc d LLLL yyyy 'at' HH:mm",
  )} (${timezone})`;
}

/**
 * A phone number, masked.
 *
 * The model has no use for a dialable number - `DueActionRunner` places calls
 * from the persisted payload - and a number in a context window is a number
 * that can be read out loud. Enough digits survive for the contact to confirm
 * "yes, that's my mobile".
 */
function maskPhone(e164: string): string {
  return e164.length <= 6 ? e164 : `${e164.slice(0, 2)}${'•'.repeat(e164.length - 6)}${e164.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// 1. get_contact_context
// ---------------------------------------------------------------------------

const getContactContext: ToolHandler = async (input) => {
  const args = argsOf<typeof GetContactContextArgsSchema>(input);
  const { db } = input.deps;

  // Re-read rather than reusing the context copy: this tool's entire promise is
  // "what the database says right now", and an earlier tool in this same turn
  // may have changed it.
  const contact = await db.contacts.requireById(input.subject.contact.id);
  const [qualification, leads, meetings, futureActions] = await Promise.all([
    db.qualificationStates.findByContactId(contact.id),
    db.leads.listByContact(contact.id, { take: 5 }),
    db.meetings.listByContact(contact.id, { take: 5 }),
    db.futureActions.listByContact(contact.id, { take: 5 }),
  ]);

  const openMeetings = meetings.filter((meeting) => meeting.status === 'SCHEDULED' || meeting.status === 'RESCHEDULED');
  const pendingCallbacks = futureActions.filter((action) => action.status === 'PENDING' || action.status === 'CLAIMED');

  return toolSuccess({
    toolCallId: input.toolCallId,
    toolName: 'get_contact_context',
    summary:
      `${contact.fullName} in ${contact.timezone}; ` +
      `${contact.isDecisionMaker ? 'is' : 'is NOT'} the decision maker; ` +
      `${openMeetings.length} upcoming meeting(s), ${pendingCallbacks.length} promised callback(s).`,
    data: {
      contact_id: contact.id,
      full_name: contact.fullName,
      timezone: contact.timezone,
      local_time_now: describeLocal(input.ctx.nowUtc, contact.timezone),
      is_decision_maker: contact.isDecisionMaker,
      // Masked on purpose - see `maskPhone`.
      phone: maskPhone(contact.primaryPhoneE164),
      email: contact.email,
      notes: contact.notes,
      qualification: qualification
        ? {
            score: qualification.score,
            raw_score: qualification.rawScore,
            capped_score: qualification.cappedScore,
            band: qualification.band,
            rubric_version: qualification.rubricVersion,
            updated_at: qualification.updatedAt,
          }
        : null,
      lead_statuses: leads.map((lead) => ({ source: lead.source, status: lead.status })),
      upcoming_meetings: openMeetings.map((meeting) => ({
        meeting_id: meeting.id,
        title: meeting.title,
        starts: describeLocal(meeting.startUtc, meeting.timezone),
        status: meeting.status,
      })),
      promised_callbacks: pendingCallbacks.map((action) => ({
        future_action_id: action.id,
        type: action.type,
        due: describeLocal(action.scheduledForUtc, action.timezone),
        status: action.status,
      })),
      source: 'database',
      requested_contact_id: args.contact_id,
      // Present only when a business profile is wired in. Spread rather than
      // set to null so that, without one, this key does not exist and the
      // payload is byte-identical to Baseline V1's.
      ...(input.deps.businessProfile ? { business: businessBlock(input.deps.businessProfile) } : {}),
    },
  });
};

/**
 * The company facts `get_contact_context` hands back.
 *
 * A DIGEST, not the whole profile. The full document is already in the turn's
 * background; repeating it inside a tool result would double its cost in a
 * context window that is the scarcest thing this milestone has. What is here is
 * the part a model most often wants at the exact moment it looks a contact up:
 * who we are, what the headline numbers are, and - most usefully - what we
 * cannot do, so a promise is refused before it is made rather than after.
 *
 * Note the absence of anything to say. Every value is a fact.
 */
function businessBlock(profile: BusinessProfile): Record<string, unknown> {
  return {
    profile_ref: profile.profileRef,
    company_name: profile.company.name,
    what_we_are: profile.company.whatWeAre,
    products: profile.products.map((product) => ({
      name: product.name,
      summary: product.summary,
      does_not_do: product.limitations,
    })),
    pricing: {
      currency: profile.pricing.currency,
      plans: profile.pricing.plans.map((plan) => ({
        name: plan.name,
        headline_price: plan.headlinePrice,
        billing_period: plan.billingPeriod,
      })),
      discount_facts: profile.pricing.discountFacts,
    },
    agent_may_not_commit: profile.pricing.agentMayNotCommit,
    policies: profile.policies.map((policy) => ({ topic: policy.topic, fact: policy.fact })),
    objective: profile.objectives.primary,
    // Said plainly, because a model that has just been handed a pile of facts
    // is a model about to recite them.
    how_to_use_this: 'Facts you may draw on. Not sentences to read out, and not a list to work through.',
  };
}

// ---------------------------------------------------------------------------
// 2. check_availability
// ---------------------------------------------------------------------------

const checkAvailability: ToolHandler = async (input) => {
  const slot = requireSlot(input);

  // Reaching this handler at all means the slot passed every check INCLUDING
  // `no_busy_conflict`. A conflict is surfaced as a rejection by the
  // dispatcher, with the busy interval named - so "we got here" is the answer.
  return toolSuccess({
    toolCallId: input.toolCallId,
    toolName: 'check_availability',
    summary: `${describeLocal(slot.startUtc, slot.timezone)} is free for ${slot.durationMinutes} minutes.`,
    data: {
      available: true,
      start_local: slot.startLocal,
      end_local: slot.endLocal,
      timezone: slot.timezone,
      duration_minutes: slot.durationMinutes,
      spoken: describeLocal(slot.startUtc, slot.timezone),
      checked_against: input.deps.availability.name(),
      // Nothing was booked. Said explicitly so the model does not assume it.
      booked: false,
    },
    ...(input.provenance ? { provenance: input.provenance } : {}),
  });
};

// ---------------------------------------------------------------------------
// 3. schedule_meeting
// ---------------------------------------------------------------------------

const scheduleMeeting: ToolHandler = async (input) => {
  const args = argsOf<typeof ScheduleMeetingArgsSchema>(input);
  const slot = requireSlot(input);

  const result = await input.deps.meetings.schedule({
    organizationId: input.ctx.organizationId,
    contactId: input.subject.contact.id,
    conversationId: input.ctx.conversationId,
    agentConfigurationId: input.ctx.agentConfiguration.id,
    proposal: {
      raw: args.when,
      timezone: slot.timezone,
      ...(args.duration_minutes !== undefined ? { durationMinutes: args.duration_minutes } : {}),
    },
    title: args.title,
    description: args.description ?? null,
    ...(input.subject.calendarConnectionId ? { calendarConnectionId: input.subject.calendarConnectionId } : {}),
    // ONE `now` for the turn. The chokepoint resolved `args.when` against
    // `ctx.nowUtc` and audited the answer; handing both over means the service's
    // own re-validation runs against the same instant and is reconciled with the
    // same slot, so the row that lands is the one the trail already explained.
    nowUtc: input.ctx.nowUtc,
    validatedSlot: slot,
    // Same conversation + same agreed instant = same meeting, however many
    // times a retried turn asks for it.
    idempotencyKey: deriveIdempotencyKey('meeting', {
      conversationId: input.ctx.conversationId,
      contactId: input.subject.contact.id,
      startUtc: slot.startUtc,
    }),
    correlationId: input.ctx.correlationId,
    toolCallId: input.toolCallId,
  });

  if (!result.ok) {
    return toolRejection({
      toolCallId: input.toolCallId,
      toolName: 'schedule_meeting',
      code: result.code,
      reason: result.reason,
      provenance: result.provenance,
      retryable: isRetryable(result.code),
    });
  }

  const { meeting } = result.value;
  return toolSuccess({
    toolCallId: input.toolCallId,
    toolName: 'schedule_meeting',
    summary: `Meeting "${meeting.title}" is booked for ${describeLocal(meeting.startUtc, meeting.timezone)}.`,
    data: {
      booked: true,
      meeting_id: meeting.id,
      title: meeting.title,
      start_local: result.value.slot.startLocal,
      end_local: result.value.slot.endLocal,
      timezone: meeting.timezone,
      spoken: describeLocal(meeting.startUtc, meeting.timezone),
      already_existed: result.value.reusedExisting,
    },
    provenance: result.provenance,
    persisted: { type: 'MEETING', id: meeting.id },
  });
};

// ---------------------------------------------------------------------------
// 4. reschedule_meeting
// ---------------------------------------------------------------------------

const rescheduleMeeting: ToolHandler = async (input) => {
  const args = argsOf<typeof RescheduleMeetingArgsSchema>(input);
  const slot = requireSlot(input);

  const result = await input.deps.meetings.reschedule({
    meetingId: args.meeting_id,
    agentConfigurationId: input.ctx.agentConfiguration.id,
    proposal: {
      raw: args.when,
      timezone: slot.timezone,
      ...(args.duration_minutes !== undefined ? { durationMinutes: args.duration_minutes } : {}),
    },
    // See `scheduleMeeting` above: one `now`, one resolution, reconciled.
    nowUtc: input.ctx.nowUtc,
    validatedSlot: slot,
    correlationId: input.ctx.correlationId,
    toolCallId: input.toolCallId,
    ...(args.reason ? { reason: args.reason } : {}),
  });

  if (!result.ok) {
    return toolRejection({
      toolCallId: input.toolCallId,
      toolName: 'reschedule_meeting',
      code: result.code,
      reason: result.reason,
      provenance: result.provenance,
      retryable: isRetryable(result.code),
    });
  }

  const { meeting } = result.value;
  return toolSuccess({
    toolCallId: input.toolCallId,
    toolName: 'reschedule_meeting',
    summary: `Meeting moved to ${describeLocal(meeting.startUtc, meeting.timezone)}.`,
    data: {
      rescheduled: true,
      meeting_id: meeting.id,
      start_local: result.value.slot.startLocal,
      timezone: meeting.timezone,
      spoken: describeLocal(meeting.startUtc, meeting.timezone),
      status: meeting.status,
    },
    provenance: result.provenance,
    persisted: { type: 'MEETING', id: meeting.id },
  });
};

// ---------------------------------------------------------------------------
// 5. cancel_meeting
// ---------------------------------------------------------------------------

const cancelMeeting: ToolHandler = async (input) => {
  const args = argsOf<typeof CancelMeetingArgsSchema>(input);

  const result = await input.deps.meetings.cancel({
    meetingId: args.meeting_id,
    // No datetime to resolve, but its audit events belong on the turn's instant.
    nowUtc: input.ctx.nowUtc,
    correlationId: input.ctx.correlationId,
    toolCallId: input.toolCallId,
    ...(args.reason ? { reason: args.reason } : {}),
  });

  if (!result.ok) {
    return toolRejection({
      toolCallId: input.toolCallId,
      toolName: 'cancel_meeting',
      code: result.code,
      reason: result.reason,
      provenance: result.provenance,
      retryable: isRetryable(result.code),
    });
  }

  const { meeting } = result.value;
  return toolSuccess({
    toolCallId: input.toolCallId,
    toolName: 'cancel_meeting',
    summary: `The meeting on ${describeLocal(meeting.startUtc, meeting.timezone)} is cancelled.`,
    data: {
      cancelled: true,
      meeting_id: meeting.id,
      status: meeting.status,
      was_already_cancelled: result.value.reusedExisting,
    },
    provenance: result.provenance,
    persisted: { type: 'MEETING', id: meeting.id },
  });
};

// ---------------------------------------------------------------------------
// 6. schedule_followup
// ---------------------------------------------------------------------------

const scheduleFollowup: ToolHandler = async (input) => {
  const args = argsOf<typeof ScheduleFollowupArgsSchema>(input);
  const slot = requireSlot(input);

  const result = await input.deps.futureActions.schedule({
    organizationId: input.ctx.organizationId,
    contactId: input.subject.contact.id,
    conversationId: input.ctx.conversationId,
    agentConfigurationId: input.ctx.agentConfiguration.id,
    // The service refuses any type it cannot actually execute, with a
    // structured POLICY_VIOLATION rather than a silent downgrade to a call.
    ...(args.action_type ? { type: args.action_type } : {}),
    proposal: { raw: args.when, timezone: slot.timezone },
    // See `scheduleMeeting` above: one `now`, one resolution, reconciled.
    nowUtc: input.ctx.nowUtc,
    validatedSlot: slot,
    ...(args.reason ? { reason: args.reason } : {}),
    idempotencyKey: deriveIdempotencyKey('future-action', {
      conversationId: input.ctx.conversationId,
      contactId: input.subject.contact.id,
      scheduledForUtc: slot.startUtc,
    }),
    correlationId: input.ctx.correlationId,
    toolCallId: input.toolCallId,
  });

  if (!result.ok) {
    return toolRejection({
      toolCallId: input.toolCallId,
      toolName: 'schedule_followup',
      code: result.code,
      reason: result.reason,
      provenance: result.provenance,
      retryable: isRetryable(result.code),
      ...(args.action_type && args.action_type !== 'CALL_CONTACT'
        ? {
            data: {
              unsupported_in_this_slice: args.action_type,
              supported: ['CALL_CONTACT'],
            },
          }
        : {}),
    });
  }

  const { futureAction } = result.value;
  return toolSuccess({
    toolCallId: input.toolCallId,
    toolName: 'schedule_followup',
    summary:
      `Callback promised for ${describeLocal(futureAction.scheduledForUtc, futureAction.timezone)}; ` +
      'it is saved and will happen regardless of this conversation.',
    data: {
      scheduled: true,
      future_action_id: futureAction.id,
      type: futureAction.type,
      start_local: result.value.slot.startLocal,
      timezone: futureAction.timezone,
      spoken: describeLocal(futureAction.scheduledForUtc, futureAction.timezone),
      already_existed: result.value.reusedExisting,
    },
    provenance: result.provenance,
    persisted: { type: 'FUTURE_ACTION', id: futureAction.id },
  });
};

// ---------------------------------------------------------------------------
// 7. update_qualification
// ---------------------------------------------------------------------------

const updateQualification: ToolHandler = async (input) => {
  const args = argsOf<typeof UpdateQualificationArgsSchema>(input);
  const { db } = input.deps;

  // A stated change of decision-maker status updates the CRM record FIRST, so
  // the cap is then computed from what is actually persisted. The model cannot
  // route around the cap this way: raising the flag raises the ceiling only by
  // changing the durable record of who can sign, which is a real, audited,
  // reviewable CRM edit.
  const contact =
    args.is_decision_maker !== undefined && args.is_decision_maker !== input.subject.contact.isDecisionMaker
      ? await db.contacts.update(input.subject.contact.id, { isDecisionMaker: args.is_decision_maker })
      : input.subject.contact;

  const scoring = scoreQualification({
    ...(args.observations ? { observations: args.observations } : {}),
    ...(args.proposed_score !== undefined ? { modelProposedScore: args.proposed_score } : {}),
    // FROM THE PERSISTED ROW. This single line is the hard cap.
    isDecisionMaker: contact.isDecisionMaker,
    ...(args.notes ? { notes: args.notes } : {}),
  });

  const state = await db.withTransaction(async (tx) => {
    const row = await tx.qualificationStates.upsertForContact({
      contactId: contact.id,
      score: scoring.score,
      rawScore: scoring.rawScore,
      cappedScore: scoring.cappedScore,
      band: scoring.band,
      isDecisionMaker: scoring.isDecisionMaker,
      rubricVersion: scoring.rubricVersion,
      factorsJson: stringifyJson({
        factors: scoring.factors,
        modelProposedScore: scoring.modelProposedScore,
        usedModelProposedScore: scoring.usedModelProposedScore,
        capApplied: scoring.capApplied,
        capCeiling: scoring.capCeiling,
        notes: scoring.notes,
      }),
      updatedByToolCallId: input.toolCallId,
    });

    await tx.audit.record({
      type: 'ENTITY_PERSISTED',
      organizationId: input.ctx.organizationId,
      correlationId: input.ctx.correlationId,
      conversationId: input.ctx.conversationId,
      contactId: contact.id,
      toolCallId: input.toolCallId,
      subjectType: 'QUALIFICATION_STATE',
      subjectId: row.id,
      summary: explainScoring(scoring),
      detailJson: { scoring, requestedByModel: args },
      occurredAt: input.ctx.nowUtc,
    });

    return row;
  });

  return toolSuccess({
    toolCallId: input.toolCallId,
    toolName: 'update_qualification',
    summary: explainScoring(scoring),
    data: {
      recorded: true,
      score: state.score,
      raw_score: state.rawScore,
      capped_score: state.cappedScore,
      band: state.band,
      rubric_version: state.rubricVersion,
      cap_applied: scoring.capApplied,
      cap_ceiling: scoring.capCeiling,
      is_decision_maker: state.isDecisionMaker,
      // Told plainly, so the model does not repeat the call hoping for more.
      proposed_score_was_advisory: scoring.modelProposedScore !== null,
    },
    persisted: { type: 'QUALIFICATION_STATE', id: state.id },
  });
};

// ---------------------------------------------------------------------------
// 8. record_call_outcome
// ---------------------------------------------------------------------------

const recordCallOutcome: ToolHandler = async (input) => {
  const args = argsOf<typeof RecordCallOutcomeArgsSchema>(input);
  const { db } = input.deps;

  // A named call must exist and belong to this contact. Accepting an arbitrary
  // id would let one conversation write an outcome onto another's call.
  let call = args.call_id ? await db.calls.findById(args.call_id) : null;
  if (args.call_id && (!call || call.contactId !== input.subject.contact.id)) {
    return toolRejection({
      toolCallId: input.toolCallId,
      toolName: 'record_call_outcome',
      code: ValidationErrorCode.POLICY_VIOLATION,
      reason:
        `Call ${args.call_id} does not exist for this contact. Omit call_id and the outcome will be ` +
        'recorded against this conversation.',
      retryable: true,
    });
  }

  if (!call) {
    call = await db.calls.create({
      organizationId: input.ctx.organizationId,
      contactId: input.subject.contact.id,
      conversationId: input.ctx.conversationId,
      direction: 'OUTBOUND',
      // The conversation itself is the record; no telephony provider was used
      // for this turn, and saying so beats naming one that was not involved.
      providerName: 'conversation',
      status: terminalCallStatusFor(args.outcome),
      startedAt: input.ctx.nowUtc,
      endedAt: input.ctx.nowUtc,
    });
  }

  const outcome = await db.withTransaction(async (tx) => {
    const row = await tx.callOutcomes.upsertForCall({
      callId: call.id,
      outcome: args.outcome,
      notes: args.notes ?? null,
      recordedByToolCallId: input.toolCallId,
    });

    await tx.audit.record({
      type: 'ENTITY_PERSISTED',
      organizationId: input.ctx.organizationId,
      correlationId: input.ctx.correlationId,
      conversationId: input.ctx.conversationId,
      contactId: input.subject.contact.id,
      toolCallId: input.toolCallId,
      subjectType: 'CALL_OUTCOME',
      subjectId: row.id,
      summary: `Call outcome recorded as ${args.outcome}`,
      detailJson: { callId: call.id, outcome: args.outcome, notes: args.notes ?? null },
      occurredAt: input.ctx.nowUtc,
    });

    return row;
  });

  return toolSuccess({
    toolCallId: input.toolCallId,
    toolName: 'record_call_outcome',
    summary: `Recorded this call as ${args.outcome}.`,
    data: {
      recorded: true,
      call_id: call.id,
      call_outcome_id: outcome.id,
      outcome: outcome.outcome,
    },
    persisted: { type: 'CALL_OUTCOME', id: outcome.id },
  });
};

// ---------------------------------------------------------------------------
// 9. transfer_to_human
// ---------------------------------------------------------------------------

const transferToHuman: ToolHandler = async (input) => {
  const args = argsOf<typeof TransferToHumanArgsSchema>(input);
  const { db } = input.deps;

  const urgency = args.urgency ?? 'ROUTINE';

  const task = await db.withTransaction(async (tx) => {
    const row = await tx.tasks.create({
      organizationId: input.ctx.organizationId,
      contactId: input.subject.contact.id,
      conversationId: input.ctx.conversationId,
      title: `[${urgency}] Human handover: ${input.subject.contact.fullName}`,
      description: [args.reason, args.summary].filter(Boolean).join('\n\n'),
      status: 'OPEN',
      // An urgent handover is due now; a routine one still has a deadline, so
      // it cannot sit in a queue indefinitely with nobody accountable.
      dueAtUtc:
        urgency === 'URGENT'
          ? input.ctx.nowUtc
          : new Date(Date.parse(input.ctx.nowUtc) + 24 * 60 * 60 * 1000).toISOString(),
    });

    await tx.audit.record({
      type: 'HUMAN_TRANSFER_REQUESTED',
      organizationId: input.ctx.organizationId,
      correlationId: input.ctx.correlationId,
      conversationId: input.ctx.conversationId,
      contactId: input.subject.contact.id,
      toolCallId: input.toolCallId,
      subjectType: 'TASK',
      subjectId: row.id,
      summary: `Handover to a human requested (${urgency}): ${args.reason}`,
      detailJson: { urgency, reason: args.reason, summary: args.summary ?? null, taskId: row.id },
      occurredAt: input.ctx.nowUtc,
    });

    await tx.audit.record({
      type: 'ENTITY_PERSISTED',
      organizationId: input.ctx.organizationId,
      correlationId: input.ctx.correlationId,
      conversationId: input.ctx.conversationId,
      contactId: input.subject.contact.id,
      toolCallId: input.toolCallId,
      subjectType: 'TASK',
      subjectId: row.id,
      summary: `Handover task ${row.id} created`,
      detailJson: { taskId: row.id, status: row.status, dueAtUtc: row.dueAtUtc },
      occurredAt: input.ctx.nowUtc,
    });

    return row;
  });

  return toolSuccess({
    toolCallId: input.toolCallId,
    toolName: 'transfer_to_human',
    summary: `A colleague has been asked to pick this up (${urgency}).`,
    data: {
      handover_requested: true,
      task_id: task.id,
      urgency,
      // The model must not promise a name or a time it was never given.
      promised_to_contact: 'Someone from the team will pick this up. Do not name a person or a time.',
    },
    persisted: { type: 'TASK', id: task.id },
  });
};

// ---------------------------------------------------------------------------

export const TOOL_HANDLERS: Record<ToolName, ToolHandler> = {
  get_contact_context: getContactContext,
  check_availability: checkAvailability,
  schedule_meeting: scheduleMeeting,
  reschedule_meeting: rescheduleMeeting,
  cancel_meeting: cancelMeeting,
  schedule_followup: scheduleFollowup,
  update_qualification: updateQualification,
  record_call_outcome: recordCallOutcome,
  transfer_to_human: transferToHuman,
};

/**
 * Whether the model retrying could plausibly produce a different answer.
 *
 * A malformed schema or a tool that does not exist will not fix itself, and
 * telling the model to try again just burns iterations against the loop cap. A
 * time that was ambiguous, too soon, or taken CAN change - after the model asks
 * the contact a question.
 */
export function isRetryable(code: string): boolean {
  switch (code) {
    case ValidationErrorCode.SCHEMA_VIOLATION:
    case ValidationErrorCode.UNSUPPORTED_TOOL:
    case ValidationErrorCode.UNKNOWN_CONTACT:
      return false;
    default:
      return true;
  }
}

/** The `Call.status` implied by an outcome recorded after the fact. */
function terminalCallStatusFor(outcome: string): 'COMPLETED' | 'FAILED' | 'NO_ANSWER' {
  switch (outcome) {
    case 'CONNECTED':
    case 'VOICEMAIL':
    case 'DECLINED':
      return 'COMPLETED';
    case 'NO_ANSWER':
    case 'BUSY':
      return 'NO_ANSWER';
    default:
      return 'FAILED';
  }
}

export type { ToolOutcome };
