/**
 * THE SWEEP'S SEMANTIC LAYER: a DISPATCHER, and deliberately nothing more.
 *
 * WHY THE SWEEP NEEDS THIS AT ALL
 * ---------------------------------------------------------------------------
 * `buildAgentRuntime` resolves `RuleDrivenSemanticClaimVerifier` with no rules for
 * every offline caller, and that double returns `CLASSIFIED` with an empty claim
 * list for every text. It adds nothing, which is exactly right as a default - it is
 * why the whole pre-2F suite behaves identically - and it is useless as a sweep
 * DIMENSION. A dimension that only ever takes one value is the vacuity
 * `dimensions.test.ts` exists to catch: `docs/MISSION_2D_CLAIM_GATE.md` § 17.6 is
 * the record of a block of specs being asserted on a COUNT rather than on its axis
 * VALUES, and § 21.9 sharpens it into the test a reader should apply - which PAIRS
 * of axis values does this table actually contain?
 *
 * So the sweep has to be able to put the second layer into each of its states, per
 * scenario, and this is the smallest thing that can do it.
 *
 * WHAT IT IS, PRECISELY, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * IT IS A LOOKUP ON EXACT BYTES. `classify` takes `request.text`, looks it up in a
 * map built from `RELEASE_SPECS`, and returns the verdict that map holds. That is
 * the whole implementation.
 *
 * IT CONTAINS NO CLASSIFICATION LOGIC WHATSOEVER - no lexicon, no substring rule,
 * no heuristic, nothing that reads a sentence. It cannot, and that is the point: a
 * double that made judgements would be a second detector wearing a verifier's
 * interface, and then the sweep would be measuring the double instead of the
 * pipeline. Every verdict it returns was written down by a person beside the
 * sentence in `dimensions.ts`, exactly as every declaration was written down beside
 * the sentence in `releaseTexts.ts`.
 *
 * IT IS NOT A MODEL AND NOTHING HERE CALLS ONE. Deterministic in the strong sense:
 * no clock, no randomness, no network, no I/O. The same text produces the same
 * verdict on every run and in every process, which is what `INV-09` requires of the
 * whole sweep and what `npm run qa:sweep -- --determinism` re-checks by running it
 * twice.
 *
 * WHY A DISPATCHER AND NOT ONE OF THE LANDED DOUBLES DIRECTLY
 * ---------------------------------------------------------------------------
 * Both landed doubles are per-INSTANCE and the sweep needs per-TEXT. A
 * `ScriptedSemanticClaimVerifier` answers a queue in call order, which is wrong
 * here because a chunk of 32 scenarios shares one runtime and the call order
 * depends on which worker took which chunk. A `RuleDrivenSemanticClaimVerifier`
 * answers from rules, but its `forcedVerdict` - the seam for making it fail - is
 * per instance, so one instance cannot be MALFORMED for one scenario and healthy
 * for the next.
 *
 * Keying on the exact text is what makes it order-independent, and order
 * independence is what keeps the sweep deterministic while its chunks run
 * concurrently. `classifiedWithNoClaims` from `doubles.ts` supplies the default, so
 * the "adds nothing" verdict is the same value the offline composition produces
 * rather than a second copy of it.
 *
 * THE ONE RULE THAT MAKES THE KEYING SAFE
 * ---------------------------------------------------------------------------
 * A text may carry AT MOST ONE behaviour. Several specs legitimately script the
 * same sentence - `r02` and `r06` both script
 * `Your meeting is booked for Thursday at 2pm.` - so a spec that wants a non-neutral
 * second layer must script texts NO OTHER SPEC SCRIPTS, or it would silently change
 * another scenario's outcome. `buildSemanticSweepScript` THROWS on a conflict rather
 * than resolving it, which is the same drift alarm `buildDeclarationIndex` raises for
 * two declarations of one sentence, and `dimensions.test.ts` asserts the rule by
 * name so the failure arrives at authoring time.
 */
import {
  classifiedWithNoClaims,
} from '../../src/agent/claimGate/semantic/doubles.js';
import type {
  SemanticClaim,
  SemanticClaimVerdict,
  SemanticClaimVerificationRequest,
  SemanticClaimVerifier,
} from '../../src/ports/claimVerifier.js';

/**
 * What the second layer does on one spec's texts.
 *
 * Six values, and each one is a state the layer can really be in:
 *
 * `NEUTRAL` - `CLASSIFIED` with no claims. The default every pre-2F spec gets, and
 *   the state the offline composition wires. It ADDS NOTHING, so a scenario
 *   carrying it behaves exactly as it did before this mission - which is why all
 *   1,127 existing scenarios keep byte-identical outcomes.
 *
 * `WRONGLY_CLEAN` - **THE SAME VERDICT AS `NEUTRAL`, AND THAT IS WORTH SAYING OUT
 *   LOUD RATHER THAN HIDING IN A TYPE.** A verifier that looks at a false sentence
 *   and reports no claim is indistinguishable, at the port, from one that looked at
 *   an honest sentence and reported no claim - there is no field on the result by
 *   which it could differ. So this value changes no bytes; it is a DECLARATION about
 *   what the spec is for, so that the sweep report can name the scenarios that
 *   exercise "the second layer said clean and the first layer's finding stood" and
 *   `dimensions.test.ts` can require some to exist. The property it declares is
 *   cross-layer proof (b) at sweep scale.
 *
 * `SEES_WHAT_THE_DETECTOR_MISSED` - `CLASSIFIED` with one claim, built from
 *   `SweepSemanticClaim` data the spec declares. Used with wordings the real
 *   detector finds nothing in, which is cross-layer proof (a) at sweep scale.
 *
 * `AGREES_WITH_THE_DETECTOR` - the same construction, over a wording the detector
 *   DOES see, declaring the SAME family and mode. It exists for one reason and the
 *   reason is an axis value: it is the only way the sweep produces a claim tagged
 *   `BOTH`. Without it the `ClaimSource` axis would carry `DETERMINISTIC` and
 *   `SEMANTIC` and never the third value, and a report printing "which layer caught
 *   each claim" over a corpus that never produced one of the three answers is the
 *   half-crossed axis § 21.9 is about. `catchingLayerFor` returns `DETERMINISTIC`
 *   for it, because the detector sees the wording too and the existing
 *   detector-visibility floor is the right one.
 *
 * `MALFORMED` / `TIMED_OUT` / `UNAVAILABLE` / `EMPTY` - the four fail-closed
 *   variants, as values. No timers and no failure injection: a timeout is a verdict.
 */
export type SemanticSweepBehaviour =
  | 'NEUTRAL'
  | 'WRONGLY_CLEAN'
  | 'SEES_WHAT_THE_DETECTOR_MISSED'
  | 'AGREES_WITH_THE_DETECTOR'
  | 'MALFORMED'
  | 'TIMED_OUT'
  | 'UNAVAILABLE'
  | 'EMPTY';

export const SEMANTIC_SWEEP_BEHAVIOURS: readonly SemanticSweepBehaviour[] = [
  'NEUTRAL',
  'WRONGLY_CLEAN',
  'SEES_WHAT_THE_DETECTOR_MISSED',
  'AGREES_WITH_THE_DETECTOR',
  'MALFORMED',
  'TIMED_OUT',
  'UNAVAILABLE',
  'EMPTY',
];

/** The behaviours that make the second layer produce nothing usable. */
export const FAIL_CLOSED_SWEEP_BEHAVIOURS: readonly SemanticSweepBehaviour[] = [
  'MALFORMED',
  'TIMED_OUT',
  'UNAVAILABLE',
  'EMPTY',
];

/**
 * WHICH LAYER A SPEC EXPECTS TO CATCH ITS CLAIM.
 *
 * DERIVED FROM THE BEHAVIOUR RATHER THAN DECLARED SEPARATELY, so the two cannot
 * drift - the § 21.4 argument for `bothNumbers` applied to a much smaller thing.
 */
export type ExpectedCatchingLayer = 'DETERMINISTIC' | 'SEMANTIC' | 'FAIL_CLOSED';

export function catchingLayerFor(behaviour: SemanticSweepBehaviour): ExpectedCatchingLayer {
  if (behaviour === 'SEES_WHAT_THE_DETECTOR_MISSED') return 'SEMANTIC';
  if (FAIL_CLOSED_SWEEP_BEHAVIOURS.includes(behaviour)) return 'FAIL_CLOSED';
  return 'DETERMINISTIC';
}

/**
 * The claim a `SEES_WHAT_THE_DETECTOR_MISSED` spec says its verifier found.
 *
 * `whenPhrase` and `identifier` are QUOTED VERBATIM from the text or they are
 * `null`. That is not a convention: `src/agent/claimGate/semantic/schema.ts`
 * rejects an ungrounded quote as MALFORMED, so a double emitting one would be
 * exercising a path production can never reach. `dimensions.test.ts` asserts
 * containment for every declared claim.
 *
 * NOTHING HERE IS A PARSED DAY. The semantic layer is forbidden a day - that is the
 * scheduling resolver's vocabulary and a second reader of it is the § 20 defect
 * waiting to happen twice - so a quoted phrase becomes `unreadTemporal` in
 * `union.ts` and the EXISTING `UNREADABLE_WHEN` rule answers it.
 */
export interface SweepSemanticClaim {
  readonly effectFamily: SemanticClaim['effectFamily'];
  readonly status: 'COMPLETED' | 'COMMITTED';
  readonly whenPhrase: string | null;
  readonly identifier: string | null;
}

/** One text, and what the second layer does when it sees exactly those bytes. */
export interface SemanticSweepEntry {
  readonly behaviour: SemanticSweepBehaviour;
  readonly verdict: SemanticClaimVerdict;
  /** The spec that asked for it, for a conflict message. */
  readonly specKey: string;
}

/** The neutral verdict, taken from `doubles.ts` rather than written again. */
export const NEUTRAL_SWEEP_VERDICT: SemanticClaimVerdict = classifiedWithNoClaims();

/** Turn one behaviour into the verdict the double returns. */
export function verdictFor(
  behaviour: SemanticSweepBehaviour,
  claim: SweepSemanticClaim | undefined,
  specKey: string,
): SemanticClaimVerdict {
  switch (behaviour) {
    case 'NEUTRAL':
    case 'WRONGLY_CLEAN':
      return NEUTRAL_SWEEP_VERDICT;
    case 'SEES_WHAT_THE_DETECTOR_MISSED':
    case 'AGREES_WITH_THE_DETECTOR': {
      if (claim === undefined) {
        throw new Error(
          `Release spec "${specKey}" declares semantic behaviour ${behaviour} and no ` +
            '`semanticClaim`. The claim is the whole content of that behaviour - without it the double would ' +
            'return CLASSIFIED with nothing in it, which is NEUTRAL, and the spec would silently stop testing ' +
            'the thing its key says it tests.',
        );
      }
      return {
        kind: 'CLASSIFIED',
        claims: [
          {
            assertsEffect: true,
            effectFamily: claim.effectFamily,
            status: claim.status,
            whenPhrase: claim.whenPhrase,
            identifier: claim.identifier,
            // A NUMBER, AND NOTHING BRANCHES ON IT. `src/ports/claimVerifier.ts`
            // records why: a threshold is a way for a model's own uncertainty to
            // clear a claim, and this layer may not clear anything.
            confidence: 0.9,
          },
        ],
        // `null` rather than an invented model name: no model produced this and
        // writing one here would put a false attribution in the audit trail.
        modelId: null,
      };
    }
    // The four failures. The reason names this file, so an operator reading a
    // sweep report can tell an injected failure from a real one at a glance.
    case 'MALFORMED':
      return { kind: 'MALFORMED', reason: `injected by ${specKey} (tests/invariants/semanticSweepVerifier.ts)` };
    case 'TIMED_OUT':
      return { kind: 'TIMED_OUT', reason: `injected by ${specKey} (tests/invariants/semanticSweepVerifier.ts)` };
    case 'UNAVAILABLE':
      return { kind: 'UNAVAILABLE', reason: `injected by ${specKey} (tests/invariants/semanticSweepVerifier.ts)` };
    case 'EMPTY':
      return { kind: 'EMPTY', reason: `injected by ${specKey} (tests/invariants/semanticSweepVerifier.ts)` };
  }
}

/** What `buildSemanticSweepScript` needs to know about one spec. */
export interface SemanticSweepSpecView {
  readonly key: string;
  readonly behaviour: SemanticSweepBehaviour;
  readonly claim: SweepSemanticClaim | undefined;
  /** Every text this spec scripts, in script order. */
  readonly texts: readonly string[];
}

/**
 * Build the text -> verdict map, refusing to let one text carry two behaviours.
 *
 * THROWS RATHER THAN RESOLVING. A conflict is not a thing to settle by
 * last-write-wins: it means a spec asking for a MALFORMED second layer has silently
 * changed the outcome of every other spec scripting the same sentence, which would
 * move a number in the sweep for a reason nobody could find. Same discipline as
 * `buildDeclarationIndex`.
 *
 * `NEUTRAL` AND `WRONGLY_CLEAN` SPECS ARE NOT ENTERED INTO THE MAP AT ALL, and the
 * second of those needs a sentence of justification because it looks like an
 * omission. Both produce the DEFAULT verdict, so an entry for either would be a
 * no-op that only creates false conflict risk - and worse, a `WRONGLY_CLEAN` spec
 * sharing a sentence with a `MALFORMED` one would then take the MALFORMED verdict
 * silently, because the conflict check only fires when two behaviours DISAGREE.
 * Keeping them out means the map holds exactly the texts whose second layer really
 * differs, so a reader can see the whole of the new dimension by printing it, and
 * `dimensions.test.ts` separately asserts that no `WRONGLY_CLEAN` spec's text
 * appears in the map - which is the contamination that would otherwise be invisible.
 */
export function buildSemanticSweepScript(
  specs: readonly SemanticSweepSpecView[],
): Map<string, SemanticSweepEntry> {
  const script = new Map<string, SemanticSweepEntry>();
  for (const spec of specs) {
    if (spec.behaviour === 'NEUTRAL' || spec.behaviour === 'WRONGLY_CLEAN') continue;
    const verdict = verdictFor(spec.behaviour, spec.claim, spec.key);
    for (const text of spec.texts) {
      const existing = script.get(text);
      if (existing !== undefined && existing.behaviour !== spec.behaviour) {
        throw new Error(
          `Two release specs want different semantic-layer behaviour for the SAME scripted text ` +
            `${JSON.stringify(text)}: "${existing.specKey}" asks for ${existing.behaviour} and "${spec.key}" ` +
            `asks for ${spec.behaviour}. The sweep's verifier is keyed on the exact bytes, so one text cannot ` +
            'have two behaviours - and a spec wanting a non-neutral second layer must script sentences no ' +
            'other spec scripts, or it changes that other scenario without saying so.',
        );
      }
      script.set(text, { behaviour: spec.behaviour, verdict, specKey: spec.key });
    }
  }
  return script;
}

/**
 * THE DOUBLE THE SWEEP WIRES.
 *
 * Implements `SemanticClaimVerifier` and does one thing: look the text up.
 *
 * `requests` records every call, for the same reason the landed doubles do: it is
 * how a test proves the negative that matters - that the layer was asked about
 * EVERY customer-facing text, including every regenerated one, and was handed the
 * text and the correlation id and nothing else.
 */
export class SemanticSweepVerifier implements SemanticClaimVerifier {
  readonly verifierName = 'sweep-semantic-claim-verifier';

  readonly requests: SemanticClaimVerificationRequest[] = [];

  constructor(private readonly script: ReadonlyMap<string, SemanticSweepEntry>) {}

  /** How many texts carry a non-neutral behaviour. `0` means the dimension is dead. */
  get scriptedTextCount(): number {
    return this.script.size;
  }

  async classify(request: SemanticClaimVerificationRequest): Promise<SemanticClaimVerdict> {
    this.requests.push(request);
    // EXACT BYTES. No trimming, no normalising, no case folding - a lookup that
    // massaged its key would be a lookup making a judgement, and the whole value
    // of this class is that it makes none.
    return this.script.get(request.text)?.verdict ?? NEUTRAL_SWEEP_VERDICT;
  }
}
