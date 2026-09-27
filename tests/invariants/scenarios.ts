/**
 * THE SCENARIO MATRIX.
 *
 * `generateScenarios()` crosses the axes in `dimensions.ts` into a corpus of
 * several hundred distinct, fully-specified cases. It is a PURE FUNCTION of
 * those constants: no clock, no randomness beyond `SWEEP_SEED`, no environment,
 * no I/O. Call it twice and you get the same array, in the same order, with the
 * same ids - which is what makes a failure reproducible by scenario id alone.
 *
 * WHY FAMILIES AND NOT ONE BIG CARTESIAN PRODUCT
 * ---------------------------------------------------------------------------
 * Crossing every axis with every other would be 5 zones x 10 instants x 35
 * expressions x 4 policies x 4 availability states x 6 tool shapes = well over
 * a million cases, which is not thoroughness, it is a way of running the same
 * three code paths a million times. Instead the corpus is a set of named
 * FAMILIES, each of which crosses the axes that actually interact for the
 * question it asks, and holds the rest at a documented baseline. Every axis the
 * mission names is exhaustively crossed in at least one family.
 *
 * Family L, added by the locale work, goes one step further and declares its own
 * zone and `now` axes rather than widening the shared ones. That is a DELIBERATE
 * BOUND with a stated cost - see the comment above `LOCALE_ZONES` in
 * `dimensions.ts` and the matching entry in `KNOWN_COVERAGE_GAPS`.
 *
 * `docs/ARCHITECTURE.md` and the `qa:sweep` report both name these families, so
 * coverage - and the gaps in it - can be read off rather than inferred.
 */
import {
  ASSERTED_TIMEZONES,
  AVAILABILITY_PROBE_EXPRESSION,
  AVAILABILITY_PROBE_MINUTES,
  AVAILABILITY_STATES,
  LEAD_TIME_BOUNDARY_CASES,
  LEAD_TIME_BOUNDARY_ZONE,
  LEAD_TIME_EXPRESSIONS,
  LOCALE_NOW_INSTANTS,
  LOCALE_PARITY_PAIRS,
  LOCALE_ZONES,
  NOW_INSTANTS,
  OVERRIDE_PROBE_EXPRESSION,
  POLICIES,
  REJECTED_EXPRESSIONS,
  RELEASE_PROBE_EXPRESSION,
  RELEASE_SPECS,
  RELEASE_ZONES,
  seededRandom,
  SWEEP_SEED,
  TIMEZONE_OVERRIDE_CASES,
  TIMEZONES,
  VALID_EXPRESSIONS,
  type AvailabilityDimension,
  type Direction,
  type ExpressionDimension,
  type LocaleParityPair,
  type NowDimension,
  type PolicyDimension,
  type ReleaseSpec,
  type TimezoneDimension,
} from './dimensions.js';

/** Replaced with the SEEDED contact's real id just before dispatch. */
export const CONTACT_ID_SENTINEL = '@contactId';

/**
 * How a scenario's tool arguments are produced.
 *
 * `raw` exists because a real model emits a STRING, and some of the most
 * valuable scenarios in this sweep are ones where that string is not JSON at
 * all. Serialising an object would make those cases impossible to express.
 */
export type ArgsSpec =
  | { readonly kind: 'object'; readonly value: Record<string, unknown> }
  | { readonly kind: 'raw'; readonly text: string };

export interface ScenarioWorld {
  readonly contactTimezone: string;
  readonly businessHoursStartLocal: string;
  readonly businessHoursEndLocal: string;
  readonly minLeadTimeMinutes: number;
  readonly maxSchedulingHorizonDays: number;
  readonly allowedTools?: readonly string[];
  readonly contactIsDecisionMaker: boolean;
}

export type FamilyKey =
  | 'A-followup-matrix'
  | 'B-meeting-matrix'
  | 'C-rejection-matrix'
  | 'D-dst-edges'
  | 'E-policy-matrix'
  | 'F-availability-matrix'
  | 'G-malformed-calls'
  | 'H-idempotency-replay'
  | 'I-qualification-cap'
  | 'J-timezone-override'
  | 'K-lead-time-boundary'
  | 'L-locale-parity'
  | 'M-claim-release';

/**
 * The other half of a translated pair, carried on the scenario so that a
 * per-scenario invariant can state a relation between two inputs.
 *
 * `INV-16` is the only consumer. It is on the `Scenario` rather than looked up
 * from `dimensions.ts` so that a failure message can quote both sides without
 * the invariant having to know how family L was generated.
 */
export interface ParitySpec {
  /** The `LocaleParityPair` key, for the failure message. */
  readonly key: string;
  /** Which side of the pair THIS scenario is. */
  readonly side: 'he' | 'en';
  /** The `when` the other side of the pair would have used. */
  readonly counterpartRaw: string;
  /** False for a pair that is a faithful translation and still differs. */
  readonly identical: boolean;
  /** Required when `identical` is false; quoted in the report. */
  readonly whyNotIdentical?: string;
}

export interface Scenario {
  /** Stable across runs and across machines. Quoted in every failure message. */
  readonly id: string;
  readonly family: FamilyKey;
  readonly nowUtc: string;
  readonly world: ScenarioWorld;
  readonly availability: AvailabilityDimension;
  /** What the contact is taken to have said. Recorded as UTTERANCE_RECEIVED. */
  readonly utterance: string;
  readonly toolName: string;
  readonly args: ArgsSpec;
  /** Dispatch the SAME turn twice, to probe idempotency. */
  readonly replay: boolean;
  readonly direction: Direction;
  /** Set only by family L: the translated counterpart of this scenario's `when`. */
  readonly parity?: ParitySpec;
  /**
   * What the agent SAYS, for the scenarios that say something material.
   *
   * Absent on families A-L, and that absence is load-bearing: `runner.ts` falls
   * back to the one neutral sentence those families have always used, so adding
   * this field moved no existing scenario's behaviour at all. INV-18 is the only
   * consumer, and it is on the `Scenario` for the same reason `parity` is - so a
   * failure message can quote what the spec declared without the invariant
   * having to know how family M was generated.
   */
  readonly release?: ReleaseSpec;
  /** Axis values, for the coverage table in the report. */
  readonly labels: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------

function worldFrom(timezone: TimezoneDimension, policy: PolicyDimension, isDecisionMaker = true): ScenarioWorld {
  return {
    contactTimezone: timezone.zone,
    businessHoursStartLocal: policy.businessHoursStartLocal,
    businessHoursEndLocal: policy.businessHoursEndLocal,
    minLeadTimeMinutes: policy.minLeadTimeMinutes,
    maxSchedulingHorizonDays: policy.maxSchedulingHorizonDays,
    ...(policy.allowedTools ? { allowedTools: policy.allowedTools } : {}),
    contactIsDecisionMaker: isDecisionMaker,
  };
}

const DEFAULT_POLICY = POLICIES[0] as PolicyDimension;
const FREE_DIARY = AVAILABILITY_STATES[0] as AvailabilityDimension;
const BASELINE_NOW = NOW_INSTANTS[0] as NowDimension;

function followupArgs(raw: string, reason = 'agreed callback', timezone?: string): ArgsSpec {
  return {
    kind: 'object',
    value: {
      contact_id: CONTACT_ID_SENTINEL,
      when: raw,
      reason,
      ...(timezone === undefined ? {} : { timezone }),
    },
  };
}

function meetingArgs(raw: string, durationMinutes?: number, timezone?: string): ArgsSpec {
  return {
    kind: 'object',
    value: {
      contact_id: CONTACT_ID_SENTINEL,
      when: raw,
      title: 'Intro call - Northwind',
      ...(durationMinutes === undefined ? {} : { duration_minutes: durationMinutes }),
      ...(timezone === undefined ? {} : { timezone }),
    },
  };
}

/** The same call shape for either scheduling tool, so a family can cross tools. */
function schedulingArgs(tool: 'schedule_followup' | 'schedule_meeting', raw: string, timezone?: string): ArgsSpec {
  return tool === 'schedule_meeting'
    ? meetingArgs(raw, undefined, timezone)
    : followupArgs(raw, 'agreed callback', timezone);
}

function availabilityArgs(raw: string, durationMinutes: number): ArgsSpec {
  return {
    kind: 'object',
    value: { contact_id: CONTACT_ID_SENTINEL, when: raw, duration_minutes: durationMinutes },
  };
}

/** The contact's words. Kept plausible so the audit trail reads like a call. */
function utteranceFor(expression: string): string {
  return `Could you make it ${expression}?`;
}

// ---------------------------------------------------------------------------
// The families.
// ---------------------------------------------------------------------------

/**
 * A. Follow-up across every zone and every `now`.
 *
 * The mission's headline property - "a scheduled Follow-Up's execution time
 * must always be a validated future datetime in a validated timezone" - lives
 * or dies here, so this is the widest family: 5 zones x 10 instants x 3
 * expressions.
 */
function familyA(): Scenario[] {
  const expressions = VALID_EXPRESSIONS.slice(0, 3);
  const out: Scenario[] = [];
  for (const timezone of TIMEZONES) {
    for (const now of NOW_INSTANTS) {
      for (const expression of expressions) {
        out.push({
          id: `A-fu-${timezone.key}-${now.key}-${expression.key}`,
          family: 'A-followup-matrix',
          nowUtc: now.nowUtc,
          world: worldFrom(timezone, DEFAULT_POLICY),
          availability: FREE_DIARY,
          utterance: utteranceFor(expression.raw),
          toolName: 'schedule_followup',
          args: followupArgs(expression.raw),
          replay: false,
          direction: expression.direction,
          labels: {
            timezone: timezone.zone,
            now: now.key,
            expression: expression.key,
            policy: DEFAULT_POLICY.key,
            availability: FREE_DIARY.key,
            tool: 'schedule_followup',
          },
        });
      }
    }
  }
  return out;
}

/**
 * B. Meeting across every zone and every `now`.
 *
 * The same spread as A but through `MeetingSchedulingService`, which differs in
 * two ways that matter: it consults the availability provider, and it writes a
 * row with a start AND an end that must both sit inside business hours.
 */
function familyB(): Scenario[] {
  const expressions = [VALID_EXPRESSIONS[0], VALID_EXPRESSIONS[3]] as ExpressionDimension[];
  const out: Scenario[] = [];
  for (const timezone of TIMEZONES) {
    for (const now of NOW_INSTANTS) {
      for (const expression of expressions) {
        out.push({
          id: `B-mt-${timezone.key}-${now.key}-${expression.key}`,
          family: 'B-meeting-matrix',
          nowUtc: now.nowUtc,
          world: worldFrom(timezone, DEFAULT_POLICY),
          availability: FREE_DIARY,
          utterance: utteranceFor(expression.raw),
          toolName: 'schedule_meeting',
          args: meetingArgs(expression.raw),
          replay: false,
          direction: expression.direction,
          labels: {
            timezone: timezone.zone,
            now: now.key,
            expression: expression.key,
            policy: DEFAULT_POLICY.key,
            availability: FREE_DIARY.key,
            tool: 'schedule_meeting',
          },
        });
      }
    }
  }
  return out;
}

/**
 * C. Every refusable expression, in every zone, at two very different instants.
 *
 * This is the family that populates the ValidationErrorCode distribution, and
 * the one where `direction` is genuinely assertable: none of these may ever be
 * accepted, in any zone, under any policy in the matrix.
 */
function familyC(): Scenario[] {
  const instants = [NOW_INSTANTS[0], NOW_INSTANTS[4]] as NowDimension[];
  const expressions = [...REJECTED_EXPRESSIONS, LEAD_TIME_EXPRESSIONS[0] as ExpressionDimension];
  const out: Scenario[] = [];
  for (const timezone of TIMEZONES) {
    for (const now of instants) {
      for (const expression of expressions) {
        const tool = expression.key.endsWith('-far-future') ? 'schedule_meeting' : 'schedule_followup';
        out.push({
          id: `C-rj-${timezone.key}-${now.key}-${expression.key}`,
          family: 'C-rejection-matrix',
          nowUtc: now.nowUtc,
          world: worldFrom(timezone, DEFAULT_POLICY),
          availability: FREE_DIARY,
          utterance: utteranceFor(expression.raw),
          toolName: tool,
          args: tool === 'schedule_meeting' ? meetingArgs(expression.raw) : followupArgs(expression.raw),
          replay: false,
          direction: expression.direction,
          labels: {
            timezone: timezone.zone,
            now: now.key,
            expression: expression.key,
            policy: DEFAULT_POLICY.key,
            availability: FREE_DIARY.key,
            tool,
          },
        });
      }
    }
  }
  return out;
}

/**
 * D. The DST edges, per zone.
 *
 * For the three zones that observe DST: a local time inside the spring-forward
 * gap, and a local time that the autumn fall-back makes happen twice. For the
 * two that do not: the SAME local times, which must be resolved perfectly
 * ordinarily - a zone without DST must never produce a DST error code, and
 * `invariants.ts` asserts exactly that.
 */
function familyD(): Scenario[] {
  const out: Scenario[] = [];
  for (const timezone of TIMEZONES) {
    const cases: { readonly kind: string; readonly local: string }[] = timezone.observesDst
      ? [
          { kind: 'gap', local: timezone.dstGapLocal as string },
          { kind: 'ambiguous', local: timezone.dstAmbiguousLocal as string },
        ]
      : [
          // The northern and southern transition instants, in a zone that has
          // neither. Nothing special must happen.
          { kind: 'no-dst-north', local: '2026-03-08T02:30' },
          { kind: 'no-dst-south', local: '2026-10-04T02:30' },
        ];

    for (const dstCase of cases) {
      for (const tool of ['schedule_followup', 'schedule_meeting'] as const) {
        out.push({
          id: `D-dst-${timezone.key}-${dstCase.kind}-${tool === 'schedule_meeting' ? 'mt' : 'fu'}`,
          family: 'D-dst-edges',
          nowUtc: BASELINE_NOW.nowUtc,
          // A 365-day horizon so a November or October target is not refused
          // as BEYOND_HORIZON before the DST check is ever reached.
          world: worldFrom(timezone, POLICIES[2] as PolicyDimension),
          availability: FREE_DIARY,
          utterance: utteranceFor(dstCase.local),
          toolName: tool,
          args: tool === 'schedule_meeting' ? meetingArgs(dstCase.local) : followupArgs(dstCase.local),
          replay: false,
          direction: 'EITHER',
          labels: {
            timezone: timezone.zone,
            now: BASELINE_NOW.key,
            expression: `dst-${dstCase.kind}`,
            policy: (POLICIES[2] as PolicyDimension).key,
            availability: FREE_DIARY.key,
            tool,
          },
        });
      }
    }
  }
  return out;
}

/**
 * E. The same proposals under four different persisted configurations.
 *
 * The point of this family is that NOTHING about the code changes between its
 * cases - only rows in `AgentConfiguration`. If business hours, lead time,
 * horizon or the tool allowlist were being read from a constant anywhere, this
 * family is what notices.
 */
function familyE(): Scenario[] {
  const expressions = [
    VALID_EXPRESSIONS[0],
    VALID_EXPRESSIONS[1],
    LEAD_TIME_EXPRESSIONS[1],
    REJECTED_EXPRESSIONS[9],
  ] as ExpressionDimension[];
  const out: Scenario[] = [];
  for (const policy of POLICIES) {
    for (const expression of expressions) {
      for (const tool of ['schedule_followup', 'schedule_meeting'] as const) {
        const timezone = TIMEZONES[0] as TimezoneDimension;
        out.push({
          id: `E-pol-${policy.key}-${expression.key}-${tool === 'schedule_meeting' ? 'mt' : 'fu'}`,
          family: 'E-policy-matrix',
          nowUtc: BASELINE_NOW.nowUtc,
          world: worldFrom(timezone, policy),
          availability: FREE_DIARY,
          utterance: utteranceFor(expression.raw),
          toolName: tool,
          args: tool === 'schedule_meeting' ? meetingArgs(expression.raw) : followupArgs(expression.raw),
          replay: false,
          // Under p4 `schedule_meeting` is withheld entirely, so even a
          // perfectly good time must be refused. That IS assertable.
          direction:
            policy.allowedTools && !policy.allowedTools.includes(tool) ? 'REJECT' : expression.direction,
          labels: {
            timezone: timezone.zone,
            now: BASELINE_NOW.key,
            expression: expression.key,
            policy: policy.key,
            availability: FREE_DIARY.key,
            tool,
          },
        });
      }
    }
  }
  return out;
}

/**
 * F. Free, exact clash, partial overlap, and adjacent-but-not-overlapping.
 *
 * Run through both the tool that consults the diary (`schedule_meeting`) and
 * the one that deliberately does not (`schedule_followup`) - the asymmetry is a
 * product decision, and this family is what keeps it true.
 */
function familyF(): Scenario[] {
  const out: Scenario[] = [];
  for (const timezone of TIMEZONES) {
    for (const state of AVAILABILITY_STATES) {
      for (const tool of ['schedule_meeting', 'check_availability'] as const) {
        out.push({
          id: `F-av-${timezone.key}-${state.key}-${tool === 'schedule_meeting' ? 'mt' : 'ck'}`,
          family: 'F-availability-matrix',
          nowUtc: BASELINE_NOW.nowUtc,
          world: worldFrom(timezone, DEFAULT_POLICY),
          availability: state,
          utterance: utteranceFor(AVAILABILITY_PROBE_EXPRESSION),
          toolName: tool,
          args:
            tool === 'schedule_meeting'
              ? meetingArgs(AVAILABILITY_PROBE_EXPRESSION, AVAILABILITY_PROBE_MINUTES)
              : availabilityArgs(AVAILABILITY_PROBE_EXPRESSION, AVAILABILITY_PROBE_MINUTES),
          replay: false,
          direction: 'EITHER',
          labels: {
            timezone: timezone.zone,
            now: BASELINE_NOW.key,
            expression: 'availability-probe',
            policy: DEFAULT_POLICY.key,
            availability: state.key,
            tool,
          },
        });
      }
    }
  }
  return out;
}

/**
 * G. Tool calls that are malformed, unknown, or aimed at someone else.
 *
 * Every one of these must be refused with a specific code and must leave the
 * database byte-for-byte unchanged. This is the family that proves the
 * mission's "a tool call must never mutate persisted state without passing
 * through validation" as a PROPERTY rather than as nine examples.
 */
function familyG(): Scenario[] {
  const shapes: { readonly key: string; readonly toolName: string; readonly args: ArgsSpec }[] = [
    {
      key: 'g1-unknown-tool',
      toolName: 'send_contract_and_charge_card',
      args: { kind: 'object', value: { contact_id: CONTACT_ID_SENTINEL, amount_usd: 4999 } },
    },
    {
      key: 'g2-not-json',
      toolName: 'schedule_followup',
      args: { kind: 'raw', text: '{ "contact_id": "c_1", "when": tomorrow afternoon at 3 }' },
    },
    {
      key: 'g3-missing-when',
      toolName: 'schedule_followup',
      args: { kind: 'object', value: { contact_id: CONTACT_ID_SENTINEL, reason: 'follow up on pricing' } },
    },
    {
      key: 'g4-unknown-key',
      toolName: 'schedule_followup',
      args: {
        kind: 'object',
        // `.strict()` must refuse this rather than silently stripping it: a
        // model that believes it disabled validation must be told otherwise.
        value: {
          contact_id: CONTACT_ID_SENTINEL,
          when: 'tomorrow at 2pm',
          skip_validation: true,
          reason: 'callback',
        },
      },
    },
    {
      key: 'g5-fabricated-contact',
      toolName: 'schedule_followup',
      args: {
        kind: 'object',
        value: { contact_id: 'contact_the_model_invented', when: 'tomorrow at 2pm', reason: 'callback' },
      },
    },
    {
      key: 'g6-bogus-timezone',
      toolName: 'schedule_followup',
      args: {
        kind: 'object',
        value: {
          contact_id: CONTACT_ID_SENTINEL,
          when: 'tomorrow at 2pm',
          timezone: 'America/Notarealplace',
          reason: 'callback',
        },
      },
    },
    {
      key: 'g7-offset-not-zone',
      toolName: 'schedule_followup',
      args: {
        kind: 'object',
        // An OFFSET is not a zone: it carries no DST rule, so it must not be
        // accepted as one.
        value: {
          contact_id: CONTACT_ID_SENTINEL,
          when: 'tomorrow at 2pm',
          timezone: '-05:00',
          reason: 'callback',
        },
      },
    },
    {
      key: 'g8-unsupported-followup-type',
      toolName: 'schedule_followup',
      args: {
        kind: 'object',
        value: {
          contact_id: CONTACT_ID_SENTINEL,
          when: 'tomorrow at 2pm',
          action_type: 'SEND_FOLLOWUP_MESSAGE',
          reason: 'text them the pricing sheet',
        },
      },
    },
    {
      key: 'g9-fabricated-meeting',
      toolName: 'cancel_meeting',
      args: { kind: 'object', value: { meeting_id: 'meeting_the_model_invented', reason: 'they cancelled' } },
    },
  ];

  const out: Scenario[] = [];
  for (const timezone of TIMEZONES.slice(0, 3)) {
    for (const shape of shapes) {
      out.push({
        id: `G-bad-${timezone.key}-${shape.key}`,
        family: 'G-malformed-calls',
        nowUtc: BASELINE_NOW.nowUtc,
        world: worldFrom(timezone, DEFAULT_POLICY),
        availability: FREE_DIARY,
        utterance: 'Sort that out for me would you?',
        toolName: shape.toolName,
        args: shape.args,
        replay: false,
        direction: 'REJECT',
        labels: {
          timezone: timezone.zone,
          now: BASELINE_NOW.key,
          expression: shape.key,
          policy: DEFAULT_POLICY.key,
          availability: FREE_DIARY.key,
          tool: shape.toolName,
        },
      });
    }
  }
  return out;
}

/**
 * H. The same call, twice, in the same conversation.
 *
 * The idempotency key is derived from (conversationId, contactId, resolved
 * instant), so a replayed turn must return the EXISTING row rather than book a
 * second meeting. Dispatched across every zone because the derived key contains
 * a resolved UTC instant, and a zone bug would produce two different keys for
 * what the contact experienced as one agreement.
 */
function familyH(): Scenario[] {
  const out: Scenario[] = [];
  for (const timezone of TIMEZONES) {
    for (const tool of ['schedule_followup', 'schedule_meeting'] as const) {
      out.push({
        id: `H-idem-${timezone.key}-${tool === 'schedule_meeting' ? 'mt' : 'fu'}`,
        family: 'H-idempotency-replay',
        nowUtc: BASELINE_NOW.nowUtc,
        world: worldFrom(timezone, DEFAULT_POLICY),
        availability: FREE_DIARY,
        utterance: utteranceFor('tomorrow at 2pm'),
        toolName: tool,
        args: tool === 'schedule_meeting' ? meetingArgs('tomorrow at 2pm') : followupArgs('tomorrow at 2pm'),
        replay: true,
        direction: 'EITHER',
        labels: {
          timezone: timezone.zone,
          now: BASELINE_NOW.key,
          expression: 'e01-tomorrow-2pm',
          policy: DEFAULT_POLICY.key,
          availability: FREE_DIARY.key,
          tool,
        },
      });
    }
  }
  return out;
}

/**
 * I. The decision-maker hard cap.
 *
 * Crosses `Contact.isDecisionMaker` with a spread of rubric evidence and with
 * flattering scores the model proposes directly. The cap must hold in every
 * one of them, and it must be read from the PERSISTED contact row rather than
 * from anything the model asserted.
 */
function familyI(): Scenario[] {
  const random = seededRandom(SWEEP_SEED);
  const evidencePool = [
    'They said the current tool is costing them two days a week.',
    'Budget is already approved for this quarter.',
    'They want it live before the end of the month.',
    'They said they would need to run it past their director.',
    'They asked three detailed questions about the integration.',
  ];
  const factors = [
    'need_established',
    'budget_signal',
    'timeline_urgency',
    'authority_signal',
    'engagement',
  ] as const;

  const out: Scenario[] = [];
  for (const isDecisionMaker of [true, false]) {
    // A spread from "no evidence at all" to "every factor at full strength".
    for (let strength = 0; strength <= 4; strength += 1) {
      for (const shape of ['observations', 'proposed-score'] as const) {
        // `value` is 0-100 WITHIN the factor; `strength` walks it from no
        // evidence to unambiguous, so the sweep spans UNQUALIFIED to HIGH.
        const observations = factors.slice(0, strength).map((factor) => ({
          factor,
          value: 25 * strength,
          evidence: evidencePool[Math.floor(random() * evidencePool.length)] as string,
        }));

        const value: Record<string, unknown> = {
          contact_id: CONTACT_ID_SENTINEL,
          notes: `sweep strength ${strength}`,
        };
        if (shape === 'observations') {
          value['observations'] = observations;
        } else {
          // No evidence, just a flattering number. Advisory only.
          value['proposed_score'] = 60 + strength * 10;
        }

        const dm = isDecisionMaker ? 'dm' : 'nodm';
        out.push({
          id: `I-qual-${dm}-s${strength}-${shape === 'observations' ? 'obs' : 'prop'}`,
          family: 'I-qualification-cap',
          nowUtc: BASELINE_NOW.nowUtc,
          world: worldFrom(TIMEZONES[0] as TimezoneDimension, DEFAULT_POLICY, isDecisionMaker),
          availability: FREE_DIARY,
          utterance: 'We are very keen, the whole team wants this.',
          toolName: 'update_qualification',
          args: { kind: 'object', value },
          replay: false,
          direction: 'ACCEPT',
          labels: {
            timezone: (TIMEZONES[0] as TimezoneDimension).zone,
            now: BASELINE_NOW.key,
            expression: `qual-${shape}-s${strength}`,
            policy: DEFAULT_POLICY.key,
            availability: FREE_DIARY.key,
            tool: 'update_qualification',
            decisionMaker: String(isDecisionMaker),
          },
        });
      }
    }
  }
  return out;
}

/**
 * J. The model-supplied `timezone` argument, crossed with every contact zone.
 *
 * WHY THIS FAMILY EXISTS
 * ---------------------------------------------------------------------------
 * Families A-I never populate the optional `timezone` argument, and neither does
 * family L, so for every one of them the zone a slot was agreed in IS the
 * contact's persisted zone. That made
 * an entire class of bug invisible: an accepted call could be checked against a
 * window the MODEL chose rather than the one the contact lives in, and every
 * invariant would still read green, because no invariant looked at the contact's
 * own clock.
 *
 * So this family drives the axis directly. Two blocks:
 *
 *  - the SWEEP: every contact zone x every asserted zone x both scheduling
 *    tools, direction `EITHER`, policed by `INV-14`, which re-reads each
 *    persisted instant in the CONTACT'S persisted zone.
 *  - the COMMITTED cases: six hand-checked (contact zone, asserted zone, local
 *    time) triples whose effect on the contact's clock is a pure tzdata fact,
 *    four of which must be refused and two of which must still be accepted.
 *    `dimensions.test.ts` re-derives all six from Luxon on every run.
 */
function familyJ(): Scenario[] {
  const out: Scenario[] = [];

  for (const timezone of TIMEZONES) {
    for (const asserted of ASSERTED_TIMEZONES) {
      for (const tool of ['schedule_followup', 'schedule_meeting'] as const) {
        out.push({
          id: `J-tz-${timezone.key}-${assertedKey(asserted)}-${tool === 'schedule_meeting' ? 'mt' : 'fu'}`,
          family: 'J-timezone-override',
          nowUtc: BASELINE_NOW.nowUtc,
          world: worldFrom(timezone, DEFAULT_POLICY),
          availability: FREE_DIARY,
          utterance: `Could you make it ${OVERRIDE_PROBE_EXPRESSION}? I'm in ${asserted} at the moment.`,
          toolName: tool,
          args: schedulingArgs(tool, OVERRIDE_PROBE_EXPRESSION, asserted),
          replay: false,
          // Honestly EITHER: whether 10:00 in the asserted zone lands inside the
          // contact's working day depends on both zones and the weekday, and
          // working that out here would mean reimplementing the resolver.
          direction: 'EITHER',
          labels: {
            timezone: timezone.zone,
            now: BASELINE_NOW.key,
            expression: 'override-probe',
            policy: DEFAULT_POLICY.key,
            availability: FREE_DIARY.key,
            tool,
            assertedTimezone: asserted,
          },
        });
      }
    }
  }

  for (const override of TIMEZONE_OVERRIDE_CASES) {
    const timezone = TIMEZONES.find((candidate) => candidate.zone === override.contactZone);
    if (timezone === undefined) {
      throw new Error(`Override case ${override.key} names contact zone "${override.contactZone}", which is not a swept zone.`);
    }
    for (const tool of ['schedule_followup', 'schedule_meeting'] as const) {
      out.push({
        id: `J-tzc-${override.key}-${tool === 'schedule_meeting' ? 'mt' : 'fu'}`,
        family: 'J-timezone-override',
        nowUtc: BASELINE_NOW.nowUtc,
        world: worldFrom(timezone, DEFAULT_POLICY),
        availability: FREE_DIARY,
        utterance: `Could you make it ${override.whenLocal}? I'm in ${override.assertedZone}.`,
        toolName: tool,
        args: schedulingArgs(tool, override.whenLocal, override.assertedZone),
        replay: false,
        direction: override.direction,
        labels: {
          timezone: override.contactZone,
          now: BASELINE_NOW.key,
          expression: override.key,
          policy: DEFAULT_POLICY.key,
          availability: FREE_DIARY.key,
          tool,
          assertedTimezone: override.assertedZone,
        },
      });
    }
  }

  return out;
}

/**
 * K. The minimum-lead-time boundary, measured in SECONDS.
 *
 * Every `now` in `NOW_INSTANTS` sits on a whole minute, so the whole corpus was
 * blind to a gate that rounded the lead time to the nearest minute before
 * comparing it: a shortfall of up to 30 seconds read as a pass, and the receipt
 * then recorded the rounded figure as if it were the real one. These five cases
 * straddle the 30-minute minimum in `p1-default` by one second, thirty seconds
 * and exactly zero, in both directions, and every one commits to a direction.
 */
function familyK(): Scenario[] {
  const timezone = TIMEZONES.find((candidate) => candidate.zone === LEAD_TIME_BOUNDARY_ZONE) as TimezoneDimension;
  const out: Scenario[] = [];
  for (const boundary of LEAD_TIME_BOUNDARY_CASES) {
    for (const tool of ['schedule_followup', 'schedule_meeting'] as const) {
      out.push({
        id: `K-lead-${boundary.key}-${tool === 'schedule_meeting' ? 'mt' : 'fu'}`,
        family: 'K-lead-time-boundary',
        nowUtc: boundary.nowUtc,
        world: worldFrom(timezone, DEFAULT_POLICY),
        availability: FREE_DIARY,
        utterance: `Can you do ${boundary.whenLocal}?`,
        toolName: tool,
        args: schedulingArgs(tool, boundary.whenLocal),
        replay: false,
        direction: boundary.direction,
        labels: {
          timezone: timezone.zone,
          now: boundary.key,
          expression: boundary.key,
          policy: DEFAULT_POLICY.key,
          availability: FREE_DIARY.key,
          tool,
        },
      });
    }
  }
  return out;
}

/**
 * L. Hebrew and English, saying the same thing, through the real front door.
 *
 * WHY THIS IS A FAMILY AND NOT A UNIT TEST
 * ---------------------------------------------------------------------------
 * `tests/scheduling/localeParity.test.ts` already asserts parity at the
 * resolver, across six zones and six instants, for thirty-seven pairs. That is
 * cheap and wide and it is not the same claim as this one. It stops at
 * `DateTimeResolver`. What it cannot say is that the phrase survives the
 * DISPATCHER: that a Hebrew `when` arriving as a JSON tool argument, against a
 * seeded Asia/Jerusalem contact, produces a validated row, a receipt whose
 * leftover is empty, and an instant on the day the contact named. Every
 * invariant in this sweep applies to it, INV-15 / INV-16 / INV-17 included.
 *
 * BOTH SIDES OF EACH PAIR ARE DISPATCHED
 * ---------------------------------------------------------------------------
 * Emitting only the Hebrew half and resolving the English half inside the
 * invariant would leave the English half untested through the front door in
 * these zones, and would make a failure ambiguous between "Hebrew is wrong" and
 * "this zone is wrong". So each pair produces two scenarios, each carrying the
 * other as its `parity.counterpartRaw`, and INV-16 fires on both.
 *
 * THE BOUND, STATED HERE AS WELL AS IN `dimensions.ts`
 * ---------------------------------------------------------------------------
 * Three zones and two `now` instants, not five and ten. Adding Asia/Jerusalem
 * and Pacific/Auckland to `TIMEZONES` would have cost 224 extra scenarios
 * across families A-J to re-prove English behaviour at a different offset. The
 * choice is recorded in `KNOWN_COVERAGE_GAPS` so the printed report says it too.
 */
function familyL(): Scenario[] {
  const out: Scenario[] = [];

  const push = (
    pair: LocaleParityPair,
    side: 'he' | 'en',
    zoneKey: string,
    zone: string,
    nowKey: string,
    nowUtc: string,
    tool: 'schedule_followup' | 'schedule_meeting',
  ): void => {
    const raw = side === 'he' ? pair.hebrew : pair.english;
    const counterpartRaw = side === 'he' ? pair.english : pair.hebrew;
    out.push({
      id: `L-par-${pair.key}-${side}-${zoneKey}-${nowKey}-${tool === 'schedule_meeting' ? 'mt' : 'fu'}`,
      family: 'L-locale-parity',
      nowUtc,
      // A zone dimension is needed for `worldFrom`, and family L's zones are
      // its own, so one is synthesised rather than looked up in `TIMEZONES`.
      world: worldFrom({ key: zoneKey, zone, rationale: '', observesDst: true }, DEFAULT_POLICY),
      availability: FREE_DIARY,
      utterance: side === 'he' ? `${raw}, בבקשה.` : `Could you make it ${raw}?`,
      toolName: tool,
      args: schedulingArgs(tool, raw),
      replay: false,
      // Honestly EITHER. Whether 15:00 on the named day is inside the seeded
      // Monday-to-Friday window depends on the weekday, and working that out
      // here would mean reimplementing the resolver.
      direction: 'EITHER',
      parity: {
        key: pair.key,
        side,
        counterpartRaw,
        identical: pair.identical,
        ...(pair.whyNotIdentical ? { whyNotIdentical: pair.whyNotIdentical } : {}),
      },
      labels: {
        timezone: zone,
        now: nowKey,
        expression: pair.expressionKey,
        policy: DEFAULT_POLICY.key,
        availability: FREE_DIARY.key,
        tool,
        parityPair: pair.key,
        localeSide: side,
      },
    });
  };

  for (const pair of LOCALE_PARITY_PAIRS) {
    for (const side of ['he', 'en'] as const) {
      for (const zone of LOCALE_ZONES) {
        for (const now of LOCALE_NOW_INSTANTS) {
          push(pair, side, zone.key, zone.zone, now.key, now.nowUtc, 'schedule_followup');
        }
      }
    }
  }

  // The headline pair through the MEETING path as well, because that one also
  // consults the availability provider and writes a row with an END that has
  // to sit inside business hours too. One pair rather than ten: the difference
  // between the two tools is not a locale question, and the other nine pairs
  // would only re-prove `MeetingSchedulingService`.
  const headline = LOCALE_PARITY_PAIRS[0] as LocaleParityPair;
  for (const side of ['he', 'en'] as const) {
    for (const zone of LOCALE_ZONES) {
      for (const now of LOCALE_NOW_INSTANTS) {
        push(headline, side, zone.key, zone.zone, now.key, now.nowUtc, 'schedule_meeting');
      }
    }
  }

  return out;
}

/**
 * M. What the agent is allowed to SAY, crossed with four contact zones.
 *
 * WHY A FAMILY AND NOT A HANDFUL OF E2E TESTS
 * ---------------------------------------------------------------------------
 * `tests/e2e/claimGate.test.ts` and `tests/e2e/claimGateExhaustion.test.ts`
 * already prove the gate's behaviour case by case, and they are the gate task's.
 * They are not the same claim as this one. They assert that the gate works in the
 * cases somebody thought of. This family asserts a PROPERTY - that no released
 * text asserts an absent effect - over a matrix, in four zones, alongside every
 * other invariant in the sweep. A regression that only showed up in
 * `Asia/Kolkata`, or only when a Hebrew claim met an English day word, or only
 * once a second invariant's scenario had put a row in the same database, is the
 * kind this finds and a case list does not.
 *
 * It also makes INV-18 non-vacuous about the thing that matters. Without family M
 * every scenario in the sweep releases the same two sentences, neither of which
 * asserts anything - so INV-18 would be applicable 1,600 times and would never
 * once examine a claim. That is the vacuity `report.ts` prints in capitals, and a
 * gate invariant proved only against silence is worth nothing.
 *
 * FOUR ZONES, AND THE FIFTH IS EXCLUDED FOR A REASON
 * ---------------------------------------------------------------------------
 * `RELEASE_ZONES` is New York, London, Jerusalem and Kolkata: the zones in which
 * `tomorrow at 2pm` at `n01-midweek` is Thursday 5 March 2026 at 14:00 local.
 * `Australia/Sydney` is already on Thursday at that instant, so `tomorrow` there
 * is Friday and every spec that says "Thursday" would be a genuine wrong-day
 * claim. Crossing it in would not test the gate harder, it would test a
 * different thing and report it as this one. The exclusion is in
 * `KNOWN_COVERAGE_GAPS` and `dimensions.test.ts` re-derives all four targets
 * from Luxon so this comment cannot quietly go stale.
 *
 * EVERY SCENARIO RUNS THE SAME UNDERLYING CALL
 * ---------------------------------------------------------------------------
 * One expression, one policy, one diary, one instant. That is deliberate: the
 * only thing varying across this family is WHAT THE AGENT SAID, so a failure
 * localises to the sentence rather than to the scheduling.
 */
function familyM(): Scenario[] {
  const out: Scenario[] = [];

  for (const spec of RELEASE_SPECS) {
    // All but the two claim-after-refusal specs share one proposal, so the only
    // thing varying across the family is what the agent SAID.
    const when = spec.when ?? RELEASE_PROBE_EXPRESSION;
    for (const zone of RELEASE_ZONES) {
      out.push({
        id: `M-say-${spec.key}-${assertedKey(zone)}`,
        family: 'M-claim-release',
        nowUtc: BASELINE_NOW.nowUtc,
        // A zone dimension is needed for `worldFrom` and family M's zones are
        // its own, so one is synthesised - the same thing family L does.
        world: worldFrom({ key: assertedKey(zone), zone, rationale: '', observesDst: true }, DEFAULT_POLICY),
        availability: FREE_DIARY,
        utterance: utteranceFor(when),
        toolName: spec.tool,
        args: schedulingArgs(spec.tool, when),
        replay: false,
        // Honestly EITHER for every spec. Whether Thursday 14:00 is accepted is a
        // scheduling question and this family is not asking it; what must hold is
        // INV-18, which reads the rows that actually resulted rather than
        // predicting them. `r08` in particular ends with NO tool call dispatched
        // at all, which is neither an acceptance nor a refusal.
        direction: 'EITHER',
        release: spec,
        labels: {
          timezone: zone,
          now: BASELINE_NOW.key,
          expression: 'release-probe',
          policy: DEFAULT_POLICY.key,
          availability: FREE_DIARY.key,
          tool: spec.tool,
          releaseSpec: spec.key,
          releaseExpect: spec.expect,
          releaseLanguage: spec.language,
        },
      });
    }
  }

  return out;
}

/** `Asia/Kolkata` -> `asia-kolkata`, so a scenario id stays a safe seed suffix. */
function assertedKey(zone: string): string {
  return zone.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

// ---------------------------------------------------------------------------

/** Human-readable purpose of each family, reproduced in the sweep report. */
export const FAMILY_PURPOSE: Readonly<Record<FamilyKey, string>> = {
  'A-followup-matrix': 'Follow-up scheduling across every timezone and every `now` instant.',
  'B-meeting-matrix': 'Meeting booking across every timezone and every `now` instant.',
  'C-rejection-matrix': 'Every refusable time expression, in every timezone, at two instants.',
  'D-dst-edges': 'DST gap and DST-ambiguous local times, and their absence in zones without DST.',
  'E-policy-matrix': 'Four persisted AgentConfiguration policies over the same proposals.',
  'F-availability-matrix': 'Free / exact clash / partial overlap / adjacent, booking and checking.',
  'G-malformed-calls': 'Unknown tools, unparseable arguments, fabricated ids, bogus timezones.',
  'H-idempotency-replay': 'The identical tool call dispatched twice in the same conversation.',
  'I-qualification-cap': 'The decision-maker hard cap across evidence strengths and proposed scores.',
  'J-timezone-override':
    "The model-supplied `timezone` argument crossed with every contact zone, plus six hand-checked " +
    "cases whose effect on the contact's own clock is known. Policed by INV-14.",
  'K-lead-time-boundary':
    'Sub-minute `now` instants straddling the configured minimum lead time by one and thirty seconds, ' +
    'in both directions.',
  'L-locale-parity':
    'Translated Hebrew/English pairs dispatched through the real front door, both sides of each pair, ' +
    'across three locale zones (Asia/Jerusalem, America/New_York, Pacific/Auckland - family-local, see ' +
    'the coverage gaps) and two `now` instants. Policed by INV-15, INV-16 and INV-17.',
  'M-claim-release':
    'WHAT THE AGENT IS ALLOWED TO SAY. Supported and unsupported claims - wrong day, wrong time, invented ' +
    'confirmation number, an email nothing can send, a handover nobody requested, a claim made before its ' +
    'own tool ran, and three consecutive unsupported attempts driven all the way to the withholding path - ' +
    'in English, Hebrew and mixed Hebrew-English, across four contact zones in which `tomorrow at 2pm` is ' +
    'the same Thursday. Since r17 it also carries the FIRST-PERSON SIMPLE PAST (`I booked you in for ' +
    'Friday`, `I cancelled your meeting`, `I sent you a confirmation email`, `סידרתי`) and a fabricated ' +
    'digits-only confirmation number, which were released end to end until the English lexicon gained a ' +
    'preterite. Since r23 it carries the CROSS-CLAUSE shape as well (`Don\'t worry, your meeting is booked ' +
    'for Friday at 2pm.`, `אין דאגה, הפגישה נקבעה ליום שישי`, and the same sentence with no punctuation so ' +
    'only `but` divides it), which was released and persisted until negation was scoped to the clause - ' +
    'plus r27, the precision half, which must still be released byte-identical when it is TRUE. Since r28 ' +
    'it carries ONE WORD INSIDE THE FRAME (`Your meeting is now booked for Friday at 2pm.`, ' +
    '`I have now booked your meeting for Friday`, `has now been successfully booked`, and the Hebrew ' +
    'control `הפגישה שלך כבר נקבעה`), which was released and persisted until a completion frame stopped ' +
    'requiring its tokens to be adjacent. Since r36 it carries the BARE PARTICIPLE BESIDE A DOMAIN OBJECT ' +
    '(`I have finally and officially booked your meeting`, `has, at long last, finally been booked`, ' +
    '`Right, meeting booked for Friday at 2pm.`), which no frame rule can read at any bound - a clause joiner ' +
    'may never be skipped inside a frame and the telegraphic register has no auxiliary at all. Plus r34, r35 ' +
    'and r40, the three precision halves: the interrupted wording when it is TRUE, and the honest intentions ' +
    '`I can have that booked for you` and `Let me get your meeting booked for Thursday` which a looser rule ' +
    'would have blocked. Policed by INV-18.',
};

/**
 * The whole corpus, in a stable order.
 *
 * Pure. No clock, no I/O, no unseeded randomness. Two calls in the same process
 * or in different processes produce identical output.
 */
export function generateScenarios(): readonly Scenario[] {
  const scenarios = [
    ...familyA(),
    ...familyB(),
    ...familyC(),
    ...familyD(),
    ...familyE(),
    ...familyF(),
    ...familyG(),
    ...familyH(),
    ...familyI(),
    ...familyJ(),
    ...familyK(),
    ...familyL(),
    ...familyM(),
  ];

  const seen = new Set<string>();
  for (const scenario of scenarios) {
    if (seen.has(scenario.id)) {
      throw new Error(`Duplicate scenario id "${scenario.id}". Scenario ids must be unique and stable.`);
    }
    seen.add(scenario.id);
  }
  return scenarios;
}

/** Substitute the seeded contact id and render the arguments as a model would. */
export function renderArguments(args: ArgsSpec, contactId: string): string {
  if (args.kind === 'raw') return args.text;
  const substituted = Object.fromEntries(
    Object.entries(args.value).map(([key, value]) => [key, value === CONTACT_ID_SENTINEL ? contactId : value]),
  );
  return JSON.stringify(substituted);
}

/** The `when` a scenario proposes, or null for a call that carries no time. */
export function proposedWhen(args: ArgsSpec): string | null {
  if (args.kind === 'raw') return null;
  const when = args.value['when'];
  return typeof when === 'string' ? when : null;
}
