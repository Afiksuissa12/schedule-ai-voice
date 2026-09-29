/**
 * Locating the Prisma CLI, once, for everything that shells out to it.
 *
 * NOT `join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js')`. This
 * repository is routinely checked out as a git worktree whose `node_modules`
 * lives at the workspace root ABOVE the worktree, so a path built from the repo
 * root simply does not exist and every caller that built one died with
 * `MODULE_NOT_FOUND`. `createRequire().resolve` walks the same lookup chain Node
 * itself would and finds the package wherever it is actually installed - in the
 * repo, hoisted above it, or anywhere else on the chain.
 *
 * Four call sites needed this (the test-database helper, the slice demo, the CLI
 * proof support, and the benchmark world). They now share one implementation so
 * a layout that breaks one cannot silently keep working for the others.
 */
import { createRequire } from 'node:module';

/** Absolute path to the Prisma CLI entrypoint, resolved through Node. */
export function prismaCliPath(): string {
  return createRequire(import.meta.url).resolve('prisma/build/index.js');
}

/**
 * The argv that applies a schema to a SQLite file, minus the node binary.
 *
 * `--skip-generate` because the client is generated separately and regenerating
 * it per database would dominate the cost; `--accept-data-loss` because every
 * caller is pointing at a throwaway file it just created.
 */
export function prismaDbPushArgs(schemaPath: string): string[] {
  return [prismaCliPath(), 'db', 'push', '--schema', schemaPath, '--skip-generate', '--accept-data-loss'];
}
