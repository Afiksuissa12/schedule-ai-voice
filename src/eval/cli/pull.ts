/**
 * `npm run eval:pull` - make sure every candidate is on the host.
 *
 * Idempotent: a model already present is reported and skipped. Sequential
 * rather than parallel, because these are multi-gigabyte downloads sharing one
 * link and one disk, and three at once is slower in wall-clock than three in a
 * row while making the progress output unreadable.
 *
 * Prints real sizes and real elapsed times, which are the numbers
 * EVAL_HARNESS.md reports.
 */
import { CANDIDATES, findCandidate, isLocalOrigin, type Candidate } from '../models/candidates.js';
import {
  DEFAULT_OLLAMA_BASE_URL,
  formatBytes,
  getVersion,
  listModels,
  pullModel,
} from '../models/ollamaAdmin.js';

async function main(): Promise<void> {
  const baseUrl = process.env['LOCAL_LLM_BASE_URL'] ?? DEFAULT_OLLAMA_BASE_URL;
  const extra = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  // A tag named on the command line is looked up in the candidate set first, so
  // that naming a LOCAL tag explicitly gets the same "create it, don't pull it"
  // treatment as finding one in the default list. An unknown tag is assumed to
  // be a registry model, which is what it was before this existed.
  const wanted: readonly Candidate[] =
    extra.length > 0
      ? extra.map((tag) => findCandidate(tag) ?? { tag, rationale: '(named on the command line)' })
      : CANDIDATES;

  console.log(`Ollama at ${baseUrl}`);
  try {
    console.log(`  version ${await getVersion(baseUrl)}`);
  } catch (error) {
    console.error(
      `\nCannot reach Ollama at ${baseUrl}. Inside a container, localhost is the container - ` +
        'use host.docker.internal. Set LOCAL_LLM_BASE_URL to override.',
    );
    console.error(error);
    process.exitCode = 1;
    return;
  }

  const present = new Set((await listModels(baseUrl)).map((m) => m.name));
  console.log(`  ${present.size} model(s) already on the host\n`);

  let pulled = 0;
  let failed = 0;
  let localAbsent = 0;

  for (const candidate of wanted) {
    if (present.has(candidate.tag)) {
      console.log(`SKIP  ${candidate.tag} - already present`);
      continue;
    }

    // A LOCALLY-CREATED TAG IS NOT A MISSING DOWNLOAD. `ollama pull` cannot
    // fetch it - there is no registry entry - so attempting one would fail with
    // a misleading network error and, worse, teach a reader that the tag is
    // supposed to come from the registry. It is reported and skipped instead,
    // with the command that actually creates it. Not counted as a failure:
    // these tags are opt-in, and a host that never created one is fine.
    if (isLocalOrigin(candidate)) {
      localAbsent += 1;
      console.log(`LOCAL ${candidate.tag} - not in any registry, so NOT pulled.`);
      if (candidate.localProvenance) {
        console.log(`      Create it on the host:  ollama create ${candidate.tag} -f ${candidate.localProvenance.modelfile}`);
        console.log(`      Base tag (unmodified):  ${candidate.localProvenance.baseTag}`);
      }
      console.log('      See EVAL_HARNESS.md § 9.8. Optional: nothing else needs it.');
      continue;
    }

    console.log(`PULL  ${candidate.tag}`);
    let lastPrinted = 0;
    const result = await pullModel(candidate.tag, {
      baseUrl,
      onProgress: (progress) => {
        if (progress.completedBytes === null || progress.totalBytes === null) return;
        const percent = (progress.completedBytes / progress.totalBytes) * 100;
        // Only when it moves by a whole percent, or the log is unusable.
        if (percent - lastPrinted < 1) return;
        lastPrinted = percent;
        process.stdout.write(
          `\r      ${progress.status} ${formatBytes(progress.completedBytes)} / ` +
            `${formatBytes(progress.totalBytes)} (${percent.toFixed(0)}%)   `,
        );
      },
    });
    process.stdout.write('\n');

    if (result.ok) {
      pulled += 1;
      console.log(
        `OK    ${candidate.tag} - ${formatBytes(result.totalBytes)} in ${(result.durationMs / 1000).toFixed(1)}s`,
      );
    } else {
      failed += 1;
      console.error(`FAIL  ${candidate.tag} - ${result.error}`);
    }
  }

  console.log(
    `\n${pulled} pulled, ${failed} failed, ${wanted.length - pulled - failed - localAbsent} already present` +
      `${localAbsent > 0 ? `, ${localAbsent} local tag(s) for the operator to create` : ''}.`,
  );
  console.log('Run `npm run eval:models` for the full inventory with VRAM figures.');
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('\neval:pull FAILED\n');
  console.error(error);
  process.exitCode = 1;
});
