/**
 * The lexicon registry.
 *
 * ADDING A LOCALE IS ADDING A MODULE AND ONE LINE HERE
 * ---------------------------------------------------------------------------
 * Write `src/scheduling/lexicon/<code>.ts` exporting a `LocaleLexicon`, import
 * it below, and add it to `REGISTERED_LEXICONS`. Nothing in
 * `naturalLanguage.ts` changes - it holds no language-specific literal at all.
 * `tests/scheduling/localeLexicon.test.ts` proves that by registering a
 * synthetic third locale at runtime, through
 * `ParseNaturalLanguageOptions.lexicons`, and resolving a phrase in it.
 *
 * THERE IS NO LANGUAGE FIELD ANYWHERE, AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------
 * `Contact` does not record a language and none was added. A caller who
 * genuinely knows better than the data would have to be TOLD by the model, and
 * a model-supplied language would be one more unaudited model assertion
 * deciding what a booking means. So the resolver matches against the UNION of
 * every registered lexicon and lets the words decide.
 *
 * THE CROSS-LOCALE AMBIGUITY RULE
 * ---------------------------------------------------------------------------
 * Matching against a union raises one real question: what happens when two
 * registered locales both claim the same token?
 *
 *   **A token that two registered locales read as DIFFERENT days or DIFFERENT
 *   times is a refusal. A token they AGREE on is not an ambiguity.**
 *
 * "Agree" is exact, not approximate: two entries agree when they are the same
 * kind of thing with the same value - the same day offset, the same ISO
 * weekday, the same day part, the same named hour and minute, the same offset
 * unit or quantity. Everything else disagrees, including two entries of
 * DIFFERENT kinds, because a token one language reads as a day and another
 * reads as a time is precisely the confusion worth refusing over.
 *
 * The rule is evaluated only where the grammar would actually read the token -
 * on the longest form that matches at a position - so a disagreement buried
 * inside a phrase that was matched as a whole cannot cause a spurious refusal.
 *
 * With `en` and `he` registered there is no such token: the two use disjoint
 * scripts. That is a fact about today's registry, not a property of the rule,
 * so both sides of it are tested against a synthetic third locale rather than
 * left untested until a third real one arrives.
 */
import { EN_LEXICON } from './en.js';
import { HE_LEXICON } from './he.js';
import type { LocaleLexicon } from './types.js';

export * from './types.js';
export * from './script.js';
export { EN_LEXICON } from './en.js';
export { HE_LEXICON } from './he.js';

/**
 * Every lexicon the resolver matches against, in priority order.
 *
 * Order matters only for tie-breaking between entries that AGREE - the first
 * registered locale supplies the recorded form - and never for deciding what a
 * phrase means.
 */
export const REGISTERED_LEXICONS: readonly LocaleLexicon[] = [EN_LEXICON, HE_LEXICON];
