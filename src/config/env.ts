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
});

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
  };

  const result = AppConfigSchema.safeParse(stripUndefined(candidate));
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
