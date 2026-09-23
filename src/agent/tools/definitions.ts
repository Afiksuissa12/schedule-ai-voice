/**
 * THE TOOL CONTRACT: the complete, closed set of things the model can ask for.
 *
 * All nine Founder-named tools are here, every one fully specified with an
 * explicit Zod schema and a generated JSON Schema. There is no tenth tool and
 * no free-form escape hatch, because "the model can do anything the prompt
 * allows" is the exact design this architecture exists to replace.
 *
 * THE SHAPE OF AN ARGUMENT IS A DESIGN DECISION
 * ---------------------------------------------------------------------------
 * Every time-bearing tool takes `when` as a STRING OF THE CONTACT'S OWN WORDS -
 * "tomorrow afternoon at 3" - and not a resolved timestamp. That is deliberate
 * and it is the most important thing on this page:
 *
 *  - A model that converts "tomorrow at 3" to an instant has to know today's
 *    date, the contact's zone, and whether a DST transition falls in between.
 *    It will get that wrong eventually, and silently.
 *  - Application code can do it correctly every time, and - crucially - can
 *    write down exactly how it did it in `ValidationProvenance`.
 *  - The audit trail then records what the person actually SAID, which is the
 *    thing an auditor asking "why did you call them then?" needs to see.
 *
 * `timezone` is accepted but should be omitted: the contact's persisted zone is
 * the right default, and overriding it is only correct when the contact said so
 * ("I'm in Denver this week"). `TimeBearing.timezoneField` tells the dispatcher
 * where to find it.
 *
 * WHAT A `ToolDefinition` GIVES THE DISPATCHER
 * ---------------------------------------------------------------------------
 * Enough to police the call generically, without a switch statement per tool:
 * how to find the subject (`subject`), whether a datetime needs deterministic
 * validation before execution (`timeBearing`), and whether it can change
 * persisted state (`mutatesState`). Adding a tool means adding data here, not
 * adding a branch in the chokepoint.
 */
import { z } from 'zod';

import { CALL_OUTCOME_KINDS, FUTURE_ACTION_TYPES } from '../../domain/enums.js';
import { toToolParametersSchema, type JsonSchemaNode } from './jsonSchema.js';
import { RubricObservationSchema } from './qualificationRubric.js';

/** The nine names. This array IS the contract. */
export const TOOL_NAMES = [
  'get_contact_context',
  'check_availability',
  'schedule_meeting',
  'reschedule_meeting',
  'cancel_meeting',
  'schedule_followup',
  'update_qualification',
  'record_call_outcome',
  'transfer_to_human',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Shared argument fragments, so "how do I name a contact" has one answer.
// ---------------------------------------------------------------------------

const contactIdArg = z
  .string()
  .trim()
  .min(1)
  .describe(
    'The contact id given to you in this call. Use it exactly; never invent, shorten, or guess an id. ' +
      'A call naming any other contact is refused.',
  );

const whenArg = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe(
    "The time in the CONTACT'S OWN WORDS, e.g. \"tomorrow afternoon at 3\", \"next Tuesday at 10am\". " +
      'Do NOT convert it to a date or a timestamp - the application resolves it against their timezone, ' +
      'daylight saving, and the booking policy, and records how it did so. If they were vague, ask them ' +
      'rather than sending a guess.',
  );

const timezoneArg = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe(
    'Optional IANA timezone override, e.g. "America/Denver". Omit this unless the contact told you they ' +
      'are somewhere other than their usual location - their recorded timezone is used by default.',
  );

const durationArg = z
  .number()
  .int()
  .min(5)
  .max(480)
  .optional()
  .describe('Meeting length in minutes. Omit to use the configured default.');

const reasonArg = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .optional()
  .describe('Why, in one short sentence. Shown to the human who reviews this later.');

// ---------------------------------------------------------------------------
// The nine schemas.
// ---------------------------------------------------------------------------

export const GetContactContextArgsSchema = z.object({
  contact_id: contactIdArg,
});

export const CheckAvailabilityArgsSchema = z.object({
  contact_id: contactIdArg,
  when: whenArg,
  duration_minutes: durationArg,
  timezone: timezoneArg,
});

export const ScheduleMeetingArgsSchema = z.object({
  contact_id: contactIdArg,
  when: whenArg,
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('Short subject line for the calendar entry, e.g. "Intro call - Acme".'),
  duration_minutes: durationArg,
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .describe('Optional agenda. What the two of you agreed this meeting is for.'),
  timezone: timezoneArg,
});

export const RescheduleMeetingArgsSchema = z.object({
  meeting_id: z
    .string()
    .trim()
    .min(1)
    .describe('The id of an existing meeting, as returned by a previous tool result. Never invent one.'),
  when: whenArg,
  duration_minutes: durationArg,
  timezone: timezoneArg,
  reason: reasonArg,
});

export const CancelMeetingArgsSchema = z.object({
  meeting_id: z
    .string()
    .trim()
    .min(1)
    .describe('The id of an existing meeting, as returned by a previous tool result. Never invent one.'),
  reason: reasonArg,
});

export const ScheduleFollowupArgsSchema = z.object({
  contact_id: contactIdArg,
  when: whenArg,
  timezone: timezoneArg,
  reason: reasonArg,
  action_type: z
    .enum(FUTURE_ACTION_TYPES)
    .optional()
    .describe(
      'What the follow-up should be. Only CALL_CONTACT is carried out; anything else is recorded as ' +
        'refused rather than quietly dropped. Omit it to schedule a call back.',
    ),
});

export const UpdateQualificationArgsSchema = z.object({
  contact_id: contactIdArg,
  observations: z
    .array(RubricObservationSchema)
    .max(20)
    .optional()
    .describe(
      'What you actually heard, one entry per rubric dimension, each with the contact’s own words as ' +
        'evidence. The application computes the score from these - this is the input that matters.',
    ),
  proposed_score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe(
      'Your overall impression, 0-100. ADVISORY ONLY: it is recorded, but the stored score is computed ' +
        'from the observations and then capped by policy. It cannot raise the result.',
    ),
  is_decision_maker: z
    .boolean()
    .optional()
    .describe(
      'Set this only when the contact told you plainly whether they can sign. It updates the CRM record. ' +
        'It is not a way to lift the score cap - the cap is applied from the saved record afterwards.',
    ),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .describe('Anything a salesperson reading this later would want to know.'),
});

export const RecordCallOutcomeArgsSchema = z.object({
  contact_id: contactIdArg,
  outcome: z
    .enum(CALL_OUTCOME_KINDS)
    .describe('How this call actually ended. Record what happened, not what you hoped would happen.'),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .describe('One or two sentences a colleague could pick the thread up from.'),
  call_id: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('The id of an existing call record, if you were given one. Omit it otherwise.'),
});

export const TransferToHumanArgsSchema = z.object({
  contact_id: contactIdArg,
  reason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe('Why a person is needed. The colleague who picks this up reads exactly this.'),
  urgency: z
    .enum(['ROUTINE', 'URGENT'])
    .optional()
    .describe('URGENT when the contact is upset or the matter is legal, contractual, or about money.'),
  summary: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .describe('What has been discussed so far, so the contact does not have to repeat themselves.'),
});

// ---------------------------------------------------------------------------
// Definitions.
// ---------------------------------------------------------------------------

/** How the dispatcher works out which rows this call is about. */
export type ToolSubject =
  /** `contact_id` must be THIS conversation's contact. */
  | { readonly kind: 'contact'; readonly field: 'contact_id' }
  /** `meeting_id` must exist and belong to this conversation's contact. */
  | { readonly kind: 'meeting'; readonly field: 'meeting_id' };

/** Where the datetime is, and which deterministic checks must run on it. */
export interface TimeBearing {
  readonly rawField: string;
  readonly timezoneField?: string;
  readonly durationField?: string;
  readonly checkBusinessHours: boolean;
  /**
   * Whether the AvailabilityProvider is consulted. False for a callback: a busy
   * diary is not a reason to refuse to phone someone, and that asymmetry is a
   * product decision worth being explicit about.
   */
  readonly checkAvailability: boolean;
}

export interface ToolDefinition {
  readonly name: ToolName;
  readonly description: string;
  readonly schema: z.ZodObject<z.ZodRawShape>;
  /** Generated from `schema`. One source of truth - see `jsonSchema.ts`. */
  readonly parametersJsonSchema: JsonSchemaNode;
  readonly subject: ToolSubject;
  readonly timeBearing?: TimeBearing;
  /** True when a successful call writes a domain row. Drives audit wording. */
  readonly mutatesState: boolean;
}

/**
 * Build a definition, and CLOSE its schema.
 *
 * `.strict()` is applied centrally rather than per schema, so no tool can be
 * added that forgets it. The difference matters: a plain `z.object` silently
 * STRIPS an argument the model invented, which means a model that sends
 * `{"when": "...", "skip_validation": true}` gets a cheerful success and never
 * learns that its second argument was meaningless. With `.strict()` it gets a
 * SCHEMA_VIOLATION naming the offending key. The generated JSON Schema reads
 * `unknownKeys` off the Zod schema, so the two can never disagree.
 */
function define(definition: Omit<ToolDefinition, 'parametersJsonSchema'>): ToolDefinition {
  const schema = definition.schema.strict();
  return { ...definition, schema, parametersJsonSchema: toToolParametersSchema(schema) };
}

export const TOOL_DEFINITIONS: Record<ToolName, ToolDefinition> = {
  get_contact_context: define({
    name: 'get_contact_context',
    description:
      'Look up what is actually recorded about this contact: their name, timezone, whether they can ' +
      'sign, their qualification, and any meetings or callbacks already arranged. Use this instead of ' +
      'relying on memory - it returns saved facts only, never anything said earlier in this call.',
    schema: GetContactContextArgsSchema,
    subject: { kind: 'contact', field: 'contact_id' },
    mutatesState: false,
  }),

  check_availability: define({
    name: 'check_availability',
    description:
      'Check whether a specific time is actually free before you offer it. You cannot see the diary; ' +
      'this is the only way to find out. Nothing is booked by calling this.',
    schema: CheckAvailabilityArgsSchema,
    subject: { kind: 'contact', field: 'contact_id' },
    timeBearing: {
      rawField: 'when',
      timezoneField: 'timezone',
      durationField: 'duration_minutes',
      checkBusinessHours: true,
      checkAvailability: true,
    },
    mutatesState: false,
  }),

  schedule_meeting: define({
    name: 'schedule_meeting',
    description:
      'Book a meeting at a time the contact has agreed to. The time is validated and the meeting is ' +
      'saved before this returns; only then is it true to say it is in the diary. If it comes back ' +
      'refused, nothing was booked.',
    schema: ScheduleMeetingArgsSchema,
    subject: { kind: 'contact', field: 'contact_id' },
    timeBearing: {
      rawField: 'when',
      timezoneField: 'timezone',
      durationField: 'duration_minutes',
      checkBusinessHours: true,
      checkAvailability: true,
    },
    mutatesState: true,
  }),

  reschedule_meeting: define({
    name: 'reschedule_meeting',
    description:
      'Move an existing meeting to a new time the contact has agreed to. The new time goes through the ' +
      'same checks as the original booking.',
    schema: RescheduleMeetingArgsSchema,
    subject: { kind: 'meeting', field: 'meeting_id' },
    timeBearing: {
      rawField: 'when',
      timezoneField: 'timezone',
      durationField: 'duration_minutes',
      checkBusinessHours: true,
      checkAvailability: true,
    },
    mutatesState: true,
  }),

  cancel_meeting: define({
    name: 'cancel_meeting',
    description:
      'Cancel an existing meeting. Use this when the contact says they cannot make it and does not want ' +
      'to pick a new time right now.',
    schema: CancelMeetingArgsSchema,
    subject: { kind: 'meeting', field: 'meeting_id' },
    mutatesState: true,
  }),

  schedule_followup: define({
    name: 'schedule_followup',
    description:
      'Promise to call the contact back at a specific time. This saves a durable callback that will ' +
      'happen whether or not this conversation is ever resumed - so only call it when you have actually ' +
      'agreed a time with them.',
    schema: ScheduleFollowupArgsSchema,
    subject: { kind: 'contact', field: 'contact_id' },
    timeBearing: {
      rawField: 'when',
      timezoneField: 'timezone',
      checkBusinessHours: true,
      // A callback does not occupy a calendar slot. See FutureActionService.
      checkAvailability: false,
    },
    mutatesState: true,
  }),

  update_qualification: define({
    name: 'update_qualification',
    description:
      'Record what you learned about whether this is a real opportunity. Supply the evidence; the score ' +
      'and the band are computed and stored by the application, under rules you do not control.',
    schema: UpdateQualificationArgsSchema,
    subject: { kind: 'contact', field: 'contact_id' },
    mutatesState: true,
  }),

  record_call_outcome: define({
    name: 'record_call_outcome',
    description:
      'Record how this call ended - connected, voicemail, wrong number, and so on - so the next person ' +
      'to pick this contact up knows what happened.',
    schema: RecordCallOutcomeArgsSchema,
    subject: { kind: 'contact', field: 'contact_id' },
    mutatesState: true,
  }),

  transfer_to_human: define({
    name: 'transfer_to_human',
    description:
      'Hand this conversation to a person. Use it when they ask for one, when they are upset, when the ' +
      'matter is legal, contractual or about money, or when you have had to refuse the same request ' +
      'twice. This creates a real task for a colleague.',
    schema: TransferToHumanArgsSchema,
    subject: { kind: 'contact', field: 'contact_id' },
    mutatesState: true,
  }),
};

/** Every definition, in the canonical `TOOL_NAMES` order. */
export const ALL_TOOL_DEFINITIONS: readonly ToolDefinition[] = TOOL_NAMES.map((name) => TOOL_DEFINITIONS[name]);

export function findToolDefinition(name: string): ToolDefinition | undefined {
  return isToolName(name) ? TOOL_DEFINITIONS[name] : undefined;
}

/**
 * The tool list handed to the LLM, filtered to what the configuration permits.
 *
 * Filtering here is a courtesy to the model, not the control: the dispatcher
 * re-checks `allowedToolsJson` on every call, because a model can always name a
 * tool it was never offered.
 */
export function llmToolDefinitions(allowedToolNames: readonly string[]): {
  name: string;
  description: string;
  parametersJsonSchema: unknown;
}[] {
  const allowed = new Set(allowedToolNames);
  return ALL_TOOL_DEFINITIONS.filter((tool) => allowed.has(tool.name)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parametersJsonSchema,
  }));
}
