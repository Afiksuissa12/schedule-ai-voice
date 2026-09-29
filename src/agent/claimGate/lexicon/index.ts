/**
 * The claim-lexicon registry.
 *
 * ADDING A LANGUAGE IS ADDING A MODULE AND ONE LINE HERE
 * ---------------------------------------------------------------------------
 * Write `src/agent/claimGate/lexicon/<code>.ts` exporting a `ClaimLexicon`,
 * import it below, and add it to `REGISTERED_CLAIM_LEXICONS`. Nothing in
 * `../detector.ts` changes - it holds no language-specific literal at all, and
 * `tests/agent/claimGateDetector.test.ts` proves that by registering a synthetic
 * third locale at runtime and detecting a claim in it.
 *
 * THERE IS NO LANGUAGE FIELD, FOR THE SAME REASON THE RESOLVER HAS NONE
 * ---------------------------------------------------------------------------
 * `Contact` records no language, and a model-supplied one would be an unaudited
 * model assertion deciding whether a sentence reaches a customer - which is
 * precisely the authority this gate exists to take away. So the detector matches
 * against the UNION of every registered lexicon and lets the words decide. That
 * is also what makes a MIXED Hebrew-and-English turn work without a mode switch:
 * `src/eval/corpus/scenarios.he.ts` has a mixed scenario, three of the five
 * benchmarked models code-switch mid-sentence, and a union has nothing to
 * switch.
 *
 * CROSS-LOCALE COLLISIONS
 * ---------------------------------------------------------------------------
 * `src/scheduling/lexicon/index.ts` has to refuse a token two locales read as
 * different days, because a booking lands on one of them. This registry has no
 * such rule and needs none: two locales claiming the same token both produce a
 * detected claim, detection is a union rather than a choice, and every claim is
 * then checked against the same ledger. Detecting the same assertion twice
 * costs an extra line in an audit detail and changes no verdict.
 */
import { EN_CLAIM_LEXICON } from './en.js';
import { HE_CLAIM_LEXICON } from './he.js';
import type { ClaimLexicon } from './types.js';

export * from './types.js';
export { EN_CLAIM_LEXICON } from './en.js';
export { HE_CLAIM_LEXICON } from './he.js';

/** Every claim lexicon the detector matches against. */
export const REGISTERED_CLAIM_LEXICONS: readonly ClaimLexicon[] = [EN_CLAIM_LEXICON, HE_CLAIM_LEXICON];
