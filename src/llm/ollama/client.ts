/**
 * The Ollama transport. `fetch` and nothing else.
 *
 * WHY GLOBAL `fetch` AND NOT A CLIENT LIBRARY
 * ---------------------------------------------------------------------------
 * `tests/invariants/vendorBoundary.test.ts` asserts that
 * `src/llm/openAiLlmProvider.ts` is the ONLY file under `src/` permitted to
 * import a vendor package, and its forbidden list explicitly includes the
 * generic transports - `axios`, `node-fetch`, `got`, `undici`, `superagent` -
 * on the stated grounds that "they are how a vendor gets in by the back door".
 * The `openai` SDK is on the same list, which also rules out pointing the SDK
 * at Ollama's `/v1` compatibility shim.
 *
 * That constraint is not an obstacle here, it is the right answer. Ollama's
 * native API is plain JSON over HTTP with no auth, no signing and no pagination.
 * The whole client is the file you are reading. Nothing is added to
 * `package.json`, the boundary test keeps passing unedited, and the local model
 * arrives with a smaller dependency footprint than the vendor it replaces.
 *
 * WHY THE NATIVE API RATHER THAN `/v1`
 * ---------------------------------------------------------------------------
 * `/v1/chat/completions` is a translation layer over the same engine, and it
 * drops the things this mission needs most: `prompt_eval_count`,
 * `eval_duration`, `load_duration` and the rest of Ollama's own timing
 * counters, which are how TTFT and tokens/second get measured honestly rather
 * than inferred. It also cannot express `num_ctx` or `keep_alive`. Going native
 * costs one afternoon of wire types and buys real telemetry.
 *
 * NOTHING HERE RUNS ON IMPORT
 * ---------------------------------------------------------------------------
 * No probe, no warm-up, no module-level constant that dials anything. Importing
 * this file opens no socket, which is what keeps `npm run qa:sweep`'s network
 * trap at zero attempts.
 */
import { AppError } from '../../shared/errors.js';
import { NdjsonLineAssembler } from './ndjson.js';
import type { OllamaChatChunk, OllamaChatRequest } from './wire.js';

/** Ollama is not answering at all: wrong URL, not running, or unreachable. */
export class OllamaUnreachableError extends AppError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('OLLAMA_UNREACHABLE', message, options);
  }
}

/** Ollama answered, and the answer was an error. */
export class OllamaRequestError extends AppError {
  readonly status: number;

  constructor(
    message: string,
    status: number,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super('OLLAMA_REQUEST_FAILED', message, {
      ...options,
      details: { status, ...(options?.details ?? {}) },
    });
    this.status = status;
  }
}

/** Ollama answered with something this client cannot read as a chat response. */
export class OllamaProtocolError extends AppError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('OLLAMA_PROTOCOL_ERROR', message, options);
  }
}

/** The request exceeded its hard deadline. */
export class OllamaTimeoutError extends AppError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('OLLAMA_TIMEOUT', message, options);
  }
}

export interface OllamaClientOptions {
  /** e.g. `http://host.docker.internal:11434`. Trailing slashes are tolerated. */
  readonly baseUrl: string;
  /** Hard deadline for a whole request, streaming included. */
  readonly timeoutMs: number;
  /**
   * Extra attempts after the first, for TRANSPORT failures only. Default 2,
   * i.e. up to three attempts.
   */
  readonly maxRetries?: number;
  /** Base backoff between attempts; doubles each time. */
  readonly retryBackoffMs?: number;
}

export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_RETRY_BACKOFF_MS = 250;

/** Status codes worth trying again. A 400 or a 404 will not fix itself. */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

/**
 * A request whose deadline is still running, and whose owner is now the caller.
 *
 * `release` MUST be called once the body is finished with, on every path. See
 * `attempt` for why the deadline deliberately outlives the function that set it.
 */
interface AttemptedRequest {
  readonly response: Response;
  readonly release: () => void;
  readonly signal: AbortSignal;
  /** The resolved URL, so an error raised later can still name it. */
  readonly url: string;
}

export class OllamaClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;

  constructor(options: OllamaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBackoffMs = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
  }

  /** `GET <path>` parsed as JSON. Used by the probe CLI for `/api/version`, `/api/tags`, `/api/ps`. */
  async getJson<T>(path: string): Promise<T> {
    const attempted = await this.attempt(path, { method: 'GET' });
    return this.withDeadline(attempted, () => this.readJson<T>(attempted.response, path));
  }

  /** `POST <path>` with a JSON body, parsed as JSON. Used for `/api/show`. */
  async postJson<T>(path: string, body: unknown): Promise<T> {
    const attempted = await this.attempt(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.withDeadline(attempted, () => this.readJson<T>(attempted.response, path));
  }

  /**
   * `POST /api/chat` with `stream: false`. One chunk comes back, and it is
   * returned as a one-element array so both paths hand the SAME shape to the
   * same assembler.
   */
  async chat(request: OllamaChatRequest): Promise<OllamaChatChunk[]> {
    const attempted = await this.attempt('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: false }),
    });
    const chunk = await this.withDeadline(attempted, () =>
      this.readJson<OllamaChatChunk>(attempted.response, '/api/chat'),
    );
    if (chunk.error) {
      throw new OllamaProtocolError(`Ollama reported an error completing the turn: ${chunk.error}`, {
        details: { baseUrl: this.baseUrl, model: request.model, error: chunk.error },
      });
    }
    return [chunk];
  }

  /**
   * `POST /api/chat` with `stream: true`, reading NDJSON as it arrives.
   *
   * `onChunk` is called for EVERY chunk including the terminal one, so a caller
   * can stamp time-to-first-token from the first chunk carrying text without
   * this layer needing to know what a token is.
   *
   * NOT RETRIED ONCE BYTES HAVE ARRIVED. Retrying a half-delivered stream would
   * either duplicate text the caller has already seen or silently restart
   * generation - both worse than one clear failure. Retry therefore only covers
   * the connect phase; see `attempt`.
   */
  async chatStream(
    request: OllamaChatRequest,
    onChunk: (chunk: OllamaChatChunk) => void,
  ): Promise<void> {
    const attempted = await this.attempt('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: true }),
    });
    const { response } = attempted;

    // BOTH OF THESE THROW, AND BOTH ARE INSIDE A `try` THAT RELEASES.
    // `attempt` no longer clears its own timer, so every exit from this method
    // has to clear it instead - and these two are exits. Leaving them outside
    // the release meant an error status or a bodyless 200 returned promptly to
    // the caller while an armed `setTimeout` kept the Node event loop alive for
    // the rest of `timeoutMs`, which on a CLI is a 120-second hang after the
    // work is visibly finished. `ensureOk` also reads the error body, which is
    // exactly the kind of read the deadline is here to bound.
    let body: ReadableStream<Uint8Array>;
    try {
      await this.ensureOk(response, '/api/chat');

      if (!response.body) {
        throw new OllamaProtocolError(
          `Ollama returned a streaming response with no body from ${this.baseUrl}/api/chat.`,
          { details: { baseUrl: this.baseUrl, model: request.model } },
        );
      }
      body = response.body;
    } catch (error) {
      attempted.release();
      if (attempted.signal.aborted) throw this.timedOut(attempted.url, error);
      throw error;
    }

    const assembler = new NdjsonLineAssembler();
    const decoder = new TextDecoder();
    const reader = body.getReader();

    const handleLine = (line: string): void => {
      const chunk = parseChunk(line, this.baseUrl);
      if (chunk.error) {
        throw new OllamaProtocolError(`Ollama reported an error mid-stream: ${chunk.error}`, {
          details: { baseUrl: this.baseUrl, model: request.model, error: chunk.error },
        });
      }
      onChunk(chunk);
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // `stream: true` on the decoder keeps multi-byte characters whole
        // across read boundaries - a UTF-8 sequence is as likely to be split
        // as a JSON line is.
        for (const line of assembler.push(decoder.decode(value, { stream: true }))) {
          handleLine(line);
        }
      }
      for (const line of assembler.push(decoder.decode())) handleLine(line);
      for (const line of assembler.flush()) handleLine(line);
    } catch (error) {
      // The deadline now covers this loop, so an abort here is a real timeout
      // and must surface as the typed error rather than as a raw AbortError.
      if (attempted.signal.aborted) throw this.timedOut(attempted.url, error);
      throw error;
    } finally {
      attempted.release();
      // Releasing matters on the throwing path: an unreleased reader holds the
      // socket open until GC, and a provider that times out repeatedly would
      // leak connections rather than fail cleanly.
      reader.releaseLock();
      await body.cancel().catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------

  /**
   * One request, with a hard deadline and bounded retry.
   *
   * RETRY POLICY, STATED PLAINLY: transport failures and 502/503/504 are
   * retried; every other status is returned to the caller untouched. A timeout
   * is NOT retried - the deadline is the operator's stated patience, and
   * spending it three times over is not what they asked for.
   *
   * THE DEADLINE COVERS THE WHOLE REQUEST, INCLUDING THE BODY - and that is why
   * this returns a `release` rather than clearing its own timer.
   *
   * It did clear its own timer, in a `finally`, and that was a real defect found
   * at Mission 2 integration by running the benchmark. `fetch` resolves when the
   * response HEADERS arrive, not when the body is consumed, so `return response`
   * ran the `finally`, cancelled the abort timer, and left `chatStream` reading
   * the entire NDJSON body with NO DEADLINE AT ALL. `timeoutMs` bounded only the
   * connect phase, while `.env.example` and `LOCAL_PROVIDER.md` § 7 both
   * described it as a hard per-request deadline.
   *
   * Two consequences, and the first is the one that matters for a voice product:
   * a rambling or wedged model could hold a turn open indefinitely and the
   * contact would hear silence; and the benchmark's documented promise that "a
   * model that stalls gets a recorded ERROR and the run continues" did not hold
   * on the streaming path, so a stalled candidate ate wall-clock instead of being
   * recorded as a failure. Reproduced with a fake server that sends headers
   * instantly and then never ends the body: a 3,000 ms `timeoutMs` had still not
   * fired after 15 seconds.
   *
   * So the timer now outlives this function, and EVERY caller releases it in its
   * own `finally`, after it has finished with the body. The signal is handed back
   * too, so a caller can tell a deliberate abort from a transport failure and
   * raise the typed `OllamaTimeoutError` either way.
   */
  private async attempt(path: string, init: RequestInit): Promise<AttemptedRequest> {
    const url = `${this.baseUrl}${path}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) await delay(this.retryBackoffMs * 2 ** (attempt - 1));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const release = (): void => clearTimeout(timer);
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (RETRYABLE_STATUSES.has(response.status) && attempt < this.maxRetries) {
          // Drain so the connection can be reused rather than abandoned.
          await response.text().catch(() => undefined);
          release();
          lastError = new OllamaRequestError(`Ollama returned ${response.status} from ${url}.`, response.status);
          continue;
        }
        // NOT released here. The caller owns it from this point, because the
        // caller is the one that knows when the body is finished with.
        return { response, release, signal: controller.signal, url };
      } catch (error) {
        release();
        if (controller.signal.aborted) {
          throw this.timedOut(url, error);
        }
        lastError = error;
      }
    }

    throw new OllamaUnreachableError(
      `Could not reach Ollama at ${this.baseUrl} (${path}) after ${this.maxRetries + 1} attempt(s). ` +
        'Check that Ollama is running and that LOCAL_LLM_BASE_URL points at it - from inside a container ' +
        'that is usually http://host.docker.internal:11434, not http://localhost:11434.',
      {
        cause: lastError,
        details: {
          baseUrl: this.baseUrl,
          url,
          attempts: this.maxRetries + 1,
          lastError: lastError instanceof Error ? lastError.message : String(lastError),
        },
      },
    );
  }

  /**
   * Run `read` under the attempt's deadline, then release it.
   *
   * The whole point of `attempt` handing the timer back: the body is read HERE,
   * inside the deadline, instead of after it has been cancelled.
   */
  private async withDeadline<T>(attempted: AttemptedRequest, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (attempted.signal.aborted) throw this.timedOut(attempted.url, error);
      throw error;
    } finally {
      attempted.release();
    }
  }

  /** The one place the timeout message is written, now that two paths raise it. */
  private timedOut(url: string, cause: unknown): OllamaTimeoutError {
    return new OllamaTimeoutError(
      `Ollama did not complete the request within ${this.timeoutMs}ms at ${url}. ` +
        'Raise LOCAL_LLM_TIMEOUT_MS, or check whether the model is still loading (a cold 7B load can take ' +
        'several seconds before the first token). Note that this deadline covers the WHOLE request including ' +
        'generation, so a model that rambles until it fills its context window will trip it.',
      { cause, details: { baseUrl: this.baseUrl, url, timeoutMs: this.timeoutMs } },
    );
  }

  private async ensureOk(response: Response, path: string): Promise<void> {
    if (response.ok) return;
    const body = await response.text().catch(() => '');
    throw new OllamaRequestError(
      `Ollama returned ${response.status} ${response.statusText} from ${this.baseUrl}${path}: ` +
        `${body.slice(0, 400) || '(empty body)'}`,
      response.status,
      { details: { baseUrl: this.baseUrl, path, body: body.slice(0, 2000) } },
    );
  }

  private async readJson<T>(response: Response, path: string): Promise<T> {
    await this.ensureOk(response, path);
    const text = await response.text();
    return parseChunk(text, this.baseUrl) as T;
  }
}

function parseChunk(text: string, baseUrl: string): OllamaChatChunk {
  try {
    return JSON.parse(text) as OllamaChatChunk;
  } catch (error) {
    throw new OllamaProtocolError(
      `Ollama at ${baseUrl} returned a response that is not JSON: ${text.slice(0, 200)}`,
      { cause: error, details: { baseUrl, preview: text.slice(0, 500) } },
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
