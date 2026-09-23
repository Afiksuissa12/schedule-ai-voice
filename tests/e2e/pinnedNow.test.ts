/**
 * ONE `now` PER TURN - proved against a clock that actually moves.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------------------------------------------------------------
 * `AgentTurnService` pins `now` once per turn and `ToolDispatcher` validates the
 * model's raw phrase against that pinned instant, then writes the resulting slot
 * into `TOOL_CALL_VALIDATED`. The row that is persisted must be derived from
 * THAT instant and no other - otherwise the audit trail names one time and the
 * database holds another, and the trail no longer explains the row.
 *
 * Every other suite here injects `FixedClock`, which returns the same value on
 * every read, so a second read of the clock cannot disagree with the first. That
 * is exactly the configuration in which this class of defect is invisible, and
 * production is the only configuration that is not covered by it.
 * `AdvancingClock` is the faithful stand-in for a wall clock: every read is
 * later than the last, and still deterministic.
 *
 * THE BOUNDARY CASE
 * ---------------------------------------------------------------------------
 * `PINNED_JUST_BEFORE_LOCAL_MIDNIGHT` is 2026-03-04T04:59:59.900Z, which is
 * 2026-03-03T23:59:59.900 for the New York contact - a tenth of a second before
 * their own local midnight. A turn that straddles that boundary reads "tomorrow"
 * as the 4th on one side of it and as the 5th on the other. A drifting `now`
 * therefore shows up as a clean 24-HOUR disagreement rather than as a few
 * milliseconds, and the consequence is concrete: the contact is phoned, or met,
 * a full day after the time the trail says was agreed.
 *
 * The clock is REBASED immediately before each turn, because opening a database,
 * seeding a world and starting a conversation each consume reads - so where the
 * pinned instant lands relative to midnight cannot be stated up front.
 *
 * A mid-morning case runs the same assertions far from any boundary, where only
 * the millisecond-scale form of the defect is available to catch.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { buildAgentRuntime, type AgentRuntime } from '../../src/app/composition.js';
import { seedSliceWorld, type SliceWorld } from '../../src/app/seedSliceWorld.js';
import type { AuditEvent } from '../../src/audit/types.js';
import { parseValidationProvenance } from '../../src/domain/provenance.js';
import { ScriptedLlmProvider, scriptedArgs, type ScriptedStep } from '../../src/llm/scriptedLlmProvider.js';
import { createProviderRegistry } from '../../src/providers/index.js';
import { deriveIdempotencyKey } from '../../src/shared/ids.js';
import { AdvancingClock } from '../helpers/advancingClock.js';
import { createTestDatabase, type TestDatabase } from '../helpers/testDb.js';

/** 2026-03-03T23:59:59.900 America/New_York - 100ms before local midnight. */
const PINNED_JUST_BEFORE_LOCAL_MIDNIGHT = '2026-03-04T04:59:59.900Z';

/** Wednesday 2026-03-04, 10:00 America/New_York. Nowhere near a boundary. */
const PINNED_MID_MORNING = '2026-03-04T15:00:00.000Z';

interface PinnedNowHarness {
  readonly runtime: AgentRuntime;
  readonly world: SliceWorld;
  readonly clock: AdvancingClock;
  readonly llm: ScriptedLlmProvider;
  readonly conversationId: string;
}

const openDatabases: TestDatabase[] = [];

/**
 * A runtime wired to an ADVANCING clock, with a conversation already started.
 *
 * Deliberately not `createSliceHarness`: that helper hands the runtime the test
 * database's `FixedClock`, which is the one thing this file must not use.
 */
async function createPinnedNowHarness(label: string): Promise<PinnedNowHarness> {
  const testDb = await createTestDatabase({ label, nowUtc: PINNED_MID_MORNING });
  openDatabases.push(testDb);

  const clock = new AdvancingClock(PINNED_MID_MORNING, { stepMillis: 50 });
  const llm = new ScriptedLlmProvider();
  const runtime = buildAgentRuntime({ clock, db: testDb.db, providers: createProviderRegistry({}), llm });

  const world = await seedSliceWorld(testDb.db);
  const conversation = await runtime.conversations.start({
    organizationId: world.organization.id,
    contactId: world.contact.id,
    aiAgentId: world.aiAgent.id,
    agentConfigurationId: world.agentConfiguration.id,
    channel: 'VOICE',
  });

  return { runtime, world, clock, llm, conversationId: conversation.id };
}

afterEach(async () => {
  while (openDatabases.length > 0) {
    await openDatabases.pop()?.cleanup();
  }
});

/** Run one turn whose pinned `now` is exactly `pinnedNowUtc`. */
async function runTurnPinnedAt(
  harness: PinnedNowHarness,
  pinnedNowUtc: string,
  utterance: string,
  toolName: string,
  args: Record<string, unknown>,
) {
  const script: ScriptedStep[] = [
    {
      assistantText: 'Let me get that in the diary.',
      toolCalls: [{ toolCallId: `call_${toolName}`, toolName, argumentsJson: scriptedArgs(args) }],
    },
    { assistantText: "You're all set." },
  ];
  harness.llm.setScript(script);
  harness.clock.rebase(pinnedNowUtc);

  const turn = await harness.runtime.agent.handleTurn({ conversationId: harness.conversationId, utterance });
  expect(turn.toolOutcomes[0]?.ok, JSON.stringify(turn.toolOutcomes[0])).toBe(true);

  const chain = await harness.runtime.db.audit.listByCorrelationId(turn.correlationId);
  const validated = validatedSlotFrom(chain);
  // The rebase did what it claimed: this turn really was pinned where we said.
  expect(validated.nowUtc).toBe(pinnedNowUtc);
  return { turn, chain, validated };
}

/**
 * The slot the chokepoint says it validated, read back out of the audit row.
 *
 * The FIRST `TOOL_CALL_VALIDATED` on the chain is the dispatcher's - the
 * chokepoint. `MeetingSchedulingService` records a second one of its own inside
 * the persisting transaction, and that is the one under suspicion here, so it
 * must not be what the expectation is built from.
 */
function validatedSlotFrom(chain: readonly AuditEvent[]): { startUtc: string; nowUtc: string } {
  const event = chain.find((candidate) => candidate.type === 'TOOL_CALL_VALIDATED');
  expect(event, `no TOOL_CALL_VALIDATED in chain: ${chain.map((e) => e.type).join(' -> ')}`).toBeDefined();
  const detail = JSON.parse(event!.detailJson) as { slot?: { startUtc: string }; provenance?: { nowUtc: string } };
  expect(detail.slot, 'TOOL_CALL_VALIDATED carried no slot').toBeDefined();
  expect(detail.provenance, 'TOOL_CALL_VALIDATED carried no provenance').toBeDefined();
  return { startUtc: detail.slot!.startUtc, nowUtc: detail.provenance!.nowUtc };
}

describe('the instant that is validated is the instant that is persisted', () => {
  it('schedule_followup: the FutureAction row matches the chokepoint, across local midnight', async () => {
    const harness = await createPinnedNowHarness('pinned-now-followup');

    const { validated } = await runTurnPinnedAt(
      harness,
      PINNED_JUST_BEFORE_LOCAL_MIDNIGHT,
      'Call me tomorrow afternoon at 3.',
      'schedule_followup',
      {
        contact_id: harness.world.contact.id,
        when: 'tomorrow afternoon at 3',
        reason: 'Contact asked to be called back.',
      },
    );

    // 23:59:59.9 on the 3rd locally, so "tomorrow" is the 4th - NOT the 5th.
    expect(validated.startUtc).toBe('2026-03-04T20:00:00.000Z');

    const actions = await harness.runtime.db.futureActions.listByContact(harness.world.contact.id);
    expect(actions).toHaveLength(1);
    const action = actions[0]!;

    // THE ASSERTION. The audit trail and the row name the same instant.
    expect(action.scheduledForUtc).toBe(validated.startUtc);
    // And the same `now` explains both of them.
    expect(parseValidationProvenance(action.validationProvenanceJson).nowUtc).toBe(validated.nowUtc);

    // The idempotency key is derived in the handler from the CHOKEPOINT slot, so
    // it only identifies the promise if the row landed on that same instant.
    expect(action.idempotencyKey).toBe(
      deriveIdempotencyKey('future-action', {
        conversationId: harness.conversationId,
        contactId: harness.world.contact.id,
        scheduledForUtc: validated.startUtc,
      }),
    );
  });

  it('schedule_meeting: the Meeting row matches the chokepoint, across local midnight', async () => {
    const harness = await createPinnedNowHarness('pinned-now-meeting');

    const { validated } = await runTurnPinnedAt(
      harness,
      PINNED_JUST_BEFORE_LOCAL_MIDNIGHT,
      'Book me in tomorrow afternoon at 3.',
      'schedule_meeting',
      { contact_id: harness.world.contact.id, when: 'tomorrow afternoon at 3', title: 'Pricing walkthrough' },
    );

    expect(validated.startUtc).toBe('2026-03-04T20:00:00.000Z');

    const meetings = await harness.runtime.db.meetings.listByContact(harness.world.contact.id);
    expect(meetings).toHaveLength(1);
    const meeting = meetings[0]!;

    expect(meeting.startUtc).toBe(validated.startUtc);
    expect(parseValidationProvenance(meeting.validationProvenanceJson).nowUtc).toBe(validated.nowUtc);
    expect(meeting.idempotencyKey).toBe(
      deriveIdempotencyKey('meeting', {
        conversationId: harness.conversationId,
        contactId: harness.world.contact.id,
        startUtc: validated.startUtc,
      }),
    );
  });

  it('reschedule_meeting: the moved Meeting matches the chokepoint, across local midnight', async () => {
    const harness = await createPinnedNowHarness('pinned-now-reschedule');

    await runTurnPinnedAt(harness, PINNED_MID_MORNING, 'Book me in tomorrow afternoon at 3.', 'schedule_meeting', {
      contact_id: harness.world.contact.id,
      when: 'tomorrow afternoon at 3',
      title: 'Pricing walkthrough',
    });
    const meetingId = (await harness.runtime.db.meetings.listByContact(harness.world.contact.id))[0]!.id;

    // The clock goes back to just before the contact's local midnight for the
    // second turn: a reschedule is a fresh resolution and must be pinned too.
    const { validated } = await runTurnPinnedAt(
      harness,
      PINNED_JUST_BEFORE_LOCAL_MIDNIGHT,
      'Actually, make it tomorrow at 11.',
      'reschedule_meeting',
      { meeting_id: meetingId, when: 'tomorrow at 11am', reason: 'Contact asked to move it earlier.' },
    );

    expect(validated.startUtc).toBe('2026-03-04T16:00:00.000Z');

    const meeting = await harness.runtime.db.meetings.requireById(meetingId);
    expect(meeting.startUtc).toBe(validated.startUtc);
    expect(parseValidationProvenance(meeting.validationProvenanceJson).nowUtc).toBe(validated.nowUtc);
  });

  it('mid-morning, far from any boundary, the two instants still agree', async () => {
    const harness = await createPinnedNowHarness('pinned-now-mid-morning');

    const { validated } = await runTurnPinnedAt(
      harness,
      PINNED_MID_MORNING,
      'Call me tomorrow afternoon at 3.',
      'schedule_followup',
      {
        contact_id: harness.world.contact.id,
        when: 'tomorrow afternoon at 3',
        reason: 'Contact asked to be called back.',
      },
    );

    const action = (await harness.runtime.db.futureActions.listByContact(harness.world.contact.id))[0]!;
    expect(action.scheduledForUtc).toBe(validated.startUtc);
    expect(action.scheduledForUtc).toBe('2026-03-05T20:00:00.000Z');
    expect(parseValidationProvenance(action.validationProvenanceJson).nowUtc).toBe(PINNED_MID_MORNING);
  });

  it('the clock really does move, so these tests are capable of failing', () => {
    const clock = new AdvancingClock(PINNED_MID_MORNING, { stepMillis: 50 });
    const first = clock.nowUtc();
    const second = clock.nowUtc();
    expect(first).not.toBe(second);
    expect(Date.parse(second) - Date.parse(first)).toBe(50);

    clock.rebase(PINNED_JUST_BEFORE_LOCAL_MIDNIGHT);
    expect(clock.nowUtc()).toBe(PINNED_JUST_BEFORE_LOCAL_MIDNIGHT);
  });
});
