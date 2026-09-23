/**
 * PORT: availability.
 *
 * The legacy prototype invented availability out of thin air. This port exists
 * so that availability always comes from a named provider that can be swapped
 * for a real calendar without touching a single line of scheduling logic.
 *
 * Implementations live in `src/providers` (owned by the scheduling task).
 * Nothing behind this interface may leak a vendor SDK type.
 */
import type { IsoUtcString } from './clock.js';

/** A half-open interval [startUtc, endUtc) during which a calendar is busy. */
export interface BusyInterval {
  readonly startUtc: IsoUtcString;
  readonly endUtc: IsoUtcString;
}

export interface GetBusyIntervalsRequest {
  /** Provider-specific calendar identifier, from `CalendarConnection.calendarRef`. */
  readonly calendarRef: string;
  /** Window start, inclusive. */
  readonly fromUtc: IsoUtcString;
  /** Window end, exclusive. */
  readonly toUtc: IsoUtcString;
}

export interface AvailabilityProvider {
  /**
   * Busy intervals overlapping [fromUtc, toUtc).
   *
   * Implementations should return intervals sorted by `startUtc`. Callers must
   * not assume the intervals are merged or non-overlapping.
   */
  getBusyIntervals(req: GetBusyIntervalsRequest): Promise<BusyInterval[]>;

  /** Stable provider identity, recorded in audit events, e.g. `deterministic-test`. */
  name(): string;
}
