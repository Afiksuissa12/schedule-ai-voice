/**
 * Runtime validation for the `ValidationProvenance` receipt.
 *
 * `src/ports/validation.ts` declares the TYPE. This module declares the Zod
 * SCHEMA, so that the repositories can refuse to write a Meeting or a
 * FutureAction whose provenance is missing, empty, unparseable or structurally
 * wrong. Without this check `validationProvenanceJson String` would be a NOT
 * NULL column that happily accepts `"{}"` - a receipt that proves nothing.
 */
import { z } from 'zod';

import type { ValidationProvenance } from '../ports/validation.js';
import { parseJsonWith } from '../shared/json.js';
import { IsoUtcStringSchema } from './enums.js';

export const ValidationCheckSchema = z.object({
  name: z.string().min(1),
  passed: z.boolean(),
  detail: z.string().optional(),
});

export const ValidationProvenanceSchema = z.object({
  validatorVersion: z.string().min(1),
  nowUtc: IsoUtcStringSchema,
  /** Exactly what the LLM proposed. May legitimately be an empty string. */
  rawProposedValue: z.string(),
  resolvedTimezone: z.string().min(1),
  resolvedStartUtc: IsoUtcStringSchema.optional(),
  resolvedEndUtc: IsoUtcStringSchema.optional(),
  /** At least one check must have run. A receipt with no checks is not a receipt. */
  checks: z.array(ValidationCheckSchema).min(1),
  notes: z.record(z.unknown()).optional(),
});

/**
 * Parse a serialized provenance, throwing `InvariantViolationError` when the
 * stored JSON does not describe a real validation.
 */
export function parseValidationProvenance(json: string, context = 'ValidationProvenance'): ValidationProvenance {
  return parseJsonWith(json, ValidationProvenanceSchema, context) as ValidationProvenance;
}

/** Non-throwing check, used by repositories on the write path. */
export function isValidProvenanceJson(json: string): boolean {
  if (json.trim().length === 0) {
    return false;
  }
  try {
    return ValidationProvenanceSchema.safeParse(JSON.parse(json)).success;
  } catch {
    return false;
  }
}
