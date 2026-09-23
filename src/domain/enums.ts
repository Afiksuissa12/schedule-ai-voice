/**
 * The single source of truth for every "enum" in the schema.
 *
 * The Prisma SQLite connector cannot express `enum`, so those columns are
 * `String`. That would be a loophole - any string could be written - except
 * that every repository write path in `src/db` accepts only the union types
 * declared here, and every value read back out can be re-checked with the
 * matching Zod schema. The enum is enforced in application code, which is
 * exactly where this architecture says state rules belong.
 *
 * Each enum is exported three ways:
 *   - `const Foo`       - the value object, for `Foo.BAR`
 *   - `type Foo`        - the union type, for signatures
 *   - `const FooSchema` - the Zod schema, for runtime validation at a boundary
 */
import { z } from 'zod';

import { isValidIanaTimezone } from '../shared/time.js';

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export const USER_ROLES = ['OWNER', 'ADMIN', 'AGENT_OPERATOR', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const UserRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  AGENT_OPERATOR: 'AGENT_OPERATOR',
  VIEWER: 'VIEWER',
} as const satisfies Record<UserRole, UserRole>;
export const UserRoleSchema = z.enum(USER_ROLES);

// ---------------------------------------------------------------------------
// AI agent
// ---------------------------------------------------------------------------

export const AI_AGENT_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type AiAgentStatus = (typeof AI_AGENT_STATUSES)[number];
export const AiAgentStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const satisfies Record<AiAgentStatus, AiAgentStatus>;
export const AiAgentStatusSchema = z.enum(AI_AGENT_STATUSES);

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFYING',
  'QUALIFIED',
  'DISQUALIFIED',
  'CONVERTED',
  'LOST',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LeadStatus = {
  NEW: 'NEW',
  CONTACTED: 'CONTACTED',
  QUALIFYING: 'QUALIFYING',
  QUALIFIED: 'QUALIFIED',
  DISQUALIFIED: 'DISQUALIFIED',
  CONVERTED: 'CONVERTED',
  LOST: 'LOST',
} as const satisfies Record<LeadStatus, LeadStatus>;
export const LeadStatusSchema = z.enum(LEAD_STATUSES);

export const QUALIFICATION_BANDS = ['UNQUALIFIED', 'LOW', 'MEDIUM', 'HIGH'] as const;
export type QualificationBand = (typeof QUALIFICATION_BANDS)[number];
export const QualificationBand = {
  UNQUALIFIED: 'UNQUALIFIED',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
} as const satisfies Record<QualificationBand, QualificationBand>;
export const QualificationBandSchema = z.enum(QUALIFICATION_BANDS);

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export const CONVERSATION_CHANNELS = ['VOICE', 'SMS', 'WEB', 'TEST'] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];
export const ConversationChannel = {
  VOICE: 'VOICE',
  SMS: 'SMS',
  WEB: 'WEB',
  TEST: 'TEST',
} as const satisfies Record<ConversationChannel, ConversationChannel>;
export const ConversationChannelSchema = z.enum(CONVERSATION_CHANNELS);

export const CONVERSATION_STATUSES = ['ACTIVE', 'COMPLETED', 'ABANDONED'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export const ConversationStatus = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  ABANDONED: 'ABANDONED',
} as const satisfies Record<ConversationStatus, ConversationStatus>;
export const ConversationStatusSchema = z.enum(CONVERSATION_STATUSES);

export const CONVERSATION_TURN_ROLES = ['CONTACT', 'AGENT', 'SYSTEM', 'TOOL'] as const;
export type ConversationTurnRole = (typeof CONVERSATION_TURN_ROLES)[number];
export const ConversationTurnRole = {
  CONTACT: 'CONTACT',
  AGENT: 'AGENT',
  SYSTEM: 'SYSTEM',
  TOOL: 'TOOL',
} as const satisfies Record<ConversationTurnRole, ConversationTurnRole>;
export const ConversationTurnRoleSchema = z.enum(CONVERSATION_TURN_ROLES);

// ---------------------------------------------------------------------------
// Telephony
// ---------------------------------------------------------------------------

export const CALL_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];
export const CallDirection = {
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND',
} as const satisfies Record<CallDirection, CallDirection>;
export const CallDirectionSchema = z.enum(CALL_DIRECTIONS);

export const CALL_STATUSES = ['QUEUED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'NO_ANSWER'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];
export const CallStatus = {
  QUEUED: 'QUEUED',
  RINGING: 'RINGING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  NO_ANSWER: 'NO_ANSWER',
} as const satisfies Record<CallStatus, CallStatus>;
export const CallStatusSchema = z.enum(CALL_STATUSES);

export const CALL_OUTCOME_KINDS = [
  'CONNECTED',
  'VOICEMAIL',
  'NO_ANSWER',
  'BUSY',
  'DECLINED',
  'WRONG_NUMBER',
  'FAILED',
] as const;
export type CallOutcomeKind = (typeof CALL_OUTCOME_KINDS)[number];
export const CallOutcomeKind = {
  CONNECTED: 'CONNECTED',
  VOICEMAIL: 'VOICEMAIL',
  NO_ANSWER: 'NO_ANSWER',
  BUSY: 'BUSY',
  DECLINED: 'DECLINED',
  WRONG_NUMBER: 'WRONG_NUMBER',
  FAILED: 'FAILED',
} as const satisfies Record<CallOutcomeKind, CallOutcomeKind>;
export const CallOutcomeKindSchema = z.enum(CALL_OUTCOME_KINDS);

// ---------------------------------------------------------------------------
// Calendar + meetings
// ---------------------------------------------------------------------------

export const CALENDAR_PROVIDER_KINDS = ['GOOGLE', 'MICROSOFT_GRAPH', 'DETERMINISTIC_TEST'] as const;
export type CalendarProviderKind = (typeof CALENDAR_PROVIDER_KINDS)[number];
export const CalendarProviderKind = {
  GOOGLE: 'GOOGLE',
  MICROSOFT_GRAPH: 'MICROSOFT_GRAPH',
  DETERMINISTIC_TEST: 'DETERMINISTIC_TEST',
} as const satisfies Record<CalendarProviderKind, CalendarProviderKind>;
export const CalendarProviderKindSchema = z.enum(CALENDAR_PROVIDER_KINDS);

export const CALENDAR_CONNECTION_STATUSES = ['ACTIVE', 'REVOKED', 'TEST_DOUBLE'] as const;
export type CalendarConnectionStatus = (typeof CALENDAR_CONNECTION_STATUSES)[number];
export const CalendarConnectionStatus = {
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
  TEST_DOUBLE: 'TEST_DOUBLE',
} as const satisfies Record<CalendarConnectionStatus, CalendarConnectionStatus>;
export const CalendarConnectionStatusSchema = z.enum(CALENDAR_CONNECTION_STATUSES);

export const MEETING_STATUSES = ['SCHEDULED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export const MeetingStatus = {
  SCHEDULED: 'SCHEDULED',
  RESCHEDULED: 'RESCHEDULED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const satisfies Record<MeetingStatus, MeetingStatus>;
export const MeetingStatusSchema = z.enum(MEETING_STATUSES);

// ---------------------------------------------------------------------------
// Autonomous follow-up
// ---------------------------------------------------------------------------

export const FUTURE_ACTION_TYPES = ['CALL_CONTACT', 'SEND_FOLLOWUP_MESSAGE', 'INTERNAL_TASK'] as const;
export type FutureActionType = (typeof FUTURE_ACTION_TYPES)[number];
export const FutureActionType = {
  CALL_CONTACT: 'CALL_CONTACT',
  SEND_FOLLOWUP_MESSAGE: 'SEND_FOLLOWUP_MESSAGE',
  INTERNAL_TASK: 'INTERNAL_TASK',
} as const satisfies Record<FutureActionType, FutureActionType>;
export const FutureActionTypeSchema = z.enum(FUTURE_ACTION_TYPES);

export const FUTURE_ACTION_STATUSES = [
  'PENDING',
  'CLAIMED',
  'IN_PROGRESS',
  'DONE',
  'FAILED',
  'CANCELLED',
] as const;
export type FutureActionStatus = (typeof FUTURE_ACTION_STATUSES)[number];
export const FutureActionStatus = {
  PENDING: 'PENDING',
  CLAIMED: 'CLAIMED',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const satisfies Record<FutureActionStatus, FutureActionStatus>;
export const FutureActionStatusSchema = z.enum(FUTURE_ACTION_STATUSES);

/** Statuses from which a background runner may still pick a FutureAction up. */
export const CLAIMABLE_FUTURE_ACTION_STATUSES: readonly FutureActionStatus[] = ['PENDING', 'CLAIMED'];

/** Statuses a FutureAction can never leave. */
export const TERMINAL_FUTURE_ACTION_STATUSES: readonly FutureActionStatus[] = ['DONE', 'CANCELLED'];

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TaskStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
} as const satisfies Record<TaskStatus, TaskStatus>;
export const TaskStatusSchema = z.enum(TASK_STATUSES);

// ---------------------------------------------------------------------------
// Shared value-object schemas
// ---------------------------------------------------------------------------

/**
 * E.164: a leading `+`, a non-zero country digit, then up to 14 more digits.
 * Deliberately strict - a phone number is about to be dialled.
 */
export const E164Schema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, 'Phone number must be in E.164 format, e.g. +12125550123');

/**
 * An IANA timezone name that this runtime can actually resolve.
 *
 * Rejects UTC offsets like `+02:00`: an offset cannot express DST, and a
 * meeting agreed for "2pm next month" must survive a DST transition.
 */
export const IanaTimezoneSchema = z
  .string()
  .refine(isValidIanaTimezone, { message: 'Must be a valid IANA timezone name, e.g. America/New_York' });

/** An ISO-8601 instant with an explicit UTC offset. */
export const IsoUtcStringSchema = z
  .string()
  .refine((value) => /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim()) && !Number.isNaN(Date.parse(value)), {
    message: 'Must be an ISO-8601 instant with an explicit UTC offset, e.g. 2026-03-04T14:30:00.000Z',
  });

/** A non-empty trimmed string. */
export const NonEmptyStringSchema = z.string().trim().min(1);
