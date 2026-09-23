/**
 * Zod -> JSON Schema, for the subset the tool contract actually uses.
 *
 * WHY GENERATE RATHER THAN HAND-WRITE
 * ---------------------------------------------------------------------------
 * The model is told what a tool accepts by a JSON Schema; the dispatcher
 * decides what a tool accepts with a Zod schema. If those two are written
 * separately they drift, and the failure mode is nasty: the model faithfully
 * sends what it was told to send and gets a SCHEMA_VIOLATION for its trouble,
 * which looks like a model problem and is not. One source of truth removes the
 * category of bug.
 *
 * WHY NOT A LIBRARY
 * ---------------------------------------------------------------------------
 * A dependency would do this, but the supported surface here is deliberately
 * tiny - objects of scalars, enums, and arrays of scalars - and the output has
 * to be exactly what a function-calling API accepts, which general converters
 * are not always careful about (`additionalProperties: false` on every object,
 * no `$ref`, no `anyOf` where a plain type will do). Fifty lines we control and
 * test beats a dependency we would have to constrain anyway.
 *
 * HARD FAILURE ON ANYTHING ELSE
 * ---------------------------------------------------------------------------
 * An unsupported Zod construct throws. It does NOT emit `{}` and hope: an empty
 * schema tells the model "anything goes", which is precisely the loss of
 * control this whole layer exists to prevent.
 */
import { z } from 'zod';

import { InvariantViolationError } from '../../shared/errors.js';

/** A JSON Schema fragment. Plain data - serialized straight to the provider. */
export type JsonSchemaNode = Record<string, unknown>;

/**
 * Convert a Zod schema to a JSON Schema fragment.
 *
 * Supported: object, string (min/max/enum-like), number (int/min/max), boolean,
 * enum, literal (string/number/boolean), array, optional, nullable, default,
 * and `.refine()` wrappers (unwrapped - a refinement is a runtime rule the
 * model cannot see, and is enforced by Zod at dispatch time regardless).
 */
export function toJsonSchema(schema: z.ZodTypeAny): JsonSchemaNode {
  const node = convert(schema);
  const description = schema.description;
  if (description && node['description'] === undefined) {
    node['description'] = description;
  }
  return node;
}

/**
 * The top level of a tool's `parameters`: always an object, and always frozen.
 *
 * Frozen because the result is computed ONCE per tool and then handed to the
 * provider on every single request. A caller that sorted an array in place, or
 * "normalised" a field, would silently change what every future model turn is
 * told - and the drift would be invisible. Freezing turns that into an
 * immediate error at the point of the mistake.
 */
export function toToolParametersSchema(schema: z.ZodObject<z.ZodRawShape>): JsonSchemaNode {
  const node = toJsonSchema(schema);
  if (node['type'] !== 'object') {
    throw new InvariantViolationError('Tool parameters must be a Zod object schema.', {
      details: { produced: node['type'] },
    });
  }
  return deepFreeze(node);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepFreeze(entry);
  }
  return value;
}

// ---------------------------------------------------------------------------

function convert(schema: z.ZodTypeAny): JsonSchemaNode {
  const def = schema._def as { typeName?: string } & Record<string, unknown>;

  switch (def.typeName) {
    case 'ZodObject':
      return convertObject(schema as z.ZodObject<z.ZodRawShape>);

    case 'ZodString':
      return convertString(def);

    case 'ZodNumber':
      return convertNumber(def);

    case 'ZodBoolean':
      return { type: 'boolean' };

    case 'ZodEnum':
      return { type: 'string', enum: [...(def['values'] as readonly string[])] };

    case 'ZodNativeEnum':
      return { type: 'string', enum: Object.values(def['values'] as Record<string, string>) };

    case 'ZodLiteral':
      return { type: jsonTypeOf(def['value']), enum: [def['value']] };

    case 'ZodArray': {
      const items = toJsonSchema(def['type'] as z.ZodTypeAny);
      const node: JsonSchemaNode = { type: 'array', items };
      const minLength = (def['minLength'] as { value: number } | null)?.value;
      const maxLength = (def['maxLength'] as { value: number } | null)?.value;
      if (minLength !== undefined) node['minItems'] = minLength;
      if (maxLength !== undefined) node['maxItems'] = maxLength;
      return node;
    }

    case 'ZodOptional':
    case 'ZodDefault':
      // Optionality is expressed by absence from `required`, not by the node.
      return toJsonSchema(def['innerType'] as z.ZodTypeAny);

    case 'ZodNullable': {
      const inner = toJsonSchema(def['innerType'] as z.ZodTypeAny);
      const innerType = inner['type'];
      return typeof innerType === 'string' ? { ...inner, type: [innerType, 'null'] } : inner;
    }

    case 'ZodEffects':
      // `.refine()` / `.transform()`: describe the INPUT. The refinement still
      // runs at dispatch; the model just cannot see it, which is honest.
      return toJsonSchema(def['schema'] as z.ZodTypeAny);

    default:
      throw new InvariantViolationError(
        `Unsupported Zod construct "${String(def.typeName)}" in a tool schema. ` +
          'Emitting an empty schema would tell the model that anything is acceptable, which is exactly ' +
          'what this layer exists to prevent - so add explicit support here instead.',
        { details: { typeName: def.typeName } },
      );
  }
}

function convertObject(schema: z.ZodObject<z.ZodRawShape>): JsonSchemaNode {
  const properties: Record<string, JsonSchemaNode> = {};
  const required: string[] = [];

  // `additionalProperties` must report what Zod will ACTUALLY do, not what we
  // would like it to do. A plain `z.object` STRIPS unknown keys; only
  // `.strict()` rejects them. Emitting `false` for a stripping schema would
  // tell the model its invented argument was refused when in fact it was
  // silently dropped - the exact failure this layer exists to prevent.
  // `define()` in `definitions.ts` calls `.strict()` on every tool schema, so
  // every tool is closed and this reads `false`.
  const unknownKeys = (schema._def as { unknownKeys?: string }).unknownKeys;
  const additionalProperties = unknownKeys === 'strict' ? false : true;

  // `Object.entries` on a Zod shape preserves declaration order, so the schema
  // the model sees lists arguments in the order they were written. Two builds
  // of the same schema are therefore byte-identical.
  for (const [key, value] of Object.entries(schema.shape)) {
    const field = value as z.ZodTypeAny;
    properties[key] = toJsonSchema(field);
    if (!field.isOptional()) {
      required.push(key);
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties,
  };
}

interface ZodCheck {
  readonly kind: string;
  readonly value?: number;
}

function convertString(def: Record<string, unknown>): JsonSchemaNode {
  const node: JsonSchemaNode = { type: 'string' };
  for (const check of (def['checks'] as ZodCheck[] | undefined) ?? []) {
    if (check.kind === 'min' && check.value !== undefined) node['minLength'] = check.value;
    if (check.kind === 'max' && check.value !== undefined) node['maxLength'] = check.value;
  }
  return node;
}

function convertNumber(def: Record<string, unknown>): JsonSchemaNode {
  const node: JsonSchemaNode = { type: 'number' };
  for (const check of (def['checks'] as ZodCheck[] | undefined) ?? []) {
    if (check.kind === 'int') node['type'] = 'integer';
    if (check.kind === 'min' && check.value !== undefined) node['minimum'] = check.value;
    if (check.kind === 'max' && check.value !== undefined) node['maximum'] = check.value;
  }
  return node;
}

function jsonTypeOf(value: unknown): string {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  throw new InvariantViolationError(`Unsupported literal type in a tool schema: ${typeof value}`);
}
