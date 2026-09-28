/**
 * `npm run eval:models` - the candidate inventory, with real VRAM figures.
 *
 * Loads each model one at a time at the benchmark's own `num_ctx`, reads
 * `/api/ps` while it is resident, and then releases it. Loading at the context
 * length the benchmark actually uses matters: the KV cache is a real part of
 * the footprint, and an inventory taken at a smaller context would understate
 * every model by a few hundred megabytes and could make one look like it fits
 * when it does not.
 *
 * Writes `<outDir>/models.json`, which IS committed - the Founder Review cites
 * these numbers.
 */
import { join } from 'node:path';

import { CANDIDATES, isLocalOrigin, REJECTED } from '../models/candidates.js';
import {
  DEFAULT_OLLAMA_BASE_URL,
  formatBytes,
  getVersion,
  listModels,
  measureResidentVram,
  showModel,
} from '../models/ollamaAdmin.js';
import { DEFAULT_OUT_DIR, writeJson } from '../runner/store.js';
import type { ModelInventoryEntry } from '../types.js';

/** The working ceiling on the mission host: 8188 MiB card, headroom reserved. */
const VRAM_BUDGET_BYTES = 7.5 * 2 ** 30;

async function main(): Promise<void> {
  const baseUrl = process.env['LOCAL_LLM_BASE_URL'] ?? DEFAULT_OLLAMA_BASE_URL;
  const outDir = process.env['EVAL_OUT_DIR'] ?? DEFAULT_OUT_DIR;
  const numCtx = Number(process.env['EVAL_NUM_CTX'] ?? 8192);

  const version = await getVersion(baseUrl);
  const tags = await listModels(baseUrl);
  const byName = new Map(tags.map((t) => [t.name, t]));

  console.log(`Ollama ${version} at ${baseUrl}`);
  console.log(`Measuring resident VRAM at num_ctx=${numCtx}, budget ${formatBytes(VRAM_BUDGET_BYTES)}\n`);

  const entries: ModelInventoryEntry[] = [];

  for (const candidate of CANDIDATES) {
    const tag = byName.get(candidate.tag);
    if (!tag) {
      // Different advice for a local tag: `eval:pull` cannot produce it.
      console.log(
        isLocalOrigin(candidate)
          ? `ABSENT  ${candidate.tag} - operator-created tag; ` +
            `\`ollama create ${candidate.tag} -f ${candidate.localProvenance?.modelfile ?? '<modelfile>'}\``
          : `ABSENT  ${candidate.tag} - run \`npm run eval:pull\``,
      );
      entries.push({
        tag: candidate.tag,
        present: false,
        parameterSize: null,
        quantizationLevel: null,
        family: null,
        contextLength: null,
        diskSizeBytes: null,
        capabilities: [],
        vramBytes: null,
        vramContextLength: null,
        rationale: candidate.rationale,
        withinVramBudget: null,
        ...(candidate.localProvenance ? { localOrigin: candidate.localProvenance } : {}),
      });
      continue;
    }

    const shown = await showModel(candidate.tag, baseUrl).catch(() => null);
    const details = shown?.details ?? tag.details ?? {};
    const capabilities = shown?.capabilities ?? tag.capabilities ?? [];

    process.stdout.write(`LOADING ${candidate.tag} ...`);
    let vramBytes: number | null = null;
    let vramContextLength: number | null = null;
    let loadMs = 0;
    try {
      const measured = await measureResidentVram(candidate.tag, { baseUrl, numCtx, keepAlive: '30s' });
      vramBytes = measured.vramBytes;
      vramContextLength = measured.contextLength;
      loadMs = measured.loadMs;
      process.stdout.write('\r');
    } catch (error) {
      process.stdout.write('\r');
      console.log(`WARN    ${candidate.tag} - could not measure VRAM: ${String(error)}`);
    }

    const withinBudget = vramBytes === null ? null : vramBytes <= VRAM_BUDGET_BYTES;

    console.log(
      `OK      ${candidate.tag.padEnd(30)} ${(details.parameter_size ?? '?').padStart(6)} ` +
        `${(details.quantization_level ?? '?').padEnd(8)} disk ${formatBytes(tag.size)} ` +
        `VRAM ${formatBytes(vramBytes)} @ ctx ${vramContextLength ?? '?'} ` +
        `${withinBudget === null ? '' : withinBudget ? '(fits)' : '(OVER BUDGET)'} ` +
        `load ${(loadMs / 1000).toFixed(1)}s [${capabilities.join(',')}]`,
    );

    entries.push({
      tag: candidate.tag,
      present: true,
      parameterSize: details.parameter_size ?? null,
      quantizationLevel: details.quantization_level ?? null,
      family: details.family ?? null,
      contextLength: details.context_length ?? null,
      diskSizeBytes: tag.size,
      capabilities,
      vramBytes,
      vramContextLength,
      rationale: candidate.rationale,
      withinVramBudget: withinBudget,
      ...(candidate.localProvenance ? { localOrigin: candidate.localProvenance } : {}),
    });
  }

  const path = join(outDir, 'models.json');
  writeJson(path, {
    measuredAtIso: new Date().toISOString(),
    ollamaVersion: version,
    baseUrl,
    numCtx,
    vramBudgetBytes: VRAM_BUDGET_BYTES,
    hardwareNote:
      'NVIDIA GeForce RTX 4060 Laptop GPU, 8188 MiB VRAM, driver 566.24, CUDA 12.7; Intel Core i9-14900HX ' +
      '24c/32t; 31.71 GB RAM. Measured on the host by the Coordinator, not re-derived in the container.',
    candidates: entries,
    rejected: REJECTED,
  });

  console.log(`\nWrote ${path}`);
  const over = entries.filter((e) => e.withinVramBudget === false);
  if (over.length > 0) {
    console.log(`WARNING: ${over.map((e) => e.tag).join(', ')} exceeded the ${formatBytes(VRAM_BUDGET_BYTES)} budget.`);
  }
  // An absent REGISTRY model is a broken inventory and exits non-zero. An absent
  // LOCAL tag is not: it is opt-in, the operator may simply not have created it,
  // and failing the inventory over it would make `eval:models` red on every host
  // that never ran the experiment.
  const absent = entries.filter((e) => !e.present);
  const absentRegistry = absent.filter((e) => !e.localOrigin);
  const absentLocal = absent.filter((e) => e.localOrigin);
  if (absentRegistry.length > 0) {
    console.log(`MISSING: ${absentRegistry.map((e) => e.tag).join(', ')} - run \`npm run eval:pull\`.`);
    process.exitCode = 1;
  }
  if (absentLocal.length > 0) {
    console.log(
      `NOT CREATED (optional, operator-owned): ${absentLocal.map((e) => e.tag).join(', ')} - ` +
        'see EVAL_HARNESS.md § 9.8. Not an error.',
    );
  }
}

main().catch((error: unknown) => {
  console.error('\neval:models FAILED\n');
  console.error(error);
  process.exitCode = 1;
});
