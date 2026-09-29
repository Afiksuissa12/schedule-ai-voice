/**
 * The LLM-as-judge, and its honest limitations.
 *
 * WHAT THIS IS
 * ---------------------------------------------------------------------------
 * A local model, named in the results, reading a committed transcript against a
 * committed prompt and returning a score vector. That is all it is. Its output
 * is labelled `judged` everywhere it appears and is never described as a
 * measurement.
 *
 * THE LIMITATIONS, STATED UP FRONT
 * ---------------------------------------------------------------------------
 *  1. THE JUDGE IS THE SAME SIZE AS THE CANDIDATES. There is no frontier model
 *     available to this harness, so a 7-8B model is grading 7-8B models. It
 *     will miss subtleties a human would catch.
 *  2. SELF-PREFERENCE. At least one judge is also a candidate. LLM judges are
 *     known to favour their own outputs. This is mitigated, not solved, by
 *     running TWO judges from different families and reporting their agreement:
 *     where they agree the signal is worth something, and where they disagree
 *     the report says so rather than averaging the disagreement away.
 *  3. THE JUDGE IS BLIND TO MODEL IDENTITY, which removes name bias but not
 *     style bias.
 *  4. HEBREW JUDGEMENT IS THE WEAKEST PART. A 7-8B model's ability to assess
 *     Hebrew register is materially worse than its ability to assess English.
 *     Hebrew judge scores should be read as a weak prior and the transcripts
 *     read directly.
 *
 * This is why raw transcripts are committed. The judge is a way to rank fifty
 * conversations quickly; the transcripts are the evidence.
 */
import { z } from 'zod';

import { LocalLlmProvider } from '../../llm/localLlmProvider.js';
import { JUDGED_DIMENSIONS } from './rubric.js';
import { JUDGE_SYSTEM_PROMPT, buildJudgeUserPrompt, type JudgeRequest } from './judgePrompt.js';

/**
 * The two judges, deliberately from different model families.
 *
 * qwen2.5 is the strongest instruction-follower in the candidate set, which is
 * what a structured-output judging task needs. llama3.1 is a different lineage
 * entirely, so a shared blind spot is less likely. Both are also CANDIDATES,
 * which is stated in the report next to their own rows.
 */
export const JUDGE_MODELS = ['qwen2.5:7b-instruct', 'llama3.1:8b-instruct-q4_K_M'] as const;

const DimensionScoreSchema = z.object({
  score: z.number().min(0).max(5),
  why: z.string().default(''),
});

/** Every judged dimension, required. A judge that skips one is retried. */
const JudgeResponseSchema = z.object(
  Object.fromEntries(JUDGED_DIMENSIONS.map((d) => [d.key, DimensionScoreSchema])) as Record<
    string,
    typeof DimensionScoreSchema
  >,
);

export interface JudgeVerdict {
  readonly judgeModel: string;
  readonly ok: true;
  readonly scores: Record<string, { score: number; why: string }>;
  readonly latencyMs: number;
  readonly attempts: number;
}

export interface JudgeFailure {
  readonly judgeModel: string;
  readonly ok: false;
  /** Why it failed, and the raw text, so a reader can see what it actually said. */
  readonly error: string;
  readonly rawText: string | null;
  readonly attempts: number;
}

export type JudgeResult = JudgeVerdict | JudgeFailure;

export interface JudgeOptions {
  readonly baseUrl?: string;
  readonly numCtx?: number;
  readonly keepAlive?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
}

/**
 * Ask one judge for one verdict.
 *
 * Goes through `LocalLlmProvider` rather than speaking to Ollama directly, so
 * the judge runs on exactly the same committed transport as the candidates and
 * there is no second network path in this repository to keep in step.
 */
export async function judgeConversation(
  judgeModel: string,
  request: JudgeRequest,
  options: JudgeOptions = {},
): Promise<JudgeResult> {
  const maxAttempts = options.maxAttempts ?? 2;
  const provider = new LocalLlmProvider({
    model: judgeModel,
    temperature: 0,
    // A long transcript plus the rubric guide is the biggest prompt this
    // harness builds. 16k keeps it clear of front-truncation, which on a JUDGE
    // would silently remove the scale definition.
    numCtx: options.numCtx ?? 16_384,
    keepAlive: options.keepAlive ?? '30m',
    timeoutMs: options.timeoutMs ?? 180_000,
    maxRetries: 0,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });

  const userPrompt = buildJudgeUserPrompt(request);
  let lastRaw: string | null = null;
  let lastError = 'no attempt was made';
  const started = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const nudge =
        attempt === 1
          ? userPrompt
          : `${userPrompt}\n\nYOUR PREVIOUS REPLY WAS NOT VALID JSON OF THE REQUIRED SHAPE. Reply with the JSON object ONLY. No prose before it, no fence around it, every key present, every score a number from 0 to 5.`;

      const result = await provider.completeTurn({
        systemPrompt: JUDGE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: nudge }],
        tools: [],
      });

      lastRaw = result.assistantText;
      const extracted = extractJsonObject(result.assistantText ?? '');
      if (extracted === undefined) {
        lastError = 'no JSON object could be found in the reply';
        continue;
      }

      const parsed = JudgeResponseSchema.safeParse(extracted);
      if (!parsed.success) {
        lastError = `JSON did not match the required shape: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`;
        continue;
      }

      const echoed = detectTemplateEcho(parsed.data as Record<string, { score: number; why: string }>);
      if (echoed) {
        // A small model that copies the answer template back would otherwise
        // produce a perfectly valid all-zeros verdict, which is indistinguishable
        // from a real damning judgement and would silently poison the averages.
        // Caught here, retried, and recorded as a failure if it persists.
        lastError = `the reply echoed the answer template rather than judging (${echoed})`;
        continue;
      }

      return {
        judgeModel,
        ok: true,
        scores: parsed.data as Record<string, { score: number; why: string }>,
        latencyMs: Date.now() - started,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  }

  // A failed judgement is RECORDED, never silently dropped. The report prints
  // how many scenarios went unjudged, because a judged average over an unknown
  // denominator is worthless.
  return { judgeModel, ok: false, error: lastError, rawText: lastRaw, attempts: maxAttempts };
}

/**
 * Did the judge fill the form in, or hand it back blank?
 *
 * Returns a reason string when the reply is a template echo, `null` when it
 * looks like a real judgement. Two signatures, both conclusive:
 *
 *  - Every justification is the SAME string. Twelve different dimensions
 *    cannot honestly share one sentence.
 *  - A justification still contains the placeholder wording.
 *
 * Identical SCORES alone are deliberately NOT treated as an echo: a uniformly
 * bad transcript can honestly earn straight zeros, and rejecting that would
 * quietly censor the harshest verdicts.
 */
export function detectTemplateEcho(scores: Record<string, { score: number; why: string }>): string | null {
  const entries = Object.values(scores);
  if (entries.length < 2) return null;

  const reasons = entries.map((entry) => entry.why.trim().toLowerCase());
  if (reasons.some((reason) => reason.includes('your score') || reason.includes('your one-sentence'))) {
    return 'placeholder text left in a justification';
  }

  const distinct = new Set(reasons.filter((reason) => reason.length > 0));
  if (distinct.size <= 1) {
    return `all ${entries.length} justifications were identical ("${reasons[0] ?? ''}")`;
  }

  return null;
}

/**
 * Pull the first balanced `{...}` out of a reply.
 *
 * Small models wrap JSON in prose or a markdown fence however firmly they are
 * told not to. Brace-matching (string-aware, so a `{` inside a justification
 * does not confuse it) recovers the object without a second model call.
 */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i] as string;

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as unknown;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * Mean absolute difference between two judges, per dimension and overall.
 *
 * Reported instead of hidden: if the two judges are 1.5 points apart on
 * naturalness, the honest conclusion is that this harness cannot measure
 * naturalness to better than that, and the Founder should read transcripts.
 */
export function judgeAgreement(
  a: Record<string, { score: number }>,
  b: Record<string, { score: number }>,
): { perDimension: Record<string, number>; meanAbsoluteDifference: number } {
  const perDimension: Record<string, number> = {};
  let total = 0;
  let count = 0;

  for (const dimension of JUDGED_DIMENSIONS) {
    const left = a[dimension.key]?.score;
    const right = b[dimension.key]?.score;
    if (left === undefined || right === undefined) continue;
    const difference = Math.abs(left - right);
    perDimension[dimension.key] = difference;
    total += difference;
    count += 1;
  }

  return { perDimension, meanAbsoluteDifference: count === 0 ? 0 : total / count };
}
