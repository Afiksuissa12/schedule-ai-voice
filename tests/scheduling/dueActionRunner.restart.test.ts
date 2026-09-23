/**
 * THE RESTART-RESUMABILITY PROOF.
 *
 * This is the concrete evidence for the Founder rule that follow-up must not
 * depend on the model remembering anything:
 *
 *   "A scheduled future action such as CALL_CONTACT at a validated future
 *    datetime and timezone must persist independently of any LLM context window
 *    and be resumable by a background execution mechanism."
 *
 * The test is written in two phases with a hard wall between them. Phase one
 * builds the whole stack, schedules a callback, and then destroys EVERYTHING -
 * the service, the validator, the providers, the runner, the repositories and
 * the Prisma client are disconnected and dropped. The only thing that crosses
 * the wall is a file path, which is exactly what survives a real process
 * restart.
 *
 * Phase two constructs a brand-new Prisma client, a brand-new clock, a
 * brand-new telephony double and a brand-new runner against that file, with no
 * knowledge of what phase one did beyond what is on disk, advances the clock
 * past the scheduled instant, and runs ONE pass.
 *
 * If this test passes, a promised callback survives a deploy, a crash and a
 * cold boot.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../../src/db/database.js';
import { parseValidationProvenance } from '../../src/domain/provenance.js';
import { DueActionRunner } from '../../src/followup/dueActionRunner.js';
import { FutureActionService } from '../../src/followup/futureActionService.js';
import { parseCallContactPayload } from '../../src/followup/payloads.js';
import { FixedClock } from '../../src/ports/clock.js';
import {
  DeterministicAvailabilityProvider,
  DeterministicTelephonyProvider,
} from '../../src/providers/index.js';
import { SchedulingValidator } from '../../src/scheduling/schedulingValidator.js';
import { createTestDatabase, DEFAULT_TEST_NOW_UTC, type TestDatabase } from '../helpers/testDb.js';

const AGENT_PHONE = '+12125550100';
const CORRELATION = 'corr_promise_made_before_the_restart';
/** Thursday 2026-03-05, 15:00 America/New_York. */
const EXPECTED_DUE_UTC = '2026-03-05T20:00:00.000Z';
/** Comfortably after the callback was due, as if the process had been down. */
const AFTER_RESTART_UTC = '2026-03-05T20:07:00.000Z';

describe('a promised callback survives a process restart', () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ label: 'runner-restart', nowUtc: DEFAULT_TEST_NOW_UTC });
  });
  afterEach(async () => {
    await testDb.cleanup();
  });

  it('dispatches the call and reaches DONE with an entirely new process worth of objects', async () => {
    const fixtures = await testDb.seedFixtures();
    const contactPhone = fixtures.contact.primaryPhoneE164;

    // =====================================================================
    // PHASE ONE - the agent turn that makes the promise.
    // =====================================================================
    let futureActionId: string;
    {
      const clock = new FixedClock(DEFAULT_TEST_NOW_UTC);
      const db = createDatabase({ datasourceUrl: testDb.databaseUrl, clock });
      const service = new FutureActionService({
        db,
        clock,
        validator: new SchedulingValidator({ clock, availability: new DeterministicAvailabilityProvider() }),
      });

      const scheduled = await service.schedule({
        organizationId: fixtures.organization.id,
        contactId: fixtures.contact.id,
        agentConfigurationId: fixtures.agentConfiguration.id,
        proposal: { raw: 'call me back tomorrow afternoon at 3' },
        reason: 'contact asked to be called back',
        correlationId: CORRELATION,
      });

      expect(scheduled.ok).toBe(true);
      if (!scheduled.ok) throw new Error(scheduled.reason);
      expect(scheduled.value.futureAction.scheduledForUtc).toBe(EXPECTED_DUE_UTC);
      expect(scheduled.value.futureAction.status).toBe('PENDING');

      futureActionId = scheduled.value.futureAction.id;

      // ---- the wall: discard everything --------------------------------
      await db.disconnect();
    }
    // Nothing from phase one is reachable any more. No service, no validator,
    // no provider, no repositories, no Prisma client, and no LLM context.
    // `futureActionId` is only kept so the assertions can name the row; the
    // runner below is never told about it.

    // =====================================================================
    // PHASE TWO - a cold process, later.
    // =====================================================================
    const restartedClock = new FixedClock(AFTER_RESTART_UTC);
    const restartedDb: Database = createDatabase({
      datasourceUrl: testDb.databaseUrl,
      clock: restartedClock,
    });
    const restartedTelephony = new DeterministicTelephonyProvider();

    try {
      // Everything the new process knows, it reads off the disk.
      const rehydrated = await restartedDb.futureActions.requireById(futureActionId);
      expect(rehydrated.status).toBe('PENDING');
      expect(rehydrated.type).toBe('CALL_CONTACT');
      expect(rehydrated.scheduledForUtc).toBe(EXPECTED_DUE_UTC);
      expect(rehydrated.timezone).toBe('America/New_York');

      const payload = parseCallContactPayload(rehydrated.payloadJson);
      expect(payload.toE164).toBe(contactPhone);
      expect(payload.correlationId).toBe(CORRELATION);

      // The receipt that justified the time is on disk too, not in a context window.
      const provenance = parseValidationProvenance(rehydrated.validationProvenanceJson);
      expect(provenance.rawProposedValue).toBe('call me back tomorrow afternoon at 3');
      expect(provenance.resolvedStartUtc).toBe(EXPECTED_DUE_UTC);

      const runner = new DueActionRunner({
        db: restartedDb,
        clock: restartedClock,
        telephony: restartedTelephony,
        fromE164: AGENT_PHONE,
        runnerId: 'runner-after-restart',
      });

      // ---- ONE pass -----------------------------------------------------
      const summary = await runner.runDueActions(restartedClock.nowUtc());

      expect(summary).toMatchObject({ claimed: 1, executed: 1, retried: 0, failed: 0 });

      // The call really was dispatched through the telephony port.
      expect(restartedTelephony.placedCalls).toHaveLength(1);
      const placed = restartedTelephony.placedCalls[0];
      expect(placed?.request.toE164).toBe(contactPhone);
      expect(placed?.request.fromE164).toBe(AGENT_PHONE);
      expect(placed?.request.correlationId).toBe(CORRELATION);
      expect(placed?.status).toBe('COMPLETED');

      // And the action reached DONE.
      const finished = await restartedDb.futureActions.requireById(futureActionId);
      expect(finished.status).toBe('DONE');
      expect(finished.attempts).toBe(1);
      expect(finished.completedAt).toBe(AFTER_RESTART_UTC);

      // With Call and CallOutcome rows to show for it.
      const calls = await restartedDb.calls.listByContact(fixtures.contact.id);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.status).toBe('COMPLETED');
      expect((await restartedDb.callOutcomes.requireByCallId(calls[0]?.id ?? '')).outcome).toBe('CONNECTED');

      // The audit chain spans BOTH processes under one correlation id: the
      // promise, the claim, and the call that kept it.
      const chain = await restartedDb.audit.listByCorrelationId(CORRELATION);
      expect(chain.map((event) => event.type)).toEqual([
        'FUTURE_ACTION_SCHEDULED',
        'FUTURE_ACTION_CLAIMED',
        'FUTURE_ACTION_EXECUTED',
      ]);
      expect(JSON.parse(chain[1]?.detailJson ?? '{}').runnerId).toBe('runner-after-restart');
    } finally {
      await restartedDb.disconnect();
    }
  });

  it('is the DATABASE that remembers, not the runner: a third client sees the same result', async () => {
    const fixtures = await testDb.seedFixtures();

    const clock = new FixedClock(DEFAULT_TEST_NOW_UTC);
    const db = createDatabase({ datasourceUrl: testDb.databaseUrl, clock });
    const service = new FutureActionService({
      db,
      clock,
      validator: new SchedulingValidator({ clock, availability: new DeterministicAvailabilityProvider() }),
    });
    const scheduled = await service.schedule({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      agentConfigurationId: fixtures.agentConfiguration.id,
      proposal: { raw: 'tomorrow afternoon at 3' },
      correlationId: 'corr_third_client',
    });
    if (!scheduled.ok) throw new Error(scheduled.reason);
    const id = scheduled.value.futureAction.id;
    await db.disconnect();

    const runnerClock = new FixedClock(AFTER_RESTART_UTC);
    const runnerDb = createDatabase({ datasourceUrl: testDb.databaseUrl, clock: runnerClock });
    try {
      await new DueActionRunner({
        db: runnerDb,
        clock: runnerClock,
        telephony: new DeterministicTelephonyProvider(),
        fromE164: AGENT_PHONE,
      }).runDueActions();
    } finally {
      await runnerDb.disconnect();
    }

    // A third, completely independent reader.
    const reader = createDatabase({ datasourceUrl: testDb.databaseUrl, clock: new FixedClock(AFTER_RESTART_UTC) });
    try {
      expect((await reader.futureActions.requireById(id)).status).toBe('DONE');
      expect((await reader.calls.listByContact(fixtures.contact.id))[0]?.status).toBe('COMPLETED');
    } finally {
      await reader.disconnect();
    }
  });
});
