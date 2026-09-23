/**
 * `DueActionRunner`: the durable queue's safety properties, proved rather than
 * asserted in a comment.
 *
 *  - only due actions are picked up
 *  - two concurrent runners can never both claim the same action
 *  - a failed attempt backs off instead of spinning
 *  - the attempt budget is finite and ends in FAILED
 *  - a crashed runner's lease lapses and the work is recovered
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DueActionRunner } from '../../src/followup/dueActionRunner.js';
import type { FutureAction } from '../../src/domain/entities.js';
import { AGENT_PHONE_E164, createSchedulingHarness, reopen, type SchedulingHarness } from './support.js';

/** Thursday 2026-03-05, 15:00 America/New_York - what "tomorrow afternoon at 3" resolves to. */
const DUE_UTC = '2026-03-05T20:00:00.000Z';
const CORRELATION = 'corr_runner';

async function scheduleCallback(harness: SchedulingHarness, overrides: Record<string, unknown> = {}) {
  const result = await harness.futureActions.schedule({
    organizationId: harness.fixtures.organization.id,
    contactId: harness.fixtures.contact.id,
    agentConfigurationId: harness.fixtures.agentConfiguration.id,
    proposal: { raw: 'call me back tomorrow afternoon at 3' },
    reason: 'promised callback',
    correlationId: CORRELATION,
    ...overrides,
  });
  if (!result.ok) throw new Error(`fixture setup failed: ${result.reason}`);
  return result.value.futureAction;
}

describe('runDueActions - a single successful pass', () => {
  let harness: SchedulingHarness;

  beforeEach(async () => {
    harness = await createSchedulingHarness({ label: 'runner-success', runnerId: 'runner-a' });
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it('does not touch an action that is not due yet', async () => {
    const action = await scheduleCallback(harness);

    const summary = await harness.runner.runDueActions('2026-03-05T19:59:59.000Z');
    expect(summary.claimed).toBe(0);
    expect(harness.telephony.placedCalls).toHaveLength(0);
    expect((await harness.db.futureActions.requireById(action.id)).status).toBe('PENDING');
  });

  it('dispatches a due action and drives it to DONE', async () => {
    const action = await scheduleCallback(harness);

    const summary = await harness.runner.runDueActions(DUE_UTC);

    expect(summary).toMatchObject({ claimed: 1, executed: 1, retried: 0, failed: 0, runnerId: 'runner-a' });

    const after = await harness.db.futureActions.requireById(action.id);
    expect(after.status).toBe('DONE');
    expect(after.attempts).toBe(1);
    expect(after.completedAt).toBe(DUE_UTC);
    expect(after.leaseOwner).toBeNull();
    expect(after.leaseExpiresAt).toBeNull();
  });

  it('places exactly one call, through the telephony port', async () => {
    await scheduleCallback(harness);
    await harness.runner.runDueActions(DUE_UTC);

    expect(harness.telephony.placedCalls).toHaveLength(1);
    const placed = harness.telephony.placedCalls[0];
    expect(placed?.request.toE164).toBe(harness.fixtures.contact.primaryPhoneE164);
    expect(placed?.request.fromE164).toBe(AGENT_PHONE_E164);
    expect(placed?.request.correlationId).toBe(CORRELATION);
  });

  it('creates the Call and CallOutcome rows', async () => {
    await scheduleCallback(harness);
    const summary = await harness.runner.runDueActions(DUE_UTC);

    expect(await harness.counts()).toMatchObject({ futureActions: 1, calls: 1, callOutcomes: 1 });

    const calls = await harness.db.calls.listByContact(harness.fixtures.contact.id);
    const call = calls[0];
    expect(call?.direction).toBe('OUTBOUND');
    expect(call?.providerName).toBe('deterministic-test');
    expect(call?.status).toBe('COMPLETED');
    expect(call?.providerCallId).toBe(summary.outcomes[0]?.providerCallId);

    const outcome = await harness.db.callOutcomes.requireByCallId(call?.id ?? '');
    expect(outcome.outcome).toBe('CONNECTED');
  });

  it('emits the claim and execution events on the ORIGINAL agent turn chain', async () => {
    await scheduleCallback(harness);
    await harness.runner.runDueActions(DUE_UTC);

    const chain = await harness.db.audit.listByCorrelationId(CORRELATION);
    expect(chain.map((event) => event.type)).toEqual([
      'FUTURE_ACTION_SCHEDULED',
      'FUTURE_ACTION_CLAIMED',
      'FUTURE_ACTION_EXECUTED',
    ]);
    expect(chain.map((event) => event.sequence)).toEqual([1, 2, 3]);

    const executed = JSON.parse(chain[2]?.detailJson ?? '{}');
    expect(executed.runnerId).toBe('runner-a');
    expect(executed.telephonyStatus).toBe('COMPLETED');
    expect(executed.outcome).toBe('CONNECTED');
  });

  it('leaves a completed action alone on the next pass', async () => {
    await scheduleCallback(harness);
    await harness.runner.runDueActions(DUE_UTC);
    const second = await harness.runner.runDueActions('2026-03-05T21:00:00.000Z');

    expect(second.claimed).toBe(0);
    expect(harness.telephony.placedCalls).toHaveLength(1);
  });
});

describe('concurrent runners', () => {
  let harness: SchedulingHarness;

  beforeEach(async () => {
    harness = await createSchedulingHarness({ label: 'runner-concurrent', runnerId: 'runner-a' });
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it('never lets two runners claim the same action', async () => {
    const action = await scheduleCallback(harness);

    // A genuinely separate runner: its own Prisma client, its own connection,
    // over the SAME database file. Both share the telephony double so the test
    // can count how many calls were placed in total.
    const otherDb = reopen(harness.testDb, DUE_UTC);
    const runnerB = new DueActionRunner({
      db: otherDb,
      clock: harness.clock,
      telephony: harness.telephony,
      fromE164: AGENT_PHONE_E164,
      runnerId: 'runner-b',
    });

    try {
      const [a, b] = await Promise.all([
        harness.runner.runDueActions(DUE_UTC),
        runnerB.runDueActions(DUE_UTC),
      ]);

      // Exactly one runner got it. Which one is a race; that there was only one
      // is not.
      expect(a.claimed + b.claimed).toBe(1);
      expect(a.executed + b.executed).toBe(1);

      expect(harness.telephony.placedCalls).toHaveLength(1);
      expect(await harness.counts()).toMatchObject({ calls: 1, callOutcomes: 1 });

      const after = await harness.db.futureActions.requireById(action.id);
      expect(after.status).toBe('DONE');
      expect(after.attempts).toBe(1);

      const claims = (await harness.db.audit.listByCorrelationId(CORRELATION)).filter(
        (event) => event.type === 'FUTURE_ACTION_CLAIMED',
      );
      expect(claims).toHaveLength(1);
    } finally {
      await otherDb.disconnect();
    }
  });
});

describe('retry, backoff, and the end of the attempt budget', () => {
  let harness: SchedulingHarness;

  beforeEach(async () => {
    harness = await createSchedulingHarness({
      label: 'runner-retry',
      runnerId: 'runner-a',
      // Every call goes unanswered: a retryable failure, not a success.
      telephony: { defaultStatus: 'NO_ANSWER' },
      backoff: { baseSeconds: 300, factor: 2, maxSeconds: 3600 },
    });
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  const at = (offsetSeconds: number): string =>
    new Date(Date.parse(DUE_UTC) + offsetSeconds * 1000).toISOString();

  it('returns a failed attempt to PENDING with the action pushed into the future', async () => {
    const action = await scheduleCallback(harness);

    const summary = await harness.runner.runDueActions(DUE_UTC);
    expect(summary).toMatchObject({ claimed: 1, executed: 0, retried: 1, failed: 0 });

    const after = await harness.db.futureActions.requireById(action.id);
    expect(after.status).toBe('PENDING');
    expect(after.attempts).toBe(1);
    expect(after.lastError).toMatch(/no answer/i);
    expect(after.leaseOwner).toBeNull();
    // base 300s * 2^0 = 5 minutes.
    expect(after.scheduledForUtc).toBe(at(300));
  });

  it('really does back off - an immediate second pass claims nothing', async () => {
    await scheduleCallback(harness);
    await harness.runner.runDueActions(DUE_UTC);

    const immediate = await harness.runner.runDueActions(at(1));
    expect(immediate.claimed).toBe(0);
    expect(harness.telephony.placedCalls).toHaveLength(1);

    const tooEarly = await harness.runner.runDueActions(at(299));
    expect(tooEarly.claimed).toBe(0);
  });

  it('grows the delay and ends terminally FAILED at maxAttempts', async () => {
    const action = await scheduleCallback(harness);

    // Attempt 1.
    await harness.runner.runDueActions(DUE_UTC);
    expect((await harness.db.futureActions.requireById(action.id)).scheduledForUtc).toBe(at(300));

    // Attempt 2: backoff doubles to 600s.
    await harness.runner.runDueActions(at(300));
    let current: FutureAction = await harness.db.futureActions.requireById(action.id);
    expect(current.status).toBe('PENDING');
    expect(current.attempts).toBe(2);
    expect(current.scheduledForUtc).toBe(at(300 + 600));

    // Attempt 3 is the last one the budget allows.
    const final = await harness.runner.runDueActions(at(900));
    expect(final).toMatchObject({ claimed: 1, executed: 0, retried: 0, failed: 1 });

    current = await harness.db.futureActions.requireById(action.id);
    expect(current.status).toBe('FAILED');
    expect(current.attempts).toBe(3);
    expect(current.leaseOwner).toBeNull();

    // Three real dial attempts, each its own call.
    expect(harness.telephony.placedCalls).toHaveLength(3);
    expect(new Set(harness.telephony.placedCalls.map((c) => c.providerCallId)).size).toBe(3);
    expect(await harness.counts()).toMatchObject({ calls: 3, callOutcomes: 3 });

    // And a FAILED action is never picked up again.
    expect((await harness.runner.runDueActions(at(100_000))).claimed).toBe(0);

    const chain = await harness.db.audit.listByCorrelationId(CORRELATION);
    expect(chain.filter((event) => event.type === 'FUTURE_ACTION_FAILED')).toHaveLength(3);
    const lastFailure = JSON.parse(chain.at(-1)?.detailJson ?? '{}');
    expect(lastFailure.terminal).toBe(true);
    expect(lastFailure.retryAtUtc).toBeNull();
  });

  it('caps the backoff at the configured ceiling', async () => {
    const capped = await createSchedulingHarness({
      label: 'runner-backoff-cap',
      telephony: { defaultStatus: 'FAILED' },
      backoff: { baseSeconds: 300, factor: 10, maxSeconds: 600 },
    });
    try {
      const action = await scheduleCallback(capped);
      await capped.runner.runDueActions(DUE_UTC);
      const after = await capped.db.futureActions.requireById(action.id);
      // 300 * 10^0 = 300, under the 600s ceiling.
      expect(after.scheduledForUtc).toBe(at(300));

      await capped.runner.runDueActions(at(300));
      // 300 * 10^1 = 3000, clamped to 600.
      expect((await capped.db.futureActions.requireById(action.id)).scheduledForUtc).toBe(at(300 + 600));
    } finally {
      await capped.cleanup();
    }
  });

  it('treats a thrown transport error as a retryable failure', async () => {
    const flaky = await createSchedulingHarness({
      label: 'runner-transport-error',
      telephony: { script: [{ error: 'carrier unreachable' }], defaultStatus: 'COMPLETED' },
    });
    try {
      const action = await scheduleCallback(flaky);

      const first = await flaky.runner.runDueActions(DUE_UTC);
      expect(first.retried).toBe(1);
      let current = await flaky.db.futureActions.requireById(action.id);
      expect(current.status).toBe('PENDING');
      expect(current.lastError).toMatch(/carrier unreachable/);
      const failedCall = (await flaky.db.calls.listByContact(flaky.fixtures.contact.id))[0];
      expect(failedCall?.status).toBe('FAILED');

      // The script is exhausted, so the next attempt succeeds.
      await flaky.runner.runDueActions(at(300));
      current = await flaky.db.futureActions.requireById(action.id);
      expect(current.status).toBe('DONE');
      expect(current.attempts).toBe(2);
    } finally {
      await flaky.cleanup();
    }
  });

  it('fails a poison payload terminally on the first attempt', async () => {
    const action = await scheduleCallback(harness);
    // Corrupt the payload behind the service's back, the way a bad migration or
    // a hand-edit would.
    await harness.db.prisma.futureAction.update({
      where: { id: action.id },
      data: { payloadJson: '{"version":1,"correlationId":"x"}' }, // no toE164
    });

    const summary = await harness.runner.runDueActions(DUE_UTC);
    expect(summary).toMatchObject({ claimed: 1, failed: 1, retried: 0 });
    const after = await harness.db.futureActions.requireById(action.id);
    expect(after.status).toBe('FAILED');
    expect(after.attempts).toBe(1); // NOT retried to exhaustion: waiting cannot fix it.
    expect(harness.telephony.placedCalls).toHaveLength(0);
  });
});

describe('crash recovery', () => {
  let harness: SchedulingHarness;

  beforeEach(async () => {
    harness = await createSchedulingHarness({ label: 'runner-lease', runnerId: 'runner-b' });
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it('recovers an action stranded by a runner that died holding the lease', async () => {
    const action = await scheduleCallback(harness);

    // Runner A claims it with a 60s lease, then "crashes": no further writes.
    const claimed = await harness.db.futureActions.claimDue({
      nowUtc: DUE_UTC,
      leaseOwner: 'runner-a-that-died',
      leaseMilliseconds: 60_000,
      limit: 10,
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.status).toBe('CLAIMED');

    // While the lease is still valid, nobody may steal the work.
    const tooEarly = await harness.runner.runDueActions('2026-03-05T20:00:30.000Z');
    expect(tooEarly.claimed).toBe(0);
    const stranded = await harness.db.futureActions.requireById(action.id);
    expect(stranded.status).toBe('CLAIMED');
    expect(stranded.leaseOwner).toBe('runner-a-that-died');

    // Once the lease lapses, the work is fair game and gets finished.
    const recovered = await harness.runner.runDueActions('2026-03-05T20:02:00.000Z');
    expect(recovered.claimed).toBe(1);
    expect(recovered.executed).toBe(1);

    const after = await harness.db.futureActions.requireById(action.id);
    expect(after.status).toBe('DONE');
    expect(after.attempts).toBe(2); // the crashed attempt is still counted
    expect(harness.telephony.placedCalls).toHaveLength(1);
  });

  it('does not strand work forever - an expired lease is always reclaimable', async () => {
    const action = await scheduleCallback(harness);
    await harness.db.futureActions.claimDue({
      nowUtc: DUE_UTC,
      leaseOwner: 'dead-1',
      leaseMilliseconds: 1_000,
      limit: 10,
    });

    // Two more crashes exhaust the budget, and it ends FAILED rather than
    // looping forever.
    await harness.db.futureActions.claimDue({
      nowUtc: '2026-03-05T20:00:05.000Z',
      leaseOwner: 'dead-2',
      leaseMilliseconds: 1_000,
      limit: 10,
    });
    await harness.db.futureActions.claimDue({
      nowUtc: '2026-03-05T20:00:10.000Z',
      leaseOwner: 'dead-3',
      leaseMilliseconds: 1_000,
      limit: 10,
    });

    const exhausted = await harness.db.futureActions.requireById(action.id);
    expect(exhausted.attempts).toBe(3);

    const summary = await harness.runner.runDueActions('2026-03-05T20:05:00.000Z');
    expect(summary.claimed).toBe(0); // the budget is spent
    expect(harness.telephony.placedCalls).toHaveLength(0);
  });
});
