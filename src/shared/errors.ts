/**
 * Typed error hierarchy shared by every layer.
 *
 * Rule: errors are surfaced, never swallowed. In particular audit writes and
 * persistence failures must reach the caller - a silent failure in the audit
 * trail would defeat the entire point of the audit trail.
 */

export class AppError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.details = options?.details;
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details ?? null,
    };
  }
}

/** Environment / configuration is missing or malformed. */
export class ConfigurationError extends AppError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('CONFIGURATION_ERROR', message, options);
  }
}

/** A referenced domain row does not exist. */
export class NotFoundError extends AppError {
  constructor(entity: string, id: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('NOT_FOUND', `${entity} not found: ${id}`, {
      ...options,
      details: { entity, id, ...(options?.details ?? {}) },
    });
  }
}

/** A uniqueness / idempotency constraint was violated. */
export class ConflictError extends AppError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('CONFLICT', message, options);
  }
}

/**
 * A rule that must hold by construction was violated - e.g. an attempt to
 * persist a Meeting without validation provenance. These represent programmer
 * error, not user error.
 */
export class InvariantViolationError extends AppError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('INVARIANT_VIOLATION', message, options);
  }
}

/** The database rejected an operation. */
export class PersistenceError extends AppError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('PERSISTENCE_ERROR', message, options);
  }
}

/**
 * An audit event could not be written.
 *
 * This is deliberately its own error type: callers must be able to distinguish
 * "the business operation failed" from "the business operation succeeded but we
 * could not explain it", and must never be tempted to ignore the latter.
 */
export class AuditWriteError extends AppError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super('AUDIT_WRITE_FAILED', message, options);
  }
}

/** Narrow an unknown caught value to a readable message without losing detail. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
