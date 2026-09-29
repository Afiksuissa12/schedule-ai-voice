/**
 * `LocalLlmProvider` - the language model, running on this machine.
 *
 * WHAT CHANGES, AND WHAT EMPHATICALLY DOES NOT
 * ---------------------------------------------------------------------------
 * What changes is where the words come from: a model served by Ollama on the
 * operator's own hardware instead of a vendor's API. What does not change is
 * ANY of the authority. This class implements the same `LlmProvider` port as
 * `ScriptedLlmProvider` and `OpenAiLlmProvider`, returns the same
 * `CompleteTurnResult`, and hands `argumentsJson` back as a raw, unparsed,
 * untrusted string. `ToolDispatcher` remains the only thing that decides
 * anything.
 *
 * In particular this file has no `Date`, no timezone, no clock and no database
 * import, and it must never acquire one. A local model is no more entitled to
 * resolve "tomorrow afternoon" into an instant than a hosted one is; it passes
 * the contact's words into `schedule_followup` and application code resolves
 * and validates them. The demo transcript in `LOCAL_PROVIDER.md` shows a real
 * 7B model doing exactly that, and shows the dispatcher rejecting the contact
 * id it invented in the same breath.
 *
 * NO SDK, NO HTTP CLIENT
 * ---------------------------------------------------------------------------
 * Global `fetch` against Ollama's native API - see `./ollama/client.ts` for why
 * that is a constraint of this repository and also the right call.
 *
 * INERT ON IMPORT, EXPLICIT TO CONSTRUCT
 * ---------------------------------------------------------------------------
 * Importing this module dials nothing. Constructing this class dials nothing.
 * The first byte leaves the process on the first `completeTurn`. That is what
 * lets `npm run qa:sweep` keep reporting zero network attempts while this file
 * sits in the same source tree, and it is why `buildAgentRuntime`'s default is
 * still `ScriptedLlmProvider`.
 *
 * NO AUTOMATIC FALLBACK
 * ---------------------------------------------------------------------------
 * A dead Ollama raises a typed error naming the base URL. It does NOT quietly
 * become a scripted provider, and it does NOT return an empty completion. An
 * agent that silently stops being able to think, while continuing to talk, is
 * the single worst failure mode available to this system.
 */
import type {
  CompleteTurnRequest,
  CompleteTurnResult,
  LlmProvider,
  LlmRuntimeDetail,
  LlmStreamHandler,
  LlmToolCallHealth,
} from '../ports/llm.js';
import { ConfigurationError } from '../shared/errors.js';
import { OllamaClient, type OllamaClientOptions } from './ollama/client.js';
import { toCompleteTurnResult, toOllamaChatRequest } from './ollama/mapping.js';
import type { OllamaChatChunk, OllamaChatRequest, OllamaShowResponse } from './ollama/wire.js';

/**
 * Default base URL: the host's Ollama as seen from inside a container.
 *
 * `localhost` inside a container is the container, which is the single most
 * common way this is misconfigured. `host.docker.internal` is correct in this
 * project's environment and is overridable for every other one.
 */
export const DEFAULT_LOCAL_LLM_BASE_URL = 'http://host.docker.internal:11434';

/**
 * Default model.
 *
 * `qwen2.5:7b-instruct` at Q4_K_M is ~4.7 GB on disk and ~5.0 GB resident with
 * a 4k context, which fits the 8 GB budget of the measured RTX 4060 Laptop with
 * room for the KV cache, and it advertises the `tools` capability. The model
 * SELECTION decision is the evaluation task's, not this file's - this is a
 * default that lets the provider be developed and demonstrated, and it is
 * overridable without a code change.
 */
export const DEFAULT_LOCAL_LLM_MODEL = 'qwen2.5:7b-instruct';

/**
 * Deliberately generous. A cold 7B load on this hardware was measured at
 * ~2.8-3.8s before the first token, on top of generation time. A tight default
 * would turn a cold start into a spurious failure.
 */
export const DEFAULT_LOCAL_LLM_TIMEOUT_MS = 120_000;

/** Zero. The agent follows a guardrailed procedure; it is not being creative. */
export const DEFAULT_LOCAL_LLM_TEMPERATURE = 0;

/**
 * 8192 tokens, and this number was MEASURED rather than guessed.
 *
 * A real turn - the production system prompt plus all nine tool schemas plus a
 * one-sentence utterance - costs **3,732 prompt tokens** (`npm run llm:smoke`,
 * 2026-09-23). The obvious 4096 default leaves 364 tokens for the entire
 * conversation, which a second turn exhausts.
 *
 * That matters more than it looks, because Ollama does not error on an
 * over-long prompt and does not report one: it SILENTLY DROPS whole older
 * MESSAGES. Measured against Ollama 0.34.3 with a canary system prompt
 * ("answer with exactly ZANZIBAR-7") and an oversized filler message: at
 * `num_ctx` 2048 the filler's ~6,200 tokens vanished entirely,
 * `prompt_eval_count` fell from 5,555 to 49, and the model still answered
 * ZANZIBAR-7. So the guardrail clauses SURVIVE - the earlier claim that
 * truncation strips the system prompt was wrong - and what is lost instead is
 * the conversation history, in silence, with `prompt_eval_count` reporting the
 * post-drop figure so the turn looks like it fitted. A model that has quietly
 * forgotten what the contact said two turns ago, still talking confidently, is
 * the failure this milestone's memory layer exists to prevent - so the default
 * has to have real headroom.
 *
 * Measured cost of that headroom on the mission host (RTX 4060 Laptop, 8188
 * MiB), `qwen2.5:7b-instruct` Q4_K_M resident, from `/api/ps`:
 *
 *     num_ctx  4096 -> 4.42 GiB VRAM
 *     num_ctx  8192 -> 4.64 GiB VRAM   <- this default
 *     num_ctx 16384 -> 5.09 GiB VRAM
 *
 * 8192 buys ~4.4k tokens of transcript for 0.22 GiB, and leaves roughly 2.9 GiB
 * of the 7.5 GiB budget spare - enough that the evaluation task can try an 8B
 * model without re-tuning this. 16384 is affordable too and is the right choice
 * for a long call; it is one environment variable away.
 */
export const DEFAULT_LOCAL_LLM_NUM_CTX = 8192;

/** Keep the model resident between turns; reloading costs seconds. */
export const DEFAULT_LOCAL_LLM_KEEP_ALIVE = '5m';

/**
 * No seed unless a caller asks for one, and the omission is deliberate.
 *
 * Sending a fixed seed on every conversational turn would make the agent repeat
 * itself across calls in a way nobody asked for, and Ollama's own default
 * (a fresh seed per request) is the right behaviour for natural dialogue. The one
 * caller that needs a pinned seed is the semantic claim verifier, and it asks per
 * request through `CompleteTurnRequest.determinism`.
 *
 * `null` rather than `undefined` so "no seed configured" is a value this file
 * states rather than a field a reader has to notice is missing.
 */
export const DEFAULT_LOCAL_LLM_SEED: number | null = null;

export interface LocalLlmProviderOptions {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly topP?: number;
  /** Context window. Sent as Ollama's `num_ctx`. */
  readonly numCtx?: number;
  /** Cap on generated tokens. Sent as Ollama's `num_predict`. Unset means the model's default. */
  readonly maxOutputTokens?: number;
  /**
   * A fixed RNG seed for EVERY request this provider makes. Sent as Ollama's
   * `options.seed`.
   *
   * Unset is the default and is right for conversation - see
   * `DEFAULT_LOCAL_LLM_SEED`. A per-request `CompleteTurnRequest.determinism.seed`
   * overrides this one, so a provider shared between the agent and the semantic
   * verifier can be unseeded for the first and seeded for the second.
   */
  readonly seed?: number;
  /** How long Ollama keeps the model resident after a request, e.g. `5m`, `0`. */
  readonly keepAlive?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryBackoffMs?: number;
  /**
   * Use the streaming path for plain `completeTurn` as well.
   *
   * Off by default: identical results, but streaming adds a per-chunk parse for
   * no benefit when nobody is listening to the deltas. Turning it on is how you
   * get a `timeToFirstTokenMs` out of an ordinary turn.
   */
  readonly streamByDefault?: boolean;
  /** Injectable transport. Exists so a CLI can share one client; never for faking a model. */
  readonly client?: OllamaClient;
}

/** Cumulative counters across every turn this instance has served. */
export interface LocalLlmProviderStats {
  readonly turns: number;
  readonly nativeToolCalls: number;
  readonly recoveredToolCalls: number;
  readonly malformedToolCalls: number;
  /**
   * `malformed / (native + recovered + malformed)`, or null before the first
   * tool-call-shaped turn. This is the malformed-tool-call rate the evaluation
   * task reports per model.
   */
  readonly malformedRate: number | null;
}

export class LocalLlmProvider implements LlmProvider {
  private readonly client: OllamaClient;
  private readonly model: string;
  private readonly temperature: number;
  private readonly topP: number | undefined;
  private readonly numCtx: number;
  private readonly maxOutputTokens: number | undefined;
  private readonly keepAlive: string;
  private readonly streamByDefault: boolean;
  private readonly seed: number | undefined;

  /**
   * Runtime detail from `/api/show`, fetched lazily on the first turn and then
   * cached. Lazily, because fetching it in the constructor would make
   * construction reach the network - and the whole safety story of this file is
   * that it does not.
   */
  private runtime: LlmRuntimeDetail | undefined;
  private runtimeProbed = false;

  private turnCounter = 0;
  private toolCallCounter = 0;
  private totals = { turns: 0, native: 0, recovered: 0, malformed: 0 };

  /**
   * Refusals from the text fallback, newest last, capped. Kept in memory for
   * the operator CLIs; nothing in the application reads it, and it is
   * deliberately not persisted - the AGENT_DECISION audit event already records
   * what the model said.
   */
  readonly recentRefusals: string[] = [];

  constructor(options: LocalLlmProviderOptions = {}) {
    const baseUrl = (options.baseUrl ?? DEFAULT_LOCAL_LLM_BASE_URL).trim();
    if (baseUrl.length === 0) {
      throw new ConfigurationError(
        'LocalLlmProvider requires a base URL. Set LOCAL_LLM_BASE_URL, or leave it unset to use ' +
          `${DEFAULT_LOCAL_LLM_BASE_URL}.`,
      );
    }
    assertHttpUrl(baseUrl);

    const model = (options.model ?? DEFAULT_LOCAL_LLM_MODEL).trim();
    if (model.length === 0) {
      throw new ConfigurationError(
        'LocalLlmProvider requires a model name. Set LOCAL_LLM_MODEL to a tag present on the Ollama ' +
          'host - run `npm run llm:probe` to list them.',
      );
    }

    const clientOptions: OllamaClientOptions = {
      baseUrl,
      timeoutMs: options.timeoutMs ?? DEFAULT_LOCAL_LLM_TIMEOUT_MS,
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      ...(options.retryBackoffMs !== undefined ? { retryBackoffMs: options.retryBackoffMs } : {}),
    };

    this.client = options.client ?? new OllamaClient(clientOptions);
    this.model = model;
    this.temperature = options.temperature ?? DEFAULT_LOCAL_LLM_TEMPERATURE;
    this.topP = options.topP;
    this.numCtx = options.numCtx ?? DEFAULT_LOCAL_LLM_NUM_CTX;
    this.maxOutputTokens = options.maxOutputTokens;
    this.keepAlive = options.keepAlive ?? DEFAULT_LOCAL_LLM_KEEP_ALIVE;
    this.streamByDefault = options.streamByDefault ?? false;
    this.seed = options.seed ?? DEFAULT_LOCAL_LLM_SEED ?? undefined;
  }

  /**
   * `local-ollama:<model>`.
   *
   * Recorded on every `PROVIDER_INVOKED` and `AGENT_DECISION` audit event. The
   * model tag is part of the identity on purpose: "which model said that" is a
   * question an auditor will ask, and a provider name of `local` could not
   * answer it.
   */
  name(): string {
    return `local-ollama:${this.model}`;
  }

  /** The base URL this provider will dial. Surfaced for error messages and CLIs. */
  get baseUrl(): string {
    return this.client.baseUrl;
  }

  get modelId(): string {
    return this.model;
  }

  supportsStreaming(): boolean {
    return true;
  }

  /**
   * Yes: Ollama's `/api/chat` takes a JSON Schema in `format` and a seed in
   * `options.seed`, and `buildRequest` below puts them there.
   *
   * WHAT THIS DOES AND DOES NOT ASSERT. It asserts that the constraint REACHES
   * the runtime - which is a property of this file and is tested on the request
   * body. It does not assert that the runtime always obeys it: constrained
   * decoding is a sampler-level guarantee about token choice, not a proof about
   * the finished document, and a caller must still validate. The semantic claim
   * verifier does, and treats a validation failure as UNSUPPORTED.
   */
  supportsStructuredOutput(): boolean {
    return true;
  }

  async completeTurn(req: CompleteTurnRequest): Promise<CompleteTurnResult> {
    if (this.streamByDefault) {
      return this.completeTurnStreaming(req, () => undefined);
    }

    const started = performance.now();
    const chunks = await this.client.chat(this.buildRequest(req, false));
    return this.finish(req, chunks, {
      started,
      timeToFirstTokenMs: null,
      streamed: false,
    });
  }

  /**
   * The streaming path.
   *
   * TTFT is stamped on the first chunk that carries actual text or a tool call,
   * not merely on the first chunk to arrive - a leading empty-content chunk is
   * framing, and counting it would flatter the number.
   *
   * The result is assembled by the SAME function the non-streaming path uses,
   * so the two cannot drift apart in what they report the model said.
   */
  async completeTurnStreaming(
    req: CompleteTurnRequest,
    onDelta: LlmStreamHandler,
  ): Promise<CompleteTurnResult> {
    const started = performance.now();
    const chunks: OllamaChatChunk[] = [];
    let timeToFirstTokenMs: number | null = null;
    let deltaIndex = 0;

    await this.client.chatStream(this.buildRequest(req, true), (chunk) => {
      chunks.push(chunk);

      const text = chunk.message?.content ?? '';
      const hasToolCall = (chunk.message?.tool_calls?.length ?? 0) > 0;
      if (timeToFirstTokenMs === null && (text.length > 0 || hasToolCall)) {
        timeToFirstTokenMs = round2(performance.now() - started);
      }

      if (text.length > 0) {
        onDelta({ textDelta: text, index: deltaIndex, elapsedMs: round2(performance.now() - started) });
        deltaIndex += 1;
      }
    });

    return this.finish(req, chunks, { started, timeToFirstTokenMs, streamed: true });
  }

  /** Cumulative tool-call health for this instance. Read by `llm:smoke` and the eval harness. */
  stats(): LocalLlmProviderStats {
    const attempted = this.totals.native + this.totals.recovered + this.totals.malformed;
    return {
      turns: this.totals.turns,
      nativeToolCalls: this.totals.native,
      recoveredToolCalls: this.totals.recovered,
      malformedToolCalls: this.totals.malformed,
      malformedRate: attempted > 0 ? this.totals.malformed / attempted : null,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * Resolve this provider's configuration against the caller's per-request
   * asks, and hand the result to the pure mapper.
   *
   * THE PRECEDENCE IS THE REQUEST, AND IT IS ONE-WAY. A request that says
   * nothing gets exactly the configured behaviour, which is what keeps every
   * call site that existed before Mission 2F byte-identical - no `format` key,
   * no `seed` key, same `options`. A request that DOES ask pins that one turn
   * and nothing else: there is no way for a caller to change this provider's
   * configuration, only to override it for the request in its hand.
   */
  private buildRequest(req: CompleteTurnRequest, stream: boolean): OllamaChatRequest {
    const seed = req.determinism?.seed ?? this.seed;
    return toOllamaChatRequest({
      model: this.model,
      systemPrompt: req.systemPrompt,
      messages: req.messages,
      tools: req.tools,
      stream,
      keepAlive: this.keepAlive,
      temperature: req.determinism?.temperature ?? this.temperature,
      numCtx: this.numCtx,
      topP: this.topP,
      maxOutputTokens: this.maxOutputTokens,
      seed,
      ...(req.responseJsonSchema !== undefined ? { responseJsonSchema: req.responseJsonSchema } : {}),
    });
  }

  private async finish(
    req: CompleteTurnRequest,
    chunks: OllamaChatChunk[],
    timing: { started: number; timeToFirstTokenMs: number | null; streamed: boolean },
  ): Promise<CompleteTurnResult> {
    this.turnCounter += 1;
    const turn = this.turnCounter;
    const runtime = await this.describeRuntime();

    const result = toCompleteTurnResult({
      chunks,
      offeredToolNames: req.tools.map((tool) => tool.name),
      // Ollama issues its own ids (`call_xf7lm9o3`) and those are preferred.
      // This is the mint for a build that does not, and it is scoped by turn so
      // two calls in one conversation can never collide.
      mintId: () => {
        this.toolCallCounter += 1;
        return `local-call-${turn}-${this.toolCallCounter}`;
      },
      modelId: this.model,
      streamed: timing.streamed,
      totalLatencyMs: performance.now() - timing.started,
      timeToFirstTokenMs: timing.timeToFirstTokenMs,
      ...(runtime ? { runtime: { ...runtime, contextLength: this.numCtx } } : { runtime: { contextLength: this.numCtx } }),
    });

    this.accumulate(result.metrics?.toolCallHealth, result.refusals);

    // `refusals` is a diagnostic channel for the CLIs, not part of the port.
    // Stripped here so what leaves this class is exactly a `CompleteTurnResult`.
    return {
      assistantText: result.assistantText,
      toolCalls: result.toolCalls,
      ...(result.metrics ? { metrics: result.metrics } : {}),
    };
  }

  private accumulate(health: LlmToolCallHealth | undefined, refusals: ReadonlyArray<string>): void {
    this.totals.turns += 1;
    if (health) {
      this.totals.native += health.native;
      this.totals.recovered += health.recoveredFromText;
      this.totals.malformed += health.malformed;
    }
    for (const refusal of refusals) {
      this.recentRefusals.push(refusal);
    }
    while (this.recentRefusals.length > 50) this.recentRefusals.shift();
  }

  /**
   * Quantization and family, from `/api/show`, once.
   *
   * Best-effort on purpose: a turn that produced a perfectly good answer must
   * not fail because a metadata endpoint did not. A failure here just means the
   * metrics carry less runtime detail, and it is not retried.
   */
  private async describeRuntime(): Promise<LlmRuntimeDetail | undefined> {
    if (this.runtimeProbed) return this.runtime;
    this.runtimeProbed = true;
    try {
      const shown = await this.client.postJson<OllamaShowResponse>('/api/show', { model: this.model });
      const details = shown.details;
      this.runtime = {
        ...(details?.quantization_level ? { quantizationLevel: details.quantization_level } : {}),
        ...(details?.parameter_size ? { parameterSize: details.parameter_size } : {}),
        ...(details?.family ? { family: details.family } : {}),
      };
    } catch {
      this.runtime = undefined;
    }
    return this.runtime;
  }
}

function assertHttpUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError(
      `LOCAL_LLM_BASE_URL is not a valid URL: "${value}". Expected something like ` +
        `${DEFAULT_LOCAL_LLM_BASE_URL}.`,
      { details: { baseUrl: value } },
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigurationError(
      `LOCAL_LLM_BASE_URL must be an http(s) URL, got "${parsed.protocol}" in "${value}".`,
      { details: { baseUrl: value, protocol: parsed.protocol } },
    );
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
