/**
 * The Ollama management endpoints the harness needs: list, show, pull, ps.
 *
 * WHY THIS IS NOT IN `src/llm/ollama/client.ts`
 * ---------------------------------------------------------------------------
 * That file belongs to the provider task and speaks the INFERENCE api. These
 * are OPERATOR endpoints - downloading a multi-gigabyte model, asking what is
 * resident in VRAM - which the application must never be able to call. Keeping
 * them here means the production provider cannot pull a model as a side effect
 * of a bad configuration, and it keeps `src/eval` the only place in this
 * repository that can.
 *
 * Global `fetch`, no SDK, no HTTP client package - the same constraint the rest
 * of `src/` lives under. `tests/invariants/vendorBoundary.test.ts` bans `fetch(`
 * under `src/agent`, `src/conversation` and `src/app`; `src/eval` is outside
 * that clause, which is exactly why the harness's network code lives here.
 */

export const DEFAULT_OLLAMA_BASE_URL = 'http://host.docker.internal:11434';

export interface OllamaModelDetails {
  readonly parent_model?: string;
  readonly format?: string;
  readonly family?: string;
  readonly families?: string[];
  readonly parameter_size?: string;
  readonly quantization_level?: string;
  readonly context_length?: number;
  readonly embedding_length?: number;
}

export interface OllamaTagEntry {
  readonly name: string;
  readonly model: string;
  readonly size: number;
  readonly digest: string;
  readonly modified_at?: string;
  readonly details?: OllamaModelDetails;
  readonly capabilities?: string[];
}

export interface OllamaPsEntry {
  readonly name: string;
  readonly model: string;
  readonly size: number;
  readonly size_vram: number;
  readonly context_length?: number;
  readonly expires_at?: string;
  readonly details?: OllamaModelDetails;
}

export interface OllamaShowResult {
  readonly details?: OllamaModelDetails;
  readonly capabilities?: string[];
  readonly model_info?: Record<string, unknown>;
  readonly template?: string;
  readonly parameters?: string;
}

async function getJson<T>(baseUrl: string, path: string, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`GET ${path} returned ${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function getVersion(baseUrl = DEFAULT_OLLAMA_BASE_URL): Promise<string> {
  const body = await getJson<{ version: string }>(baseUrl, '/api/version', 10_000);
  return body.version;
}

export async function listModels(baseUrl = DEFAULT_OLLAMA_BASE_URL): Promise<OllamaTagEntry[]> {
  const body = await getJson<{ models: OllamaTagEntry[] | null }>(baseUrl, '/api/tags');
  return body.models ?? [];
}

export async function listResident(baseUrl = DEFAULT_OLLAMA_BASE_URL): Promise<OllamaPsEntry[]> {
  const body = await getJson<{ models: OllamaPsEntry[] | null }>(baseUrl, '/api/ps');
  return body.models ?? [];
}

export async function showModel(model: string, baseUrl = DEFAULT_OLLAMA_BASE_URL): Promise<OllamaShowResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`/api/show for ${model} returned ${response.status}`);
    return (await response.json()) as OllamaShowResult;
  } finally {
    clearTimeout(timer);
  }
}

export interface PullProgress {
  readonly status: string;
  readonly completedBytes: number | null;
  readonly totalBytes: number | null;
}

export interface PullResult {
  readonly model: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly totalBytes: number | null;
  readonly error: string | null;
}

/**
 * Pull a model, streaming NDJSON progress.
 *
 * No timeout on the response body: these are multi-gigabyte downloads over an
 * unknown link, and a timeout here would abort a healthy pull at ninety
 * percent. A stalled pull is visible through `onProgress` going quiet, which is
 * the operator's call to make and not this function's.
 */
export async function pullModel(
  model: string,
  options: { baseUrl?: string; onProgress?: (progress: PullProgress) => void } = {},
): Promise<PullResult> {
  const baseUrl = options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
  const started = Date.now();
  let totalBytes: number | null = null;

  try {
    const response = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`/api/pull returned ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastError: string | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line) continue;

        try {
          const event = JSON.parse(line) as {
            status?: string;
            error?: string;
            total?: number;
            completed?: number;
          };
          if (event.error) lastError = event.error;
          if (typeof event.total === 'number') totalBytes = event.total;
          options.onProgress?.({
            status: event.status ?? (event.error ? 'error' : 'unknown'),
            completedBytes: typeof event.completed === 'number' ? event.completed : null,
            totalBytes: typeof event.total === 'number' ? event.total : null,
          });
        } catch {
          // A partial line; the next chunk completes it.
        }
      }
    }

    if (lastError) throw new Error(lastError);
    return { model, ok: true, durationMs: Date.now() - started, totalBytes, error: null };
  } catch (error) {
    return {
      model,
      ok: false,
      durationMs: Date.now() - started,
      totalBytes,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

/**
 * Load a model and observe what it actually costs in VRAM.
 *
 * `/api/ps` only reports a RESIDENT model, so the model has to be woken first.
 * A one-token generation is the cheapest way to do that, and it is issued at
 * the same `num_ctx` the benchmark uses so the KV cache in the reading is the
 * KV cache the benchmark will pay for.
 */
export async function measureResidentVram(
  model: string,
  options: { baseUrl?: string; numCtx?: number; keepAlive?: string } = {},
): Promise<{ vramBytes: number | null; contextLength: number | null; loadMs: number }> {
  const baseUrl = options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;
  const numCtx = options.numCtx ?? 8192;
  const started = Date.now();

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: 'hi',
      stream: false,
      keep_alive: options.keepAlive ?? '5m',
      options: { num_ctx: numCtx, num_predict: 1, temperature: 0 },
    }),
  });
  if (!response.ok) throw new Error(`/api/generate warm-up for ${model} returned ${response.status}`);
  await response.json();

  const loadMs = Date.now() - started;
  const resident = await listResident(baseUrl);
  const entry = resident.find((m) => m.name === model || m.model === model);

  return {
    vramBytes: entry?.size_vram ?? null,
    contextLength: entry?.context_length ?? null,
    loadMs,
  };
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'n/a';
  return `${(bytes / 2 ** 30).toFixed(2)} GiB`;
}
