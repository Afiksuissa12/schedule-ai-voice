/**
 * Vitest global setup: build the schema template ONCE, before any worker runs.
 *
 * `createTestDatabase()` copies a pre-built template database rather than
 * running `prisma db push` per test file. Building that template is the only
 * slow step, and on a cold checkout every worker would otherwise race to build
 * its own. Warming it here turns a ~30s first run into a ~6s one, and costs
 * nothing once the template exists.
 */
import { ensureTemplateDatabase } from './testDb.js';

export default function setup(): void {
  ensureTemplateDatabase();
}
