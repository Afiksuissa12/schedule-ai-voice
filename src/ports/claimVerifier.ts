/**
 * PORT: the SEMANTIC CLAIM VERIFIER - the second opinion, and nothing else.
 *
 * WHY THIS PORT EXISTS, IN ONE PARAGRAPH
 * ---------------------------------------------------------------------------
 * `src/agent/claimGate/detector.ts` is a deterministic lexicon detector, and
 * eight successive independent QA rounds each found a phrasing shape it did not
 * recognise. Each one leaked a false success claim to a contact and persisted it
 * with no effect behind it. `docs/MISSION_2D_CLAIM_GATE.md` § 17.8 states the
 * reason the sequence does not terminate: *the RULES over the lexicon are now
 * general; the LEXICON is not, is not closeable by enumeration, and is the live
 * fail-open surface.* A second, SEMANTIC reader is the Founder's answer to that
 * specific surface.
 *
 * THE AUTHORITY BOUNDARY IS IN THE TYPES, NOT IN A COMMENT
 * ---------------------------------------------------------------------------
 * § 4.1 of the same document argues, correctly, that putting a guarantee inside
 * a second model call puts it back where it already failed. This port is shaped
 * so that argument does not apply to it, and the shaping is mechanical rather
 * than a promise:
 *
 *  1. THE REQUEST CARRIES NOTHING THAT CAN CAUSE AN EFFECT. Three fields: the
 *     proposed text, an optional locale hint, a correlation id for the audit
 *     trail. No `ActionLedger`, no `Database`, no repository, no
 *     `ToolDispatcher`, no tool definitions, no `Clock`, and none of
 *     `src/ports/{telephony,calendar,availability}`. A verifier cannot book, or
 *     cancel, or phone, or write a row, because nothing it is handed can.
 *     `tests/invariants/verifierAuthorityBoundary.test.ts` asserts the same
 *     property one level up, over the whole implementation directory.
 *
 *  2. THE RESULT HAS NO VOCABULARY FOR "SUPPORTED". There is no `supported`,
 *     no `ok`, no `effectExists`, no `verified` and no `clean` field anywhere
 *     below, and there must never be one. The verifier answers exactly one
 *     question - *does this text claim or imply that a material action has
 *     happened, or has been committed to* - and the answer to *did it actually
 *     happen* is made by deterministic code comparing the classification with
 *     the action ledger, in `src/agent/claimGate/verifier.ts`, which is the only
 *     module in this repository entitled to that vocabulary.
 *
 *  3. "CLEAN" IS UNREPRESENTABLE AS A FAILURE. `SemanticClaimVerdict` is a
 *     discriminated union with ONE success variant and FOUR explicit failure
 *     variants. A timeout is not an empty claim list; malformed output is not an
 *     empty claim list; an unreachable verifier is not an empty claim list. A
 *     consumer that forgets a variant fails `npm run typecheck` rather than
 *     silently reading a failure as an all-clear, which is the exact mistake
 *     § 20 records the deterministic verifier making with a `null` day.
 *
 *  4. IT MAY ONLY ADD SUSPICION. Nothing here can clear, suppress or downgrade
 *     a claim the deterministic detector found. That is enforced by
 *     `unionClaims` in `src/agent/claimGate/semantic/union.ts` and proven by a
 *     superset property test, not by this comment.
 *
 * WHAT A FAILURE COSTS, STATED HERE BECAUSE IT IS A PRODUCT FACT
 * ---------------------------------------------------------------------------
 * Every failure variant is treated as UNSUPPORTED by the gate. So a verifier
 * outage does not degrade to the previous behaviour - it hands off every
 * CLAIMING turn to a human. That is the fail-safe direction the Founder chose
 * and it belongs in a fail-closed matrix rather than in a production incident.
 * A turn that claims nothing is unaffected: the union is empty, nothing needs
 * reconciling, and the text is released.
 *
 * Implementations live in `src/agent/claimGate/semantic/`.
 */

/**
 * The kind of real-world effect a semantic claim is about.
 *
 * DELIBERATELY DECLARED HERE RATHER THAN IMPORTED. `src/ports` imports nothing
 * from the layers above it (`docs/ARCHITECTURE.md` § 2), and
 * `ClaimEffectFamily` lives in `src/agent/claimGate/lexicon/types.ts`. Declaring
 * the same eight members twice would be drift waiting to happen, so it is not
 * left to discipline: `src/agent/claimGate/semantic/schema.ts` carries a
 * compile-time assertion that the two types are mutually assignable, and
 * `tests/agent/semanticClaimSchema.test.ts` compares the two arrays at runtime.
 * Adding a family on either side without the other is a red build.
 */
export const SEMANTIC_CLAIM_EFFECT_FAMILIES = [
  'MEETING',
  'RESCHEDULE',
  'CANCELLATION',
  'CALLBACK',
  'MESSAGE',
  'RECORD',
  'HANDOVER',
  'ANY',
] as const;

export type SemanticClaimEffectFamily = (typeof SEMANTIC_CLAIM_EFFECT_FAMILIES)[number];

/**
 * How strongly the text asserts the effect.
 *
 * `COMPLETED` and `COMMITTED` map one-to-one onto the existing
 * `ClaimAssertionMode`, and the same compile-time assertion guards that pair.
 *
 * `ATTEMPTED` and `NOT_CLAIMED` exist so the model has somewhere honest to put a
 * sentence it read and decided asserts nothing - *"let me get that booked"*,
 * *"I am checking now"*. They CONTRIBUTE NOTHING to the union: a claim in either
 * status is dropped before reconciliation. That is not the verifier clearing
 * anything, because the deterministic layer's own verdict on the same text is
 * untouched and travels into the union regardless.
 */
export const SEMANTIC_CLAIM_STATUSES = ['COMPLETED', 'COMMITTED', 'ATTEMPTED', 'NOT_CLAIMED'] as const;

export type SemanticClaimStatus = (typeof SEMANTIC_CLAIM_STATUSES)[number];

/**
 * One claim the verifier says the text makes.
 *
 * EVERY QUOTED FIELD IS VERBATIM FROM THE TEXT, and that is validated rather
 * than requested: a `whenPhrase` or an `identifier` that does not occur in the
 * text makes the whole output MALFORMED. The rule and exactly how containment is
 * checked are in `src/agent/claimGate/semantic/schema.ts`. Quoting rather than
 * paraphrasing is what stops the verifier inventing a day, an hour or a
 * reference number - it can only ever point at bytes that are already there.
 */
export interface SemanticClaim {
  /**
   * Does this claim assert that a material action HAPPENED or WAS COMMITTED TO?
   *
   * A statement ABOUT the text, never about the world. `false` here is not
   * evidence that nothing happened and is not evidence that the text is safe;
   * it only means this layer found nothing, and the deterministic layer's
   * finding stands whatever this says.
   */
  readonly assertsEffect: boolean;
  readonly effectFamily: SemanticClaimEffectFamily;
  readonly status: SemanticClaimStatus;
  /** The day or time phrase the text asserts, QUOTED VERBATIM. `null` when it names none. */
  readonly whenPhrase: string | null;
  /** The identifier the text reads out, QUOTED VERBATIM. `null` when it names none. */
  readonly identifier: string | null;
  /**
   * 0..1.
   *
   * RECORDED, AND DELIBERATELY NOT A THRESHOLD. Nothing in the gate branches on
   * it: a low-confidence claim is reconciled against the ledger exactly like a
   * high-confidence one, because a threshold is a way for a model's own
   * uncertainty to clear a claim, and this layer may not clear anything. It is
   * here so an auditor and the eval corpus can see what the model thought.
   */
  readonly confidence: number;
}

/**
 * What the verifier is asked.
 *
 * THE FIELD LIST IS THE AUTHORITY BOUNDARY. Adding anything to it that can
 * cause an effect, read state, or reveal what the records say would undo the
 * whole design - in particular, the verifier is NOT told what the ledger
 * contains, because a classifier that can see the answer is a classifier that
 * can be argued into agreeing with it.
 */
export interface SemanticClaimVerificationRequest {
  /** The proposed customer-facing text, exactly as the model produced it. */
  readonly text: string;
  /**
   * OPTIONAL. A hint about the language, e.g. `he`. A hint only: the verifier
   * must read whatever it is given, and a wrong or absent hint may cost
   * accuracy and may never cost safety, because a missed claim still faces the
   * deterministic layer and a failed verifier is UNSUPPORTED.
   */
  readonly localeHint?: string;
  /** The TURN's correlation id, so the audit chain is one chain. */
  readonly correlationId: string;
}

/** Every `kind` a verdict can carry. */
export const SEMANTIC_CLAIM_VERDICT_KINDS = [
  'CLASSIFIED',
  'MALFORMED',
  'TIMED_OUT',
  'UNAVAILABLE',
  'EMPTY',
] as const;

export type SemanticClaimVerdictKind = (typeof SEMANTIC_CLAIM_VERDICT_KINDS)[number];

/**
 * The four kinds that are NOT a classification.
 *
 * Exported as its own list because the gate, the audit trail and the fail-closed
 * matrix all need to iterate exactly these, and a filter over the list above
 * would silently start including a fifth success variant if anybody ever added
 * one.
 */
export const SEMANTIC_CLAIM_FAILURE_KINDS = ['MALFORMED', 'TIMED_OUT', 'UNAVAILABLE', 'EMPTY'] as const;

export type SemanticClaimFailureKind = (typeof SEMANTIC_CLAIM_FAILURE_KINDS)[number];

/** The verifier read the text and produced a classification. */
export interface SemanticClaimClassification {
  readonly kind: 'CLASSIFIED';
  /**
   * Every claim it found. EMPTY IS A LEGITIMATE ANSWER and means "I read this
   * text and found no action claim in it" - which is a different statement from
   * every variant below, and is why those variants exist.
   *
   * It is still not an all-clear. The deterministic layer may have found
   * something here, and if it did, the union keeps it.
   */
  readonly claims: readonly SemanticClaim[];
  /** Which model produced this, when the implementation knows. For the audit trail only. */
  readonly modelId: string | null;
}

/** The output did not parse, did not validate, or quoted text that is not there. */
export interface SemanticClaimMalformed {
  readonly kind: 'MALFORMED';
  /** Machine-readable-ish, for an audit detail. Never a customer-facing sentence. */
  readonly reason: string;
}

/** The bounded deadline in application code expired. */
export interface SemanticClaimTimedOut {
  readonly kind: 'TIMED_OUT';
  readonly reason: string;
}

/** The provider errored, refused, or is not reachable. */
export interface SemanticClaimUnavailable {
  readonly kind: 'UNAVAILABLE';
  readonly reason: string;
}

/** The verifier answered with nothing at all - no text, or whitespace. */
export interface SemanticClaimEmpty {
  readonly kind: 'EMPTY';
  readonly reason: string;
}

/**
 * The result.
 *
 * FIVE VARIANTS, AND THE FOUR FAILURES ARE NAMED SEPARATELY ON PURPOSE. They
 * are all treated identically by the gate - every one is UNSUPPORTED - so
 * collapsing them into one `FAILED` variant would lose nothing operationally and
 * everything diagnostically. An operator asking *why did last night hand off
 * four hundred turns* needs to tell a dead Ollama (UNAVAILABLE) from a model
 * that started emitting prose (MALFORMED) from a host under load (TIMED_OUT),
 * and those have completely different fixes.
 */
export type SemanticClaimVerdict =
  | SemanticClaimClassification
  | SemanticClaimMalformed
  | SemanticClaimTimedOut
  | SemanticClaimUnavailable
  | SemanticClaimEmpty;

/** Is this verdict one of the four failures? Narrows, so a caller cannot read `claims` off it. */
export function isSemanticClaimFailure(
  verdict: SemanticClaimVerdict,
): verdict is SemanticClaimMalformed | SemanticClaimTimedOut | SemanticClaimUnavailable | SemanticClaimEmpty {
  return verdict.kind !== 'CLASSIFIED';
}

/**
 * The port.
 *
 * ONE METHOD, and the narrowness is the point. `verifierName` is a property
 * rather than a method so that the interface has exactly one behaviour on it and
 * an implementation has exactly one thing it can be asked to do. There is no
 * `execute`, no `approve`, no `correct`, no `suggest` and no `rewrite`, and
 * adding one would be an architecture change rather than an extension.
 */
export interface SemanticClaimVerifier {
  /** Stable identity, recorded in audit events, e.g. `llm-semantic-claim-verifier`. */
  readonly verifierName: string;

  /**
   * Classify what the text CLAIMS. Never decide whether it is true.
   *
   * MUST NOT THROW. Every failure mode - a provider error, a timeout, an empty
   * answer, output that does not validate - comes back as the corresponding
   * fail-closed variant, because an exception escaping into `ClaimGate.review`
   * would abort the turn rather than block the sentence, and a turn that threw
   * is a turn nobody classified.
   */
  classify(request: SemanticClaimVerificationRequest): Promise<SemanticClaimVerdict>;
}
