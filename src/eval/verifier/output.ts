/**
 * Where a verifier-eval run lands on disk, and what it writes there.
 *
 * THE LAYOUT IS A SIBLING OF EVERYTHING ELSE UNDER THE OUTPUT ROOT
 * ---------------------------------------------------------------------------
 *   <outDir>/verifier/<model-slug>.<split>.json   one VerifierEvalReport + conditions
 *   <outDir>/verifier/VERIFIER.<split>.md         the human-readable summary
 *
 * THE `<split>` IS MISSION 2G AND IS NOT COSMETIC. `dev` and `heldout` answer
 * different questions - one is measured on rows the model-facing instruction was
 * tuned against and the other is not - and under corpus 1.0.0 they wrote the SAME
 * filename, so the second silently replaced the first and nothing on disk said
 * which survived. It is in the artefact too (`split`, beside `corpusVersion`); it
 * is in the NAME as well because a file gets copied out of a directory and whoever
 * pastes one into a report should not have to open it to know what it measured.
 *
 * Under the SAME root as `runs/`, `transcripts/` and `environment/`, derived from
 * `EVAL_OUT_DIR`, and nothing is hardcoded to `eval-output/`. That is the rule
 * EVAL_HARNESS.md § 8 states for every path in this harness, and it is what lets a
 * verifier run be written BESIDE the committed read-only evidence rather than on
 * top of it. `tests/eval/verifierEvalReadiness.test.ts` asserts the committed trees
 * are byte-for-byte untouched after exercising this whole path, the same way
 * `tests/eval/customOutputDirectory.test.ts` does for the benchmark report.
 *
 * WHY THE HOST CONDITIONS ARE EMBEDDED RATHER THAN CROSS-REFERENCED
 * ---------------------------------------------------------------------------
 * The numbers this eval produces are LATENCY PERCENTILES, and § 9.1 is explicit
 * that latency is "a property of the machine as much as of the model". A verifier
 * run whose p95 was measured while a browser held two gigabytes of VRAM says
 * nothing about the verifier. So the run reads `environment/<model-slug>.json`
 * through the REAL reader (`src/eval/environment/store.ts`) and copies the
 * identifying fields into its own output.
 *
 * MISSING IS NORMAL AND IS SAID OUT LOUD; MALFORMED THROWS. That asymmetry is
 * `readEnvironmentRecord`'s and is inherited deliberately: `not measured` for a
 * model means its latency row is uncomparable - a gap in the evidence, not a clean
 * result - and the report prints that rather than letting an absence read as an
 * absence of problems.
 *
 * NOTHING HERE WRITES INTO `eval-output/` OR `eval-output-fair-20260927/`. Both are
 * committed read-only evidence and both must stay byte-identical. Fresh output
 * directories are created by the OPERATOR.
 */
import { isAbsolute, join, relative, resolve } from 'node:path';

import { ENVIRONMENT_RECORD_SCHEMA_VERSION, type EnvironmentRecord } from '../environment/schema.js';
import { modelSlug, REPO_ROOT, writeJson, writeText } from '../runner/store.js';
import type { VerifierEvalReport, VerifierLatencyStats, VerifierSliceSummary } from './run.js';

/**
 * The two committed read-only evidence roots. NOTHING may be written into either.
 *
 * `tests/eval/evidenceCompatibility.test.ts` and
 * `tests/eval/rebenchmarkReadiness.test.ts` both assert they stay BYTE-IDENTICAL,
 * and `eval-output-fair-20260927/` in particular cannot be regenerated - you can
 * always re-run a model, but you cannot go back and re-measure what the machine
 * was doing last Tuesday.
 */
export const PROTECTED_EVIDENCE_ROOTS: readonly string[] = ['eval-output', 'eval-output-fair-20260927'];

/**
 * Where this command is allowed to write, or a refusal saying why not.
 *
 * DELIBERATELY STRICTER THAN `eval:run`, WHICH DEFAULTS TO `eval-output/`. That
 * default is pre-existing and this command does not inherit it: a verifier eval
 * has no reason to land beside preliminary benchmark evidence, and an operator who
 * forgets to export `EVAL_OUT_DIR` should get a refusal rather than a directory
 * they then have to prove they did not corrupt. There is no safe default here, so
 * there is no default.
 *
 * Returns a discriminated result rather than throwing, so the CLI can print an
 * instruction and a test can assert the refusal without catching.
 */
export function resolveVerifierOutDir(
  requested: string | undefined,
): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string } {
  if (requested === undefined || requested.trim().length === 0) {
    return {
      ok: false,
      reason:
        'No output directory. Set EVAL_OUT_DIR (or pass --out) to a FRESH directory - not `eval-output/` and ' +
        'not `eval-output-fair-20260927/`, both of which are committed read-only evidence.\n' +
        '    export EVAL_OUT_DIR="$PWD/eval-verifier-$(date +%Y%m%d)"',
    };
  }

  const absolute = isAbsolute(requested) ? resolve(requested) : resolve(REPO_ROOT, requested);

  for (const protectedRoot of PROTECTED_EVIDENCE_ROOTS) {
    const root = resolve(REPO_ROOT, protectedRoot);
    const rel = relative(root, absolute);
    // Inside it, or IS it. `relative` returns '' for the same path and a path
    // starting with '..' for anything outside.
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      return {
        ok: false,
        reason:
          `Refusing to write into \`${protectedRoot}/\`. It is COMMITTED READ-ONLY EVIDENCE and must stay ` +
          'byte-identical - tests/eval/evidenceCompatibility.test.ts asserts exactly that, and the fair run ' +
          'cannot be regenerated. Choose a fresh directory.',
      };
    }
  }

  return { ok: true, path: absolute };
}

/**
 * The identifier on the output file.
 *
 * `@1` is the first. It moves under the same rule as
 * `schedule-ai-voice/eval-results`: a strict SUPERSET bumps it, a restructure
 * bumps it, and a file already written keeps whatever it was written with,
 * because a results file is a record of a measurement and not a document that
 * tracks the current code.
 */
export const VERIFIER_RESULTS_SCHEMA = 'schedule-ai-voice/verifier-eval@2';

/** Named once so the docs, the tests and the CLI cannot disagree with it. */
export const VERIFIER_DIR_NAME = 'verifier';

export function verifierDir(outDir: string): string {
  return join(outDir, VERIFIER_DIR_NAME);
}

/**
 * Same slugging as `runs/`, `transcripts/` and `environment/`, so the four line up
 * by eye - PLUS THE RESOLVED SPLIT, which is Mission 2G and is not cosmetic.
 *
 * `<model-slug>.<split>.json`. A dev run and a held-out run of the same model
 * answer DIFFERENT QUESTIONS - one is measured on rows the instruction was tuned
 * against and the other is not - and in corpus 1.0.0 they would have written the
 * same filename, so the second would have silently replaced the first and nothing
 * on disk would have said which survived. The split is in the artefact too; it is
 * in the NAME as well because a file gets copied out of a directory and an operator
 * pasting one into a report should not have to open it to know what it measured.
 */
export function verifierResultsPath(outDir: string, modelId: string, split: string): string {
  return join(verifierDir(outDir), `${modelSlug(modelId)}.${split}.json`);
}

/** `VERIFIER.<split>.md`, for the same reason. */
export function verifierSummaryPath(outDir: string, split: string): string {
  return join(verifierDir(outDir), `VERIFIER.${split}.md`);
}

/** The conditions, as they are recorded into the output file. */
export interface VerifierEnvironmentBlock {
  /** False means nobody sampled the host for this model. Never read as "conditions were fine". */
  readonly measured: boolean;
  readonly schemaVersion: string | null;
  readonly runId: string | null;
  readonly numCtx: number | null;
  readonly sampledBy: string | null;
  readonly startedAtIso: string | null;
  readonly endedAtIso: string | null;
  readonly samples: number | null;
  readonly modelResidentBytes: number | null;
  /** True when the runtime reported ANY CPU share. A spill invalidates the latency row. */
  readonly spilledToSystemRam: boolean | null;
  readonly note: string | null;
}

export const NO_ENVIRONMENT_RECORD: VerifierEnvironmentBlock = {
  measured: false,
  schemaVersion: null,
  runId: null,
  numCtx: null,
  sampledBy: null,
  startedAtIso: null,
  endedAtIso: null,
  samples: null,
  modelResidentBytes: null,
  spilledToSystemRam: null,
  note: null,
};

export function environmentBlock(record: EnvironmentRecord | null): VerifierEnvironmentBlock {
  if (record === null) return NO_ENVIRONMENT_RECORD;
  return {
    measured: true,
    schemaVersion: record.schemaVersion,
    runId: record.runId,
    numCtx: record.numCtx,
    sampledBy: record.sampledBy,
    startedAtIso: record.startedAtIso,
    endedAtIso: record.endedAtIso,
    samples: record.samples.length,
    modelResidentBytes: record.modelResidentBytes,
    // THREE-VALUED, and the third value is the point. `offload` is null when the
    // runtime reported NO SPLIT AT ALL, which is not the same as reporting a
    // 100% GPU split - so the answer is `null` rather than `false`, exactly as
    // `src/eval/environment/schema.ts` requires. And `cpuBytes` is itself
    // nullable inside a split that WAS reported, so an unknown byte count is also
    // `null` rather than "no spill": `0` is a real value and means no spill,
    // while `null` means nobody said.
    spilledToSystemRam:
      record.offload === null || record.offload.cpuBytes === null ? null : record.offload.cpuBytes > 0,
    note: record.note,
  };
}

export interface VerifierArtefactInput {
  readonly report: VerifierEvalReport;
  readonly environment: VerifierEnvironmentBlock;
  /** Passed in, never read from a clock, so this module is a pure function. */
  readonly generatedAtIso: string;
  /** What the operator asked for on the command line, recorded verbatim. */
  readonly invocation: {
    readonly numCtx: number | null;
    readonly baseUrl: string | null;
    readonly timeoutMs: number | null;
    readonly localeHintSent: boolean;
    readonly languagesRequested: readonly string[];
    /**
     * Mission 2G. The RESOLVED `--split`, and the corpus the run actually read.
     *
     * Optional in the TYPE only so that a caller written against `@1` still
     * compiles; the CLI always supplies all three and `buildJson` falls back to
     * the report's own values rather than to a silence.
     */
    readonly splitRequested?: string;
    readonly corpusFile?: string | null;
    readonly corpusSha256?: string | null;
  };
  /** The Ollama version string, when the CLI could read one. */
  readonly runtimeVersion: string | null;
}

export interface VerifierArtefacts {
  readonly json: unknown;
  readonly markdown: string;
}

export function buildVerifierArtefacts(input: VerifierArtefactInput): VerifierArtefacts {
  return { json: buildJson(input), markdown: buildMarkdown(input) };
}

/** Write both. Creates the directory; never touches anything above it. */
export function writeVerifierArtefacts(outDir: string, input: VerifierArtefactInput): { readonly jsonPath: string; readonly markdownPath: string } {
  const artefacts = buildVerifierArtefacts(input);
  const jsonPath = verifierResultsPath(outDir, input.report.modelId, input.report.split);
  const markdownPath = verifierSummaryPath(outDir, input.report.split);
  writeJson(jsonPath, artefacts.json);
  writeText(markdownPath, artefacts.markdown);
  return { jsonPath, markdownPath };
}

// ---------------------------------------------------------------------------

function buildJson(input: VerifierArtefactInput): unknown {
  return {
    schema: VERIFIER_RESULTS_SCHEMA,
    generatedAtIso: input.generatedAtIso,
    evalVersion: input.report.evalVersion,
    corpusVersion: input.report.corpusVersion,
    corpusSchemaVersion: input.report.corpusSchemaVersion,
    // ---- MISSION 2G: WHAT WAS MEASURED, not only how -----------------------
    // AT THE TOP OF THE FILE and not buried in `invocation`, because these three
    // decide whether two artefacts are comparable at all, exactly as
    // `corpusVersion` does. An operator's sealed run is attributable by the pair
    // (corpusSource, corpusSha256): the path says which file and the digest says
    // which BYTES, and a sealed set that quietly gained a row between two runs is
    // then a visible difference rather than an unexplained number.
    split: input.report.split,
    corpusSource: input.report.corpusSource,
    corpusSha256: input.report.corpusSha256,
    modelId: input.report.modelId,
    verifierName: input.report.verifierName,
    runtimeVersion: input.runtimeVersion,
    invocation: input.invocation,
    environmentRecordSchemaVersion: ENVIRONMENT_RECORD_SCHEMA_VERSION,
    environment: input.environment,
    startedAtIso: input.report.startedAtIso,
    durationMs: input.report.durationMs,
    overall: input.report.overall,
    byLanguage: input.report.byLanguage,
    byProvenance: input.report.byProvenance,
    // EVERY case, with its verdict. The per-case rows are the evidence; the rates
    // above are a summary of them, and a summary nobody can check against the rows
    // is not evidence. This is the same rule EVAL_HARNESS.md § 8 states for
    // transcripts - "a judged score nobody can check against its transcript is not
    // evidence".
    results: input.report.results,
  };
}

function percent(value: number | null): string {
  return value === null ? '`not measured`' : `${(value * 100).toFixed(1)}%`;
}

function ms(value: number | null): string {
  return value === null ? '`n/a`' : `${value.toFixed(0)} ms`;
}

function latencyRow(label: string, stats: VerifierLatencyStats): string {
  return `| ${label} | ${stats.n} | ${ms(stats.p50Ms)} | ${ms(stats.p90Ms)} | ${ms(stats.p95Ms)} | ${ms(stats.p99Ms)} | ${ms(stats.maxMs)} | ${ms(stats.meanMs)} |`;
}

function sliceRow(label: string, slice: VerifierSliceSummary): string {
  return (
    `| ${label} | ${slice.cases} | ${slice.recalledClaims}/${slice.claims} | ${percent(slice.recall)} | ` +
    `${slice.falsePositives}/${slice.controls} | ${percent(slice.falsePositiveRate)} | ` +
    `${slice.malformedOutputs} | ${percent(slice.malformedRate)} | ${percent(slice.failClosedRate)} |`
  );
}

function buildMarkdown(input: VerifierArtefactInput): string {
  const { report, environment } = input;
  const lines: string[] = [];

  lines.push('# Semantic claim verifier — evaluation against a real model');
  lines.push('');
  lines.push(
    `Generated ${input.generatedAtIso}. Model \`${report.modelId}\`, verifier \`${report.verifierName}\`, ` +
      `eval ${report.evalVersion}, corpus ${report.corpusVersion} (schema ${report.corpusSchemaVersion}).`,
  );
  lines.push('');
  lines.push(
    `> **SPLIT: \`${report.split}\`.** Corpus source \`${report.corpusSource}\`` +
      `${report.corpusSha256 === null ? '' : `, sha256 \`${report.corpusSha256}\``}. ` +
      '**A `dev` number and a `heldout` number are different claims and must never be quoted as one another.** ' +
      'The dev half is the half the verifier-tuning task was allowed to read, run and iterate against, so a dev ' +
      'recall figure is partly a measurement of that iteration. The held-out half was never read by it. ' +
      '`all` is both halves together and is therefore neither. See ' +
      '`docs/MISSION_2G_VERIFIER_ROUND.md` §§ 3 and 6.',
  );
  lines.push('');
  lines.push(
    '> **What this measures and what it does not.** It measures whether a MODEL, asked the one question the ' +
      'semantic layer is allowed to ask, recognises a claim. It measures nothing about whether the layered ' +
      'pipeline holds — that is `npm run qa:sweep`, INV-19, and it runs a deterministic double. The two are ' +
      'complementary and neither substitutes for the other. See ' +
      '`docs/MISSION_2F_SEMANTIC_VERIFIER.md`.',
  );
  lines.push('');
  lines.push(
    '> **RECALL is the number this mission exists to move**, because every one of the eight independent QA ' +
      'findings was a claim the deterministic layer missed. **FALSE-POSITIVE RATE is the number that decides ' +
      'whether the product is usable**, because the union is additive: a wrongly-flagged honest sentence costs ' +
      'one regeneration of something true, and at the regeneration bound it costs a hand-off on a conversation ' +
      'in which everything was correct.',
  );
  lines.push('');

  // ---- 1. the headline ----------------------------------------------------
  lines.push('## 1. Recall, false positives and fail-closed outcomes');
  lines.push('');
  lines.push('| Slice | Cases | Recalled | Recall | False pos. | FP rate | Malformed | Malformed rate | Fail-closed rate |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  lines.push(sliceRow('**ALL**', report.overall));
  lines.push(sliceRow('English', report.byLanguage.en));
  lines.push(sliceRow('Hebrew', report.byLanguage.he));
  lines.push(sliceRow('Mixed', report.byLanguage.mixed));
  lines.push('');
  lines.push(
    'A **fail-closed** verdict is neither a hit nor a miss. It is the SAFE outcome in production — the text is ' +
      'withheld and the turn regenerates — so it is counted separately and excluded from both denominators. A ' +
      'verifier that timed out on every claim would show 0 recalled of 0 answered and a 100% fail-closed rate, ' +
      'which is a dead host and not a model that misses everything.',
  );
  lines.push('');

  const kinds = report.overall.failClosedByKind;
  lines.push(
    `Fail-closed by kind, over all ${report.overall.cases} cases: ` +
      `MALFORMED ${kinds['MALFORMED'] ?? 0}, TIMED_OUT ${kinds['TIMED_OUT'] ?? 0}, ` +
      `UNAVAILABLE ${kinds['UNAVAILABLE'] ?? 0}, EMPTY ${kinds['EMPTY'] ?? 0}. ` +
      'The four are named separately because they have completely different fixes.',
  );
  lines.push('');

  // ---- 1A. THE LAYERED TABLE, Mission 2G ----------------------------------
  lines.push('## 1A. Three layers, per language — deterministic, semantic, layered union');
  lines.push('');
  lines.push(
    'The deterministic layer is `detectMaterialClaims` from `src/agent/claimGate/detector.ts`, run over the same ' +
      'text by this harness. The layered column is the REAL `unionClaims` from ' +
      '`src/agent/claimGate/semantic/union.ts` — **imported, not reimplemented**, which is what makes this table ' +
      'evidence about the product rather than about a second copy of the same idea.',
  );
  lines.push('');
  lines.push('| Slice | Claims | Det. recall | Sem. recall | **Layered recall** | Controls | Det. FP | Sem. FP | **Layered FP** |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [label, slice] of [
    ['**ALL**', report.overall],
    ['English', report.byLanguage.en],
    ['Hebrew', report.byLanguage.he],
    ['Mixed', report.byLanguage.mixed],
  ] as const) {
    lines.push(
      `| ${label} | ${slice.claims} | ${percent(slice.deterministicRecall)} | ${percent(slice.recall)} | ` +
        `**${percent(slice.layeredRecall)}** | ${slice.controls} | ` +
        `${percent(slice.deterministicFalsePositiveRate)} | ${percent(slice.falsePositiveRate)} | ` +
        `**${percent(slice.layeredFalsePositiveRate)}** |`,
    );
  }
  lines.push('');
  lines.push(
    '**THE THREE DENOMINATORS ARE NOT THE SAME AND THAT IS NOT A BUG.** The deterministic layer is pure code and ' +
      'has no failure mode, so its denominator is EVERY claim. The semantic layer can fail closed, so its ' +
      'denominator is the claims it ANSWERED. The layered figure is answerable on every case — the deterministic ' +
      'half answered — so its denominator is every claim too. With zero fail-closed verdicts all three ' +
      'denominators coincide; the fail-closed counts in § 1 are how you check that.',
  );
  lines.push('');
  lines.push(
    '**A fail-closed verdict is never counted as a layered hit.** In production it blocks the text, so it is the ' +
      'SAFE outcome — but counting it as recall would let a dead Ollama print as a working gate.',
  );
  lines.push('');

  // ---- 1B. THE NUMBER THIS MISSION IS JUDGED ON ---------------------------
  lines.push('## 1B. MISSED BY BOTH LAYERS — the number this mission is judged on');
  lines.push('');
  lines.push('| Slice | Claims | Missed by BOTH | Sem. layer failed closed | Caught ONLY by the semantic layer |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const [label, slice] of [
    ['**ALL**', report.overall],
    ['English', report.byLanguage.en],
    ['Hebrew', report.byLanguage.he],
    ['Mixed', report.byLanguage.mixed],
  ] as const) {
    lines.push(
      `| ${label} | ${slice.claims} | **${slice.missedByBothClaims}** | ` +
        `${slice.missedByDetectorAndUnansweredClaims} | ${slice.semanticOnlyRecalledClaims} |`,
    );
  }
  lines.push('');
  lines.push(
    '**Column 2 is a LEAK.** Both readers looked at the sentence and neither reported anything, so in production ' +
      'the text would have been released to a caller. **Column 3 is not a leak and is not recall**: the detector ' +
      'missed the claim and the second layer failed closed, which withholds the text and hands the turn to a human ' +
      '— a sick host rather than a blind gate, and a host fix rather than an instruction fix. The two are counted ' +
      'separately for that reason and must never be added together.',
  );
  lines.push('');
  for (const [label, slice] of [
    ['ALL', report.overall],
    ['English', report.byLanguage.en],
    ['Hebrew', report.byLanguage.he],
    ['Mixed', report.byLanguage.mixed],
  ] as const) {
    if (slice.missedByBothCaseIds.length === 0) continue;
    lines.push(`- **${label} — missed by both:** ${slice.missedByBothCaseIds.map((id) => `\`${id}\``).join(', ')}`);
  }
  for (const [label, slice] of [
    ['ALL', report.overall],
    ['English', report.byLanguage.en],
    ['Hebrew', report.byLanguage.he],
    ['Mixed', report.byLanguage.mixed],
  ] as const) {
    if (slice.missedByDetectorAndUnansweredCaseIds.length === 0) continue;
    lines.push(
      `- ${label} — detector missed and the semantic layer failed closed: ` +
        `${slice.missedByDetectorAndUnansweredCaseIds.map((id) => `\`${id}\``).join(', ')}`,
    );
  }
  if (report.overall.missedByBothCaseIds.length === 0 && report.overall.missedByDetectorAndUnansweredCaseIds.length === 0) {
    lines.push(
      '- No claim in this slice was missed by both layers. Check the claim COUNT in the table above before reading ' +
        'that as a result — a slice of zero claims would print the same line.',
    );
  }
  lines.push('');
  lines.push(
    '**Case IDS and not case TEXTS, here and in every failing assertion in this repository.** ' +
      '`tests/eval/verifierAntiOverfitting.test.ts` is the reason: the task that tunes the model-facing ' +
      'instruction runs `npm run test`, and must not be handed a held-out sentence by a report or by a failure ' +
      'message. `docs/MISSION_2G_VERIFIER_ROUND.md` § 6.1.',
  );
  lines.push('');

  // ---- 2. provenance ------------------------------------------------------
  lines.push('## 2. Recall split by provenance — read this before the headline');
  lines.push('');
  lines.push('| Provenance | Cases | Recalled | Recall | False pos. | FP rate |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [provenance, slice] of Object.entries(report.byProvenance)) {
    lines.push(
      `| ${provenance} | ${slice.cases} | ${slice.recalledClaims}/${slice.claims} | ${percent(slice.recall)} | ` +
        `${slice.falsePositives}/${slice.controls} | ${percent(slice.falsePositiveRate)} |`,
    );
  }
  lines.push('');
  lines.push(
    '`RECORDED_MODEL_OUTPUT` is a sentence a benchmarked model really produced. `QA_FINDING` is a wording an ' +
      'independent reviewer really drove end to end through the real system. `NEW_PARAPHRASE` is a wording this ' +
      'corpus author invented and no model has been seen to write. **A headline recall carried by the third row ' +
      'is weaker evidence than the same number carried by the first two**, and the split is here so nobody has ' +
      'to take that on trust.',
  );
  lines.push('');

  // ---- 3. family and status agreement -------------------------------------
  lines.push('## 3. Family and status agreement, on the claims that WERE recalled');
  lines.push('');
  lines.push('| Slice | Recalled | Family agrees | Status agrees |');
  lines.push('| --- | ---: | ---: | ---: |');
  for (const [label, slice] of [
    ['**ALL**', report.overall],
    ['English', report.byLanguage.en],
    ['Hebrew', report.byLanguage.he],
    ['Mixed', report.byLanguage.mixed],
  ] as const) {
    lines.push(
      `| ${label} | ${slice.recalledClaims} | ${slice.familyMatched} (${percent(slice.familyAgreement)}) | ` +
        `${slice.statusMatched} (${percent(slice.statusAgreement)}) |`,
    );
  }
  lines.push('');
  lines.push(
    '**Neither of these is part of recall, deliberately.** A claim in the wrong family still reaches ' +
      'reconciliation, still fails to find a matching effect on an empty ledger, and still blocks the sentence — ' +
      'so a family disagreement does not cost SAFETY. It costs PRECISION on a truthful turn, which is exactly ' +
      'what `docs/MISSION_2D_CLAIM_GATE.md` § 8 limit 9 already records for the deterministic layer.',
  );
  lines.push('');

  // ---- 4. latency ---------------------------------------------------------
  lines.push('## 4. Latency');
  lines.push('');
  lines.push('| Slice | n | p50 | p90 | p95 | p99 | max | mean |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  lines.push(latencyRow('**ALL**', report.overall.latency));
  lines.push(latencyRow('English', report.byLanguage.en.latency));
  lines.push(latencyRow('Hebrew', report.byLanguage.he.latency));
  lines.push(latencyRow('Mixed', report.byLanguage.mixed.latency));
  lines.push('');
  lines.push(
    '**Method.** Wall clock around one `SemanticClaimVerifier.classify` call, `performance.now()`, cases run ' +
      'STRICTLY SEQUENTIALLY. Sequential is a measurement decision rather than simplicity: Ollama batches ' +
      'concurrent requests, batch composition changes floating-point reduction order, and a percentile taken ' +
      'under self-inflicted concurrency describes the harness rather than the model. It also mirrors production, ' +
      'where the gate classifies one customer-facing text at a time on the critical path of one live call.',
  );
  lines.push('');
  lines.push(
    '**This is the number a voice budget is spent against.** It is paid ONCE PER CUSTOMER-FACING TEXT, ' +
      'including every regenerated attempt, so at the regeneration bound of two the worst case is three of these ' +
      'plus the generations themselves. The Founder has said not to reject the architecture solely because it ' +
      'adds latency, and realtime voice optimisation comes later — but the number belongs in front of that ' +
      'decision rather than behind it.',
  );
  lines.push('');

  // ---- 5. conditions ------------------------------------------------------
  lines.push('## 5. Host conditions');
  lines.push('');
  if (!environment.measured) {
    lines.push(
      '**`not measured`.** No `environment/<model-slug>.json` was present under this output root. That is a ' +
        'GAP IN THE EVIDENCE, not a clean result: § 4 above reports latency percentiles, and latency is a ' +
        'property of the machine as much as of the model (EVAL_HARNESS.md § 9.1). **The latency table is ' +
        'uncomparable against any other run** until conditions are recorded. Every other number in this file — ' +
        'recall, false positives, malformed rate — is unaffected, because those are properties of the model and ' +
        'the corpus.',
    );
  } else {
    lines.push(`| Field | Value |`);
    lines.push(`| --- | --- |`);
    lines.push(`| runId | \`${environment.runId ?? 'n/a'}\` |`);
    lines.push(`| sampledBy | \`${environment.sampledBy ?? 'n/a'}\` |`);
    lines.push(`| num_ctx | ${environment.numCtx ?? '`not recorded`'} |`);
    lines.push(`| samples | ${environment.samples ?? 0} |`);
    lines.push(
      `| model resident | ${environment.modelResidentBytes === null ? '`not measured`' : `${(environment.modelResidentBytes / 1024 ** 3).toFixed(2)} GiB`} |`,
    );
    lines.push(
      `| spilled to system RAM | ${environment.spilledToSystemRam === null ? '`runtime reported no split`' : environment.spilledToSystemRam ? '**YES — the latency table above is uncomparable**' : 'no'} |`,
    );
    lines.push(`| note | ${environment.note === null ? '_none_' : environment.note} |`);
    lines.push('');
    if (environment.spilledToSystemRam === true) {
      lines.push(
        '> **THE MODEL SPILLED INTO SYSTEM RAM.** EVAL_HARNESS.md § 9.6 makes this an invalidator. Either free ' +
          'VRAM and re-run, or state the spill next to every latency claim made from this file.',
      );
      lines.push('');
    }
    if (
      input.invocation.numCtx !== null &&
      environment.numCtx !== null &&
      input.invocation.numCtx !== environment.numCtx
    ) {
      lines.push(
        `> **THE RECORDED \`num_ctx\` (${environment.numCtx}) DOES NOT MATCH THE ONE THIS RUN WAS INVOKED WITH ` +
          `(${input.invocation.numCtx}).** One of the two is describing a different run. EVAL_HARNESS.md § 9.6.`,
      );
      lines.push('');
    }
  }

  // ---- 6. invocation ------------------------------------------------------
  lines.push('## 6. Exactly what was run');
  lines.push('');
  lines.push(`- Ollama runtime: \`${input.runtimeVersion ?? 'not recorded'}\``);
  lines.push(`- \`num_ctx\`: ${input.invocation.numCtx ?? 'provider default'}`);
  lines.push(`- base URL: \`${input.invocation.baseUrl ?? 'default'}\``);
  lines.push(`- verifier deadline: ${input.invocation.timeoutMs === null ? 'module default' : `${input.invocation.timeoutMs} ms`}`);
  lines.push(
    `- locale hint sent to the verifier: **${input.invocation.localeHintSent ? 'YES — this is NOT the production request shape' : 'no (production shape: ClaimGate sends text + correlationId only)'}**`,
  );
  lines.push(`- languages: ${input.invocation.languagesRequested.join(', ')}`);
  lines.push(`- split: **${input.invocation.splitRequested ?? report.split}**`);
  lines.push(
    `- corpus: \`${input.invocation.corpusFile ?? report.corpusSource}\`` +
      `${report.corpusSha256 === null ? ' (in-repo — the corpus version above identifies it)' : `, sha256 \`${report.corpusSha256}\``}`,
  );
  lines.push(`- run started ${report.startedAtIso}, took ${(report.durationMs / 1000).toFixed(1)} s`);
  lines.push('');
  lines.push(
    'Determinism controls in force on every request, from `src/agent/claimGate/semantic/llmSemanticClaimVerifier.ts`: ' +
      'temperature 0, a fixed seed, a JSON Schema in Ollama `format`, **no tools at all**, a constant instruction, ' +
      'and a bounded deadline in application code. What is NOT guaranteed — Ollama batching, GPU kernel ' +
      'non-determinism, quantisation, runtime version, model swap — is listed in ' +
      '`docs/MISSION_2F_SEMANTIC_VERIFIER.md` § 7. The sampler is pinned, the shape is constrained, the runtime ' +
      'is not reproducible.',
  );
  lines.push('');

  // ---- 7. the per-case rows a reader can check ----------------------------
  lines.push('## 7. Every case that was NOT classified as expected');
  lines.push('');
  const interesting = report.results.filter(
    (r) => r.recalled === false || r.falsePositive === true || r.verdictKind !== 'CLASSIFIED',
  );
  if (interesting.length === 0) {
    lines.push(
      'None. Every claim was recalled, every control was left alone, and every verdict was `CLASSIFIED`. ' +
        'Check the per-case `results` array in the JSON file beside this one before reading that as a perfect ' +
        'score — a corpus of 0 cases would print the same sentence, and the counts in § 1 are what say it did not.',
    );
  } else {
    lines.push('| Case | Lang | Kind | Verdict | What happened |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const result of interesting) {
      const what =
        result.verdictKind !== 'CLASSIFIED'
          ? `fail-closed: ${result.failureReason ?? '(no reason)'}`
          : result.recalled === false
            ? `MISSED — expected ${result.expectedFamily}/${result.expectedStatus}, got ${result.totalClaims} claim(s), ${result.contributingClaims} contributing`
            : `FALSE POSITIVE — reported ${result.reportedFamilies.join(', ')}`;
      lines.push(
        `| \`${result.caseId}\` | ${result.language} | ${result.kind} | ${result.verdictKind} | ${what} |`,
      );
    }
  }
  lines.push('');
  lines.push(
    '**A MISS here is not a leak.** The union is additive: the deterministic layer\'s own finding on the same ' +
      'text stands whatever the semantic layer says, and for most rows in this corpus the deterministic layer ' +
      'now catches the claim too. The rows where a miss really would be a leak are the ones ' +
      '`docs/MISSION_2D_CLAIM_GATE.md` records as LIVE deterministic misses — `I took your meeting off the ' +
      'calendar.` (§ 8 limit 10), `Booked.` with no object (§ 8 limit 1) and `**Status**` + newline + `booked …` ' +
      '(§ 19.6 point 1) — and for those three the semantic layer is the only layer.',
  );
  lines.push('');

  return `${lines.join('\n')}\n`;
}
