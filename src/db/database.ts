/**
 * `Database`: a `PrismaClient` plus the repository container built on it.
 *
 * This is the object application code and tests pass around. It owns the
 * connection lifecycle; the repositories own the queries.
 */
import type { PrismaClient } from '@prisma/client';

import type { Clock } from '../ports/clock.js';
import { SystemClock } from '../ports/clock.js';
import { createPrismaClient } from './client.js';
import type { Repositories } from './repositories/index.js';
import { createRepositories } from './repositories/index.js';

export interface Database extends Repositories {
  /** Escape hatch for raw queries and migrations. Prefer the repositories. */
  readonly prisma: PrismaClient;
  /** Close the connection. Always call this in a test's `cleanup()`. */
  disconnect(): Promise<void>;
}

export interface CreateDatabaseOptions {
  /** Injectable datasource URL; defaults to `process.env.DATABASE_URL`. */
  datasourceUrl?: string;
  /** Use an existing client instead of creating one. */
  prisma?: PrismaClient;
  /** Injected clock, threaded into the audit recorder. */
  clock?: Clock;
  /**
   * Prisma log levels. Defaults to `['warn', 'error']`.
   *
   * Test harnesses that deliberately provoke constraint violations pass
   * `['warn']`, because a test asserting `rejects.toThrow()` should not print a
   * stack trace for the failure it was written to cause. The error is still
   * thrown either way - only Prisma's own logging is suppressed.
   */
  log?: Array<'query' | 'info' | 'warn' | 'error'>;
}

export function createDatabase(options: CreateDatabaseOptions = {}): Database {
  const prisma =
    options.prisma ??
    createPrismaClient({
      ...(options.datasourceUrl ? { datasourceUrl: options.datasourceUrl } : {}),
      ...(options.log ? { log: options.log } : {}),
    });
  const clock = options.clock ?? new SystemClock();

  return {
    ...createRepositories(prisma, { clock }),
    prisma,
    async disconnect() {
      await prisma.$disconnect();
    },
  };
}
