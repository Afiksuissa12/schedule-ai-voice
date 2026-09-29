/**
 * THE SEMANTIC-VERIFIER CORPUS SCHEMA.
 *
 * WHY THERE IS A SECOND CORPUS AT ALL
 * ---------------------------------------------------------------------------
 * `src/eval/corpus/` measures a CONVERSATION: a seeded world, an ordered list of
 * things a human says, and per-turn expectations driven through the real
 * `AgentTurnService`. It cannot measure the thing Mission 2F added, because the
 * semantic claim verifier is a CLASSIFIER over ONE STRING and its accuracy is a
 * property of the model reading that string, not of the conversation around it.
 *
 * And the gap is not hypothetical. `MISSION-2F-SEMANTIC-CLAIM-VERIFIER-AUTO-
 * ADVERSARIAL-ASSURANCE` reported it as residual limit 1, in these words:
 *
 * > NOBODY MAY READ A GREEN SWEEP AS EVIDENCE THAT THE SEMANTIC LAYER WORKS. The
 * > sweep runs a DETERMINISTIC DOUBLE [...] INV-19 bounds the WIRING, not the
 * > vocabulary. It says nothing about whether a real verifier reads a sentence
 * > correctly, and it cannot.
 *
 * `npm test`, `npm run qa:sweep` and `npm run slice:demo` all wire a RULE-LESS
 * `RuleDrivenSemanticClaimVerifier`, which returns `CLASSIFIED` with an empty
 * claim list for every text. Everything green in this repository is therefore
 * evidence that the PIPELINE holds - the layer is on every path, the union is
 * additive, a fail-closed verdict blocks - and NONE of it is evidence that the
 * semantic layer classifies anything. **This corpus is the only artefact in the
 * repository that can produce that second kind of evidence, and it can only do so
 * when an OPERATOR runs it against a real model.**
 *
 * WHAT IT IS, PRECISELY
 * ---------------------------------------------------------------------------
 * Data. Every case is a VALUE - a string, a language, and a label drawn from the
 * port's own enums - validated by Zod at load time and versioned as a whole,
 * exactly as `src/eval/corpus/schema.ts` requires of the benchmark corpus and for
 * the same reason: a corpus expressed as procedures cannot be diffed, counted, or
 * compared against last week's run.
 *
 * THE LABEL VOCABULARY IS THE PORT'S OWN, NOT A NEW ONE
 * ---------------------------------------------------------------------------
 * `assertsEffect`, `effectFamily` and `status` are imported from
 * `src/ports/claimVerifier.ts`. They are not re-declared here and they are not
 * paraphrased. A corpus that invented its own taxonomy would be measuring
 * agreement with the corpus author rather than agreement with the contract the
 * gate actually consumes, and the day the port gained a family the corpus would
 * silently stop covering it. Importing is what makes that a red build instead.
 *
 * THESE ARE OFFLINE EVALUATION FIXTURES AND MUST NEVER REACH A PRODUCTION PATH
 * ---------------------------------------------------------------------------
 * The cases below contain customer-facing sentences, because the question this
 * corpus asks is *would a classifier recognise this sentence as a claim* and that
 * question cannot be asked without the sentence. That is the same standing this
 * repository already grants `src/eval/corpus/scenarios.en.ts`, which contains what
 * a human says, and `tests/invariants/releaseTexts.ts`, which contains verbatim
 * false sentences from eight QA findings.
 *
 * Three facts keep it honest rather than three promises:
 *
 *  1. **Nothing in the default import graph reaches `src/eval`.** The only entry
 *     points are the `eval:*` npm scripts. `npm run qa:sweep`'s network trap
 *     records zero outbound attempts precisely because no production path imports
 *     this tree.
 *  2. **`npm run check:anti-scripting` scans `src/agent`, `src/conversation` and
 *     `src/context` and does NOT scan `src/eval`** - by design, because a
 *     benchmark's job is to contain the things the check exists to keep OUT of
 *     the product. The check stays green and this file is not the reason.
 *  3. **Every string here is a RECORDED or CONSTRUCTED wording being measured,
 *     never a wording being offered.** There is no code path from this module to
 *     `AgentTurnService`, to a prompt, or to a `ScriptedLlmProvider`, and there is
 *     deliberately no field that could carry one - no `expectedReply`, no
 *     `suggestedCorrection`, no `rewrite`.
 */
import { z } from 'zod';

import {
  SEMANTIC_CLAIM_EFFECT_FAMILIES,
  SEMANTIC_CLAIM_STATUSES,
} from '../../ports/claimVerifier.js';

/**
 * Bump when the SHAPE or the SEMANTICS of a case change.
 *
 * `1.0.0` was the first. It is versioned separately from `CORPUS_SCHEMA_VERSION`
 * because the two corpora answer different questions and move independently: a
 * benchmark scenario gaining a field says nothing about whether a verifier case
 * from last week is still readable, and sharing one number would force a bump on
 * each for changes to the other.
 *
 * `1.1.0` is Mission 2G. THREE OPTIONAL FIELDS were added - `split`, `claimShape`
 * and `controlShape` - and "optional" here means optional TO THE SCHEMA and
 * REQUIRED ON EVERY IN-REPO ROW (`corpus.ts` enforces the second part). The
 * asymmetry is deliberate and is argued where it is enforced: an operator may
 * hand `--corpus-file` a sealed evaluation set that carries none of the three,
 * and a schema that rejected it would make the flag useless for the purpose it
 * was built for.
 */
export const VERIFIER_CORPUS_SCHEMA_VERSION = '1.1.0';

export const VerifierCaseLanguageSchema = z.enum(['en', 'he', 'mixed']);
export type VerifierCaseLanguage = z.infer<typeof VerifierCaseLanguageSchema>;

/**
 * What a case is FOR. Two kinds, and the asymmetry between them is the point.
 *
 * A `CLAIM` case is a sentence that DOES assert a material effect. Missing it is
 * a RECALL failure, and recall is the number this whole mission exists to move:
 * every one of the eight QA findings was a claim the deterministic layer missed.
 *
 * An `HONEST_CONTROL` is a sentence that does NOT. Flagging it is a FALSE
 * POSITIVE, and a false positive is not free - `src/agent/claimGate/semantic/
 * union.ts` makes the union additive, so a wrongly-flagged honest sentence costs
 * one regeneration of something true, and at the regeneration bound it costs a
 * hand-off on a conversation in which everything was correct.
 *
 * Both are needed, and a corpus with only the first would be satisfied by a
 * verifier that flags every sentence it is shown. That verifier would score 100%
 * recall and would make the product unusable.
 */
export const VerifierCaseKindSchema = z.enum(['CLAIM', 'HONEST_CONTROL']);
export type VerifierCaseKind = z.infer<typeof VerifierCaseKindSchema>;

/**
 * Where this wording came from. Recorded per case, and it is not decoration.
 *
 * `RECORDED_MODEL_OUTPUT` and `QA_FINDING` cases are the ones a reader is
 * entitled to weigh most heavily, because they are wordings a real model really
 * produced or a real independent reviewer really drove through the real system.
 * `NEW_PARAPHRASE` cases are wordings the corpus author invented, and the report
 * splits recall by provenance so that a headline number cannot be inflated by
 * writing fifty easy paraphrases of one sentence.
 */
export const VerifierCaseProvenanceSchema = z.enum([
  /** A sentence a benchmarked model actually produced, quoted from committed evidence. */
  'RECORDED_MODEL_OUTPUT',
  /** A wording an independent QA round drove end to end through the real system. */
  'QA_FINDING',
  /** A wording this corpus author wrote. Never yet seen from a model. */
  'NEW_PARAPHRASE',
]);
export type VerifierCaseProvenance = z.infer<typeof VerifierCaseProvenanceSchema>;

/**
 * WHICH HALF OF THE CORPUS THIS ROW IS IN. Mission 2G.
 *
 * `dev` is the half the verifier-tuning task may read, run and iterate against.
 * `heldout` is the half it may not, and the separation is the whole value of the
 * final measurement: a recall number measured on the rows somebody tuned the
 * instruction against is a number about the tuning, not about the model.
 *
 * NOT A PROPERTY OF THE SENTENCE, and that is why it is data rather than a
 * derived predicate: it is an assignment, produced once by the pure stratified
 * procedure in `./split.ts` and MATERIALISED on every row so that a diff shows
 * it. `tests/eval/verifierSplitReproducibility.test.ts` recomputes the procedure
 * from the case data and asserts it reproduces the committed field EXACTLY, so a
 * hand edit to one row's split is a red build rather than a silent leak.
 */
export const VerifierCaseSplitSchema = z.enum(['dev', 'heldout']);
export type VerifierCaseSplit = z.infer<typeof VerifierCaseSplitSchema>;

/**
 * What `--split` accepts. `'all'` is the default and is NOT a `VerifierCaseSplit`.
 *
 * Declared HERE rather than beside the loader so that the pure argument parser can
 * name the known values in its refusal message without importing the corpus data -
 * `./args.ts` reads no filesystem and holds no rows, and a dependency on 263
 * committed case objects to validate one flag would have been a strange price.
 */
export const VERIFIER_SPLIT_SELECTORS = ['dev', 'heldout', 'all'] as const;
export type VerifierSplitSelector = (typeof VERIFIER_SPLIT_SELECTORS)[number];

/**
 * WHAT MAKES THIS CLAIM HARD TO READ. On `CLAIM` rows only.
 *
 * It exists so that "the corpus covers very short confirmations, indirect
 * confirmations, passive voice, contractions, layout and reference language" is
 * a machine-checked contract (`unmetVerifierCoverage`) rather than a sentence in
 * a document. `docs/MISSION_2D_CLAIM_GATE.md` § 21.10 calls an axis somebody has
 * to remember to claim "remembered rather than mechanical"; this field is what
 * makes these axes mechanical.
 *
 * EXACTLY ONE PER ROW, assigned by the priority order documented in
 * `docs/MISSION_2G_VERIFIER_ROUND.md` § 1.4 - LAYOUT, then VERY_SHORT, then
 * REFERENCE, then CONTRACTION, then INDIRECT, then PASSIVE, then DIRECT. A row
 * that is two shapes at once gets the earlier one, so a second reader who
 * disagrees with a label can check the rule rather than argue about the row.
 */
export const VerifierClaimShapeSchema = z.enum([
  /** A layout register: a line break, a bullet, a heading or a bold label. */
  'LAYOUT',
  /** Three whitespace-separated tokens or fewer. `Booked.` is the limiting case. */
  'VERY_SHORT',
  /** The claim is carried by reading out a reference, a code or a confirmation number. */
  'REFERENCE',
  /** The predicate carrying the claim is spelled with an apostrophe contraction. */
  'CONTRACTION',
  /** No completion predicate at all: the effect is carried by implication. */
  'INDIRECT',
  /** The predicate carrying the claim is a passive or a bare participle. */
  'PASSIVE',
  /** An explicit active completion or commitment predicate. Everything else. */
  'DIRECT',
]);
export type VerifierClaimShape = z.infer<typeof VerifierClaimShapeSchema>;

/**
 * WHY THIS HONEST SENTENCE IS HONEST. On `HONEST_CONTROL` rows only.
 *
 * The false-positive side of the same argument. A corpus whose controls are all
 * NEGATIONS (`nothing is booked yet`) measures whether a verifier can read the
 * word "not" - which is the easy half. The shapes that actually cost precision
 * on honest traffic are the OFFER, the QUESTION, the CONDITIONAL and the
 * TENTATIVE INTENTION, because each of them carries the same vocabulary, the
 * same family and often the same day and hour as the claim it is a twin of.
 *
 * EXACTLY ONE PER ROW, assigned by the priority order in
 * `docs/MISSION_2G_VERIFIER_ROUND.md` § 1.5 - QUESTION, then CONDITIONAL, then
 * OFFER, then TENTATIVE_INTENTION, then PLAIN.
 */
export const VerifierControlShapeSchema = z.enum([
  /** Interrogative. The text asks rather than tells. */
  'QUESTION',
  /** The action is stated to depend on something not yet settled. */
  'CONDITIONAL',
  /** An offer or a stated capability to act, with nothing done yet. */
  'OFFER',
  /** A step being taken now, or a non-firm intention. Never a promise. */
  'TENTATIVE_INTENTION',
  /** A plain honest statement, usually a negation or a refusal. */
  'PLAIN',
]);
export type VerifierControlShape = z.infer<typeof VerifierControlShapeSchema>;

/**
 * ONE CASE.
 *
 * `.strict()`, on the same principle as everything else in this repository that
 * validates data it did not write: a key nobody declared is a key nobody
 * validated, and a typo in a label would otherwise become a silently unchecked
 * expectation - the benchmark would still run, still report a number, and quietly
 * stop testing something.
 */
export const VerifierCaseSchema = z
  .object({
    /** Kebab-case, unique, and stable across versions: it is a row id in a report. */
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, 'Case ids are kebab-case so they are safe as filenames and table keys.'),

    /** The text handed to the verifier, EXACTLY. Never normalised, never trimmed at load. */
    text: z.string().min(1),

    language: VerifierCaseLanguageSchema,

    kind: VerifierCaseKindSchema,

    // ---- MISSION 2G: THE SPLIT AND THE TWO SHAPE AXES ----------------------
    // ALL THREE ARE OPTIONAL HERE AND REQUIRED ON EVERY IN-REPO ROW, and the
    // enforcement of the second half is in `./corpus.ts` rather than here. The
    // reason is `--corpus-file`: an operator's sealed evaluation set is a
    // legitimate slice of this schema and may carry none of the three. A schema
    // that required them would refuse that file, which would make the flag
    // useless for the purpose the Founder built it for. So the schema states
    // what a case MAY carry and the in-repo loader states what THIS corpus MUST.

    /** Mission 2G. REQUIRED on every in-repo row; see `./corpus.ts`. */
    split: VerifierCaseSplitSchema.optional(),

    /** Mission 2G. REQUIRED on every in-repo `CLAIM`; forbidden on a control. */
    claimShape: VerifierClaimShapeSchema.optional(),

    /** Mission 2G. REQUIRED on every in-repo `HONEST_CONTROL`; forbidden on a claim. */
    controlShape: VerifierControlShapeSchema.optional(),

    // ---- THE EXPECTED LABEL -------------------------------------------------
    // Three fields, all REQUIRED on every case including the controls, and all
    // three drawn from `src/ports/claimVerifier.ts`. A control that simply omitted
    // them would be asserting "not a claim" by silence, and this mission's whole
    // premise is that silence about a check is not evidence the check happened.

    /**
     * Does this text assert that a material action HAPPENED or WAS COMMITTED TO?
     *
     * `true` on every `CLAIM`, `false` on every `HONEST_CONTROL`. Asserted as a
     * cross-field rule below rather than left to the author's care.
     */
    assertsEffect: z.boolean(),

    /**
     * The family the text is ABOUT.
     *
     * Present on a control too, and that is deliberate: `Nothing is booked yet.`
     * is about MEETING, and recording which family a control belongs to is what
     * lets the report say *this verifier over-flags CANCELLATION specifically*
     * rather than only *it over-flags*. The enum has no "none" member and must not
     * gain one - `ANY` already means "an effect whose family the text does not
     * say", which is a different statement from "no effect".
     */
    effectFamily: z.enum(SEMANTIC_CLAIM_EFFECT_FAMILIES),

    /**
     * How strongly the text asserts it.
     *
     * `COMPLETED` / `COMMITTED` on a claim; `NOT_CLAIMED` or `ATTEMPTED` on a
     * control. Cross-checked below.
     */
    status: z.enum(SEMANTIC_CLAIM_STATUSES),

    // ---- PROVENANCE AND NOTES ----------------------------------------------

    provenance: VerifierCaseProvenanceSchema,

    /**
     * WHERE this wording is recorded, or what the new paraphrase varies.
     *
     * A citation a reader can follow: a section number in
     * `docs/MISSION_2D_CLAIM_GATE.md`, a path into the committed evidence, or a
     * sentence saying which axis a new paraphrase moves along. Required, because
     * a corpus row nobody can trace back is a row nobody can check.
     */
    source: z.string().min(1),

    /**
     * OPTIONAL. This control is a KNOWN false positive of the DETERMINISTIC layer.
     *
     * Two of them came from `docs/MISSION_2D_CLAIM_GATE.md` § 17.7 finding B; they
     * are recorded in `tests/claimGate/claimGateCorpus.ts` as
     * `KNOWN_CONTROL_FALSE_POSITIVES`, and they are ASSERTED TO STILL FIRE there.
     * MISSION 2G FOUND A THIRD, by running the PURE detector over the new
     * held-out controls - `en-ho-control-callback-plain`, same `no` + perfect
     * passive shape, same cause. The count is not fixed at two and must not be
     * written down as two: `tests/eval/verifierLayeredReporting.test.ts` asserts
     * that the number of rows carrying this flag equals the number the pure
     * detector actually flags, so the marking is mechanical rather than
     * remembered, and a new over-reading cannot be left unrecorded.
     * Flagged here so that the verifier report can say plainly that the semantic
     * layer's verdict on these two changes nothing either way: the union is
     * additive, so the deterministic layer's flag stands whatever the model says,
     * and the regeneration is paid regardless.
     */
    knownDeterministicFalsePositive: z.boolean().optional(),

    /**
     * OPTIONAL. The text deliberately contains a line break or a layout character.
     *
     * § 19 of `docs/MISSION_2D_CLAIM_GATE.md` is an entire finding about frames
     * split by a newline, and those wordings have to be carried VERBATIM including
     * the break. Marked so a reader of a rendered report knows the ragged row is
     * the fixture and not the renderer.
     */
    containsLayoutBreak: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // The two cross-field rules. Written as refinements rather than as a comment
    // asking the author to be careful, because "be careful" is what produced eight
    // QA findings in the module this corpus is about.
    // THE SHAPE AXES MUST MATCH THE KIND. A `controlShape` on a CLAIM row is not
    // a harmless extra field - the coverage contract counts (family x
    // controlShape) pairs to prove the controls are not all negations, and a
    // claim leaking into that count would make a missing axis look covered.
    if (value.kind === 'CLAIM' && value.controlShape !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['controlShape'],
        message: `Case "${value.id}" is a CLAIM, so it must not carry a controlShape.`,
      });
    }
    if (value.kind === 'HONEST_CONTROL' && value.claimShape !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claimShape'],
        message: `Case "${value.id}" is an HONEST_CONTROL, so it must not carry a claimShape.`,
      });
    }

    if (value.kind === 'CLAIM') {
      if (!value.assertsEffect) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['assertsEffect'],
          message: `Case "${value.id}" is a CLAIM, so assertsEffect must be true.`,
        });
      }
      if (value.status !== 'COMPLETED' && value.status !== 'COMMITTED') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['status'],
          message:
            `Case "${value.id}" is a CLAIM, so its status must be COMPLETED or COMMITTED. ` +
            'ATTEMPTED and NOT_CLAIMED contribute NOTHING to the union (see semantic/union.ts), ' +
            'so a CLAIM labelled with either would be a row that can never be scored as recalled.',
        });
      }
    }

    if (value.kind === 'HONEST_CONTROL') {
      if (value.assertsEffect) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['assertsEffect'],
          message: `Case "${value.id}" is an HONEST_CONTROL, so assertsEffect must be false.`,
        });
      }
      if (value.status === 'COMPLETED' || value.status === 'COMMITTED') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['status'],
          message:
            `Case "${value.id}" is an HONEST_CONTROL, so its status must be ATTEMPTED or NOT_CLAIMED. ` +
            'A control carrying a MATERIAL status is a claim mislabelled as a control, which would ' +
            'turn a recall miss into a false-positive pass and flatter every number in the report.',
        });
      }
      if (value.knownDeterministicFalsePositive === undefined) return;
    }
  });

export type VerifierCase = z.infer<typeof VerifierCaseSchema>;

export const VerifierCorpusSchema = z
  .object({
    schemaVersion: z.literal(VERIFIER_CORPUS_SCHEMA_VERSION),
    corpusVersion: z.string().min(1),
    cases: z.array(VerifierCaseSchema).min(1),
  })
  .strict();

export type VerifierCorpus = z.infer<typeof VerifierCorpusSchema>;
