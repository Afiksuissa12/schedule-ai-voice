/**
 * The composition root: the ONE place that decides which implementation of
 * everything the application runs against.
 *
 * WHY A COMPOSITION ROOT
 * ---------------------------------------------------------------------------
 * Every service in this codebase takes its collaborators as constructor
 * arguments and names none of them. That is what makes the whole slice
 * testable against a `FixedClock`, a deterministic availability provider and a
 * scripted model. The cost of that discipline is that SOMEWHERE the wiring has
 * to be written down. This is that place, and it is the only one.
 *
 * Read `buildAgentRuntime` top to bottom and you have the complete dependency
 * graph of the system: clock -> database -> providers -> validator -> scheduling
 * and follow-up services -> tool dispatcher -> conversation service -> agent
 * turn service -> due-action runner.
 *
 * SAFE BY DEFAULT
 * ---------------------------------------------------------------------------
 * The default LLM is the SCRIPTED one and the default providers are the
 * deterministic doubles. Reaching a real vendor requires passing one in
 * explicitly. A wiring mistake therefore fails towards "does nothing to
 * anybody" rather than towards "phones a stranger".
 */
import { ConversationService } from '../conversation/conversationService.js';
import { createDatabase, type Database } from '../db/database.js';
import { DueActionRunner } from '../followup/dueActionRunner.js';
import { FutureActionService } from '../followup/futureActionService.js';
import { ScriptedLlmProvider } from '../llm/scriptedLlmProvider.js';
import type { Clock } from '../ports/clock.js';
import { SystemClock } from '../ports/clock.js';
import type { LlmProvider } from '../ports/llm.js';
import { createProviderRegistry, type ProviderRegistry, type ProviderRegistryConfig } from '../providers/index.js';
import { MeetingSchedulingService } from '../scheduling/meetingSchedulingService.js';
import { SchedulingValidator } from '../scheduling/schedulingValidator.js';
import { AgentTurnService } from '../agent/agentTurnService.js';
import { ToolDispatcher } from '../agent/tools/dispatcher.js';

/** The originating number used for outbound callbacks in this slice. */
export const DEFAULT_AGENT_FROM_E164 = '+12125550100';

export interface BuildAgentRuntimeOptions {
  /** Pass a `FixedClock` in tests and in the demo. */
  readonly clock?: Clock;
  /** An existing database, or a datasource URL to open one. */
  readonly db?: Database;
  readonly datasourceUrl?: string;
  /** Deterministic doubles unless told otherwise. */
  readonly providers?: ProviderRegistry;
  readonly providerConfig?: ProviderRegistryConfig;
  /** Defaults to an empty `ScriptedLlmProvider` - safe, and obviously inert. */
  readonly llm?: LlmProvider;
  readonly maxToolIterations?: number;
  readonly fromE164?: string;
  readonly dueActionRunnerId?: string;
}

export interface AgentRuntime {
  readonly db: Database;
  readonly clock: Clock;
  readonly providers: ProviderRegistry;
  readonly llm: LlmProvider;
  readonly validator: SchedulingValidator;
  readonly meetings: MeetingSchedulingService;
  readonly futureActions: FutureActionService;
  readonly dispatcher: ToolDispatcher;
  readonly conversations: ConversationService;
  readonly agent: AgentTurnService;
  readonly dueActions: DueActionRunner;
  /** Close the database. Only closes a client this function opened. */
  shutdown(): Promise<void>;
}

export function buildAgentRuntime(options: BuildAgentRuntimeOptions = {}): AgentRuntime {
  const clock = options.clock ?? new SystemClock();

  const ownsDb = options.db === undefined;
  const db =
    options.db ??
    createDatabase({
      ...(options.datasourceUrl ? { datasourceUrl: options.datasourceUrl } : {}),
      clock,
    });

  const providers = options.providers ?? createProviderRegistry(options.providerConfig ?? {});
  const llm = options.llm ?? new ScriptedLlmProvider();

  const validator = new SchedulingValidator({ clock, availability: providers.availability });

  const meetings = new MeetingSchedulingService({
    db,
    clock,
    validator,
    calendar: providers.calendar,
  });

  const futureActions = new FutureActionService({ db, clock, validator });

  const dispatcher = new ToolDispatcher({
    db,
    clock,
    validator,
    meetings,
    futureActions,
    availability: providers.availability,
    calendar: providers.calendar,
  });

  const conversations = new ConversationService({ db, clock });

  const agent = new AgentTurnService({
    db,
    clock,
    llm,
    conversations,
    dispatcher,
    ...(options.maxToolIterations !== undefined ? { maxIterations: options.maxToolIterations } : {}),
  });

  const dueActions = new DueActionRunner({
    db,
    clock,
    telephony: providers.telephony,
    fromE164: options.fromE164 ?? DEFAULT_AGENT_FROM_E164,
    ...(options.dueActionRunnerId ? { runnerId: options.dueActionRunnerId } : {}),
  });

  return {
    db,
    clock,
    providers,
    llm,
    validator,
    meetings,
    futureActions,
    dispatcher,
    conversations,
    agent,
    dueActions,
    async shutdown() {
      // A caller who supplied the database owns its lifecycle; closing it here
      // would disconnect a client that is still in use.
      if (ownsDb) await db.disconnect();
    },
  };
}
