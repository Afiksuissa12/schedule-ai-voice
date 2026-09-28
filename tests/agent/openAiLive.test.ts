/**
 * THE ONE OPTIONAL LIVE TEST.
 *
 * This is the only test in the repository that can reach a network, and it runs
 * ONLY when `OPENAI_API_KEY` is set. With the key absent - which is how CI, a
 * fresh clone, and the mission's own acceptance run all execute - every case
 * below is skipped and the suite is green.
 *
 * That is a hard requirement, not a convenience: a test suite that needs a paid
 * credential is a test suite that stops being run.
 *
 * WHAT IT IS FOR
 * ---------------------------------------------------------------------------
 * Exactly one thing the double cannot tell us: that a REAL OpenAI model, handed
 * this repository's guardrailed prompt and this repository's generated JSON
 * Schemas, produces a tool call that the dispatcher's Zod schemas accept. Every
 * other property - validation, persistence, audit, rejection - is proved
 * deterministically elsewhere and needs no vendor.
 *
 * It asserts on STRUCTURE, never on wording. A test that requires a particular
 * sentence from a language model is a test that fails on a Tuesday for no
 * reason.
 *
 * Run it with:  OPENAI_API_KEY=sk-... npx vitest run tests/agent/openAiLive.test.ts
 */
import { describe, expect, it } from 'vitest';

import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT_REF } from '../../src/agent/prompt/systemPrompt.js';
import { llmToolDefinitions, TOOL_DEFINITIONS, TOOL_NAMES } from '../../src/agent/tools/definitions.js';
import { OpenAiLlmProvider } from '../../src/llm/openAiLlmProvider.js';
import { tryParseJson } from '../../src/shared/json.js';

const apiKey = process.env['OPENAI_API_KEY']?.trim();
const live = apiKey ? describe : describe.skip;

if (!apiKey) {
  // Printed once so a reader of a green run knows this was skipped on purpose
  // rather than silently absent.
  console.info('[openAiLive] OPENAI_API_KEY is not set - skipping the optional live OpenAI test.');
}

live('OpenAiLlmProvider against the real API (optional)', () => {
  // Constructed lazily INSIDE each test. `describe.skip` still evaluates its
  // callback in order to collect the test names, so building a key-requiring
  // provider at describe level would throw during collection even when the
  // block is skipped - failing the suite for want of a credential, which is
  // the one thing this file must never do.
  const provider = () => new OpenAiLlmProvider({ apiKey: apiKey ?? '', timeoutMs: 60_000 });

  it('produces a schema-valid schedule_followup from a natural request', { timeout: 120_000 }, async () => {
    const prompt = buildSystemPrompt({
      promptRef: DEFAULT_SYSTEM_PROMPT_REF,
      allowedToolNames: [...TOOL_NAMES],
    });

    const result = await provider().completeTurn({
      systemPrompt: prompt.text,
      messages: [
        {
          role: 'system',
          content: [
            'You are speaking with Jordan Prospect.',
            'Their contact id is contact_live_test. Use exactly this id in every tool call.',
            // Mirrors `turnContext.ts`'s real disclosure, which drops the year
            // on purpose - docs/MISSION_2D_AYA_ROOT_CAUSE.md § 9. A live test
            // that fed the model a year would be testing a prompt we no longer
            // send, and would reintroduce the exemplar this fix removed.
            'They are in America/New_York, where it is currently Wednesday 4 March at 10:00.',
          ].join('\n'),
        },
        { role: 'user', content: 'Can you call me back tomorrow afternoon at 3?' },
      ],
      tools: llmToolDefinitions([...TOOL_NAMES]),
    });

    const call = result.toolCalls.find((candidate) => candidate.toolName === 'schedule_followup');
    expect(call, `model proposed: ${result.toolCalls.map((c) => c.toolName).join(', ') || '(none)'}`).toBeDefined();
    if (!call) return;

    // 1. The arguments are a string, and they parse.
    expect(typeof call.argumentsJson).toBe('string');
    const parsed = tryParseJson<unknown>(call.argumentsJson);
    expect(parsed.ok, `unparseable arguments: ${call.argumentsJson}`).toBe(true);

    // 2. THE POINT OF THIS TEST: the dispatcher's own schema accepts what a
    // real model produced from our generated JSON Schema. If these two ever
    // drift, this is where it shows up.
    const validated = TOOL_DEFINITIONS.schedule_followup.schema.safeParse(parsed.ok ? parsed.value : null);
    expect(
      validated.success,
      `real model output failed our Zod schema: ${call.argumentsJson}\n${JSON.stringify(
        validated.success ? [] : validated.error.issues,
      )}`,
    ).toBe(true);
    if (!validated.success) return;

    const args = validated.data as { contact_id: string; when: string };

    // 3. It used the id it was given rather than inventing one.
    expect(args.contact_id).toBe('contact_live_test');

    // 4. And it passed the contact's words through instead of doing date
    // arithmetic. Asserted loosely - the model may tidy the phrasing - but it
    // must NOT have produced a resolved timestamp.
    expect(args.when).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(args.when.toLowerCase()).toContain('3');
  });

  it('asks a clarifying question instead of guessing an ambiguous time', { timeout: 120_000 }, async () => {
    const prompt = buildSystemPrompt({
      promptRef: DEFAULT_SYSTEM_PROMPT_REF,
      allowedToolNames: [...TOOL_NAMES],
    });

    const result = await provider().completeTurn({
      systemPrompt: prompt.text,
      messages: [
        {
          role: 'system',
          content:
            'You are speaking with Jordan Prospect. Their contact id is contact_live_test. They are in ' +
            // Year dropped for the same reason as above.
            'America/New_York, where it is currently Wednesday 4 March at 10:00.',
        },
        { role: 'user', content: 'Give me a ring at some point, whenever suits.' },
      ],
      tools: llmToolDefinitions([...TOOL_NAMES]),
    });

    // Structural, not textual: it must not have tried to BOOK anything from
    // "at some point". Talking, or looking the contact up, are both fine.
    const scheduling = result.toolCalls.filter((call) =>
      ['schedule_followup', 'schedule_meeting'].includes(call.toolName),
    );
    expect(
      scheduling,
      `model tried to schedule from a vague request: ${scheduling.map((c) => c.argumentsJson).join(' | ')}`,
    ).toHaveLength(0);
  });
});
