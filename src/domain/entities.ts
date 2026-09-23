/**
 * Domain entities: the shapes the rest of the application works with.
 *
 * These mirror the Prisma models but are deliberately NOT the generated Prisma
 * types. Two rules make them different, and both are contractual:
 *
 *  1. INSTANTS ARE ISO-8601 UTC STRINGS, not `Date`. The same representation
 *     crosses every port boundary (`src/ports`), so there is exactly one way an
 *     instant is spelled in this codebase and no layer has to guess whether a
 *     `Date` is "already UTC".
 *  2. ENUM COLUMNS ARE UNION TYPES, not `string`. See `./enums.ts`.
 *
 * Repositories in `src/db` are the only place that converts between a Prisma
 * row and one of these.
 */
import type { IsoUtcString } from '../shared/time.js';
import type {
  AiAgentStatus,
  CalendarConnectionStatus,
  CalendarProviderKind,
  CallDirection,
  CallOutcomeKind,
  CallStatus,
  ConversationChannel,
  ConversationStatus,
  ConversationTurnRole,
  FutureActionStatus,
  FutureActionType,
  LeadStatus,
  MeetingStatus,
  QualificationBand,
  TaskStatus,
  UserRole,
} from './enums.js';

/** Fields every persisted row carries. */
export interface Timestamped {
  readonly createdAt: IsoUtcString;
  readonly updatedAt: IsoUtcString;
}

export interface Organization extends Timestamped {
  readonly id: string;
  readonly name: string;
  /** IANA zone. */
  readonly defaultTimezone: string;
}

export interface User extends Timestamped {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: UserRole;
  readonly isActive: boolean;
}

export interface AiAgent extends Timestamped {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: AiAgentStatus;
}

export interface AgentConfiguration extends Timestamped {
  readonly id: string;
  readonly aiAgentId: string;
  readonly version: number;
  readonly systemPromptRef: string;
  /** Serialized `BusinessHoursPolicy`. Parse with `BusinessHoursPolicySchema`. */
  readonly businessHoursJson: string;
  readonly defaultTimezone: string;
  readonly minLeadTimeMinutes: number;
  readonly maxSchedulingHorizonDays: number;
  /** Serialized `string[]` of permitted tool names. */
  readonly allowedToolsJson: string;
  readonly isActive: boolean;
}

export interface Contact extends Timestamped {
  readonly id: string;
  readonly organizationId: string;
  readonly fullName: string;
  readonly primaryPhoneE164: string;
  readonly email: string | null;
  /** IANA zone. Required: proposed times are interpreted here. */
  readonly timezone: string;
  readonly isDecisionMaker: boolean;
  readonly notes: string | null;
}

export interface Lead extends Timestamped {
  readonly id: string;
  readonly organizationId: string;
  readonly contactId: string;
  readonly source: string;
  readonly status: LeadStatus;
  readonly ownerUserId: string | null;
  readonly notes: string | null;
}

export interface QualificationState extends Timestamped {
  readonly id: string;
  readonly contactId: string;
  /** Effective score used downstream. */
  readonly score: number;
  /** Rubric output BEFORE the non-decision-maker cap. */
  readonly rawScore: number;
  /** Rubric output AFTER the non-decision-maker cap. */
  readonly cappedScore: number;
  readonly band: QualificationBand;
  readonly isDecisionMaker: boolean;
  readonly rubricVersion: string;
  /** Serialized array of scoring factors. */
  readonly factorsJson: string;
  readonly updatedByToolCallId: string | null;
}

export interface Conversation extends Timestamped {
  readonly id: string;
  readonly organizationId: string;
  readonly contactId: string;
  readonly aiAgentId: string;
  readonly agentConfigurationId: string | null;
  readonly channel: ConversationChannel;
  readonly status: ConversationStatus;
  readonly startedAt: IsoUtcString;
  readonly endedAt: IsoUtcString | null;
  readonly summary: string | null;
}

export interface ConversationTurn {
  readonly id: string;
  readonly conversationId: string;
  /** 0-based, unique within the conversation. */
  readonly index: number;
  readonly role: ConversationTurnRole;
  /** NULL for pure tool turns. */
  readonly text: string | null;
  readonly toolName: string | null;
  readonly toolCallId: string | null;
  /** Serialized raw payload, stored verbatim. */
  readonly rawPayloadJson: string | null;
  readonly createdAt: IsoUtcString;
}

export interface Call extends Timestamped {
  readonly id: string;
  readonly organizationId: string;
  readonly contactId: string;
  readonly conversationId: string | null;
  readonly direction: CallDirection;
  readonly providerName: string;
  readonly providerCallId: string | null;
  readonly status: CallStatus;
  readonly startedAt: IsoUtcString | null;
  readonly endedAt: IsoUtcString | null;
  readonly durationSeconds: number | null;
}

export interface CallOutcome extends Timestamped {
  readonly id: string;
  readonly callId: string;
  readonly outcome: CallOutcomeKind;
  readonly notes: string | null;
  readonly recordedByToolCallId: string | null;
}

export interface CalendarConnection extends Timestamped {
  readonly id: string;
  readonly organizationId: string;
  readonly provider: CalendarProviderKind;
  /** Opaque, NON-SECRET account reference. Never a token. */
  readonly externalAccountRef: string | null;
  readonly status: CalendarConnectionStatus;
  readonly calendarRef: string;
}

export interface Meeting extends Timestamped {
  readonly id: string;
  readonly organizationId: string;
  readonly contactId: string;
  readonly conversationId: string | null;
  readonly calendarConnectionId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly startUtc: IsoUtcString;
  readonly endUtc: IsoUtcString;
  /** IANA zone the meeting was agreed in. */
  readonly timezone: string;
  readonly status: MeetingStatus;
  readonly externalCalendarEventId: string | null;
  readonly idempotencyKey: string | null;
  /**
   * Serialized `ValidationProvenance`. NEVER null, never empty: a Meeting may
   * not exist unless application code validated the datetime that produced it.
   */
  readonly validationProvenanceJson: string;
}

export interface FutureAction extends Timestamped {
  readonly id: string;
  readonly organizationId: string;
  readonly contactId: string;
  readonly conversationId: string | null;
  readonly type: FutureActionType;
  readonly scheduledForUtc: IsoUtcString;
  readonly timezone: string;
  readonly status: FutureActionStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly leaseExpiresAt: IsoUtcString | null;
  readonly leaseOwner: string | null;
  readonly lastError: string | null;
  /** Serialized, application-validated action payload. */
  readonly payloadJson: string;
  readonly idempotencyKey: string | null;
  /** Serialized `ValidationProvenance`. NEVER null. */
  readonly validationProvenanceJson: string;
  readonly completedAt: IsoUtcString | null;
}

export interface Task extends Timestamped {
  readonly id: string;
  readonly organizationId: string;
  readonly contactId: string | null;
  readonly conversationId: string | null;
  readonly futureActionId: string | null;
  readonly assignedToUserId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly dueAtUtc: IsoUtcString | null;
}

/** A conversation together with its ordered turns. */
export interface ConversationWithTurns extends Conversation {
  readonly turns: readonly ConversationTurn[];
}
