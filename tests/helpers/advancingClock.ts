/**
 * A clock that MOVES - the one configuration production actually runs in.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Every other suite in this repository injects `FixedClock`, which returns the
 * same instant on every read. That makes assertions readable, but it also makes
 * an entire class of defect invisible: any code that reads `now` twice and
 * assumes the two reads agree passes every fixed-clock test and fails against a
 * wall clock, where the second read is always later than the first.
 *
 * `AdvancingClock` is the faithful stand-in. It is still deterministic - the Nth
 * read is always `base + N * stepMillis`, so a failure is reproducible - but it
 * has the one property `SystemClock` has and `FixedClock` does not: reading it
 * twice gives two different answers.
 *
 * Use it for any test whose subject is "the same `now` was used throughout".
 */
import type { Clock, IsoUtcString } from '../../src/ports/clock.js';

export interface AdvancingClockOptions {
  /** Milliseconds added before each read. Defaults to 50. */
  readonly stepMillis?: number;
}

export class AdvancingClock implements Clock {
  private baseMillis: number;
  private readonly stepMillis: number;
  private reads = 0;

  constructor(baseIsoUtc: IsoUtcString, options: AdvancingClockOptions = {}) {
    const parsed = Date.parse(baseIsoUtc);
    if (Number.isNaN(parsed)) {
      throw new TypeError(`AdvancingClock requires a valid ISO-8601 instant, got: ${baseIsoUtc}`);
    }
    this.baseMillis = parsed;
    this.stepMillis = options.stepMillis ?? 50;
  }

  nowUtc(): IsoUtcString {
    this.reads += 1;
    return new Date(this.baseMillis + this.reads * this.stepMillis).toISOString();
  }

  /**
   * Make the NEXT read return exactly `isoUtc`, with later reads advancing from
   * there.
   *
   * Needed because setting up a test (opening a database, seeding a world,
   * starting a conversation) consumes an unknown number of reads, so "the
   * instant the turn will pin" cannot be stated up front. Rebasing immediately
   * before the turn states it exactly, which is what lets a test park the pinned
   * instant a known distance from a local-midnight boundary.
   */
  rebase(isoUtc: IsoUtcString): this {
    const parsed = Date.parse(isoUtc);
    if (Number.isNaN(parsed)) {
      throw new TypeError(`AdvancingClock.rebase requires a valid ISO-8601 instant, got: ${isoUtc}`);
    }
    this.baseMillis = parsed - this.stepMillis;
    this.reads = 0;
    return this;
  }

  /** How many times `now` has been read. The whole point of the fixture. */
  get readCount(): number {
    return this.reads;
  }
}
