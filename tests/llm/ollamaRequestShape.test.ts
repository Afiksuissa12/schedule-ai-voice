/**
 * WHAT ACTUALLY REACHES THE WIRE.
 *
 * The semantic claim verifier's determinism story is a claim about the request
 * body and nothing else: a JSON schema in Ollama's `format`,
 * `options.temperature === 0`, and a fixed `options.seed`. Before Mission 2F the
 * body was built by a private method on `LocalLlmProvider`, so the only way to see
 * it was to run against a real Ollama - which this mission may not do and which
 * would not be a regression net anyway.
 *
 * `toOllamaChatRequest` is that construction, pulled out and made pure, and this
 * file is the assertion. NO NETWORK: `mapping.ts` has no I/O in it at all, which
 * `npm run llm:mapcheck` enforces by replacing `fetch` with a throw.
 *
 * THE OTHER HALF OF THIS FILE'S JOB is the negative: that the CONVERSATIONAL turn's
 * body is byte-identical to what it was before any of this existed. `format` and
 * `seed` are absent keys rather than `undefined` values, because a provider that
 * started sending `"format": null` to every turn would be a behaviour change
 * nobody asked for.
 */
import { describe, expect, it } from 'vitest';

import { toOllamaChatRequest } from '../../src/llm/ollama/mapping.js';
import {
  LlmSemanticClaimVerifier,
  SEMANTIC_VERIFIER_SEED,
  SEMANTIC_VERIFIER_TEMPERATURE,
} from '../../src/agent/claimGate/semantic/llmSemanticClaimVerifier.js';
import { SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA } from '../../src/agent/claimGate/semantic/schema.js';
import { LocalLlmProvider } from '../../src/llm/localLlmProvider.js';
import { OllamaClient } from '../../src/llm/ollama/client.js';
import type { OllamaChatChunk, OllamaChatRequest } from '../../src/llm/ollama/wire.js';
import type { LlmToolDefinition } from '../../src/ports/llm.js';

const A_TOOL: LlmToolDefinition = {
  name: 'schedule_meeting',
  description: 'Book a meeting.',
  parametersJsonSchema: { type: 'object', properties: {} },
};

function base(): Parameters<typeof toOllamaChatRequest>[0] {
  return {
    model: 'qwen2.5:7b-instruct',
    systemPrompt: 'You are an assistant.',
    messages: [{ role: 'user', content: 'Hello?' }],
    tools: [],
    stream: false,
    keepAlive: '5m',
    temperature: 0,
    numCtx: 8192,
  };
}

describe('the conversational turn body is unchanged - no format, no seed', () => {
  it('omits `format` entirely when no schema was asked for', () => {
    const request = toOllamaChatRequest(base());
    expect('format' in request).toBe(false);
  });

  it('omits `options.seed` entirely when no seed was asked for', () => {
    const request = toOllamaChatRequest(base());
    expect(Object.keys(request.options ?? {})).toEqual(['temperature', 'num_ctx']);
  });

  it('and the whole body is exactly the shape it was before Mission 2F', () => {
    // Pinned as a literal, not as a set of `toContain`s, because "nothing else
    // appeared on the wire" is the property and only an exact assertion states it.
    expect(toOllamaChatRequest({ ...base(), tools: [A_TOOL], topP: 0.9, maxOutputTokens: 256 })).toEqual({
      model: 'qwen2.5:7b-instruct',
      messages: [
        { role: 'system', content: 'You are an assistant.' },
        { role: 'user', content: 'Hello?' },
      ],
      stream: false,
      tools: [
        {
          type: 'function',
          function: { name: 'schedule_meeting', description: 'Book a meeting.', parameters: { type: 'object', properties: {} } },
        },
      ],
      keep_alive: '5m',
      options: { temperature: 0, num_ctx: 8192, top_p: 0.9, num_predict: 256 },
    });
  });

  it('and `tools` is absent rather than an empty array when there are none', () => {
    expect('tools' in toOllamaChatRequest(base())).toBe(false);
  });
});

describe('a schema-constrained request carries the schema and the seed', () => {
  const request = toOllamaChatRequest({
    ...base(),
    responseJsonSchema: SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA,
    seed: SEMANTIC_VERIFIER_SEED,
  });

  it('puts the JSON SCHEMA in Ollama`s `format`, not the weaker string "json"', () => {
    expect(request.format).toBe(SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA);
    expect(request.format).not.toBe('json');
  });

  it('puts the SEED in `options`, beside the existing sampler knobs', () => {
    expect(request.options?.['seed']).toBe(SEMANTIC_VERIFIER_SEED);
  });

  it('and `options.temperature` is 0', () => {
    expect(request.options?.['temperature']).toBe(0);
  });

  it('and the body survives JSON.stringify with all three keys present', () => {
    // The transport does `JSON.stringify({ ...request, stream: false })`, so this
    // is the last shape anything in this repository can observe.
    const wire = JSON.parse(JSON.stringify({ ...request, stream: false })) as Record<string, unknown>;
    expect(wire['format']).toEqual(SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA);
    expect((wire['options'] as Record<string, unknown>)['seed']).toBe(SEMANTIC_VERIFIER_SEED);
    expect((wire['options'] as Record<string, unknown>)['temperature']).toBe(0);
  });
});

describe('the verifier`s determinism controls survive LocalLlmProvider, end to end', () => {
  /**
   * A client that captures the request and answers from memory.
   *
   * Subclassing `OllamaClient` rather than faking `fetch`: `LocalLlmProviderOptions
   * .client` is a declared injection seam, and overriding `chat` means the
   * provider's OWN `buildRequest` - the code under test - is what produced the body.
   * Nothing here opens a socket; the base constructor dials nothing.
   */
  class CapturingClient extends OllamaClient {
    readonly bodies: OllamaChatRequest[] = [];

    constructor(private readonly answer: string) {
      super({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000 });
    }

    override async chat(request: OllamaChatRequest): Promise<OllamaChatChunk[]> {
      this.bodies.push(request);
      return [{ model: 'qwen2.5:7b-instruct', message: { role: 'assistant', content: this.answer }, done: true }];
    }

    /**
     * Overridden so NOTHING here touches a socket.
     *
     * `LocalLlmProvider.describeRuntime` calls `/api/show` once per instance, and
     * it is best-effort - a failure just means the metrics carry less detail. Left
     * to the real implementation it would dial `127.0.0.1:1`, fail, and retry with
     * backoff: an outbound attempt this repository's whole test discipline is
     * against, and about 750 ms per test of waiting for it.
     */
    override async postJson<T>(path: string): Promise<T> {
      if (path !== '/api/show') {
        throw new Error(`CapturingClient was asked for ${path}, which this test does not expect.`);
      }
      return { details: { quantization_level: 'Q4_K_M', family: 'qwen2' } } as T;
    }
  }

  const GOOD = JSON.stringify({
    claims: [
      {
        assertsEffect: true,
        effectFamily: 'MEETING',
        status: 'COMPLETED',
        whenPhrase: 'Thursday at 2pm',
        identifier: null,
        confidence: 0.9,
      },
    ],
  });

  it('a verifier over a real LocalLlmProvider sends format, temperature 0, a fixed seed and NO tools', async () => {
    // The whole chain in one assertion: verifier -> port request -> provider ->
    // pure mapper -> body. This is what "the determinism controls reach the wire"
    // means, and it is proven with a double rather than with a model.
    const client = new CapturingClient(GOOD);
    const provider = new LocalLlmProvider({ client, model: 'qwen2.5:7b-instruct', temperature: 0.7 });
    const verifier = new LlmSemanticClaimVerifier({ llm: provider });

    const verdict = await verifier.classify({
      text: 'Your meeting is booked for Thursday at 2pm.',
      correlationId: 'corr-wire',
    });
    expect(verdict.kind).toBe('CLASSIFIED');

    const body = client.bodies[0];
    expect(body?.format).toBe(SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA);
    expect(body?.options?.['seed']).toBe(SEMANTIC_VERIFIER_SEED);
    expect(body?.options?.['temperature']).toBe(SEMANTIC_VERIFIER_TEMPERATURE);
    expect(body?.options?.['temperature']).toBe(0);
    expect('tools' in (body ?? {})).toBe(false);
  });

  it('and the per-request temperature BEATS a provider configured warm', async () => {
    // The property that makes one resident model safe to share between the agent
    // and the verifier: the verifier cannot be made creative by configuration.
    const client = new CapturingClient(GOOD);
    const provider = new LocalLlmProvider({ client, temperature: 1.4 });
    await new LlmSemanticClaimVerifier({ llm: provider }).classify({
      text: 'Your meeting is booked for Thursday at 2pm.',
      correlationId: 'corr-wire',
    });
    expect(client.bodies[0]?.options?.['temperature']).toBe(0);
  });

  it('while an ORDINARY turn through the same provider keeps its configured temperature and gets no seed', async () => {
    // The negative, on the same instance shape. Mission 2F changed no default.
    const client = new CapturingClient('Hello.');
    const provider = new LocalLlmProvider({ client, temperature: 0.7 });
    await provider.completeTurn({ systemPrompt: 'p', messages: [{ role: 'user', content: 'hi' }], tools: [] });
    expect(client.bodies[0]?.options?.['temperature']).toBe(0.7);
    expect('seed' in (client.bodies[0]?.options ?? {})).toBe(false);
    expect('format' in (client.bodies[0] ?? {})).toBe(false);
  });

  it('and a provider-level seed is honoured when a caller configures one', async () => {
    const client = new CapturingClient('Hello.');
    const provider = new LocalLlmProvider({ client, seed: 4242 });
    await provider.completeTurn({ systemPrompt: 'p', messages: [{ role: 'user', content: 'hi' }], tools: [] });
    expect(client.bodies[0]?.options?.['seed']).toBe(4242);
  });

  it('and LocalLlmProvider declares the capability, so a caller can ask before relying on it', () => {
    expect(new LocalLlmProvider({ client: new CapturingClient('x') }).supportsStructuredOutput()).toBe(true);
  });
});
