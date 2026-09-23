/**
 * Shared persistence types.
 *
 * `DbExecutor` is the key abstraction: every repository takes one, and it is
 * satisfied both by a top-level `PrismaClient` and by the transaction client
 * Prisma hands to `$transaction`. That is what makes it possible to persist a
 * domain row and its audit events atomically - the same repository code runs
 * inside and outside a transaction.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

/** Anything that can execute Prisma model queries: a client, or a transaction. */
export type DbExecutor = PrismaClient | Prisma.TransactionClient;

/** True when this executor is a full client (and can therefore open a transaction). */
export function isTransactionCapable(executor: DbExecutor): executor is PrismaClient {
  return typeof (executor as PrismaClient).$transaction === 'function';
}

/** Standard pagination arguments used by the `list*` repository methods. */
export interface PageOptions {
  readonly take?: number;
  readonly skip?: number;
}
