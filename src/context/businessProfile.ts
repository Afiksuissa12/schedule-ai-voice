/**
 * The business context: company, product, pricing, policy, persona and
 * objective - as STRUCTURED FACTS the model may use, never as sentences it must
 * say.
 *
 * WHY THIS IS DATA AND NOT CODE
 * ---------------------------------------------------------------------------
 * A business's facts change far more often than its software does. Pricing
 * moves, a plan is renamed, a policy is clarified. If those live in TypeScript,
 * changing one is a code review, a build and a deploy; and - worse - the person
 * who knows the correct answer is not the person who can edit the file.
 *
 * So a profile is a JSON document. `src/context/profiles/default.json` is the
 * committed default; `loadBusinessProfile({ profilePath })` reads a replacement
 * from disk. Changing what the agent knows about the business is editing a JSON
 * file, with no TypeScript involved. `CONVERSATION_CONTEXT.md` § "Changing the
 * business profile without touching code" is the instructions for doing it.
 *
 * WHY IT IS VALIDATED, AND WHAT THE VALIDATION IS ACTUALLY FOR
 * ---------------------------------------------------------------------------
 * Two different jobs, and the second is the interesting one.
 *
 *  1. SHAPE. `.strict()` throughout, so a typo'd key is a loud refusal rather
 *     than a fact that silently never reaches the model. A profile that does
 *     not load stops the process; an agent running on half a profile would
 *     confidently not know its own pricing.
 *
 *  2. ANTI-SCRIPTING. Every free-text string is checked by
 *     `findDialogueShape` (src/context/dialogueShape.ts). A profile that
 *     carries `"Great - let me get that booked for you!"`, or an
 *     if-they-object-then-say-this entry, FAILS TO LOAD. This is the mission's
 *     governing rule enforced at the data layer: the most likely way a canned
 *     response sneaks into a system with no canned responses in its code is
 *     through its configuration, and this closes that door mechanically rather
 *     than by asking people nicely.
 *
 * WHAT IS DELIBERATELY ABSENT FROM THE SCHEMA
 * ---------------------------------------------------------------------------
 * There is no field for an opening line, a pitch, an objection rebuttal, a
 * closing line, a question sequence, or a call flow. Not "there is a field and
 * we left it empty" - there is no field, so no profile can express one. The
 * schema is the design document for what a business is allowed to tell this
 * agent, and it is allowed to tell it facts and goals.
 */
import { z } from 'zod';
import { readFileSync } from 'node:fs';

import { ConfigurationError } from '../shared/errors.js';
import { findDialogueShape } from './dialogueShape.js';
import defaultProfileDocument from './profiles/default.json';

/**
 * Bumped when the SHAPE changes incompatibly.
 *
 * A profile declares the version it was written for and is refused if it does
 * not match, because silently reading a v1 document with v2 expectations is how
 * an agent ends up quoting a price nobody set.
 */
export const BUSINESS_PROFILE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// The primitive: a fact-shaped string
// ---------------------------------------------------------------------------

/**
 * Free text that has been checked for dialogue shape.
 *
 * The length ceiling is not cosmetic. A 2,000-character "fact" is a paragraph
 * somebody intends to be read out; keeping facts short keeps them facts, and
 * keeps the whole profile inside the context budget a 7B model actually has.
 */
function factString(max = 320) {
  return z
    .string()
    .trim()
    .min(3)
    .max(max)
    .superRefine((value, ctx) => {
      const finding = findDialogueShape(value);
      if (finding) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `Reads as dialogue, not as a fact (${finding.ruleId}: matched "${finding.matched}"). ` +
            `${finding.why} Rewrite it as something that is TRUE about the business, and let the model ` +
            'decide how to put it into words.',
        });
      }
    });
}

const Fact = factString();
const LongFact = factString(600);
/** An identifier used to cross-reference a fact. Never shown to a contact. */
const Slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Must be a lowercase slug, e.g. "pro_plan" or "data-residency".')
  .max(60);

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const CompanySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** One sentence of what the company is. A fact, not a tagline to recite. */
    whatWeAre: Fact,
    whatWeDo: LongFact,
    /** Verifiable proof points: customer counts, years, certifications. */
    proofPoints: z.array(Fact).max(12).default([]),
    /** Where the company operates, for timezone and coverage questions. */
    operatingRegions: z.array(Fact).max(12).default([]),
    website: z.string().trim().max(200).optional(),
  })
  .strict();

/**
 * Who the agent is, in facts about identity and manner.
 *
 * `voiceTraits` describes HOW to sound, which is legitimate persona and not a
 * script - "unhurried" constrains delivery without supplying a single word.
 * `mustDisclose` is the honesty floor: things a contact is entitled to be told,
 * such as that they are speaking with an AI.
 */
const PersonaSchema = z
  .object({
    agentName: z.string().trim().min(1).max(80),
    role: Fact,
    voiceTraits: z.array(Fact).min(1).max(12),
    mustDisclose: z.array(Fact).max(8).default([]),
    /** Subjects this agent has no standing to discuss at all. */
    outOfScope: z.array(Fact).max(12).default([]),
  })
  .strict();

const ProductSchema = z
  .object({
    id: Slug,
    name: z.string().trim().min(1).max(120),
    summary: Fact,
    bestFor: Fact,
    capabilities: z.array(Fact).max(20).default([]),
    /** What it genuinely does NOT do. The most useful facts in the document. */
    limitations: z.array(Fact).max(20).default([]),
    integrations: z.array(Fact).max(20).default([]),
  })
  .strict();

const PricingPlanSchema = z
  .object({
    id: Slug,
    name: z.string().trim().min(1).max(120),
    /** The number itself, spelled as the business spells it. */
    headlinePrice: z.string().trim().min(1).max(120),
    billingPeriod: z.string().trim().min(1).max(60),
    includes: z.array(Fact).max(20).default([]),
    notes: z.array(Fact).max(10).default([]),
  })
  .strict();

const PricingSchema = z
  .object({
    currency: z.string().trim().min(1).max(20),
    plans: z.array(PricingPlanSchema).max(12).default([]),
    /** True statements about discounting. Not permission to offer one. */
    discountFacts: z.array(Fact).max(12).default([]),
    /**
     * Commercial actions this agent cannot take.
     *
     * Note this is a list of FACTS ABOUT AUTHORITY, and it duplicates nothing:
     * the actual enforcement is `AgentConfiguration.allowedToolsJson` plus the
     * nine-tool contract. Saying it here as well means a cooperative model does
     * not have to discover the limit by being refused.
     */
    agentMayNotCommit: z.array(Fact).max(12).default([]),
  })
  .strict();

const PolicyFactSchema = z
  .object({
    id: Slug,
    topic: z.string().trim().min(1).max(120),
    fact: LongFact,
  })
  .strict();

/**
 * A subject a contact may raise, and what is TRUE about it.
 *
 * This is the closest thing in the schema to an objection-handling section, and
 * the difference is the whole point: `facts` are true statements about the
 * subject. There is no `response` field, no `rebuttal` field and no `say`
 * field, because the model writes the sentence. If a contact says the price is
 * high, the model gets the real numbers, the real discount policy and the real
 * contract terms - and composes an answer from them, in the register of the
 * conversation it is actually in.
 */
const TopicFactsSchema = z
  .object({
    id: Slug,
    /** What the subject IS, e.g. "Price compared to incumbent tools". */
    topic: z.string().trim().min(1).max(160),
    facts: z.array(Fact).min(1).max(12),
  })
  .strict();

/**
 * What the business is trying to achieve, and what it wants to learn.
 *
 * `knowledgeGoals` may name a rubric factor from
 * `src/agent/tools/qualificationRubric.ts`. When it does, the context assembler
 * can tell from the PERSISTED `QualificationState.factorsJson` whether that
 * goal is already met, and present the unmet ones as open unknowns - facts
 * about the state of our knowledge, in no priority order, never as a list of
 * questions to work through.
 */
const KnowledgeGoalSchema = z
  .object({
    id: Slug,
    /** A noun phrase naming what we do not yet know. Never a question to ask. */
    whatWeWantToKnow: Fact,
    whyItMatters: Fact,
    /** Optional link to a rubric factor name, so "known" can be computed. */
    rubricFactor: z.string().trim().max(60).optional(),
  })
  .strict();

const ObjectivesSchema = z
  .object({
    /** The standing commercial objective of a conversation with this agent. */
    primary: Fact,
    supporting: z.array(Fact).max(10).default([]),
    knowledgeGoals: z.array(KnowledgeGoalSchema).max(12).default([]),
    /** What a good outcome looks like when a meeting is not on the table. */
    acceptableOutcomes: z.array(Fact).max(10).default([]),
  })
  .strict();

const MeetingTypeSchema = z
  .object({
    id: Slug,
    name: z.string().trim().min(1).max(120),
    durationMinutes: z.number().int().min(5).max(480),
    whatHappens: Fact,
    whoAttends: Fact,
  })
  .strict();

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export const BusinessProfileSchema = z
  .object({
    schemaVersion: z.literal(BUSINESS_PROFILE_SCHEMA_VERSION),
    /**
     * Stable, versioned identity of this profile, e.g. `northwind@v1`.
     *
     * Recorded in the turn's disclosure map, so an audit can say which exact
     * set of business facts the model was told - the same discipline
     * `systemPromptRef` already applies to the guardrails.
     */
    profileRef: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9_-]*@v\d+$/, 'Must look like "northwind@v1".')
      .max(80),
    company: CompanySchema,
    persona: PersonaSchema,
    products: z.array(ProductSchema).min(1).max(12),
    pricing: PricingSchema,
    policies: z.array(PolicyFactSchema).max(24).default([]),
    topics: z.array(TopicFactsSchema).max(24).default([]),
    objectives: ObjectivesSchema,
    meetingTypes: z.array(MeetingTypeSchema).max(8).default([]),
  })
  .strict();

export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;
export type BusinessProfileProduct = z.infer<typeof ProductSchema>;
export type BusinessProfileKnowledgeGoal = z.infer<typeof KnowledgeGoalSchema>;
export type BusinessProfileMeetingType = z.infer<typeof MeetingTypeSchema>;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface LoadBusinessProfileOptions {
  /**
   * Path to a JSON profile that REPLACES the committed default.
   *
   * Replaces rather than merges, deliberately. A deep merge of business facts
   * produces a document nobody wrote: half this quarter's pricing and half last
   * quarter's, with no way to tell by reading either file. A profile is a whole
   * statement of what is true, or it is nothing.
   */
  readonly profilePath?: string | null;
}

/**
 * Load and validate a profile.
 *
 * Throws `ConfigurationError` rather than returning a partial profile or
 * falling back to the default. An agent that quietly reverts to last quarter's
 * prices because this quarter's file had a typo is worse than an agent that
 * will not start - the first misleads a customer, the second wakes an engineer.
 */
export function loadBusinessProfile(options: LoadBusinessProfileOptions = {}): BusinessProfile {
  const path = options.profilePath?.trim();
  if (!path) {
    return parseBusinessProfile(defaultProfileDocument, 'src/context/profiles/default.json (committed default)');
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ConfigurationError(
      `Could not read the business profile at "${path}": ${(error as Error).message}. ` +
        'Leave the path unset to use the committed default profile.',
      { details: { profilePath: path } },
    );
  }

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    throw new ConfigurationError(
      `The business profile at "${path}" is not valid JSON: ${(error as Error).message}.`,
      { details: { profilePath: path } },
    );
  }

  return parseBusinessProfile(document, path);
}

/** Validate an already-parsed document. Exported so a CLI can lint a file. */
export function parseBusinessProfile(document: unknown, source: string): BusinessProfile {
  const parsed = BusinessProfileSchema.safeParse(document);
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
  throw new ConfigurationError(
    `The business profile from ${source} is not valid:\n  - ${issues.join('\n  - ')}`,
    { details: { source, issues } },
  );
}

/**
 * The committed default, parsed.
 *
 * A function rather than a constant so that a caller who never asks for it
 * never pays for the validation, and so that the anti-scripting checks run at a
 * point where their failure is attributable.
 */
export function defaultBusinessProfile(): BusinessProfile {
  return loadBusinessProfile();
}
