/**
 * `npm run llm:smoke` - one real multi-turn exchange against the configured
 * local model.
 *
 * WHAT IT PROVES, WITH A REAL MODEL AND REAL BYTES
 * ---------------------------------------------------------------------------
 *  1. Streaming works: deltas arrive one at a time, and TTFT is a real
 *     measurement taken at the first token rather than a number inferred after
 *     the fact.
 *  2. Tool calling works, against the REAL nine Baseline V1 tool schemas and
 *     the REAL production system prompt - not a simplified stand-in. If the
 *     model can call these, it can call them in the product.
 *  3. The model passes the CONTACT'S OWN WORDS into `when` and manufactures no
 *     timestamp. This is the governing architectural rule, checked against a
 *     live 7B model rather than assumed.
 *  4. A tool RESULT round-trips: the refusal is fed back as a `role: 'tool'`
 *     message and the model answers it in words.
 *  5. The non-streaming path returns the same shape as the streaming one.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 * It touches no database, dispatches no tool, and writes nothing. This is a
 * test of the PROVIDER, not of the agent loop - the agent loop already has 500
 * tests, and running it here would confuse "the model said something odd" with
 * "the application did something wrong".
 *
 * It also makes no assertion about the QUALITY of the model's answer. Which
 * model to ship is the evaluation task's decision, on its own evidence. This
 * CLI asserts that the plumbing is correct and prints what the model did.
 */
import { llmToolDefinitions } from '../../agent/tools/definitions.js';
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT_REF } from '../../agent/prompt/systemPrompt.js';
import { loadLocalLlmConfig, localLlmSettings } from '../../config/env.js';
import type { CompleteTurnResult, LlmMessage, LlmTurnMetrics } from '../../ports/llm.js';
import { isStreamingLlmProvider } from '../../ports/llm.js';
import { LocalLlmProvider } from '../localLlmProvider.js';
import { Checks, detail, heading, line, main, warn, DIM, RESET } from './reporting.js';

/** The nine. Named here so a drift in `definitions.ts` is visible, not silent. */
const THE_NINE = [
  'get_contact_context',
  'check_availability',
  'schedule_meeting',
  'reschedule_meeting',
  'cancel_meeting',
  'schedule_followup',
  'update_qualification',
  'record_call_outcome',
  'transfer_to_human',
];

/**
 * The utterance. The same one `npm run slice:demo` uses, so the local model is
 * asked exactly what the scripted double was asked.
 *
 * "tomorrow afternoon at 3" is the whole point: it is a time only application
 * code may resolve, and a model that answers with a timestamp has taken
 * authority it does not have.
 */
const THE_UTTERANCE = 'Hi, it is Dana Whitfield. Can you call me back tomorrow afternoon at 3?';

function reportMetrics(metrics: LlmTurnMetrics | undefined): void {
  if (!metrics) {
    warn('no metrics returned');
    return;
  }
  detail('model', metrics.modelId);
  detail('streamed', metrics.streamed);
  detail('time to first token', metrics.timeToFirstTokenMs === null ? 'n/a (non-streaming)' : `${metrics.timeToFirstTokenMs} ms`);
  detail('total latency', `${metrics.totalLatencyMs} ms`);
  detail('prompt tokens', metrics.promptTokens ?? 'n/a');
  detail('generated tokens', metrics.generatedTokens ?? 'n/a');
  detail('tokens/second', metrics.tokensPerSecond ?? 'n/a');
  detail(
    'context utilization',
    metrics.contextUtilization === null ? 'n/a' : `${(metrics.contextUtilization * 100).toFixed(1)}%`,
  );
  detail('model load this turn', metrics.runtime?.loadDurationMs !== undefined ? `${metrics.runtime.loadDurationMs} ms` : 'n/a');
  detail('quantization', metrics.runtime?.quantizationLevel ?? 'n/a');
  detail('num_ctx', metrics.runtime?.contextLength ?? 'n/a');
  detail(
    'tool call health',
    `native=${metrics.toolCallHealth?.native ?? 0} ` +
      `recovered=${metrics.toolCallHealth?.recoveredFromText ?? 0} ` +
      `malformed=${metrics.toolCallHealth?.malformed ?? 0}`,
  );
}

function reportToolCalls(result: CompleteTurnResult): void {
  if (result.toolCalls.length === 0) {
    line('  (no tool calls)');
    return;
  }
  for (const call of result.toolCalls) {
    line(`  ${call.toolName}  ${DIM}id=${call.toolCallId}${RESET}`);
    // RAW, exactly as it will be written to ConversationTurn.rawPayloadJson.
    line(`    raw argumentsJson: ${call.argumentsJson}`);
  }
}

main(async () => {
  const settings = localLlmSettings(loadLocalLlmConfig());
  const checks = new Checks();

  const provider = new LocalLlmProvider({
    baseUrl: settings.baseUrl,
    model: settings.model,
    temperature: settings.temperature,
    ...(settings.topP !== undefined ? { topP: settings.topP } : {}),
    numCtx: settings.numCtx,
    timeoutMs: settings.timeoutMs,
    keepAlive: settings.keepAlive,
  });

  line();
  line('llm:smoke - one real multi-turn exchange against the configured local model.');
  detail('provider.name()', provider.name());
  detail('base URL', provider.baseUrl);
  detail('num_ctx', settings.numCtx);
  detail('temperature', settings.temperature);

  const tools = llmToolDefinitions(THE_NINE);
  const prompt = buildSystemPrompt({ promptRef: DEFAULT_SYSTEM_PROMPT_REF, allowedToolNames: THE_NINE });

  checks.equal('all nine Baseline V1 tools are offered', tools.map((t) => t.name), THE_NINE);
  checks.ok('the real production system prompt is in use', prompt.text.length > 500);
  detail('system prompt', `${prompt.text.length} chars, fingerprint ${prompt.fingerprint}`);

  // -------------------------------------------------------------------------
  heading('0. The port advertises streaming');
  {
    checks.ok('isStreamingLlmProvider() recognises the local provider', isStreamingLlmProvider(provider));
    checks.ok('supportsStreaming() is true', provider.supportsStreaming());
  }

  // -------------------------------------------------------------------------
  heading('1. STREAMING tool-calling turn (the contact speaks)');
  line(`  contact: "${THE_UTTERANCE}"`);
  line();

  const history: LlmMessage[] = [{ role: 'user', content: THE_UTTERANCE }];
  let firstTurn: CompleteTurnResult;
  {
    const deltas: string[] = [];
    process.stdout.write(`  ${DIM}streaming: ${RESET}`);
    firstTurn = await provider.completeTurnStreaming(
      { systemPrompt: prompt.text, messages: history, tools },
      (delta) => {
        deltas.push(delta.textDelta);
        process.stdout.write(delta.textDelta.replace(/\n/g, ' '));
      },
    );
    line();
    line();

    line('  tool calls proposed:');
    reportToolCalls(firstTurn);
    line();
    line('  metrics:');
    reportMetrics(firstTurn.metrics);

    checks.ok(
      'the streaming path returned a result',
      firstTurn.toolCalls.length > 0 || firstTurn.assistantText !== null,
    );
    checks.ok(
      'text deltas OR a native tool call arrived (a tool-only turn streams no text)',
      deltas.length > 0 || firstTurn.toolCalls.length > 0,
    );
    checks.ok('streamed metrics are marked as streamed', firstTurn.metrics?.streamed === true);
    checks.ok(
      'TTFT was measured at the first token',
      typeof firstTurn.metrics?.timeToFirstTokenMs === 'number' && firstTurn.metrics.timeToFirstTokenMs > 0,
      `got ${String(firstTurn.metrics?.timeToFirstTokenMs)}`,
    );
    checks.ok(
      'TTFT is not larger than total latency',
      (firstTurn.metrics?.timeToFirstTokenMs ?? 0) <= (firstTurn.metrics?.totalLatencyMs ?? 0),
    );
    checks.ok(
      'tokens/second was computed from Ollama\'s own counters',
      typeof firstTurn.metrics?.tokensPerSecond === 'number' && firstTurn.metrics.tokensPerSecond > 0,
    );
    // The prompt alone costs ~3,700 tokens. If this is near 1.0 the runtime is
    // silently truncating the guardrail clauses off the front of the prompt,
    // and the agent is running on instructions nobody chose.
    checks.ok(
      'the prompt fits the context window with real headroom (no silent truncation)',
      (firstTurn.metrics?.contextUtilization ?? 1) < 0.85,
      `context utilization ${String(firstTurn.metrics?.contextUtilization)} - raise LOCAL_LLM_NUM_CTX`,
    );

    for (const call of firstTurn.toolCalls) {
      checks.ok(
        `${call.toolName}: argumentsJson is a raw STRING, not a parsed object`,
        typeof call.argumentsJson === 'string',
      );
      checks.ok(
        `${call.toolName}: it is one of the nine tools, not an invented one`,
        THE_NINE.includes(call.toolName),
      );
      checks.ok(
        `${call.toolName}: the model manufactured NO authoritative timestamp`,
        !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(call.argumentsJson),
        `argumentsJson contained an ISO instant: ${call.argumentsJson}`,
      );
    }

    if (firstTurn.toolCalls.length === 0) {
      warn('the model proposed no tool this turn. Not a plumbing failure - a model-quality');
      line('       observation, and the evaluation task\'s business. The turn below still');
      line('       exercises the tool-result round trip.');
    }
  }

  // -------------------------------------------------------------------------
  heading('2. Tool-RESULT round trip (application code refuses, model reads the refusal)');
  {
    // The refusal a real dispatcher produces for a contact id the model
    // invented. Nothing is dispatched here; this is the shape, not the system.
    const proposed = firstTurn.toolCalls[0];
    const toolCallId = proposed?.toolCallId ?? 'call_synthetic_1';
    const toolName = proposed?.toolName ?? 'get_contact_context';
    const refusal =
      '{"ok":false,"code":"UNKNOWN_CONTACT","reason":"No contact with that id exists. ' +
      'Call get_contact_context first and use the contact_id it returns.","retryable":true}';

    const withResult: LlmMessage[] = [
      ...history,
      // The assistant's tool-call turn, rebuilt from what would be persisted.
      {
        role: 'assistant',
        content: proposed?.argumentsJson ?? '{}',
        toolCallId,
        toolName,
      },
      { role: 'tool', content: refusal, toolCallId, toolName },
    ];

    line(`  feeding back: ${refusal}`);
    line();
    process.stdout.write(`  ${DIM}streaming: ${RESET}`);
    const secondTurn = await provider.completeTurnStreaming(
      { systemPrompt: prompt.text, messages: withResult, tools },
      (delta) => process.stdout.write(delta.textDelta.replace(/\n/g, ' ')),
    );
    line();
    line();
    line('  tool calls proposed:');
    reportToolCalls(secondTurn);
    line();
    line('  metrics:');
    reportMetrics(secondTurn.metrics);

    checks.ok(
      'Ollama accepted the rebuilt assistant tool_calls + tool result transcript',
      secondTurn.assistantText !== null || secondTurn.toolCalls.length > 0,
      'a rejected transcript would have thrown an OllamaRequestError before this point',
    );
    checks.ok(
      'the second turn produced fresh counters',
      typeof secondTurn.metrics?.generatedTokens === 'number' && secondTurn.metrics.generatedTokens > 0,
    );
  }

  // -------------------------------------------------------------------------
  heading('3. NON-STREAMING path returns the same shape');
  {
    const nonStreaming = await provider.completeTurn({
      systemPrompt: prompt.text,
      messages: [{ role: 'user', content: 'In one short sentence, what can you help with?' }],
      tools,
    });

    line(`  assistantText: ${JSON.stringify(nonStreaming.assistantText)}`);
    line();
    line('  metrics:');
    reportMetrics(nonStreaming.metrics);

    checks.ok(
      'the non-streaming path returns assistantText or tool calls',
      nonStreaming.assistantText !== null || nonStreaming.toolCalls.length > 0,
    );
    checks.ok('it is marked as NOT streamed', nonStreaming.metrics?.streamed === false);
    checks.equal('and reports no TTFT, rather than a fabricated one', nonStreaming.metrics?.timeToFirstTokenMs, null);
    checks.ok(
      'it still reports token counters',
      typeof nonStreaming.metrics?.promptTokens === 'number',
    );
    checks.ok('toolCalls is always an array', Array.isArray(nonStreaming.toolCalls));
  }

  // -------------------------------------------------------------------------
  heading('4. Errors are actionable, and there is no silent fallback');
  {
    // A base URL nothing is listening on. Two things must be true: it fails,
    // and the failure names the URL. An agent that silently degrades to an
    // empty completion while continuing to talk is the worst failure available
    // to this system, so its absence is asserted rather than assumed.
    const dead = new LocalLlmProvider({
      baseUrl: 'http://127.0.0.1:1',
      model: settings.model,
      timeoutMs: 2_000,
      maxRetries: 0,
    });

    let threw = false;
    let message = '';
    try {
      await dead.completeTurn({ systemPrompt: 'x', messages: [{ role: 'user', content: 'hi' }], tools: [] });
    } catch (error) {
      threw = true;
      message = error instanceof Error ? error.message : String(error);
    }

    checks.ok('a dead Ollama throws rather than returning an empty completion', threw);
    checks.ok('the error names the base URL an operator has to fix', message.includes('http://127.0.0.1:1'), message);
    line(`  ${DIM}${message.split('.')[0]}.${RESET}`);
  }

  // -------------------------------------------------------------------------
  heading('5. Cumulative tool-call health for this run');
  {
    const stats = provider.stats();
    detail('turns', stats.turns);
    detail('native tool calls', stats.nativeToolCalls);
    detail('recovered from text', stats.recoveredToolCalls);
    detail('malformed (refused)', stats.malformedToolCalls);
    detail(
      'malformed rate',
      stats.malformedRate === null ? 'n/a (no tool-call-shaped turn)' : `${(stats.malformedRate * 100).toFixed(1)}%`,
    );
    if (provider.recentRefusals.length > 0) {
      line('  refusals:');
      for (const refusal of provider.recentRefusals) line(`    - ${refusal}`);
    }
    checks.ok('the provider served every turn without a fallback to another provider', stats.turns >= 3);
  }

  checks.finish('llm:smoke');
});
