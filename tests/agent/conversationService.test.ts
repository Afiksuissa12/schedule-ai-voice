/**
 * `ConversationService`, and the claim the whole rebuild rests on:
 *
 *   BUSINESS-CRITICAL STATE DOES NOT LIVE IN AN LLM CONTEXT WINDOW.
 *
 * The legacy prototype held its conversation in a browser tab. Close the tab
 * and it was gone - one call, no memory, no resume, no audit. The test that
 * matters most in this file discards every in-memory object AND the Prisma
 * client, rebuilds both from the same database file, and shows the conversation
 * continuing correctly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConversationService, messagesFromTurns } from '../../src/conversation/conversationService.js';
import { buildAgentRuntime } from '../../src/app/composition.js';
import { seedSliceWorld } from '../../src/app/seedSliceWorld.js';
import { createDatabase } from '../../src/db/database.js';
import type { ConversationTurn } from '../../src/domain/entities.js';
import { ScriptedLlmProvider, scriptedArgs } from '../../src/llm/scriptedLlmProvider.js';
import { FixedClock } from '../../src/ports/clock.js';
import { createProviderRegistry } from '../../src/providers/index.js';
import { InvariantViolationError } from '../../src/shared/errors.js';
import { createTestDatabase, type TestDatabase } from '../helpers/testDb.js';
import { SLICE_NOW_UTC } from '../e2e/support.js';

function turn(overrides: Partial<ConversationTurn> & Pick<ConversationTurn, 'role' | 'index'>): ConversationTurn {
  return {
    id: `turn_${overrides.index}`,
    conversationId: 'conv_1',
    text: null,
    toolName: null,
    toolCallId: null,
    rawPayloadJson: null,
    createdAt: SLICE_NOW_UTC,
    ...overrides,
  };
}

describe('messagesFromTurns (pure)', () => {
  it('maps each turn role to the right message role', () => {
    const messages = messagesFromTurns([
      turn({ index: 0, role: 'CONTACT', text: 'Call me tomorrow.' }),
      turn({ index: 1, role: 'AGENT', text: 'Of course.' }),
      turn({
        index: 2,
        role: 'AGENT',
        toolName: 'schedule_followup',
        toolCallId: 'call_1',
        rawPayloadJson: '{"when":"tomorrow at 3pm"}',
      }),
      turn({
        index: 3,
        role: 'TOOL',
        toolName: 'schedule_followup',
        toolCallId: 'call_1',
        rawPayloadJson: '{"ok":true}',
      }),
      turn({ index: 4, role: 'SYSTEM', text: 'Turn ended.' }),
    ]);

    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant', 'tool', 'system']);
    // The assistant tool-call message replays the model's OWN arguments back to
    // it, which is the truthful reconstruction.
    expect(messages[2]?.content).toBe('{"when":"tomorrow at 3pm"}');
    expect(messages[2]?.toolCallId).toBe('call_1');
    expect(messages[2]?.toolName).toBe('schedule_followup');
    expect(messages[3]?.toolCallId).toBe('call_1');
  });

  it('repairs a tool call whose result was never written', () => {
    // A process that died between "persist the call" and "persist the result"
    // leaves a dangling call. Sending it as-is is illegal for a provider, and
    // dropping it would leave the model believing an action it never got an
    // answer for. So it is answered honestly instead.
    const messages = messagesFromTurns([
      turn({ index: 0, role: 'CONTACT', text: 'Book it.' }),
      turn({
        index: 1,
        role: 'AGENT',
        toolName: 'schedule_meeting',
        toolCallId: 'call_orphan',
        rawPayloadJson: '{"when":"tomorrow at 3pm"}',
      }),
    ]);

    expect(messages).toHaveLength(3);
    expect(messages[2]?.role).toBe('tool');
    expect(messages[2]?.toolCallId).toBe('call_orphan');
    expect(messages[2]?.content).toContain('NO_RECORDED_RESULT');
    expect(messages[2]?.content).toContain('Nothing was saved');
  });

  it('refuses a tool result that cannot be matched to its call', () => {
    expect(() =>
      messagesFromTurns([turn({ index: 0, role: 'TOOL', rawPayloadJson: '{"ok":true}' })]),
    ).toThrow(InvariantViolationError);
  });

  it('prepends leading messages and can window the transcript', () => {
    const turns = Array.from({ length: 6 }, (_, index) =>
      turn({ index, role: 'CONTACT', text: `message ${index}` }),
    );

    const windowed = messagesFromTurns(turns, {
      maxTurns: 2,
      leadingMessages: [{ role: 'system', content: 'context' }],
    });

    expect(windowed.map((message) => message.content)).toEqual(['context', 'message 4', 'message 5']);
  });
});

describe('ConversationService against a database', () => {
  let testDb: TestDatabase;
  let service: ConversationService;

  beforeEach(async () => {
    testDb = await createTestDatabase({ label: 'agent-conversation' });
    service = new ConversationService({ db: testDb.db, clock: testDb.clock });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it('appends every kind of turn durably, in order', async () => {
    const world = await seedSliceWorld(testDb.db);
    const conversation = await service.start({
      organizationId: world.organization.id,
      contactId: world.contact.id,
      aiAgentId: world.aiAgent.id,
      agentConfigurationId: world.agentConfiguration.id,
    });

    await service.appendContactUtterance(conversation.id, 'Call me back tomorrow.');
    await service.appendAgentText(conversation.id, 'Of course.');
    await service.appendToolCall(conversation.id, {
      toolCallId: 'call_1',
      toolName: 'schedule_followup',
      argumentsJson: '{"when":"tomorrow at 3pm"}',
    });
    await service.appendToolResult(conversation.id, {
      toolCallId: 'call_1',
      toolName: 'schedule_followup',
      payload: { ok: true },
    });
    await service.appendSystemNote(conversation.id, 'Turn complete.');

    const loaded = await service.load(conversation.id);
    expect(loaded.turns.map((t) => t.role)).toEqual(['CONTACT', 'AGENT', 'AGENT', 'TOOL', 'SYSTEM']);
    // Ordering is a database invariant, not an array position.
    expect(loaded.turns.map((t) => t.index)).toEqual([0, 1, 2, 3, 4]);
    expect(await service.turnCount(conversation.id)).toBe(5);
  });

  it('holds NO conversation state between calls', async () => {
    const world = await seedSliceWorld(testDb.db);
    const conversation = await service.start({
      organizationId: world.organization.id,
      contactId: world.contact.id,
      aiAgentId: world.aiAgent.id,
      agentConfigurationId: world.agentConfiguration.id,
    });

    await service.appendContactUtterance(conversation.id, 'first');

    // A SECOND service instance, sharing nothing with the first, sees the same
    // transcript - because there is nothing to share. If this class cached
    // anything, this assertion would be the one to fail.
    const other = new ConversationService({ db: testDb.db, clock: testDb.clock });
    await other.appendAgentText(conversation.id, 'second');

    expect((await service.buildMessages(conversation.id)).map((m) => m.content)).toEqual(['first', 'second']);
    expect((await other.buildMessages(conversation.id)).map((m) => m.content)).toEqual(['first', 'second']);
  });

  it('finds an open conversation rather than starting a second one', async () => {
    const world = await seedSliceWorld(testDb.db);
    const input = {
      organizationId: world.organization.id,
      contactId: world.contact.id,
      aiAgentId: world.aiAgent.id,
      agentConfigurationId: world.agentConfiguration.id,
    };

    const first = await service.startOrResume(input);
    const second = await service.startOrResume(input);
    expect(second.id).toBe(first.id);

    await service.complete(first.id, 'Callback arranged.');
    const third = await service.startOrResume(input);
    expect(third.id).not.toBe(first.id);
  });
});

describe('a conversation resumes after everything in memory is destroyed', () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ label: 'agent-conversation-restart' });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it('continues correctly from a rebuilt Prisma client and a rebuilt runtime', async () => {
    // ---- PROCESS ONE -------------------------------------------------------
    const worldIds = await (async () => {
      const clock = new FixedClock(SLICE_NOW_UTC);
      const llm = new ScriptedLlmProvider();
      const runtime = buildAgentRuntime({
        clock,
        db: testDb.db,
        providers: createProviderRegistry({}),
        llm,
      });

      const world = await seedSliceWorld(testDb.db);
      const conversation = await runtime.conversations.start({
        organizationId: world.organization.id,
        contactId: world.contact.id,
        aiAgentId: world.aiAgent.id,
        agentConfigurationId: world.agentConfiguration.id,
      });

      llm.setScript([
        {
          assistantText: 'Understood - what time suits you?',
        },
      ]);
      await runtime.agent.handleTurn({
        conversationId: conversation.id,
        utterance: 'I would like someone to call me back.',
      });

      return { conversationId: conversation.id, contactId: world.contact.id };
    })();

    // ---- EVERYTHING FROM PROCESS ONE IS NOW UNREACHABLE --------------------
    // Disconnect the client that wrote all of the above. Nothing from the first
    // "process" survives into the second except the file on disk.
    await testDb.db.disconnect();

    // ---- PROCESS TWO -------------------------------------------------------
    const restartedDb = createDatabase({
      datasourceUrl: testDb.databaseUrl,
      clock: new FixedClock(SLICE_NOW_UTC),
      log: ['warn'],
    });

    try {
      const clock = new FixedClock(SLICE_NOW_UTC);
      const llm = new ScriptedLlmProvider();
      const runtime = buildAgentRuntime({
        clock,
        db: restartedDb,
        providers: createProviderRegistry({}),
        llm,
      });

      // The new process rebuilds the transcript from the database alone.
      const messages = await runtime.conversations.buildMessages(worldIds.conversationId);
      expect(messages.map((message) => message.content)).toEqual([
        'I would like someone to call me back.',
        'Understood - what time suits you?',
      ]);

      // And the conversation genuinely CONTINUES: the model, given the rebuilt
      // history, schedules the callback the first process was asking about.
      //
      // MISSION 2D changed this one line of script. It used to read "Perfect, I
      // will ring you then." - a promise of a callback made in the same
      // completion as the tool call that would create it, so the claim gate
      // correctly regenerated it and this test quietly stopped exercising the
      // script it was written to exercise. The subject here is restart
      // continuity, not claim consistency, so the wording is now honest for the
      // moment it is said and the flow is the one the test describes.
      llm.setScript([
        {
          assistantText: 'Perfect - let me get that arranged.',
          toolCalls: [
            {
              toolCallId: 'call_after_restart',
              toolName: 'schedule_followup',
              argumentsJson: scriptedArgs({
                contact_id: worldIds.contactId,
                when: 'tomorrow afternoon at 3',
                reason: 'Contact asked for a callback before the restart.',
              }),
            },
          ],
        },
        { assistantText: 'Speak to you then.' },
      ]);

      const resumed = await runtime.agent.handleTurn({
        conversationId: worldIds.conversationId,
        utterance: 'Tomorrow afternoon at 3 please.',
      });

      expect(resumed.toolOutcomes[0]?.ok).toBe(true);

      // The model was handed the WHOLE conversation, including the turn taken
      // by a process that no longer exists.
      const sent = llm.completions[0]?.request.messages ?? [];
      expect(sent.map((message) => message.content)).toContain('I would like someone to call me back.');
      expect(sent.map((message) => message.content)).toContain('Understood - what time suits you?');
      expect(sent.map((message) => message.content)).toContain('Tomorrow afternoon at 3 please.');

      const actions = await restartedDb.futureActions.listByContact(worldIds.contactId);
      expect(actions).toHaveLength(1);
      expect(actions[0]?.scheduledForUtc).toBe('2026-03-05T20:00:00.000Z');

      // The full transcript spans both processes.
      const rebuilt = await restartedDb.conversations.requireByIdWithTurns(worldIds.conversationId);
      expect(rebuilt.turns.length).toBeGreaterThanOrEqual(6);
      expect(rebuilt.turns[0]?.text).toBe('I would like someone to call me back.');
    } finally {
      await restartedDb.disconnect();
    }
  });
});
