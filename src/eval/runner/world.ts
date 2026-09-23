/**
 * Turning a scenario's `world` into REAL ROWS.
 *
 * Everything here goes through the same `seedSliceWorld`, the same
 * repositories and the same `MeetingSchedulingService` the product uses. There
 * is no benchmark-only path into the database, because a benchmark that seeds
 * its own shortcut rows stops testing the thing it claims to test the moment
 * the real path changes.
 *
 * The one thing that IS special is the database file: a throwaway SQLite file
 * under a gitignored directory, created fresh for a run and deleted after,
 * exactly as `src/app/sliceDemo.ts` does it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { AgentRuntime } from '../../app/composition.js';
import { seedSliceWorld, type SliceWorld } from '../../app/seedSliceWorld.js';
import { createProviderRegistry, type ProviderRegistry } from '../../providers/index.js';
import type { DailyLocalBusyRule } from '../../providers/deterministicAvailabilityProvider.js';
import { FixedClock } from '../../ports/clock.js';
import { newCorrelationId } from '../../shared/ids.js';
import type { BenchmarkScenario } from '../corpus/schema.js';

/**
 * Locate the Prisma CLI through Node's own resolver.
 *
 * NOT `join(repoRoot, 'node_modules', ...)`. This repository is checked out as
 * a git worktree whose `node_modules` lives at the workspace root above it, so
 * a path built from the repo root does not exist. `createRequire().resolve`
 * walks the same chain Node itself would and finds the package wherever it is
 * actually installed.
 */
function prismaCliPath(): string {
  return createRequire(import.meta.url).resolve('prisma/build/index.js');
}

/** Apply the frozen Prisma schema to a brand-new SQLite file. */
export function applySchema(repoRoot: string, databasePath: string): void {
  mkdirSync(dirname(databasePath), { recursive: true });
  execFileSync(
    process.execPath,
    [
      prismaCliPath(),
      'db',
      'push',
      '--schema',
      join(repoRoot, 'prisma', 'schema.prisma'),
      '--skip-generate',
      '--accept-data-loss',
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: `file:${databasePath.replace(/\\/g, '/')}`,
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
      stdio: 'pipe',
    },
  );
}

/**
 * A provider registry carrying this scenario's diary.
 *
 * Busy rules become REAL busy intervals in the deterministic availability
 * provider, which is how a scenario makes `schedule_meeting` genuinely refuse
 * without anybody mocking a refusal.
 */
export function providersForScenario(scenario: BenchmarkScenario): ProviderRegistry {
  const rules: DailyLocalBusyRule[] = (scenario.world.busyRules ?? []).map((rule) => ({
    timezone: scenario.world.contactTimezone,
    startLocal: rule.startLocal,
    endLocal: rule.endLocal,
    ...(rule.isoWeekdays ? { isoWeekdays: rule.isoWeekdays } : {}),
    ...(rule.label ? { label: rule.label } : {}),
  }));

  return createProviderRegistry(rules.length > 0 ? { availability: { options: { rules } } } : {});
}

export function clockForScenario(scenario: BenchmarkScenario): FixedClock {
  return new FixedClock(scenario.world.nowUtc);
}

export interface PreparedWorld {
  readonly world: SliceWorld;
  readonly conversationId: string;
  /** Meeting ids the model can legitimately learn about. */
  readonly knownMeetingIds: Set<string>;
  readonly seededMeetingId: string | null;
}

/**
 * Seed the world, replay any prior conversation, and book any seeded meeting.
 *
 * `suffix` keeps several scenarios' worlds apart inside one database file, so a
 * whole run costs one `prisma db push` rather than one per scenario.
 */
export async function prepareWorld(
  runtime: AgentRuntime,
  scenario: BenchmarkScenario,
  suffix: string,
  systemPromptRef?: string,
): Promise<PreparedWorld> {
  const world = await seedSliceWorld(runtime.db, {
    suffix,
    // Which instructions this conversation is pinned to. The context-assembly
    // path needs `sales-scheduler-local@v2`, which is a superset of v1 and adds
    // the clauses that govern how the assembled background may be used.
    ...(systemPromptRef ? { systemPromptRef } : {}),
    contactFullName: scenario.world.contactFullName,
    contactTimezone: scenario.world.contactTimezone,
    contactIsDecisionMaker: scenario.world.contactIsDecisionMaker,
    organizationTimezone: scenario.world.organizationTimezone,
    businessHoursStartLocal: scenario.world.businessHoursStartLocal,
    businessHoursEndLocal: scenario.world.businessHoursEndLocal,
    minLeadTimeMinutes: scenario.world.minLeadTimeMinutes,
    maxSchedulingHorizonDays: scenario.world.maxSchedulingHorizonDays,
    ...(scenario.world.allowedTools ? { allowedTools: scenario.world.allowedTools } : {}),
  });

  const conversation = await runtime.conversations.start({
    organizationId: world.organization.id,
    contactId: world.contact.id,
    aiAgentId: world.aiAgent.id,
    agentConfigurationId: world.agentConfiguration.id,
    channel: 'VOICE',
  });

  // ---- an earlier exchange, replayed into the transcript -------------------
  for (const turn of scenario.world.priorConversation ?? []) {
    if (turn.role === 'CONTACT') await runtime.conversations.appendContactUtterance(conversation.id, turn.text);
    else await runtime.conversations.appendAgentText(conversation.id, turn.text);
  }

  // ---- a meeting already in the diary, booked the real way -----------------
  const knownMeetingIds = new Set<string>();
  let seededMeetingId: string | null = null;

  if (scenario.world.seededMeeting) {
    const result = await runtime.meetings.schedule({
      organizationId: world.organization.id,
      contactId: world.contact.id,
      conversationId: conversation.id,
      agentConfigurationId: world.agentConfiguration.id,
      proposal: {
        raw: scenario.world.seededMeeting.when,
        ...(scenario.world.seededMeeting.durationMinutes !== undefined
          ? { durationMinutes: scenario.world.seededMeeting.durationMinutes }
          : {}),
      },
      title: scenario.world.seededMeeting.title,
      calendarConnectionId: world.calendarConnection.id,
      correlationId: newCorrelationId(),
    });

    // A seeded meeting that will not validate is a CORPUS bug - the scenario
    // asked for a time its own world forbids - so it fails loudly here rather
    // than leaving a reschedule scenario silently unscorable against every
    // model, which would look like a model result.
    if (!result.ok) {
      throw new Error(
        `Scenario "${scenario.id}" could not seed its meeting ("${scenario.world.seededMeeting.when}"): ` +
          `${result.code} - ${result.reason}. Fix the scenario's world, not the model.`,
      );
    }

    seededMeetingId = result.value.meeting.id;
    knownMeetingIds.add(result.value.meeting.id);
  }

  return { world, conversationId: conversation.id, knownMeetingIds, seededMeetingId };
}
