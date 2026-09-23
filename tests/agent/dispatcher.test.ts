/**
 * `ToolDispatcher`, tested directly rather than through an agent turn.
 *
 * The end-to-end suite proves the chokepoint holds in the real flow. This file
 * proves the ORDER of its steps, which is a contract in its own right: cheap
 * structural checks before expensive ones, so a malformed call never costs a
 * database round trip it did not need and never costs a provider call at all.
 *
 * The strongest assertion here is the last one: a dispatcher wired to a
 * validator and an availability provider that would THROW if consulted still
 * refuses a malformed call cleanly - which is only possible if the rejection
 * genuinely happened before either was touched.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolDispatcher } from '../../src/agent/tools/dispatcher.js';
import type { ToolDispatchContext } from '../../src/agent/tools/context.js';
import { parseAllowedTools } from '../../src/agent/agentTurnService.js';
import { buildAgentRuntime } from '../../src/app/composition.js';
import { seedSliceWorld, type SliceWorld } from '../../src/app/seedSliceWorld.js';
import type { Conversation } from '../../src/domain/entities.js';
import type { AvailabilityProvider, GetBusyIntervalsRequest } from '../../src/ports/availability.js';
import { schedulingPolicyFromAgentConfiguration } from '../../src/scheduling/policy.js';
import { createProviderRegistry } from '../../src/providers/index.js';
import { createTestDatabase, type TestDatabase } from '../helpers/testDb.js';
import { SLICE_NOW_UTC } from '../e2e/support.js';

/** An availability provider that fails the test if it is ever consulted. */
class ExplodingAvailabilityProvider implements AvailabilityProvider {
  consulted = 0;

  name(): string {
    return 'exploding-test';
  }

  async getBusyIntervals(_request: GetBusyIntervalsRequest): Promise<never> {
    this.consulted += 1;
    throw new Error('the availability provider must not be reached for an invalid tool call');
  }
}

describe('ToolDispatcher', () => {
  let testDb: TestDatabase;
  let world: SliceWorld;
  let conversation: Conversation;
  let dispatcher: ToolDispatcher;
  let ctx: ToolDispatchContext;

  beforeEach(async () => {
    testDb = await createTestDatabase({ label: 'agent-dispatcher' });
    const runtime = buildAgentRuntime({
      clock: testDb.clock,
      db: testDb.db,
      providers: createProviderRegistry({}),
    });
    world = await seedSliceWorld(testDb.db);
    conversation = await runtime.conversations.start({
      organizationId: world.organization.id,
      contactId: world.contact.id,
      aiAgentId: world.aiAgent.id,
      agentConfigurationId: world.agentConfiguration.id,
    });

    dispatcher = runtime.dispatcher;
    ctx = {
      correlationId: 'corr_dispatcher_test',
      organizationId: world.organization.id,
      conversationId: conversation.id,
      contact: world.contact,
      agentConfiguration: world.agentConfiguration,
      policy: schedulingPolicyFromAgentConfiguration(world.agentConfiguration),
      allowedToolNames: parseAllowedTools(world.agentConfiguration),
      nowUtc: SLICE_NOW_UTC,
    };
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  const chain = async () => (await testDb.db.audit.listByCorrelationId(ctx.correlationId)).map((e) => e.type);

  it('records the raw arguments BEFORE deciding anything about them', async () => {
    const outcome = await dispatcher.dispatch(
      { toolCallId: 'c1', toolName: 'schedule_followup', argumentsJson: 'not json at all' },
      ctx,
    );

    expect(outcome.ok).toBe(false);

    const events = await testDb.db.audit.listByCorrelationId(ctx.correlationId);
    // TOOL_CALL_REQUESTED is first, and it carries the gibberish verbatim. An
    // auditor sees what the model actually emitted, not a cleaned-up version.
    expect(events[0]?.type).toBe('TOOL_CALL_REQUESTED');
    expect(events[0]?.detailJson).toContain('not json at all');
    expect(events[1]?.type).toBe('TOOL_CALL_REJECTED');
  });

  it('rejects an unknown tool name before it parses anything', async () => {
    const outcome = await dispatcher.dispatch(
      { toolCallId: 'c1', toolName: 'charge_the_card', argumentsJson: 'also not json' },
      ctx,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // UNSUPPORTED_TOOL, not SCHEMA_VIOLATION: the name is checked first, so the
    // model is told the real problem rather than a downstream symptom.
    expect(outcome.code).toBe('UNSUPPORTED_TOOL');
    expect(outcome.retryable).toBe(false);
    expect(outcome.data?.['available_tools']).toEqual(ctx.allowedToolNames);
  });

  it('rejects malformed JSON before it checks policy', async () => {
    const restricted = { ...ctx, allowedToolNames: ['get_contact_context'] };
    const outcome = await dispatcher.dispatch(
      { toolCallId: 'c1', toolName: 'schedule_followup', argumentsJson: '{oops' },
      restricted,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // schedule_followup is ALSO not permitted here, but the arguments are
    // checked first, so that is the code that comes back.
    expect(outcome.code).toBe('SCHEMA_VIOLATION');
  });

  it('rejects a disallowed tool before it resolves any subject', async () => {
    const restricted = { ...ctx, allowedToolNames: ['get_contact_context'] };
    const outcome = await dispatcher.dispatch(
      {
        toolCallId: 'c1',
        toolName: 'schedule_followup',
        // Well-formed, and naming a contact that does not exist. Policy is
        // checked first, so POLICY_VIOLATION wins over UNKNOWN_CONTACT.
        argumentsJson: JSON.stringify({ contact_id: 'nope', when: 'tomorrow at 3pm' }),
      },
      restricted,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('POLICY_VIOLATION');
    expect(outcome.reason).toContain('not enabled for this conversation');
  });

  it('rejects a fabricated contact id before it validates any datetime', async () => {
    const outcome = await dispatcher.dispatch(
      {
        toolCallId: 'c1',
        toolName: 'schedule_followup',
        // The time is ALSO invalid (no am/pm). Subject resolution runs first,
        // so the answer names the fabricated id, which is the real problem.
        argumentsJson: JSON.stringify({ contact_id: 'contact_invented', when: 'tomorrow at 3' }),
      },
      ctx,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('UNKNOWN_CONTACT');
    expect(outcome.data?.['expected_contact_id']).toBe(world.contact.id);
  });

  it('never reaches the availability provider for an invalid call', async () => {
    const availability = new ExplodingAvailabilityProvider();
    // A whole runtime wired to a provider that throws if it is ever consulted.
    // Everything else is the real thing, so the only reason these calls can
    // fail cleanly is that they were refused before the provider was needed.
    const guarded = buildAgentRuntime({
      clock: testDb.clock,
      db: testDb.db,
      providers: { ...createProviderRegistry({}), availability },
    }).dispatcher;

    for (const argumentsJson of [
      'not json',
      JSON.stringify({ contact_id: world.contact.id }),
      JSON.stringify({ contact_id: 'invented', when: 'tomorrow at 3pm' }),
      JSON.stringify({ contact_id: world.contact.id, when: 'tomorrow at 3pm', invented: true }),
    ]) {
      const outcome = await guarded.dispatch(
        { toolCallId: 'c1', toolName: 'schedule_meeting', argumentsJson },
        ctx,
      );
      expect(outcome.ok, `unexpectedly accepted: ${argumentsJson}`).toBe(false);
    }

    // The proof that the ordering is real rather than incidental.
    expect(availability.consulted).toBe(0);
  });

  it('emits TOOL_CALL_VALIDATED then TOOL_CALL_EXECUTED on the happy path', async () => {
    const outcome = await dispatcher.dispatch(
      {
        toolCallId: 'c1',
        toolName: 'schedule_followup',
        argumentsJson: JSON.stringify({
          contact_id: world.contact.id,
          when: 'tomorrow afternoon at 3',
          reason: 'callback',
        }),
      },
      ctx,
    );

    expect(outcome.ok).toBe(true);
    expect(await chain()).toEqual([
      'TOOL_CALL_REQUESTED',
      'TOOL_CALL_VALIDATED',
      'ENTITY_PERSISTED',
      'FUTURE_ACTION_SCHEDULED',
      'TOOL_CALL_EXECUTED',
    ]);
  });

  it('writes no domain row when it refuses', async () => {
    const before = await testDb.db.prisma.futureAction.count();

    await dispatcher.dispatch(
      {
        toolCallId: 'c1',
        toolName: 'schedule_followup',
        argumentsJson: JSON.stringify({ contact_id: world.contact.id, when: 'tomorrow at 3' }),
      },
      ctx,
    );

    expect(await testDb.db.prisma.futureAction.count()).toBe(before);
    const events = await testDb.db.audit.listByCorrelationId(ctx.correlationId);
    const rejection = events.find((event) => event.type === 'TOOL_CALL_REJECTED');
    // The event states the fact rather than leaving a reader to infer it.
    expect(rejection?.detailJson).toContain('"domainRowsWritten":0');
  });

  it('uses the contact’s persisted timezone unless the model overrides it', async () => {
    const withoutOverride = await dispatcher.dispatch(
      {
        toolCallId: 'c1',
        toolName: 'check_availability',
        argumentsJson: JSON.stringify({ contact_id: world.contact.id, when: 'tomorrow at 10am' }),
      },
      ctx,
    );
    expect(withoutOverride.ok).toBe(true);
    if (withoutOverride.ok) expect(withoutOverride.data['timezone']).toBe('America/New_York');

    const withOverride = await dispatcher.dispatch(
      {
        toolCallId: 'c2',
        toolName: 'check_availability',
        argumentsJson: JSON.stringify({
          contact_id: world.contact.id,
          when: 'tomorrow at 10am',
          timezone: 'America/Denver',
        }),
      },
      ctx,
    );
    expect(withOverride.ok).toBe(true);
    if (withOverride.ok) {
      expect(withOverride.data['timezone']).toBe('America/Denver');
      // Same wall-clock time, a different instant. The override is real.
      expect(withOverride.data['start_local']).toBe('2026-03-05T10:00');
    }
  });

  it('runs transfer_to_human into a real Task and a HUMAN_TRANSFER_REQUESTED event', async () => {
    const outcome = await dispatcher.dispatch(
      {
        toolCallId: 'c1',
        toolName: 'transfer_to_human',
        argumentsJson: JSON.stringify({
          contact_id: world.contact.id,
          reason: 'They asked to speak to someone about their contract.',
          urgency: 'URGENT',
        }),
      },
      ctx,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const tasks = await testDb.db.tasks.listByContact(world.contact.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe('OPEN');
    expect(tasks[0]?.title).toContain('URGENT');
    expect(tasks[0]?.dueAtUtc).toBe(SLICE_NOW_UTC);

    expect(await chain()).toContain('HUMAN_TRANSFER_REQUESTED');
    // The model is told not to name a person or a time it was never given.
    expect(String(outcome.data['promised_to_contact'])).toContain('Do not name a person');
  });

  it('records a call outcome without inventing a telephony provider', async () => {
    const outcome = await dispatcher.dispatch(
      {
        toolCallId: 'c1',
        toolName: 'record_call_outcome',
        argumentsJson: JSON.stringify({
          contact_id: world.contact.id,
          outcome: 'VOICEMAIL',
          notes: 'Left a message asking them to call back.',
        }),
      },
      ctx,
    );

    expect(outcome.ok).toBe(true);
    const calls = await testDb.db.calls.listByContact(world.contact.id);
    expect(calls).toHaveLength(1);
    // No provider placed this call, and the row says so rather than naming one.
    expect(calls[0]?.providerName).toBe('conversation');
    expect(calls[0]?.status).toBe('COMPLETED');
    expect((await testDb.db.callOutcomes.requireByCallId(calls[0]!.id)).outcome).toBe('VOICEMAIL');
  });

  it('refuses to attach an outcome to another contact’s call', async () => {
    const other = await seedSliceWorld(testDb.db, { suffix: 'other', contactPhoneE164: '+12125550188' });
    const theirCall = await testDb.db.calls.create({
      organizationId: other.organization.id,
      contactId: other.contact.id,
      direction: 'OUTBOUND',
      providerName: 'deterministic-test',
      status: 'COMPLETED',
    });

    const outcome = await dispatcher.dispatch(
      {
        toolCallId: 'c1',
        toolName: 'record_call_outcome',
        argumentsJson: JSON.stringify({
          contact_id: world.contact.id,
          outcome: 'CONNECTED',
          call_id: theirCall.id,
        }),
      },
      ctx,
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('POLICY_VIOLATION');
    expect(await testDb.db.prisma.callOutcome.count()).toBe(0);
  });
});
