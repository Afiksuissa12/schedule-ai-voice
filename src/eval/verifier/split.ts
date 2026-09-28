/**
 * THE DEV / HELD-OUT SPLIT PROCEDURE. Mission 2G.
 *
 * WHY THERE IS A SPLIT AT ALL
 * ---------------------------------------------------------------------------
 * `docs/MISSION_2F_SEMANTIC_VERIFIER.md` § 10 built a 172-row labelled corpus and
 * nobody had run a model against it. Mission 2G runs one AND tunes the
 * model-facing instruction against the result, and those two activities cannot
 * share a corpus: an instruction iterated until the recall number goes up has
 * been fitted to the rows it was iterated against, and the final number then
 * measures the fitting. So half the corpus is `dev` - the tuning task's to read,
 * run and iterate against - and half is `heldout`, which it may not read at all.
 *
 * WHY THE ASSIGNMENT IS A PURE FUNCTION AND IS ALSO COMMITTED DATA
 * ---------------------------------------------------------------------------
 * Both, and neither alone would do.
 *
 *  - IF IT WERE ONLY A FUNCTION, a reader could not see which half a row is in
 *    without running code, and a change to the function would silently move rows
 *    between halves after the fact - which is exactly how a held-out set stops
 *    being held out.
 *  - IF IT WERE ONLY DATA, one hand edit to one row's `split` would move a row
 *    the tuning task had already seen into the held-out half, and nothing would
 *    say so.
 *
 * So the function produces the assignment, the assignment is materialised on
 * every row, and `tests/eval/verifierSplitReproducibility.test.ts` recomputes the
 * function and asserts it reproduces the committed field EXACTLY. A hand edit is
 * a red build.
 *
 * DETERMINISM, STATED AS THE LIST OF THINGS THIS FUNCTION DOES NOT TOUCH
 * ---------------------------------------------------------------------------
 * No clock. No randomness. No hash of anything. No `process.env`. No filesystem.
 * No dependence on declaration order, on array order, or on any field that a
 * future edit to a row's PROSE could change - the sort key is the case id, which
 * the schema already requires to be "stable across versions: it is a row id in a
 * report". Editing a row's `source` text, its `text`, or the file it lives in
 * cannot move it between halves. Editing its id, its language, its kind, its
 * family or its provenance CAN, and that is correct: those are the stratification
 * variables, and a row whose stratum changed is a different row for this purpose.
 *
 * A HASH WAS CONSIDERED AND REJECTED. The obvious alternative - hash the id, take
 * the low bit - is deterministic too, but it is not STRATIFIED: it would give a
 * binomial split of each stratum, so a stratum of four rows lands 4/0 about an
 * eighth of the time, and the Hebrew CALLBACK claims could all be in one half by
 * arithmetic accident. The alternating walk below cannot do that: every stratum
 * is split as evenly as its size allows, by construction.
 */
import type { VerifierCase, VerifierCaseSplit } from './schema.js';

/**
 * THE STRATUM a row belongs to.
 *
 * FOUR VARIABLES, and each earns its place by being a variable a lopsided split
 * would make a number lie about:
 *
 *  - LANGUAGE, because the report's headline is per language and Hebrew is the
 *    language with no recommended model. A dev half that was 90% English would
 *    let a tuning round look successful while moving nothing in Hebrew.
 *  - KIND, because recall and the false-positive rate have separate denominators.
 *    A held-out half short of controls cannot measure precision (see
 *    `docs/MISSION_2G_VERIFIER_ROUND.md` § 4.3 for the arithmetic).
 *  - EFFECT FAMILY, because `docs/MISSION_2D_CLAIM_GATE.md` § 17.7 is a finding
 *    about ONE family's vocabulary. A family entirely on one side of the split
 *    would be invisible to one of the two measurements.
 *  - PROVENANCE, because `RECORDED_MODEL_OUTPUT` and `QA_FINDING` rows are the
 *    ones a reader is entitled to weigh most heavily, and both halves need some.
 *    A held-out half made only of `NEW_PARAPHRASE` rows would be a weaker final
 *    number than the dev half it was compared against.
 *
 * The `|` separator is safe because every component is drawn from a closed enum
 * and none of them contains that character.
 */
export function verifierStratumKey(entry: VerifierCase): string {
  return `${entry.language}|${entry.kind}|${entry.effectFamily}|${entry.provenance}`;
}

/**
 * THE PROCEDURE, in five steps, all of them total orders over closed data.
 *
 *  1. Group the cases by `verifierStratumKey`.
 *  2. Sort the stratum KEYS ascending, by code unit.
 *  3. Sort the ids WITHIN each stratum ascending, by code unit.
 *  4. The stratum's STARTING SIDE alternates with its ordinal in the sorted key
 *     list: the first stratum starts `dev`, the second starts `heldout`, and so
 *     on. **This step is what makes the split near-even rather than dev-heavy.**
 *     There are 3 x 2 x 8 x 3 = 144 possible strata over 172 rows, so most
 *     non-empty strata are small and many are singletons; a walk that always
 *     started at `dev` would put every singleton in `dev` and the whole corpus
 *     would come out around 60/40. Alternating the starting side spreads the
 *     odd remainders across both halves instead.
 *  5. Walk the sorted ids, alternating from that starting side.
 *
 * Steps 2 and 4 together are the "stable alternating walk" over both dimensions.
 * Nothing here consults a clock, a random source or a hash.
 */
export function assignVerifierSplits(cases: readonly VerifierCase[]): Map<string, VerifierCaseSplit> {
  const strata = new Map<string, string[]>();
  for (const entry of cases) {
    const key = verifierStratumKey(entry);
    const bucket = strata.get(key);
    if (bucket === undefined) strata.set(key, [entry.id]);
    else bucket.push(entry.id);
  }

  const assignment = new Map<string, VerifierCaseSplit>();
  // `sort()` with no comparator is a code-unit sort, which is exactly what is
  // wanted here: a total order that does not depend on a locale, a collation
  // table or an ICU version. `localeCompare` would have made the split a
  // property of the machine.
  const orderedKeys = [...strata.keys()].sort();

  for (const [stratumOrdinal, key] of orderedKeys.entries()) {
    const ids = [...(strata.get(key) ?? [])].sort();
    const startsHeldout = stratumOrdinal % 2 === 1;
    for (const [index, id] of ids.entries()) {
      const isHeldout = (index % 2 === 1) !== startsHeldout;
      assignment.set(id, isHeldout ? 'heldout' : 'dev');
    }
  }

  return assignment;
}

/**
 * Which committed rows DISAGREE with the recomputed procedure.
 *
 * Returns a list of ids and what each disagreement is. Empty is the only
 * acceptable answer for the base corpus files, and
 * `tests/eval/verifierSplitReproducibility.test.ts` asserts exactly that.
 *
 * NAMES IDS AND NEVER TEXTS, on the same rule as the anti-overfitting guard:
 * `npm run test` is run by the task that must not be handed held-out sentences,
 * so no assertion message in this repository may print a held-out `text`.
 */
export function verifierSplitDisagreements(cases: readonly VerifierCase[]): string[] {
  const expected = assignVerifierSplits(cases);
  const out: string[] = [];
  for (const entry of cases) {
    const want = expected.get(entry.id);
    if (entry.split === undefined) {
      out.push(`${entry.id}: no committed split, procedure says ${want ?? '(unknown)'}`);
      continue;
    }
    if (want !== undefined && entry.split !== want) {
      out.push(`${entry.id}: committed ${entry.split}, procedure says ${want}`);
    }
  }
  return out;
}
