/**
 * The end-to-end harness: an isolated database, a fixed clock, a seeded world,
 * a scripted model, and the whole runtime wired around them.
 *
 * Every e2e test starts here, so each one reads as the story it is proving
 * rather than as twenty lines of setup. Nothing in this file reaches the
 * network, requires a credential, or shares state with another test file -
 * `createTestDatabase` gives each caller its own SQLite file.
 */
import { buildAgentRuntime, type AgentRuntime } from '../../src/app/composition.js';
import { seedSliceWorld, type SeedSliceWorldOptions, type SliceWorld } from '../../src/app/seedSliceWorld.js';
import type { Conversation } from '../../src/domain/entities.js';
import { ScriptedLlmProvider, type ScriptedLlmProviderOptions } from '../../src/llm/scriptedLlmProvider.js';
import type { FixedClock } from '../../src/ports/clock.js';
import type { DeterministicTelephonyProvider } from '../../src/providers/deterministicTelephonyProvider.js';
import {
  createProviderRegistry,
  type ProviderRegistry,
  type ProviderRegistryConfig,
} from '../../src/providers/index.js';
import type { Database } from '../../src/db/database.js';
import { createTestDatabase, type TestDatabase } from '../helpers/testDb.js';

/**
 * Wednesday 2026-03-04, 15:00 UTC = 10:00 America/New_York.
 *
 * The same instant the foundation's helpers use, so an assertion written
 * against one suite reads the same way in another.
 */
export const SLICE_NOW_UTC = '2026-03-04T15:00:00.000Z';

/**
 * "tomorrow afternoon at 3" from `SLICE_NOW_UTC`, for a New York contact.
 *
 * Thursday 2026-03-05 at 15:00 EST (UTC-5) = 20:00 UTC. Written out rather than
 * computed, so the test asserts an instant a human checked rather than
 * re-running the logic under test.
 */
export const TOMORROW_AFTERNOON_AT_3_UTC = '2026-03-05T20:00:00.000Z';

export interface SliceHarnessOptions {
  readonly label: string;
  readonly nowUtc?: string;
  readonly world?: SeedSliceWorldOptions;
  readonly llm?: ScriptedLlmProviderOptions;
  readonly providers?: ProviderRegistryConfig;
  readonly maxToolIterations?: number;
}

export interface SliceHarness {
  readonly testDb: TestDatabase;
  readonly db: Database;
  readonly clock: FixedClock;
  readonly runtime: AgentRuntime;
  readonly world: SliceWorld;
  readonly llm: ScriptedLlmProvider;
  readonly providers: ProviderRegistry;
  readonly telephony: DeterministicTelephonyProvider;
  /** Start a conversation pinned to the seeded configuration. */
  startConversation(): Promise<Conversation>;
  /** Counts of every domain table a tool call could possibly write. */
  countDomainRows(): Promise<DomainRowCounts>;
  cleanup(): Promise<void>;
}

export interface DomainRowCounts {
  readonly meetings: number;
  readonly futureActions: number;
  readonly qualificationStates: number;
  readonly calls: number;
  readonly callOutcomes: number;
  readonly tasks: number;
  readonly leads: number;
  readonly contacts: number;
}

export async function createSliceHarness(options: SliceHarnessOptions): Promise<SliceHarness> {
  const testDb = await createTestDatabase({
    label: options.label,
    nowUtc: options.nowUtc ?? SLICE_NOW_UTC,
  });

  const providers = createProviderRegistry(options.providers ?? {});
  const llm = new ScriptedLlmProvider(options.llm ?? {});

  const runtime = buildAgentRuntime({
    clock: testDb.clock,
    db: testDb.db,
    providers,
    llm,
    ...(options.maxToolIterations !== undefined ? { maxToolIterations: options.maxToolIterations } : {}),
  });

  const world = await seedSliceWorld(testDb.db, options.world ?? {});

  return {
    testDb,
    db: testDb.db,
    clock: testDb.clock,
    runtime,
    world,
    llm,
    providers,
    telephony: providers.telephony as DeterministicTelephonyProvider,

    async startConversation() {
      return runtime.conversations.start({
        organizationId: world.organization.id,
        contactId: world.contact.id,
        aiAgentId: world.aiAgent.id,
        agentConfigurationId: world.agentConfiguration.id,
        channel: 'VOICE',
      });
    },

    async countDomainRows() {
      const { prisma } = testDb.db;
      const [meetings, futureActions, qualificationStates, calls, callOutcomes, tasks, leads, contacts] =
        await Promise.all([
          prisma.meeting.count(),
          prisma.futureAction.count(),
          prisma.qualificationState.count(),
          prisma.call.count(),
          prisma.callOutcome.count(),
          prisma.task.count(),
          prisma.lead.count(),
          prisma.contact.count(),
        ]);
      return { meetings, futureActions, qualificationStates, calls, callOutcomes, tasks, leads, contacts };
    },

    async cleanup() {
      await testDb.cleanup();
    },
  };
}

/**
 * Does `types` contain `expected` as an ordered subsequence?
 *
 * The mission requires certain events "in order", which is a statement about
 * RELATIVE order, not adjacency: a chain that also records which provider was
 * invoked, or that runs a second tool, still satisfies it. Asserting adjacency
 * would make the test fail for additions that improve the trail, which is
 * exactly the wrong incentive.
 */
export function containsInOrder(types: readonly string[], expected: readonly string[]): boolean {
  let cursor = 0;
  for (const type of types) {
    if (type === expected[cursor]) cursor += 1;
    if (cursor === expected.length) return true;
  }
  return expected.length === 0;
}

/** The positions of `expected` within `types`, or null if not a subsequence. */
export function positionsInOrder(types: readonly string[], expected: readonly string[]): number[] | null {
  const positions: number[] = [];
  let cursor = 0;
  for (let index = 0; index < types.length; index += 1) {
    if (types[index] === expected[cursor]) {
      positions.push(index);
      cursor += 1;
      if (cursor === expected.length) return positions;
    }
  }
  return null;
}
