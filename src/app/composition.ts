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
 *
 * Mission 2 added a LOCAL model provider, and it did not weaken that property.
 * `options.llm` still wins, the fallback is still `ScriptedLlmProvider`, and a
 * local model is only reached when a caller passes `llmProviderConfig` NAMING
 * it. `LLM_PROVIDER=local` sitting in an environment is not enough on its own:
 * something has to read the config and hand it in. That is deliberate - it is
 * what keeps `npm run qa:sweep`'s network trap at zero attempts while the local
 * provider lives in the same source tree.
 *
 * This file contains no transport of any kind. It CONSTRUCTS a provider; the
 * only file that dials Ollama is `src/llm/ollama/client.ts`, which is what
 * `tests/invariants/vendorBoundary.test.ts` requires of everything under
 * `src/app`.
 */
import { ConversationService } from '../conversation/conversationService.js';
import { createDatabase, type Database } from '../db/database.js';
import { DueActionRunner } from '../followup/dueActionRunner.js';
import { FutureActionService } from '../followup/futureActionService.js';
import { LocalLlmProvider, type LocalLlmProviderOptions } from '../llm/localLlmProvider.js';
import { ScriptedLlmProvider } from '../llm/scriptedLlmProvider.js';
import type { Clock } from '../ports/clock.js';
import { SystemClock } from '../ports/clock.js';
import type { LlmProvider } from '../ports/llm.js';
import { ConfigurationError } from '../shared/errors.js';
import { createProviderRegistry, type ProviderRegistry, type ProviderRegistryConfig } from '../providers/index.js';
import { MeetingSchedulingService } from '../scheduling/meetingSchedulingService.js';
import { SchedulingValidator } from '../scheduling/schedulingValidator.js';
import { AgentTurnService } from '../agent/agentTurnService.js';
import { ToolDispatcher } from '../agent/tools/dispatcher.js';

/** The originating number used for outbound callbacks in this slice. */
export const DEFAULT_AGENT_FROM_E164 = '+12125550100';

/**
 * An explicit request for a particular provider.
 *
 * A discriminated union rather than a string plus a bag of optional fields,
 * so "I asked for the local model but gave it no model name" is a type error
 * at the call site instead of a runtime surprise. There is no `openai` member:
 * `OpenAiLlmProvider` needs a credential, and a composition root that could
 * construct one from configuration alone is a composition root that can start
 * spending money because of an environment variable. Pass it via `options.llm`.
 */
export type LlmProviderConfig =
  | { readonly kind: 'scripted' }
  | ({ readonly kind: 'local' } & LocalLlmProviderOptions);

/**
 * Build the provider a caller explicitly asked for.
 *
 * Exported because `llm:smoke` and the evaluation harness want the same
 * construction path the runtime uses, rather than a second one that could
 * drift from it.
 */
export function createLlmProvider(config: LlmProviderConfig): LlmProvider {
  switch (config.kind) {
    case 'scripted':
      return new ScriptedLlmProvider();

    case 'local': {
      const { kind: _kind, ...options } = config;
      return new LocalLlmProvider(options);
    }

    default: {
      // Unreachable through the type, reachable through a cast or a JSON config
      // file. Throwing beats silently choosing, because silently choosing a
      // model is exactly the decision a composition root must never make.
      const exhaustive = config as { kind?: unknown };
      throw new ConfigurationError(
        `Unknown LLM provider kind: ${String(exhaustive.kind)}. Expected 'scripted' or 'local'. ` +
          "For OpenAI, construct OpenAiLlmProvider yourself and pass it as `llm` - the composition root " +
          'will not build a paid provider from configuration alone.',
        { details: { kind: exhaustive.kind } },
      );
    }
  }
}

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
  /**
   * Build a provider instead of passing one. Ignored when `llm` is given, so
   * an already-constructed provider always wins and the two can never fight.
   *
   * Omitting this leaves the scripted default in place. There is no code path
   * on which leaving it out reaches a model.
   */
  readonly llmProviderConfig?: LlmProviderConfig;
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

  // Three rungs, and the bottom one is always safe: an explicit instance, then
  // an explicit request to build one, then the scripted double. Nothing about
  // the process environment appears in this expression.
  const llm =
    options.llm ??
    (options.llmProviderConfig ? createLlmProvider(options.llmProviderConfig) : new ScriptedLlmProvider());

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
