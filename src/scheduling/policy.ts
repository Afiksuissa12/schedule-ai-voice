/**
 * Scheduling policy: the numbers a proposed datetime is checked against.
 *
 * GOVERNING RULE
 * ---------------------------------------------------------------------------
 * None of these numbers may come from the LLM, and none of them may be
 * hardcoded at a call site. They are read from the persisted
 * `AgentConfiguration` row that is pinned to the conversation, so an auditor
 * replaying a decision applies exactly the policy that was in force at the time.
 *
 * WHERE DAY-PART WINDOWS LIVE
 * ---------------------------------------------------------------------------
 * The mission requires 'morning' / 'afternoon' / 'evening' to map to explicit,
 * documented, CONFIGURABLE local-hour windows. `AgentConfiguration` has exactly
 * one policy blob - `businessHoursJson` - so that same string is parsed here
 * with a SUPERSET of the foundation's `BusinessHoursPolicySchema`, adding two
 * optional keys:
 *
 *   - `dayParts`                      - the day-part windows (defaults below)
 *   - `defaultMeetingDurationMinutes` - slot length when the caller gives none
 *
 * The foundation's `BusinessHoursPolicySchema` is a plain `z.object`, which
 * STRIPS unknown keys rather than rejecting them, so a configuration carrying
 * these extra keys still parses cleanly on the foundation's own read path. The
 * arrangement was announced to MISSION-48d6ff04-AUTO-FOUNDATION rather than
 * adopted silently; if they would rather it lived in a dedicated column, only
 * this file changes.
 */
import { z } from 'zod';

import {
  BusinessHoursWindowSchema,
  LocalTimeOfDaySchema,
  type BusinessHoursPolicy,
} from '../domain/businessHours.js';
import { IanaTimezoneSchema } from '../domain/enums.js';
import type { AgentConfiguration } from '../domain/entities.js';
import { parseJsonWithSchema } from './zodJson.js';

/** The three day parts the resolver understands. */
export const DAY_PART_NAMES = ['morning', 'afternoon', 'evening'] as const;
export type DayPartName = (typeof DAY_PART_NAMES)[number];

/**
 * One day part.
 *
 * `[startLocal, endLocal)` is the half-open window a bare 12-hour clock time is
 * disambiguated into ("afternoon at 3" -> 15:00, because 03:00 is not in the
 * afternoon window and 15:00 is). `preferredLocal` is the single time used when
 * the contact names a day part and no clock time at all ("tomorrow afternoon").
 */
export const DayPartWindowSchema = z
  .object({
    startLocal: LocalTimeOfDaySchema,
    endLocal: LocalTimeOfDaySchema,
    preferredLocal: LocalTimeOfDaySchema,
  })
  .refine((window) => window.startLocal < window.endLocal, {
    message: 'startLocal must be strictly before endLocal',
  })
  .refine((window) => window.preferredLocal >= window.startLocal && window.preferredLocal < window.endLocal, {
    message: 'preferredLocal must fall inside [startLocal, endLocal)',
  });

export type DayPartWindow = z.infer<typeof DayPartWindowSchema>;

/**
 * THE DOCUMENTED DEFAULT DAY-PART WINDOWS.
 *
 * | day part  | window (local, half-open) | preferred when no clock time given |
 * |-----------|---------------------------|------------------------------------|
 * | morning   | 08:00 - 12:00             | 09:00                              |
 * | afternoon | 12:00 - 17:00             | 14:00                              |
 * | evening   | 17:00 - 21:00             | 18:00                              |
 *
 * These are WALL-CLOCK windows in the contact's timezone, not instants, and
 * they are deliberately independent of business hours: a contact may sincerely
 * ask for "this evening" even though the business closes at 17:00. The
 * business-hours check then rejects it, with `OUTSIDE_BUSINESS_HOURS` rather
 * than a silently shifted time, which is the honest answer.
 */
export const DEFAULT_DAY_PARTS = {
  morning: { startLocal: '08:00', endLocal: '12:00', preferredLocal: '09:00' },
  afternoon: { startLocal: '12:00', endLocal: '17:00', preferredLocal: '14:00' },
  evening: { startLocal: '17:00', endLocal: '21:00', preferredLocal: '18:00' },
} as const satisfies Record<DayPartName, DayPartWindow>;

export const DayPartsPolicySchema = z.object({
  morning: DayPartWindowSchema.default(DEFAULT_DAY_PARTS.morning),
  afternoon: DayPartWindowSchema.default(DEFAULT_DAY_PARTS.afternoon),
  evening: DayPartWindowSchema.default(DEFAULT_DAY_PARTS.evening),
});

export type DayPartsPolicy = z.infer<typeof DayPartsPolicySchema>;

/** Fallback slot length when neither the caller nor the configuration says. */
export const DEFAULT_MEETING_DURATION_MINUTES = 30;

/**
 * The superset schema applied to `AgentConfiguration.businessHoursJson`.
 *
 * Every field the foundation declares, plus the two optional scheduling keys.
 */
export const SchedulingPolicyDocumentSchema = z.object({
  version: z.literal(1).default(1),
  timezone: IanaTimezoneSchema.optional(),
  windows: z.array(BusinessHoursWindowSchema),
  holidayDatesLocal: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
  dayParts: DayPartsPolicySchema.default(DEFAULT_DAY_PARTS),
  defaultMeetingDurationMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .default(DEFAULT_MEETING_DURATION_MINUTES),
});

export type SchedulingPolicyDocument = z.infer<typeof SchedulingPolicyDocumentSchema>;

/**
 * Everything the resolver and the validator need, resolved from one
 * `AgentConfiguration` row. Immutable and cheap to pass around.
 */
export interface SchedulingPolicy {
  /** `AgentConfiguration.id` this policy came from. Recorded in provenance. */
  readonly agentConfigurationId: string;
  /** `AgentConfiguration.version`. Recorded in provenance. */
  readonly agentConfigurationVersion: number;
  readonly businessHours: BusinessHoursPolicy;
  readonly dayParts: DayPartsPolicy;
  readonly minLeadTimeMinutes: number;
  readonly maxSchedulingHorizonDays: number;
  /** Zone used when neither the proposal nor the contact supplies one. */
  readonly defaultTimezone: string;
  readonly defaultMeetingDurationMinutes: number;
}

/**
 * Read the scheduling policy out of a persisted `AgentConfiguration`.
 *
 * Throws `InvariantViolationError` (via `parseJsonWith`) when the stored
 * `businessHoursJson` is not a policy. That is the right failure mode: a
 * configuration we cannot interpret must not be silently replaced by defaults,
 * because the whole point is that the check ran against the REAL policy.
 */
export function schedulingPolicyFromAgentConfiguration(config: AgentConfiguration): SchedulingPolicy {
  const document = parseJsonWithSchema(
    config.businessHoursJson,
    SchedulingPolicyDocumentSchema,
    'AgentConfiguration.businessHoursJson',
  );

  return {
    agentConfigurationId: config.id,
    agentConfigurationVersion: config.version,
    businessHours: {
      version: document.version,
      ...(document.timezone ? { timezone: document.timezone } : {}),
      windows: document.windows,
      holidayDatesLocal: document.holidayDatesLocal,
    },
    dayParts: document.dayParts,
    minLeadTimeMinutes: config.minLeadTimeMinutes,
    maxSchedulingHorizonDays: config.maxSchedulingHorizonDays,
    defaultTimezone: config.defaultTimezone,
    defaultMeetingDurationMinutes: document.defaultMeetingDurationMinutes,
  };
}

/**
 * A policy built from explicit values, for unit tests and for callers that
 * genuinely have no `AgentConfiguration` row yet.
 *
 * Deliberately NOT used by any service: services read the persisted row.
 */
export function schedulingPolicy(overrides: Partial<SchedulingPolicy> = {}): SchedulingPolicy {
  return {
    agentConfigurationId: 'inline-policy',
    agentConfigurationVersion: 0,
    businessHours: { version: 1, windows: [], holidayDatesLocal: [] },
    dayParts: DEFAULT_DAY_PARTS,
    minLeadTimeMinutes: 30,
    maxSchedulingHorizonDays: 180,
    defaultTimezone: 'UTC',
    defaultMeetingDurationMinutes: DEFAULT_MEETING_DURATION_MINUTES,
    ...overrides,
  };
}
