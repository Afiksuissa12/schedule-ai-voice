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
 */
export * from './ledger.js';
export * from './detector.js';
export * from './verifier.js';
export * from './claimGate.js';
export * from './stateInstruction.js';
export * from './handoff.js';
export * from './text.js';
export * from './lexicon/index.js';
