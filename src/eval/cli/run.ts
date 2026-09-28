/**
 * `npm run eval:run` - the benchmark.
 *
 *   npm run eval:run                        every candidate, every scenario
 *   npm run eval:run -- --model qwen2.5:7b-instruct
 *   npm run eval:run -- --scenario hebrew-intro-and-booking --scenario cancellation
 *   npm run eval:run -- --force             re-run scenarios already recorded
 *   npm run eval:run -- --skip-judge        programmatic results only, much faster
 *
 * RESUMABLE BY DEFAULT. Each (model, scenario) writes its own file the moment
 * it finishes, and a re-run skips what is already on disk. A run interrupted
 * after an hour loses the scenario in flight and nothing else.
 *
 * THIS COMMAND TALKS TO A MODEL AND IS NEVER PART OF `npm test` OR
 * `npm run qa:sweep`. Nothing in the default import graph reaches `src/eval`,
 * which is what keeps the sweep's network trap at zero attempts.
 */
import { loadCorpus } from '../corpus/index.js';
import { defaultBenchmarkTags, findCandidate, isLocalOrigin } from '../models/candidates.js';
import { DEFAULT_OLLAMA_BASE_URL, getVersion, listModels } from '../models/ollamaAdmin.js';
import { JUDGE_MODELS } from '../rubric/judge.js';
import { runModel } from '../runner/runModel.js';
import { DEFAULT_OUT_DIR } from '../runner/store.js';

interface Args {
  readonly models: string[];
  readonly scenarios: string[];
  readonly force: boolean;
  readonly skipJudge: boolean;
  readonly numCtx: number | undefined;
  readonly assembledContext: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const models: string[] = [];
  const scenarios: string[] = [];
  let force = false;
  let skipJudge = false;
  let assembledContext = true;
  const fromEnv = process.env['EVAL_NUM_CTX'];
  let numCtx = fromEnv ? Number(fromEnv) : undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--model' || arg === '-m') models.push(String(argv[(i += 1)]));
    else if (arg === '--scenario' || arg === '-s') scenarios.push(String(argv[(i += 1)]));
    else if (arg === '--force' || arg === '-f') force = true;
    else if (arg === '--skip-judge') skipJudge = true;
    else if (arg === '--baseline-context') assembledContext = false;
    else if (arg === '--num-ctx') numCtx = Number(argv[(i += 1)]);
  }

  return { models, scenarios, force, skipJudge, numCtx, assembledContext };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = process.env['LOCAL_LLM_BASE_URL'] ?? DEFAULT_OLLAMA_BASE_URL;
  // The two context modes write to DIFFERENT directories. Results from the
  // assembled-context path and the Baseline V1 path are not comparable - the
  // system prompt, the window and the fixed overhead all differ - and one
  // shared directory would let a resumed run silently blend them.
  const outDir =
    process.env['EVAL_OUT_DIR'] ?? (args.assembledContext ? DEFAULT_OUT_DIR : `${DEFAULT_OUT_DIR}-baseline-context`);
  const numCtx = args.numCtx ?? (args.assembledContext ? 16_384 : 8192);

  const corpus = loadCorpus();
  const scenarios =
    args.scenarios.length > 0
      ? corpus.scenarios.filter((s) => args.scenarios.includes(s.id))
      : corpus.scenarios;

  if (scenarios.length === 0) {
    console.error(`No scenarios matched. Known ids:\n  ${corpus.scenarios.map((s) => s.id).join('\n  ')}`);
    process.exitCode = 1;
    return;
  }

  // ---- preflight: fail here, not forty minutes in --------------------------
  let version: string;
  try {
    version = await getVersion(baseUrl);
  } catch {
    console.error(
      `Cannot reach Ollama at ${baseUrl}. Inside a container, localhost is the container - use ` +
        'host.docker.internal, or set LOCAL_LLM_BASE_URL.',
    );
    process.exitCode = 1;
    return;
  }

  const present = new Set((await listModels(baseUrl)).map((m) => m.name));
  // `defaultBenchmarkTags()` is the registry candidates only. A locally-created
  // tag has to be asked for by name with `--model`, because most hosts will not
  // have created one and a default run must not fail on a tag nobody requested.
  const requested = args.models.length > 0 ? args.models : defaultBenchmarkTags();
  const missing = requested.filter((tag) => !present.has(tag));

  if (missing.length > 0) {
    console.error(`These models are not on the host: ${missing.join(', ')}`);
    // A local tag is missing for a different reason and needs different advice:
    // `eval:pull` will never produce it, so saying "run eval:pull" would send
    // the operator around a loop that cannot terminate.
    for (const tag of missing) {
      const candidate = findCandidate(tag);
      if (candidate && isLocalOrigin(candidate) && candidate.localProvenance) {
        console.error(
          `  ${tag} is an OPERATOR-CREATED LOCAL TAG, not a registry model. Create it with:\n` +
            `    ollama create ${tag} -f ${candidate.localProvenance.modelfile}\n` +
            `  It is built on ${candidate.localProvenance.baseTag}, which it does not modify. See EVAL_HARNESS.md § 9.8.`,
        );
      }
    }
    if (missing.some((tag) => !findCandidate(tag) || !isLocalOrigin(findCandidate(tag)!))) {
      console.error('Run `npm run eval:pull` for the registry models above.');
    }
    process.exitCode = 1;
    return;
  }

  if (!args.skipJudge) {
    const judgesMissing = JUDGE_MODELS.filter((tag) => !present.has(tag));
    if (judgesMissing.length > 0) {
      console.error(
        `Judge model(s) absent: ${judgesMissing.join(', ')}. Pull them, or pass --skip-judge to record ` +
          'programmatic results only.',
      );
      process.exitCode = 1;
      return;
    }
  }

  console.log(`Ollama ${version} at ${baseUrl}`);
  console.log(`Corpus ${corpus.corpusVersion} (schema ${corpus.schemaVersion}): ${scenarios.length} scenario(s)`);
  console.log(`Models: ${requested.join(', ')}`);
  console.log(
    `Context: ${args.assembledContext ? 'ASSEMBLED (production path, sales-scheduler-local@v2)' : 'BASELINE V1 (comparison only)'}`,
  );
  console.log(`num_ctx ${numCtx}, judges ${args.skipJudge ? 'DISABLED' : JUDGE_MODELS.join(' + ')}`);
  console.log(`Output ${outDir}\n`);

  const started = Date.now();

  for (const modelId of requested) {
    console.log(`\n=== ${modelId} ===`);
    const summary = await runModel({
      modelId,
      scenarios,
      outDir,
      baseUrl,
      numCtx,
      force: args.force,
      skipJudge: args.skipJudge,
      assembledContext: args.assembledContext,
      log: (message) => console.log(message),
    });
    console.log(
      `--- ${modelId}: ${summary.ran} run, ${summary.skipped} skipped, ${summary.errored} errored, ` +
        `${(summary.durationMs / 1000 / 60).toFixed(1)} min`,
    );
  }

  console.log(`\nTotal ${(Date.now() - started) / 1000 / 60} minutes.`);
  console.log('Run `npm run eval:report` to produce results.json and COMPARISON.md.');
}

main().catch((error: unknown) => {
  console.error('\neval:run FAILED\n');
  console.error(error);
  process.exitCode = 1;
});
