/**
 * Runtime configuration.
 *
 * Read from the environment once, validated with Zod, and then passed around
 * explicitly. Nothing below reaches into `process.env` directly - `loadConfig`
 * takes the environment as an argument so tests can supply their own.
 *
 * There is no dotenv dependency on purpose. The Prisma CLI loads `.env` for the
 * db:* scripts; for an application process use Node's built-in
 * `node --env-file=.env ...`.
 */
import { z } from 'zod';

import { IanaTimezoneSchema, NonEmptyStringSchema } from '../domain/enums.js';
import { ConfigurationError } from '../shared/errors.js';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

/**
 * Which `LlmProvider` a composed runtime should use.
 *
 * DEFAULTS TO `scripted`, and that default is load-bearing. An unset or
 * malformed `LLM_PROVIDER` must produce the provider that talks to nobody and
 * spends nothing, so a deployment mistake fails towards "does nothing to
 * anybody" rather than towards "phones a stranger" - the same property
 * `src/app/composition.ts` already has for telephony and calendars.
 */
export const LLM_PROVIDERS = ['scripted', 'local', 'openai'] as const;
export type LlmProviderKind = (typeof LLM_PROVIDERS)[number];

/** Defaults for the local provider, mirrored from `src/llm/localLlmProvider.ts`. */
const LOCAL_LLM_DEFAULTS = {
  baseUrl: 'http://host.docker.internal:11434',
  model: 'qwen2.5:7b-instruct',
  temperature: 0,
  // 8192, not 4096: the production prompt plus the nine tool schemas measures
  // 3,732 tokens on its own. See DEFAULT_LOCAL_LLM_NUM_CTX in
  // `src/llm/localLlmProvider.ts` for the VRAM measurements behind this.
  numCtx: 8192,
  timeoutMs: 120_000,
  keepAlive: '5m',
} as const;

/**
 * The local-model keys, as a schema that stands on its own.
 *
 * Separate from `AppConfigSchema` for one concrete reason: asking "is Ollama up
 * and which models does it have" must not require a DATABASE_URL. `npm run
 * llm:probe` is the first thing an operator runs on a machine where nothing
 * else is configured yet, and making it demand a datasource it never opens
 * would be a poor answer to "why can't I talk to my model".
 *
 * It is MERGED into `AppConfigSchema` below rather than duplicated, so there is
 * still exactly one definition of what `LOCAL_LLM_NUM_CTX` means.
 *
 * EVERY KEY IS OPTIONAL AND DEFAULTED. A clone with no `.env` at all must run
 * the whole test suite and the demo, so a missing local key can never be an
 * error.
 */
export const LocalLlmConfigSchema = z.object({
  /**
   * Which provider a composed runtime should use. See `LLM_PROVIDERS`.
   *
   * Nothing reads this implicitly: `buildAgentRuntime` still defaults to the
   * scripted provider and only honours an explicit `llmProviderConfig`.
   * Configuration states an intent; it does not by itself cause a process to
   * start talking to a model.
   */
  llmProvider: z.enum(LLM_PROVIDERS).default('scripted'),

  /** Ollama's base URL. `localhost` inside a container is the container. */
  localLlmBaseUrl: NonEmptyStringSchema.url({
    message: 'LOCAL_LLM_BASE_URL must be an absolute http(s) URL, e.g. http://host.docker.internal:11434',
  }).default(LOCAL_LLM_DEFAULTS.baseUrl),

  /** An Ollama model tag, e.g. `qwen2.5:7b-instruct`. Must exist on the host. */
  localLlmModel: NonEmptyStringSchema.default(LOCAL_LLM_DEFAULTS.model),

  /** 0 by default: this agent follows a procedure, it is not being creative. */
  localLlmTemperature: z.coerce.number().min(0).max(2).default(LOCAL_LLM_DEFAULTS.temperature),

  /** Nucleus sampling. Null means "leave it to the model's own default". */
  localLlmTopP: z.coerce.number().min(0).max(1).nullable().default(null),

  /**
   * Context window (`num_ctx`). After the weights this is the main lever on
   * VRAM, so it is capped at something a 7B model can plausibly be asked for
   * rather than left open - a typo of 320000 should be a startup error, not an
   * out-of-memory an hour later.
   */
  localLlmNumCtx: z.coerce.number().int().min(512).max(131_072).default(LOCAL_LLM_DEFAULTS.numCtx),

  /** Hard per-request deadline. Generous: a cold 7B load costs seconds. */
  localLlmTimeoutMs: z.coerce.number().int().min(1_000).max(600_000).default(LOCAL_LLM_DEFAULTS.timeoutMs),

  /** How long Ollama keeps the model resident after a turn, e.g. `5m`, `0`, `-1`. */
  localLlmKeepAlive: NonEmptyStringSchema.default(LOCAL_LLM_DEFAULTS.keepAlive),

  /**
   * MISSION 2F: which model serves the SEMANTIC CLAIM VERIFIER.
   *
   * `null` - the default, and what an unset or empty `CLAIM_VERIFIER_MODEL`
   * produces - means USE THE CONFIGURED LOCAL MODEL. That is deliberate and it is
   * what the mission brief requires: the verifier's default is not a second
   * model tag written down twice, it is literally `localLlmModel`, so raising
   * `LOCAL_LLM_MODEL` cannot leave the verifier behind on an older one. No model
   * default in this repository was changed to add this key.
   *
   * WHAT SETTING IT COSTS, so nobody discovers it on a VRAM error. A DIFFERENT tag
   * here means TWO models resident at once, because the verifier runs on every
   * customer-facing text while the conversation is live. On the measured mission
   * host (RTX 4060 Laptop, 8,188 MiB) `qwen2.5:7b-instruct` Q4_K_M at num_ctx
   * 16384 is already 5.09 GiB (`LOCAL_PROVIDER.md` § 6), so a second 7B does not
   * fit and Ollama will either spill to CPU or evict. Leaving this unset - one
   * model, two roles - is the configuration the evidence supports.
   *
   * Per-language routing is NOT implemented and this key is not a hook for it.
   */
  claimVerifierModel: NonEmptyStringSchema.nullable().default(null),

  /**
   * MISSION 2F: the verifier's deadline, in milliseconds.
   *
   * Defaults to `DEFAULT_SEMANTIC_VERIFIER_TIMEOUT_MS` (20,000), which that
   * constant argues from measured cold-load and p95 turn figures. Capped well
   * below `localLlmTimeoutMs` on purpose: this call sits on the critical path of a
   * live phone call and must fail fast rather than inherit a deadline chosen for a
   * long conversational turn.
   */
  claimVerifierTimeoutMs: z.coerce.number().int().min(500).max(120_000).default(20_000),
});

export type LocalLlmConfig = z.infer<typeof LocalLlmConfigSchema>;

export const AppConfigSchema = z.object({
  nodeEnv: z.enum(NODE_ENVS).default('development'),

  /** Prisma datasource URL. SQLite file URL in this mission. */
  databaseUrl: NonEmptyStringSchema,

  /**
   * OpenAI API key for the agent layer's LlmProvider adapter.
   *
   * NULL when unset, and that is a supported state: the entire test suite runs
   * against deterministic doubles and must never require a credential. Only the
   * real OpenAI adapter may demand it, and it must fail loudly when it is
   * missing rather than silently degrading.
   */
  openAiApiKey: z.string().min(1).nullable().default(null),

  /**
   * IANA zone used when neither the contact nor the agent configuration
   * supplies one.
   */
  appTimezoneDefault: IanaTimezoneSchema.default('UTC'),
}).merge(LocalLlmConfigSchema);

export type AppConfig = z.infer<typeof AppConfigSchema>;

export interface RawEnv {
  readonly [key: string]: string | undefined;
}

/**
 * Validate an environment into an `AppConfig`.
 *
 * Throws `ConfigurationError` with every problem listed, rather than failing on
 * the first one, because a half-configured deployment should be fixed in one
 * pass.
 */
export function loadConfig(env: RawEnv = process.env): AppConfig {
  const candidate = {
    nodeEnv: env['NODE_ENV'] ?? undefined,
    databaseUrl: env['DATABASE_URL'] ?? undefined,
    openAiApiKey: emptyToNull(env['OPENAI_API_KEY']),
    appTimezoneDefault: env['APP_TIMEZONE_DEFAULT'] ?? undefined,
    ...readLocalLlmKeys(env),
  };

  return parseOrThrow(AppConfigSchema, candidate);
}

/**
 * Validate ONLY the local-model keys.
 *
 * For processes that talk to Ollama and to nothing else - the operator CLIs -
 * so they do not inherit a DATABASE_URL requirement they have no use for.
 */
export function loadLocalLlmConfig(env: RawEnv = process.env): LocalLlmConfig {
  return parseOrThrow(LocalLlmConfigSchema, readLocalLlmKeys(env));
}

/**
 * The raw reads, in one place.
 *
 * Nothing below `loadConfig`/`loadLocalLlmConfig` touches `process.env`; both
 * take the environment as an argument so a caller can supply its own.
 */
function readLocalLlmKeys(env: RawEnv): Record<string, unknown> {
  return {
    llmProvider: emptyToUndefined(env['LLM_PROVIDER']),
    localLlmBaseUrl: emptyToUndefined(env['LOCAL_LLM_BASE_URL']),
    localLlmModel: emptyToUndefined(env['LOCAL_LLM_MODEL']),
    localLlmTemperature: emptyToUndefined(env['LOCAL_LLM_TEMPERATURE']),
    localLlmTopP: emptyToNull(env['LOCAL_LLM_TOP_P']),
    localLlmNumCtx: emptyToUndefined(env['LOCAL_LLM_NUM_CTX']),
    localLlmTimeoutMs: emptyToUndefined(env['LOCAL_LLM_TIMEOUT_MS']),
    localLlmKeepAlive: emptyToUndefined(env['LOCAL_LLM_KEEP_ALIVE']),
    // `emptyToNull`, not `emptyToUndefined`: an empty CLAIM_VERIFIER_MODEL is a
    // deliberate "use the configured local model", which is the `null` default.
    claimVerifierModel: emptyToNull(env['CLAIM_VERIFIER_MODEL']),
    claimVerifierTimeoutMs: emptyToUndefined(env['CLAIM_VERIFIER_TIMEOUT_MS']),
  };
}

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, candidate: Record<string, unknown>): z.infer<T> {
  const result = schema.safeParse(stripUndefined(candidate));
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new ConfigurationError(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`, {
      details: { problems },
    });
  }
  return result.data;
}

/**
 * The OpenAI key, or a loud failure.
 *
 * Call this at the point of use in the real LLM adapter so that a missing key
 * is a startup error with a clear message, never an undefined slipped into an
 * Authorization header.
 */
export function requireOpenAiApiKey(config: AppConfig): string {
  if (!config.openAiApiKey) {
    throw new ConfigurationError(
      'OPENAI_API_KEY is not set. Set it in your local .env (never commit it). ' +
        'Tests must use a deterministic LlmProvider double instead.',
    );
  }
  return config.openAiApiKey;
}

/**
 * The local provider's options, projected out of `AppConfig`.
 *
 * A separate function rather than a field on the config so that reading the
 * configuration still cannot, by itself, construct anything that dials
 * anywhere. The caller has to ask.
 */
export interface LocalLlmSettings {
  readonly baseUrl: string;
  readonly model: string;
  readonly temperature: number;
  readonly topP?: number;
  readonly numCtx: number;
  readonly timeoutMs: number;
  readonly keepAlive: string;
}

export function localLlmSettings(config: LocalLlmConfig): LocalLlmSettings {
  return {
    baseUrl: config.localLlmBaseUrl,
    model: config.localLlmModel,
    temperature: config.localLlmTemperature,
    ...(config.localLlmTopP !== null ? { topP: config.localLlmTopP } : {}),
    numCtx: config.localLlmNumCtx,
    timeoutMs: config.localLlmTimeoutMs,
    keepAlive: config.localLlmKeepAlive,
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function emptyToNull(value: string | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      out[key] = entry;
    }
  }
  return out as Partial<T>;
}
