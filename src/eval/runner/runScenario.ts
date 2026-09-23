/**
 * One scenario, one model, through the REAL system.
 *
 * WHAT "THE REAL SYSTEM" MEANS HERE, PRECISELY
 * ---------------------------------------------------------------------------
 * `runtime.agent.handleTurn` - the production `AgentTurnService`. Which means
 * the production system prompt, the real nine tool JSON Schemas, the real
 * `ToolDispatcher` chokepoint, the real Zod validation, the real deterministic
 * datetime resolver, the real audit writes and the real `ConversationService`
 * message rebuild from database rows. The only substitutions are the ones the
 * product itself makes in its demo: a `FixedClock`, the deterministic provider
 * doubles, and a throwaway SQLite file.
 *
 * A benchmark that assembled its own prompt and called Ollama directly would
 * produce prettier numbers and prove nothing, because the thing being shipped
 * is the whole chain, not the model.
 *
 * FAILURE IS DATA
 * ---------------------------------------------------------------------------
 * A model that stalls, returns garbage, or throws produces a RECORDED failure
 * on that turn and the scenario continues. Nothing here may abort a run: the
 * comparison is only fair if a weak candidate gets to be weak on the record
 * rather than disappearing from the table.
 */
import { isStreamingLlmProvider, type LlmTurnMetrics } from '../../ports/llm.js';
import type { AgentRuntime } from '../../app/composition.js';
import type { LocalLlmProvider } from '../../llm/localLlmProvider.js';
import type { BenchmarkScenario } from '../corpus/schema.js';
import { CORPUS_VERSION } from '../corpus/index.js';
import { JUDGE_PROMPT_VERSION } from '../rubric/judgePrompt.js';
import { RUBRIC_VERSION } from '../rubric/rubric.js';
import {
  checkLanguage,
  checkPassthrough,
  checkRepetition,
  checkSchedulingIntent,
  checkText,
  checkToolCall,
  checkToolSelection,
  detectFabricatedTimestamps,
} from '../rubric/programmatic.js';
import type { RecordedToolCall, RecordedToolOutcome, ScenarioRun, TurnChecks, TurnRecord } from '../types.js';
import { foldTurnMetrics, MetricsCapturingProvider } from './metricsCapturingProvider.js';
import { prepareWorld } from './world.js';

/** Bump when the harness's own behaviour changes in a way that affects results. */
export const HARNESS_VERSION = '1.0.0';

export interface RunScenarioOptions {
  readonly runtime: AgentRuntime;
  /** The underlying local provider, for its cumulative tool-call statistics. */
  readonly provider: LocalLlmProvider;
  /** The wrapper the runtime was actually built with, for per-turn telemetry. */
  readonly meter: MetricsCapturingProvider;
  readonly modelId: string;
  readonly scenario: BenchmarkScenario;
  readonly worldSuffix: string;
  /** Pin the conversation to a specific prompt version. */
  readonly systemPromptRef?: string;
  /** Recorded in the result so every run says which context layer produced it. */
  readonly contextMode: 'baseline-v1' | 'assembled';
}

export async function runScenario(options: RunScenarioOptions): Promise<ScenarioRun> {
  const { runtime, provider, modelId, scenario } = options;
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();

  const prepared = await prepareWorld(runtime, scenario, options.worldSuffix, options.systemPromptRef);
  const knownMeetingIds = prepared.knownMeetingIds;

  const turns: TurnRecord[] = [];
  const contactUtterances: string[] = [
    // The replayed prior exchange counts as "things the contact said": a model
    // repeating a date from it is quoting, not fabricating.
    ...(scenario.world.priorConversation ?? []).filter((t) => t.role === 'CONTACT').map((t) => t.text),
  ];
  const earlierAssistantTexts: string[] = [];
  let sawError = false;

  for (const [index, turn] of scenario.turns.entries()) {
    contactUtterances.push(turn.utterance);
    const turnStarted = Date.now();
    options.meter.beginTurn();

    let assistantMessages: readonly string[] = [];
    let assistantText: string | null = null;
    let recordedCalls: RecordedToolCall[] = [];
    let recordedOutcomes: RecordedToolOutcome[] = [];
    let iterations = 0;
    let stopReason = 'ERROR';
    let error: string | null = null;

    try {
      const result = await runtime.agent.handleTurn({
        conversationId: prepared.conversationId,
        utterance: turn.utterance,
      });

      assistantMessages = result.assistantMessages;
      assistantText = result.assistantText;
      iterations = result.iterations;
      stopReason = result.stopReason;

      recordedOutcomes = result.toolOutcomes.map((outcome) => ({
        toolCallId: outcome.toolCallId,
        toolName: outcome.toolName,
        ok: outcome.ok,
        summary: outcome.ok ? outcome.summary : null,
        code: outcome.ok ? null : outcome.code,
        reason: outcome.ok ? null : outcome.reason,
        persisted: outcome.ok && outcome.persisted ? outcome.persisted : null,
      }));

      // Any meeting id the system has now SHOWN the model is legitimate for it
      // to use on a later turn. Collected from real tool results, so the
      // hallucination check stays honest as the conversation progresses.
      for (const outcome of result.toolOutcomes) {
        if (!outcome.ok) continue;
        if (outcome.persisted?.type?.toLowerCase().includes('meeting')) knownMeetingIds.add(outcome.persisted.id);
        const data = outcome.data as Record<string, unknown> | undefined;
        const direct = data?.['meeting_id'] ?? data?.['meetingId'];
        if (typeof direct === 'string') knownMeetingIds.add(direct);
        const list = data?.['meetings'];
        if (Array.isArray(list)) {
          for (const entry of list) {
            const id = (entry as Record<string, unknown> | null)?.['id'] ?? (entry as Record<string, unknown> | null)?.['meeting_id'];
            if (typeof id === 'string') knownMeetingIds.add(id);
          }
        }
      }

      // The proposed calls, read back from the durable transcript so the record
      // is what was PERSISTED rather than what a local variable remembered.
      recordedCalls = await readProposedCalls(runtime, prepared.conversationId, recordedOutcomes);
    } catch (thrown) {
      sawError = true;
      error = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
    }

    const turnLatencyMs = Date.now() - turnStarted;
    const capturedCalls = options.meter.calls();
    const providerCalls = capturedCalls.length;
    const metrics = foldTurnMetrics(capturedCalls);

    const checks = buildChecks({
      turn,
      scenario,
      assistantText,
      recordedCalls,
      recordedOutcomes,
      contactUtterancesSoFar: contactUtterances,
      earlierAssistantTexts,
      realContactId: prepared.world.contact.id,
      knownMeetingIds,
      metrics,
    });

    turns.push({
      index,
      utterance: turn.utterance,
      note: turn.note,
      assistantMessages: [...assistantMessages],
      assistantText,
      toolCalls: recordedCalls,
      toolOutcomes: recordedOutcomes,
      iterations,
      stopReason,
      metrics,
      turnLatencyMs,
      providerCalls,
      checks,
      error,
    });

    for (const message of assistantMessages) earlierAssistantTexts.push(message);
  }

  const stats = provider.stats();

  return {
    harnessVersion: HARNESS_VERSION,
    corpusVersion: CORPUS_VERSION,
    rubricVersion: RUBRIC_VERSION,
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    modelId,
    providerName: provider.name(),
    contextMode: options.contextMode,
    systemPromptRef: options.systemPromptRef ?? null,
    scenarioId: scenario.id,
    title: scenario.title,
    objective: scenario.objective,
    language: scenario.language,
    coverage: scenario.coverage,
    status: sawError ? (turns.some((t) => t.error === null) ? 'PARTIAL' : 'ERROR') : 'OK',
    error: turns.find((t) => t.error !== null)?.error ?? null,
    contactId: prepared.world.contact.id,
    conversationId: prepared.conversationId,
    nowUtc: scenario.world.nowUtc,
    priorConversation: (scenario.world.priorConversation ?? []).map((t) => ({ role: t.role, text: t.text })),
    turns,
    judges: {},
    startedAtIso,
    durationMs: Date.now() - startedAt,
    providerStats: {
      turns: stats.turns,
      nativeToolCalls: stats.nativeToolCalls,
      recoveredToolCalls: stats.recoveredToolCalls,
      malformedToolCalls: stats.malformedToolCalls,
      malformedRate: stats.malformedRate,
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * The proposed calls for this turn, read back from the durable ASSISTANT turns.
 *
 * `AgentTurnResult` exposes OUTCOMES, which have already been through the
 * dispatcher and no longer carry the raw arguments the model sent. The raw JSON
 * is exactly what this benchmark needs - it is where a fabricated timestamp or
 * an invented id lives - and `ConversationService` persists it verbatim on the
 * ASSISTANT turn's `rawPayloadJson`, which is where it is fetched from.
 */
async function readProposedCalls(
  runtime: AgentRuntime,
  conversationId: string,
  outcomes: readonly RecordedToolOutcome[],
): Promise<RecordedToolCall[]> {
  const wanted = new Set(outcomes.map((o) => o.toolCallId));
  if (wanted.size === 0) return [];

  const rows = await runtime.db.conversationTurns.listByConversation(conversationId);
  const calls: RecordedToolCall[] = [];

  for (const row of rows) {
    // AGENT rows carrying a toolCallId are the proposed calls; the matching
    // TOOL row holds the dispatcher's reply and must not be mistaken for one.
    if (row.role !== 'AGENT' || !row.toolCallId || !wanted.has(row.toolCallId)) continue;
    calls.push({
      toolCallId: row.toolCallId,
      toolName: row.toolName ?? '(unnamed)',
      argumentsJson: row.rawPayloadJson ?? '',
    });
  }

  // Fall back to the outcome list if the transcript shape ever surprises us, so
  // a missing row degrades the evidence rather than losing the turn.
  if (calls.length === 0) {
    return outcomes.map((o) => ({ toolCallId: o.toolCallId, toolName: o.toolName, argumentsJson: '' }));
  }
  return calls;
}

interface BuildChecksInput {
  readonly turn: BenchmarkScenario['turns'][number];
  readonly scenario: BenchmarkScenario;
  readonly assistantText: string | null;
  readonly recordedCalls: readonly RecordedToolCall[];
  readonly recordedOutcomes: readonly RecordedToolOutcome[];
  readonly contactUtterancesSoFar: readonly string[];
  readonly earlierAssistantTexts: readonly string[];
  readonly realContactId: string;
  readonly knownMeetingIds: ReadonlySet<string>;
  readonly metrics: LlmTurnMetrics | null;
}

function buildChecks(input: BuildChecksInput): TurnChecks {
  const calls = input.recordedCalls.map((c) => ({ toolName: c.toolName, argumentsJson: c.argumentsJson }));
  const calledTools = calls.map((c) => c.toolName);

  const selection = checkToolSelection(input.turn, calledTools);
  const failedOutcomes = input.recordedOutcomes.filter((o) => !o.ok);

  return {
    fabricatedTimestamps: detectFabricatedTimestamps(calls, input.contactUtterancesSoFar),
    toolSelection: {
      applicable: selection.applicable,
      passed: selection.passed,
      failures: selection.failures,
      assertionsChecked: selection.assertionsChecked,
      assertionsPassed: selection.assertionsPassed,
    },
    unnecessaryCalls: selection.unnecessaryCalls,
    toolCalls: input.recordedCalls.map((call) =>
      checkToolCall(
        { toolName: call.toolName, argumentsJson: call.argumentsJson },
        { realContactId: input.realContactId, knownMeetingIds: input.knownMeetingIds },
      ),
    ),
    passthrough: checkPassthrough(input.turn, calls),
    text: checkText(input.turn, input.assistantText, input.contactUtterancesSoFar),
    repetition: checkRepetition(input.assistantText, input.earlierAssistantTexts),
    language: checkLanguage(input.assistantText, input.turn.replyLanguage ?? input.scenario.language),
    schedulingIntent: checkSchedulingIntent(input.turn, calledTools, input.assistantText),
    toolFailure: {
      expected: input.turn.expectsToolFailure === true,
      occurred: failedOutcomes.length > 0,
      codes: failedOutcomes.map((o) => o.code ?? '(no code)'),
    },
  };
}

export { isStreamingLlmProvider };
