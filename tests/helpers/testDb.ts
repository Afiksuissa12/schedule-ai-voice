/**
 * Isolated, per-test-file SQLite databases.
 *
 * CONTRACT FOR SIBLING TASKS: every test suite in this repository is built on
 * `createTestDatabase()`. It must therefore be reliable, fast, and require NO
 * network access and NO environment secret. It requires neither.
 *
 * HOW ISOLATION WORKS
 * ---------------------------------------------------------------------------
 * Each call creates its own SQLite FILE under `.tmp/test-dbs/`, named with the
 * caller's label, the process id and a random suffix. Two test files - and two
 * vitest workers - can never see each other's rows, so tests may run in
 * parallel and in any order.
 *
 * WHY A TEMPLATE
 * ---------------------------------------------------------------------------
 * Applying the schema with `prisma db push` costs a process spawn (~1-2s). Done
 * per test file that adds up fast. So the schema is applied ONCE into a
 * template database keyed by a hash of `schema.prisma`, and every subsequent
 * test database is a file copy of that template - a few milliseconds. Change
 * the schema and the hash changes, so the template is rebuilt automatically and
 * a stale template can never be used.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDatabase, type Database } from '../../src/db/database.js';
import { FixedClock } from '../../src/ports/clock.js';
import { seedTestFixtures, type TestFixtures, type SeedTestFixturesOptions } from './fixtures.js';

const HELPERS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HELPERS_DIR, '..', '..');
const SCHEMA_PATH = join(REPO_ROOT, 'prisma', 'schema.prisma');
const PRISMA_CLI = join(REPO_ROOT, 'node_modules', 'prisma', 'build', 'index.js');
const TMP_ROOT = join(REPO_ROOT, '.tmp');
const TEMPLATE_DIR = join(TMP_ROOT, 'test-db-templates');
const TEST_DB_DIR = join(TMP_ROOT, 'test-dbs');

/**
 * The default `now` for deterministic tests.
 *
 * Wednesday 2026-03-04, 15:00 UTC = 10:00 America/New_York (EST). Chosen so the
 * fixture contact is mid-morning on a weekday inside 09:00-17:00 business
 * hours, and four days BEFORE the 2026-03-08 US DST transition - close enough
 * that a test can step across it deliberately.
 */
export const DEFAULT_TEST_NOW_UTC = '2026-03-04T15:00:00.000Z';

export interface CreateTestDatabaseOptions {
  /** Appears in the database filename. Use the test file's name. */
  label?: string;
  /** `now` for the returned `FixedClock`. Defaults to `DEFAULT_TEST_NOW_UTC`. */
  nowUtc?: string;
  /** Seed the deterministic fixture set immediately. Defaults to false. */
  seed?: boolean | SeedTestFixturesOptions;
}

export interface TestDatabase {
  /** Repositories + audit recorder, bound to this isolated database. */
  readonly db: Database;
  /** The `file:` URL, for constructing a second client against the same file. */
  readonly databaseUrl: string;
  /** Absolute path of the SQLite file. */
  readonly filePath: string;
  /** Deterministic clock wired into `db`'s audit recorder. */
  readonly clock: FixedClock;
  /** Seed (or re-seed) the deterministic fixture set. */
  seedFixtures(options?: SeedTestFixturesOptions): Promise<TestFixtures>;
  /**
   * Open an ADDITIONAL client against the SAME file.
   *
   * This is how a test proves durability: write with one client, discard it,
   * then read with a freshly constructed one. Every client opened this way is
   * closed by `cleanup()`.
   */
  openAnotherClient(options?: { nowUtc?: string }): Database;
  /** Disconnect every client and delete the files. Always call this. */
  cleanup(): Promise<void>;
}

export async function createTestDatabase(options: CreateTestDatabaseOptions = {}): Promise<TestDatabase> {
  const templatePath = ensureTemplateDatabase();

  mkdirSync(TEST_DB_DIR, { recursive: true });
  const label = sanitizeLabel(options.label ?? 'test');
  const filePath = join(TEST_DB_DIR, `${label}-${process.pid}-${randomUUID().slice(0, 8)}.db`);
  copyFileSync(templatePath, filePath);

  const databaseUrl = toFileUrl(filePath);
  const clock = new FixedClock(options.nowUtc ?? DEFAULT_TEST_NOW_UTC);
  // `['warn']`: many tests deliberately provoke constraint violations and
  // assert on the rejection. Prisma's own error logging would print a stack
  // trace for each one and bury the real failures. The errors still throw.
  const db = createDatabase({ datasourceUrl: databaseUrl, clock, log: ['warn'] });

  const extraClients: Database[] = [];

  const handle: TestDatabase = {
    db,
    databaseUrl,
    filePath,
    clock,

    async seedFixtures(seedOptions) {
      return seedTestFixtures(db, seedOptions);
    },

    openAnotherClient(clientOptions) {
      const another = createDatabase({
        datasourceUrl: databaseUrl,
        clock: new FixedClock(clientOptions?.nowUtc ?? options.nowUtc ?? DEFAULT_TEST_NOW_UTC),
        log: ['warn'],
      });
      extraClients.push(another);
      return another;
    },

    async cleanup() {
      for (const client of [db, ...extraClients]) {
        try {
          await client.disconnect();
        } catch {
          // A client may already be disconnected; cleanup must not mask a test failure.
        }
      }
      for (const suffix of ['', '-journal', '-wal', '-shm']) {
        rmSync(`${filePath}${suffix}`, { force: true });
      }
    },
  };

  if (options.seed) {
    await handle.seedFixtures(typeof options.seed === 'object' ? options.seed : undefined);
  }

  return handle;
}

/**
 * Build (or reuse) the schema template for the CURRENT `schema.prisma`.
 *
 * Keyed by a content hash, so editing the schema invalidates it automatically.
 * Built under a unique name and then renamed into place, so concurrent vitest
 * workers cannot observe a half-written template.
 *
 * Exported so `tests/helpers/globalSetup.ts` can warm it ONCE before any worker
 * starts. Without that, every worker races to build its own copy on a cold
 * checkout and the first run pays the `prisma db push` cost N times over.
 */
export function ensureTemplateDatabase(): string {
  const schemaHash = createHash('sha256').update(readFileSync(SCHEMA_PATH)).digest('hex').slice(0, 16);
  const templatePath = join(TEMPLATE_DIR, `schema-${schemaHash}.db`);

  if (existsSync(templatePath)) {
    return templatePath;
  }

  mkdirSync(TEMPLATE_DIR, { recursive: true });
  const buildPath = join(TEMPLATE_DIR, `building-${process.pid}-${randomUUID().slice(0, 8)}.db`);

  try {
    execFileSync(
      process.execPath,
      [PRISMA_CLI, 'db', 'push', '--schema', SCHEMA_PATH, '--skip-generate', '--accept-data-loss'],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, DATABASE_URL: toFileUrl(buildPath), PRISMA_HIDE_UPDATE_MESSAGE: '1' },
        stdio: 'pipe',
      },
    );
  } catch (error) {
    rmSync(buildPath, { force: true });
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
    const stdout = (error as { stdout?: Buffer }).stdout?.toString() ?? '';
    throw new Error(
      `Failed to apply prisma/schema.prisma to a test database.\n` +
        `Run \`npm run db:generate\` first if you have not.\n${stdout}\n${stderr}`,
      { cause: error },
    );
  }

  if (existsSync(templatePath)) {
    // Another worker finished first; theirs is just as good.
    rmSync(buildPath, { force: true });
    return templatePath;
  }

  try {
    renameSync(buildPath, templatePath);
  } catch {
    // Lost a rename race on a platform that refuses to overwrite. Fall back to
    // copying, then drop our build file.
    if (!existsSync(templatePath)) {
      copyFileSync(buildPath, templatePath);
    }
    rmSync(buildPath, { force: true });
  }

  return templatePath;
}

/** `file:` URL for an absolute path, usable by both the Prisma CLI and client. */
function toFileUrl(absolutePath: string): string {
  return `file:${absolutePath.replace(/\\/g, '/')}`;
}

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48) || 'test';
}
