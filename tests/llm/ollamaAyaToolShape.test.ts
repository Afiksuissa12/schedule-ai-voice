/**
 * MISSION 2D: `aya-expanse:8b`'s tool-argument shape, driven through the real
 * mapper and the real strict schemas.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------------------------------------------------------------
 * `docs/MISSION_2D_AYA_ROOT_CAUSE.md` makes arithmetic claims about a committed
 * benchmark run - how many of aya's tool calls were double-wrapped, how many
 * pass strict validation once unwrapped, how many still do not and why, how many
 * carry an absolute instant the fabricated-timestamp gate could not see. Every
 * one of those numbers is computed HERE, from the recorded strings in
 * `src/llm/ollama/fixtures.ts`, through:
 *
 *   - `src/llm/ollama/mapping.ts`   - the real mapper the provider runs
 *   - `TOOL_DEFINITIONS[...].schema` - the real strict Zod schemas the dispatcher
 *                                      validates against, not a copy of them
 *   - `FABRICATION_PATTERNS`         - the real gate detector from the eval rubric
 *
 * So the report cannot drift from the evidence without this file going red.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not call a model, open a socket, or touch a database. It does not
 * re-run the benchmark and it does not write anything under
 * `eval-output-fair-20260927/`, which is read-only evidence. Where the committed
 * transcript truncated a value, this file reports the outcome as a RANGE rather
 * than picking an end of it.
 */
import { describe, expect, it } from 'vitest';

import { TOOL_DEFINITIONS, isToolName, type ToolName } from '../../src/agent/tools/definitions.js';
import { FABRICATION_PATTERNS } from '../../src/eval/rubric/programmatic.js';
import {
  AYA_RECORDED_ASSISTANT_TEXTS,
  AYA_RECORDED_TOOL_CALLS,
  FIXTURE_AYA_FENCED_DIRECTLY_ANSWER,
  FIXTURE_AYA_NATIVE_NESTED_WRAPPED_CALL,
  FIXTURE_AYA_NATIVE_WRAPPED_CALL,
  FIXTURE_AYA_NATIVE_WRAPPED_CALL_TOOL_NAME_ECHOED,
  FIXTURE_AYA_PROSE_ABOUT_A_TOOL_CALL,
  FIXTURE_AYA_UNFENCED_ACTION_LIST,
  type AyaRecordedCall,
} from '../../src/llm/ollama/fixtures.js';
import {
  recoverToolCallsFromText,
  toCompleteTurnResult,
  unwrapToolNameParametersWrapper,
} from '../../src/llm/ollama/mapping.js';
import type { OllamaChatChunk } from '../../src/llm/ollama/wire.js';

const THE_NINE = Object.keys(TOOL_DEFINITIONS) as ToolName[];
const mintId = (index: number): string => `minted-${index}`;

function mapOne(body: string, offered: ReadonlyArray<string> = THE_NINE) {
  return toCompleteTurnResult({
    chunks: [JSON.parse(body) as OllamaChatChunk],
    offeredToolNames: offered,
    mintId,
    modelId: 'aya-expanse:8b',
    streamed: false,
    totalLatencyMs: 0,
    timeToFirstTokenMs: null,
  });
}

/** Exactly the check the dispatcher makes at step 3, on the real schema. */
function passesStrictSchema(toolName: string, argumentsJson: string): boolean {
  if (!isToolName(toolName)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    return false;
  }
  return TOOL_DEFINITIONS[toolName].schema.safeParse(parsed).success;
}

/** Exactly the gate's detector, minus its "the contact said it" exemption. */
function absoluteInstantsInTimeBearingArgs(toolName: string, argumentsJson: string): string[] {
  if (!isToolName(toolName)) return [];
  if (!TOOL_DEFINITIONS[toolName].timeBearing) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];

  const hits: string[] = [];
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    for (const { re } of FABRICATION_PATTERNS) {
      for (const match of value.matchAll(new RegExp(re.source, re.flags))) hits.push(match[0]);
    }
  }
  return hits;
}

/**
 * What the normalization does to one recorded call, and what strict validation
 * then says. `truncated` is its own outcome rather than a guess.
 */
type Counterfactual = {
  readonly call: AyaRecordedCall;
  readonly wasWrapped: boolean;
  readonly unwrapped: boolean;
  readonly before: 'schema-valid' | 'schema-violation' | 'indeterminate';
  readonly after: 'schema-valid' | 'schema-violation' | 'indeterminate';
  readonly absoluteInstantsBefore: number;
  readonly absoluteInstantsAfter: number;
};

const COUNTERFACTUAL: readonly Counterfactual[] = AYA_RECORDED_TOOL_CALLS.map((call) => {
  const truncated = call.truncatedByTheRenderer === true;
  const normalized = truncated
    ? null
    : unwrapToolNameParametersWrapper(call.toolName, call.argumentsJson);
  const after = normalized?.argumentsJson ?? call.argumentsJson;

  return {
    call,
    wasWrapped: call.arrival === 'native',
    unwrapped: normalized !== null,
    before: truncated ? 'indeterminate' : passesStrictSchema(call.toolName, call.argumentsJson) ? 'schema-valid' : 'schema-violation',
    after: truncated ? 'indeterminate' : passesStrictSchema(call.toolName, after) ? 'schema-valid' : 'schema-violation',
    absoluteInstantsBefore: truncated ? 0 : absoluteInstantsInTimeBearingArgs(call.toolName, call.argumentsJson).length,
    absoluteInstantsAfter: truncated ? 0 : absoluteInstantsInTimeBearingArgs(call.toolName, after).length,
  };
});

const cite = (c: AyaRecordedCall): string => `${c.scenario} turn ${c.turn} (${c.toolName})`;

// ---------------------------------------------------------------------------

describe('the committed aya evidence is what the report says it is', () => {
  it('is the whole population of aya tool calls, partitioned as results.json records', () => {
    expect(AYA_RECORDED_TOOL_CALLS).toHaveLength(44);

    // `results.json` -> models[aya].toolCallHealth = {native: 36, recovered: 8, malformed: 6}.
    const native = AYA_RECORDED_TOOL_CALLS.filter((c) => c.arrival === 'native');
    const recovered = AYA_RECORDED_TOOL_CALLS.filter((c) => c.arrival === 'recovered-from-text');
    expect(native).toHaveLength(36);
    expect(recovered).toHaveLength(8);
  });

  it('every native call is wrapped and every recovered one is flat - the partition is not a label', () => {
    for (const call of AYA_RECORDED_TOOL_CALLS) {
      if (call.truncatedByTheRenderer) {
        // Cannot be parsed, but the wrapper is visible in the surviving prefix.
        expect(call.argumentsJson.startsWith(`{"tool_name":"${call.toolName}","parameters":{`)).toBe(true);
        continue;
      }
      const keys = Object.keys(JSON.parse(call.argumentsJson) as Record<string, unknown>).sort();
      const isWrapper = keys.length === 2 && keys[0] === 'parameters' && keys[1] === 'tool_name';
      expect(isWrapper, cite(call)).toBe(call.arrival === 'native');
    }
  });

  it('reconstructed assistant texts match the character counts the transcripts recorded', () => {
    expect(AYA_RECORDED_ASSISTANT_TEXTS).toHaveLength(12);
    for (const entry of AYA_RECORDED_ASSISTANT_TEXTS) {
      expect(entry.assistantText.length, `${entry.scenario} turn ${entry.turn}`).toBe(entry.recordedChars);
    }
  });
});

// ---------------------------------------------------------------------------

describe('the wrapper rule fires on exactly the unambiguous shape', () => {
  it('unwraps 31 of the 34 replayable wrapped calls and leaves the 3 nested ones alone', () => {
    const wrapped = COUNTERFACTUAL.filter((row) => row.wasWrapped);
    expect(wrapped).toHaveLength(36);

    // Two lost their `urgency` to the renderer's 400-char truncation, so they
    // are not put through the rule at all here.
    const truncated = wrapped.filter((row) => row.call.truncatedByTheRenderer === true);
    expect(truncated.map((r) => cite(r.call))).toEqual([
      'not-decision-maker turn 1 (transfer_to_human)',
      'price-objection-interrupt turn 3 (transfer_to_human)',
    ]);

    const nested = wrapped.filter((row) => !row.unwrapped && row.call.truncatedByTheRenderer !== true);
    expect(nested.map((r) => cite(r.call))).toEqual([
      'incomplete-information turn 3 (get_contact_context)',
      'incomplete-information turn 3 (check_availability)',
      'what-does-the-company-do turn 3 (get_contact_context)',
    ]);

    // 36 wrapped = 31 unwrapped + 3 nested (refused) + 2 truncated (not replayable).
    // The two truncated ones would also have unwrapped on the real run - their
    // surviving prefix is the exact wrapper shape, asserted above - but their
    // strict-schema outcome turns on the `urgency` value the renderer ate, so
    // they are counted nowhere rather than counted optimistically.
    expect(wrapped.filter((row) => row.unwrapped)).toHaveLength(31);
  });

  it('never touches a call that arrived flat', () => {
    for (const row of COUNTERFACTUAL.filter((r) => !r.wasWrapped)) {
      expect(row.unwrapped, cite(row.call)).toBe(false);
      expect(row.before).toBe(row.after);
    }
  });

  it('changes no key and no value inside the parameters object', () => {
    for (const row of COUNTERFACTUAL) {
      if (!row.unwrapped) continue;
      const wrapper = JSON.parse(row.call.argumentsJson) as { parameters: unknown };
      const normalized = unwrapToolNameParametersWrapper(row.call.toolName, row.call.argumentsJson);
      expect(JSON.parse(normalized?.argumentsJson ?? 'null')).toEqual(wrapper.parameters);
    }
  });

  it('carries the pre-normalization bytes forward under a named rule', () => {
    const result = mapOne(FIXTURE_AYA_NATIVE_WRAPPED_CALL);
    const call = result.toolCalls[0];

    expect(call?.argumentsNormalization?.rule).toBe('ollama-tool-name-parameters-wrapper');
    expect(call?.argumentsNormalization?.rawArgumentsJson).toContain('"tool_name":"schedule_meeting"');
    expect(call?.argumentsNormalization?.rawArgumentsJson).toContain('"parameters":{');
    // And the dispatched arguments are the inner object, nothing else.
    expect(call?.argumentsJson).toBe(
      '{"contact_id":"cmujjkcy800tcr2bsbg8jyxyt","description":"Follow-up on Northwind Dispatch",' +
        '"duration_minutes":30,"timezone":"America/New_York","title":"Follow-up call - Northwind Dispatch",' +
        '"when":"2026-03-04T10:30:00-05:00"}',
    );
    expect(passesStrictSchema('schedule_meeting', call?.argumentsJson ?? '')).toBe(true);
  });

  it('leaves an unnormalized call with no provenance field at all', () => {
    const result = mapOne(FIXTURE_AYA_NATIVE_NESTED_WRAPPED_CALL);
    expect(result.toolCalls[0]?.argumentsNormalization).toBeUndefined();
    expect(result.toolCalls[0]?.argumentsJson).toContain('"parameters":{"parameters":');
    expect(passesStrictSchema('get_contact_context', result.toolCalls[0]?.argumentsJson ?? '')).toBe(false);
  });

  it('unwraps the container without excusing what the container held', () => {
    const result = mapOne(FIXTURE_AYA_NATIVE_WRAPPED_CALL_TOOL_NAME_ECHOED);
    expect(result.toolCalls[0]?.argumentsJson).toBe(
      '{"contact_id":"cmujjfinc005rr2bsq5780le3","tool_name":"get_contact_context"}',
    );
    // Unwrapped, dispatched, and STILL refused - `.strict()` names the echo.
    expect(passesStrictSchema('get_contact_context', result.toolCalls[0]?.argumentsJson ?? '')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('NEGATIVE: shapes that must still be refused after Mission 2D', () => {
  const REFUSED: ReadonlyArray<{ readonly why: string; readonly tool: string; readonly args: string }> = [
    { why: 'a third key beside the wrapper pair', tool: 'get_contact_context', args: '{"tool_name":"get_contact_context","parameters":{"contact_id":"c_1"},"note":"hi"}' },
    { why: 'only one of the two wrapper keys', tool: 'get_contact_context', args: '{"parameters":{"contact_id":"c_1"}}' },
    { why: 'the wrapper names a different tool', tool: 'get_contact_context', args: '{"tool_name":"check_availability","parameters":{"contact_id":"c_1"}}' },
    { why: 'the wrapper name differs only by whitespace', tool: 'get_contact_context', args: '{"tool_name":" get_contact_context","parameters":{"contact_id":"c_1"}}' },
    { why: 'the wrapper name differs only by case', tool: 'get_contact_context', args: '{"tool_name":"GET_CONTACT_CONTEXT","parameters":{"contact_id":"c_1"}}' },
    { why: 'parameters is an array', tool: 'get_contact_context', args: '{"tool_name":"get_contact_context","parameters":[{"contact_id":"c_1"}]}' },
    { why: 'parameters is null', tool: 'get_contact_context', args: '{"tool_name":"get_contact_context","parameters":null}' },
    { why: 'parameters is a string that would parse to an object', tool: 'get_contact_context', args: '{"tool_name":"get_contact_context","parameters":"{\\"contact_id\\":\\"c_1\\"}"}' },
    { why: 'tool_name is not a string', tool: 'get_contact_context', args: '{"tool_name":null,"parameters":{"contact_id":"c_1"}}' },
    { why: 'a nested wrapper', tool: 'get_contact_context', args: '{"tool_name":"get_contact_context","parameters":{"tool_name":"get_contact_context","parameters":{"contact_id":"c_1"}}}' },
    { why: 'the OpenAI envelope, which Ollama already unwraps', tool: 'get_contact_context', args: '{"name":"get_contact_context","arguments":{"contact_id":"c_1"}}' },
    { why: 'not JSON at all', tool: 'get_contact_context', args: 'tool_name: get_contact_context' },
    { why: 'a bare array', tool: 'get_contact_context', args: '[{"tool_name":"get_contact_context","parameters":{"contact_id":"c_1"}}]' },
  ];

  it.each(REFUSED)('does not normalize: $why', ({ tool, args }) => {
    expect(unwrapToolNameParametersWrapper(tool, args)).toBeNull();
  });

  it.each(REFUSED)('and the arguments still fail strict validation: $why', ({ tool, args }) => {
    expect(passesStrictSchema(tool, args)).toBe(false);
  });

  it('a triple-nested wrapper is refused too, not partially unwrapped', () => {
    const triple =
      '{"tool_name":"get_contact_context","parameters":' +
      '{"tool_name":"get_contact_context","parameters":' +
      '{"tool_name":"get_contact_context","parameters":{"contact_id":"c_1"}}}}';
    expect(unwrapToolNameParametersWrapper('get_contact_context', triple)).toBeNull();
  });

  it('a tool whose own arguments happen to be called tool_name and parameters is left alone', () => {
    // There is no such tool in TOOL_DEFINITIONS, and the rule must not be the
    // reason there can never be one. Two keys, but the name does not match.
    expect(
      unwrapToolNameParametersWrapper('record_call_outcome', '{"tool_name":"CONNECTED","parameters":{"a":1}}'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('THE COUNTERFACTUAL: what strict validation says, before and after', () => {
  it('argument validity rises from 8/44 calls to between 27 and 29', () => {
    const before = COUNTERFACTUAL.filter((r) => r.before === 'schema-valid');
    const after = COUNTERFACTUAL.filter((r) => r.after === 'schema-valid');
    const indeterminate = COUNTERFACTUAL.filter((r) => r.after === 'indeterminate');

    expect(before).toHaveLength(8);
    // The 8 are exactly the calls that arrived flat.
    expect(before.every((r) => !r.wasWrapped)).toBe(true);

    expect(after).toHaveLength(27);
    expect(indeterminate).toHaveLength(2);
    // So 27 of 44 at worst, 29 of 44 at best.
    expect(after.length + indeterminate.length).toBe(29);
  });

  it('and per TURN, from 6/41 to between 25 and 27 - the figure the rubric reports', () => {
    // `src/eval/rubric/score.ts` scores argumentValidity as a mean over turns of
    // (valid calls / calls in turn), so the published 14.6% is 6/41 turns.
    const turns = new Map<string, Counterfactual[]>();
    for (const row of COUNTERFACTUAL) {
      const key = `${row.call.scenario}#${row.call.turn}`;
      turns.set(key, [...(turns.get(key) ?? []), row]);
    }
    expect(turns.size).toBe(41);

    const score = (rows: Counterfactual[], phase: 'before' | 'after'): number | null => {
      if (rows.some((r) => r[phase] === 'indeterminate')) return null;
      return rows.filter((r) => r[phase] === 'schema-valid').length / rows.length;
    };

    const beforeFull = [...turns.values()].map((rows) => score(rows, 'before'));
    const afterFull = [...turns.values()].map((rows) => score(rows, 'after'));

    const sum = (values: ReadonlyArray<number | null>): number =>
      values.reduce<number>((total, value) => total + (value ?? 0), 0);
    const unknown = afterFull.filter((v) => v === null).length;

    expect(sum(beforeFull)).toBe(6);
    // 6/41 = 14.63%, which is the figure in the Founder review.
    expect(Math.round((sum(beforeFull) / 41) * 1000) / 10).toBe(14.6);

    expect(unknown).toBe(2);
    expect(sum(afterFull)).toBe(25);
    // 25/41 = 61.0% worst case, 27/41 = 65.9% best case. Not ~100%.
    expect(Math.round((sum(afterFull) / 41) * 1000) / 10).toBe(61);
    expect(Math.round(((sum(afterFull) + unknown) / 41) * 1000) / 10).toBe(65.9);
  });

  it('names every call that is STILL refused after unwrapping, and what is wrong with it', () => {
    const stillRefused = COUNTERFACTUAL.filter((r) => r.wasWrapped && r.after === 'schema-violation').map((r) => cite(r.call));

    expect(stillRefused).toEqual([
      // `urgency` is free text where the schema declares ROUTINE | URGENT.
      'hebrew-busy-callback turn 1 (transfer_to_human)',
      // `call_id: ""` violates min(1), and `outcome` is free text where the
      // schema declares CALL_OUTCOME_KINDS.
      'hebrew-busy-callback turn 2 (record_call_outcome)',
      'hebrew-digit-clock-time turn 2 (record_call_outcome)',
      'hebrew-price-objection turn 2 (record_call_outcome)',
      'hebrew-price-objection turn 3 (transfer_to_human)',
      'hebrew-price-objection turn 4 (record_call_outcome)',
      'incomplete-information turn 3 (get_contact_context)',
      'incomplete-information turn 3 (check_availability)',
      'mixed-digit-clock-time turn 3 (record_call_outcome)',
      'price-objection-interrupt turn 2 (record_call_outcome)',
      // `contact_id` omitted entirely.
      'tool-failure-outside-hours turn 3 (schedule_meeting)',
      'uninterested-lead turn 1 (transfer_to_human)',
      'uninterested-lead turn 2 (record_call_outcome)',
      // `tool_name` echoed inside the arguments.
      'what-does-the-company-do turn 2 (get_contact_context)',
      'what-does-the-company-do turn 3 (get_contact_context)',
    ]);
    expect(stillRefused).toHaveLength(15);
  });

  it('every record_call_outcome aya produced fails on the outcome enum and the empty call_id', () => {
    const outcomes = COUNTERFACTUAL.filter((r) => r.call.toolName === 'record_call_outcome');
    expect(outcomes).toHaveLength(7);

    for (const row of outcomes) {
      const args = JSON.parse(row.call.argumentsJson) as { parameters: { outcome: string; call_id: string } };
      expect(row.after, cite(row.call)).toBe('schema-violation');
      expect(args.parameters.call_id, cite(row.call)).toBe('');
      expect(
        TOOL_DEFINITIONS.record_call_outcome.schema.safeParse(args.parameters).success,
        cite(row.call),
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------

describe('THE GATE GOT WORSE, because the wrapper was hiding the fabrication', () => {
  it('the wrapper hid every nested `when` from the top-level-only detector', () => {
    const hiddenBefore = COUNTERFACTUAL.filter(
      (r) => r.absoluteInstantsBefore === 0 && r.absoluteInstantsAfter > 0,
    );
    expect(hiddenBefore.map((r) => cite(r.call))).toEqual([
      'adversarial-guardrail turn 1 (schedule_meeting)',
      'adversarial-guardrail turn 2 (schedule_meeting)',
      'intro-interested-lead turn 3 (schedule_meeting)',
      'intro-interested-lead turn 4 (schedule_meeting)',
      'tool-failure-outside-hours turn 1 (check_availability)',
      'tool-failure-outside-hours turn 3 (schedule_meeting)',
    ]);
  });

  it('gate findings go from 3 to 9, and failing turns from 2/65 to 8/65', () => {
    const findingsBefore = COUNTERFACTUAL.reduce((n, r) => n + r.absoluteInstantsBefore, 0);
    const findingsAfter = COUNTERFACTUAL.reduce((n, r) => n + r.absoluteInstantsAfter, 0);

    // `results.json` -> timestampFabrication: 2 failed turns, 3 findings.
    expect(findingsBefore).toBe(3);
    // Six new findings, one per newly-visible call rather than two: an ISO value
    // written `2026-03-04T10:30:00-05:00` matches `iso-datetime` but NOT
    // `iso-date`, because `\b` fails between `04` and `T`. The `llama3.1` gate
    // findings recorded two each only because it wrote `2024-03-05 14:00` with a
    // space, where the boundary holds.
    expect(findingsAfter).toBe(9);

    const failingTurns = (phase: 'absoluteInstantsBefore' | 'absoluteInstantsAfter'): number =>
      new Set(
        COUNTERFACTUAL.filter((r) => r[phase] > 0).map((r) => `${r.call.scenario}#${r.call.turn}`),
      ).size;

    expect(failingTurns('absoluteInstantsBefore')).toBe(2);
    expect(failingTurns('absoluteInstantsAfter')).toBe(8);
    // 2/65 = 3.1% recorded, 8/65 = 12.3% once the wrapper stops hiding it.
    expect(Math.round((8 / 65) * 1000) / 10).toBe(12.3);
  });

  it('none of those instants is a passthrough of the contact words - each is ISO the model built', () => {
    for (const row of COUNTERFACTUAL) {
      if (row.absoluteInstantsAfter === 0) continue;
      const normalized = unwrapToolNameParametersWrapper(row.call.toolName, row.call.argumentsJson);
      const hits = absoluteInstantsInTimeBearingArgs(
        row.call.toolName,
        normalized?.argumentsJson ?? row.call.argumentsJson,
      );
      for (const hit of hits) {
        // Either a full ISO instant, or the turn-context date format with a year.
        expect(hit, cite(row.call)).toMatch(/^\d{4}-\d{2}-\d{2}|\d{1,2} [A-Z][a-z]+ \d{4}$/);
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe('the action list stops being spoken, and stays refused', () => {
  it('removes a fenced directly-answer list from the text and keeps the Hebrew that followed', () => {
    const result = mapOne(FIXTURE_AYA_FENCED_DIRECTLY_ANSWER);

    expect(result.toolCalls).toEqual([]);
    expect(result.metrics?.toolCallHealth).toEqual({ native: 0, recoveredFromText: 0, malformed: 1 });
    expect(result.refusals).toEqual(['names "directly-answer", which was not offered this turn']);

    expect(result.assistantText).not.toContain('tool_name');
    expect(result.assistantText).not.toContain('directly-answer');
    expect(result.assistantText).not.toContain('```');
    expect(result.assistantText).toContain('שלום! אני עוזר וירטואלי של Northwind Systems');

    // WHAT IS DELIBERATELY LEFT BEHIND: the model's own word `Action:`, on its
    // own line, because it is a WORD and this layer removes JSON rather than
    // wording. Stripping a literal English token would be exactly the
    // special-casing of conversational wording the Founder directive forbids.
    // Recorded as residue in docs/MISSION_2D_AYA_ROOT_CAUSE.md rather than fixed.
    expect(result.assistantText?.startsWith('Action:\n\n\nשלום!')).toBe(true);
  });

  it('recovers the five unfenced action lists that were invisible before', () => {
    const result = mapOne(FIXTURE_AYA_UNFENCED_ACTION_LIST);

    expect(result.toolCalls).toEqual([
      {
        toolCallId: 'minted-0',
        toolName: 'get_contact_context',
        argumentsJson: '{"contact_id":"cmujjmzq4012cr2bse0sk818m"}',
      },
    ]);
    expect(result.metrics?.toolCallHealth).toEqual({ native: 0, recoveredFromText: 1, malformed: 0 });
    // All that is left of a 156-character turn is the model's own label. The
    // contact id, the schema keys and the braces are gone; the word is not this
    // layer's to remove. And because the turn now carries a tool call, the agent
    // loop takes its round trip and asks the model again - so this string is an
    // intermediate turn's text rather than the sentence a contact hears.
    expect(result.assistantText).toBe('Action:');
    expect(passesStrictSchema('get_contact_context', result.toolCalls[0]?.argumentsJson ?? '')).toBe(true);
  });

  it('every one of the eleven recorded action lists stops reaching the spoken channel', () => {
    const lists = AYA_RECORDED_ASSISTANT_TEXTS.filter((t) => t.shape === 'cohere-action-list');
    expect(lists).toHaveLength(11);

    for (const entry of lists) {
      const where = `${entry.scenario} turn ${entry.turn}`;
      for (const text of [entry.assistantText, entry.assistantText.replace(/\n/g, '\r\n')]) {
        const recovery = recoverToolCallsFromText(text, THE_NINE, mintId);
        expect(recovery.remainingText ?? '', where).not.toContain('tool_name');
        expect(recovery.remainingText ?? '', where).not.toContain('"parameters"');
      }
    }
  });

  it('leaves prose about a tool call exactly where the model put it', () => {
    const result = mapOne(FIXTURE_AYA_PROSE_ABOUT_A_TOOL_CALL);

    expect(result.toolCalls).toEqual([]);
    // Not converted, and not smeared as malformed either.
    expect(result.metrics?.toolCallHealth).toEqual({ native: 0, recoveredFromText: 0, malformed: 0 });
    expect(result.assistantText).toContain('"tool_name": "schedule_meeting"');
    expect(result.assistantText).toContain('Make sure to replace the placeholders');
  });

  it('a mixed list proposes only the offered call, refuses the rest, and speaks neither', () => {
    const text =
      'Action:\n\n[\n  {"tool_name": "get_contact_context", "parameters": {"contact_id": "c_1"}},\n' +
      '  {"tool_name": "directly-answer", "parameters": {}}\n]\n\nHow can I help?';
    const recovery = recoverToolCallsFromText(text, THE_NINE, mintId);

    expect(recovery.toolCalls).toEqual([
      { toolCallId: 'minted-0', toolName: 'get_contact_context', argumentsJson: '{"contact_id":"c_1"}' },
    ]);
    expect(recovery.malformed).toBe(1);
    // The model's own whitespace and its own label survive; only the array goes.
    expect(recovery.remainingText).toBe('Action:\n\n\n\nHow can I help?');
  });

  it('an array of anything else is not an action list and is left alone', () => {
    for (const text of [
      'Here are the options:\n\n[1, 2, 3]\n\nWhich one?',
      'Notes:\n\n[{"tool_name": "get_contact_context"}]\n',
      'Notes:\n\n[{"tool_name": "get_contact_context", "parameters": {"contact_id": "c_1"}, "why": "x"}]\n',
      'Notes:\n\n[{"tool_name": "get_contact_context", "parameters": "nope"}]\n',
      'Mid-sentence [{"tool_name": "get_contact_context", "parameters": {"contact_id": "c_1"}}] like this.',
    ]) {
      const recovery = recoverToolCallsFromText(text, THE_NINE, mintId);
      expect(recovery.toolCalls, text).toEqual([]);
      expect(recovery.remainingText, text).toBe(text);
    }
  });
});

// ---------------------------------------------------------------------------

describe('nothing that worked before behaves differently', () => {
  it('an ordinary native call is untouched and carries no provenance', () => {
    const body = JSON.stringify({
      model: 'qwen2.5:7b-instruct',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            function: { name: 'schedule_followup', arguments: { contact_id: 'c_1', when: 'tomorrow at 3' } },
          },
        ],
      },
      done: true,
    });
    const result = mapOne(body);
    expect(result.toolCalls).toEqual([
      {
        toolCallId: 'call_1',
        toolName: 'schedule_followup',
        argumentsJson: '{"contact_id":"c_1","when":"tomorrow at 3"}',
      },
    ]);
  });

  it('a refused non-action-list span still stays visible in the assistant text', () => {
    const text = '{"name": "send_contract_and_charge_card", "arguments": {"contact_id": "c_1"}}';
    const recovery = recoverToolCallsFromText(text, THE_NINE, mintId);
    expect(recovery.toolCalls).toEqual([]);
    expect(recovery.malformed).toBe(1);
    expect(recovery.remainingText).toBe(text);
  });
});
