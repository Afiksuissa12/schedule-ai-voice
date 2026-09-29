/**
 * THE VERIFIER'S OUTPUT CONTRACT, AND THE RULE THAT MAKES IT FAIL CLOSED.
 *
 * Two artefacts that must agree, and a test that makes them:
 *
 *   - `SemanticVerifierOutputSchema`, a Zod `.strict()` schema, which is what
 *     application code VALIDATES against. Nothing reaches the union without
 *     passing it.
 *   - `SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA`, a frozen JSON Schema literal,
 *     which is what the MODEL is constrained by on the wire.
 *
 * WHY TWO, AND WHY THE SECOND IS HAND-WRITTEN
 * ---------------------------------------------------------------------------
 * This repository already generates JSON Schema from Zod
 * (`src/agent/tools/jsonSchema.ts`), and generating is the right answer for the
 * nine tools - the entire value of it is that the model is told exactly what the
 * dispatcher will accept. It is the wrong answer HERE, for one structural
 * reason: `tests/invariants/verifierAuthorityBoundary.test.ts` requires that
 * nothing in this directory imports `src/agent/tools`, because that is the
 * module tree through which an effect is caused. A verifier that imported the
 * tool layer to borrow a converter would have a path to the dispatcher in its
 * import graph, and the boundary test is worth more than the convenience.
 *
 * So the literal is written out, and DRIFT IS MADE A TEST RATHER THAN A RISK:
 * `tests/agent/semanticClaimSchema.test.ts` asserts the JSON Schema's
 * `properties` keys are exactly the Zod object's keys, that `required` lists all
 * of them, that `additionalProperties` is false at both levels, and that both
 * enum lists are the exported arrays. A field added to one and not the other is
 * a red build.
 *
 * THE FAIL-CLOSED RULE, IN ONE SENTENCE
 * ---------------------------------------------------------------------------
 * Anything that is not exactly this shape - unparseable, missing a field, an
 * out-of-enum value, a wrong type, an unknown key, a confidence outside 0..1, or
 * a quoted phrase that does not occur in the text - is MALFORMED, and MALFORMED
 * is UNSUPPORTED. There is no lenient path, no coercion, no partial acceptance
 * of the claims that did validate. The § 20 defect in this gate's own history is
 * what that rule is written against: a value the code could not read was treated
 * as a value asserting nothing, and eleven false sentences were certified.
 */
import { z } from 'zod';

import { normalizeScript } from '../../../scheduling/lexicon/script.js';
import {
  SEMANTIC_CLAIM_EFFECT_FAMILIES,
  SEMANTIC_CLAIM_STATUSES,
  type SemanticClaim,
  type SemanticClaimEffectFamily,
  type SemanticClaimStatus,
} from '../../../ports/claimVerifier.js';
import type { ClaimAssertionMode, ClaimEffectFamily } from '../lexicon/types.js';

// ---------------------------------------------------------------------------
// The two enums are the EXISTING ones, proven at compile time
// ---------------------------------------------------------------------------

/**
 * `X` and `Y` are the SAME type, not merely assignable one way.
 *
 * The identity-function trick rather than `X extends Y ? ... : ...`, because a
 * conditional distributes over a union and would answer `true` for a subset. A
 * type error from one of the two assertions below is the only warning a reader
 * gets that the port's copy of a claim-gate enum has drifted from the claim gate's
 * own, and it is deliberately a COMPILE error rather than a runtime one: the
 * arrays are also compared by a test, but a build that cannot express the drift at
 * all is the stronger guard.
 */
type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

/** Fails to compile unless `T` is exactly `true`. */
type Assert<T extends true> = T;

/** `SemanticClaimEffectFamily` IS `ClaimEffectFamily`. Both directions. */
export type SemanticFamiliesMatchTheLexicon = Assert<Equals<SemanticClaimEffectFamily, ClaimEffectFamily>>;

/**
 * The two MATERIAL statuses ARE `ClaimAssertionMode`. Both directions.
 *
 * `ATTEMPTED` and `NOT_CLAIMED` are deliberately outside this: they have no
 * `ClaimAssertionMode` counterpart because they contribute no claim, which is
 * the whole reason they exist.
 */
export type SemanticMaterialStatusesMatchTheLexicon = Assert<
  Equals<Extract<SemanticClaimStatus, 'COMPLETED' | 'COMMITTED'>, ClaimAssertionMode>
>;

/** The statuses that produce a claim. Everything else contributes nothing. */
export const MATERIAL_SEMANTIC_CLAIM_STATUSES: readonly SemanticClaimStatus[] = ['COMPLETED', 'COMMITTED'];

// ---------------------------------------------------------------------------
// The Zod schema - what application code validates against
// ---------------------------------------------------------------------------

/**
 * `.strict()` on both objects, on the same principle as
 * `src/agent/tools/definitions.ts`: an unknown key is a model that has invented
 * a field, and a field nobody declared is a field nobody validated. Accepting it
 * silently is how a classifier starts smuggling an opinion past the schema.
 */
export const SemanticClaimSchema = z
  .object({
    assertsEffect: z.boolean(),
    effectFamily: z.enum(SEMANTIC_CLAIM_EFFECT_FAMILIES),
    status: z.enum(SEMANTIC_CLAIM_STATUSES),
    // `.nullable()` and NOT `.optional()`. A missing key is a model that did not
    // answer the question; an explicit `null` is a model that answered "none".
    // Requiring the key makes the difference visible instead of guessing.
    whenPhrase: z.string().nullable(),
    identifier: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const SemanticVerifierOutputSchema = z
  .object({
    claims: z.array(SemanticClaimSchema),
  })
  .strict();

export type SemanticVerifierOutput = z.infer<typeof SemanticVerifierOutputSchema>;

// ---------------------------------------------------------------------------
// The JSON Schema - what the model is constrained by
// ---------------------------------------------------------------------------

/**
 * Handed to the provider as `CompleteTurnRequest.responseJsonSchema`, which
 * `src/llm/ollama/mapping.ts` puts in Ollama's `format`.
 *
 * Frozen because it is shared by every request and a shared mutable schema is a
 * schema one caller can edit for everybody.
 */
export const SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['assertsEffect', 'effectFamily', 'status', 'whenPhrase', 'identifier', 'confidence'],
        properties: {
          assertsEffect: { type: 'boolean' },
          effectFamily: { type: 'string', enum: [...SEMANTIC_CLAIM_EFFECT_FAMILIES] },
          status: { type: 'string', enum: [...SEMANTIC_CLAIM_STATUSES] },
          whenPhrase: { type: ['string', 'null'] },
          identifier: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Grounding
// ---------------------------------------------------------------------------

/**
 * IS THIS QUOTED PHRASE ACTUALLY IN THE TEXT?
 *
 * WHY THIS CHECK EXISTS AT ALL. `whenPhrase` and `identifier` travel into the
 * reconciliation: a when-phrase becomes `unreadTemporal` on the union claim and
 * an identifier is checked against the ledger's issued set. A model that
 * PARAPHRASED rather than quoted would put a string into the audit trail, the
 * regeneration instruction and the identifier comparison that the customer-facing
 * text never contained - which is the verifier inventing evidence, at the exact
 * point where this design's whole argument is that it cannot. So a quoted phrase
 * that is not in the text is not a small inaccuracy; it is malformed output.
 *
 * HOW CONTAINMENT IS CHECKED, EXACTLY, IN THREE STEPS AND NO MORE
 * ---------------------------------------------------------------------------
 *  1. RAW SUBSTRING CONTAINMENT, `text.includes(phrase)`, byte for byte, with no
 *     normalisation, no case folding and no trimming beyond the phrase's own
 *     leading and trailing whitespace. This is the strict reading and it is
 *     tried first, because a phrase that survives it is unambiguously present.
 *
 *  2. IF AND ONLY IF STEP 1 FAILS, THE SAME TEST OVER `normalizeScript`'d FORMS
 *     of both strings, lower-cased. `normalizeScript`
 *     (`src/scheduling/lexicon/script.ts`) is the project's existing
 *     normalisation and is exactly what `src/agent/claimGate/text.ts` runs
 *     before tokenising, so this fallback agrees with the detector rather than
 *     inventing a second notion of sameness.
 *
 *  3. IF AND ONLY IF STEP 2 ALSO FAILS, THE SAME TEST AGAIN WITH EVERY RUN OF
 *     WHITESPACE ON BOTH SIDES WRITTEN AS ONE SPACE. **MISSION 2G ADDED THIS
 *     STEP, AND IT IS HERE TO REPAIR A FAILURE THIS REPOSITORY NOW CAUSES
 *     ITSELF.** `./segmentation.ts` presents the text to the model a second time
 *     as numbered segments whose line breaks are written as single spaces, so
 *     that a label and the words continuing it read as one line. A model quoting
 *     a phrase out of a segment is therefore quoting a form in which a newline
 *     has become a space - and without this step, that phrase would be rejected
 *     as ungrounded, making the output MALFORMED because of how WE chose to
 *     display it. `normalizeScript` does not touch whitespace, so step 2 cannot
 *     absorb it.
 *
 *     IT FORGIVES WHITESPACE AND NOTHING ELSE. Every letter, digit and mark still
 *     has to be present, in order, with no gap that is not whitespace in the
 *     original. A paraphrase still fails, a translated day name still fails, an
 *     invented reference still fails, and a phrase assembled from two places in
 *     the text still fails. It is a test in
 *     `tests/agent/semanticSegmentation.test.ts`.
 *
 * WHY THE FALLBACK IS NEEDED AND WHY IT IS NOT A LOOPHOLE. Hebrew is the reason,
 * and it is a real one rather than a hypothetical: `normalizeScript` strips
 * niqqud and the bidi control characters, and a model quoting a Hebrew phrase
 * back will not reliably reproduce an invisible RLM or a vowel point that was in
 * the original. Failing those would make the verifier MALFORMED on ordinary
 * Hebrew traffic, which is a fail-closed DoS on the one language that has no
 * recommended model. The fallback is narrow in the way that matters: it can only
 * ever forgive characters `normalizeScript` removes or folds - it does not
 * tokenise, does not stem, does not reorder and does not match across a gap. A
 * paraphrase still fails.
 *
 * THE DIRECTION OF THE REMAINING RISK, NAMED. Step 2 lower-cases, so a verifier
 * quoting `thursday` for a text saying `Thursday` is accepted. That is a
 * casing difference and not a different day. It is the one forgiveness in here
 * that is not strictly script normalisation, it is stated rather than hidden,
 * and it is a test in `tests/agent/semanticClaimSchema.test.ts`.
 *
 * AND THE COST OF BEING WRONG IS THE SAFE ONE EITHER WAY. A phrase wrongly
 * REJECTED makes the output MALFORMED, which is UNSUPPORTED, which is one
 * regeneration of a sentence that may have been true. A phrase wrongly ACCEPTED
 * becomes `unreadTemporal`, which is also UNSUPPORTED. Neither direction can
 * release a sentence that would otherwise have been blocked.
 */
export function isGroundedInText(phrase: string, text: string): boolean {
  const quoted = phrase.trim();
  // An empty quotation grounds nothing and is not the same as `null`. The model
  // was asked for a phrase or for null, and `""` is neither.
  if (quoted.length === 0) return false;

  // Step 1: raw, byte-for-byte.
  if (text.includes(quoted)) return true;

  // Step 2: the project's own script normalisation, on both sides, then case.
  const normalizedText = normalizeScript(text).text.toLowerCase();
  const normalizedPhrase = normalizeScript(quoted).text.toLowerCase().trim();
  if (normalizedPhrase.length === 0) return false;
  if (normalizedText.includes(normalizedPhrase)) return true;

  // Step 3: the same again with whitespace runs written as one space. Applied to
  // the step-2 forms rather than to the raw ones, so it is strictly a widening of
  // step 2 and can never accept something step 2 already rejected for a reason
  // other than whitespace.
  const flatPhrase = collapseWhitespace(normalizedPhrase);
  if (flatPhrase.length === 0) return false;
  return collapseWhitespace(normalizedText).includes(flatPhrase);
}

/** Every run of whitespace, in any script, written as a single space. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

export type ParsedSemanticOutput =
  | { readonly ok: true; readonly claims: readonly SemanticClaim[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Parse and validate one verifier answer, against the text it is about.
 *
 * `raw` is whatever the provider put in the assistant channel. It is UNTRUSTED
 * in exactly the sense `ToolCallRequest.argumentsJson` is untrusted, and it gets
 * the same treatment: parse, validate strictly, and refuse rather than repair.
 *
 * Returns a reason string rather than throwing, because the caller's job is to
 * turn a refusal into a `MALFORMED` verdict and a thrown error would escape past
 * the gate.
 */
export function parseSemanticVerifierOutput(raw: string, text: string): ParsedSemanticOutput {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'the verifier returned an empty body' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return {
      ok: false,
      reason: `the verifier's answer is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const result = SemanticVerifierOutputSchema.safeParse(parsed);
  if (!result.success) {
    // The issue paths and codes, not the offending values: this string lands in
    // an audit detail and in a model-facing instruction, and echoing arbitrary
    // model output into either is how a sentence gets laundered into a place it
    // does not belong.
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
      .join('; ');
    return { ok: false, reason: `the verifier's answer failed schema validation - ${issues}` };
  }

  // Grounding is checked AFTER the schema, because a phrase that is not a string
  // cannot be looked for and reporting "not grounded" for a number would be a
  // misleading reason.
  for (const [index, claim] of result.data.claims.entries()) {
    if (claim.whenPhrase !== null && !isGroundedInText(claim.whenPhrase, text)) {
      return { ok: false, reason: `claims[${index}].whenPhrase does not occur in the text` };
    }
    if (claim.identifier !== null && !isGroundedInText(claim.identifier, text)) {
      return { ok: false, reason: `claims[${index}].identifier does not occur in the text` };
    }
  }

  return { ok: true, claims: result.data.claims };
}
