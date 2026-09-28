/**
 * Argument and environment handling for `npm run eval:verifier`.
 *
 * WHY THIS IS A SEPARATE MODULE FROM THE CLI
 * ---------------------------------------------------------------------------
 * Every other CLI in `src/eval/cli/` calls `main()` at import time, which is
 * right for a script and means a test cannot import one without running it. The
 * mission requires this command's "argument and environment handling" to be
 * PROVEN CORRECT WITHOUT A MODEL, so the part worth proving lives here, as a pure
 * function over an argv array and an environment object, and `src/eval/cli/
 * verifier.ts` is left as the thin shell that dials.
 *
 * PURE. It reads no `process.env` and no `process.argv` of its own; both are
 * parameters. That is the discipline `src/config/env.ts` already keeps -
 * "nothing below `loadConfig` touches `process.env`" - and it is what lets a test
 * assert the precedence rules rather than the machine it happens to run on.
 */
import { resolveVerifierOutDir } from './output.js';
import {
  VERIFIER_SPLIT_SELECTORS,
  type VerifierCaseLanguage,
  type VerifierSplitSelector,
} from './schema.js';

/** The languages `--language` accepts, and the order results are reported in. */
export const VERIFIER_LANGUAGES: readonly VerifierCaseLanguage[] = ['en', 'he', 'mixed'];

/**
 * `--split`'s default.
 *
 * `all`, and not `dev`, because a default of `dev` would make the cheap habitual
 * command measure the half somebody tuned against - which is the one number in
 * Mission 2G that must never be produced by accident. `all` is the honest default:
 * it is the whole corpus, it says so in the artefact and in the file name, and an
 * operator who wants a half has to ask for it.
 */
export const DEFAULT_VERIFIER_SPLIT: VerifierSplitSelector = 'all';

/**
 * `num_ctx` when nothing says otherwise.
 *
 * **16384, matching the benchmark's assembled-context path exactly**
 * (`src/eval/cli/run.ts`, EVAL_HARNESS.md § 9.7.2 step 3), and the mission names
 * it explicitly. It is not a free choice: a verifier benchmarked at a different
 * window is a different VRAM footprint on an 8 GiB card - the KV cache is a real
 * part of it - so a latency number taken at 8192 cannot be read beside a
 * benchmark taken at 16384.
 */
export const DEFAULT_VERIFIER_NUM_CTX = 16_384;

export interface VerifierArgs {
  /**
   * The tag to run, or `null` for "use the configured local model".
   *
   * `null` is NOT an error and NOT a missing value: it is the documented default
   * of `CLAIM_VERIFIER_MODEL`, which means *use `LOCAL_LLM_MODEL`*. The CLI
   * resolves it from configuration and prints which tag it resolved to.
   */
  readonly model: string | null;
  readonly outDir: string;
  readonly numCtx: number;
  readonly baseUrl: string | null;
  readonly timeoutMs: number | null;
  readonly languages: readonly VerifierCaseLanguage[];
  /** Cap the number of cases, for a smoke run. `null` means the whole corpus. */
  readonly limit: number | null;
  /** Send `localeHint`. OFF by default: `ClaimGate` does not send one. */
  readonly localeHint: boolean;
  /**
   * Which half of the corpus. Mission 2G. Defaults to `all`.
   *
   * The RESOLVED value - never undefined - so that every consumer records the same
   * word the operator will read in the output file name.
   */
  readonly split: VerifierSplitSelector;
  /**
   * An EXTERNAL corpus JSON file, or `null` for the in-repo corpus.
   *
   * Parsed here and LOADED ELSEWHERE, because this module is pure: it reads no
   * `process.env`, no `process.argv` and no filesystem. `loadExternalVerifierCorpus`
   * in `./external.ts` owns every refusal that needs the bytes.
   */
  readonly corpusFile: string | null;
}

export type ParsedVerifierArgs =
  | { readonly ok: true; readonly args: VerifierArgs }
  | { readonly ok: false; readonly reason: string };

/**
 * Parse, validate, and REFUSE rather than guess.
 *
 * FIVE refusals, and each one exists because the alternative is a run that
 * produces a number nobody can use:
 *
 *  1. NO OUTPUT DIRECTORY, or one inside the committed evidence. See
 *     `resolveVerifierOutDir`, which owns that rule.
 *  2. AN UNKNOWN `--language`. Silently ignoring it would run the WHOLE corpus
 *     and report it as though the operator had asked for a slice.
 *  3. A NON-NUMERIC `--num-ctx`, `--timeout-ms` or `--limit`. `Number('abc')` is
 *     `NaN`, and a `NaN` context length reaches Ollama as a request that either
 *     fails strangely or silently uses a default - which would make a latency
 *     comparison meaningless without ever looking wrong.
 *  4. AN UNKNOWN `--split`, with the known values NAMED in the message. Mission 2G.
 *     A silent full run here would be worse than the `--language` case: the whole
 *     point of the split is that a dev number and a held-out number are different
 *     claims, so `--split devv` falling through to the whole corpus would produce
 *     the number the mission exists to keep separate, under the operator's belief
 *     that they had asked for a half.
 *  5. AN EMPTY `--corpus-file`. Mission 2G. `--corpus-file` with nothing after it
 *     would otherwise resolve to the repository root as a path and fail later with
 *     a filesystem error about a directory, which is a worse message than this one.
 */
export function parseVerifierArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): ParsedVerifierArgs {
  let model: string | null = null;
  const languages: VerifierCaseLanguage[] = [];
  let outFlag: string | undefined;
  let numCtx: number | undefined;
  let baseUrl: string | undefined;
  let timeoutMs: number | undefined;
  let limit: number | undefined;
  let localeHint = false;
  let split: VerifierSplitSelector | undefined;
  let corpusFile: string | undefined;

  const numeric = (raw: string | undefined, flag: string): number | { reason: string } => {
    const value = Number(raw);
    if (raw === undefined || raw.trim().length === 0 || !Number.isFinite(value)) {
      return { reason: `${flag} needs a number, got ${raw === undefined ? '(nothing)' : `"${raw}"`}.` };
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--model':
      case '-m':
        model = String(argv[(i += 1)]);
        break;
      case '--out':
      case '-o':
        outFlag = String(argv[(i += 1)]);
        break;
      case '--language':
      case '-l': {
        const raw = String(argv[(i += 1)]);
        if (!VERIFIER_LANGUAGES.includes(raw as VerifierCaseLanguage)) {
          return {
            ok: false,
            reason: `Unknown --language "${raw}". Known: ${VERIFIER_LANGUAGES.join(', ')}.`,
          };
        }
        if (!languages.includes(raw as VerifierCaseLanguage)) languages.push(raw as VerifierCaseLanguage);
        break;
      }
      case '--num-ctx': {
        const value = numeric(argv[i + 1], '--num-ctx');
        if (typeof value !== 'number') return { ok: false, reason: value.reason };
        numCtx = value;
        i += 1;
        break;
      }
      case '--timeout-ms': {
        const value = numeric(argv[i + 1], '--timeout-ms');
        if (typeof value !== 'number') return { ok: false, reason: value.reason };
        timeoutMs = value;
        i += 1;
        break;
      }
      case '--limit': {
        const value = numeric(argv[i + 1], '--limit');
        if (typeof value !== 'number') return { ok: false, reason: value.reason };
        limit = value;
        i += 1;
        break;
      }
      case '--split': {
        const raw = argv[i + 1];
        i += 1;
        if (raw === undefined || !VERIFIER_SPLIT_SELECTORS.includes(raw as VerifierSplitSelector)) {
          return {
            ok: false,
            reason:
              `Unknown --split ${raw === undefined ? '(nothing)' : `"${raw}"`}. Known: ` +
              `${VERIFIER_SPLIT_SELECTORS.join(', ')}. This is a REFUSAL rather than a fall-back to the whole ` +
              'corpus on purpose: a dev number and a held-out number are different claims, and a typo that ran ' +
              'everything would produce the one number Mission 2G exists to keep separate.',
          };
        }
        split = raw as VerifierSplitSelector;
        break;
      }
      case '--corpus-file': {
        const raw = argv[i + 1];
        i += 1;
        if (raw === undefined || raw.trim().length === 0) {
          return {
            ok: false,
            reason:
              '--corpus-file needs a path to a JSON file holding a VerifierCorpus. Omit the flag to use the ' +
              'in-repo corpus.',
          };
        }
        corpusFile = raw;
        break;
      }
      case '--base-url':
        baseUrl = String(argv[(i += 1)]);
        break;
      case '--locale-hint':
        localeHint = true;
        break;
      default:
        if (arg !== undefined && arg.startsWith('--')) {
          // An unknown flag is a typo, and a typo silently ignored is a run
          // conducted under conditions nobody meant. `eval:run` is more tolerant
          // here; this command is new and does not have to inherit that.
          return { ok: false, reason: `Unknown flag "${arg}".` };
        }
        break;
    }
  }

  // `--out` beats `EVAL_OUT_DIR`, because an explicit flag is a stronger statement
  // than an exported variable somebody may have forgotten is still set.
  const outDir = resolveVerifierOutDir(outFlag ?? env['EVAL_OUT_DIR']);
  if (!outDir.ok) return { ok: false, reason: outDir.reason };

  // EVAL_NUM_CTX is the variable `eval:run` already reads. Honouring the same one
  // is what lets an operator export it ONCE for a whole sweep and have both
  // commands agree - and disagreement between the two is an invalidator.
  const fromEnv = env['EVAL_NUM_CTX'];
  if (numCtx === undefined && fromEnv !== undefined && fromEnv.trim().length > 0) {
    const value = Number(fromEnv);
    if (!Number.isFinite(value)) return { ok: false, reason: `EVAL_NUM_CTX is not a number: "${fromEnv}".` };
    numCtx = value;
  }

  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return { ok: false, reason: `--limit must be a positive whole number, got ${limit}.` };
  }

  return {
    ok: true,
    args: {
      model,
      outDir: outDir.path,
      numCtx: numCtx ?? DEFAULT_VERIFIER_NUM_CTX,
      baseUrl: baseUrl ?? env['LOCAL_LLM_BASE_URL'] ?? null,
      timeoutMs: timeoutMs ?? null,
      languages: languages.length > 0 ? languages : VERIFIER_LANGUAGES,
      limit: limit ?? null,
      localeHint,
      split: split ?? DEFAULT_VERIFIER_SPLIT,
      corpusFile: corpusFile ?? null,
    },
  };
}
