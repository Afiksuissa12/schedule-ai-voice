/**
 * `LlmSemanticClaimVerifier`, over a RECORDING FAKE PROVIDER. No model is called.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------------------------------------------------------------
 * Two things, and they are different in kind:
 *
 *  1. THE AUTHORITY BOUNDARY, as behaviour. The verifier is offered NO TOOLS, is
 *     handed nothing it could read state from, and every failure mode it has
 *     becomes a fail-closed verdict instead of an exception. The IMPORT half of
 *     the same property is `tests/invariants/verifierAuthorityBoundary.test.ts`.
 *
 *  2. THE DETERMINISM CONTROLS REACH THE REQUEST. `llmSemanticClaimVerifier.ts`
 *     records seven controls as IN EFFECT; four of them are properties of the
 *     `CompleteTurnRequest` this verifier builds, and are asserted here. The
 *     remaining wire-level half - that they land in Ollama's `format` and
 *     `options` - is `tests/llm/ollamaRequestShape.test.ts`, because that is a
 *     property of the mapper rather than of this class.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SEMANTIC_VERIFIER_TIMEOUT_MS,
  LlmSemanticClaimVerifier,
  SEMANTIC_VERIFIER_SEED,
  SEMANTIC_VERIFIER_TEMPERATURE,
} from '../../src/agent/claimGate/semantic/llmSemanticClaimVerifier.js';
import {
  SEMANTIC_VERIFIER_INSTRUCTION,
  SEMANTIC_VERIFIER_TEXT_CLOSE,
  SEMANTIC_VERIFIER_TEXT_OPEN,
} from '../../src/agent/claimGate/semantic/instruction.js';
import { SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA } from '../../src/agent/claimGate/semantic/schema.js';
import type { CompleteTurnRequest, CompleteTurnResult, LlmProvider } from '../../src/ports/llm.js';

const TEXT = 'Your meeting is booked for Thursday at 2pm.';

/**
 * A provider that records what it was asked and answers what the test says.
 *
 * Deliberately NOT `ScriptedLlmProvider`: that double is shaped for a
 * conversational turn (steps, tool calls, exhaustion behaviour) and what these
 * tests need is one request captured verbatim plus the ability to throw, hang and
 * return null.
 */
class RecordingProvider implements LlmProvider {
  readonly requests: CompleteTurnRequest[] = [];

  constructor(
    private readonly answer:
      | { kind: 'text'; text: string | null; modelId?: string }
      | { kind: 'throw'; error: Error }
      | { kind: 'hang' },
  ) {}

  name(): string {
    return 'recording-test-provider';
  }

  supportsStructuredOutput(): boolean {
    return true;
  }

  async completeTurn(req: CompleteTurnRequest): Promise<CompleteTurnResult> {
    this.requests.push(req);
    if (this.answer.kind === 'throw') throw this.answer.error;
    if (this.answer.kind === 'hang') {
      // Never settles. `unref`'d timers in the verifier mean this cannot hold the
      // process open, and the verifier's own deadline is what resolves the race.
      return new Promise<CompleteTurnResult>(() => undefined);
    }
    return {
      assistantText: this.answer.text,
      toolCalls: [],
      ...(this.answer.modelId
        ? {
            metrics: {
              modelId: this.answer.modelId,
              streamed: false,
              timeToFirstTokenMs: null,
              totalLatencyMs: 1,
              promptTokens: null,
              generatedTokens: null,
              tokensPerSecond: null,
              contextUtilization: null,
            },
          }
        : {}),
    };
  }
}

const GOOD_ANSWER = JSON.stringify({
  claims: [
    {
      assertsEffect: true,
      effectFamily: 'MEETING',
      status: 'COMPLETED',
      whenPhrase: 'Thursday at 2pm',
      identifier: null,
      confidence: 0.95,
    },
  ],
});

function verifierOver(
  answer: ConstructorParameters<typeof RecordingProvider>[0],
  timeoutMs?: number,
): { verifier: LlmSemanticClaimVerifier; provider: RecordingProvider } {
  const provider = new RecordingProvider(answer);
  const verifier = new LlmSemanticClaimVerifier({
    llm: provider,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { verifier, provider };
}

describe('the verifier is offered NO TOOLS, so it cannot cause an effect', () => {
  it('sends an empty tool list', async () => {
    const { verifier, provider } = verifierOver({ kind: 'text', text: GOOD_ANSWER });
    await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.tools).toEqual([]);
  });

  it('and sends exactly one user message plus the system instruction - no transcript', async () => {
    // A verifier handed a transcript is a verifier that can be talked to. It sees
    // the text under examination and nothing else about the conversation.
    const { verifier, provider } = verifierOver({ kind: 'text', text: GOOD_ANSWER });
    await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
    const request = provider.requests[0];
    expect(request?.messages).toHaveLength(1);
    expect(request?.messages[0]?.role).toBe('user');
    expect(request?.systemPrompt).toBe(SEMANTIC_VERIFIER_INSTRUCTION);
  });

  it('and the text travels as DATA inside named markers, not interpolated into the instruction', async () => {
    const { verifier, provider } = verifierOver({ kind: 'text', text: GOOD_ANSWER });
    await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
    const content = provider.requests[0]?.messages[0]?.content ?? '';
    expect(content).toContain(SEMANTIC_VERIFIER_TEXT_OPEN);
    expect(content).toContain(SEMANTIC_VERIFIER_TEXT_CLOSE);
    expect(content).toContain(TEXT);
    // The instruction itself is a constant and carries none of the text.
    expect(SEMANTIC_VERIFIER_INSTRUCTION).not.toContain(TEXT);
  });

  it('and the locale hint, when given, rides on the marker rather than on the instruction', async () => {
    const { verifier, provider } = verifierOver({ kind: 'text', text: '{"claims":[]}' });
    await verifier.classify({ text: TEXT, correlationId: 'corr-1', localeHint: 'he' });
    expect(provider.requests[0]?.messages[0]?.content).toContain('lang=he');
    expect(provider.requests[0]?.systemPrompt).toBe(SEMANTIC_VERIFIER_INSTRUCTION);
  });
});

describe('the determinism controls reach the request', () => {
  it('asks for temperature 0 and the FIXED seed, per request', async () => {
    const { verifier, provider } = verifierOver({ kind: 'text', text: GOOD_ANSWER });
    await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
    expect(provider.requests[0]?.determinism).toEqual({
      temperature: SEMANTIC_VERIFIER_TEMPERATURE,
      seed: SEMANTIC_VERIFIER_SEED,
    });
    expect(SEMANTIC_VERIFIER_TEMPERATURE).toBe(0);
  });

  it('and the seed is a fixed constant, not a value that varies per call', async () => {
    const { verifier, provider } = verifierOver({ kind: 'text', text: GOOD_ANSWER });
    await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
    await verifier.classify({ text: 'Something else entirely.', correlationId: 'corr-2' });
    expect(provider.requests[0]?.determinism?.seed).toBe(provider.requests[1]?.determinism?.seed);
  });

  it('and carries the JSON schema, so decoding is constrained rather than requested', async () => {
    const { verifier, provider } = verifierOver({ kind: 'text', text: GOOD_ANSWER });
    await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
    expect(provider.requests[0]?.responseJsonSchema).toBe(SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA);
  });

  it('and the instruction bytes are identical across calls, so the request is reproducible', async () => {
    const { verifier, provider } = verifierOver({ kind: 'text', text: GOOD_ANSWER });
    await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
    await verifier.classify({ text: TEXT, correlationId: 'corr-2' });
    expect(provider.requests[0]?.systemPrompt).toBe(provider.requests[1]?.systemPrompt);
    expect(provider.requests[0]?.messages[0]?.content).toBe(provider.requests[1]?.messages[0]?.content);
  });
});

describe('a good answer is CLASSIFIED', () => {
  it('returns the validated claims and the model that produced them', async () => {
    const { verifier } = verifierOver({ kind: 'text', text: GOOD_ANSWER, modelId: 'qwen-for-test' });
    const verdict = await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
    expect(verdict.kind).toBe('CLASSIFIED');
    expect(verdict.kind === 'CLASSIFIED' && verdict.claims).toHaveLength(1);
    expect(verdict.kind === 'CLASSIFIED' && verdict.modelId).toBe('qwen-for-test');
  });

  it('and a provider that reports no metrics gives a null modelId rather than a guess', async () => {
    const { verifier } = verifierOver({ kind: 'text', text: '{"claims":[]}' });
    const verdict = await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
    expect(verdict.kind === 'CLASSIFIED' && verdict.modelId).toBeNull();
  });
});

describe('every failure becomes a fail-closed verdict, and NOTHING throws past the gate', () => {
  it('a provider that THROWS is UNAVAILABLE', async () => {
    const { verifier } = verifierOver({ kind: 'throw', error: new Error('connect ECONNREFUSED') });
    const verdict = await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
    expect(verdict.kind).toBe('UNAVAILABLE');
    expect(verdict.kind !== 'CLASSIFIED' && verdict.reason).toContain('ECONNREFUSED');
  });

  it('a provider that never answers is TIMED_OUT, at the deadline this class holds', async () => {
    const { verifier } = verifierOver({ kind: 'hang' }, 25);
    const verdict = await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
    expect(verdict.kind).toBe('TIMED_OUT');
    expect(verdict.kind !== 'CLASSIFIED' && verdict.reason).toContain('25 ms');
  });

  it('a null assistantText is EMPTY, not a classification with no claims', async () => {
    const { verifier } = verifierOver({ kind: 'text', text: null });
    const verdict = await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
    expect(verdict.kind).toBe('EMPTY');
  });

  it('a whitespace-only answer is EMPTY too', async () => {
    const { verifier } = verifierOver({ kind: 'text', text: '   \n  ' });
    expect((await verifier.classify({ text: TEXT, correlationId: 'corr-1' })).kind).toBe('EMPTY');
  });

  it('prose instead of JSON is MALFORMED', async () => {
    const { verifier } = verifierOver({ kind: 'text', text: 'Yes, that text claims a booking.' });
    const verdict = await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
    expect(verdict.kind).toBe('MALFORMED');
  });

  it('JSON that fails the strict schema is MALFORMED', async () => {
    const { verifier } = verifierOver({ kind: 'text', text: '{"claims":[{"effectFamily":"MEETING"}]}' });
    expect((await verifier.classify({ text: TEXT, correlationId: 'corr-1' })).kind).toBe('MALFORMED');
  });

  it('a quoted phrase that is NOT IN THE TEXT is MALFORMED - the verifier may not invent evidence', async () => {
    const ungrounded = JSON.stringify({
      claims: [
        {
          assertsEffect: true,
          effectFamily: 'MEETING',
          status: 'COMPLETED',
          whenPhrase: 'Friday at 4pm',
          identifier: null,
          confidence: 0.9,
        },
      ],
    });
    const { verifier } = verifierOver({ kind: 'text', text: ungrounded });
    const verdict = await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
    expect(verdict.kind).toBe('MALFORMED');
    expect(verdict.kind !== 'CLASSIFIED' && verdict.reason).toContain('does not occur in the text');
  });

  it('an empty proposal is EMPTY without a provider call at all', async () => {
    const { verifier, provider } = verifierOver({ kind: 'text', text: GOOD_ANSWER });
    const verdict = await verifier.classify({ text: '   ', correlationId: 'corr-1' });
    expect(verdict.kind).toBe('EMPTY');
    expect(provider.requests).toHaveLength(0);
  });

  it('and NO failure variant is ever reported as CLASSIFIED with an empty list', async () => {
    // The mistake this layer exists to avoid, asserted as a property over every
    // failing provider shape rather than case by case.
    const shapes: ConstructorParameters<typeof RecordingProvider>[0][] = [
      { kind: 'throw', error: new Error('down') },
      { kind: 'text', text: null },
      { kind: 'text', text: 'not json' },
      { kind: 'text', text: '{"claims":[{"bogus":1}]}' },
    ];
    for (const shape of shapes) {
      const { verifier } = verifierOver(shape);
      const verdict = await verifier.classify({ text: TEXT, correlationId: 'corr-1' });
      expect(verdict.kind, `${JSON.stringify(shape)} must not be CLASSIFIED`).not.toBe('CLASSIFIED');
    }
  });
});

describe('the deadline is this class’s own, and it is short', () => {
  it('defaults to a bound argued in code, well under the provider default of 120 s', () => {
    const { verifier } = verifierOver({ kind: 'text', text: GOOD_ANSWER });
    expect(verifier.deadlineMs).toBe(DEFAULT_SEMANTIC_VERIFIER_TIMEOUT_MS);
    expect(DEFAULT_SEMANTIC_VERIFIER_TIMEOUT_MS).toBeLessThan(120_000);
  });
});

describe('the model-facing instruction carries no customer-facing wording', () => {
  // A structural companion to `npm run check:anti-scripting`, which scans
  // `src/agent` and therefore already reads this module. What that check cannot
  // do is state the INTENT, so this does.
  it('never addresses a contact in the second person about a booking', () => {
    expect(SEMANTIC_VERIFIER_INSTRUCTION).not.toMatch(/\byour (meeting|appointment|callback|call back)\b/i);
  });

  it('never tells the model what happens to the text next', () => {
    // The largest risk in this design is a verifier that starts answering "is this
    // OK to send?". It is not told there is a ledger, a release, or a regeneration.
    for (const forbidden of ['ledger', 'regenerat', 'release', 'approve', 'send it', 'customer']) {
      expect(SEMANTIC_VERIFIER_INSTRUCTION.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('and does tell the model to resolve its own uncertainty towards REPORTING', () => {
    // The asymmetry that makes this layer safe to add at all, asserted so it
    // cannot be edited out quietly.
    expect(SEMANTIC_VERIFIER_INSTRUCTION).toContain('WHEN YOU ARE UNSURE, REPORT IT');
  });
});
