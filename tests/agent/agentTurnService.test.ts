/**
 * `AgentTurnService`: orchestration, and the things it must refuse to do.
 *
 * The end-to-end suite proves the happy path. This file covers the seams:
 * where the turn gets its context (the database, never memory), how it threads
 * one correlation id, what it records about the model's intent BEFORE any of it
 * is allowed, and what happens when the configuration it was handed is wrong.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseAllowedTools } from '../../src/agent/agentTurnService.js';
import { buildAgentRuntime, type AgentRuntime } from '../../src/app/composition.js';
import { seedSliceWorld, type SliceWorld } from '../../src/app/seedSliceWorld.js';
import { scriptedArgs } from '../../src/llm/scriptedLlmProvider.js';
import { ScriptedLlmProvider } from '../../src/llm/scriptedLlmProvider.js';
import { createProviderRegistry } from '../../src/providers/index.js';
import { stringifyJson } from '../../src/shared/json.js';
import { ConfigurationError, NotFoundError } from '../../src/shared/errors.js';
import { createTestDatabase, type TestDatabase } from '../helpers/testDb.js';
import { SLICE_NOW_UTC } from '../e2e/support.js';

describe('AgentTurnService', () => {
  let testDb: TestDatabase;
  let runtime: AgentRuntime;
  let llm: ScriptedLlmProvider;
  let world: SliceWorld;

  beforeEach(async () => {
    testDb = await createTestDatabase({ label: 'agent-turn-service' });
    llm = new ScriptedLlmProvider();
    runtime = buildAgentRuntime({
      clock: testDb.clock,
      db: testDb.db,
      providers: createProviderRegistry({}),
      llm,
    });
    world = await seedSliceWorld(testDb.db);
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  const startConversation = () =>
    runtime.conversations.start({
      organizationId: world.organization.id,
      contactId: world.contact.id,
      aiAgentId: world.aiAgent.id,
      agentConfigurationId: world.agentConfiguration.id,
    });

  it('threads one correlation id through every event of the turn', async () => {
    const conversation = await startConversation();
    llm.setScript([
      {
        assistantText: 'Let me check.',
        toolCalls: [
          {
            toolCallId: 'c1',
            toolName: 'get_contact_context',
            argumentsJson: scriptedArgs({ contact_id: world.contact.id }),
          },
        ],
      },
      { assistantText: 'Here is what I have.' },
    ]);

    const turn = await runtime.agent.handleTurn({ conversationId: conversation.id, utterance: 'Who am I to you?' });

    expect(turn.correlationId).toMatch(/^corr_/);
    const chain = await testDb.db.audit.listByCorrelationId(turn.correlationId);
    expect(chain.length).toBeGreaterThan(4);
    expect(new Set(chain.map((event) => event.correlationId)).size).toBe(1);

    // Two turns get two chains. A correlation id is per TURN, not per
    // conversation, or an auditor could not tell one decision from the next.
    llm.setScript([{ assistantText: 'Anything else?' }]);
    const second = await runtime.agent.handleTurn({ conversationId: conversation.id, utterance: 'Thanks.' });
    expect(second.correlationId).not.toBe(turn.correlationId);
    expect(await testDb.db.audit.listByCorrelationId(second.correlationId)).not.toHaveLength(0);
  });

  it('records the model’s intent before anything is validated', async () => {
    const conversation = await startConversation();
    llm.setScript([
      {
        assistantText: 'On it.',
        toolCalls: [
          {
            toolCallId: 'c1',
            toolName: 'schedule_followup',
            argumentsJson: scriptedArgs({ contact_id: 'invented', when: 'tomorrow at 3' }),
          },
        ],
      },
      { assistantText: 'Sorry, I could not.' },
    ]);

    const turn = await runtime.agent.handleTurn({ conversationId: conversation.id, utterance: 'Call me sometime.' });
    const chain = await testDb.db.audit.listByCorrelationId(turn.correlationId);

    const decision = chain.find((event) => event.type === 'AGENT_DECISION');
    expect(decision).toBeDefined();
    // The INTENT is on the record even though the call was refused. The gap
    // between what was asked for and what was allowed is the whole story.
    expect(decision?.detailJson).toContain('intendedToolCalls');
    expect(decision?.detailJson).toContain('invented');

    const decisionIndex = chain.findIndex((event) => event.type === 'AGENT_DECISION');
    const rejectedIndex = chain.findIndex((event) => event.type === 'TOOL_CALL_REJECTED');
    expect(decisionIndex).toBeLessThan(rejectedIndex);
  });

  it('records which configuration, prompt and tools the turn ran with', async () => {
    const conversation = await startConversation();
    llm.setScript([{ assistantText: 'Hello.' }]);

    const turn = await runtime.agent.handleTurn({ conversationId: conversation.id, utterance: 'Hi.' });
    const started = (await testDb.db.audit.listByCorrelationId(turn.correlationId)).find(
      (event) => event.type === 'AGENT_TURN_STARTED',
    );

    expect(started).toBeDefined();
    const detail = JSON.parse(started?.detailJson ?? '{}') as Record<string, unknown>;
    expect(detail['agentConfigurationId']).toBe(world.agentConfiguration.id);
    expect(detail['agentConfigurationVersion']).toBe(1);
    expect(detail['systemPromptRef']).toBe('sales-scheduler@v1');
    expect(detail['promptFingerprint']).toBe(turn.promptFingerprint);
    expect(detail['offeredToolNames']).toHaveLength(9);
    expect(detail['nowUtc']).toBe(SLICE_NOW_UTC);

    // Proof of exactly what the turn disclosed about the contact, and no more.
    const disclosed = detail['turnContextDisclosed'] as Record<string, unknown>;
    expect(disclosed['contactTimezone']).toBe('America/New_York');
    expect(JSON.stringify(disclosed)).not.toContain(world.contact.primaryPhoneE164);
  });

  it('records the LLM call itself as a provider invocation', async () => {
    const conversation = await startConversation();
    llm.setScript([{ assistantText: 'Hello.' }]);

    const turn = await runtime.agent.handleTurn({ conversationId: conversation.id, utterance: 'Hi.' });
    const invoked = (await testDb.db.audit.listByCorrelationId(turn.correlationId)).find(
      (event) => event.type === 'PROVIDER_INVOKED',
    );

    expect(invoked?.summary).toContain('scripted-test');
    const detail = JSON.parse(invoked?.detailJson ?? '{}') as Record<string, unknown>;
    // The SHAPE of what the model saw. The contents are already durable as
    // ConversationTurn rows; duplicating a whole transcript into every audit
    // event would help nobody.
    expect(detail['messageCount']).toBeGreaterThan(0);
    expect(detail['offeredTools']).toHaveLength(9);
  });

  it('rebuilds the message array from the database on every iteration', async () => {
    const conversation = await startConversation();
    llm.setScript([
      {
        assistantText: 'Checking.',
        toolCalls: [
          {
            toolCallId: 'c1',
            toolName: 'get_contact_context',
            argumentsJson: scriptedArgs({ contact_id: world.contact.id }),
          },
        ],
      },
      { assistantText: 'Done.' },
    ]);

    await runtime.agent.handleTurn({ conversationId: conversation.id, utterance: 'What do you know?' });

    // Second iteration saw MORE messages than the first, and the extra ones are
    // the rows written in between: the tool call and its result.
    const first = llm.completions[0]?.request.messages ?? [];
    const second = llm.completions[1]?.request.messages ?? [];
    expect(second.length).toBeGreaterThan(first.length);

    const roles = second.map((message) => message.role);
    expect(roles).toContain('tool');
    // The assistant tool-call message carries the id its result answers, so the
    // reconstruction is legal for a provider that requires the pairing.
    const assistantCall = second.find((message) => message.role === 'assistant' && message.toolCallId);
    expect(assistantCall?.toolCallId).toBe('c1');
  });

  it('prepends the turn context as a system message, outside the transcript', async () => {
    const conversation = await startConversation();
    llm.setScript([{ assistantText: 'Hello.' }]);

    await runtime.agent.handleTurn({ conversationId: conversation.id, utterance: 'Hi.' });

    const messages = llm.completions[0]?.request.messages ?? [];
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain(world.contact.id);
    expect(messages[0]?.content).toContain('America/New_York');

    // It is NOT persisted as a ConversationTurn: it is derived per turn from
    // the contact row and the clock, so persisting it would create a second,
    // staleable copy of facts we already have.
    const turns = await testDb.db.conversationTurns.listByConversation(conversation.id);
    expect(turns.some((t) => t.text?.includes('Their contact id is'))).toBe(false);
  });

  it('persists the contact utterance before it calls the model', async () => {
    const conversation = await startConversation();
    llm.setScript([{ assistantText: 'Hello.' }]);

    await runtime.agent.handleTurn({ conversationId: conversation.id, utterance: 'First thing I said.' });

    // The model's first message array already contained the utterance, which is
    // only possible if it was written to the database first.
    const messages = llm.completions[0]?.request.messages ?? [];
    expect(messages.map((message) => message.content)).toContain('First thing I said.');

    const turns = await testDb.db.conversationTurns.listByConversation(conversation.id);
    expect(turns[0]?.role).toBe('CONTACT');
    expect(turns[0]?.text).toBe('First thing I said.');
  });

  it('refuses a conversation with no pinned configuration', async () => {
    // An unpinned conversation cannot be replayed against the policy that was
    // in force, so a turn on it is refused rather than silently given today's.
    const unpinned = await testDb.db.conversations.create({
      organizationId: world.organization.id,
      contactId: world.contact.id,
      aiAgentId: world.aiAgent.id,
      agentConfigurationId: null,
    });

    await expect(
      runtime.agent.handleTurn({ conversationId: unpinned.id, utterance: 'Hello?' }),
    ).rejects.toThrow(ConfigurationError);
  });

  it('refuses a conversation that does not exist', async () => {
    await expect(
      runtime.agent.handleTurn({ conversationId: 'conversation_that_never_was', utterance: 'Hello?' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('refuses a configuration whose prompt ref is unknown', async () => {
    const agent = await testDb.db.aiAgents.create({ organizationId: world.organization.id, name: 'Rogue' });
    const configuration = await testDb.db.agentConfigurations.create({
      aiAgentId: agent.id,
      version: 1,
      systemPromptRef: 'a-prompt-nobody-wrote@v1',
      businessHoursJson: world.agentConfiguration.businessHoursJson,
      defaultTimezone: 'America/New_York',
      minLeadTimeMinutes: 30,
      maxSchedulingHorizonDays: 180,
      allowedToolsJson: world.agentConfiguration.allowedToolsJson,
    });
    const conversation = await testDb.db.conversations.create({
      organizationId: world.organization.id,
      contactId: world.contact.id,
      aiAgentId: agent.id,
      agentConfigurationId: configuration.id,
    });

    await expect(runtime.agent.handleTurn({ conversationId: conversation.id, utterance: 'Hi' })).rejects.toThrow(
      /Unknown systemPromptRef/,
    );
  });
});

describe('parseAllowedTools', () => {
  const configuration = {
    id: 'cfg_1',
    aiAgentId: 'agent_1',
    version: 1,
    systemPromptRef: 'sales-scheduler@v1',
    businessHoursJson: '{}',
    defaultTimezone: 'UTC',
    minLeadTimeMinutes: 30,
    maxSchedulingHorizonDays: 180,
    allowedToolsJson: stringifyJson(['schedule_followup']),
    isActive: true,
    createdAt: SLICE_NOW_UTC,
    updatedAt: SLICE_NOW_UTC,
  };

  it('reads a list of tool names', () => {
    expect(parseAllowedTools(configuration)).toEqual(['schedule_followup']);
  });

  it('refuses a malformed column rather than silently disarming the agent', () => {
    // An agent stripped of its tools would keep talking and quietly stop being
    // able to do anything - the worst of both outcomes.
    expect(() => parseAllowedTools({ ...configuration, allowedToolsJson: '{"a":1}' })).toThrow(ConfigurationError);
    expect(() => parseAllowedTools({ ...configuration, allowedToolsJson: '[1,2,3]' })).toThrow(ConfigurationError);
    expect(() => parseAllowedTools({ ...configuration, allowedToolsJson: 'not json' })).toThrow();
  });
});
