/**
 * The context a tool handler is allowed to see, and the services it is allowed
 * to use.
 *
 * NOTE WHAT IS NOT HERE: no `PrismaClient`, and no repository that writes a
 * Meeting, a FutureAction or a Call. Handlers reach persistence through
 * `MeetingSchedulingService` and `FutureActionService`, which validate before
 * they write. The repositories that ARE exposed on `db` are used for READS and
 * for the two CRM writes that have no datetime in them
 * (`QualificationState`, `CallOutcome`, `Task`) - and those go through the
 * repositories' own invariant checks.
 *
 * The rule stated once: a tool handler may not write a row whose correctness
 * depends on a datetime the model supplied. Anything time-bearing goes through
 * a service that has already been handed a `ResolvedSlot` from
 * `SchedulingValidator`.
 */
import type { Database } from '../../db/database.js';
import type { AgentConfiguration, Contact, Meeting, QualificationState } from '../../domain/entities.js';
import type { FutureActionService } from '../../followup/futureActionService.js';
import type { AvailabilityProvider } from '../../ports/availability.js';
import type { CalendarProvider } from '../../ports/calendar.js';
import type { Clock, IsoUtcString } from '../../ports/clock.js';
import type { ValidationProvenance } from '../../ports/validation.js';
import type { ResolvedSlot } from '../../scheduling/dateTimeResolver.js';
import type { MeetingSchedulingService } from '../../scheduling/meetingSchedulingService.js';
import type { SchedulingPolicy } from '../../scheduling/policy.js';
import type { SchedulingValidator } from '../../scheduling/schedulingValidator.js';
import type { ToolDefinition } from './definitions.js';
import type { ToolOutcome } from './results.js';

/** Everything about the turn that a tool call happens inside. */
export interface ToolDispatchContext {
  /** Minted once per agent turn. Threaded into every service call and event. */
  readonly correlationId: string;
  readonly organizationId: string;
  readonly conversationId: string;
  /**
   * The contact this conversation is with, loaded from the database.
   *
   * THE MODEL DOES NOT GET TO CHOOSE THIS. A `contact_id` argument is checked
   * against this row, which is how a fabricated id becomes `UNKNOWN_CONTACT`
   * instead of a call to a stranger.
   */
  readonly contact: Contact;
  /** The configuration pinned to the conversation. The only policy source. */
  readonly agentConfiguration: AgentConfiguration;
  readonly policy: SchedulingPolicy;
  /** Parsed from `AgentConfiguration.allowedToolsJson`. */
  readonly allowedToolNames: readonly string[];
  /**
   * `now` for the whole turn, taken once from the injected Clock.
   *
   * Threaded onward into every service call, so the services validate against
   * this instant rather than reading the clock a second time. A service that
   * re-resolved the model's phrase against a later `now` could persist a row
   * the turn's own `TOOL_CALL_VALIDATED` contradicts.
   */
  readonly nowUtc: IsoUtcString;
}

/** The services a handler may call. */
export interface ToolDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly validator: SchedulingValidator;
  readonly meetings: MeetingSchedulingService;
  readonly futureActions: FutureActionService;
  readonly availability: AvailabilityProvider;
  readonly calendar: CalendarProvider;
}

/** The rows the dispatcher resolved from the call's subject arguments. */
export interface ResolvedSubject {
  readonly contact: Contact;
  /** Present only for `reschedule_meeting` / `cancel_meeting`. */
  readonly meeting?: Meeting;
  /** The calendar this organization books into, when one is connected. */
  readonly calendarRef?: string;
  readonly calendarConnectionId?: string;
}

export interface ToolHandlerInput {
  readonly definition: ToolDefinition;
  /**
   * Arguments AFTER `definition.schema.parse`.
   *
   * Typed `unknown` here because each handler knows its own schema; handlers
   * narrow with `as z.infer<typeof TheirSchema>`, which is sound precisely
   * because the dispatcher parsed with that same schema and refused the call
   * otherwise.
   */
  readonly args: unknown;
  readonly toolCallId: string;
  readonly ctx: ToolDispatchContext;
  readonly subject: ResolvedSubject;
  /**
   * The slot `SchedulingValidator` produced, for a time-bearing tool.
   *
   * Non-null here means the datetime has ALREADY passed every deterministic
   * check. A handler never re-derives it and never second-guesses it - it hands
   * this slot, and `ctx.nowUtc`, to the service, which reconciles its own
   * re-validation against them rather than persisting a second opinion.
   */
  readonly slot: ResolvedSlot | null;
  readonly provenance: ValidationProvenance | null;
  readonly deps: ToolDependencies;
}

export type ToolHandler = (input: ToolHandlerInput) => Promise<ToolOutcome>;

/** Read-only view of a contact's persisted qualification, or its absence. */
export type QualificationSnapshot = QualificationState | null;
