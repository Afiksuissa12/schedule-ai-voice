/**
 * The tool contract, tested as a contract.
 *
 * The property that matters most here is that the JSON Schema the MODEL is
 * given and the Zod schema the DISPATCHER enforces cannot disagree. When they
 * drift, the model faithfully sends what it was told to send and is refused for
 * it - a bug that looks like a model problem and is not. So the JSON Schema is
 * generated from the Zod schema, and these tests check the generator.
 */
import { describe, expect, it } from 'vitest';

import { z } from 'zod';

import {
  ALL_TOOL_DEFINITIONS,
  findToolDefinition,
  isToolName,
  llmToolDefinitions,
  TOOL_DEFINITIONS,
  TOOL_NAMES,
} from '../../src/agent/tools/definitions.js';
import { toJsonSchema, toToolParametersSchema } from '../../src/agent/tools/jsonSchema.js';
import { TOOL_HANDLERS } from '../../src/agent/tools/handlers.js';
import { InvariantViolationError } from '../../src/shared/errors.js';

describe('the nine tools', () => {
  it('are exactly the Founder-named set, with no extras and no gaps', () => {
    expect(TOOL_NAMES).toHaveLength(9);
    expect([...TOOL_NAMES].sort()).toEqual([
      'cancel_meeting',
      'check_availability',
      'get_contact_context',
      'record_call_outcome',
      'reschedule_meeting',
      'schedule_followup',
      'schedule_meeting',
      'transfer_to_human',
      'update_qualification',
    ]);
  });

  it('each has a definition, a handler, and a real description', () => {
    for (const name of TOOL_NAMES) {
      const definition = TOOL_DEFINITIONS[name];
      expect(definition.name).toBe(name);
      // A one-word description gets a tool called at the wrong moment.
      expect(definition.description.length).toBeGreaterThan(60);
      expect(TOOL_HANDLERS[name]).toBeTypeOf('function');
    }
  });

  it('every time-bearing tool takes the contact’s words, never a timestamp', () => {
    const timeBearing = ALL_TOOL_DEFINITIONS.filter((tool) => tool.timeBearing);
    expect(timeBearing.map((tool) => tool.name).sort()).toEqual([
      'check_availability',
      'reschedule_meeting',
      'schedule_followup',
      'schedule_meeting',
    ]);

    for (const tool of timeBearing) {
      const schema = tool.parametersJsonSchema as Record<string, unknown>;
      const properties = schema['properties'] as Record<string, Record<string, unknown>>;
      const when = properties[tool.timeBearing!.rawField]!;

      expect(when['type']).toBe('string');
      // The description is what actually stops a model doing date arithmetic.
      expect(String(when['description'])).toContain('OWN WORDS');
      expect(String(when['description'])).toContain('Do NOT convert');
    }
  });

  it('checks availability for meetings and NOT for callbacks', () => {
    // A meeting occupies a slot; a callback does not. Refusing to phone someone
    // because their diary is full would be wrong, so this asymmetry is asserted
    // rather than left to be noticed.
    expect(TOOL_DEFINITIONS.schedule_meeting.timeBearing?.checkAvailability).toBe(true);
    expect(TOOL_DEFINITIONS.schedule_followup.timeBearing?.checkAvailability).toBe(false);
    expect(TOOL_DEFINITIONS.schedule_followup.timeBearing?.checkBusinessHours).toBe(true);
  });

  it('marks which tools can change persisted state', () => {
    const readOnly = ALL_TOOL_DEFINITIONS.filter((tool) => !tool.mutatesState).map((tool) => tool.name);
    expect(readOnly.sort()).toEqual(['check_availability', 'get_contact_context']);
  });

  it('offers the model only the tools the configuration permits', () => {
    const offered = llmToolDefinitions(['schedule_followup', 'get_contact_context', 'not_a_tool']);
    expect(offered.map((tool) => tool.name)).toEqual(['get_contact_context', 'schedule_followup']);
    expect(llmToolDefinitions([])).toEqual([]);
  });

  it('recognises its own names and nothing else', () => {
    expect(isToolName('schedule_followup')).toBe(true);
    expect(isToolName('schedule_follow_up')).toBe(false);
    expect(findToolDefinition('send_contract')).toBeUndefined();
  });
});

describe('the generated JSON Schema', () => {
  it('closes every tool schema, and Zod agrees', () => {
    for (const tool of ALL_TOOL_DEFINITIONS) {
      const schema = tool.parametersJsonSchema as Record<string, unknown>;
      expect(schema['type']).toBe('object');
      // Told to the model...
      expect(schema['additionalProperties'], `${tool.name} is not closed`).toBe(false);
      // ...and actually enforced. A stripping schema would report success for
      // an invented argument, which is the drift this pairing exists to stop.
      const parsed = tool.schema.safeParse({ contact_id: 'x', when: 'tomorrow at 3pm', invented_key: true });
      expect(parsed.success, `${tool.name} silently accepted an invented key`).toBe(false);
    }
  });

  it('marks optional arguments optional and required arguments required', () => {
    const followup = TOOL_DEFINITIONS.schedule_followup.parametersJsonSchema as Record<string, unknown>;
    expect(followup['required']).toEqual(['contact_id', 'when']);

    const properties = followup['properties'] as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(['contact_id', 'when', 'timezone', 'reason', 'action_type']);
  });

  it('renders enums, integers with bounds, arrays and nested objects', () => {
    const outcome = TOOL_DEFINITIONS.record_call_outcome.parametersJsonSchema as Record<string, unknown>;
    const outcomeProperty = (outcome['properties'] as Record<string, Record<string, unknown>>)['outcome']!;
    expect(outcomeProperty['type']).toBe('string');
    expect(outcomeProperty['enum']).toContain('VOICEMAIL');

    const meeting = TOOL_DEFINITIONS.schedule_meeting.parametersJsonSchema as Record<string, unknown>;
    const duration = (meeting['properties'] as Record<string, Record<string, unknown>>)['duration_minutes']!;
    expect(duration['type']).toBe('integer');
    expect(duration['minimum']).toBe(5);
    expect(duration['maximum']).toBe(480);

    const qualification = TOOL_DEFINITIONS.update_qualification.parametersJsonSchema as Record<string, unknown>;
    const observations = (qualification['properties'] as Record<string, Record<string, unknown>>)['observations']!;
    expect(observations['type']).toBe('array');
    const items = observations['items'] as Record<string, unknown>;
    expect(items['type']).toBe('object');
    expect(items['additionalProperties']).toBe(false);
    expect([...(items['required'] as string[])].sort()).toEqual(['evidence', 'factor', 'value']);
  });

  it('is deterministic and serializable', () => {
    for (const tool of ALL_TOOL_DEFINITIONS) {
      const again = toToolParametersSchema(tool.schema);
      expect(JSON.stringify(again)).toBe(JSON.stringify(tool.parametersJsonSchema));
    }
  });

  it('is frozen, so nothing can quietly rewrite what every model turn is told', () => {
    const followup = TOOL_DEFINITIONS.schedule_followup.parametersJsonSchema as Record<string, unknown>;
    expect(Object.isFrozen(followup)).toBe(true);
    expect(Object.isFrozen(followup['properties'])).toBe(true);
    expect(Object.isFrozen(followup['required'])).toBe(true);
    // In an ES module (strict mode) a write to a frozen object throws, which
    // is the point: the mistake surfaces where it is made.
    expect(() => {
      (followup as { additionalProperties: boolean }).additionalProperties = true;
    }).toThrow();
  });

  it('reports `additionalProperties: true` for a schema that really does strip', () => {
    // Honesty over aspiration: a plain `z.object` strips unknown keys, so the
    // schema must say so rather than claiming a closure it does not enforce.
    const lenient = toJsonSchema(z.object({ a: z.string() }));
    expect(lenient['additionalProperties']).toBe(true);

    const strict = toJsonSchema(z.object({ a: z.string() }).strict());
    expect(strict['additionalProperties']).toBe(false);
  });

  it('refuses to describe a construct it does not support', () => {
    // An empty schema would tell the model "anything goes", which is precisely
    // the loss of control this layer exists to prevent. So: throw.
    expect(() => toJsonSchema(z.map(z.string(), z.string()))).toThrow(InvariantViolationError);
    expect(() => toJsonSchema(z.union([z.string(), z.number()]))).toThrow(/Unsupported Zod construct/);
  });

  it('unwraps optional, default, nullable and refined wrappers', () => {
    expect(toJsonSchema(z.string().optional())['type']).toBe('string');
    expect(toJsonSchema(z.number().int().default(3))['type']).toBe('integer');
    expect(toJsonSchema(z.string().nullable())['type']).toEqual(['string', 'null']);
    expect(toJsonSchema(z.string().refine(() => true))['type']).toBe('string');
    expect(toJsonSchema(z.literal('CALL_CONTACT'))).toEqual({ type: 'string', enum: ['CALL_CONTACT'] });
  });

  it('carries every argument description through to the model', () => {
    for (const tool of ALL_TOOL_DEFINITIONS) {
      const properties = (tool.parametersJsonSchema as Record<string, unknown>)['properties'] as Record<
        string,
        Record<string, unknown>
      >;
      for (const [key, property] of Object.entries(properties)) {
        expect(property['description'], `${tool.name}.${key} has no description`).toBeTypeOf('string');
      }
    }
  });
});
