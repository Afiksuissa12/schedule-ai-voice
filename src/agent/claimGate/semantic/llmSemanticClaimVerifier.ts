/**
 * `LlmSemanticClaimVerifier` - the real second opinion, over an INJECTED
 * `LlmProvider`.
 *
 * WHAT IT IS
 * ---------------------------------------------------------------------------
 * One provider call, no tools, a JSON-Schema-constrained answer, temperature 0,
 * a fixed seed, a bounded deadline in application code, and every conceivable
 * failure converted into a fail-closed verdict rather than thrown.
 *
 * WHAT IT IS NOT, STRUCTURALLY AND NOT BY PROMISE
 * ---------------------------------------------------------------------------
 *  - NOT AN HTTP CLIENT. It takes an `LlmProvider`. The only file in this
 *    repository that dials Ollama is `src/llm/ollama/client.ts`, and
 *    `tests/invariants/vendorBoundary.test.ts` already forbids `fetch` anywhere
 *    under `src/agent`.
 *  - NOT ABLE TO CAUSE AN EFFECT. `tools: []` on every call. A tool call that is
 *    never offered cannot be proposed, and one that is never proposed cannot be
 *    dispatched. This is the same guarantee the gate's regeneration path already
 *    relies on (`AgentTurnService.releaseText`), stated the same way.
 *  - NOT ABLE TO READ STATE. It is constructed with a provider and two numbers.
 *    No database, no repository, no ledger, no clock, no telephony, no calendar,
 *    no availability. `tests/invariants/verifierAuthorityBoundary.test.ts`
 *    asserts that as an IMPORT property over this whole directory, so it holds
 *    for anything added here later too.
 *
 * DETERMINISM CONTROLS: WHAT IS IN EFFECT, AND WHAT IS NOT GUARANTEED
 * ---------------------------------------------------------------------------
 * Recorded here, in code, because the documentation task quotes this list and a
 * list that lives only in prose drifts from the code that implements it.
 *
 * IN EFFECT, and each is asserted by a test on the request body
 * (`tests/llm/ollamaRequestShape.test.ts`, `tests/agent/semanticClaimVerifier.test.ts`):
 *   1. `temperature: 0` on every request, sent per-request so it holds even when
 *      the shared provider is configured otherwise.
 *   2. `seed: SEMANTIC_VERIFIER_SEED`, a fixed constant, sent as Ollama's
 *      `options.seed`.
 *   3. A JSON SCHEMA in Ollama's `format`, so the runtime constrains decoding to
 *      the shape rather than being asked politely for it.
 *   4. NO TOOLS, so there is no tool-choice non-determinism and no action.
 *   5. A CONSTANT instruction (`./instruction.ts`), not interpolated with the
 *      text, so the same text produces the same bytes on the wire.
 *   6. A bounded deadline in THIS file, independent of the provider's own
 *      timeout, so a provider configured with a 120 s deadline cannot hold a
 *      phone call open for 120 s.
 *   7. STRICT validation plus a grounding check on the answer, so a
 *      non-deterministic answer that is also malformed is a NAMED failure rather
 *      than a quiet difference in behaviour.
 *
 * NOT GUARANTEED, and none of it is fixable from here:
 *   1. OLLAMA BATCHING. Concurrent requests can be batched, and batch
 *      composition changes floating-point reduction order. Identical inputs can
 *      produce different logits.
 *   2. GPU NON-DETERMINISM. Kernel selection, split-K reductions and atomics on
 *      the same hardware are not bit-reproducible run to run.
 *   3. QUANTISATION. A model re-quantised at a different level is a different
 *      function. `Q4_K_M` and `Q5_K_M` of the same weights do not agree.
 *   4. RUNTIME VERSION. An Ollama upgrade can change the chat template, the
 *      sampler, the grammar compiler used for `format`, and the default context
 *      length.
 *   5. MODEL SWAP. `CLAIM_VERIFIER_MODEL` is configurable; changing it changes
 *      every classification and nothing in this file can notice.
 *   6. THE MODEL'S JUDGEMENT ITSELF. Determinism is not accuracy. A model that
 *      reliably misses a phrasing misses it identically every time, which is why
 *      this layer may only ADD to the deterministic one and may never clear it.
 *
 * So the honest statement is: the SAMPLER is pinned, the SHAPE is constrained,
 * and the RUNTIME is not reproducible. That is exactly why nothing downstream
 * treats this verifier's answer as evidence, and why its failure is UNSUPPORTED.
 */
import type { LlmProvider } from '../../../ports/llm.js';
import type {
  SemanticClaimVerificationRequest,
  SemanticClaimVerdict,
  SemanticClaimVerifier,
} from '../../../ports/claimVerifier.js';
import {
  SEMANTIC_VERIFIER_INSTRUCTION,
  wrapTextForClassification,
} from './instruction.js';
import { SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA, parseSemanticVerifierOutput } from './schema.js';

/**
 * The fixed seed.
 *
 * An arbitrary constant, and its value carries no meaning - what matters is that
 * it never changes, because a seed that varies is not a determinism control. It
 * is a number in application code rather than a configuration key for the reason
 * `MAX_CLAIM_GATE_REGENERATION_ATTEMPTS` is: a knob that can be turned is a knob
 * that will be turned, and an operator who reseeds the verifier per deployment
 * has silently given up the one control this file can actually offer.
 */
export const SEMANTIC_VERIFIER_SEED = 20260928;

/** Temperature. Zero, and not configurable, for the same reason as the seed. */
export const SEMANTIC_VERIFIER_TEMPERATURE = 0;

/**
 * The default deadline, in milliseconds.
 *
 * TWENTY SECONDS, and the number is argued rather than picked.
 *
 * This call is paid on the critical path of a live phone call, ONCE PER
 * CUSTOMER-FACING TEXT including every regenerated attempt, so at the
 * regeneration bound of two a worst case is three of them. It has to be short
 * enough that a wedged verifier fails fast, and long enough that a COLD model
 * load is not mistaken for one.
 *
 * The measured numbers this is chosen against, from `LOCAL_PROVIDER.md` § 8 and
 * `eval-output-fair-20260927/`: a cold 7B load on the mission host costs
 * 2.8-3.8 s before the first token, and `qwen2.5:7b-instruct`'s total turn p50 is
 * 2,102 ms with a p95 of 4,088 ms over 57 single-call turns. This request is much
 * SMALLER than one of those - no tool schemas, no transcript, a short
 * instruction, and an answer bounded to a small JSON object - so 20 s is roughly
 * five times the p95 of a much larger request plus a cold load, which makes a
 * trip of this deadline a real fault rather than a slow host.
 *
 * It is deliberately far BELOW `DEFAULT_LOCAL_LLM_TIMEOUT_MS` (120 s). The
 * provider's deadline is generous because a conversational turn can legitimately
 * be long; this one must not inherit that, because a verifier holding a call open
 * for two minutes is worse than a verifier that failed closed after twenty
 * seconds and handed off.
 */
export const DEFAULT_SEMANTIC_VERIFIER_TIMEOUT_MS = 20_000;

export interface LlmSemanticClaimVerifierOptions {
  /**
   * The provider. INJECTED, never constructed here.
   *
   * It may be the very instance the conversation is running on - the
   * `determinism` and `responseJsonSchema` fields are per-request, so one
   * resident model serves both roles and the verifier cannot change how the
   * agent is sampled.
   */
  readonly llm: LlmProvider;
  /** Overrides `DEFAULT_SEMANTIC_VERIFIER_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
}

export class LlmSemanticClaimVerifier implements SemanticClaimVerifier {
  readonly verifierName = 'llm-semantic-claim-verifier';

  private readonly llm: LlmProvider;
  private readonly timeoutMs: number;

  constructor(options: LlmSemanticClaimVerifierOptions) {
    this.llm = options.llm;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_SEMANTIC_VERIFIER_TIMEOUT_MS;
  }

  /** The deadline in force on this instance. Exposed so a report can state it. */
  get deadlineMs(): number {
    return this.timeoutMs;
  }

  /**
   * Classify one text.
   *
   * NEVER THROWS, and the try/catch is the whole reason: an exception escaping
   * into `ClaimGate.review` would abort the TURN rather than block the sentence,
   * and a turn that threw is a turn nobody classified. Every path out of here is
   * a `SemanticClaimVerdict`, and four of the five are fail-closed.
   */
  async classify(request: SemanticClaimVerificationRequest): Promise<SemanticClaimVerdict> {
    // An empty proposal is not a claim and is not an error. It is reported as
    // `EMPTY` rather than as `CLASSIFIED` with no claims, because the port's
    // contract is that a failure is never representable as clean - and the gate
    // treats it as fail-closed, which for a text with nothing in it costs
    // nothing: there is no sentence to withhold.
    if (request.text.trim().length === 0) {
      return { kind: 'EMPTY', reason: 'the proposed text was empty or whitespace' };
    }

    let completion: Awaited<ReturnType<LlmProvider['completeTurn']>>;
    try {
      completion = await this.withDeadline(
        this.llm.completeTurn({
          systemPrompt: SEMANTIC_VERIFIER_INSTRUCTION,
          messages: [
            {
              role: 'user',
              content: wrapTextForClassification(
                request.text,
                ...(request.localeHint === undefined ? [] : [request.localeHint]),
              ),
            },
          ],
          // NO TOOLS. Not "no dangerous tools" - none at all.
          tools: [],
          responseJsonSchema: SEMANTIC_VERIFIER_OUTPUT_JSON_SCHEMA,
          determinism: { temperature: SEMANTIC_VERIFIER_TEMPERATURE, seed: SEMANTIC_VERIFIER_SEED },
        }),
      );
    } catch (error) {
      if (error instanceof SemanticVerifierDeadlineError) {
        return { kind: 'TIMED_OUT', reason: `the verifier did not answer within ${this.timeoutMs} ms` };
      }
      // Everything else: a dead provider, a refused connection, a protocol
      // error, a configuration error. The provider's own message is recorded
      // because an operator needs it; it is never shown to a contact and never
      // reaches a customer-facing sentence.
      return {
        kind: 'UNAVAILABLE',
        reason: `the verifier's provider failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
      };
    }

    const answer = completion.assistantText;
    if (answer === null || answer.trim().length === 0) {
      // A model that called no tool and said nothing. Distinguished from
      // MALFORMED because the fix is different: an empty answer is usually a
      // chat-template or a `num_predict` problem, while malformed output is a
      // model that cannot follow the schema.
      return { kind: 'EMPTY', reason: 'the verifier returned no assistant text' };
    }

    const parsed = parseSemanticVerifierOutput(answer, request.text);
    if (!parsed.ok) {
      return { kind: 'MALFORMED', reason: parsed.reason };
    }

    return {
      kind: 'CLASSIFIED',
      claims: parsed.claims,
      modelId: completion.metrics?.modelId ?? null,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * The deadline, in APPLICATION CODE.
   *
   * WHY NOT JUST CONFIGURE THE PROVIDER'S TIMEOUT. Because the provider may be
   * the one the conversation is using, whose deadline is deliberately generous,
   * and because a bound this layer depends on must not be a property of a
   * collaborator a caller supplied. `ClaimGate` calls this on the path to a
   * customer; the bound belongs where the dependency is.
   *
   * WHAT IT DOES NOT DO, STATED. It does not CANCEL the provider call - the port
   * has no cancellation and adding one for this would be a large change to a
   * contract three providers implement. The in-flight request continues and its
   * result is discarded. So the cost of a timeout is one wasted generation on the
   * model host, not a leak and not a hang: the gate has already been told
   * TIMED_OUT and has already moved on.
   *
   * The timer is cleared on both paths, so a fast answer does not leave a handle
   * holding the process open - which matters because `npm test` and the sweep run
   * in-process.
   */
  private async withDeadline<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new SemanticVerifierDeadlineError(this.timeoutMs)), this.timeoutMs);
      // Do not hold the event loop open for a deadline nobody is waiting on.
      timer.unref?.();
    });

    try {
      return await Promise.race([work, deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/**
 * Internal, and deliberately not exported.
 *
 * It exists only so `classify` can tell its own deadline from a provider error,
 * and nothing outside this file should ever see one: every path out of `classify`
 * is a verdict, so an escaping error of this type would be a bug rather than a
 * case to handle.
 */
class SemanticVerifierDeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`The semantic claim verifier's ${timeoutMs} ms deadline expired.`);
    this.name = 'SemanticVerifierDeadlineError';
  }
}
