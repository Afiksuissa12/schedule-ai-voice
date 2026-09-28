/**
 * `npm run eval:verifier` - the REAL semantic claim verifier against a REAL model.
 *
 *   export EVAL_OUT_DIR="$PWD/eval-verifier-$(date +%Y%m%d)"
 *   npm run eval:verifier                                   the configured local model
 *   npm run eval:verifier -- --model qwen2.5:7b-instruct
 *   npm run eval:verifier -- --model aya-expanse:8b --num-ctx 16384
 *   npm run eval:verifier -- --language he                  Hebrew slice only
 *   npm run eval:verifier -- --limit 10                     a smoke run
 *
 * WHAT IT IS FOR, IN ONE PARAGRAPH
 * ---------------------------------------------------------------------------
 * Everything green in this repository is evidence that the LAYERED PIPELINE
 * holds - the semantic layer is on every path, the union is additive, a
 * fail-closed verdict blocks a release. NONE of it is evidence that the semantic
 * layer CLASSIFIES anything, because `npm test`, `npm run qa:sweep` and
 * `npm run slice:demo` all wire a rule-less double that returns `CLASSIFIED` with
 * an empty claim list for every text. `MISSION-2F-...-AUTO-ADVERSARIAL-ASSURANCE`
 * states that as its first residual limit and calls it "the most over-readable
 * number in the report". **This command is the only thing in the repository that
 * can produce the other kind of evidence, and only an OPERATOR can run it.**
 *
 * THIS COMMAND TALKS TO A MODEL. It is never part of `npm test`, `npm run build`
 * or `npm run qa:sweep`, and nothing in the default import graph reaches
 * `src/eval` - which is what keeps the sweep's network trap at zero attempts. It
 * was NOT run by the team that wrote it: `tests/eval/verifierEvalReadiness.test.ts`
 * proves this whole path against a verifier DOUBLE instead, the same way
 * `tests/eval/rebenchmarkReadiness.test.ts` proves the re-benchmark without
 * spending hours of GPU time finding out.
 *
 * IT WILL REFUSE TO WRITE INTO THE COMMITTED EVIDENCE, and it will refuse to run
 * with no output directory at all rather than picking one. See
 * `resolveVerifierOutDir`.
 */
import { loadLocalLlmConfig } from '../../config/env.js';
import { LlmSemanticClaimVerifier } from '../../agent/claimGate/semantic/index.js';
import { LocalLlmProvider } from '../../llm/localLlmProvider.js';
import { readEnvironmentRecord } from '../environment/store.js';
import { DEFAULT_OLLAMA_BASE_URL, getVersion, listModels } from '../models/ollamaAdmin.js';
import { parseVerifierArgs } from '../verifier/args.js';
import { casesForLanguage, loadVerifierCorpus } from '../verifier/corpus.js';
import { environmentBlock, writeVerifierArtefacts } from '../verifier/output.js';
import { runVerifierEval } from '../verifier/run.js';
import type { VerifierCase } from '../verifier/schema.js';

async function main(): Promise<void> {
  const parsed = parseVerifierArgs(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    console.error(`\neval:verifier: ${parsed.reason}\n`);
    process.exitCode = 1;
    return;
  }
  const args = parsed.args;

  // ---- the corpus, before anything is dialled -----------------------------
  // It throws on a malformed case, a duplicate id, a duplicate text or an unmet
  // coverage rule. Loading it FIRST means a corpus defect costs a second rather
  // than being discovered after a model has been loaded.
  const corpus = loadVerifierCorpus();
  const selected: VerifierCase[] = [];
  for (const language of args.languages) selected.push(...casesForLanguage(corpus.cases, language));
  const cases = args.limit === null ? selected : selected.slice(0, args.limit);

  if (cases.length === 0) {
    console.error(`No cases matched languages: ${args.languages.join(', ')}.`);
    process.exitCode = 1;
    return;
  }

  // ---- which model ---------------------------------------------------------
  // `CLAIM_VERIFIER_MODEL` defaults to EMPTY, which means USE THE CONFIGURED
  // LOCAL MODEL. That is not a second copy of the tag - it resolves to
  // `localLlmModel` - so raising `LOCAL_LLM_MODEL` cannot leave the verifier
  // behind. NO MODEL DEFAULT IN THIS REPOSITORY WAS CHANGED by this command, and
  // `--model` overrides for one run only and writes nothing back.
  const config = loadLocalLlmConfig();
  const configuredModel = config.claimVerifierModel ?? config.localLlmModel;
  const modelId = args.model ?? configuredModel;
  const baseUrl = args.baseUrl ?? config.localLlmBaseUrl ?? DEFAULT_OLLAMA_BASE_URL;
  const timeoutMs = args.timeoutMs ?? config.claimVerifierTimeoutMs;

  // ---- preflight: fail here, not two hundred cases in ----------------------
  let runtimeVersion: string;
  try {
    runtimeVersion = await getVersion(baseUrl);
  } catch {
    console.error(
      `Cannot reach Ollama at ${baseUrl}. Inside a container, localhost is the container - use ` +
        'host.docker.internal, or set LOCAL_LLM_BASE_URL.',
    );
    process.exitCode = 1;
    return;
  }

  const present = new Set((await listModels(baseUrl)).map((m) => m.name));
  if (!present.has(modelId)) {
    console.error(
      `The model \`${modelId}\` is not on the host at ${baseUrl}.\n` +
        `  It was resolved from ${args.model !== null ? '--model' : config.claimVerifierModel !== null ? 'CLAIM_VERIFIER_MODEL' : 'LOCAL_LLM_MODEL (CLAIM_VERIFIER_MODEL is unset, which means "use the configured local model")'}.\n` +
        '  Run `npm run eval:models` to see what is present, and `npm run eval:pull` for a registry model.',
    );
    process.exitCode = 1;
    return;
  }

  // ---- the REAL verifier, over a REAL provider -----------------------------
  // `streamByDefault` is FALSE, deliberately and unlike `runModel`. The benchmark
  // streams because time-to-first-token is the number a voice milestone depends
  // on. This request has no first token worth hearing - it is a JSON object
  // nobody speaks - and what the gate waits for is the WHOLE answer. Streaming it
  // would measure something the gate cannot use.
  //
  // `maxRetries: 0` so a failure is recorded as a failure instead of being quietly
  // retried into a slower success, which is `runModel`'s rule and matters more
  // here: a retry would turn an UNAVAILABLE verdict - a row of this eval - into a
  // latency outlier.
  const provider = new LocalLlmProvider({
    model: modelId,
    temperature: 0,
    numCtx: args.numCtx,
    keepAlive: '30m',
    timeoutMs: 120_000,
    maxRetries: 0,
    streamByDefault: false,
    baseUrl,
  });
  const verifier = new LlmSemanticClaimVerifier({ llm: provider, timeoutMs });

  console.log(`Ollama ${runtimeVersion} at ${baseUrl}`);
  console.log(
    `Verifier corpus ${corpus.corpusVersion} (schema ${corpus.schemaVersion}): ${cases.length} of ` +
      `${corpus.cases.length} case(s), languages ${args.languages.join(', ')}`,
  );
  console.log(`Model ${modelId}, num_ctx ${args.numCtx}, verifier deadline ${timeoutMs} ms`);
  console.log(
    `Locale hint: ${args.localeHint ? 'SENT - NOTE, this is NOT the production request shape' : 'not sent (production shape)'}`,
  );
  console.log(`Output ${args.outDir}\n`);

  const startedAtIso = new Date().toISOString();
  const report = await runVerifierEval({
    verifier,
    cases,
    corpusVersion: corpus.corpusVersion,
    corpusSchemaVersion: corpus.schemaVersion,
    modelId,
    startedAtIso,
    sendLocaleHint: args.localeHint,
    log: (message) => console.log(message),
  });

  // Read through the REAL reader, so a malformed record stops the run rather than
  // becoming a blank cell. MISSING is normal and returns null; the report then
  // says `not measured` and states that the latency table is uncomparable.
  const environment = environmentBlock(readEnvironmentRecord(args.outDir, modelId));

  const written = writeVerifierArtefacts(args.outDir, {
    report,
    environment,
    generatedAtIso: new Date().toISOString(),
    invocation: {
      numCtx: args.numCtx,
      baseUrl,
      timeoutMs,
      localeHintSent: args.localeHint,
      languagesRequested: args.languages,
    },
    runtimeVersion,
  });

  const overall = report.overall;
  console.log('');
  console.log(`RECALL on claims        : ${overall.recalledClaims}/${overall.claims - overall.claimsNotAnswered} answered (${format(overall.recall)})`);
  console.log(`FALSE POSITIVES         : ${overall.falsePositives}/${overall.controls - overall.controlsNotAnswered} answered (${format(overall.falsePositiveRate)})`);
  console.log(`MALFORMED OUTPUT RATE   : ${format(overall.malformedRate)} (${overall.malformedOutputs} of ${overall.cases})`);
  console.log(`FAIL-CLOSED RATE        : ${format(overall.failClosedRate)}`);
  console.log(
    `LATENCY p50/p95/p99     : ${round(overall.latency.p50Ms)} / ${round(overall.latency.p95Ms)} / ${round(overall.latency.p99Ms)} ms`,
  );
  console.log('');
  for (const language of args.languages) {
    const slice = report.byLanguage[language];
    console.log(
      `  ${language.padEnd(6)} recall ${format(slice.recall).padStart(6)}  FP ${format(slice.falsePositiveRate).padStart(6)}  ` +
        `malformed ${format(slice.malformedRate).padStart(6)}  p95 ${round(slice.latency.p95Ms)} ms`,
    );
  }
  console.log('');
  if (!environment.measured) {
    console.log(
      `NOTE: no host conditions were recorded at ${args.outDir}/environment/. The latency numbers above are ` +
        'UNCOMPARABLE against any other run until they are. EVAL_HARNESS.md sections 9.1 and 9.3.',
    );
  }
  console.log(`Wrote ${written.jsonPath}`);
  console.log(`Wrote ${written.markdownPath}`);
}

function format(rate: number | null): string {
  return rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`;
}

function round(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(0);
}

main().catch((error: unknown) => {
  console.error('\neval:verifier FAILED\n');
  console.error(error);
  process.exitCode = 1;
});
