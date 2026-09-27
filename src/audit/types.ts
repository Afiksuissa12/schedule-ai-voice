/**
 * The audit event store: types.
 *
 * The audit trail is a first-class deliverable of this mission, not a log. Its
 * acceptance criterion is a sentence: the events for one `correlationId` must
 * be sufficient to explain WHY the system scheduled, or planned to contact,
 * this person at that time.
 *
 * That is why an event carries the raw LLM proposal, the validation provenance,
 * the provider that was consulted and the row that was ultimately written -
 * and why `sequence` makes the chain replayable in exactly the order it
 * happened.
 */
import type { IsoUtcString } from '../ports/clock.js';
import type { StructuredPayload } from '../shared/json.js';

/**
 * Every kind of event the system records.
 *
 * Read down the list and you can see the shape of one agent turn:
 * an utterance arrives, the turn starts, the model decides, it requests a tool
 * call, application code validates it (or rejects it), executes it, invokes a
 * provider, persists a row, and possibly schedules a future action.
 */
export const AUDIT_EVENT_TYPES = [
  /** Something the contact said arrived and was persisted as a turn. */
  'UTTERANCE_RECEIVED',
  /** One agent turn began. Opens a correlation chain. */
  'AGENT_TURN_STARTED',
  /** The model produced text and/or proposed tool calls. */
  'AGENT_DECISION',
  /** The model PROPOSED a tool call. Nothing has been validated or executed yet. */
  'TOOL_CALL_REQUESTED',
  /** Application code validated the tool call. Carries the ValidationProvenance. */
  'TOOL_CALL_VALIDATED',
  /** Application code REFUSED the tool call. Carries the code and the provenance. */
  'TOOL_CALL_REJECTED',
  /** The validated tool call ran and produced a result. */
  'TOOL_CALL_EXECUTED',
  /** An external provider (availability, calendar, telephony, llm) was called. */
  'PROVIDER_INVOKED',
  /** A domain row was written. Carries subjectType/subjectId. */
  'ENTITY_PERSISTED',
  /** A durable FutureAction was created. */
  'FUTURE_ACTION_SCHEDULED',
  /** A background runner took the lease on a due FutureAction. */
  'FUTURE_ACTION_CLAIMED',
  /** A claimed FutureAction completed successfully. */
  'FUTURE_ACTION_EXECUTED',
  /** A claimed FutureAction failed; carries the error and the attempt count. */
  'FUTURE_ACTION_FAILED',
  /** A deterministic validation rejected a value, outside of a tool call. */
  'VALIDATION_REJECTED',
  /** The agent handed off to a human. */
  'HUMAN_TRANSFER_REQUESTED',

  // -------------------------------------------------------------------------
  // MISSION 2D - the effect and claim consistency gate.
  //
  // The chokepoint governs ACTIONS. These four govern SENTENCES, and they exist
  // so an auditor can explain any blocked or corrected turn from the chain
  // alone: what the text asserted, what the records actually said, what was
  // asked of the model, and what reached the contact.
  //
  // `AuditEvent.type` is a String column, so adding them needs no schema
  // migration - but they ARE validated by `AuditEventTypeSchema` on write and
  // re-checked by `src/db/mappers.ts` on read, so this list is the contract.
  // -------------------------------------------------------------------------

  /** Customer-facing text was checked against the ledger and released unchanged. */
  'CLAIM_GATE_CLAIM_VERIFIED',
  /** Text asserted something the ledger does not support. It was NOT released. */
  'CLAIM_GATE_CLAIM_REJECTED',
  /** The model was handed the authoritative state and asked for the turn again. */
  'CLAIM_GATE_REGENERATION_REQUESTED',
  /** Every bounded attempt failed. Nothing was released; a person was asked for. */
  'CLAIM_GATE_TEXT_WITHHELD',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const AuditEventType = {
  UTTERANCE_RECEIVED: 'UTTERANCE_RECEIVED',
  AGENT_TURN_STARTED: 'AGENT_TURN_STARTED',
  AGENT_DECISION: 'AGENT_DECISION',
  TOOL_CALL_REQUESTED: 'TOOL_CALL_REQUESTED',
  TOOL_CALL_VALIDATED: 'TOOL_CALL_VALIDATED',
  TOOL_CALL_REJECTED: 'TOOL_CALL_REJECTED',
  TOOL_CALL_EXECUTED: 'TOOL_CALL_EXECUTED',
  PROVIDER_INVOKED: 'PROVIDER_INVOKED',
  ENTITY_PERSISTED: 'ENTITY_PERSISTED',
  FUTURE_ACTION_SCHEDULED: 'FUTURE_ACTION_SCHEDULED',
  FUTURE_ACTION_CLAIMED: 'FUTURE_ACTION_CLAIMED',
  FUTURE_ACTION_EXECUTED: 'FUTURE_ACTION_EXECUTED',
  FUTURE_ACTION_FAILED: 'FUTURE_ACTION_FAILED',
  VALIDATION_REJECTED: 'VALIDATION_REJECTED',
  HUMAN_TRANSFER_REQUESTED: 'HUMAN_TRANSFER_REQUESTED',
  CLAIM_GATE_CLAIM_VERIFIED: 'CLAIM_GATE_CLAIM_VERIFIED',
  CLAIM_GATE_CLAIM_REJECTED: 'CLAIM_GATE_CLAIM_REJECTED',
  CLAIM_GATE_REGENERATION_REQUESTED: 'CLAIM_GATE_REGENERATION_REQUESTED',
  CLAIM_GATE_TEXT_WITHHELD: 'CLAIM_GATE_TEXT_WITHHELD',
} as const satisfies Record<AuditEventType, AuditEventType>;

/** The kind of domain row an event is about. */
export const AUDIT_SUBJECT_TYPES = [
  'ORGANIZATION',
  'USER',
  'AI_AGENT',
  'AGENT_CONFIGURATION',
  'CONTACT',
  'LEAD',
  'QUALIFICATION_STATE',
  'CONVERSATION',
  'CONVERSATION_TURN',
  'CALL',
  'CALL_OUTCOME',
  'MEETING',
  'CALENDAR_CONNECTION',
  'FUTURE_ACTION',
  'TASK',
] as const;

export type AuditSubjectType = (typeof AUDIT_SUBJECT_TYPES)[number];

export const AuditSubjectType = {
  ORGANIZATION: 'ORGANIZATION',
  USER: 'USER',
  AI_AGENT: 'AI_AGENT',
  AGENT_CONFIGURATION: 'AGENT_CONFIGURATION',
  CONTACT: 'CONTACT',
  LEAD: 'LEAD',
  QUALIFICATION_STATE: 'QUALIFICATION_STATE',
  CONVERSATION: 'CONVERSATION',
  CONVERSATION_TURN: 'CONVERSATION_TURN',
  CALL: 'CALL',
  CALL_OUTCOME: 'CALL_OUTCOME',
  MEETING: 'MEETING',
  CALENDAR_CONNECTION: 'CALENDAR_CONNECTION',
  FUTURE_ACTION: 'FUTURE_ACTION',
  TASK: 'TASK',
} as const satisfies Record<AuditSubjectType, AuditSubjectType>;

/** What a caller hands to `AuditRecorder.record`. */
export interface AuditEventInput {
  readonly type: AuditEventType;
  readonly organizationId: string;
  /**
   * Ties every event of ONE agent turn together. Mint it once at the top of the
   * turn (`newCorrelationId()`) and thread it through everything the turn does,
   * including any provider call and any FutureAction it schedules.
   */
  readonly correlationId: string;
  readonly conversationId?: string | null;
  readonly contactId?: string | null;
  /** The tool call this event belongs to, when it belongs to one. */
  readonly toolCallId?: string | null;
  /** The kind of domain row this event is about. */
  readonly subjectType?: AuditSubjectType | null;
  /** The primary key of the domain row this event is about. */
  readonly subjectId?: string | null;
  /** One short human-readable line. Safe to render in a timeline. */
  readonly summary: string;
  /**
   * The structured payload: the machine-readable detail. Put the evidence here
   * - raw tool arguments, `ValidationProvenance`, busy intervals consulted,
   * provider responses.
   *
   * Accepts an object (serialized for you) or a pre-serialized JSON string when
   * you must store a provider's response byte-for-byte.
   */
  readonly detailJson: StructuredPayload | string;
  /**
   * When the event happened. Defaults to the recorder's injected `Clock`.
   * Pass it explicitly when recording something that happened earlier.
   */
  readonly occurredAt?: IsoUtcString;
}

/** A persisted audit event. */
export interface AuditEvent {
  readonly id: string;
  readonly organizationId: string;
  readonly correlationId: string;
  /** 1-based, monotonically increasing within `correlationId`. */
  readonly sequence: number;
  readonly type: AuditEventType;
  readonly conversationId: string | null;
  readonly contactId: string | null;
  readonly toolCallId: string | null;
  readonly subjectType: AuditSubjectType | null;
  readonly subjectId: string | null;
  readonly summary: string;
  /** Serialized structured payload. Parse with `parseJson`. */
  readonly detailJson: string;
  readonly occurredAt: IsoUtcString;
  readonly createdAt: IsoUtcString;
}

export interface AuditRecorder {
  /**
   * Append one event to the trail.
   *
   * MUST NOT fail silently. On any persistence problem this throws
   * `AuditWriteError`; callers must let it propagate rather than swallowing it.
   * An action we cannot explain is an action we should not claim to have taken.
   */
  record(event: AuditEventInput): Promise<AuditEvent>;

  /** Every event of one agent turn, in `sequence` order. The replay view. */
  listByCorrelationId(correlationId: string): Promise<AuditEvent[]>;

  /** Every event about one domain row, oldest first. The "why is this row here?" view. */
  listBySubject(subjectType: AuditSubjectType, subjectId: string): Promise<AuditEvent[]>;
}
