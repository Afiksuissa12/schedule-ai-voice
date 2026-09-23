/**
 * `npm run llm:probe` - is there an Ollama, what is on it, and what is loaded.
 *
 * The first thing to run on a new machine, and the first thing to run when the
 * local brain stops working. It answers, in order:
 *
 *   - Is Ollama answering at `LOCAL_LLM_BASE_URL`, and at what version?
 *   - Which models are actually present? (`/api/tags`)
 *   - Is the configured model among them?
 *   - What is resident right now, and how much VRAM is it using? (`/api/ps`)
 *   - Does the `/v1` OpenAI-compatible shim agree with the native API?
 *
 * EXITS NON-ZERO if Ollama is unreachable or the configured model is absent,
 * because both are "you cannot run the local brain" and neither should be
 * something an operator has to notice in scrollback.
 *
 * The `/v1` probe is informational. This provider does NOT use that shim - see
 * `src/llm/ollama/client.ts` for why - but the discrepancy the mission brief
 * recorded (`/v1/models` returning `{"data": null}` while `/api/tags` returned
 * `{"models": []}`) is exactly the kind of thing worth being able to re-check
 * in one command, so it is checked here.
 */
import { loadLocalLlmConfig, localLlmSettings } from '../../config/env.js';
import { OllamaClient } from '../ollama/client.js';
import type {
  OllamaPsResponse,
  OllamaShowResponse,
  OllamaTagsResponse,
  OllamaVersionResponse,
} from '../ollama/wire.js';
import { Checks, detail, heading, line, main, warn } from './reporting.js';

/** The models the mission brief named. Reported present/absent whatever is configured. */
const CANDIDATE_MODELS = ['qwen2.5:7b-instruct', 'llama3.1:8b-instruct', 'mistral:7b-instruct'] as const;

/** The measured VRAM budget of the mission host: 8188 MiB, minus headroom. */
const VRAM_BUDGET_BYTES = 7.5 * 1024 ** 3;

function gib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

main(async () => {
  const settings = localLlmSettings(loadLocalLlmConfig());
  const client = new OllamaClient({ baseUrl: settings.baseUrl, timeoutMs: settings.timeoutMs });
  const checks = new Checks();

  line();
  line('llm:probe - checking the local Ollama host.');
  detail('LOCAL_LLM_BASE_URL', settings.baseUrl);
  detail('LOCAL_LLM_MODEL', settings.model);
  detail('LOCAL_LLM_NUM_CTX', settings.numCtx);
  detail('LOCAL_LLM_TIMEOUT_MS', settings.timeoutMs);

  // -------------------------------------------------------------------------
  heading('1. Reachability: GET /api/version');
  {
    // Unhandled, on purpose: if this throws, `main` prints the actionable
    // OllamaUnreachableError - which names the base URL and the container
    // localhost trap - and exits 1. Catching it here would bury the good message.
    const version = await client.getJson<OllamaVersionResponse>('/api/version');
    detail('version', version.version ?? '(not reported)');
    checks.ok('Ollama is answering', typeof version.version === 'string' && version.version.length > 0);
  }

  // -------------------------------------------------------------------------
  heading('2. Models present: GET /api/tags');
  let presentNames: string[] = [];
  {
    const tags = await client.getJson<OllamaTagsResponse>('/api/tags');
    const models = tags.models ?? [];
    presentNames = models.map((m) => m.name ?? m.model ?? '(unnamed)');

    if (models.length === 0) {
      warn('/api/tags reports NO models. Nothing can run until one is pulled:');
      line('       curl http://<host>:11434/api/pull -d \'{"model":"qwen2.5:7b-instruct"}\'');
    }

    for (const model of models) {
      const details = model.details;
      detail(
        model.name ?? '(unnamed)',
        `${details?.parameter_size ?? '?'} ${details?.quantization_level ?? '?'} ` +
          `${model.size ? gib(model.size) : '?'} on disk, caps=[${(model.capabilities ?? []).join(',')}]`,
      );
    }

    checks.ok('at least one model is present', models.length > 0, 'pull one with POST /api/pull');

    heading('2b. The models the mission brief named');
    for (const candidate of CANDIDATE_MODELS) {
      const found = models.find((m) => m.name === candidate || m.model === candidate);
      detail(candidate, found ? `PRESENT (${found.details?.quantization_level ?? '?'})` : 'ABSENT');
    }

    heading('2c. The CONFIGURED model');
    const configured = models.find((m) => m.name === settings.model || m.model === settings.model);
    checks.ok(
      `LOCAL_LLM_MODEL "${settings.model}" is present on the host`,
      configured !== undefined,
      `present: ${presentNames.join(', ') || '(none)'}`,
    );
    if (configured) {
      checks.ok(
        `"${settings.model}" advertises the "tools" capability`,
        (configured.capabilities ?? []).includes('tools'),
        'a model without native tool calling will lean on the text fallback for every call',
      );
    }
  }

  // -------------------------------------------------------------------------
  heading('3. Per-model detail: POST /api/show');
  if (presentNames.includes(settings.model)) {
    const shown = await client.postJson<OllamaShowResponse>('/api/show', { model: settings.model });
    detail('family', shown.details?.family ?? '?');
    detail('parameter_size', shown.details?.parameter_size ?? '?');
    detail('quantization_level', shown.details?.quantization_level ?? '?');
    detail('capabilities', (shown.capabilities ?? []).join(', ') || '(none)');
    const trained = Object.entries(shown.model_info ?? {}).find(([key]) => key.endsWith('.context_length'));
    detail('trained context length', trained ? String(trained[1]) : '?');
    if (trained && typeof trained[1] === 'number' && settings.numCtx > trained[1]) {
      warn(`LOCAL_LLM_NUM_CTX (${settings.numCtx}) exceeds the model's trained context (${trained[1]}).`);
    }
  } else {
    warn('skipped: the configured model is not present.');
  }

  // -------------------------------------------------------------------------
  heading('4. Resident right now: GET /api/ps');
  {
    const ps = await client.getJson<OllamaPsResponse>('/api/ps');
    const running = ps.models ?? [];
    if (running.length === 0) {
      line('  (nothing loaded - the next turn pays a cold start of roughly 2-4s on this hardware)');
    }
    for (const model of running) {
      const vram = model.size_vram ?? 0;
      detail(
        model.name ?? '(unnamed)',
        `${gib(model.size ?? 0)} total, ${gib(vram)} in VRAM, num_ctx=${model.context_length ?? '?'}, ` +
          `expires ${model.expires_at ?? '?'}`,
      );
      checks.ok(
        `"${model.name}" fits the ${gib(VRAM_BUDGET_BYTES)} VRAM budget`,
        vram === 0 || vram <= VRAM_BUDGET_BYTES,
        `resident VRAM ${gib(vram)}`,
      );
      if (vram === 0 && (model.size ?? 0) > 0) {
        warn(`"${model.name}" is resident on the CPU, not the GPU. Expect single-digit tokens/second.`);
      }
    }
  }

  // -------------------------------------------------------------------------
  heading('5. The /v1 OpenAI-compatible shim (informational - NOT used by this provider)');
  {
    try {
      const shim = await client.getJson<{ data?: unknown }>('/v1/models');
      const data = shim.data;
      const ids = Array.isArray(data)
        ? data.map((entry) => (entry as { id?: string }).id ?? '?')
        : [];
      detail('/v1/models data', data === null ? 'null' : `${ids.length} model(s)`);
      if (ids.length > 0) detail('ids', ids.join(', '));

      // The brief recorded `/api/tags` empty AND `/v1/models` null together.
      // Worth flagging when the two DISAGREE, because that means one of them is
      // lying and an operator should know which.
      if (ids.length !== presentNames.length) {
        warn(
          `/v1/models lists ${ids.length} model(s) but /api/tags lists ${presentNames.length}. ` +
            'The native API is the source of truth for this provider.',
        );
      } else {
        line('  (agrees with /api/tags)');
      }
    } catch (error) {
      warn(`/v1 shim did not answer: ${error instanceof Error ? error.message : String(error)}`);
      line('  Harmless: this provider speaks the native API only.');
    }
  }

  checks.finish('llm:probe');
});
