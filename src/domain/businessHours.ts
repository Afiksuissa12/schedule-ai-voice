/**
 * Business-hours policy.
 *
 * Stored serialized in `AgentConfiguration.businessHoursJson`. The scheduling
 * layer reads it from there - never from the LLM - and checks a proposed
 * meeting against it, emitting `OUTSIDE_BUSINESS_HOURS` when it does not fit.
 *
 * Shape notes:
 *  - `isoWeekday` is 1 (Monday) .. 7 (Sunday), matching Luxon's `DateTime.weekday`.
 *  - `startLocal` / `endLocal` are `HH:mm` wall-clock times in the policy's
 *    timezone, NOT instants. A window is half-open: [start, end).
 *  - Times are local on purpose. "We work 9-5" is a wall-clock statement that
 *    must keep meaning 9-5 after a DST transition.
 */
import { z } from 'zod';

import { IanaTimezoneSchema } from './enums.js';

/** `HH:mm`, 24-hour, zero-padded. `24:00` is allowed as an end-of-day marker. */
export const LocalTimeOfDaySchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Must be a 24-hour local time of day, e.g. 09:00');

export const IsoWeekdaySchema = z.number().int().min(1).max(7);

export const BusinessHoursWindowSchema = z
  .object({
    /** 1 = Monday .. 7 = Sunday (Luxon convention). */
    isoWeekday: IsoWeekdaySchema,
    /** Inclusive start, local wall-clock, `HH:mm`. */
    startLocal: LocalTimeOfDaySchema,
    /** Exclusive end, local wall-clock, `HH:mm`. */
    endLocal: LocalTimeOfDaySchema,
  })
  .refine((window) => window.startLocal < window.endLocal, {
    message: 'startLocal must be strictly before endLocal',
  });

export const BusinessHoursPolicySchema = z.object({
  /** Bump when the shape changes so stored policies remain interpretable. */
  version: z.literal(1).default(1),
  /**
   * Timezone the windows are expressed in. When omitted, the caller supplies
   * one (normally the contact's timezone, else the agent's defaultTimezone).
   */
  timezone: IanaTimezoneSchema.optional(),
  /** Open windows. An empty list means "never open". */
  windows: z.array(BusinessHoursWindowSchema),
  /** Local `YYYY-MM-DD` dates on which the business is closed regardless. */
  holidayDatesLocal: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
});

export type BusinessHoursWindow = z.infer<typeof BusinessHoursWindowSchema>;
export type BusinessHoursPolicy = z.infer<typeof BusinessHoursPolicySchema>;

export const ISO_WEEKDAY = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
} as const;

/**
 * The default policy used by the seed and the deterministic test fixtures:
 * Monday-Friday, 09:00-17:00 local.
 */
export function weekdayBusinessHours(
  startLocal = '09:00',
  endLocal = '17:00',
  timezone?: string,
): BusinessHoursPolicy {
  return {
    version: 1,
    ...(timezone ? { timezone } : {}),
    windows: [ISO_WEEKDAY.MONDAY, ISO_WEEKDAY.TUESDAY, ISO_WEEKDAY.WEDNESDAY, ISO_WEEKDAY.THURSDAY, ISO_WEEKDAY.FRIDAY].map(
      (isoWeekday) => ({ isoWeekday, startLocal, endLocal }),
    ),
    holidayDatesLocal: [],
  };
}
