/**
 * JSON helpers.
 *
 * Several columns in the schema hold serialized JSON as a string
 * (`rawPayloadJson`, `detailJson`, `payloadJson`, `validationProvenanceJson`,
 * `factorsJson`, `businessHoursJson`, `allowedToolsJson`). SQLite has no native
 * JSON column type, and storing the raw text is also what an auditor wants:
 * exactly what was produced, byte for byte, not a re-serialized approximation.
 *
 * These helpers make the string <-> object boundary explicit and loud.
 */
import type { ZodType } from 'zod';

import { InvariantViolationError } from './errors.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Anything a caller may hand us as a structured payload. */
export type StructuredPayload = Record<string, unknown>;

/** Serialize, converting a circular/unserializable value into a loud error. */
export function stringifyJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError('value serialized to undefined');
    }
    return serialized;
  } catch (cause) {
    throw new InvariantViolationError('Value could not be serialized to JSON', { cause });
  }
}

/**
 * Serialize with object keys sorted recursively.
 *
 * Use this anywhere the exact bytes matter for comparison - idempotency key
 * derivation, fixture assertions - so that two logically identical payloads
 * always produce an identical string.
 */
export function stringifyJsonStable(value: unknown): string {
  return stringifyJson(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  return value;
}

/** Parse, turning malformed stored JSON into a loud, attributable error. */
export function parseJson<T = JsonValue>(raw: string, context = 'JSON'): T {
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new InvariantViolationError(`Stored ${context} is not valid JSON`, {
      cause,
      details: { preview: raw.slice(0, 200) },
    });
  }
}

/** Parse and validate in one step. Returns the schema's output type. */
export function parseJsonWith<T>(raw: string, schema: ZodType<T>, context = 'JSON'): T {
  const parsed = parseJson<unknown>(raw, context);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new InvariantViolationError(`Stored ${context} does not match its schema`, {
      details: { issues: result.error.issues },
    });
  }
  return result.data;
}

/** Non-throwing parse, for places that must degrade rather than explode. */
export function tryParseJson<T = JsonValue>(raw: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
