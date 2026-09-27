/**
 * Shared scaffolding for this milestone's runnable proofs.
 *
 * WHY THESE ARE CLIs AND NOT TESTS
 * ---------------------------------------------------------------------------
 * `vitest.config.ts` includes only `tests/**`, and this mission may edit
 * neither that file nor that directory. A proof therefore has to be a program.
 * That constraint turned out to cost less than expected and buy something:
 * these run identically on a developer's machine and in CI, with no test
 * runner, and they print their evidence rather than just their verdict - so a
 * reviewer reading the output can see the numbers the assertion was made on.
 *
 * WHAT IS NOT COMPROMISED
 * ---------------------------------------------------------------------------
 * They assert, and they exit non-zero. `assert` below throws; `runProofs`
 * catches, reports, and sets `process.exitCode`. A proof that cannot fail is
 * not a proof, so each one also asserts its own preconditions - that the window
 * really did have to drop turns, that the ladder really did have to reduce -
 * rather than passing vacuously on a conversation too short to test anything.
 *
 * DATABASE LIFECYCLE
 * ---------------------------------------------------------------------------
 * Each run gets a fresh SQLite file under `.tmp/`, built by the same
 * `prisma db push` the demo uses, and deleted afterwards. Nothing here can
 * touch a development database, reach a network, or cost money: the clock is
 * fixed, the providers are the deterministic doubles, and no model is called
 * unless a proof explicitly wires a scripted one.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { llmToolDefinitions, TOOL_NAMES } from '../agent/tools/definitions.js';
import { buildSystemPrompt, LOCAL_BRAIN_SYSTEM_PROMPT_REF } from '../agent/prompt/systemPrompt.js';
import { createDatabase, type Database } from '../db/database.js';
import { prismaDbPushArgs } from '../db/prismaCli.js';
import { FixedClock } from '../ports/clock.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');

/**
 * Wednesday 2026-03-04, 10:00 America/New_York.
 *
 * The same instant `npm run slice:demo` pins, so a rendered context printed by
 * these tools lines up with the demo's transcript rather than being a second,
 * subtly different world.
 */
export const PROOF_NOW_UTC = '2026-03-04T15:00:00.000Z';

export interface ProofWorld {
  readonly db: Database;
  readonly clock: FixedClock;
}

/** Run `fn` against a throwaway database, and clean up whatever happens. */
export async function withTemporaryDatabase<T>(fn: (world: ProofWorld) => Promise<T>): Promise<T> {
  const databasePath = join(REPO_ROOT, '.tmp', `context-proof-${process.pid}-${randomUUID().slice(0, 8)}.db`);
  mkdirSync(dirname(databasePath), { recursive: true });
  applySchema(databasePath);

  const clock = new FixedClock(PROOF_NOW_UTC);
  const db = createDatabase({ datasourceUrl: `file:${databasePath}`, clock, log: ['error'] });

  try {
    return await fn({ db, clock });
  } finally {
    await db.disconnect();
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }
  }
}

function applySchema(databasePath: string): void {
  execFileSync(
    process.execPath,
    prismaDbPushArgs(join(REPO_ROOT, 'prisma', 'schema.prisma')),
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: `file:${databasePath.replace(/\\/g, '/')}`,
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
      stdio: 'pipe',
    },
  );
}

/**
 * What a turn costs before any context: the real system prompt plus the real
 * tool schemas.
 *
 * MEASURED, not assumed. The budget in `contextWindow.ts` subtracts this from
 * the model's context length, so a guess here would silently make every budget
 * wrong. The local-brain composition is used because that is the one a
 * deployment running this context would pin.
 */
export function measureFixedOverheadChars(): { total: number; promptChars: number; toolSchemaChars: number } {
  const prompt = buildSystemPrompt({
    promptRef: LOCAL_BRAIN_SYSTEM_PROMPT_REF,
    allowedToolNames: [...TOOL_NAMES],
  });
  const toolSchemaChars = JSON.stringify(llmToolDefinitions([...TOOL_NAMES])).length;
  return {
    total: prompt.text.length + toolSchemaChars,
    promptChars: prompt.text.length,
    toolSchemaChars,
  };
}

// ---------------------------------------------------------------------------
// The tiny assertion harness
// ---------------------------------------------------------------------------

export class ProofFailure extends Error {}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ProofFailure(message);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new ProofFailure(`${message}\n      expected: ${String(expected)}\n      actual:   ${String(actual)}`);
  }
}

export interface Proof {
  readonly name: string;
  /** What this proof would catch if it broke. Printed with the result. */
  readonly guards: string;
  run(world: ProofWorld): Promise<string[]>;
}

/**
 * Run every proof, print the evidence, and exit non-zero if any failed.
 *
 * Each proof returns its own evidence lines. A green tick with no numbers
 * behind it is exactly the kind of reassurance this repository's test suite
 * goes out of its way not to give.
 */
export async function runProofs(title: string, proofs: readonly Proof[]): Promise<void> {
  console.log(title);
  console.log('='.repeat(78));

  const failures: { name: string; message: string }[] = [];

  await withTemporaryDatabase(async (world) => {
    for (const proof of proofs) {
      try {
        const evidence = await proof.run(world);
        console.log(`\n  PASS  ${proof.name}`);
        console.log(`        guards: ${proof.guards}`);
        for (const line of evidence) console.log(`        ${line}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ name: proof.name, message });
        console.log(`\n  FAIL  ${proof.name}`);
        console.log(`        guards: ${proof.guards}`);
        for (const line of message.split('\n')) console.log(`        ${line}`);
        if (!(error instanceof ProofFailure) && error instanceof Error && error.stack) {
          console.log(`        ${error.stack.split('\n').slice(1, 4).join('\n        ')}`);
        }
      }
    }
  });

  console.log(`\n${'='.repeat(78)}`);
  if (failures.length === 0) {
    console.log(`  RESULT: PASS - ${proofs.length}/${proofs.length} proofs.`);
  } else {
    console.log(`  RESULT: FAIL - ${failures.length} of ${proofs.length} proofs failed:`);
    for (const failure of failures) console.log(`    - ${failure.name}`);
    process.exitCode = 1;
  }
}
