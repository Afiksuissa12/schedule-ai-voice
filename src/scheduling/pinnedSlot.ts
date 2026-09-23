/**
 * One turn, one `now`, one resolution - and a check that says so.
 *
 * THE PROBLEM THIS SOLVES
 * ---------------------------------------------------------------------------
 * `ToolDispatcher` validates the model's raw phrase at the chokepoint, records
 * the resulting `ResolvedSlot` in `TOOL_CALL_VALIDATED`, and then calls a
 * service. The services validate again - deliberate belt and braces, so that a
 * service reached by some future path that is not the chokepoint is still safe.
 *
 * That second validation is only harmless if it cannot reach a DIFFERENT answer.
 * It used to be able to: each service called `clock.nowUtc()` again and
 * re-resolved the raw phrase against a second, later instant. A contact speaking
 * moments before their own local midnight had "tomorrow" read as one day by the
 * chokepoint and as the next day by the service milliseconds later, and it was
 * the second answer that was persisted. The audit trail then named an instant
 * the database did not hold.
 *
 * THE FIX, IN TWO PARTS
 * ---------------------------------------------------------------------------
 *  1. `nowUtc` is THREADED. Every service input carries the instant the caller
 *     pinned, and the services use it instead of reading the clock again. The
 *     resolver is a pure function of (raw phrase, timezone, `now`, policy), so
 *     with `now` held equal the second resolution cannot differ from the first.
 *  2. It is CHECKED, not assumed. The caller also passes the slot it already
 *     validated, and `assertResolutionsAgree` compares the two before anything
 *     is written. Part 1 makes disagreement impossible; part 2 means that if it
 *     ever becomes possible again, the system refuses loudly instead of
 *     persisting a row its own audit trail contradicts.
 *
 * WHY THROW RATHER THAN REJECT
 * ---------------------------------------------------------------------------
 * A disagreement here is not something the contact said wrong and not something
 * the model can fix by trying again - it means the deterministic pipeline is no
 * longer deterministic. That is the system being broken, and a turn that cannot
 * be explained must not continue. No domain row is written: the check runs
 * before the persisting transaction opens.
 */
import { InvariantViolationError } from '../shared/errors.js';
import type { ResolvedSlot } from './dateTimeResolver.js';

/**
 * Refuse to persist when the caller's already-validated slot and the service's
 * own re-validation of the same phrase name different instants.
 *
 * `expected` absent means there was no chokepoint resolution to reconcile
 * against - a direct service call, e.g. from a test or a future non-agent
 * caller. Nothing to check, and nothing is assumed.
 */
export function assertResolutionsAgree(
  operation: string,
  expected: ResolvedSlot | undefined,
  actual: ResolvedSlot,
  nowUtc: string,
): void {
  if (!expected) return;
  if (expected.startUtc === actual.startUtc && expected.endUtc === actual.endUtc) return;

  throw new InvariantViolationError(
    `${operation}: the slot validated at the chokepoint and the slot re-validated by the service disagree. ` +
      `Chokepoint said ${expected.startUtc}/${expected.endUtc}, the service said ` +
      `${actual.startUtc}/${actual.endUtc}, both against now=${nowUtc}. Nothing was persisted.`,
    {
      details: {
        operation,
        nowUtc,
        chokepointStartUtc: expected.startUtc,
        chokepointEndUtc: expected.endUtc,
        serviceStartUtc: actual.startUtc,
        serviceEndUtc: actual.endUtc,
      },
    },
  );
}
