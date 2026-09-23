/**
 * Translating Prisma's error codes into this codebase's error vocabulary.
 *
 * Doing this in one place keeps `P2002` out of business logic and makes
 * "the idempotency key already exists" readable at the call site.
 */
import { Prisma } from '@prisma/client';

import { ConflictError, NotFoundError, PersistenceError } from '../shared/errors.js';

/** A unique constraint violation, e.g. a duplicate `idempotencyKey`. */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** A foreign key constraint violation - the referenced row does not exist. */
export function isForeignKeyConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

/** An update/delete matched no rows. */
export function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

/** The fields a unique constraint violation was reported on, if Prisma said. */
export function uniqueConstraintTarget(error: unknown): string[] {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return [];
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.filter((entry): entry is string => typeof entry === 'string');
  }
  return typeof target === 'string' ? [target] : [];
}

/**
 * Re-throw a Prisma error as an application error.
 *
 * Always throws; the `never` return type lets callers write
 * `catch (error) { translatePrismaError(error, { entity: 'Meeting' }) }`
 * without the compiler complaining about a missing return.
 */
export function translatePrismaError(error: unknown, context: { entity: string; operation?: string }): never {
  const where = context.operation ? `${context.entity}.${context.operation}` : context.entity;

  if (isUniqueConstraintViolation(error)) {
    const fields = uniqueConstraintTarget(error);
    throw new ConflictError(
      `${where}: unique constraint violated${fields.length ? ` on ${fields.join(', ')}` : ''}`,
      { cause: error, details: { entity: context.entity, fields } },
    );
  }

  if (isForeignKeyConstraintViolation(error)) {
    throw new ConflictError(`${where}: foreign key constraint violated - a referenced row does not exist`, {
      cause: error,
      details: { entity: context.entity },
    });
  }

  if (isRecordNotFound(error)) {
    throw new NotFoundError(context.entity, '(matched no rows)', { cause: error });
  }

  throw new PersistenceError(`${where}: database operation failed`, {
    cause: error,
    details: { entity: context.entity },
  });
}
