import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';

import { OpenAiLlmProvider } from '../../src/llm/openAiLlmProvider.js';
import { isStructuredOutputLlmProvider } from '../../src/ports/llm.js';

/** A fake OpenAI client that records the request body and returns a canned completion. */
function fakeClient(reply: { content?: string | null } = { content: '{"claims":[]}' }) {
  const bodies: Record<string, unknown>[] = [];
  const client = {
    chat: {
      completions: {
        create: async (body: Record<string, unknown>) => {
          bodies.push(body);
          return { choices: [{ message: { content: reply.content ?? null, tool_calls: [] } }] };
        },
      },
    },
  } as unknown as OpenAI;
  return { client, bodies };
}

const schema = { type: 'object', properties: { claims: { type: 'array' } }, required: ['claims'], additionalProperties: false };

describe('OpenAiLlmProvider structured output (hosted-demo)', () => {
  it('is OFF by default: declares nothing and forwards no schema or seed', async () => {
    const { client, bodies } = fakeClient();
    const provider = new OpenAiLlmProvider({ apiKey: 'test-key', client });
    expect(isStructuredOutputLlmProvider(provider)).toBe(false);
    await provider.completeTurn({ systemPrompt: 's', messages: [], tools: [], responseJsonSchema: schema, determinism: { temperature: 0, seed: 7 } });
    expect(bodies[0]).not.toHaveProperty('response_format');
    expect(bodies[0]).not.toHaveProperty('seed');
  });

  it('when enabled, declares the capability and forwards the schema, temperature and seed', async () => {
    const { client, bodies } = fakeClient();
    const provider = new OpenAiLlmProvider({ apiKey: 'test-key', client, temperature: 0.4, structuredOutput: true });
    expect(isStructuredOutputLlmProvider(provider)).toBe(true);
    const result = await provider.completeTurn({ systemPrompt: 's', messages: [], tools: [], responseJsonSchema: schema, determinism: { temperature: 0, seed: 7 } });
    expect(bodies[0]).toMatchObject({
      temperature: 0,
      seed: 7,
      response_format: { type: 'json_schema', json_schema: { name: 'response', schema, strict: true } },
    });
    expect(result.assistantText).toBe('{"claims":[]}');
  });

  it('when enabled but a request carries no schema, sends an ordinary chat request with tools', async () => {
    const { client, bodies } = fakeClient({ content: 'hello' });
    const provider = new OpenAiLlmProvider({ apiKey: 'test-key', client, structuredOutput: true });
    await provider.completeTurn({
      systemPrompt: 's', messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'noop', description: 'd', parametersJsonSchema: { type: 'object', properties: {} } }],
    });
    expect(bodies[0]).not.toHaveProperty('response_format');
    expect(bodies[0]).toMatchObject({ tool_choice: 'auto', temperature: 0 });
  });

  it('lets the composition root wire the REAL semantic claim verifier over it', async () => {
    const { buildAgentRuntime } = await import('../../src/app/composition.js');
    const { createTestDatabase } = await import('../helpers/testDb.js');
    const { db, cleanup } = await createTestDatabase();
    try {
      const { client } = fakeClient();
      const runtime = buildAgentRuntime({ db, llm: new OpenAiLlmProvider({ apiKey: 'test-key', client, structuredOutput: true }) });
      expect(runtime.claimGate.semanticVerifier?.verifierName).toBe('llm-semantic-claim-verifier');
      const offline = buildAgentRuntime({ db, llm: new OpenAiLlmProvider({ apiKey: 'test-key', client }) });
      expect(offline.claimGate.semanticVerifier?.verifierName).toBe('rule-driven-semantic-claim-verifier');
    } finally {
      await cleanup();
    }
  });
});
