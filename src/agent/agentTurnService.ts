/**
 * `AgentTurnService` - one turn of the conversation, end to end.
 *
 * THE SHAPE OF A TURN
 * ---------------------------------------------------------------------------
 *   1. Mint ONE `correlationId`. Every audit event this turn produces carries
 *      it, including events written months later by `DueActionRunner` when it
 *      keeps a callback promised here.
 *   2. Persist what the contact said, and emit `UTTERANCE_RECEIVED`.
 *   3. Load context FROM THE DATABASE: the contact, their qualification, and
 *      the `AgentConfiguration` pinned to this conversation. Never from memory,
 *      never from the model.
 *   4. Loop, at most `maxIterations` times:
 *        - rebuild the message array from the database (see ConversationService)
 *        - call the LlmProvider with the guardrailed prompt, that history, and
 *          the JSON Schemas of the permitted tools
 *        - emit `AGENT_DECISION`: what it said, and what it wants to do
 *        - persist the agent's text, then route EVERY tool call through
 *          `ToolDispatcher`, persisting each result as a TOOL turn
 *        - stop when the model stops asking for tools
 *   5. If the cap is reached, refuse further tool calls with an audited
 *      `POLICY_VIOLATION` and end the turn.
 *
 * WHY THE LOOP IS HARD-CAPPED
 * ---------------------------------------------------------------------------
 * A model that misreads a rejection can retry forever. Each iteration costs a
 * provider call and, worse, could keep attempting state changes. The cap is a
 * number in application code, not an instruction in the prompt, because an
 * instruction is a request and a number is a limit. When it is hit the turn
 * ends with a recorded reason rather than a hang.
 *
 * WHAT THIS CLASS DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not validate a datetime, execute a tool, or write a domain row. It
 * orchestrates and it records. All authority over state sits behind
 * `ToolDispatcher`, and that is what keeps "the LLM reasons, application code
 * acts" true at the top of the stack as well as the bottom.
 */
import type { Database } from '../db/database.js';
import type { AgentConfiguration, Contact, Conversation } from '../domain/entities.js';
import type { AgentLlmMessage } from '../llm/agentMessage.js';
import type { Clock, IsoUtcString } from '../ports/clock.js';
import type { CompleteTurnResult, LlmProvider, ToolCallRequest } from '../ports/llm.js';
import { ValidationErrorCode } from '../ports/validation.js';
import { schedulingPolicyFromAgentConfiguration } from '../scheduling/policy.js';
import { ConfigurationError, NotFoundError } from '../shared/errors.js';
import { newCorrelationId } from '../shared/ids.js';
import { parseJson } from '../shared/json.js';
import { ConversationService } from '../conversation/conversationService.js';
import type { AssembledContext, ConversationContextAssembler } from '../conversation/contextAssembler.js';
import type { ConversationMemoryWriter } from '../conversation/conversationMemoryWriter.js';
import { buildSystemPrompt, type BuiltSystemPrompt } from './prompt/systemPrompt.js';
import { buildTurnContext } from './prompt/turnContext.js';
import type { ToolDispatchContext } from './tools/context.js';
import { llmToolDefinitions } from './tools/definitions.js';
import type { ToolDispatcher } from './tools/dispatcher.js';
import { toModelPayload, toModelPayloadJson, type ToolOutcome } from './tools/results.js';

/**
 * The iteration cap.
 *
 * Five is enough for the longest sensible chain in this slice - look up the
 * contact, check a time, book it, record the outcome, say goodbye - and short
 * enough that a confused model costs five provider calls rather than a bill.
 */
export const DEFAULT_MAX_TOOL_ITERATIONS = 5;

/**
 * MISSION 2, OPT-IN: durable memory and business context for this turn.
 *
 * ABSENT BY DEFAULT, DELIBERATELY. With `contextAssembly` undefined this class
 * behaves exactly as Baseline V1 did - the same unbounded transcript, the same
 * turn-context block, the same disclosure keys, the same audit detail. That is
 * what lets `npm test` stay at 500/2 and `npm run qa:sweep` stay at 601/0/0
 * while a genuinely different context layer exists in the same file.
 *
 * Supplying it switches on three things at once, and they belong together:
 * the assembled background, the bounded transcript window that background's
 * summary exists to compensate for, and (optionally) the writer that keeps the
 * summary current.
 */
export interface ContextAssemblyOptions {
  readonly assembler: ConversationContextAssembler;
  /**
   * Keeps the rolling summary up to date after a turn finishes.
   *
   * Optional even here. Without it the window still bounds the transcript and
   * the background still carries contact facts, continuity and commitments -
   * there is simply no recap of the part of the conversation that scrolled off.
   */
  readonly memoryWriter?: ConversationMemoryWriter | null;
}

export interface AgentTurnServiceOptions {
  readonly db: Database;
  readonly clock: Clock;
  readonly llm: LlmProvider;
  readonly conversations: ConversationService;
  readonly dispatcher: ToolDispatcher;
  readonly maxIterations?: number;
  readonly contextAssembly?: ContextAssemblyOptions | null;
}

export interface HandleTurnInput {
  readonly conversationId: string;
  /** What the contact said. */
  readonly utterance: string;
  /** Override the minted id. Only for replaying a recorded turn. */
  readonly correlationId?: string;
}

export type TurnStopReason =
  /** The model finished: it produced text and asked for no more tools. */
  | 'MODEL_FINISHED'
  /** The iteration cap was reached. Recorded as a POLICY_VIOLATION. */
  | 'ITERATION_CAP_REACHED';

export interface AgentTurnResult {
  readonly correlationId: string;
  readonly conversationId: string;
  readonly contactId: string;
  /** Everything the agent said this turn, in order. */
  readonly assistantMessages: readonly string[];
  /** The last thing it said - what a caller would speak out loud. */
  readonly assistantText: string | null;
  readonly toolOutcomes: readonly ToolOutcome[];
  readonly iterations: number;
  readonly stopReason: TurnStopReason;
  readonly promptFingerprint: string;
  /**
   * The background this turn assembled, or null when the deployment has not
   * opted in. Returned so a benchmark can drive real candidate models through
   * the real context and see exactly what they were handed.
   */
  readonly assembledContext?: AssembledContext | null;
  /** What the rolling-summary refresh did, when one is wired. */
  readonly memoryRefresh?: MemoryRefreshSummary | null;
}

/** The compaction outcome, flattened onto the turn result. */
export interface MemoryRefreshSummary {
  readonly status: 'NOT_DUE' | 'REFRESHED' | 'FAILED';
  readonly turnsCompacted: number;
  readonly failureReason: string | null;
}

export class AgentTurnService {
  private readonly db: Database;
  private readonly clock: Clock;
  private readonly llm: LlmProvider;
  private readonly conversations: ConversationService;
  private readonly dispatcher: ToolDispatcher;
  private readonly maxIterations: number;
  private readonly contextAssembly: ContextAssemblyOptions | null;

  constructor(options: AgentTurnServiceOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.llm = options.llm;
    this.conversations = options.conversations;
    this.dispatcher = options.dispatcher;
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    this.contextAssembly = options.contextAssembly ?? null;
  }

  async handleTurn(input: HandleTurnInput): Promise<AgentTurnResult> {
    const correlationId = input.correlationId ?? newCorrelationId();
    // ONE `now` for the whole turn. The dispatcher, the validator and the
    // services all read this value, so they cannot disagree about what time it
    // is even if the turn takes a while.
    const nowUtc = this.clock.nowUtc();

    const { conversation, contact, agentConfiguration } = await this.loadContext(input.conversationId);

    // ---- the contact's words, persisted before anything else ---------------
    const utteranceTurn = await this.conversations.appendContactUtterance(conversation.id, input.utterance);
    await this.db.audit.record({
      type: 'UTTERANCE_RECEIVED',
      organizationId: conversation.organizationId,
      correlationId,
      conversationId: conversation.id,
      contactId: contact.id,
      subjectType: 'CONVERSATION_TURN',
      subjectId: utteranceTurn.id,
      summary: `Contact said: "${truncate(input.utterance, 160)}"`,
      detailJson: {
        text: input.utterance,
        turnId: utteranceTurn.id,
        turnIndex: utteranceTurn.index,
        channel: conversation.channel,
      },
      occurredAt: nowUtc,
    });

    // ---- the policy and the instructions, both from persisted rows ---------
    const allowedToolNames = parseAllowedTools(agentConfiguration);
    const prompt = buildSystemPrompt({
      promptRef: agentConfiguration.systemPromptRef,
      allowedToolNames,
    });
    const tools = llmToolDefinitions(allowedToolNames);
    const qualification = await this.db.qualificationStates.findByContactId(contact.id);

    // ---- the background, when this deployment has opted in -----------------
    // Assembled ONCE per turn, on the same principle as `nowUtc` and the pinned
    // configuration: a turn reasons against one snapshot of the world, not
    // against a world that shifts under it between iterations. Anything that
    // changes mid-turn changes because a tool changed it, and that tool handed
    // the model an authoritative result saying so.
    const assembled = this.contextAssembly
      ? await this.contextAssembly.assembler.assemble({
          conversationId: conversation.id,
          // Measured, not estimated: the real prompt and the real schemas the
          // provider is about to be sent.
          fixedOverheadChars: prompt.text.length + JSON.stringify(tools).length,
        })
      : null;

    const turnContext = buildTurnContext({
      contact,
      nowUtc,
      qualification,
      ...(assembled ? { background: assembled.rendered } : {}),
    });

    await this.db.audit.record({
      type: 'AGENT_TURN_STARTED',
      organizationId: conversation.organizationId,
      correlationId,
      conversationId: conversation.id,
      contactId: contact.id,
      subjectType: 'CONVERSATION',
      subjectId: conversation.id,
      summary:
        `Turn started with AgentConfiguration v${agentConfiguration.version} ` +
        `(${agentConfiguration.systemPromptRef}), ${tools.length} tool(s) offered`,
      detailJson: {
        agentConfigurationId: agentConfiguration.id,
        agentConfigurationVersion: agentConfiguration.version,
        systemPromptRef: agentConfiguration.systemPromptRef,
        promptFingerprint: prompt.fingerprint,
        promptClauseIds: prompt.clauseIds,
        allowedToolNames,
        offeredToolNames: tools.map((tool) => tool.name),
        llmProvider: this.llm.name(),
        maxIterations: this.maxIterations,
        // Exactly what this turn told the model about the contact. The proof
        // that no more than this was disclosed.
        turnContextDisclosed: turnContext.disclosed,
        // How the background was bounded, when there was one. Absent entirely
        // on the Baseline V1 path, so the audit detail of an unchanged turn is
        // itself unchanged.
        ...(assembled
          ? {
              contextAssembly: {
                version: assembled.version,
                businessProfileRef: assembled.facts.business?.profileRef ?? null,
                renderedChars: assembled.rendered.text.length,
                factsBudgetChars: assembled.budget.factsBudgetChars,
                transcriptBudgetChars: assembled.budget.transcriptBudgetChars,
                modelNumCtx: assembled.budget.config.modelNumCtx,
                reductionsApplied: assembled.reductionsApplied,
                hardTruncated: assembled.hardTruncated,
                transcript: assembled.facts.transcript,
                memorySource: assembled.facts.runningSummary?.source ?? 'ABSENT',
                durableFactCount: assembled.facts.durableFacts.length,
                unresolvedCount: assembled.facts.unresolved.length,
                commitmentCount: assembled.facts.commitments.length,
                openKnowledgeGoalCount: assembled.facts.openKnowledgeGoals.length,
                hasPreviousConversation: assembled.facts.previousConversation !== null,
              },
            }
          : {}),
        nowUtc,
      },
      occurredAt: nowUtc,
    });

    const dispatchContext: ToolDispatchContext = {
      correlationId,
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      contact,
      agentConfiguration,
      policy: schedulingPolicyFromAgentConfiguration(agentConfiguration),
      allowedToolNames,
      nowUtc,
    };

    // ---- the bounded loop ---------------------------------------------------
    const assistantMessages: string[] = [];
    const toolOutcomes: ToolOutcome[] = [];
    let stopReason: TurnStopReason = 'MODEL_FINISHED';
    let iterations = 0;

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      iterations = iteration;

      // REBUILT FROM THE DATABASE, every iteration. Not appended to a local
      // array - the rows are the transcript, and they already include the tool
      // results written moments ago.
      //
      // The window is recomputed every iteration too, on the same fresh read:
      // a turn that calls three tools adds six rows to the transcript while it
      // runs, and a window selected once at the top would either miss them or
      // overflow the budget it was chosen to respect.
      const messages: AgentLlmMessage[] = assembled
        ? (
            await this.conversations.buildWindowedMessages(conversation.id, {
              maxTurns: assembled.budget.config.maxRecentTurns,
              maxChars: assembled.budget.transcriptBudgetChars,
              leadingMessages: [{ role: 'system', content: turnContext.text }],
            })
          ).messages
        : await this.conversations.buildMessages(conversation.id, {
            leadingMessages: [{ role: 'system', content: turnContext.text }],
          });

      const completion = await this.callModel(
        { conversation, contact, correlationId, nowUtc, prompt, iteration },
        { systemPrompt: prompt.text, messages, tools },
      );

      await this.recordDecision(
        { conversation, contact, correlationId, nowUtc, iteration },
        completion,
      );

      if (completion.assistantText) {
        assistantMessages.push(completion.assistantText);
        await this.conversations.appendAgentText(conversation.id, completion.assistantText);
      }

      if (completion.toolCalls.length === 0) {
        stopReason = 'MODEL_FINISHED';
        break;
      }

      // Would executing these calls take us past the cap? Refuse them now,
      // loudly, rather than after doing the work.
      if (iteration === this.maxIterations) {
        await this.refuseForIterationCap(
          { conversation, contact, correlationId, nowUtc },
          completion.toolCalls,
          toolOutcomes,
        );
        stopReason = 'ITERATION_CAP_REACHED';
        break;
      }

      for (const call of completion.toolCalls) {
        // Persisted BEFORE dispatch: if the process dies mid-tool, the record
        // shows what was attempted. `ConversationService` repairs the dangling
        // call on the next rebuild rather than pretending it never happened.
        await this.conversations.appendToolCall(conversation.id, call);

        const outcome = await this.dispatcher.dispatch(call, dispatchContext);
        toolOutcomes.push(outcome);

        await this.conversations.appendToolResult(conversation.id, {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          payload: toModelPayload(outcome),
        });
      }
    }

    // ---- keep the rolling summary current, after the talking is done -------
    // Last, and fenced. The turn's result is already decided by this point:
    // every row is written, every audit event is recorded, and the words the
    // caller will speak are in `assistantMessages`. A compaction that fails,
    // hangs on a provider, or returns nonsense can therefore cost context on a
    // future turn and nothing at all on this one.
    //
    // `refresh` is documented never to throw, and the try/catch is here anyway:
    // "documented never to throw" is a promise about today's code, and a
    // dropped call is too expensive a way to find out it has changed.
    let memoryRefresh: MemoryRefreshSummary | null = null;
    if (this.contextAssembly?.memoryWriter) {
      try {
        const result = await this.contextAssembly.memoryWriter.refresh({
          conversationId: conversation.id,
          correlationId,
        });
        memoryRefresh = {
          status: result.status,
          turnsCompacted: result.turnsCompacted,
          failureReason: result.failureReason,
        };
      } catch (error) {
        memoryRefresh = {
          status: 'FAILED',
          turnsCompacted: 0,
          failureReason: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      correlationId,
      conversationId: conversation.id,
      contactId: contact.id,
      assistantMessages,
      assistantText: assistantMessages.at(-1) ?? null,
      toolOutcomes,
      iterations,
      stopReason,
      promptFingerprint: prompt.fingerprint,
      assembledContext: assembled,
      memoryRefresh,
    };
  }

  // -------------------------------------------------------------------------

  private async loadContext(conversationId: string): Promise<{
    conversation: Conversation;
    contact: Contact;
    agentConfiguration: AgentConfiguration;
  }> {
    const conversation = await this.db.conversations.findById(conversationId);
    if (!conversation) {
      throw new NotFoundError('Conversation', conversationId);
    }

    const contact = await this.db.contacts.requireById(conversation.contactId);

    // An unpinned conversation cannot be replayed against the policy that was
    // in force, so it is refused rather than silently given today's.
    if (!conversation.agentConfigurationId) {
      throw new ConfigurationError(
        `Conversation ${conversation.id} has no pinned AgentConfiguration. A turn must run against the ` +
          'configuration the conversation was started with, or an audit replay is meaningless.',
        { details: { conversationId: conversation.id } },
      );
    }

    const agentConfiguration = await this.db.agentConfigurations.requireById(conversation.agentConfigurationId);
    return { conversation, contact, agentConfiguration };
  }

  private async callModel(
    scope: TurnScope & { prompt: BuiltSystemPrompt; iteration: number },
    request: { systemPrompt: string; messages: AgentLlmMessage[]; tools: ReturnType<typeof llmToolDefinitions> },
  ): Promise<CompleteTurnResult> {
    await this.db.audit.record({
      type: 'PROVIDER_INVOKED',
      organizationId: scope.conversation.organizationId,
      correlationId: scope.correlationId,
      conversationId: scope.conversation.id,
      contactId: scope.contact.id,
      subjectType: 'CONVERSATION',
      subjectId: scope.conversation.id,
      summary: `LlmProvider ${this.llm.name()}.completeTurn (iteration ${scope.iteration})`,
      detailJson: {
        provider: this.llm.name(),
        iteration: scope.iteration,
        promptFingerprint: scope.prompt.fingerprint,
        // The SHAPE of what the model saw, not its contents: the contents are
        // already durable as ConversationTurn rows, and duplicating a whole
        // transcript into every audit event helps nobody.
        messageCount: request.messages.length,
        messageRoles: request.messages.map((message) => message.role),
        offeredTools: request.tools.map((tool) => tool.name),
      },
      occurredAt: scope.nowUtc,
    });

    return this.llm.completeTurn({
      systemPrompt: request.systemPrompt,
      messages: request.messages,
      tools: request.tools,
    });
  }

  private async recordDecision(
    scope: TurnScope & { iteration: number },
    completion: CompleteTurnResult,
  ): Promise<void> {
    await this.db.audit.record({
      type: 'AGENT_DECISION',
      organizationId: scope.conversation.organizationId,
      correlationId: scope.correlationId,
      conversationId: scope.conversation.id,
      contactId: scope.contact.id,
      subjectType: 'CONVERSATION',
      subjectId: scope.conversation.id,
      summary: summarizeDecision(completion, scope.iteration),
      detailJson: {
        iteration: scope.iteration,
        provider: this.llm.name(),
        assistantText: completion.assistantText,
        // The model's INTENT, recorded before any of it is validated. This and
        // the TOOL_CALL_* events that follow are what let a reader see the
        // difference between what was asked for and what was allowed.
        intendedToolCalls: completion.toolCalls.map((call) => ({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          rawArgumentsJson: call.argumentsJson,
        })),
        toolCallCount: completion.toolCalls.length,
      },
      occurredAt: scope.nowUtc,
    });
  }

  /**
   * The cap has been reached and the model still wants to act.
   *
   * Every outstanding call is refused individually - each gets its own
   * `TOOL_CALL_REQUESTED` and `TOOL_CALL_REJECTED` pair and its own TOOL turn -
   * so the transcript says exactly which actions did not happen, rather than
   * the turn simply stopping and leaving a reader to infer it.
   */
  private async refuseForIterationCap(
    scope: TurnScope,
    calls: readonly ToolCallRequest[],
    sink: ToolOutcome[],
  ): Promise<void> {
    for (const call of calls) {
      await this.conversations.appendToolCall(scope.conversation.id, call);

      const reason =
        `This turn reached its limit of ${this.maxIterations} tool rounds, so ${call.toolName} was not ` +
        'run and nothing was saved. Tell the contact plainly what is still outstanding, or hand over to a ' +
        'colleague.';

      await this.db.audit.record({
        type: 'TOOL_CALL_REQUESTED',
        organizationId: scope.conversation.organizationId,
        correlationId: scope.correlationId,
        conversationId: scope.conversation.id,
        contactId: scope.contact.id,
        toolCallId: call.toolCallId,
        subjectType: 'CONTACT',
        subjectId: scope.contact.id,
        summary: `Model proposed ${call.toolName}`,
        detailJson: { toolName: call.toolName, rawArgumentsJson: call.argumentsJson },
        occurredAt: scope.nowUtc,
      });

      await this.db.audit.record({
        type: 'TOOL_CALL_REJECTED',
        organizationId: scope.conversation.organizationId,
        correlationId: scope.correlationId,
        conversationId: scope.conversation.id,
        contactId: scope.contact.id,
        toolCallId: call.toolCallId,
        subjectType: 'CONVERSATION',
        subjectId: scope.conversation.id,
        summary: `Refused ${call.toolName}: POLICY_VIOLATION (tool-iteration cap of ${this.maxIterations} reached)`,
        detailJson: {
          code: ValidationErrorCode.POLICY_VIOLATION,
          reason,
          toolName: call.toolName,
          maxIterations: this.maxIterations,
          rawArgumentsJson: call.argumentsJson,
          domainRowsWritten: 0,
        },
        occurredAt: scope.nowUtc,
      });

      const outcome: ToolOutcome = {
        ok: false,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        code: ValidationErrorCode.POLICY_VIOLATION,
        reason,
        retryable: false,
      };
      sink.push(outcome);

      await this.conversations.appendToolResult(scope.conversation.id, {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        payload: toModelPayloadJson(outcome),
      });
    }

    await this.conversations.appendSystemNote(
      scope.conversation.id,
      `Turn ended: the tool-iteration cap of ${this.maxIterations} was reached. ` +
        `${calls.length} proposed call(s) were refused and nothing further was saved.`,
    );
  }
}

interface TurnScope {
  readonly conversation: Conversation;
  readonly contact: Contact;
  readonly correlationId: string;
  readonly nowUtc: IsoUtcString;
}

/**
 * `AgentConfiguration.allowedToolsJson` -> a list of names.
 *
 * A malformed column is a `ConfigurationError`, never an empty list: an agent
 * silently stripped of its tools would keep talking and quietly stop being able
 * to do anything, which is the worst of both outcomes.
 */
export function parseAllowedTools(configuration: AgentConfiguration): string[] {
  const parsed = parseJson<unknown>(configuration.allowedToolsJson, 'AgentConfiguration.allowedToolsJson');
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new ConfigurationError(
      `AgentConfiguration ${configuration.id} has an allowedToolsJson that is not an array of tool names.`,
      { details: { agentConfigurationId: configuration.id, allowedToolsJson: configuration.allowedToolsJson } },
    );
  }
  return parsed as string[];
}

function summarizeDecision(completion: CompleteTurnResult, iteration: number): string {
  const spoke = completion.assistantText ? `said "${truncate(completion.assistantText, 100)}"` : 'said nothing';
  if (completion.toolCalls.length === 0) {
    return `Iteration ${iteration}: model ${spoke} and requested no tools.`;
  }
  return (
    `Iteration ${iteration}: model ${spoke} and proposed ` +
    `${completion.toolCalls.map((call) => call.toolName).join(', ')}.`
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
