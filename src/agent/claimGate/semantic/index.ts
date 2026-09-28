/**
 * The semantic layer's public surface.
 *
 * Re-exported from `../index.ts`, so sibling tasks import from
 * `src/agent/claimGate/index.js` exactly as they already do for the
 * deterministic half. Names here are ADDED to and not renamed without announcing
 * it first - two sibling tasks this mission are written against them.
 *
 *   SemanticClaimVerifier and its verdict union   `src/ports/claimVerifier.ts`
 *   SemanticVerifierOutputSchema, grounding       `./schema.ts`
 *   SEMANTIC_VERIFIER_INSTRUCTION                 `./instruction.ts`   model-facing only
 *   segmentForClassification, renderSegments      `./segmentation.ts`  presentation only
 *   LlmSemanticClaimVerifier                      `./llmSemanticClaimVerifier.ts`
 *   ScriptedSemanticClaimVerifier                 `./doubles.ts`
 *   RuleDrivenSemanticClaimVerifier               `./doubles.ts`
 *   unionClaims, ClaimSource, SourcedClaim        `./union.ts`   provably additive
 */
export * from './doubles.js';
export * from './instruction.js';
export * from './llmSemanticClaimVerifier.js';
export * from './schema.js';
export * from './segmentation.js';
export * from './union.js';
