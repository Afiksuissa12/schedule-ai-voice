/**
 * PORT: time.
 *
 * CONTRACT: every piece of time-dependent logic in this codebase takes a
 * `Clock` by injection. No business logic calls `Date.now()`, `new Date()` or
 * `DateTime.now()` directly. A validation that says "this meeting is in the
 * past" is only meaningful - and only testable - relative to an explicit `now`,
 * and that same `now` is recorded in `ValidationProvenance.nowUtc` so an
 * auditor can re-run the decision.
 */

/** An ISO-8601 instant in UTC, e.g. `2026-03-04T14:30:00.000Z`. */
export type IsoUtcString = string;

export interface Clock {
  /** The current instant, as an ISO-8601 UTC string. */
  nowUtc(): IsoUtcString;
}

/** Production clock. The only place in the codebase that reads wall time. */
export class SystemClock implements Clock {
  nowUtc(): IsoUtcString {
    return new Date().toISOString();
  }
}

/**
 * Deterministic clock for tests and for replaying a recorded decision.
 *
 * ```ts
 * const clock = new FixedClock('2026-03-04T09:00:00.000Z');
 * clock.nowUtc();          // '2026-03-04T09:00:00.000Z'
 * clock.advance(60_000);   // move forward one minute
 * clock.setTo('2026-03-05T09:00:00.000Z');
 * ```
 */
export class FixedClock implements Clock {
  private current: Date;

  constructor(isoUtc: IsoUtcString) {
    this.current = parseOrThrow(isoUtc);
  }

  nowUtc(): IsoUtcString {
    return this.current.toISOString();
  }

  /** Move the clock forward (or backward, with a negative value). */
  advance(milliseconds: number): this {
    if (!Number.isFinite(milliseconds)) {
      throw new TypeError(`FixedClock.advance expects a finite number of milliseconds, got ${milliseconds}`);
    }
    this.current = new Date(this.current.getTime() + milliseconds);
    return this;
  }

  /** Jump to an absolute instant. */
  setTo(isoUtc: IsoUtcString): this {
    this.current = parseOrThrow(isoUtc);
    return this;
  }
}

function parseOrThrow(isoUtc: string): Date {
  const parsed = new Date(isoUtc);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`FixedClock requires a valid ISO-8601 instant, got: ${isoUtc}`);
  }
  return parsed;
}
