/**
 * `--corpus-file` - loading a verifier corpus THIS REPOSITORY HAS NEVER SEEN.
 *
 * WHY THE FLAG EXISTS
 * ---------------------------------------------------------------------------
 * Because the strongest evidence about a classifier is a set of sentences the
 * people who built the classifier could not have read. Mission 2G's own held-out
 * split is the second-strongest thing: it is sentences the TUNING task could not
 * read, written by the task that owns the data. An operator with a SEALED
 * evaluation set - kept outside the repository, never shown to anybody who touched
 * the instruction - can produce the strongest, and this flag is how they run it
 * through the same scorer, the same union and the same output schema.
 *
 * EVERYTHING FATAL, AND THE ONE THING THAT IS NOT
 * ---------------------------------------------------------------------------
 * SIX FATAL REFUSALS, each with a non-zero exit:
 *
 *   1. the file is missing or unreadable;
 *   2. the bytes are not JSON;
 *   3. `schemaVersion` is not the current `VERIFIER_CORPUS_SCHEMA_VERSION` (and
 *      the message PRINTS the expected value, because "wrong version" without the
 *      number is a message that makes an operator read source code);
 *   4. any Zod failure, from `VerifierCorpusSchema` - the SAME schema, `.strict()`
 *      and all, including the cross-field label rules;
 *   5. a duplicate id;
 *   6. a duplicate text.
 *
 * 5 and 6 run through `duplicateVerifierCaseProblem`, which is the SAME function
 * the in-repo loader uses. Two implementations of "are these unique" is how one of
 * them ends up lenient.
 *
 * THE COVERAGE CONTRACT IS COMPUTED AND PRINTED AND IS **NOT** FATAL HERE, AND
 * THAT IS A DELIBERATE DECISION RATHER THAN AN OVERSIGHT.
 * A sealed evaluation set is a legitimate SLICE. It may be forty English
 * cancellation controls and nothing else; it may carry no Hebrew, no `mixed`, no
 * `RECORD` family, no `RECORDED_MODEL_OUTPUT` provenance and no shape labels at
 * all. Refusing it for that would make the flag useless for the exact purpose it
 * was built for - so the coverage report is printed as INFORMATION, the operator
 * sees precisely which axes their file does and does not exercise, and the run
 * proceeds. `docs/MISSION_2G_VERIFIER_ROUND.md` § 5.3 says the same thing in
 * prose, because a decision like this one has to be findable from both directions.
 *
 * THE `--split` INTERACTION IS A REFUSAL, NOT A FALLBACK.
 * `split` is optional in the schema, so an external corpus may carry none. If it
 * carries none, `--split dev` and `--split heldout` REFUSE. They must: running
 * everything would be a full run reported as a slice, and running nothing would be
 * a zero-case run reported as a result. `--split all` runs it, which is the honest
 * reading of "this file is one thing".
 *
 * NO NETWORK. One `readFileSync` and one `createHash`. Nothing here can reach a
 * model, and `tests/eval/verifierExternalCorpus.test.ts` exercises every refusal
 * against real temporary files.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { REPO_ROOT } from '../runner/store.js';
import {
  corpusCarriesSplits,
  duplicateVerifierCaseProblem,
  unmetVerifierCoverage,
  verifierCoverage,
  type VerifierCoverageReport,
  type VerifierSplitSelector,
} from './corpus.js';
import { VERIFIER_CORPUS_SCHEMA_VERSION, VerifierCorpusSchema, type VerifierCorpus } from './schema.js';

export interface LoadedExternalCorpus {
  readonly ok: true;
  readonly corpus: VerifierCorpus;
  /** The resolved ABSOLUTE path, recorded in the artefact so a sealed run is attributable. */
  readonly path: string;
  /** sha256 of the file's BYTES, hex. Attribution, not integrity: it proves WHICH file ran. */
  readonly sha256: string;
  readonly coverage: VerifierCoverageReport;
  /**
   * Which coverage rules the external file does not satisfy. INFORMATION ONLY -
   * the caller prints these and runs anyway. See the module header.
   */
  readonly coverageGaps: readonly string[];
  /** False when no row carries a `split`. Drives the `--split` refusal in `selectExternalSplit`. */
  readonly carriesSplits: boolean;
}

export type ExternalCorpusResult = LoadedExternalCorpus | { readonly ok: false; readonly reason: string };

/**
 * Read, hash, parse, validate, and REFUSE rather than guess.
 *
 * `readFile` is injectable ONLY so a test can exercise the unreadable-file branch
 * without depending on filesystem permissions, which differ between a container
 * and a Windows host. The default is the real `readFileSync`.
 */
export function loadExternalVerifierCorpus(
  requestedPath: string,
  readFile: (path: string) => Buffer = (path) => readFileSync(path),
): ExternalCorpusResult {
  const path = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(REPO_ROOT, requestedPath);

  let bytes: Buffer;
  try {
    bytes = readFile(path);
  } catch (error) {
    return {
      ok: false,
      reason:
        `Cannot read the corpus file at ${path}: ` +
        (error instanceof Error ? `${error.name}: ${error.message}` : String(error)),
    };
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');

  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return {
      ok: false,
      reason:
        `The corpus file at ${path} is not valid JSON: ` +
        (error instanceof Error ? error.message : String(error)) +
        `\n  (sha256 ${sha256})`,
    };
  }

  // THE VERSION CHECK BEFORE THE SCHEMA CHECK, so the message is the useful one.
  // `VerifierCorpusSchema` carries `schemaVersion` as a `z.literal`, so a wrong
  // version would already fail validation - but it would fail it as one Zod issue
  // among possibly dozens, and an operator whose file is a minor version behind
  // deserves to be told that rather than handed a list.
  if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw) {
    const declared = (raw as { schemaVersion?: unknown }).schemaVersion;
    if (declared !== VERIFIER_CORPUS_SCHEMA_VERSION) {
      return {
        ok: false,
        reason:
          `The corpus file at ${path} declares schemaVersion ${JSON.stringify(declared)}, and this build reads ` +
          `${VERIFIER_CORPUS_SCHEMA_VERSION}. Two corpora on different schema versions are not comparable and ` +
          'this command will not guess which fields moved.\n' +
          `  (sha256 ${sha256})`,
      };
    }
  }

  const parsed = VerifierCorpusSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason:
        `The corpus file at ${path} does not satisfy VerifierCorpusSchema:\n` +
        parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n') +
        `\n  (sha256 ${sha256})`,
    };
  }

  const corpus = parsed.data;

  const duplicate = duplicateVerifierCaseProblem(corpus.cases);
  if (duplicate !== null) {
    return { ok: false, reason: `${duplicate}\n  (file ${path}, sha256 ${sha256})` };
  }

  return {
    ok: true,
    corpus,
    path,
    sha256,
    coverage: verifierCoverage(corpus.cases),
    // 'slice' scope: the per-language and per-provenance rules are computed, the
    // Mission 2G shape grids are not, because an external file has no obligation
    // to carry shape labels at all. NOTHING HERE IS FATAL either way.
    coverageGaps: unmetVerifierCoverage(corpus.cases, 'slice'),
    carriesSplits: corpusCarriesSplits(corpus.cases),
  };
}

/**
 * Does `--split` make sense against this external corpus?
 *
 * Returns a refusal string, or `null` when the selection is honest. See the module
 * header for why this is a refusal rather than a fallback in either direction.
 */
export function externalSplitRefusal(
  loaded: LoadedExternalCorpus,
  split: VerifierSplitSelector,
): string | null {
  if (split === 'all') return null;
  if (loaded.carriesSplits) return null;
  return (
    `--split ${split} was requested, and the corpus at ${loaded.path} carries no \`split\` field on any row. ` +
    'Running the whole file would report a full run as a slice and running nothing would report an empty run as a ' +
    "result, so this command does neither. Use `--split all`, or add a `split` of 'dev' or 'heldout' to the rows."
  );
}

/** One line per axis, for the operator's console. Printed for an external corpus. */
export function describeExternalCoverage(loaded: LoadedExternalCorpus): string[] {
  const c = loaded.coverage;
  const lines = [
    `Corpus ${loaded.corpus.corpusVersion} (schema ${loaded.corpus.schemaVersion}) from ${loaded.path}`,
    `  sha256 ${loaded.sha256}`,
    `  ${loaded.corpus.cases.length} case(s): ${c.totalClaims} CLAIM, ${c.totalControls} HONEST_CONTROL`,
    `  by language: en ${c.byLanguage.en.claims}/${c.byLanguage.en.controls}, ` +
      `he ${c.byLanguage.he.claims}/${c.byLanguage.he.controls}, ` +
      `mixed ${c.byLanguage.mixed.claims}/${c.byLanguage.mixed.controls} (claims/controls)`,
    `  claim families: ${c.claimFamilies.join(', ') || '(none)'}`,
    `  control families: ${c.controlFamilies.join(', ') || '(none)'}`,
    `  provenance: ${Object.entries(c.byProvenance).map(([k, v]) => `${k} ${v}`).join(', ') || '(none)'}`,
    `  splits: ${Object.entries(c.bySplit).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  ];
  if (loaded.coverageGaps.length === 0) {
    lines.push('  coverage: every rule the in-repo corpus keeps is also satisfied here');
  } else {
    lines.push(
      `  coverage: ${loaded.coverageGaps.length} rule(s) the in-repo corpus keeps are NOT satisfied here. This is ` +
        'NOT fatal - a sealed evaluation set is a legitimate slice - but every rate below is narrower than the ' +
        'in-repo one by exactly this much:',
    );
    for (const gap of loaded.coverageGaps) lines.push(`    - ${gap}`);
  }
  return lines;
}
