/**
 * THE UNION: two layers in, one claim list out, and it can only ever GROW.
 *
 * WHAT THIS FUNCTION IS FOR
 * ---------------------------------------------------------------------------
 * The Founder's rule for the semantic layer is one sentence: *the verifier may
 * only ADD suspicion.* A rule like that is worth nothing as a convention -
 * `docs/MISSION_2D_CLAIM_GATE.md` § 4.1's whole argument is that an instruction
 * is a request and a mechanism is a limit - so it is a property of this
 * function, and `tests/agent/semanticClaimUnion.test.ts` proves it for every
 * possible semantic verdict, including one that says every claim is clean, one
 * that returns an empty list, and each of the four failures.
 *
 * THE PROPERTY, STATED SO IT CAN BE CHECKED
 * ---------------------------------------------------------------------------
 *   For ANY `deterministic` and ANY `verdict`:
 *     `unionClaims(...).claims.map(e => e.claim)` begins with `deterministic`,
 *     in the same order, with the same object identities.
 *
 * Object identity, not deep equality, and that is the strong form on purpose: a
 * claim cannot be "downgraded" by a rebuilt copy with a field changed, because
 * the very same object comes out. The only thing the semantic layer can do to a
 * deterministic claim is change its SOURCE TAG from `DETERMINISTIC` to `BOTH`,
 * which is a statement about who saw it and has no bearing on how it is
 * reconciled.
 *
 * WHY A WRAPPER TYPE AND NOT A FIELD ON `DetectedClaim`
 * ---------------------------------------------------------------------------
 * `detector.ts` is owned by another task this mission and is the file eight QA
 * rounds have been fixing. A source tag is not the detector's business, it is
 * the union's, and `SourcedClaim` keeps the detector's type exactly as it is -
 * no coordination, no merge risk, and no chance of this mission's change being
 * blamed for a detector regression.
 *
 * HOW A SEMANTIC CLAIM BECOMES SOMETHING RECONCILIATION CAN READ
 * ---------------------------------------------------------------------------
 * By being shaped into a `DetectedClaim` and handed to the EXISTING
 * `verifyClaims`. Nothing about families, day and time agreement, the
 * unreadable-when rule, identifiers, refusals or earlier turns is forked or
 * reimplemented here - this module produces input and makes no verdict.
 *
 * THE ONE PLACE THAT NEEDED A JUDGEMENT, AND IT IS THE TEMPORAL FIELD.
 * A `DetectedClaim` carries a PARSED `assertedDay` / `assertedTime`; a
 * `SemanticClaim` carries a VERBATIM `whenPhrase` and nothing else, because the
 * verifier is forbidden from parsing a day or an hour - that is the scheduling
 * resolver's vocabulary and a second reader of it is the § 20 defect waiting to
 * happen twice. So a semantic-only claim that quotes a when-phrase is emitted
 * with `unreadTemporal: [thePhrase]`, which is the detector's OWN existing
 * signal for *the text named a time I could not read* and which
 * `verifier.ts` already answers with `UNREADABLE_WHEN`.
 *
 * WHAT THAT COSTS, NAMED RATHER THAN DISCOVERED. A TRUTHFUL sentence in a
 * phrasing the deterministic layer misses, naming a day the records agree with -
 * `Your meeting's booked for Thursday at 2pm.` against a real Thursday 2pm
 * booking - is UNSUPPORTED for `UNREADABLE_WHEN` and costs ONE regeneration. It
 * is not released byte-identical, and a reader should not expect it to be. The
 * alternative was to let the semantic layer assert a day, which is the one thing
 * the authority boundary forbids. One regeneration of a true sentence is the
 * documented price of the fail-safe direction, and it is the same price § 20
 * already pays for a temporal phrase the readers cannot parse.
 *
 * A semantic-only claim that quotes NO when-phrase has `unreadTemporal: []`, so
 * `Your meeting's booked.` against a real meeting is SUPPORTED and released
 * byte-identical, with no regeneration at all.
 */
import type { DetectedClaim } from '../detector.js';
import type { SemanticClaim, SemanticClaimVerdict } from '../../../ports/claimVerifier.js';
import { MATERIAL_SEMANTIC_CLAIM_STATUSES } from './schema.js';

/** Which layer found a claim. */
export const CLAIM_SOURCES = ['DETERMINISTIC', 'SEMANTIC', 'BOTH'] as const;

export type ClaimSource = (typeof CLAIM_SOURCES)[number];

/**
 * What the semantic layer did on this text.
 *
 * `ABSENT` is not one of the port's verdict kinds and is not a failure the
 * verifier can report - it is the gate's word for NO VERIFIER WAS WIRED, which
 * is a TEST-ONLY seam (`ClaimGateOptions.verifier: null`). It is in this union
 * rather than represented as `null` so that every consumer - the audit detail,
 * the per-turn report, the sweep - has to name it, and so that it cannot be
 * quietly conflated with `CLASSIFIED` and no claims.
 */
export type SemanticLayerOutcome = SemanticClaimVerdict['kind'] | 'ABSENT';

export interface SourcedClaim {
  /** The claim, EXACTLY as its layer produced it. Never rebuilt, never edited. */
  readonly claim: DetectedClaim;
  readonly source: ClaimSource;
}

export interface ClaimUnion {
  /** Every deterministic claim first, in order, then the semantic-only ones. */
  readonly claims: readonly SourcedClaim[];
  readonly semanticOutcome: SemanticLayerOutcome;
  /**
   * The semantic layer did not produce a usable classification, so its silence
   * carries no information and must not be read as one.
   *
   * True for all four failure variants AND for `ABSENT`. The gate turns this
   * into an UNSUPPORTED claim with reason `SEMANTIC_CHECK_UNAVAILABLE`, reads
   * the ledger, and regenerates - see `../claimGate.ts`.
   */
  readonly failClosed: boolean;
  /** How many the deterministic layer found. */
  readonly deterministicCount: number;
  /** How many semantic claims CONTRIBUTED - material status and asserting an effect. */
  readonly semanticContributingCount: number;
  /** Present only on a failure, for the audit detail. Never a customer-facing sentence. */
  readonly semanticFailureReason: string | null;
}

/**
 * The locale recorded on a claim this layer produced.
 *
 * Not `en` and not `he`: no lexicon fired, and writing one of those would make
 * an audit detail claim a locale rule matched when none did. `semantic` is a
 * value a reader can look up, and it is how a report tells the two layers apart
 * without consulting the source tag.
 */
export const SEMANTIC_CLAIM_LOCALE = 'semantic';

/**
 * The `matchedForm` recorded on a claim this layer produced.
 *
 * `DetectedClaim.matchedForm` is documented as *the form as written in the
 * lexicon, never a customer-facing sentence*, and a semantic claim matched no
 * form at all. A fixed marker keeps that field honest, keeps it out of the
 * customer-facing-wording category entirely, and gives
 * `stateInstruction.ts` and the handover description something stable to print.
 */
export const SEMANTIC_CLAIM_MATCHED_FORM = '(semantic claim verifier)';

/** How much of the text a semantic claim's `excerpt` carries into the audit trail. */
const SEMANTIC_EXCERPT_LIMIT = 400;

export interface UnionClaimsInput {
  /** The text both layers read. Used for the excerpt only; nothing is re-detected here. */
  readonly text: string;
  /** Exactly what `detectMaterialClaims` returned. */
  readonly deterministic: readonly DetectedClaim[];
  /** The verifier's verdict, or `null` when no verifier is wired (the TEST-ONLY seam). */
  readonly verdict: SemanticClaimVerdict | null;
}

/**
 * Union the two layers.
 *
 * PURE. No clock, no database, no provider, no I/O - the same discipline
 * `detector.ts` and `verifier.ts` already keep, and for the same reason: it
 * makes the additive property a table of cases rather than an integration test.
 */
export function unionClaims(input: UnionClaimsInput): ClaimUnion {
  // ---- 1. the deterministic list, entire and in order, ALWAYS -------------
  // Built first and never filtered. Everything after this point may only
  // append, or re-tag an entry from DETERMINISTIC to BOTH.
  const entries: { claim: DetectedClaim; source: ClaimSource }[] = input.deterministic.map((claim) => ({
    claim,
    source: 'DETERMINISTIC' as ClaimSource,
  }));

  const verdict = input.verdict;

  if (verdict === null) {
    return {
      claims: entries,
      semanticOutcome: 'ABSENT',
      failClosed: true,
      deterministicCount: input.deterministic.length,
      semanticContributingCount: 0,
      semanticFailureReason: 'no semantic claim verifier was wired for this review',
    };
  }

  if (verdict.kind !== 'CLASSIFIED') {
    return {
      claims: entries,
      semanticOutcome: verdict.kind,
      failClosed: true,
      deterministicCount: input.deterministic.length,
      semanticContributingCount: 0,
      semanticFailureReason: verdict.reason,
    };
  }

  // ---- 2. only the semantic claims that say something material ------------
  // `assertsEffect: false`, `ATTEMPTED` and `NOT_CLAIMED` contribute NOTHING.
  // That is not the verifier clearing anything: the deterministic list above is
  // already fixed, and dropping a non-claim from the semantic side cannot
  // remove a deterministic claim, because nothing below touches `entries`
  // except to append or to re-tag.
  const contributing = verdict.claims.filter(
    (claim) => claim.assertsEffect && MATERIAL_SEMANTIC_CLAIM_STATUSES.includes(claim.status),
  );

  let contributed = 0;
  for (const [index, semantic] of contributing.entries()) {
    const coinciding = entries.findIndex(
      (entry) => entry.source !== 'SEMANTIC' && coincides(entry.claim, semantic),
    );

    if (coinciding >= 0) {
      // BOTH layers saw this one. The DETERMINISTIC claim is what travels on -
      // it is the one carrying a parsed `assertedDay` and `assertedTime`, and
      // replacing it with the semantic wrapper would turn a readable day into
      // an unreadable phrase, which is the semantic layer making a
      // deterministic finding WORSE. Re-tagging is the whole of the change.
      const existing = entries[coinciding];
      if (existing) entries[coinciding] = { claim: existing.claim, source: 'BOTH' };
      continue;
    }

    entries.push({ claim: toDetectedClaim(semantic, index, input.text), source: 'SEMANTIC' });
    contributed += 1;
  }

  return {
    claims: entries,
    semanticOutcome: 'CLASSIFIED',
    failClosed: false,
    deterministicCount: input.deterministic.length,
    semanticContributingCount: contributed,
    semanticFailureReason: null,
  };
}

// ---------------------------------------------------------------------------

/**
 * Do these two describe the SAME claim?
 *
 * The test is deliberately narrow, and narrow here means "coincide less often",
 * which means "add more often", which is the safe direction: a semantic claim
 * wrongly judged NOT to coincide is emitted separately and costs at most one
 * regeneration, while one wrongly judged TO coincide would be silently folded
 * into a deterministic claim and could lose its identifier or its when-phrase.
 *
 * Three conditions, all required:
 *
 *  1. SAME FAMILY AND SAME MODE. Two different families are two different
 *     claims and both must be reconciled - a text asserting a meeting AND a
 *     confirmation email is two claims, and the second is `NO_TOOL_FOR_PROMISE`.
 *
 *  2. THE DETERMINISTIC CLAIM ALREADY ACCOUNTS FOR THE IDENTIFIER. If the
 *     semantic layer quotes a reference the deterministic claim does not list,
 *     they are not the same claim: `INVENTED_IDENTIFIER` is checked per claim
 *     against `claim.identifiers`, so folding would lose the check entirely.
 *
 *  3. THE DETERMINISTIC CLAIM ALREADY SAW TEMPORAL MATERIAL, IF THE SEMANTIC
 *     ONE QUOTES ANY. A deterministic claim with a parsed day, a parsed time or
 *     a non-empty `unreadTemporal` has already been asked about the when, and
 *     its answer is the better one. A deterministic claim that named nothing
 *     temporal, paired with a semantic claim that quotes a phrase, is the
 *     interesting case - the detector saw the completion and missed the time -
 *     and the two are kept apart so the quoted phrase reaches
 *     `UNREADABLE_WHEN`.
 */
function coincides(deterministic: DetectedClaim, semantic: SemanticClaim): boolean {
  if (deterministic.family !== semantic.effectFamily) return false;
  if (deterministic.mode !== semantic.status) return false;

  if (semantic.identifier !== null) {
    const quoted = semantic.identifier.trim().toLowerCase();
    const known = deterministic.identifiers.some((identifier) => identifier.trim().toLowerCase() === quoted);
    if (!known) return false;
  }

  if (semantic.whenPhrase !== null) {
    const sawTemporal =
      deterministic.assertedDay !== null ||
      deterministic.assertedTime !== null ||
      deterministic.unreadTemporal.length > 0;
    if (!sawTemporal) return false;
  }

  return true;
}

/**
 * Shape one semantic claim into the type reconciliation consumes.
 *
 * Every field is either copied from the semantic claim or is a declared
 * constant. NOTHING IS PARSED: no day, no hour, no identifier shape, no locale
 * detection. This function is a translator and the absence of any reading in it
 * is the authority boundary at its narrowest point.
 */
function toDetectedClaim(semantic: SemanticClaim, index: number, text: string): DetectedClaim {
  return {
    // Always an effect assertion. `IDENTIFIER_ASSERTED` is the detector's kind
    // for a MARKER PHRASE with no identifier beside it - a lexical finding this
    // layer does not make - and claiming it here would route the claim into a
    // branch of `verifyClaims` written for a different observation. A quoted
    // identifier still reaches `INVENTED_IDENTIFIER`, because that check runs
    // on `identifiers` before the kind is looked at.
    kind: 'EFFECT_ASSERTED',
    family: semantic.effectFamily,
    // Narrowed by the caller: only COMPLETED and COMMITTED get this far, and
    // those two ARE `ClaimAssertionMode` (proven in `./schema.ts`).
    mode: semantic.status === 'COMPLETED' ? 'COMPLETED' : 'COMMITTED',
    locale: SEMANTIC_CLAIM_LOCALE,
    matchedForm: SEMANTIC_CLAIM_MATCHED_FORM,
    // THE ORDINAL OF THIS CLAIM, NOT A SENTENCE POSITION, and the difference is
    // worth stating because the field's name promises otherwise. The semantic
    // layer does not segment sentences - segmentation is `text.ts`'s job and
    // duplicating it would be a second reader of the same thing. The value is
    // used to keep two semantic claims distinguishable in an audit detail, which
    // is all a sentence index is used for on this path.
    sentenceIndex: index,
    excerpt: text.length > SEMANTIC_EXCERPT_LIMIT ? `${text.slice(0, SEMANTIC_EXCERPT_LIMIT)}...` : text,
    // Never parsed. See the module header.
    assertedDay: null,
    assertedTime: null,
    unreadTemporal: semantic.whenPhrase === null ? [] : [semantic.whenPhrase],
    identifiers: semantic.identifier === null ? [] : [semantic.identifier],
  };
}
