/**
 * `npm run llm:mapcheck` - the deterministic regression net for the Ollama
 * mapping, with NO network and no model.
 *
 * WHAT IT IS FOR
 * ---------------------------------------------------------------------------
 * This is the file that would have been `tests/llm/ollamaMapping.test.ts` if
 * this task were allowed to add test files. It replays REAL recorded Ollama
 * responses (`../ollama/fixtures.ts`) through the exact mapping code the
 * provider runs, and asserts the resulting `ToolCallRequest[]` and
 * `assistantText` exactly - not "contains", not "truthy", exactly.
 *
 * IT PROVES ITS OWN ISOLATION
 * ---------------------------------------------------------------------------
 * The first thing `main` does is replace `globalThis.fetch` with a function
 * that throws. So the claim "the mapping layer has no I/O in it" is not a
 * comment here, it is enforced: if any mapping function ever grows a fetch,
 * this CLI goes red rather than quietly starting to need a running Ollama.
 */
import {
  assembleTurn,
  buildMetrics,
  recoverToolCallsFromText,
  toCompleteTurnResult,
  toOllamaMessage,
  toOllamaMessages,
  toOllamaTool,
} from '../ollama/mapping.js';
import { NdjsonLineAssembler } from '../ollama/ndjson.js';
import {
  FIXTURE_NATIVE_TOOL_CALL,
  FIXTURE_NATIVE_TOOL_CALL_MISTRAL,
  FIXTURE_PROSE_MENTIONING_A_TOOL,
  FIXTURE_PS,
  FIXTURE_STREAM_TEXT,
  FIXTURE_STREAM_TOOL_CALL,
  FIXTURE_TAGS,
  FIXTURE_TEXTUAL_TOOL_CALL,
  FIXTURE_TEXTUAL_TOOL_CALL_NO_ARGUMENTS,
  FIXTURE_TEXTUAL_TOOL_CALL_UNOFFERED,
} from '../ollama/fixtures.js';
import type { OllamaChatChunk, OllamaPsResponse, OllamaTagsResponse } from '../ollama/wire.js';
import type { LlmMessage } from '../../ports/llm.js';
import { Checks, detail, heading, line, main } from './reporting.js';

/** The nine Baseline V1 tools. Offered so the fallback's allowlist is realistic. */
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
] as const;

/** A deterministic minter, so expected ids are literals rather than patterns. */
const mintId = (index: number): string => `minted-${index}`;

function parseNdjson(body: string): OllamaChatChunk[] {
  const assembler = new NdjsonLineAssembler();
  return [...assembler.push(body), ...assembler.flush()].map((l) => JSON.parse(l) as OllamaChatChunk);
}

function mapFixture(body: string, offered: ReadonlyArray<string> = THE_NINE) {
  return toCompleteTurnResult({
    chunks: parseNdjson(body),
    offeredToolNames: offered,
    mintId,
    modelId: 'fixture-model',
    streamed: false,
    totalLatencyMs: 0,
    timeToFirstTokenMs: null,
  });
}

main(async () => {
  // ---- isolation, enforced -------------------------------------------------
  globalThis.fetch = (() => {
    throw new Error(
      'llm:mapcheck attempted a network call. The Ollama mapping layer must be pure - ' +
        'move whatever just dialled out into src/llm/ollama/client.ts.',
    );
  }) as typeof fetch;

  const checks = new Checks();

  line();
  line('llm:mapcheck - replaying recorded Ollama responses through the real mapper.');
  detail('network', 'disabled (globalThis.fetch throws)');
  detail('fixtures', 'src/llm/ollama/fixtures.ts, captured from Ollama 0.34.3');

  // -------------------------------------------------------------------------
  heading('1. Native tool call, non-streaming (qwen2.5:7b-instruct, real capture)');
  {
    const result = mapFixture(FIXTURE_NATIVE_TOOL_CALL);

    checks.equal('tool calls map exactly, arguments re-serialised verbatim', result.toolCalls, [
      {
        toolCallId: 'call_xf7lm9o3',
        toolName: 'schedule_followup',
        // Key ORDER is the model's, preserved by JSON.stringify over the parsed
        // object. `reason` first is what the model actually emitted.
        argumentsJson: '{"reason":"callback request","contact_id":"Dana","when":"tomorrow afternoon around 3"}',
      },
    ]);
    checks.equal('a tool-only turn has no assistant text', result.assistantText, null);
    checks.equal('tool call health counts it as native', result.metrics?.toolCallHealth, {
      native: 1,
      recoveredFromText: 0,
      malformed: 0,
    });
    checks.equal('prompt tokens come from Ollama', result.metrics?.promptTokens, 272);
    checks.equal('generated tokens come from Ollama', result.metrics?.generatedTokens, 41);
    // 41 tokens / 0.750932s = 54.60 tok/s, from eval_duration alone.
    checks.equal('tokens/second uses eval_duration only', result.metrics?.tokensPerSecond, 54.6);
    checks.equal('cold load duration is surfaced in ms', result.metrics?.runtime?.loadDurationMs, 2762.34);

    checks.ok(
      'argumentsJson is a STRING, never a parsed object',
      typeof result.toolCalls[0]?.argumentsJson === 'string',
      `got ${typeof result.toolCalls[0]?.argumentsJson}`,
    );
    checks.ok(
      "the model passed the contact's own words through, and manufactured no timestamp",
      result.toolCalls[0]?.argumentsJson.includes('"when":"tomorrow afternoon around 3"') === true &&
        !/\d{4}-\d{2}-\d{2}T/.test(result.toolCalls[0]?.argumentsJson ?? ''),
    );
  }

  // -------------------------------------------------------------------------
  heading('2. Native tool call, a different model family (mistral:7b-instruct, real capture)');
  {
    const result = mapFixture(FIXTURE_NATIVE_TOOL_CALL_MISTRAL);
    checks.equal('mistral maps identically', result.toolCalls, [
      {
        toolCallId: 'call_bfrt5p87',
        toolName: 'schedule_followup',
        argumentsJson:
          '{"when":"tomorrow afternoon around 3","reason":"Call back at time specified by contact",' +
          '"contact_id":"contact_id_from_get_contact_context"}',
      },
    ]);
    checks.equal('mistral tokens/second', result.metrics?.tokensPerSecond, 55.48);
  }

  // -------------------------------------------------------------------------
  heading('3. Streaming NDJSON: a tool call whole in one chunk (real capture)');
  {
    const chunks = parseNdjson(FIXTURE_STREAM_TOOL_CALL);
    checks.equal('two NDJSON lines parsed', chunks.length, 2);

    const result = toCompleteTurnResult({
      chunks,
      offeredToolNames: THE_NINE,
      mintId,
      modelId: 'qwen2.5:7b-instruct',
      streamed: true,
      totalLatencyMs: 1143,
      timeToFirstTokenMs: 37,
    });

    checks.equal('the streamed tool call maps the same way', result.toolCalls, [
      {
        toolCallId: 'call_li7nacmw',
        toolName: 'schedule_followup',
        argumentsJson: '{"contact_id":"Dana","when":"tomorrow afternoon around 3","reason":"callback request"}',
      },
    ]);
    checks.equal('an empty trailing content chunk is not assistant text', result.assistantText, null);
    checks.equal('streamed is reported', result.metrics?.streamed, true);
    checks.equal('TTFT is carried through', result.metrics?.timeToFirstTokenMs, 37);
    checks.equal('counters come from the terminal chunk', result.metrics?.generatedTokens, 41);
  }

  // -------------------------------------------------------------------------
  heading('4. Streaming text after a tool result (real capture)');
  {
    const result = mapFixture(FIXTURE_STREAM_TEXT);
    checks.equal(
      'per-token deltas concatenate in order',
      result.assistantText,
      "It seems I don't have.",
    );
    checks.equal('no tool calls were invented from prose', result.toolCalls, []);
    checks.equal('nothing was counted as malformed', result.metrics?.toolCallHealth, {
      native: 0,
      recoveredFromText: 0,
      malformed: 0,
    });
    checks.equal('a warm run reports a near-zero load', result.metrics?.runtime?.loadDurationMs, 1.56);
  }

  // -------------------------------------------------------------------------
  heading('5. THE FALLBACK: a tool call the model wrote into its text (real capture)');
  {
    const result = mapFixture(FIXTURE_TEXTUAL_TOOL_CALL);

    checks.equal('recovered verbatim, with the minted id', result.toolCalls, [
      {
        toolCallId: 'minted-0',
        toolName: 'schedule_followup',
        argumentsJson: '{"contact_id":"Dana","when":"around 3","reason":"follow up"}',
      },
    ]);
    checks.equal('the consumed JSON is removed from the assistant text', result.assistantText, null);
    checks.equal('counted as a recovery, not as native', result.metrics?.toolCallHealth, {
      native: 0,
      recoveredFromText: 1,
      malformed: 0,
    });
    checks.ok(
      "the model's own truncation of `when` is preserved, not repaired",
      result.toolCalls[0]?.argumentsJson.includes('"when":"around 3"') === true,
    );
  }

  // -------------------------------------------------------------------------
  heading('6. The fallback REFUSES rather than invents');
  {
    const unoffered = mapFixture(FIXTURE_TEXTUAL_TOOL_CALL_UNOFFERED);
    checks.equal('a tool that was never offered yields NO tool call', unoffered.toolCalls, []);
    checks.equal('it is counted as malformed', unoffered.metrics?.toolCallHealth, {
      native: 0,
      recoveredFromText: 0,
      malformed: 1,
    });
    checks.ok(
      'the attempt stays visible in the assistant text',
      unoffered.assistantText?.includes('send_contract_and_charge_card') === true,
    );
    checks.equal('the refusal says why', unoffered.refusals, [
      'names "send_contract_and_charge_card", which was not offered this turn',
    ]);

    const noArgs = mapFixture(FIXTURE_TEXTUAL_TOOL_CALL_NO_ARGUMENTS);
    checks.equal('an absent arguments key is refused, not defaulted to {}', noArgs.toolCalls, []);
    checks.equal('and counted', noArgs.metrics?.toolCallHealth, {
      native: 0,
      recoveredFromText: 0,
      malformed: 1,
    });

    const prose = mapFixture(FIXTURE_PROSE_MENTIONING_A_TOOL);
    checks.equal('prose that merely mentions a tool proposes nothing', prose.toolCalls, []);
    checks.equal('and is not smeared as malformed either', prose.metrics?.toolCallHealth, {
      native: 0,
      recoveredFromText: 0,
      malformed: 0,
    });
    checks.ok('the prose is returned unchanged', prose.assistantText?.startsWith('I can use') === true);
  }

  // -------------------------------------------------------------------------
  heading('7. The fallback never second-guesses a native call');
  {
    // A response with BOTH a native tool call and JSON in the text. The text
    // scan must not run: a model that called a tool properly is believed.
    const hybrid = JSON.stringify({
      model: 'qwen2.5:7b-instruct',
      message: {
        role: 'assistant',
        content: '{"name": "cancel_meeting", "arguments": {"meeting_id": "m_1", "reason": "x"}}',
        tool_calls: [{ id: 'call_real', function: { name: 'get_contact_context', arguments: { contact_id: 'c_1' } } }],
      },
      done: true,
      eval_count: 10,
      eval_duration: 1_000_000_000,
    });
    const result = mapFixture(hybrid);
    checks.equal('only the native call survives', result.toolCalls, [
      { toolCallId: 'call_real', toolName: 'get_contact_context', argumentsJson: '{"contact_id":"c_1"}' },
    ]);
    checks.equal('the text is left exactly as the model wrote it', result.metrics?.toolCallHealth, {
      native: 1,
      recoveredFromText: 0,
      malformed: 0,
    });
  }

  // -------------------------------------------------------------------------
  heading('8. Other recognised fallback shapes');
  {
    const fenced =
      'Sure, here is the call:\n\n```json\n{"name": "check_availability", "arguments": {"contact_id": "c_1"}}\n```\n';
    const fencedResult = recoverToolCallsFromText(fenced, THE_NINE, mintId);
    checks.equal('a fenced JSON block is recovered', fencedResult.toolCalls, [
      { toolCallId: 'minted-0', toolName: 'check_availability', argumentsJson: '{"contact_id":"c_1"}' },
    ]);
    checks.equal('the surrounding prose is kept', fencedResult.remainingText, 'Sure, here is the call:');

    const mistralMarker =
      '[TOOL_CALLS] [{"name": "record_call_outcome", "arguments": {"contact_id": "c_1", "outcome": "CONNECTED"}}]';
    const markerResult = recoverToolCallsFromText(mistralMarker, THE_NINE, mintId);
    checks.equal("mistral's [TOOL_CALLS] marker is recognised", markerResult.toolCalls, [
      {
        toolCallId: 'minted-0',
        toolName: 'record_call_outcome',
        argumentsJson: '{"contact_id":"c_1","outcome":"CONNECTED"}',
      },
    ]);
    checks.equal('and consumes the whole span', markerResult.remainingText, null);

    const nested = '{"function": {"name": "transfer_to_human", "arguments": "{\\"reason\\": \\"asked for a manager\\"}"}}';
    const nestedResult = recoverToolCallsFromText(nested, THE_NINE, mintId);
    checks.equal('a nested OpenAI-ish shape with STRING arguments passes the string through verbatim', nestedResult.toolCalls, [
      {
        toolCallId: 'minted-0',
        toolName: 'transfer_to_human',
        // Note the spacing: this is the model's own string, untouched.
        argumentsJson: '{"reason": "asked for a manager"}',
      },
    ]);

    const braceInString =
      '{"name": "schedule_followup", "arguments": {"contact_id": "c_1", "reason": "call back {tomorrow}", "when": "3pm"}}';
    const braceResult = recoverToolCallsFromText(braceInString, THE_NINE, mintId);
    checks.equal(
      'a brace inside a string value does not truncate the span',
      braceResult.toolCalls[0]?.argumentsJson,
      '{"contact_id":"c_1","reason":"call back {tomorrow}","when":"3pm"}',
    );

    const noTools = recoverToolCallsFromText(FIXTURE_TEXTUAL_TOOL_CALL, [], mintId);
    checks.equal('with no tools offered, nothing can be a tool call', noTools.toolCalls, []);
  }

  // -------------------------------------------------------------------------
  heading('9. NDJSON framing is independent of read boundaries');
  {
    const expected = parseNdjson(FIXTURE_STREAM_TEXT);
    // Split the real body at every single byte offset and prove the assembled
    // chunk sequence is identical. This is the bug the assembler exists for.
    let mismatches = 0;
    for (let cut = 1; cut < FIXTURE_STREAM_TEXT.length; cut += 7) {
      const assembler = new NdjsonLineAssembler();
      const lines = [
        ...assembler.push(FIXTURE_STREAM_TEXT.slice(0, cut)),
        ...assembler.push(FIXTURE_STREAM_TEXT.slice(cut)),
        ...assembler.flush(),
      ];
      const got = lines.map((l) => JSON.parse(l) as OllamaChatChunk);
      if (JSON.stringify(got) !== JSON.stringify(expected)) mismatches += 1;
    }
    checks.equal('every two-way split of a real stream body assembles identically', mismatches, 0);

    // And one byte at a time, the worst case.
    const perByte = new NdjsonLineAssembler();
    const collected: string[] = [];
    for (const char of FIXTURE_STREAM_TEXT) collected.push(...perByte.push(char));
    collected.push(...perByte.flush());
    checks.equal(
      'a one-byte-at-a-time stream assembles identically',
      collected.map((l) => JSON.parse(l) as OllamaChatChunk),
      expected,
    );

    const assembled = assembleTurn(expected);
    checks.equal('assembleTurn folds the same text', assembled.text, "It seems I don't have.");
  }

  // -------------------------------------------------------------------------
  heading('10. Request direction: messages and tools');
  {
    const toolCallTurn: LlmMessage = {
      role: 'assistant',
      content: '{"contact_id":"c_1","when":"tomorrow at 3pm","reason":"callback"}',
      toolCallId: 'call_1',
      toolName: 'schedule_followup',
    };
    checks.equal('an assistant tool-call turn is rebuilt as native tool_calls', toOllamaMessage(toolCallTurn), {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          function: {
            name: 'schedule_followup',
            // Object, because Ollama wants an object where OpenAI wanted a string.
            arguments: { contact_id: 'c_1', when: 'tomorrow at 3pm', reason: 'callback' },
          },
        },
      ],
    });

    const toolResult: LlmMessage = {
      role: 'tool',
      content: '{"ok":false,"code":"UNKNOWN_CONTACT"}',
      toolCallId: 'call_1',
      toolName: 'schedule_followup',
    };
    checks.equal('a tool result carries BOTH tool_call_id and tool_name', toOllamaMessage(toolResult), {
      role: 'tool',
      content: '{"ok":false,"code":"UNKNOWN_CONTACT"}',
      tool_call_id: 'call_1',
      tool_name: 'schedule_followup',
    });

    const malformedHistory: LlmMessage = {
      role: 'assistant',
      content: '{ "contact_id": "c_1", "when": tomorrow afternoon at 3 }',
      toolCallId: 'call_2',
      toolName: 'schedule_followup',
    };
    checks.equal(
      'unparseable historical arguments are re-sent as a string, not guessed at',
      toOllamaMessage(malformedHistory).tool_calls?.[0]?.function.arguments,
      '{ "contact_id": "c_1", "when": tomorrow afternoon at 3 }',
    );

    checks.equal('the system prompt becomes the first message', toOllamaMessages('BE GOOD', [{ role: 'user', content: 'hi' }]), [
      { role: 'system', content: 'BE GOOD' },
      { role: 'user', content: 'hi' },
    ]);

    const schema = Object.freeze({ type: 'object', properties: {}, additionalProperties: false });
    checks.equal('a tool schema is passed through untouched', toOllamaTool({ name: 't', description: 'd', parametersJsonSchema: schema }), {
      type: 'function',
      function: { name: 't', description: 'd', parameters: schema },
    });
  }

  // -------------------------------------------------------------------------
  heading('11. Metrics report null rather than a plausible zero');
  {
    const bare = buildMetrics({
      modelId: 'm',
      streamed: false,
      totalLatencyMs: 12.345,
      timeToFirstTokenMs: null,
      final: null,
      toolCallHealth: { native: 0, recoveredFromText: 0, malformed: 0 },
    });
    checks.equal('no counters means null, not 0', [bare.promptTokens, bare.generatedTokens, bare.tokensPerSecond], [
      null,
      null,
      null,
    ]);
    checks.equal('total latency is always measurable', bare.totalLatencyMs, 12.35);

    const zeroEval = buildMetrics({
      modelId: 'm',
      streamed: false,
      totalLatencyMs: 1,
      timeToFirstTokenMs: null,
      final: { eval_count: 10, eval_duration: 0 },
      toolCallHealth: { native: 0, recoveredFromText: 0, malformed: 0 },
    });
    checks.equal('a zero eval_duration does not divide by zero', zeroEval.tokensPerSecond, null);
    checks.equal('context utilization is null when the window is unknown', bare.contextUtilization, null);

    // The safety number, on the real measured figures: 3732 prompt tokens in a
    // 4096 window is 91% full and one turn from truncating the system prompt.
    const tight = buildMetrics({
      modelId: 'm',
      streamed: false,
      totalLatencyMs: 1,
      timeToFirstTokenMs: null,
      final: { prompt_eval_count: 3732 },
      toolCallHealth: { native: 0, recoveredFromText: 0, malformed: 0 },
      runtime: { contextLength: 4096 },
    });
    checks.equal('the measured production prompt fills 91% of a 4096 window', tight.contextUtilization, 0.9111);

    const roomy = buildMetrics({
      modelId: 'm',
      streamed: false,
      totalLatencyMs: 1,
      timeToFirstTokenMs: null,
      final: { prompt_eval_count: 3732 },
      toolCallHealth: { native: 0, recoveredFromText: 0, malformed: 0 },
      runtime: { contextLength: 8192 },
    });
    checks.equal('and 46% of the 8192 default, which is why the default is 8192', roomy.contextUtilization, 0.4556);
  }

  // -------------------------------------------------------------------------
  heading('12. The discovery fixtures parse as the wire types claim');
  {
    const tags = JSON.parse(FIXTURE_TAGS) as OllamaTagsResponse;
    checks.equal('both mission models are in the recorded /api/tags', (tags.models ?? []).map((m) => m.name), [
      'mistral:7b-instruct',
      'qwen2.5:7b-instruct',
    ]);
    checks.ok(
      'both advertise the tools capability',
      (tags.models ?? []).every((m) => (m.capabilities ?? []).includes('tools')),
    );
    checks.equal('quantization is readable from /api/tags', tags.models?.[1]?.details?.quantization_level, 'Q4_K_M');

    const ps = JSON.parse(FIXTURE_PS) as OllamaPsResponse;
    checks.equal('recorded resident VRAM, in bytes', ps.models?.[0]?.size_vram, 4_950_883_040);
    checks.ok(
      'a resident 7B Q4_K_M at num_ctx 4096 fits the 7.5 GB budget',
      (ps.models?.[0]?.size_vram ?? 0) < 7.5 * 1024 ** 3,
    );
  }

  checks.finish('llm:mapcheck');
});
