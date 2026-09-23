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
 *
 * WHICH ZONE THE WINDOW IS READ IN IS A SECURITY BOUNDARY
 * ---------------------------------------------------------------------------
 * A wall-clock window is meaningless until you say WHOSE wall clock. Getting
 * that from the wrong place is not a cosmetic bug: whoever chooses the zone
 * chooses the window, and therefore chooses whether 23:30 counts as office
 * hours. `businessHoursAnchor` is the only answer to that question in this
 * codebase, and it deliberately cannot see the zone a proposal asked for - see
 * its own comment.
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
 * evaluated in - see `businessHoursAnchor`.
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

/** Which persisted row supplied the zone the gate was evaluated in. */
export type BusinessHoursAnchorSource = 'policy' | 'contact' | 'agent_default';

/** The zone the business-hours gate is evaluated in, and where it came from. */
export interface BusinessHoursAnchor {
  readonly timezone: string;
  readonly source: BusinessHoursAnchorSource;
}

/** The two persisted zones the anchor may be drawn from. */
export interface BusinessHoursAnchorInput {
  /**
   * `Contact.timezone`, read straight off the persisted contact row.
   *
   * NOT the zone a proposal asked to be read in. Those are different values and
   * conflating them is exactly the bug this signature exists to prevent.
   */
  readonly persistedContactTimezone?: string | null;
  /** `AgentConfiguration.defaultTimezone`. The last resort. */
  readonly agentDefaultTimezone: string;
}

/**
 * THE ANCHOR: the zone the business-hours window is read in.
 *
 * WHY THIS FUNCTION CANNOT SEE THE PROPOSAL'S ZONE
 * ---------------------------------------------------------------------------
 * Every time-bearing tool takes an OPTIONAL `timezone` argument the model may
 * fill in, and it is legitimate for it to do so - "I'm in Denver this week"
 * genuinely changes which instant "10am" means. What it must NEVER change is
 * the window that instant is then judged against, because a model that picks
 * the window picks the verdict: assert `Asia/Kolkata`, ask for "10am", and an
 * instant that is 23:30 for a New York contact reads as the middle of the
 * working day.
 *
 * So this function takes no slot zone at all. The anchor is, in order:
 *
 *   1. `BusinessHoursPolicy.timezone`  - a business that works 09:00-17:00 in
 *      ITS OWN zone regardless of where the contact is, when the persisted
 *      configuration says so explicitly.
 *   2. `Contact.timezone`             - the ordinary case, and what "business
 *      hours in the contact's local time" actually means.
 *   3. `AgentConfiguration.defaultTimezone` - only if a contact row somehow
 *      carries no zone.
 *
 * All three are persisted, application-controlled values. None of them is
 * reachable from a tool argument, which is what makes the guardrail a control
 * rather than a suggestion.
 *
 * KNOWN CONSEQUENCE, STATED RATHER THAN HIDDEN
 * ---------------------------------------------------------------------------
 * When a configuration DOES pin `BusinessHoursPolicy.timezone`, the gate is
 * that business's clock and a contact far away can be booked outside their own
 * working hours. That is the documented meaning of pinning a zone and it is a
 * deliberate decision by whoever wrote the configuration row - not something a
 * model can bring about. No policy in `seedSliceWorld` pins one, so the shipped
 * default is the contact's own zone.
 */
export function businessHoursAnchor(
  policy: BusinessHoursPolicy,
  input: BusinessHoursAnchorInput,
): BusinessHoursAnchor {
  if (policy.timezone !== undefined && policy.timezone.trim().length > 0) {
    return { timezone: policy.timezone, source: 'policy' };
  }
  const contactZone = input.persistedContactTimezone?.trim();
  if (contactZone !== undefined && contactZone.length > 0) {
    return { timezone: contactZone, source: 'contact' };
  }
  return { timezone: input.agentDefaultTimezone, source: 'agent_default' };
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
