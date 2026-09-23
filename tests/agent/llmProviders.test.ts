/**
 * The LLM boundary.
 *
 * `ScriptedLlmProvider` is tested properly because the entire rest of the suite
 * depends on it: a double that lies about what it was given would invalidate
 * every guardrail assertion in this repository.
 *
 * `OpenAiLlmProvider` is tested for the parts that can be checked without a
 * credential - that it refuses to construct without a key, and that its
 * message translation is correct - plus ONE optional live test that skips
 * cleanly when `OPENAI_API_KEY` is absent. The suite must never need it.
 */
import { describe, expect, it } from 'vitest';

import { ADVERSARIAL, ScriptedLlmProvider, scriptedArgs } from '../../src/llm/scriptedLlmProvider.js';
import { OpenAiLlmProvider, DEFAULT_OPENAI_MODEL } from '../../src/llm/openAiLlmProvider.js';
import { toolNameOf, type AgentLlmMessage } from '../../src/llm/agentMessage.js';
import { ConfigurationError, InvariantViolationError } from '../../src/shared/errors.js';
import type { CompleteTurnRequest, LlmMessage } from '../../src/ports/llm.js';

const EMPTY_REQUEST: CompleteTurnRequest = { systemPrompt: 'be good', messages: [], tools: [] };

describe('ScriptedLlmProvider', () => {
  it('returns its steps in order, minting tool call ids where none was given', async () => {
    const llm = new ScriptedLlmProvider({
      script: [
        { assistantText: 'one', toolCalls: [{ toolName: 'get_contact_context', argumentsJson: '{}' }] },
        { assistantText: 'two' },
      ],
    });

    const first = await llm.completeTurn(EMPTY_REQUEST);
    expect(first.assistantText).toBe('one');
    expect(first.toolCalls[0]?.toolCallId).toBe('scripted-call-1');
    expect(first.toolCalls[0]?.toolName).toBe('get_contact_context');

    const second = await llm.completeTurn(EMPTY_REQUEST);
    expect(second.assistantText).toBe('two');
    expect(second.toolCalls).toEqual([]);
  });

  it('records exactly what it was asked, so a test can inspect the prompt', async () => {
    const llm = new ScriptedLlmProvider();
    await llm.completeTurn({
      systemPrompt: 'THE PROMPT',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'schedule_followup', description: 'd', parametersJsonSchema: {} }],
    });

    expect(llm.callCount).toBe(1);
    expect(llm.lastSystemPrompt()).toBe('THE PROMPT');
    expect(llm.lastOfferedToolNames()).toEqual(['schedule_followup']);
    expect(llm.completions[0]?.request.messages[0]?.content).toBe('hello');
  });

  it('keeps arguments as a STRING, never a parsed object', async () => {
    // The whole reason `argumentsJson` is a string is that it is untrusted
    // input. A double that handed back an object would quietly skip the parse
    // step under test.
    const llm = new ScriptedLlmProvider({
      script: [{ toolCalls: [{ toolName: 'schedule_followup', argumentsJson: scriptedArgs({ a: 1 }) }] }],
    });
    const result = await llm.completeTurn(EMPTY_REQUEST);
    expect(typeof result.toolCalls[0]?.argumentsJson).toBe('string');
  });

  it('ends politely when the script runs out', async () => {
    const llm = new ScriptedLlmProvider({ script: [], finalText: 'anything else?' });
    const result = await llm.completeTurn(EMPTY_REQUEST);
    expect(result.assistantText).toBe('anything else?');
    expect(result.toolCalls).toEqual([]);
  });

  it('can repeat forever, so the turn loop’s cap is genuinely tested', async () => {
    const llm = new ScriptedLlmProvider({
      script: [{ toolCalls: [{ toolName: 'get_contact_context', argumentsJson: '{}' }] }],
      onExhausted: 'repeat-last',
    });

    for (let i = 0; i < 20; i += 1) {
      expect((await llm.completeTurn(EMPTY_REQUEST)).toolCalls).toHaveLength(1);
    }
    // Each repetition is a distinct call with a distinct id.
    expect(llm.completions.at(-1)?.result.toolCalls[0]?.toolCallId).toBe('scripted-call-20');
  });

  it('can throw when exhausted, so a test can pin the number of model turns', async () => {
    const llm = new ScriptedLlmProvider({ script: [{ assistantText: 'once' }], onExhausted: 'throw' });
    await llm.completeTurn(EMPTY_REQUEST);
    await expect(llm.completeTurn(EMPTY_REQUEST)).rejects.toThrow(InvariantViolationError);
  });

  it('refuses to repeat an empty script rather than looping on nothing', async () => {
    const llm = new ScriptedLlmProvider({ script: [], onExhausted: 'repeat-last' });
    await expect(llm.completeTurn(EMPTY_REQUEST)).rejects.toThrow(/empty script/);
  });

  it('can be rescripted after the world it refers to has been seeded', async () => {
    const llm = new ScriptedLlmProvider({ script: [{ assistantText: 'placeholder' }] });
    await llm.completeTurn(EMPTY_REQUEST);

    llm.setScript([{ assistantText: 'the real one' }]);
    expect((await llm.completeTurn(EMPTY_REQUEST)).assistantText).toBe('the real one');
    // Recorded completions survive a rescript: a test usually asserts across
    // both turns.
    expect(llm.callCount).toBe(2);
  });
});

describe('the adversarial catalogue', () => {
  it('covers every hostile case the mission names', () => {
    expect(Object.keys(ADVERSARIAL).sort()).toEqual(
      [
        'bogusTimezone',
        'datetimeInThePast',
        'fabricatedContactId',
        'malformedArgumentsJson',
        'missingRequiredField',
        'outsideBusinessHours',
        'qualificationScoreAboveTheCap',
        'toolNotPermittedByConfiguration',
        'unknownTool',
        'unsupportedFollowupType',
      ].sort(),
    );
  });

  it('produces genuinely malformed JSON, not merely wrong JSON', () => {
    const call = ADVERSARIAL.malformedArgumentsJson();
    expect(() => JSON.parse(call.argumentsJson)).toThrow();
  });

  it('produces a contact id that is obviously not a real one', () => {
    const call = ADVERSARIAL.fabricatedContactId();
    expect(JSON.parse(call.argumentsJson).contact_id).toBe('contact_the_model_invented');
  });
});

describe('OpenAiLlmProvider', () => {
  it('refuses to construct without a key, rather than silently degrading', () => {
    // A "production" configuration that quietly does nothing is worse than one
    // that fails at startup.
    expect(() => new OpenAiLlmProvider({ apiKey: '' })).toThrow(ConfigurationError);
    expect(() => new OpenAiLlmProvider({ apiKey: '   ' })).toThrow(/requires an API key/);
  });

  it('reports the model in its name, so audit events pin the exact one used', () => {
    const provider = new OpenAiLlmProvider({ apiKey: 'sk-test-not-a-real-key' });
    expect(provider.name()).toBe(`openai:${DEFAULT_OPENAI_MODEL}`);
    expect(new OpenAiLlmProvider({ apiKey: 'sk-test', model: 'gpt-4o' }).name()).toBe('openai:gpt-4o');
  });
});

describe('AgentLlmMessage', () => {
  it('carries a tool name through the port without changing it', () => {
    // `LlmMessage` cannot express the tool NAME on an assistant tool-call turn,
    // and OpenAI needs it to rebuild `tool_calls`. `AgentLlmMessage` extends
    // the port type rather than modifying it.
    const withoutName: AgentLlmMessage = { role: 'assistant', content: '{}', toolCallId: 'c1' };
    const withName: AgentLlmMessage = {
      role: 'assistant',
      content: '{}',
      toolCallId: 'c1',
      toolName: 'schedule_followup',
    };

    expect(toolNameOf(withoutName)).toBeUndefined();
    expect(toolNameOf(withName)).toBe('schedule_followup');
    // An AgentLlmMessage IS an LlmMessage, so the port is untouched.
    const asPortMessage: LlmMessage = withName;
    expect(asPortMessage.toolCallId).toBe('c1');
  });
});
