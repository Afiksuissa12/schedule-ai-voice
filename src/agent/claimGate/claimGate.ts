/**
 * `ClaimGate` - the EFFECT AND CLAIM CONSISTENCY GATE.
 *
 * WHY THIS EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * `ToolDispatcher` is the chokepoint for ACTIONS. It is complete, it held for
 * five different models across 105 scenario runs, and it has one honest boundary
 * which `docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 9.4 states plainly:
 * **the chokepoint governs actions, not sentences. Every model that said
 * something false said it freely.**
 *
 * Pressed by an adversarial contact, the recommended model invented
 * `CONF123456` and then said a callback was booked. No tool call was made on
 * either turn (§ 6.5.4). The Hebrew-fluent candidate does the same thing in
 * Hebrew and throws in an email it has no tool to send (§ 6.2). Neither could be
 * caught by the chokepoint, because neither was a tool call.
 *
 * This class is the second chokepoint: the single path from model TEXT to a
 * customer. It is not a prompt clause, because § 8.8's language-drift finding is
 * the standing demonstration that an instruction in a prompt is a request and a
 * number in application code is a limit.
 *
 * THE SHAPE OF A REVIEW - MISSION 2F, AND THE ORDER IS THE FOUNDER'S
 * ---------------------------------------------------------------------------
 * For EVERY customer-facing text, INCLUDING EVERY REGENERATED ATTEMPT:
 *
 *  1. DETECT, purely, over the text - the deterministic lexicon detector. Still
 *     free, still first, still no I/O.
 *  2. CLASSIFY, semantically - `SemanticClaimVerifier`, one provider call with no
 *     tools and a schema-constrained answer. It may ONLY add suspicion.
 *  3. UNION the two, tagging each claim with the layer that found it. Provably
 *     ADDITIVE: `./semantic/union.ts` and its superset property test.
 *  4. Union empty AND the second layer answered - release the text UNTOUCHED,
 *     with no database read at all.
 *  5. Otherwise build the LEDGER, from real `ToolOutcome` values and persisted
 *     rows, and RECONCILE the union against it with the EXISTING `verifyClaims`.
 *     All supported - release BYTE-IDENTICAL. The gate must never rewrite good
 *     wording; a gate that tidies sentences is a scripting mechanism wearing a
 *     safety jacket.
 *  6. Unsupported - hand the authoritative state back to the SAME model and let
 *     it write its own words again, then start again at step 1 on the new text.
 *     Bounded by `MAX_CLAIM_GATE_REGENERATION_ATTEMPTS`, a constant in
 *     application code.
 *  7. Still unsupported after the bound - release NOTHING and hand off.
 *
 * WHY A SECOND LAYER AT ALL, AND WHY IT CANNOT WEAKEN THE FIRST
 * ---------------------------------------------------------------------------
 * Eight successive independent QA rounds each found a phrasing shape the
 * deterministic lexicon did not recognise, and each leaked a false success claim
 * to a contact. `docs/MISSION_2D_CLAIM_GATE.md` § 17.8 states why the sequence
 * does not terminate by itself: the RULES over the lexicon are general now, and
 * the LEXICON is an open class that enumeration cannot close. § 4.1 of the same
 * document argues, equally correctly, that a guarantee living inside a model call
 * is a guarantee living where it already failed.
 *
 * Both are true, and the shape that satisfies both is the one the Founder
 * specified: the second layer may ADD a claim and may never CLEAR one, and the
 * final supported/unsupported decision is still made by deterministic code
 * comparing claims with the ledger. Three mechanisms, not three promises:
 *
 *  - `unionClaims` emits the deterministic list ENTIRE, in order, with the same
 *    object identities, before it appends anything. A test asserts that for every
 *    possible verdict including "everything is clean" and every failure.
 *  - The verifier's output has no vocabulary for support at all
 *    (`src/ports/claimVerifier.ts`), so there is nothing for it to assert with.
 *  - A verifier that fails, times out, is unreachable, returns nothing, or
 *    returns something malformed is UNSUPPORTED - never clean. So the layer's
 *    worst behaviour costs a regeneration and, at the bound, a hand-off.
 *
 * THE COST OF STEP 2, STATED RATHER THAN BURIED
 * ---------------------------------------------------------------------------
 * The old "no material claim, no cost" fast path IS GONE. It used to be true that
 * a turn asserting nothing paid no provider call; it now pays ONE VERIFIER CALL
 * PER CUSTOMER-FACING TEXT, because the Founder's order is that the verifier runs
 * on every one of them and a fast path conditioned on the deterministic detector
 * would be exactly the layer whose gaps this exists to cover deciding whether to
 * cover them. That is a deliberate price, not an oversight.
 *
 * What survives of the fast path is the part that costs a DATABASE READ: the
 * ledger is still lazy, and is built only when the union is non-empty or the
 * second layer failed closed. `docs/MISSION_2D_CLAIM_GATE_ASSURANCE.md` § 4.3
 * measured the gate's real per-turn cost as one durable audit insert rather than
 * the detector, and this change adds a provider round trip on top of that - which
 * on the measured figures (§ 4.5) is the term that dominates everything else.
 *
 * WHAT IT MUST NOT DO, AND DOES NOT
 * ---------------------------------------------------------------------------
 *  - It never edits, trims, rewrites or substitutes text. Either the model's own
 *    bytes go out, or nothing does.
 *  - It never writes a canned customer-facing sentence. There is no such string
 *    in this module or in `./semantic/`, and `npm run check:anti-scripting` scans
 *    both structurally.
 *  - It never executes a tool. Regeneration is offered NO tools at all (see
 *    `AgentTurnService`) and so is the verifier, so neither can cause an effect
 *    even by accident.
 *  - It never decides truth from text. Every verdict traces to a `ToolOutcome` or
 *    a row, and the second layer's judgement is never evidence that an effect
 *    exists.
 */
import { buildStateInstruction } from './stateInstruction.js';
import type { ActionLedger } from './ledger.js';
import { semanticLayerUnsupportedClaim, verifyClaims, type UnsupportedClaim } from './verifier.js';
import { detectMaterialClaims, type DetectClaimsOptions } from './detector.js';
import { unionClaims, type ClaimSource, type ClaimUnion, type SemanticLayerOutcome } from './semantic/union.js';
import type { SemanticClaimVerdict, SemanticClaimVerifier } from '../../ports/claimVerifier.js';

/**
 * How many times the model may be asked to write the turn again.
 *
 * TWO, and the number is argued rather than picked.
 *
 * Each attempt costs one full provider round trip - measured at a p50 of
 * 2,102 ms for the recommended model on the benchmark host, from the 57
 * single-provider-call turns in `eval-output-fair-20260927/` - and it is paid on
 * a live phone call, where the caller is listening to silence. Two is therefore
 * about 4.2 s of worst-case added latency, which is recoverable; three would be
 * over six seconds, which is a caller saying "hello?".
 *
 * The evidence also says a third attempt buys little. A model handed the
 * authoritative state either accepts it immediately or is arguing with it, and a
 * model arguing with its own tool results is the § 6.5.4 behaviour that this gate
 * exists to stop rather than to negotiate with. When two attempts are not enough
 * the honest answer is a person, not a fourth try.
 *
 * It is a constant HERE and not a prompt instruction for the same reason
 * `DEFAULT_MAX_TOOL_ITERATIONS` is: an instruction is a request and a number is
 * a limit.
 */
export const MAX_CLAIM_GATE_REGENERATION_ATTEMPTS = 2;

/** What the gate decided about one release. */
export const CLAIM_GATE_OUTCOMES = [
  /** The text asserted nothing material. Released untouched, no state read. */
  'NO_MATERIAL_CLAIM',
  /** It asserted something material and the records support all of it. */
  'SUPPORTED',
  /** A later attempt, in the model's own words, was supported. */
  'CORRECTED_AFTER_REGENERATION',
  /** Every attempt was unsupported. Nothing was released; a person was asked for. */
  'WITHHELD_HANDED_OFF',
] as const;

export type ClaimGateOutcome = (typeof CLAIM_GATE_OUTCOMES)[number];

/**
 * WHICH LAYER SAW WHAT, on one attempt - MISSION 2F.
 *
 * Reported per attempt rather than per release because the interesting question
 * is per attempt: a turn whose FIRST attempt was caught by the semantic layer
 * alone is a turn that would have leaked before this mission, and a report that
 * only summarised the release could not say so.
 *
 * This is the field the sweep and the benchmark read to treat a missing verifier
 * as a violation rather than as a pass: `semanticOutcome === 'ABSENT'` means no
 * verifier was wired, which is a declared TEST-ONLY seam and is never "clean".
 */
export interface ClaimGateAttemptLayers {
  /** How many claims `detectMaterialClaims` returned. */
  readonly deterministicClaimCount: number;
  /** What the second layer did. `'ABSENT'` means none was wired. */
  readonly semanticOutcome: SemanticLayerOutcome;
  /** How many semantic claims CONTRIBUTED to the union - material, and not already found. */
  readonly semanticClaimCount: number;
  /** The size of the union. Always >= `deterministicClaimCount`, by construction. */
  readonly unionClaimCount: number;
  /**
   * The second layer produced nothing usable, so this attempt is UNSUPPORTED
   * whatever else was found. True for all four failure variants AND for `ABSENT`.
   */
  readonly failClosed: boolean;
  /** One tag per union claim, in union order. */
  readonly sources: readonly ClaimSource[];
  /** The verifier's own diagnostic, on a failure. Never a customer-facing sentence. */
  readonly semanticFailureReason: string | null;
}

/** One attempt at saying this turn, and what the gate found in it. */
export interface ClaimGateAttempt {
  /** 1-based. Attempt 1 is always the model's original, ungated text. */
  readonly attempt: number;
  /** Exactly what the model produced. Never modified. */
  readonly text: string;
  readonly unsupportedClaims: readonly UnsupportedClaim[];
  readonly supportedClaimCount: number;
  /**
   * MISSION 2F. Which layer saw what on this attempt.
   *
   * REQUIRED, not optional, and that is the point: an attempt with no layer
   * report would be an attempt nobody can say was classified, and this mission's
   * whole premise is that silence about a check is not evidence the check
   * happened. Nothing outside `./claimGate.ts` constructs a `ClaimGateAttempt`,
   * so requiring it costs no caller anything.
   */
  readonly layers: ClaimGateAttemptLayers;
}

export interface ClaimGateDecision {
  readonly outcome: ClaimGateOutcome;
  /** Every attempt, in order. Always at least one. */
  readonly attempts: readonly ClaimGateAttempt[];
  /** The text that may reach the customer. `null` when the gate withheld. */
  readonly releasedText: string | null;
}

/** What the gate asks for when it needs the turn written again. */
export interface ClaimGateRegenerationRequest {
  /** The attempt number this call will produce: 2, then 3, ... */
  readonly attempt: number;
  /** The system-side authoritative state. Carries no customer-facing sentence. */
  readonly instruction: string;
  readonly ledger: ActionLedger;
  readonly unsupported: readonly UnsupportedClaim[];
}

/**
 * What the gate wants recorded. Mapped to audit event types by the caller.
 *
 * MISSION 2F adds four kinds, in the sequence they happen: the verifier was
 * asked, the verifier answered, the verifier failed, and which layer caught which
 * claim. They are separate events rather than fields on the existing four because
 * an auditor asking *why did this turn hand off* needs to read the chain in order
 * and see the second layer's answer AS A STEP - and because
 * `AuditEvent.@@unique([correlationId, sequence])` is what makes "in order"
 * meaningful.
 */
export interface ClaimGateAuditRecord {
  readonly kind:
    | 'VERIFIED'
    | 'REJECTED'
    | 'REGENERATION_REQUESTED'
    | 'WITHHELD'
    | 'SEMANTIC_REQUESTED'
    | 'SEMANTIC_CLASSIFIED'
    | 'SEMANTIC_FAILED'
    | 'LAYERED';
  readonly attempt: number;
  readonly summary: string;
  readonly detail: Record<string, unknown>;
}

export interface ClaimGateReviewInput {
  /** The text the model produced, exactly as it produced it. */
  readonly text: string;
  /**
   * Builds the ledger. A FUNCTION rather than a value because the happy path
   * must not pay for it: text that asserts nothing material is released without
   * a single database read.
   */
  readonly loadLedger: () => Promise<ActionLedger>;
  /**
   * Ask the same `LlmProvider` for this turn again, given the authoritative
   * state. Returns the new text, or `null` when the model produced none.
   */
  readonly regenerate: (request: ClaimGateRegenerationRequest) => Promise<string | null>;
  /** Called for every decision the gate makes, in order. */
  readonly record?: (event: ClaimGateAuditRecord) => Promise<void>;
  /**
   * The TURN's correlation id, passed through to the semantic verifier so its
   * audit events land on the same chain as everything else.
   *
   * Optional only so that a unit test reviewing one string need not invent one;
   * `AgentTurnService` always supplies it.
   */
  readonly correlationId?: string;
}

export interface ClaimGateOptions {
  readonly maxRegenerationAttempts?: number;
  /** Test seam: register a synthetic locale, or narrow the lexicon set. */
  readonly detect?: DetectClaimsOptions;
  /**
   * The SEMANTIC second layer - MISSION 2F.
   *
   * `null` OR OMITTED IS A DECLARED TEST-ONLY SEAM AND IS NEVER "CLEAN". It is
   * treated exactly as a verifier that failed: the attempt is UNSUPPORTED with
   * reason `SEMANTIC_CHECK_UNAVAILABLE`, the ledger is read, regeneration runs,
   * and exhaustion hands off. The absence is also VISIBLE - it surfaces as
   * `semanticOutcome: 'ABSENT'` on every attempt's layer report - so the sweep and
   * the benchmark can treat it as a violation rather than as a pass.
   *
   * This mirrors `AgentTurnServiceOptions.claimGate: null` exactly, and for the
   * same reason: the seam exists so a unit test can exercise one layer in
   * isolation, and `buildAgentRuntime` offers no configuration that produces it.
   * A runtime that could be configured into skipping the check has the defect
   * back.
   */
  readonly verifier?: SemanticClaimVerifier | null;
}

export class ClaimGate {
  private readonly maxRegenerationAttempts: number;
  private readonly detect: DetectClaimsOptions;
  private readonly verifier: SemanticClaimVerifier | null;

  constructor(options: ClaimGateOptions = {}) {
    this.maxRegenerationAttempts = options.maxRegenerationAttempts ?? MAX_CLAIM_GATE_REGENERATION_ATTEMPTS;
    this.detect = options.detect ?? {};
    this.verifier = options.verifier ?? null;
  }

  /** The bound in force on this instance. Exposed so a report can state it. */
  get regenerationBound(): number {
    return this.maxRegenerationAttempts;
  }

  /**
   * The second layer wired on this instance, or `null` for the test-only seam.
   *
   * Exposed so `AgentTurnResult.claimGate.verifier` can state the truth rather
   * than a caller's belief about the wiring - the same reason `regenerationBound`
   * is exposed instead of a number being hard-coded in a report.
   */
  get semanticVerifier(): SemanticClaimVerifier | null {
    return this.verifier;
  }

  /**
   * Review one piece of customer-facing text, and decide what may be released.
   *
   * Throws nothing for a bad claim - an unsupported claim is a DECISION the
   * caller acts on, exactly as a `ToolRejection` is a value and not an
   * exception. It does let a failure of the system itself propagate: a database
   * error building the ledger, or a provider error during regeneration, must
   * stop the turn rather than silently degrade into releasing unverified text.
   */
  async review(input: ClaimGateReviewInput): Promise<ClaimGateDecision> {
    const attempts: ClaimGateAttempt[] = [];
    let text = input.text;

    /**
     * The ledger, built AT MOST ONCE for the whole review, and only when
     * something actually needs checking.
     *
     * MEMOISED, not rebuilt per attempt, and that is unchanged behaviour: the
     * pre-2F code read it once before the loop. Rebuilding it per attempt would
     * also be wrong rather than merely slower - a regeneration is offered no
     * tools and therefore changes no state, so a second read would cost five
     * repository queries to learn the same thing.
     */
    let ledger: ActionLedger | null = null;
    const ledgerOnce = async (): Promise<ActionLedger> => {
      ledger ??= await input.loadLedger();
      return ledger;
    };

    for (let attempt = 1; attempt <= this.maxRegenerationAttempts + 1; attempt += 1) {
      // ---- 1, 2 and 3. detect, classify, union -----------------------------
      // On EVERY attempt, including every regenerated one. A regenerated text is
      // a customer-facing text, and the Founder's order applies to it in exactly
      // the same words.
      const union = await this.classifyLayers(text, attempt, input);

      // ---- 4. nothing to check, and the second layer said so ---------------
      if (union.claims.length === 0 && !union.failClosed) {
        const layers = layerReport(union);
        attempts.push({ attempt, text, unsupportedClaims: [], supportedClaimCount: 0, layers });

        if (attempt === 1) {
          // The ledger has genuinely not been read. `ledgerRead: false` is
          // asserted by `tests/e2e/claimGate.test.ts`, and it is still true: what
          // Mission 2F costs on this path is a PROVIDER call, not a database one.
          await input.record?.({
            kind: 'VERIFIED',
            attempt: 1,
            summary: 'Claim gate: no material claim in this text; released unchanged',
            detail: {
              outcome: 'NO_MATERIAL_CLAIM',
              attempt: 1,
              ledgerRead: false,
              textChars: text.length,
              layers,
            },
          });
          return {
            outcome: 'NO_MATERIAL_CLAIM',
            attempts,
            releasedText: text,
          };
        }

        // A regeneration that came back asserting nothing. Recorded in the same
        // shape the pre-2F code used for "verified with zero supported claims",
        // so the audit detail of this path is unchanged.
        await input.record?.({
          kind: 'VERIFIED',
          attempt,
          summary:
            `Claim gate: 0 material claim(s) verified against the ledger; released unchanged on attempt ${attempt}`,
          detail: { outcome: 'CORRECTED_AFTER_REGENERATION', attempt, supportedClaims: [], layers },
        });
        return { outcome: 'CORRECTED_AFTER_REGENERATION', attempts, releasedText: text };
      }

      // ---- 5. only now is the authoritative state worth reading ------------
      const ledgerNow = await ledgerOnce();

      // THE EXISTING RECONCILIATION, over the union. Not a fork of it, not a
      // second copy of the family table or the day rules - the same function,
      // handed the claims both layers found.
      const verification = verifyClaims({ text, ledger: ledgerNow, claims: union.claims.map((entry) => entry.claim) });

      // A fail-closed second layer is UNSUPPORTED on its own, whatever the
      // reconciliation said about the claims the FIRST layer found. Appended
      // rather than substituted, so a turn that is both unsupported and
      // unclassified reports both facts.
      const unsupported: readonly UnsupportedClaim[] = union.failClosed
        ? [
            ...verification.unsupported,
            semanticLayerUnsupportedClaim({
              outcome: union.semanticOutcome,
              reason: union.semanticFailureReason ?? 'no reason reported',
            }),
          ]
        : verification.unsupported;

      const layers = layerReport(union);
      attempts.push({
        attempt,
        text,
        unsupportedClaims: unsupported,
        supportedClaimCount: verification.supported.length,
        layers,
      });

      if (unsupported.length === 0) {
        const outcome: ClaimGateOutcome = attempt === 1 ? 'SUPPORTED' : 'CORRECTED_AFTER_REGENERATION';
        await input.record?.({
          kind: 'VERIFIED',
          attempt,
          summary:
            `Claim gate: ${verification.supported.length} material claim(s) verified against the ledger; ` +
            `released unchanged on attempt ${attempt}`,
          detail: {
            outcome,
            attempt,
            supportedClaims: verification.supported.map((entry) => ({
              family: entry.claim.family,
              mode: entry.claim.mode,
              locale: entry.claim.locale,
              matchedForm: entry.claim.matchedForm,
              effectKind: entry.matchedEffect?.kind ?? null,
              effectEntity: entry.matchedEffect?.entity ?? null,
              effectLocal: entry.matchedEffect?.localTime?.local ?? null,
            })),
            layers,
          },
        });
        return { outcome, attempts, releasedText: text };
      }

      await input.record?.({
        kind: 'REJECTED',
        attempt,
        summary:
          `Claim gate: ${unsupported.length} unsupported claim(s) on attempt ${attempt} ` +
          `(${unsupported.map((entry) => entry.reason).join(', ')}); not released`,
        detail: {
          attempt,
          unsupportedClaims: unsupported.map(reportableClaim),
          // WHICH LAYER CAUGHT WHICH CLAIM, on the rejection itself as well as on
          // the dedicated LAYERED event, because this is the event an auditor
          // reaches for when asking why a turn was blocked.
          layers,
          // The text is recorded so an auditor can explain a blocked turn. This
          // is the audit trail, not the model's context window.
          attemptText: text,
        },
      });

      if (attempt > this.maxRegenerationAttempts) break;

      const instruction = buildStateInstruction({
        ledger: ledgerNow,
        unsupported,
        attempt,
        maxAttempts: this.maxRegenerationAttempts,
      });

      await input.record?.({
        kind: 'REGENERATION_REQUESTED',
        attempt: attempt + 1,
        summary: `Claim gate: regeneration ${attempt} of ${this.maxRegenerationAttempts} requested from the model`,
        detail: {
          regeneration: attempt,
          maxRegenerationAttempts: this.maxRegenerationAttempts,
          // The instruction is system-side and carries no customer wording, so
          // recording it verbatim is safe and makes the turn explainable.
          instruction,
        },
      });

      const next = await input.regenerate({ attempt: attempt + 1, instruction, ledger: ledgerNow, unsupported });
      if (next === null || next.trim().length === 0) {
        // The model answered with nothing. There is no text to verify and
        // nothing to release, so this is exhaustion rather than a silent pass.
        //
        // The layer report carried forward is the PREVIOUS attempt's, and it says
        // so: there was no text for either layer to read, so reporting a fresh
        // classification here would claim a check that did not happen. The
        // outcome is unchanged either way - no text is released.
        attempts.push({
          attempt: attempt + 1,
          text: '',
          unsupportedClaims: unsupported,
          supportedClaimCount: 0,
          layers: { ...layers, unionClaimCount: 0, sources: [] },
        });
        break;
      }
      text = next;
    }

    const lastUnsupported = attempts.at(-1)?.unsupportedClaims ?? [];
    await input.record?.({
      kind: 'WITHHELD',
      attempt: attempts.length,
      summary:
        `Claim gate: WITHHELD after ${attempts.length} attempt(s); no text released and a person was asked for`,
      detail: {
        outcome: 'WITHHELD_HANDED_OFF',
        attemptCount: attempts.length,
        maxRegenerationAttempts: this.maxRegenerationAttempts,
        unsupportedClaims: lastUnsupported.map(reportableClaim),
        attemptTexts: attempts.map((entry) => entry.text),
      },
    });

    return { outcome: 'WITHHELD_HANDED_OFF', attempts, releasedText: null };
  }

  // -------------------------------------------------------------------------

  /**
   * Steps 1, 2 and 3 for one text: detect, classify, union.
   *
   * THE ORDER IS THE FOUNDER'S AND IS NOT AN OPTIMISATION. The deterministic
   * detector runs first because it is free and because its output is what the
   * union is a superset OF. The verifier runs SECOND AND UNCONDITIONALLY - it is
   * not skipped when the detector found nothing, and that is the whole point: a
   * fast path conditioned on the detector would let the layer whose gaps this
   * exists to cover decide whether to cover them, which is the eight-QA-round
   * defect with an extra step. The measured price is one provider round trip per
   * customer-facing text.
   *
   * NEVER THROWS ON THE VERIFIER'S ACCOUNT. `SemanticClaimVerifier.classify` is
   * contracted not to throw, and this method treats a violation of that contract
   * as UNAVAILABLE anyway - because "the implementation kept its contract" is a
   * promise about today's code, and an exception escaping here would abort the
   * turn instead of blocking the sentence.
   */
  private async classifyLayers(
    text: string,
    attempt: number,
    input: ClaimGateReviewInput,
  ): Promise<ClaimUnion> {
    // ---- 1. the cheap, pure question first ---------------------------------
    const deterministic = detectMaterialClaims(text, this.detect);

    // ---- 2. the second opinion, on every text ------------------------------
    const verdict = await this.classifySemantically(text, attempt, input);

    // ---- 3. the union, provably additive -----------------------------------
    const union = unionClaims({ text, deterministic, verdict });

    await input.record?.({
      kind: 'LAYERED',
      attempt,
      summary:
        `Claim gate: attempt ${attempt} - deterministic layer found ${union.deterministicCount}, ` +
        `semantic layer contributed ${union.semanticContributingCount} ` +
        `(${union.semanticOutcome}); ${union.claims.length} claim(s) to reconcile`,
      detail: {
        attempt,
        layers: layerReport(union),
        // Per claim, so an auditor can point at ONE claim and say which layer saw
        // it. This is the field the mission's whole premise is checked against:
        // a claim tagged SEMANTIC is a claim that would have leaked before.
        claims: union.claims.map((entry) => ({
          source: entry.source,
          family: entry.claim.family,
          mode: entry.claim.mode,
          locale: entry.claim.locale,
          matchedForm: entry.claim.matchedForm,
          unreadTemporal: entry.claim.unreadTemporal,
          identifiers: entry.claim.identifiers,
        })),
      },
    });

    return union;
  }

  /**
   * One verifier call, audited either way.
   *
   * Returns `null` when no verifier is wired, which `unionClaims` turns into the
   * `ABSENT` outcome and `failClosed: true`. No audit event is recorded in that
   * case, because nothing was requested and nothing answered - the absence is
   * reported on the LAYERED event and on the per-turn report instead, where it
   * cannot be mistaken for a verifier that ran.
   */
  private async classifySemantically(
    text: string,
    attempt: number,
    input: ClaimGateReviewInput,
  ): Promise<SemanticClaimVerdict | null> {
    const verifier = this.verifier;
    if (verifier === null) return null;

    const correlationId = input.correlationId ?? UNATTRIBUTED_CORRELATION_ID;

    await input.record?.({
      kind: 'SEMANTIC_REQUESTED',
      attempt,
      summary: `Claim gate: semantic claim verifier ${verifier.verifierName} asked about attempt ${attempt}`,
      detail: {
        attempt,
        verifier: verifier.verifierName,
        textChars: text.length,
        // THE PROOF THAT THE REQUEST CARRIED NOTHING ELSE, on the chain. The
        // request type makes a ledger unrepresentable; this records what was
        // actually sent so an auditor does not have to take the type's word.
        requestFields: ['text', 'correlationId'],
      },
    });

    let verdict: SemanticClaimVerdict;
    try {
      verdict = await verifier.classify({ text, correlationId });
    } catch (error) {
      verdict = {
        kind: 'UNAVAILABLE',
        reason:
          `the verifier threw, which its contract forbids: ` +
          `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
      };
    }

    if (verdict.kind === 'CLASSIFIED') {
      await input.record?.({
        kind: 'SEMANTIC_CLASSIFIED',
        attempt,
        summary:
          `Claim gate: semantic claim verifier returned ${verdict.claims.length} classified claim(s) ` +
          `for attempt ${attempt}`,
        detail: {
          attempt,
          verifier: verifier.verifierName,
          modelId: verdict.modelId,
          // THE STRUCTURED OUTPUT, verbatim after validation. It has already
          // passed the strict schema and the grounding check, so every quoted
          // phrase in here is a substring of a text that is itself recorded on
          // the rejection event - nothing new about the conversation is disclosed
          // by keeping it.
          claims: verdict.claims,
        },
      });
      return verdict;
    }

    await input.record?.({
      kind: 'SEMANTIC_FAILED',
      attempt,
      summary:
        `Claim gate: semantic claim verifier ${verdict.kind} on attempt ${attempt}; ` +
        'treated as UNSUPPORTED and not as clean',
      detail: {
        attempt,
        verifier: verifier.verifierName,
        outcome: verdict.kind,
        reason: verdict.reason,
        // Stated on the event rather than left to be inferred from what happens
        // next, because this is the line an operator reads during an outage.
        consequence: 'the text is withheld, regeneration runs, and exhaustion hands off to a human',
      },
    });
    return verdict;
  }
}

/**
 * The correlation id used when a caller reviewed a string without one.
 *
 * Only reachable through the unit-test seam - `AgentTurnService` always passes
 * the turn's own id. A fixed, obviously-synthetic value rather than an empty
 * string, so an audit query that finds one can tell "nobody supplied an id" from
 * "the id was lost".
 */
const UNATTRIBUTED_CORRELATION_ID = 'claim-gate-unattributed';

/** The union, flattened for a report and an audit detail. */
function layerReport(union: ClaimUnion): ClaimGateAttemptLayers {
  return {
    deterministicClaimCount: union.deterministicCount,
    semanticOutcome: union.semanticOutcome,
    semanticClaimCount: union.semanticContributingCount,
    unionClaimCount: union.claims.length,
    failClosed: union.failClosed,
    sources: union.claims.map((entry) => entry.source),
    semanticFailureReason: union.semanticFailureReason,
  };
}

/** One unsupported claim, flattened for an audit detail and for the turn report. */
function reportableClaim(entry: UnsupportedClaim): Record<string, unknown> {
  return {
    reason: entry.reason,
    family: entry.claim.family,
    mode: entry.claim.mode,
    locale: entry.claim.locale,
    matchedForm: entry.claim.matchedForm,
    sentenceIndex: entry.claim.sentenceIndex,
    excerpt: entry.claim.excerpt,
    detail: entry.detail,
  };
}

export { type ClaimSource, type SemanticLayerOutcome };
