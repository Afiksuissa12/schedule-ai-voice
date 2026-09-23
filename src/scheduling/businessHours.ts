/**
 * Business-hours evaluation.
 *
 * The policy is WALL-CLOCK on purpose (see `src/domain/businessHours.ts`):
 * "we work 09:00-17:00" has to keep meaning 09:00-17:00 after a DST change, so
 * the comparison happens on local hours and minutes, never on instants.
 *
 * A window is half-open, `[startLocal, endLocal)`, and the WHOLE slot must fit
 * inside ONE window. The consequences at the boundaries are worth stating
 * explicitly because they are the cases people argue about:
 *
 *   - a slot starting exactly at `startLocal`               -> INSIDE
 *   - a slot ENDING exactly at `endLocal`                   -> INSIDE
 *   - a slot STARTING exactly at `endLocal`                 -> OUTSIDE
 *   - a slot starting one minute before `startLocal`        -> OUTSIDE
 *   - a slot that would run past `endLocal`                 -> OUTSIDE
 */
import type { DateTime } from 'luxon';

import type { BusinessHoursPolicy } from '../domain/businessHours.js';

export interface BusinessHoursVerdict {
  readonly ok: boolean;
  /** Always populated: a pass is as auditable as a rejection. */
  readonly detail: string;
}

const MINUTES_PER_DAY = 24 * 60;

/**
 * Does `[startLocal, endLocal)` fit inside a configured window?
 *
 * Both arguments must already be expressed in the zone the policy is to be
 * evaluated in - see `businessHoursTimezone`.
 */
export function checkBusinessHours(
  policy: BusinessHoursPolicy,
  startLocal: DateTime,
  endLocal: DateTime,
): BusinessHoursVerdict {
  const startDate = startLocal.toFormat('yyyy-LL-dd');

  if (policy.windows.length === 0) {
    return { ok: false, detail: 'The configured business-hours policy has no open windows at all.' };
  }

  if (policy.holidayDatesLocal.includes(startDate)) {
    return { ok: false, detail: `${startDate} is a configured holiday.` };
  }

  const startMinutes = startLocal.hour * 60 + startLocal.minute;
  const endMinutes = localEndMinutes(startLocal, endLocal);

  const sameDayWindows = policy.windows.filter((window) => window.isoWeekday === startLocal.weekday);
  if (sameDayWindows.length === 0) {
    return {
      ok: false,
      detail: `${startLocal.weekdayLong ?? `weekday ${startLocal.weekday}`} is not a configured business day.`,
    };
  }

  if (endMinutes === undefined) {
    return {
      ok: false,
      detail: `A slot from ${formatMinutes(startMinutes)} running past midnight cannot fit in a business-hours window.`,
    };
  }

  for (const window of sameDayWindows) {
    const open = toMinutes(window.startLocal);
    const close = toMinutes(window.endLocal);
    if (startMinutes >= open && startMinutes < close && endMinutes <= close) {
      return {
        ok: true,
        detail:
          `${formatMinutes(startMinutes)}-${formatMinutes(endMinutes)} local fits inside ` +
          `${window.startLocal}-${window.endLocal} on ${startLocal.weekdayLong ?? `weekday ${window.isoWeekday}`}.`,
      };
    }
  }

  const rendered = sameDayWindows.map((window) => `${window.startLocal}-${window.endLocal}`).join(', ');
  return {
    ok: false,
    detail:
      `${formatMinutes(startMinutes)}-${formatMinutes(endMinutes)} local on ` +
      `${startLocal.weekdayLong ?? `weekday ${startLocal.weekday}`} does not fit inside ${rendered}.`,
  };
}

/**
 * The zone the policy is evaluated in.
 *
 * A policy may pin its own zone (a business that works 09:00-17:00 in ITS
 * timezone regardless of where the contact is). When it does not, the contact's
 * zone is used, which is the common case and matches "business hours in the
 * LOCAL timezone".
 */
export function businessHoursTimezone(policy: BusinessHoursPolicy, slotTimezone: string): string {
  return policy.timezone ?? slotTimezone;
}

/**
 * Wall-clock minutes past midnight for the slot end, or `undefined` when the
 * slot runs into another day (which never fits a single window).
 */
function localEndMinutes(startLocal: DateTime, endLocal: DateTime): number | undefined {
  if (endLocal.toFormat('yyyy-LL-dd') === startLocal.toFormat('yyyy-LL-dd')) {
    return endLocal.hour * 60 + endLocal.minute;
  }
  const isNextDayMidnight =
    endLocal.hour === 0 &&
    endLocal.minute === 0 &&
    endLocal.toFormat('yyyy-LL-dd') === startLocal.plus({ days: 1 }).toFormat('yyyy-LL-dd');
  return isNextDayMidnight ? MINUTES_PER_DAY : undefined;
}

function toMinutes(localTime: string): number {
  const [hour, minute] = localTime.split(':');
  return Number(hour) * 60 + Number(minute);
}

function formatMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
