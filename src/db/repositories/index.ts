/**
 * The repository container.
 *
 * `Repositories` bundles every repository plus the `AuditRecorder`, all bound
 * to the SAME `DbExecutor`. That is the whole point: inside
 * `withTransaction(fn)` the repositories AND the audit recorder handed to `fn`
 * share one transaction, so a domain row and the audit events that explain it
 * commit atomically. You can never end up with a Meeting nobody can account
 * for, or an audit trail describing a Meeting that was rolled back.
 */
import type { AuditRecorder } from '../../audit/types.js';
import { createAuditRecorder } from '../../audit/recorder.js';
import type { Clock } from '../../ports/clock.js';
import { SystemClock } from '../../ports/clock.js';
import type { DbExecutor } from '../types.js';
import { isTransactionCapable } from '../types.js';
import {
  createContactRepository,
  createLeadRepository,
  createQualificationStateRepository,
  type ContactRepository,
  type LeadRepository,
  type QualificationStateRepository,
} from './crm.js';
import {
  createConversationRepository,
  createConversationTurnRepository,
  type ConversationRepository,
  type ConversationTurnRepository,
} from './conversations.js';
import {
  createCalendarConnectionRepository,
  createFutureActionRepository,
  createMeetingRepository,
  createTaskRepository,
  type CalendarConnectionRepository,
  type FutureActionRepository,
  type MeetingRepository,
  type TaskRepository,
} from './scheduling.js';
import {
  createCallOutcomeRepository,
  createCallRepository,
  type CallOutcomeRepository,
  type CallRepository,
} from './telephony.js';
import {
  createAgentConfigurationRepository,
  createAiAgentRepository,
  createOrganizationRepository,
  createUserRepository,
  type AgentConfigurationRepository,
  type AiAgentRepository,
  type OrganizationRepository,
  type UserRepository,
} from './tenancy.js';

export * from './conversations.js';
export * from './crm.js';
export * from './scheduling.js';
export * from './telephony.js';
export * from './tenancy.js';

export interface Repositories {
  readonly organizations: OrganizationRepository;
  readonly users: UserRepository;
  readonly aiAgents: AiAgentRepository;
  readonly agentConfigurations: AgentConfigurationRepository;
  readonly contacts: ContactRepository;
  readonly leads: LeadRepository;
  readonly qualificationStates: QualificationStateRepository;
  readonly conversations: ConversationRepository;
  readonly conversationTurns: ConversationTurnRepository;
  readonly calls: CallRepository;
  readonly callOutcomes: CallOutcomeRepository;
  readonly calendarConnections: CalendarConnectionRepository;
  readonly meetings: MeetingRepository;
  readonly futureActions: FutureActionRepository;
  readonly tasks: TaskRepository;

  /** Audit recorder bound to the same executor as the repositories above. */
  readonly audit: AuditRecorder;

  /** The clock these repositories and the audit recorder were built with. */
  readonly clock: Clock;

  /**
   * Run `fn` inside a database transaction.
   *
   * `fn` receives a fresh `Repositories` bound to the transaction; use THAT,
   * not the outer one, or your writes will land outside the transaction.
   *
   * Nesting is safe: calling `withTransaction` on an already-transactional
   * container runs `fn` inline on the same transaction, because SQLite has no
   * nested transactions and silently opening a second one would be worse.
   */
  withTransaction<T>(fn: (tx: Repositories) => Promise<T>): Promise<T>;
}

export interface CreateRepositoriesOptions {
  /** Injected clock; defaults to `SystemClock`. Used for audit `occurredAt`. */
  clock?: Clock;
  /** Transaction options passed through to Prisma's `$transaction`. */
  transaction?: { maxWait?: number; timeout?: number };
}

export function createRepositories(executor: DbExecutor, options: CreateRepositoriesOptions = {}): Repositories {
  const clock = options.clock ?? new SystemClock();

  const repositories: Repositories = {
    organizations: createOrganizationRepository(executor),
    users: createUserRepository(executor),
    aiAgents: createAiAgentRepository(executor),
    agentConfigurations: createAgentConfigurationRepository(executor),
    contacts: createContactRepository(executor),
    leads: createLeadRepository(executor),
    qualificationStates: createQualificationStateRepository(executor),
    conversations: createConversationRepository(executor),
    conversationTurns: createConversationTurnRepository(executor),
    calls: createCallRepository(executor),
    callOutcomes: createCallOutcomeRepository(executor),
    calendarConnections: createCalendarConnectionRepository(executor),
    meetings: createMeetingRepository(executor),
    futureActions: createFutureActionRepository(executor),
    tasks: createTaskRepository(executor),
    audit: createAuditRecorder(executor, { clock }),
    clock,

    async withTransaction<T>(fn: (tx: Repositories) => Promise<T>): Promise<T> {
      if (!isTransactionCapable(executor)) {
        // Already inside a transaction: reuse it rather than nesting.
        return fn(repositories);
      }
      return executor.$transaction(
        async (tx) => fn(createRepositories(tx, options)),
        options.transaction ?? {},
      );
    },
  };

  return repositories;
}
