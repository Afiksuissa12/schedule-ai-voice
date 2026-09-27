/**
 * `npm run qa:claim-gate-latency` - print what the claim gate costs.
 *
 * Exists so the latency table in `docs/MISSION_2D_CLAIM_GATE_ASSURANCE.md` is
 * REPRODUCIBLE rather than quoted. A number in a document that nobody can re-run
 * is an assertion; a number with a command beside it is evidence, and that
 * distinction is the whole reason § 7 of the founder review re-ran its six
 * commands rather than copying figures forward.
 *
 * Calls no model, pulls no model, runs no benchmark. One real SQLite database, one
 * seeded world, `ScriptedLlmProvider`, and a stopwatch.
 *
 *   npm run qa:claim-gate-latency
 *   npm run qa:claim-gate-latency -- --runs 500
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { measureClaimGateLatency, renderLatencyReport } from '../claimGate/claimGateLatency.js';

function flag(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return '';
  return process.argv[index + 1] ?? '';
}

async function main(): Promise<void> {
  const runsFlag = Number(flag('runs'));
  const runs = Number.isFinite(runsFlag) && runsFlag > 0 ? runsFlag : 200;

  console.log(`Measuring the claim gate over ${runs} runs per pure measurement. No model is called.\n`);

  const report = await measureClaimGateLatency({ runs });
  const text = renderLatencyReport(report);
  console.log(text);

  const out = join(process.cwd(), '.tmp', 'qa', 'claim-gate-latency.txt');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${text}\n`, 'utf8');
  writeFileSync(out.replace(/\.txt$/, '.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\nWritten to .tmp/qa/claim-gate-latency.{txt,json}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
