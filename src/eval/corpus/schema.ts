/**
 * THE BENCHMARK CORPUS SCHEMA.
 *
 * WHY THE CORPUS IS DATA AND NOT CODE
 * ---------------------------------------------------------------------------
 * A benchmark whose scenarios are expressed as procedures cannot be audited:
 * you cannot diff it, you cannot count its coverage, and you cannot tell
 * whether last week's run measured the same thing. So every scenario here is a
 * VALUE - a seeded world, an ordered list of things a human says, and per-turn
 * expectations - validated by Zod at load time and versioned as a whole.
 *
 * WHAT AN EXPECTATION IS ALLOWED TO BE
 * ---------------------------------------------------------------------------
 * CHECKABLE. Every field below can be evaluated by a program against a real
 * turn: which tool was called, whether its arguments parsed against the real
 * Zod schema, whether the `when` argument still contains the contact's own
 * words, whether the reply asserted a concrete date it was never given.
 *
 * There is deliberately no `expectedAssistantText`. Scoring a generative model
 * against one blessed sentence measures conformity to the person who wrote the
 * fixture, not conversation quality, and this mission is explicitly about the
 * latter. Human-likeness is scored separately by the rubric, from transcripts a
 * human can read.
 *
 * MULTI-TURN BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 * `turns` is an ordered array and the conversation is NOT reset between them.
 * A single-turn prompt cannot show you whether a model remembers what was said
 * four exchanges ago, recovers from a topic change, or continues naturally
 * after a tool result - which are most of the things that decide whether this
 * sounds like a person.
 */
import { z } from 'zod';

/** Bump when the shape or the semantics of a field change. */
export const CORPUS_SCHEMA_VERSION = '1.1.0';

/**
 * The conversational axes the mission requires the corpus to cover.
 *
 * This list IS the coverage contract: `src/eval/corpus/index.ts` refuses to
 * load a corpus that leaves any of them unclaimed, so the corpus cannot quietly
 * lose a requirement while still looking like it passes.
 */
export const REQUIRED_COVERAGE = [
  'normal-introduction',
  'interested-lead',
  'uninterested-lead',
  'busy-right-now',
  'what-does-the-company-do',
  'unexpected-topic-change',
  'question-before-answering',
  'incomplete-information',
  'vague-next-week',
  'tomorrow-afternoon',
  'reschedule',
  'cancellation',
  'not-decision-maker',
  'price-objection',
  'needs-to-consult-someone',
  'call-again-in-several-days',
  'reference-to-earlier-turn',
  'continuing-previous-session',
  'language-english',
  'language-hebrew',
  'language-mixed',
  'ambiguous-date-time',
  'interrupts-sales-direction',
  'unexpected-product-question',
  'tool-result-failure',
  'adversarial-guardrail',
] as const;

export type CoverageKey = (typeof REQUIRED_COVERAGE)[number];

export const LanguageSchema = z.enum(['en', 'he', 'mixed']);
export type ScenarioLanguage = z.infer<typeof LanguageSchema>;

/**
 * A recurring busy block in the seeded diary.
 *
 * Present so a scenario can make the REAL `check_availability` /
 * `schedule_meeting` path return a genuine refusal. The corpus never fakes a
 * tool failure: it arranges a world in which the real dispatcher really
 * refuses, because a mocked failure would prove nothing about this product.
 */
export const BusyRuleSchema = z
  .object({
    startLocal: z.string().regex(/^\d{2}:\d{2}$/),
    endLocal: z.string().regex(/^\d{2}:\d{2}$/),
    isoWeekdays: z.array(z.number().int().min(1).max(7)).min(1).optional(),
    label: z.string().min(1).optional(),
  })
  .strict();

/** One exchange replayed into the conversation before the scenario's own turns. */
export const PriorTurnSchema = z
  .object({
    role: z.enum(['CONTACT', 'AGENT']),
    text: z.string().min(1),
  })
  .strict();

/**
 * The world a scenario runs in.
 *
 * Everything here ends up as real rows through `seedSliceWorld` and the real
 * repositories, and `nowUtc` becomes a `FixedClock`. Nothing is mocked.
 */
export const WorldSpecSchema = z
  .object({
    /** Drives the `FixedClock`. Every scenario pins its own "now". */
    nowUtc: z.string().datetime(),
    contactFullName: z.string().min(1),
    contactTimezone: z.string().min(1),
    /** False is the interesting case: it caps the qualification score by policy. */
    contactIsDecisionMaker: z.boolean().default(true),
    organizationTimezone: z.string().min(1).default('America/New_York'),
    businessHoursStartLocal: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
    businessHoursEndLocal: z.string().regex(/^\d{2}:\d{2}$/).default('17:00'),
    minLeadTimeMinutes: z.number().int().min(0).default(30),
    maxSchedulingHorizonDays: z.number().int().min(1).default(180),
    /** Omit for all nine. Narrowing it is how a scenario tests the policy gate. */
    allowedTools: z.array(z.string().min(1)).min(1).optional(),
    busyRules: z.array(BusyRuleSchema).optional(),
    /**
     * Replayed into THIS conversation before the scenario's turns run, so the
     * model genuinely sees an earlier exchange in its transcript.
     *
     * HONEST SCOPE NOTE: this models a RESUMED session, which is what Baseline
     * V1 can express. True cross-conversation recall depends on the context
     * assembler and is called out as such in EVAL_HARNESS.md rather than being
     * quietly claimed here.
     */
    priorConversation: z.array(PriorTurnSchema).optional(),
    /**
     * A meeting already in the diary before the scenario starts, booked through
     * the REAL `MeetingSchedulingService` during setup.
     *
     * Reschedule and cancellation need something to act on. Seeding it rather
     * than making turn 1 book it is deliberate: it stops a model that cannot
     * book from being unscorable on rescheduling, and it forces the model to
     * FIND the meeting id (via `get_contact_context`) instead of inventing one,
     * which is itself one of the things being measured.
     */
    seededMeeting: z
      .object({
        /** Natural-language time, resolved by the real validator. */
        when: z.string().min(1),
        title: z.string().min(1),
        durationMinutes: z.number().int().min(5).max(480).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type WorldSpec = z.infer<typeof WorldSpecSchema>;

/**
 * What the model was supposed to do with its tools on this turn.
 *
 * All four fields are independent and all are optional: a turn that says
 * nothing about tools asserts nothing about them, rather than silently
 * asserting "none".
 */
export const ToolExpectationSchema = z
  .object({
    /** The right answer is to say something and call nothing. */
    mustCallNone: z.boolean().optional(),
    /** At least one of these must be called. */
    mustCallOneOf: z.array(z.string().min(1)).min(1).optional(),
    /** None of these may be called. */
    mustNotCall: z.array(z.string().min(1)).min(1).optional(),
    /**
     * The full set that is defensible here. Anything called outside it counts
     * as an UNNECESSARY tool call, scored separately from a wrong one.
     */
    allowed: z.array(z.string().min(1)).optional(),
  })
  .strict();

/**
 * The single most important expectation in this file.
 *
 * The architecture's central rule is that the model passes the contact's WORDS
 * into a time-bearing tool and application code resolves them. This asserts the
 * words actually survived: at least one of `mustContainAnyOf` must appear in
 * the named argument, case-insensitively.
 */
export const PassthroughExpectationSchema = z
  .object({
    tool: z.string().min(1),
    field: z.string().min(1).default('when'),
    mustContainAnyOf: z.array(z.string().min(1)).min(1),
  })
  .strict();

/**
 * WHICH CALENDAR DAY THE RESOLVED INSTANT LANDED ON.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT `expectsToolFailure`
 * ---------------------------------------------------------------------------
 * `expectsToolFailure` can only say "the product is expected to refuse this".
 * It has no way to express the outcome that is actually dangerous: the product
 * ACCEPTS the call and books a real, validated, audit-trailed meeting on the
 * WRONG DAY.
 *
 * That is not hypothetical. `src/scheduling/naturalLanguage.ts` is English-only,
 * and a `when` like `מחר ב-15:00` ("tomorrow at 15:00") does not fail: the
 * grammar recognises the digits, silently DROPS the unrecognised Hebrew day word
 * `מחר`, and falls through to the `implicit_today` branch. Every validator check
 * then passes and the callback is dialled a day early. Under
 * `expectsToolFailure` the harness would have scored that as a merely unmet
 * expectation - "expected failure DID NOT OCCUR" - which reads like a model that
 * did better than predicted rather than a mis-scheduling. See
 * `FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 8.3.
 *
 * SEMANTICS. Applicable only when the turn actually produced a resolved instant
 * (some successful time-bearing tool call). A REFUSAL is not scored here at all,
 * because refusing an input this product cannot resolve is the safe outcome and
 * must not be punished; what is scored is landing on a different day from the
 * one the contact named. A turn that lands wrong trips a GATE - see
 * `WRONG_DAY_RESOLUTION_GATE` in `src/eval/rubric/rubric.ts`.
 */
export const ResolvedDayExpectationSchema = z
  .object({
    /**
     * The calendar date, in the zone the slot resolved in, that the contact's
     * own words name. Written out rather than derived so the assertion can be
     * checked by hand against the scenario's pinned `nowUtc`.
     */
    mustResolveToLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** The words that name it, quoted into the failure message. */
    contactSaid: z.string().min(1),
  })
  .strict();

export const TextExpectationSchema = z
  .object({
    mustNotBeEmpty: z.boolean().optional(),
    /**
     * The reply must not state a resolved calendar date or wall-clock instant.
     *
     * Set on turns where the model has NOT been told one - a model that answers
     * "so that's Thursday 5 March at 3pm" having never been given a date has
     * invented it, and the contact will believe it.
     */
    mustNotAssertConcreteDate: z.boolean().optional(),
    /** Case-insensitive substrings; at least one must appear. */
    mustMentionAnyOf: z.array(z.string().min(1)).min(1).optional(),
    /** Case-insensitive substrings; none may appear. */
    mustNotMentionAnyOf: z.array(z.string().min(1)).min(1).optional(),
    minChars: z.number().int().min(0).optional(),
    /** A voice agent that monologues is a product defect, not a style note. */
    maxChars: z.number().int().min(1).optional(),
  })
  .strict();

export const TurnSchema = z
  .object({
    /** Exactly what the human says. Never paraphrased at run time. */
    utterance: z.string().min(1),
    /** Why this turn exists. Printed in the side-by-side report. */
    note: z.string().min(1),
    tools: ToolExpectationSchema.optional(),
    passthrough: PassthroughExpectationSchema.optional(),
    resolvedDay: ResolvedDayExpectationSchema.optional(),
    text: TextExpectationSchema.optional(),
    /**
     * This turn is EXPECTED to produce at least one refused tool outcome from
     * the real dispatcher, and the model's job is to carry on gracefully in
     * natural language rather than repeating the call or inventing a success.
     */
    expectsToolFailure: z.boolean().optional(),
    /** This utterance carries a scheduling intent the model should recognise. */
    schedulingIntent: z.boolean().optional(),
    /** Language the REPLY should be in. Defaults to the scenario's language. */
    replyLanguage: LanguageSchema.optional(),
  })
  .strict();

export type BenchmarkTurn = z.infer<typeof TurnSchema>;

export const ScenarioSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, 'Scenario ids are kebab-case so they are safe as filenames.'),
    title: z.string().min(1),
    language: LanguageSchema,
    /** What a good salesperson would be trying to achieve across these turns. */
    objective: z.string().min(1),
    /** Which mission-required axes this scenario claims to exercise. */
    coverage: z.array(z.enum(REQUIRED_COVERAGE)).min(1),
    world: WorldSpecSchema,
    turns: z.array(TurnSchema).min(1),
  })
  .strict();

export type BenchmarkScenario = z.infer<typeof ScenarioSchema>;

export const CorpusSchema = z
  .object({
    schemaVersion: z.literal(CORPUS_SCHEMA_VERSION),
    corpusVersion: z.string().min(1),
    scenarios: z.array(ScenarioSchema).min(1),
  })
  .strict();

export type Corpus = z.infer<typeof CorpusSchema>;
