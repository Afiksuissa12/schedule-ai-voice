/**
 * FutureAction payloads.
 *
 * `FutureAction.payloadJson` is what a background runner reads MONTHS after the
 * conversation that produced it, in a different process, with no LLM context
 * anywhere in sight. So it has to be self-sufficient and it has to be
 * schema-checked on the way out as well as on the way in - a payload that has
 * drifted is a call that cannot be placed.
 *
 * `correlationId` lives in the payload deliberately: it is how the audit events
 * the RUNNER emits join the chain of the agent turn that made the promise. That
 * is the thread an auditor pulls to answer "why did this system phone this
 * person at 3pm on a Tuesday in June?".
 */
import { z } from 'zod';

import { E164Schema } from '../domain/enums.js';
import { parseJsonWithSchema } from '../scheduling/zodJson.js';

export const CallContactPayloadSchema = z.object({
  /** Bump when the shape changes so old rows stay interpretable. */
  version: z.literal(1).default(1),
  /** The agent turn that promised this call. Threads the audit chain forward. */
  correlationId: z.string().min(1),
  /** Destination, in E.164. Snapshotted so a later contact edit cannot silently redirect the call. */
  toE164: E164Schema,
  /** Originating number. Falls back to the runner's configured number. */
  fromE164: E164Schema.optional(),
  /** Why this call was promised. Shown in audit summaries. */
  reason: z.string().max(500).optional(),
  /** The tool call that scheduled it, when there was one. */
  toolCallId: z.string().nullable().optional(),
  /** Wall-clock time the contact actually agreed to, for rendering. */
  scheduledForLocal: z.string().optional(),
});

export type CallContactPayload = z.infer<typeof CallContactPayloadSchema>;

export function parseCallContactPayload(json: string): CallContactPayload {
  return parseJsonWithSchema(json, CallContactPayloadSchema, 'FutureAction.payloadJson (CALL_CONTACT)');
}
