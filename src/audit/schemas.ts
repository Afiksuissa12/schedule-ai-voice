/**
 * Zod schemas for the audit vocabulary.
 *
 * Kept separate from `./types.ts` so that a module which only needs the types
 * does not pull Zod in, and so that `src/db/mappers.ts` can re-check stored
 * audit strings on read.
 */
import { z } from 'zod';

import { AUDIT_EVENT_TYPES, AUDIT_SUBJECT_TYPES } from './types.js';

export const AuditEventTypeSchema = z.enum(AUDIT_EVENT_TYPES);
export const AuditSubjectTypeSchema = z.enum(AUDIT_SUBJECT_TYPES);
