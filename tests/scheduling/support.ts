/**
 * Shared wiring for the database-backed scheduling suites.
 *
 * Builds one coherent stack - isolated SQLite file, seeded fixtures, a
 * `FixedClock`, the three deterministic providers, the validator, both services
 * and a runner - so each test file states only what it is actually testing.
 *
 * Nothing here reads the wall clock, generates a random value, or opens a
 * socket.
 */
import { createDatabase, type Database } from '../../src/db/database.js';
import { FixedClock } from '../../src/ports/clock.js';
import { DueActionRunner, type BackoffPolicy } from '../../src/followup/dueActionRunner.js';
import { FutureActionService } from '../../src/followup/futureActionService.js';
import {
  DeterministicAvailabilityProvider,
  DeterministicCalendarProvider,
  DeterministicTelephonyProvider,
  type DeterministicAvailabilityProviderOptions,
  type DeterministicCalendarProviderOptions,
  type DeterministicTelephonyProviderOptions,
} from '../../src/providers/index.js';
import { MeetingSchedulingService } from '../../src/scheduling/meetingSchedulingService.js';
import { SchedulingValidator } from '../../src/scheduling/schedulingValidator.js';
import { createTestDatabase, DEFAULT_TEST_NOW_UTC, type TestDatabase } from '../helpers/testDb.js';
import type { SeedTestFixturesOptions, TestFixtures } from '../helpers/fixtures.js';

/** The agent's own number in the deterministic fixture world. */
export const AGENT_PHONE_E164 = '+12125550100';

export interface SchedulingHarnessOptions {
  readonly label: string;
  readonly nowUtc?: string;
  readonly seed?: SeedTestFixturesOptions;
  readonly availability?: DeterministicAvailabilityProviderOptions;
  readonly calendar?: DeterministicCalendarProviderOptions;
  readonly telephony?: DeterministicTelephonyProviderOptions;
  readonly runnerId?: string;
  readonly leaseMilliseconds?: number;
  readonly backoff?: Partial<BackoffPolicy>;
}

export interface SchedulingHarness {
  readonly testDb: TestDatabase;
  readonly db: Database;
  readonly clock: FixedClock;
  readonly fixtures: TestFixtures;
  readonly availability: DeterministicAvailabilityProvider;
  readonly calendar: DeterministicCalendarProvider;
  readonly telephony: DeterministicTelephonyProvider;
  readonly validator: SchedulingValidator;
  readonly meetings: MeetingSchedulingService;
  readonly futureActions: FutureActionService;
  readonly runner: DueActionRunner;
  /** Domain-row counts, for "nothing was persisted" assertions. */
  counts(): Promise<DomainRowCounts>;
  cleanup(): Promise<void>;
}

export interface DomainRowCounts {
  readonly meetings: number;
  readonly futureActions: number;
  readonly calls: number;
  readonly callOutcomes: number;
  readonly tasks: number;
}

export async function createSchedulingHarness(options: SchedulingHarnessOptions): Promise<SchedulingHarness> {
  const testDb = await createTestDatabase({
    label: options.label,
    nowUtc: options.nowUtc ?? DEFAULT_TEST_NOW_UTC,
  });
  const fixtures = await testDb.seedFixtures(options.seed);

  const availability = new DeterministicAvailabilityProvider(options.availability ?? {});
  const calendar = new DeterministicCalendarProvider(options.calendar ?? {});
  const telephony = new DeterministicTelephonyProvider(options.telephony ?? {});

  const validator = new SchedulingValidator({ clock: testDb.clock, availability });

  return {
    testDb,
    db: testDb.db,
    clock: testDb.clock,
    fixtures,
    availability,
    calendar,
    telephony,
    validator,
    meetings: new MeetingSchedulingService({ db: testDb.db, clock: testDb.clock, validator, calendar }),
    futureActions: new FutureActionService({ db: testDb.db, clock: testDb.clock, validator }),
    runner: new DueActionRunner({
      db: testDb.db,
      clock: testDb.clock,
      telephony,
      fromE164: AGENT_PHONE_E164,
      ...(options.runnerId ? { runnerId: options.runnerId } : {}),
      ...(options.leaseMilliseconds !== undefined ? { leaseMilliseconds: options.leaseMilliseconds } : {}),
      ...(options.backoff ? { backoff: options.backoff } : {}),
    }),
    async counts() {
      return countDomainRows(testDb.db);
    },
    async cleanup() {
      await testDb.cleanup();
    },
  };
}

export async function countDomainRows(db: Database): Promise<DomainRowCounts> {
  const [meetings, futureActions, calls, callOutcomes, tasks] = await Promise.all([
    db.prisma.meeting.count(),
    db.prisma.futureAction.count(),
    db.prisma.call.count(),
    db.prisma.callOutcome.count(),
    db.prisma.task.count(),
  ]);
  return { meetings, futureActions, calls, callOutcomes, tasks };
}

/** A fresh `Database` over the same file - the "process restarted" simulation. */
export function reopen(testDb: TestDatabase, nowUtc: string): Database {
  return createDatabase({ datasourceUrl: testDb.databaseUrl, clock: new FixedClock(nowUtc) });
}

export const ZERO_DOMAIN_ROWS: DomainRowCounts = {
  meetings: 0,
  futureActions: 0,
  calls: 0,
  callOutcomes: 0,
  tasks: 0,
};
