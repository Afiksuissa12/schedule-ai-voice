/**
 * The Prisma client factory.
 *
 * The datasource URL is INJECTABLE, which is what lets `tests/helpers/testDb.ts`
 * hand every test file its own isolated SQLite database without touching
 * `process.env`. Application code gets its URL from `loadConfig()`.
 */
import { PrismaClient } from '@prisma/client';

import { ConfigurationError } from '../shared/errors.js';

export interface CreatePrismaClientOptions {
  /**
   * Prisma datasource URL, e.g. `file:./dev.db` or an absolute
   * `file:/tmp/xyz/test.db`. Defaults to `process.env.DATABASE_URL`.
   */
  datasourceUrl?: string;
  /** Prisma log levels. Defaults to errors and warnings only. */
  log?: Array<'query' | 'info' | 'warn' | 'error'>;
}

export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const datasourceUrl = options.datasourceUrl ?? process.env['DATABASE_URL'];

  if (!datasourceUrl) {
    throw new ConfigurationError(
      'No database URL. Pass `datasourceUrl` to createPrismaClient, or set DATABASE_URL ' +
        '(copy .env.example to .env, or run `npm run db:setup`).',
    );
  }

  return new PrismaClient({
    datasourceUrl,
    log: options.log ?? ['warn', 'error'],
  });
}

export type { PrismaClient };
