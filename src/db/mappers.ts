/**
 * Prisma row -> domain entity.
 *
 * The only place in the codebase that crosses this boundary, and it does two
 * jobs on the way:
 *
 *  1. `Date` -> ISO-8601 UTC string, so instants have exactly one spelling.
 *  2. `string` -> enum union, RE-CHECKED at runtime. The SQLite columns are
 *     plain strings, so a value written by a migration, a fixture or a future
 *     bug could be outside the union. Checking on read turns that into a loud
 *     `InvariantViolationError` instead of a union type that quietly lies.
 */
import type {
  AgentConfiguration as AgentConfigurationRow,
  AiAgent as AiAgentRow,
  AuditEvent as AuditEventRow,
  CalendarConnection as CalendarConnectionRow,
  Call as CallRow,
  CallOutcome as CallOutcomeRow,
  Contact as ContactRow,
  Conversation as ConversationRow,
  ConversationTurn as ConversationTurnRow,
  FutureAction as FutureActionRow,
  Lead as LeadRow,
  Meeting as MeetingRow,
  Organization as OrganizationRow,
  QualificationState as QualificationStateRow,
  Task as TaskRow,
  User as UserRow,
} from '@prisma/client';
import type { ZodType } from 'zod';

import type { AuditEvent, AuditSubjectType } from '../audit/types.js';
import { AuditEventTypeSchema, AuditSubjectTypeSchema } from '../audit/schemas.js';
import type {
  AgentConfiguration,
  AiAgent,
  CalendarConnection,
  Call,
  CallOutcome,
  Contact,
  Conversation,
  ConversationTurn,
  FutureAction,
  Lead,
  Meeting,
  Organization,
  QualificationState,
  Task,
  User,
} from '../domain/entities.js';
import {
  AiAgentStatusSchema,
  CalendarConnectionStatusSchema,
  CalendarProviderKindSchema,
  CallDirectionSchema,
  CallOutcomeKindSchema,
  CallStatusSchema,
  ConversationChannelSchema,
  ConversationStatusSchema,
  ConversationTurnRoleSchema,
  FutureActionStatusSchema,
  FutureActionTypeSchema,
  LeadStatusSchema,
  MeetingStatusSchema,
  QualificationBandSchema,
  TaskStatusSchema,
  UserRoleSchema,
} from '../domain/enums.js';
import { InvariantViolationError } from '../shared/errors.js';
import { toIsoUtc, toIsoUtcOrNull } from '../shared/time.js';

/** Re-check a stored enum string against its Zod schema. Throws if it drifted. */
function asEnum<T>(schema: ZodType<T>, value: string, field: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new InvariantViolationError(`Stored value for ${field} is not a permitted enum member: ${value}`, {
      details: { field, value },
    });
  }
  return result.data;
}

function asEnumOrNull<T>(schema: ZodType<T>, value: string | null, field: string): T | null {
  return value === null ? null : asEnum(schema, value, field);
}

/** A string column that must not be empty, e.g. `validationProvenanceJson`. */
function requireNonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new InvariantViolationError(`${field} must not be empty`, { details: { field } });
  }
  return value;
}

export function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    defaultTimezone: row.defaultTimezone,
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    fullName: row.fullName,
    role: asEnum(UserRoleSchema, row.role, 'User.role'),
    isActive: row.isActive,
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

export function toAiAgent(row: AiAgentRow): AiAgent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    status: asEnum(AiAgentStatusSchema, row.status, 'AiAgent.status'),
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

export function toAgentConfiguration(row: AgentConfigurationRow): AgentConfiguration {
  return {
    id: row.id,
    aiAgentId: row.aiAgentId,
    version: row.version,
    systemPromptRef: row.systemPromptRef,
    businessHoursJson: requireNonEmpty(row.businessHoursJson, 'AgentConfiguration.businessHoursJson'),
    defaultTimezone: row.defaultTimezone,
    minLeadTimeMinutes: row.minLeadTimeMinutes,
    maxSchedulingHorizonDays: row.maxSchedulingHorizonDays,
    allowedToolsJson: requireNonEmpty(row.allowedToolsJson, 'AgentConfiguration.allowedToolsJson'),
    isActive: row.isActive,
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

export function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    organizationId: row.organizationId,
    fullName: row.fullName,
    primaryPhoneE164: row.primaryPhoneE164,
    email: row.email,
    timezone: row.timezone,
    isDecisionMaker: row.isDecisionMaker,
    notes: row.notes,
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

export function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactId: row.contactId,
    source: row.source,
    status: asEnum(LeadStatusSchema, row.status, 'Lead.status'),
    ownerUserId: row.ownerUserId,
    notes: row.notes,
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

export function toQualificationState(row: QualificationStateRow): QualificationState {
  return {
    id: row.id,
    contactId: row.contactId,
    score: row.score,
    rawScore: row.rawScore,
    cappedScore: row.cappedScore,
    band: asEnum(QualificationBandSchema, row.band, 'QualificationState.band'),
    isDecisionMaker: row.isDecisionMaker,
    rubricVersion: row.rubricVersion,
    factorsJson: requireNonEmpty(row.factorsJson, 'QualificationState.factorsJson'),
    updatedByToolCallId: row.updatedByToolCallId,
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

export function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactId: row.contactId,
    aiAgentId: row.aiAgentId,
    agentConfigurationId: row.agentConfigurationId,
    channel: asEnum(ConversationChannelSchema, row.channel, 'Conversation.channel'),
    status: asEnum(ConversationStatusSchema, row.status, 'Conversation.status'),
    startedAt: toIsoUtc(row.startedAt),
    endedAt: toIsoUtcOrNull(row.endedAt),
    summary: row.summary,
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

export function toConversationTurn(row: ConversationTurnRow): ConversationTurn {
  return {
    id: row.id,
    conversationId: row.conversationId,
    index: row.index,
    role: asEnum(ConversationTurnRoleSchema, row.role, 'ConversationTurn.role'),
    text: row.text,
    toolName: row.toolName,
    toolCallId: row.toolCallId,
    rawPayloadJson: row.rawPayloadJson,
    createdAt: toIsoUtc(row.createdAt),
  };
}

export function toCall(row: CallRow): Call {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactId: row.contactId,
    conversationId: row.conversationId,
    direction: asEnum(CallDirectionSchema, row.direction, 'Call.direction'),
    providerName: row.providerName,
    providerCallId: row.providerCallId,
    status: asEnum(CallStatusSchema, row.status, 'Call.status'),
    startedAt: toIsoUtcOrNull(row.startedAt),
    endedAt: toIsoUtcOrNull(row.endedAt),
    durationSeconds: row.durationSeconds,
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

export function toCallOutcome(row: CallOutcomeRow): CallOutcome {
  return {
    id: row.id,
    callId: row.callId,
    outcome: asEnum(CallOutcomeKindSchema, row.outcome, 'CallOutcome.outcome'),
    notes: row.notes,
    recordedByToolCallId: row.recordedByToolCallId,
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

export function toCalendarConnection(row: CalendarConnectionRow): CalendarConnection {
  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: asEnum(CalendarProviderKindSchema, row.provider, 'CalendarConnection.provider'),
    externalAccountRef: row.externalAccountRef,
    status: asEnum(CalendarConnectionStatusSchema, row.status, 'CalendarConnection.status'),
    calendarRef: row.calendarRef,
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

export function toMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactId: row.contactId,
    conversationId: row.conversationId,
    calendarConnectionId: row.calendarConnectionId,
    title: row.title,
    description: row.description,
    startUtc: toIsoUtc(row.startUtc),
    endUtc: toIsoUtc(row.endUtc),
    timezone: row.timezone,
    status: asEnum(MeetingStatusSchema, row.status, 'Meeting.status'),
    externalCalendarEventId: row.externalCalendarEventId,
    idempotencyKey: row.idempotencyKey,
    validationProvenanceJson: requireNonEmpty(row.validationProvenanceJson, 'Meeting.validationProvenanceJson'),
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

export function toFutureAction(row: FutureActionRow): FutureAction {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactId: row.contactId,
    conversationId: row.conversationId,
    type: asEnum(FutureActionTypeSchema, row.type, 'FutureAction.type'),
    scheduledForUtc: toIsoUtc(row.scheduledForUtc),
    timezone: row.timezone,
    status: asEnum(FutureActionStatusSchema, row.status, 'FutureAction.status'),
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    leaseExpiresAt: toIsoUtcOrNull(row.leaseExpiresAt),
    leaseOwner: row.leaseOwner,
    lastError: row.lastError,
    payloadJson: requireNonEmpty(row.payloadJson, 'FutureAction.payloadJson'),
    idempotencyKey: row.idempotencyKey,
    validationProvenanceJson: requireNonEmpty(
      row.validationProvenanceJson,
      'FutureAction.validationProvenanceJson',
    ),
    completedAt: toIsoUtcOrNull(row.completedAt),
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactId: row.contactId,
    conversationId: row.conversationId,
    futureActionId: row.futureActionId,
    assignedToUserId: row.assignedToUserId,
    title: row.title,
    description: row.description,
    status: asEnum(TaskStatusSchema, row.status, 'Task.status'),
    dueAtUtc: toIsoUtcOrNull(row.dueAtUtc),
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

export function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    correlationId: row.correlationId,
    sequence: row.sequence,
    type: asEnum(AuditEventTypeSchema, row.type, 'AuditEvent.type'),
    conversationId: row.conversationId,
    contactId: row.contactId,
    toolCallId: row.toolCallId,
    subjectType: asEnumOrNull(AuditSubjectTypeSchema, row.subjectType, 'AuditEvent.subjectType') as
      | AuditSubjectType
      | null,
    subjectId: row.subjectId,
    summary: row.summary,
    detailJson: row.detailJson,
    occurredAt: toIsoUtc(row.occurredAt),
    createdAt: toIsoUtc(row.createdAt),
  };
}
