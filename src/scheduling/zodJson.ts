/**
 * `parseJsonWithSchema` - parse a stored JSON column into a schema's OUTPUT type.
 *
 * WHY THIS EXISTS ALONGSIDE `shared/json.ts#parseJsonWith`
 * ---------------------------------------------------------------------------
 * The shared helper is typed `parseJsonWith<T>(raw, schema: ZodType<T>)`. Zod's
 * `ZodType` defaults its Input parameter to the same `T` as its Output, so when
 * a schema uses `.default()` - where input and output genuinely differ, because
 * the defaulted field is optional going in and present coming out - TypeScript
 * resolves `T` to the INPUT type. Every defaulted field then appears as
 * possibly-undefined downstream, which is exactly backwards: a default's whole
 * job is to guarantee the field is there.
 *
 * This helper keeps the same behaviour (loud, attributable
 * `InvariantViolationError` on malformed or non-conforming stored JSON) and
 * returns `z.output<S>`.
 *
 * Reported to MISSION-48d6ff04-AUTO-FOUNDATION as a small typing improvement to
 * their helper; if they adopt it, this module can be deleted and the imports
 * repointed.
 */
import type { z } from 'zod';

import { InvariantViolationError } from '../shared/errors.js';
import { parseJson } from '../shared/json.js';

export function parseJsonWithSchema<S extends z.ZodTypeAny>(
  raw: string,
  schema: S,
  context = 'JSON',
): z.output<S> {
  const parsed = parseJson<unknown>(raw, context);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new InvariantViolationError(`Stored ${context} does not match its schema`, {
      details: { issues: result.error.issues },
    });
  }
  return result.data as z.output<S>;
}
