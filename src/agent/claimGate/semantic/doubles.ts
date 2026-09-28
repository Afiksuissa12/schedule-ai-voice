/**
 * THE TWO DETERMINISTIC DOUBLES for the semantic claim verifier.
 *
 * WHY THEY ARE ALLOWED TO EXIST
 * ---------------------------------------------------------------------------
 * `docs/DECISIONS.md` § 0: *`ScriptedLlmProvider` / deterministic model doubles
 * remain allowed and desirable **only** for automated deterministic tests.*
 * These are model-facing doubles of a model-facing classifier. NEITHER CONTAINS
 * A CUSTOMER-FACING STRING - not a greeting, not a confirmation, not a sentence
 * anybody could read out. What they contain is verdicts: enum members, booleans,
 * numbers, and phrases COPIED OUT OF THE TEXT THEY WERE GIVEN.
 *
 * WHY TWO, AND WHAT EACH IS FOR
 * ---------------------------------------------------------------------------
 *  - `ScriptedSemanticClaimVerifier` answers with whatever the test says, in
 *    order. It is the only way to exercise MALFORMED, TIMED_OUT, UNAVAILABLE and
 *    EMPTY without a model, and the only way to construct the case that matters
 *    most: a verifier that says a text is clean when the deterministic layer has
 *    flagged it. `ScriptedLlmProvider` is its exact analogue one layer down.
 *  - `RuleDrivenSemanticClaimVerifier` answers from deterministic rules over the
 *    text. It is what a test uses when it wants a plausible second opinion rather
 *    than a dictated one, and it is what the OFFLINE COMPOSITION WIRES.
 *
 * THE MOST IMPORTANT SENTENCE IN THIS FILE
 * ---------------------------------------------------------------------------
 * `new RuleDrivenSemanticClaimVerifier()` with no rules returns `CLASSIFIED` with
 * an EMPTY claim list for every text. That is the offline default, and it means
 * the offline pipeline ADDS NO SUSPICION WHATSOEVER. Saying that plainly matters
 * three ways:
 *
 *  1. It is why `npm test`, `npm run qa:sweep` and `npm run slice:demo` behave
 *     exactly as they did before this mission: the union equals the deterministic
 *     claim set, so every outcome, every audit detail and every released byte is
 *     unchanged.
 *  2. It is why nobody may read a green sweep as evidence that the semantic layer
 *     works. It is evidence that the PIPELINE works - that the layer is on every
 *     path, that the union is additive, that a fail-closed verdict blocks - and
 *     the sweep's own `docs/MISSION_2D_CLAIM_GATE.md` § 17.8 residual 1 already
 *     says the same thing about the independent oracle.
 *  3. It is NOT a hole. An empty claim list is a `CLASSIFIED` verdict, so it is a
 *     verdict; a missing verifier is `ABSENT`, is fail-closed, and is visible in
 *     the per-turn report. The two are different and the types keep them so.
 *
 * A double is DETERMINISTIC in the strong sense: no clock, no randomness, no
 * network, no I/O, and the same input produces the same verdict on every run and
 * in every process.
 */
import type {
  SemanticClaim,
  SemanticClaimEffectFamily,
  SemanticClaimStatus,
  SemanticClaimVerdict,
  SemanticClaimVerificationRequest,
  SemanticClaimVerifier,
} from '../../../ports/claimVerifier.js';

/** A `CLASSIFIED` verdict with no claims. The commonest thing a test wants. */
export function classifiedWithNoClaims(modelId: string | null = null): SemanticClaimVerdict {
  return { kind: 'CLASSIFIED', claims: [], modelId };
}

// ---------------------------------------------------------------------------
// The scripted double
// ---------------------------------------------------------------------------

export interface ScriptedSemanticClaimVerifierOptions {
  /** Answers for the first N calls, in order. */
  readonly script?: readonly SemanticClaimVerdict[];
  /**
   * What to answer once the script runs out.
   *
   * Defaults to `CLASSIFIED` with no claims, which is the neutral answer: it
   * adds nothing and removes nothing, so a test that scripted one verdict and
   * then stopped caring does not accidentally start exercising the fail-closed
   * path on its second call. A test that WANTS the fail-closed path after the
   * script sets this explicitly.
   */
  readonly onExhausted?: SemanticClaimVerdict;
  readonly name?: string;
}

export class ScriptedSemanticClaimVerifier implements SemanticClaimVerifier {
  readonly verifierName: string;

  private script: readonly SemanticClaimVerdict[];
  private readonly onExhausted: SemanticClaimVerdict;
  private cursor = 0;

  /**
   * Every request, in order.
   *
   * This is how a test proves the negative that matters: that the verifier was
   * handed the TEXT and the correlation id AND NOTHING ELSE. The request type
   * makes it impossible to hand over a ledger, and this array makes it checkable
   * that the gate really did call the layer on every attempt including the
   * regenerated ones.
   */
  readonly requests: SemanticClaimVerificationRequest[] = [];

  constructor(options: ScriptedSemanticClaimVerifierOptions = {}) {
    this.verifierName = options.name ?? 'scripted-semantic-claim-verifier';
    this.script = options.script ?? [];
    this.onExhausted = options.onExhausted ?? classifiedWithNoClaims();
  }

  /** Replace the script and rewind. For a test that has to seed a world first. */
  setScript(script: readonly SemanticClaimVerdict[]): void {
    this.script = script;
    this.cursor = 0;
  }

  async classify(request: SemanticClaimVerificationRequest): Promise<SemanticClaimVerdict> {
    this.requests.push(request);
    const step = this.script[this.cursor];
    this.cursor += 1;
    return step ?? this.onExhausted;
  }
}

// ---------------------------------------------------------------------------
// The rule-driven double
// ---------------------------------------------------------------------------

/**
 * One rule: a needle, and what finding it means.
 *
 * `needle` IS NOT A CUSTOMER-FACING SENTENCE AND MUST NEVER BE ONE. It is a
 * fragment a test supplies in order to steer this double, in exactly the way
 * `ScriptedLlmProvider`'s `ADVERSARIAL` catalogue supplies malformed arguments:
 * the value exists to be recognised, not to be spoken. Nothing in this file
 * declares a needle - the rule set is empty unless a caller passes one - which
 * is what keeps the anti-scripting check's reasoning about this module simple.
 */
export interface SemanticVerifierRule {
  /** Matched by plain, case-insensitive substring containment. Nothing else. */
  readonly needle: string;
  readonly effectFamily: SemanticClaimEffectFamily;
  readonly status: SemanticClaimStatus;
  /** Defaults to `true`. Set `false` to model a verifier that looked and found nothing. */
  readonly assertsEffect?: boolean;
  /**
   * A phrase to quote onto the claim. It MUST occur in the text or the claim is
   * dropped - see `classify` below. Omitted means `null`.
   */
  readonly whenPhrase?: string;
  /** Same rule as `whenPhrase`. */
  readonly identifier?: string;
  /** Defaults to 0.9. A number, so a test can pin what reaches the audit trail. */
  readonly confidence?: number;
}

export interface RuleDrivenSemanticClaimVerifierOptions {
  readonly rules?: readonly SemanticVerifierRule[];
  readonly name?: string;
  /**
   * Answer this instead of classifying, for every call.
   *
   * The seam a test uses to make a RULE-DRIVEN double fail closed without
   * swapping it for the scripted one - so a sweep or an e2e wiring can keep the
   * verifier it was built with and still exercise an outage.
   */
  readonly forcedVerdict?: SemanticClaimVerdict;
}

export class RuleDrivenSemanticClaimVerifier implements SemanticClaimVerifier {
  readonly verifierName: string;

  private readonly rules: readonly SemanticVerifierRule[];
  private readonly forcedVerdict: SemanticClaimVerdict | null;

  /** Every request, in order. Same purpose as the scripted double's. */
  readonly requests: SemanticClaimVerificationRequest[] = [];

  constructor(options: RuleDrivenSemanticClaimVerifierOptions = {}) {
    this.verifierName = options.name ?? 'rule-driven-semantic-claim-verifier';
    this.rules = options.rules ?? [];
    this.forcedVerdict = options.forcedVerdict ?? null;
  }

  /** How many rules are in force. `0` is the offline default and means "adds nothing". */
  get ruleCount(): number {
    return this.rules.length;
  }

  async classify(request: SemanticClaimVerificationRequest): Promise<SemanticClaimVerdict> {
    this.requests.push(request);
    if (this.forcedVerdict !== null) return this.forcedVerdict;

    const haystack = request.text.toLowerCase();
    const claims: SemanticClaim[] = [];

    for (const rule of this.rules) {
      if (!haystack.includes(rule.needle.toLowerCase())) continue;

      // GROUNDING IS ENFORCED ON THE DOUBLE TOO, and that is not pedantry. A
      // double whose output would be rejected as MALFORMED by `./schema.ts` is a
      // double that tests a path production can never reach. So a rule quoting a
      // phrase the text does not contain contributes NOTHING rather than an
      // ungrounded claim - and a test that wants to exercise the ungrounded case
      // uses the scripted double, where it belongs.
      const whenPhrase = rule.whenPhrase !== undefined && request.text.includes(rule.whenPhrase)
        ? rule.whenPhrase
        : null;
      const identifier = rule.identifier !== undefined && request.text.includes(rule.identifier)
        ? rule.identifier
        : null;

      claims.push({
        assertsEffect: rule.assertsEffect ?? true,
        effectFamily: rule.effectFamily,
        status: rule.status,
        whenPhrase,
        identifier,
        confidence: rule.confidence ?? 0.9,
      });
    }

    return { kind: 'CLASSIFIED', claims, modelId: null };
  }
}
