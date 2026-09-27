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
 * only file an application path can reach that dials Ollama is
 * `src/llm/ollama/client.ts`, which is what
 * `tests/invariants/vendorBoundary.test.ts` requires of everything under
 * `src/app`. (`src/eval/models/ollamaAdmin.ts` also speaks HTTP to Ollama, but
 * deliberately from outside that clause: it wraps the OPERATOR endpoints -
 * pull, ps, show - which no application path may call, and keeping them out of
 * the provider's client is what makes "a bad configuration cannot download a
 * model" a structural property rather than a convention.)
 */
import { ConversationService } from '../conversation/conversationService.js';
import { ConversationContextAssembler } from '../conversation/contextAssembler.js';
import { ConversationMemoryWriter } from '../conversation/conversationMemoryWriter.js';
import type { ContextBudgetConfig } from '../conversation/contextWindow.js';
import { loadBusinessProfile, type BusinessProfile } from '../context/businessProfile.js';
import { createDatabase, type Database } from '../db/database.js';
import { DueActionRunner } from '../followup/dueActionRunner.js';
import { FutureActionService } from '../followup/futureActionService.js';
import { DEFAULT_LOCAL_LLM_NUM_CTX, LocalLlmProvider, type LocalLlmProviderOptions } from '../llm/localLlmProvider.js';
import { ScriptedLlmProvider } from '../llm/scriptedLlmProvider.js';
import type { Clock } from '../ports/clock.js';
import { SystemClock } from '../ports/clock.js';
import type { LlmProvider } from '../ports/llm.js';
import { ConfigurationError } from '../shared/errors.js';
import { createProviderRegistry, type ProviderRegistry, type ProviderRegistryConfig } from '../providers/index.js';
import { MeetingSchedulingService } from '../scheduling/meetingSchedulingService.js';
import { SchedulingValidator } from '../scheduling/schedulingValidator.js';
import { AgentTurnService } from '../agent/agentTurnService.js';
import { ClaimGate } from '../agent/claimGate/claimGate.js';
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

/**
 * An explicit request for the Mission 2 context layer.
 *
 * OFF UNLESS ASKED FOR, on the same principle as `llmProviderConfig` directly
 * above: omitting this leaves `AgentTurnService` in its Baseline V1 shape -
 * unbounded transcript, no background, no rolling summary. Nothing in the
 * process environment turns it on.
 *
 * It lives here because the alternative is worse. The assembler needs the same
 * `db` and `clock` as everything else, and the memory writer needs the same
 * `llm`; a caller assembling those by hand would be building a second, silent
 * composition root whose `clock` could drift from this one's. The whole point
 * of this file is that there is exactly one dependency graph to read.
 */
export interface ContextAssemblyConfig {
  /**
   * The business facts, if any.
   *
   * Omitted loads the committed default profile. `null` is a deliberate and
   * supported choice, not a broken one: the agent keeps contact facts, memory
   * and continuity, and simply has nothing to say about pricing - which beats
   * having something wrong to say about it.
   */
  readonly businessProfile?: BusinessProfile | null;
  /**
   * Load the profile from a file instead of using the committed default.
   * Ignored when `businessProfile` is given, so the two can never fight.
   */
  readonly profilePath?: string | null;
  /**
   * Overrides for the context budget.
   *
   * `modelNumCtx` is normally omitted: see `resolveContextBudget` at the bottom
   * of this file, which derives it from the local provider this same call is
   * building so that the budget and the model cannot disagree about how large
   * the window is. An explicit one larger than the provider's window throws.
   */
  readonly budget?: Partial<ContextBudgetConfig>;
  /**
   * Keep the rolling summary current after each turn.
   *
   * Off by default because it costs a SECOND round trip to the model per turn,
   * and that is a cost a caller should opt into knowingly. It reuses the
   * runtime's `llm` - summarising through a different model than the one
   * holding the conversation is a configuration nobody asked for.
   */
  readonly memory?: boolean | {
    readonly refreshAfterTurns?: number;
    readonly keepRecentTurns?: number;
    readonly maxTurnsPerRefresh?: number;
  };
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
  /**
   * Tune the claim gate. There is NO option here that turns it off.
   *
   * That asymmetry is deliberate and it is the opposite of how
   * `contextAssembly` and `llmProviderConfig` work above. Those are capabilities
   * a deployment opts into; the gate is a guarantee about what may reach a
   * customer, and a runtime that can be configured into telling somebody their
   * meeting is booked when it is not has the defect back. Only the regeneration
   * bound is adjustable, because a caller who wants fewer provider round trips on
   * a slow host has a legitimate reason to ask - and lowering it makes the gate
   * STRICTER, not weaker: fewer chances to correct, not more chances to leak.
   */
  readonly claimGate?: { readonly maxRegenerationAttempts?: number };
  /**
   * Opt into durable memory and business context. Omitting it is Baseline V1.
   */
  readonly contextAssembly?: ContextAssemblyConfig | null;
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
  /**
   * The claim gate this runtime wired. Never null.
   *
   * Exposed so a test or a report can read the regeneration bound in force,
   * rather than hard-coding a number that could drift from the one the runtime
   * is actually using.
   */
  readonly claimGate: ClaimGate;
  /**
   * The context layer, or null when this runtime did not opt in.
   *
   * Exposed so a demo or a benchmark can inspect exactly what the model was
   * handed, rather than rebuilding an assembler that might not match.
   */
  readonly contextAssembler: ConversationContextAssembler | null;
  readonly memoryWriter: ConversationMemoryWriter | null;
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

  // The Mission 2 context layer, built only when asked for. Note that the
  // assembler shares this function's `db` and `clock`: the background a turn
  // reasons against is read from the same database, at the same `now`, as the
  // tools that will act on it.
  const contextConfig = options.contextAssembly ?? null;

  /**
   * RESOLVED ONCE, HANDED TO TWO COLLABORATORS, and that is the whole point.
   *
   * The profile reaches the model by two different routes: the assembler writes
   * it into the turn's background, and `get_contact_context` answers from it on
   * demand. `CONVERSATION_CONTEXT.md` § 6 makes the second route load-bearing -
   * when the budget ladder sheds policy facts from the window, the facts "remain
   * reachable on demand" - so the tool route is what the ladder falls back to,
   * not a convenience.
   *
   * It was wired to the first route only, and that was a real defect found at
   * Mission 2 QA by running it. `ToolDispatcher` was constructed here with no
   * `businessProfile` at all, so `ToolDependencies.businessProfile` and the
   * `business` block in `handlers.ts` were unreachable through the only
   * supported wiring path: `get_contact_context` came back `ok: true` with no
   * `business` key, for a runtime whose assembler had the profile the whole
   * time. Nothing errored, and the budget ladder's documented fallback was
   * quietly to nothing.
   *
   * Hence one binding, above the dispatcher, used by both. Two reads of
   * `loadBusinessProfile` could return two different documents if the file
   * changed between them, and a background that disagrees with a tool result is
   * worse than either being absent.
   */
  const businessProfile = contextConfig
    ? contextConfig.businessProfile !== undefined
      ? contextConfig.businessProfile
      : loadBusinessProfile({ profilePath: contextConfig.profilePath ?? null })
    : null;

  const dispatcher = new ToolDispatcher({
    db,
    clock,
    validator,
    meetings,
    futureActions,
    availability: providers.availability,
    calendar: providers.calendar,
    // Spread, not `businessProfile: null`. `ToolDependencies.businessProfile`
    // being ABSENT is what keeps `get_contact_context` byte-identical to
    // Baseline V1, and `businessProfile: null` is a supported configuration in
    // its own right - the agent keeps memory and continuity and simply has
    // nothing to say about pricing. Both land here as "no business block".
    ...(businessProfile ? { businessProfile } : {}),
  });

  const conversations = new ConversationService({ db, clock });

  const contextAssembler = contextConfig
    ? new ConversationContextAssembler({
        db,
        clock,
        businessProfile,
        budget: resolveContextBudget(contextConfig, options),
      })
    : null;

  const memoryOptions = contextConfig?.memory ?? false;
  const memoryWriter =
    memoryOptions === false
      ? null
      : new ConversationMemoryWriter({
          db,
          clock,
          llm,
          ...(memoryOptions === true ? {} : memoryOptions),
        });

  // ENABLED BY DEFAULT, and there is no branch above this line that skips it.
  // The chokepoint governs actions; this governs sentences. Both are always on.
  const claimGate = new ClaimGate(
    options.claimGate?.maxRegenerationAttempts !== undefined
      ? { maxRegenerationAttempts: options.claimGate.maxRegenerationAttempts }
      : {},
  );

  const agent = new AgentTurnService({
    db,
    clock,
    llm,
    conversations,
    dispatcher,
    claimGate,
    ...(options.maxToolIterations !== undefined ? { maxIterations: options.maxToolIterations } : {}),
    ...(contextAssembler ? { contextAssembly: { assembler: contextAssembler, memoryWriter } } : {}),
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
    claimGate,
    contextAssembler,
    memoryWriter,
    async shutdown() {
      // A caller who supplied the database owns its lifecycle; closing it here
      // would disconnect a client that is still in use.
      if (ownsDb) await db.disconnect();
    },
  };
}

/**
 * The context length the local-brain path wants, as opposed to the bare provider.
 *
 * MEASURED, and the two numbers differ because they answer different questions.
 * `DEFAULT_LOCAL_LLM_NUM_CTX` is 8192 and is right for the provider ALONE: the
 * production system prompt plus the nine tool schemas cost 3,732 tokens, which
 * is 46% of an 8k window, and 8192 is what fits an 8 GiB card most comfortably
 * (`LOCAL_PROVIDER.md` § 6). Turn the context layer on and the same window has
 * to carry an assembled background and a transcript as well.
 *
 * Measured on the mission host with `qwen2.5:7b-instruct` and the committed
 * business profile:
 *
 *   num_ctx  background  budget-ladder reductions              pricing survives?
 *   8192     5,008 ch    14, ending in drop-pricing-detail     NO
 *   16384    10,078 ch   6, none of them pricing               YES
 *
 * At 8192 the ladder does exactly what it is designed to do - shed the least
 * essential facts to fit - and what it sheds includes the prices. The agent is
 * then structurally unable to answer "what would it cost", and it will not say
 * so. Cost of 16384 over 8192: 5.09 GiB resident versus 4.64 GiB on an 8,188 MiB
 * card, with ~1.6 GiB still spare.
 */
export const DEFAULT_LOCAL_BRAIN_NUM_CTX = 16_384;

/**
 * Reconcile the context budget's `modelNumCtx` with the model actually serving
 * the turn.
 *
 * THE BUG THIS EXISTS TO MAKE UNREACHABLE
 * ---------------------------------------------------------------------------
 * The two Mission 2 slices arrived with different numbers, each right on its own
 * terms. `DEFAULT_CONTEXT_BUDGET.modelNumCtx` is 16384, chosen by the context
 * layer as the window its full facts block needs. `DEFAULT_LOCAL_LLM_NUM_CTX` is
 * 8192, chosen by the provider as what fits an 8 GiB card with headroom. Wire
 * them together naively and the assembler budgets a turn for 16384 tokens while
 * Ollama is serving 8192.
 *
 * WHAT OLLAMA ACTUALLY DOES WITH THE OVERFLOW, measured rather than assumed,
 * because the first write-up of this defect got it wrong and the wrong version
 * is scarier in a way that points at the wrong fix. Ollama does NOT truncate the
 * prompt from the front and it does NOT strip the system prompt. It drops whole
 * older MESSAGES and keeps the system prompt. Canary: a system prompt reading
 * "answer with exactly ZANZIBAR-7", a ~5k-token filler user message, `num_ctx`
 * forced to 2048 - `prompt_eval_count` fell to 54 and the model still answered
 * ZANZIBAR-7. So the guardrail clauses survive; **the conversation history is
 * what is lost**, which is precisely the thing this mission's memory layer
 * exists to guarantee, and it is lost in silence.
 *
 * Silence is the real problem. QA measured a 44-turn conversation sending 41,655
 * prompt chars (~10.4k tokens) into a num_ctx of 8192: Ollama reported
 * `prompt_eval_count` 8128 and discarded the rest. The turn's own budget report
 * said `totalChars` 65536 and `transcriptFloorApplied` false, and
 * `contextUtilization` came back 0.9922 because it is computed from the
 * TRUNCATED count - so every number the system could have complained with
 * instead agreed that everything was fine. No error, no warning, no audit note.
 *
 * Two rules, in order:
 *
 *  1. An omitted `modelNumCtx` is DERIVED from the local provider this same call
 *     is building. The two numbers then cannot drift, because there is one.
 *  2. An explicit `modelNumCtx` LARGER than that provider's window is a
 *     `ConfigurationError`, not a warning. Smaller is allowed and left alone: a
 *     caller deliberately budgeting under the window is being careful, and this
 *     function has no business overruling that.
 *
 * WHAT IT CANNOT DO. When the caller passes an already-constructed provider via
 * `options.llm`, its window is not visible here - `LlmProvider` exposes no
 * context length, and adding one to the port for this would put a local model's
 * private concern on the interface `ScriptedLlmProvider` also implements. In
 * that case the budget default stands, and a caller pairing a hand-built
 * `LocalLlmProvider` with this context layer should pass both numbers. Prefer
 * `llmProviderConfig`, which is checked.
 */
function resolveContextBudget(
  contextConfig: ContextAssemblyConfig,
  options: BuildAgentRuntimeOptions,
): Partial<ContextBudgetConfig> {
  const budget = contextConfig.budget ?? {};

  const providerNumCtx =
    options.llm === undefined && options.llmProviderConfig?.kind === 'local'
      ? (options.llmProviderConfig.numCtx ?? DEFAULT_LOCAL_LLM_NUM_CTX)
      : null;

  if (providerNumCtx === null) return budget;

  if (budget.modelNumCtx === undefined) {
    return { ...budget, modelNumCtx: providerNumCtx };
  }

  if (budget.modelNumCtx > providerNumCtx) {
    throw new ConfigurationError(
      `The context budget was given modelNumCtx=${budget.modelNumCtx}, but the local model this runtime is ` +
        `building serves num_ctx=${providerNumCtx}. Ollama does not reject an over-long prompt and does not ` +
        'report one: it silently drops the oldest messages and returns a prompt_eval_count that makes the ' +
        'turn look like it fitted. The conversation history is what disappears, which is the one thing this ' +
        'context layer exists to preserve. Raise LOCAL_LLM_NUM_CTX (and check the VRAM budget) or lower the ' +
        'context budget; do not leave them disagreeing.',
      { details: { budgetModelNumCtx: budget.modelNumCtx, providerNumCtx } },
    );
  }

  return budget;
}
