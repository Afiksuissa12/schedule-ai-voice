/**
 * The claim gate's public surface.
 *
 * This is the contract two sibling tasks are written against - the assurance
 * task and the benchmark task both consume it - so names here are ADDED to and
 * not renamed without announcing it first.
 *
 * What is published, and where to read it:
 *
 *   ActionLedger, buildActionLedger        `./ledger.ts`   - what actually happened
 *   detectMaterialClaims                   `./detector.ts` - pure, text in, claims out
 *   verifyClaims                           `./verifier.ts` - text + ledger -> supported / unsupported
 *   ClaimGate, ClaimGateOutcome            `./claimGate.ts`- the decision
 *   MAX_CLAIM_GATE_REGENERATION_ATTEMPTS   `./claimGate.ts`- the bound, in code
 *   buildStateInstruction                  `./stateInstruction.ts`
 *   handOffAfterClaimGateExhaustion        `./handoff.ts`  - the designed exhaustion outcome
 *   REGISTERED_CLAIM_LEXICONS              `./lexicon/`    - locale vocabulary as DATA
 *
 * MISSION 2F adds the SEMANTIC second layer, from `./semantic/`:
 *
 *   LlmSemanticClaimVerifier               the real one, over an injected LlmProvider
 *   ScriptedSemanticClaimVerifier          a double: answers what a test dictates
 *   RuleDrivenSemanticClaimVerifier        a double: answers from deterministic rules
 *   unionClaims, ClaimSource, SourcedClaim provably ADDITIVE; the verifier may only add
 *   SemanticVerifierOutputSchema           strict, and fails closed on anything else
 *   SEMANTIC_VERIFIER_INSTRUCTION          model-facing only; no customer-facing wording
 *
 * MISSION 2G adds one more, from `./semantic/segmentation.ts`:
 *
 *   segmentForClassification, renderSegments
 *                                          PRESENTATION ONLY. It cuts a text into numbered
 *                                          pieces for the model inside the SAME one provider
 *                                          call, on typographic rules alone. It holds no
 *                                          vocabulary and produces no verdict, so it is not a
 *                                          third reader.
 *
 * The PORT itself lives in `src/ports/claimVerifier.ts`, because the authority
 * boundary belongs in the types every implementation is written against.
 */
export * from './ledger.js';
export * from './detector.js';
export * from './verifier.js';
export * from './claimGate.js';
export * from './stateInstruction.js';
export * from './handoff.js';
export * from './text.js';
export * from './lexicon/index.js';
export * from './semantic/index.js';
