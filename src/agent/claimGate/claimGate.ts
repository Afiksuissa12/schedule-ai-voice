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
 * THE SHAPE OF A REVIEW
 * ---------------------------------------------------------------------------
 *  1. DETECT, purely, over the text. No claim, no cost - no database read, no
 *     provider call, and the text is released untouched.
 *  2. Build the LEDGER, from real `ToolOutcome` values and persisted rows.
 *  3. VERIFY every claim against it. All supported - release BYTE-IDENTICAL. The
 *     gate must never rewrite good wording; a gate that tidies sentences is a
 *     scripting mechanism wearing a safety jacket.
 *  4. Unsupported - hand the authoritative state back to the SAME model and let
 *     it write its own words again. Verify again. Bounded by
 *     `MAX_CLAIM_GATE_REGENERATION_ATTEMPTS`, a constant in application code.
 *  5. Still unsupported after the bound - release NOTHING and hand off.
 *
 * WHAT IT MUST NOT DO, AND DOES NOT
 * ---------------------------------------------------------------------------
 *  - It never edits, trims, rewrites or substitutes text. Either the model's own
 *    bytes go out, or nothing does.
 *  - It never writes a canned customer-facing sentence. There is no such string
 *    in this module, and `npm run check:anti-scripting` scans it structurally.
 *  - It never executes a tool. Regeneration is offered NO tools at all (see
 *    `AgentTurnService`), so the gate cannot cause an effect even by accident.
 *  - It never decides truth from text. Every verdict traces to a `ToolOutcome` or
 *    a row.
 */
import { buildStateInstruction } from './stateInstruction.js';
import type { ActionLedger } from './ledger.js';
import { verifyClaims, type UnsupportedClaim } from './verifier.js';
import { detectMaterialClaims, type DetectClaimsOptions } from './detector.js';

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

/** One attempt at saying this turn, and what the gate found in it. */
export interface ClaimGateAttempt {
  /** 1-based. Attempt 1 is always the model's original, ungated text. */
  readonly attempt: number;
  /** Exactly what the model produced. Never modified. */
  readonly text: string;
  readonly unsupportedClaims: readonly UnsupportedClaim[];
  readonly supportedClaimCount: number;
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

/** What the gate wants recorded. Mapped to audit event types by the caller. */
export interface ClaimGateAuditRecord {
  readonly kind: 'VERIFIED' | 'REJECTED' | 'REGENERATION_REQUESTED' | 'WITHHELD';
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
}

export interface ClaimGateOptions {
  readonly maxRegenerationAttempts?: number;
  /** Test seam: register a synthetic locale, or narrow the lexicon set. */
  readonly detect?: DetectClaimsOptions;
}

export class ClaimGate {
  private readonly maxRegenerationAttempts: number;
  private readonly detect: DetectClaimsOptions;

  constructor(options: ClaimGateOptions = {}) {
    this.maxRegenerationAttempts = options.maxRegenerationAttempts ?? MAX_CLAIM_GATE_REGENERATION_ATTEMPTS;
    this.detect = options.detect ?? {};
  }

  /** The bound in force on this instance. Exposed so a report can state it. */
  get regenerationBound(): number {
    return this.maxRegenerationAttempts;
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
    // ---- 1. the cheap, pure question first ---------------------------------
    const firstPass = detectMaterialClaims(input.text, this.detect);
    if (firstPass.length === 0) {
      await input.record?.({
        kind: 'VERIFIED',
        attempt: 1,
        summary: 'Claim gate: no material claim in this text; released unchanged',
        detail: { outcome: 'NO_MATERIAL_CLAIM', attempt: 1, ledgerRead: false, textChars: input.text.length },
      });
      return {
        outcome: 'NO_MATERIAL_CLAIM',
        attempts: [{ attempt: 1, text: input.text, unsupportedClaims: [], supportedClaimCount: 0 }],
        releasedText: input.text,
      };
    }

    // ---- 2. only now is the authoritative state worth reading --------------
    const ledger = await input.loadLedger();

    const attempts: ClaimGateAttempt[] = [];
    let text = input.text;

    for (let attempt = 1; attempt <= this.maxRegenerationAttempts + 1; attempt += 1) {
      const verification = verifyClaims({ text, ledger, detect: this.detect });
      attempts.push({
        attempt,
        text,
        unsupportedClaims: verification.unsupported,
        supportedClaimCount: verification.supported.length,
      });

      if (verification.unsupported.length === 0) {
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
          },
        });
        return { outcome, attempts, releasedText: text };
      }

      await input.record?.({
        kind: 'REJECTED',
        attempt,
        summary:
          `Claim gate: ${verification.unsupported.length} unsupported claim(s) on attempt ${attempt} ` +
          `(${verification.unsupported.map((entry) => entry.reason).join(', ')}); not released`,
        detail: {
          attempt,
          unsupportedClaims: verification.unsupported.map(reportableClaim),
          // The text is recorded so an auditor can explain a blocked turn. This
          // is the audit trail, not the model's context window.
          attemptText: text,
        },
      });

      if (attempt > this.maxRegenerationAttempts) break;

      const instruction = buildStateInstruction({
        ledger,
        unsupported: verification.unsupported,
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

      const next = await input.regenerate({ attempt: attempt + 1, instruction, ledger, unsupported: verification.unsupported });
      if (next === null || next.trim().length === 0) {
        // The model answered with nothing. There is no text to verify and
        // nothing to release, so this is exhaustion rather than a silent pass.
        attempts.push({ attempt: attempt + 1, text: '', unsupportedClaims: verification.unsupported, supportedClaimCount: 0 });
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
