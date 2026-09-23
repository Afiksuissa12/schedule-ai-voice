/**
 * Ollama's native `/api/chat` wire shapes, as OBSERVED - not as documented.
 *
 * Every field below was seen on the wire against Ollama 0.34.3 serving
 * `qwen2.5:7b-instruct` and `mistral:7b-instruct`. The verbatim captures are in
 * `./fixtures.ts` and the mapping self-check (`npm run llm:mapcheck`) replays
 * them, so these declarations cannot drift from reality without a red CLI.
 *
 * EVERYTHING IS OPTIONAL ON THE RESPONSE SIDE
 * ---------------------------------------------------------------------------
 * This is an untrusted wire format from a server we do not control and whose
 * version an operator can change under us. Declaring a field required would
 * turn "the server added a field" or "this model omits a counter" into a type
 * lie rather than a handled case. The mapper narrows; the types do not pretend.
 */

/** A tool offered to the model. Mirrors OpenAI's function-tool envelope. */
export interface OllamaToolSpec {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
  };
}

/**
 * A message sent TO Ollama.
 *
 * `tool_name` and `tool_call_id` are both sent on a tool-result message:
 * `tool_name` is what older Ollama builds match on, `tool_call_id` is what
 * newer ones correlate with. Sending both costs nothing and works on both.
 */
export interface OllamaRequestMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly tool_calls?: ReadonlyArray<{
    readonly id?: string;
    readonly function: { readonly name: string; readonly arguments: unknown };
  }>;
  readonly tool_name?: string;
  readonly tool_call_id?: string;
}

export interface OllamaChatRequest {
  readonly model: string;
  readonly messages: ReadonlyArray<OllamaRequestMessage>;
  readonly stream: boolean;
  readonly tools?: ReadonlyArray<OllamaToolSpec>;
  readonly keep_alive?: string;
  readonly options?: Record<string, unknown>;
}

/**
 * A tool call as it arrives FROM Ollama.
 *
 * `arguments` is an OBJECT here, not a string - the single most important
 * difference from OpenAI, and the reason `mapNativeToolCalls` re-serialises.
 * `id` is issued by Ollama 0.34 (`call_xf7lm9o3`) but is typed optional
 * because older builds omit it and the mapper must mint one rather than
 * produce a call with no correlation id.
 */
export interface OllamaWireToolCall {
  readonly id?: string;
  readonly function?: {
    readonly index?: number;
    readonly name?: string;
    readonly arguments?: unknown;
  };
}

export interface OllamaWireMessage {
  readonly role?: string;
  readonly content?: string;
  /** Present on reasoning models. Never treated as assistant text. */
  readonly thinking?: string;
  readonly tool_calls?: ReadonlyArray<OllamaWireToolCall>;
}

/**
 * One NDJSON line of a streaming response, or the single object of a
 * non-streaming one. The two are the same shape; only `done` differs in when
 * it is true, which is what lets one mapper serve both paths.
 */
export interface OllamaChatChunk {
  readonly model?: string;
  readonly created_at?: string;
  readonly message?: OllamaWireMessage;
  readonly done?: boolean;
  readonly done_reason?: string;
  /** Nanoseconds. All four `*_duration` fields are nanoseconds. */
  readonly total_duration?: number;
  readonly load_duration?: number;
  readonly prompt_eval_count?: number;
  readonly prompt_eval_cached_count?: number;
  readonly prompt_eval_duration?: number;
  readonly eval_count?: number;
  readonly eval_duration?: number;
  /** Ollama reports some failures as a 200 with an `error` body. */
  readonly error?: string;
}

/** `GET /api/tags` - models present on disk. */
export interface OllamaTagsResponse {
  readonly models?: ReadonlyArray<OllamaModelSummary>;
}

/** `GET /api/ps` - models currently resident in memory. */
export interface OllamaPsResponse {
  readonly models?: ReadonlyArray<OllamaRunningModel>;
}

export interface OllamaModelDetails {
  readonly family?: string;
  readonly families?: ReadonlyArray<string>;
  readonly format?: string;
  readonly parameter_size?: string;
  readonly quantization_level?: string;
  readonly context_length?: number;
}

export interface OllamaModelSummary {
  readonly name?: string;
  readonly model?: string;
  readonly size?: number;
  readonly digest?: string;
  readonly modified_at?: string;
  readonly details?: OllamaModelDetails;
  readonly capabilities?: ReadonlyArray<string>;
}

export interface OllamaRunningModel extends OllamaModelSummary {
  /** Bytes of this model resident in VRAM. 0 means it is on the CPU. */
  readonly size_vram?: number;
  readonly context_length?: number;
  readonly expires_at?: string;
}

/** `POST /api/show` - per-model detail including quantization. */
export interface OllamaShowResponse {
  readonly details?: OllamaModelDetails;
  readonly capabilities?: ReadonlyArray<string>;
  readonly model_info?: Record<string, unknown>;
}

export interface OllamaVersionResponse {
  readonly version?: string;
}
