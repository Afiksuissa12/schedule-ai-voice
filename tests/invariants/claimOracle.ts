/**
 * THE INDEPENDENT ORACLE: ground truth about a scripted sentence, declared by
 * hand, judged against observed state, and owing the claim gate's detector
 * NOTHING.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * INV-18 asks "did the system release a sentence asserting an effect that is not
 * there". To answer it you need two halves: WHICH CLAIMS ARE IN THE TEXT, and
 * WHETHER THE STATE SUPPORTS THEM. The second half has always been independent -
 * `invariants.ts` re-derives it from rows read back through the repositories with
 * Luxon, never by calling `buildActionLedger` or `verifyClaims`. The FIRST half
 * was not: it called `detectMaterialClaims`, the gate's own detector.
 *
 * That is a circle, and it closed over a live defect four times running
 * (`docs/MISSION_2D_CLAIM_GATE.md` §§ 14.1, 15.1, 16.1, 17.1). A sentence the
 * detector cannot see produces no claims, so INV-18 finds nothing to check, so
 * the sweep prints `CLAIMS THAT LEAKED PAST THE GATE : 0` while the sentence is
 * being spoken to a caller and written to `ConversationTurn`. The fourth time,
 * QA-3's `אין בעיה הפגישה נקבעה למחר בשעה 14:00.` leaked end to end with
 * `npm run test`, `npm run typecheck` and `npm run qa:sweep` all green.
 *
 * `.tmp/qa/sweep-report.txt` admitted the circularity in so many words. Admitting
 * it four times is not a fix.
 *
 * WHAT THIS IS INSTEAD
 * ---------------------------------------------------------------------------
 * Every scripted model text in the sweep and in the e2e scenarios DECLARES, as
 * test data authored beside the sentence, what it asserts: whether it asserts a
 * material effect at all, of which FAMILY, in which MODE, naming which local day
 * and hour, and reading out which identifier tokens. That declaration is written
 * by a person reading the sentence. It is not derived from the detector, from the
 * verifier, or from any helper that imports them - and it cannot be, because
 * THIS MODULE IMPORTS NOTHING AT ALL. `claimOracleBoundary.test.ts` walks the
 * transitive import closure of this file and fails if anything in it reaches
 * `src/agent/claimGate/**`, in the spirit of `vendorBoundary.test.ts`.
 *
 * The verdict then comes from the sweep's OWN OBSERVED STATE - the rows that were
 * actually persisted and the tool calls that actually succeeded, which the runner
 * already reads back through the repositories. A declared MEETING claim released
 * on a scenario where no meeting exists is a failure. A declared claim the ledger
 * genuinely supports is not.
 *
 * So the invariant can now fail for a reason the detector did not supply, which
 * is the entire point of the deliverable.
 *
 * WHAT THIS IS NOT
 * ---------------------------------------------------------------------------
 * It is NOT a second detector. It cannot read an arbitrary sentence; it can only
 * judge one somebody declared. That bound is real and it is stated in
 * `docs/MISSION_2D_CLAIM_GATE.md` § 17.8 rather than glossed: text the sweep
 * releases that nobody declared is caught by the MANDATORY-DECLARATION rule
 * (an undeclared released text fails INV-18 outright), not by an oracle that
 * understood it.
 *
 * It does NOT replace the detector-based check either. Both witnesses run, and
 * the two disagreeing is itself reported - see `WitnessAgreement` below.
 *
 * AND THE SEMANTIC LAYER DOES NOT REMOVE THAT BOUND - MISSION 2F
 * ---------------------------------------------------------------------------
 * Recorded here plainly, because it is the sentence most likely to be assumed away
 * now that a second layer exists.
 *
 * THE BOUND IS UNCHANGED. This oracle is still bounded to sentences somebody
 * DECLARED. That is exactly why it did not catch the 2D-R QA-3 classes and the
 * § 21 classes after them - nobody had declared those sentences, because nobody had
 * written them - and it is why it is correctly NOT AT FAULT for those findings.
 * § 21.2 reason 3 says the same thing about the same round: the sweep was silent
 * about them, and silence is not safety.
 *
 * Mission 2F adds a semantic verifier to the GATE. It adds nothing to this file's
 * reach, and it could not: the verifier reads arbitrary text and this oracle reads
 * declarations, and the whole point of § 6 below is that the oracle may not consult
 * the verifier's answer. So after Mission 2F, as before it:
 *
 *   - a novel false sentence nobody declared is still invisible to this oracle;
 *   - what stands between it and a caller is now TWO layers of the gate instead of
 *     one, which is a change to the GATE's coverage and not to the ASSURANCE's;
 *   - and `CLAIMS THAT LEAKED PAST THE GATE : 0` still means what § 17.8 residual 1
 *     says it means - a statement about the sentences somebody thought of.
 *
 * What § 6 DOES add is a different kind of check, and it is worth naming so the two
 * are not confused: the oracle can now fail a release because the PIPELINE did not
 * run both layers, independently of whether the sentence was safe. That bounds the
 * WIRING rather than the vocabulary. A verifier that is not wired, an outcome
 * nobody declared, a union that shrank, a text released while the second layer
 * failed - all of those are now sweep violations. None of them makes the oracle
 * able to read a sentence.
 *
 * NO IMPORTS. THAT IS THE POINT.
 * ---------------------------------------------------------------------------
 * Not even Luxon. Every quantity this module compares is an absolute value a
 * human wrote down - `2026-03-05`, `14` - against an absolute value the runner
 * measured in the contact's persisted zone. There is no arithmetic to get wrong
 * and no dependency to smuggle the gate in through.
 */

// ---------------------------------------------------------------------------
// 1. WHAT A SENTENCE CAN ASSERT
// ---------------------------------------------------------------------------

/**
 * The effect families a declaration may name.
 *
 * DELIBERATELY WRITTEN OUT A THIRD TIME. `src/agent/claimGate/lexicon` has this
 * list, `invariants.ts` has it again for the support half, and here it is once
 * more. Importing the gate's union would make `tsc` keep this file in step with
 * the module under test, which is the opposite of what an independent oracle
 * wants: if somebody deletes a family from the lexicon, this file should keep
 * asserting that the sentences of that family are still claims.
 *
 * `claimOracleBoundary.test.ts` asserts the two lists still overlap where they
 * should, as a drift alarm rather than as a coupling.
 */
export type DeclaredEffectFamily =
  | 'MEETING'
  | 'RESCHEDULE'
  | 'CANCELLATION'
  | 'CALLBACK'
  | 'MESSAGE'
  | 'RECORD'
  | 'HANDOVER'
  /** A completion with nothing named: "that's all sorted", "סידרתי לך". */
  | 'ANY';

/** What one sentence says the system has done, or has committed to do. */
export interface DeclaredAssertion {
  readonly family: DeclaredEffectFamily;
  /**
   * `COMPLETED` - it says the thing HAS happened.
   * `COMMITTED` - it says the thing WILL happen because the system arranged it.
   *
   * Both need an effect on record. A promise made in the same breath as the tool
   * that would justify it is false at the moment it is spoken, which is
   * `docs/MISSION_2D_CLAIM_GATE.md` § 9.2 and is intended behaviour.
   */
  readonly mode: 'COMPLETED' | 'COMMITTED';
  /**
   * The local day the SENTENCE names, as an absolute `yyyy-LL-dd` in the
   * contact's own zone, or `null` when it names none.
   *
   * ABSOLUTE ON PURPOSE. Writing `'Thursday'` here would need a weekday
   * resolver, and a resolver is code that can be wrong in the same direction as
   * the code under test. `dimensions.test.ts` re-derives the probe day from
   * Luxon and asserts it is this string, so the two cannot drift.
   */
  readonly localDay: string | null;
  /** The local hour the sentence names, 0-23, or `null`. `2pm` is `14`. */
  readonly localHour: number | null;
  /** The local minute the sentence names, or `null` for "on the hour". */
  readonly localMinute: number | null;
  /** Prose: why a reader of the sentence would say it asserts this. */
  readonly note: string;
}

/**
 * GROUND TRUTH FOR ONE SCRIPTED MODEL TEXT, authored beside the text.
 *
 * Every field is REQUIRED, following the § 16.9 precedent: `tsc` names the
 * missing key rather than a test noticing later, and a scripted text with no
 * declaration cannot default to "asserts nothing". Defaulting to nothing is
 * precisely the failure this oracle exists to remove - the sweep's silence about
 * a sentence must never be mistaken for the sentence being safe.
 */
export interface ClaimDeclaration {
  /**
   * The headline. `false` means a reader would say this sentence asserts no
   * effect, no promise and no reference at all.
   *
   * Cross-checked against the other three fields by
   * `claimOracleDeclarations.test.ts`, so it cannot say `false` while naming an
   * assertion.
   */
  readonly assertsMaterialEffect: boolean;
  /** What it says happened. Empty iff `assertsMaterialEffect` is false. */
  readonly assertions: readonly DeclaredAssertion[];
  /**
   * Identifier-shaped tokens the sentence reads out to the caller, LOWER-CASED.
   *
   * Independent of `assertions`: a sentence can read out a reference while
   * asserting no effect, and a contact who writes `CONF123456` down will quote
   * it back to somebody whether or not the sentence around it was hedged.
   */
  readonly identifiersReadOut: readonly string[];
  /**
   * True when the sentence ANNOUNCES that a reference exists - "your
   * confirmation number is ...", "מספר האישור שלך" - whether or not it then
   * reads a token out.
   *
   * Supported only when the system really issued an OPERATIONAL identifier. The
   * contact's own primary key does not count as a booking reference.
   */
  readonly announcesAReference: boolean;
  /** Prose the failure message quotes, so a reader sees the author's reasoning. */
  readonly why: string;
}

/** One scripted model text and the ground truth about it, as one value. */
export interface DeclaredText {
  readonly text: string;
  readonly declares: ClaimDeclaration;
}

// ---------------------------------------------------------------------------
// 2. TWO CONSTRUCTORS, SO THE COMMON CASE IS SHORT AND STILL EXPLICIT
// ---------------------------------------------------------------------------

/**
 * A sentence a reader would say asserts nothing material.
 *
 * The `why` is mandatory rather than defaulted, because "this asserts nothing"
 * is the declaration that costs the most when it is wrong: it is the one the
 * oracle uses to stay silent.
 */
export function assertsNothing(why: string): ClaimDeclaration {
  return {
    assertsMaterialEffect: false,
    assertions: [],
    identifiersReadOut: [],
    announcesAReference: false,
    why,
  };
}

/** A sentence that asserts one or more effects. */
export function assertsEffects(
  why: string,
  assertions: readonly DeclaredAssertion[],
  extra: {
    readonly identifiersReadOut?: readonly string[];
    readonly announcesAReference?: boolean;
  } = {},
): ClaimDeclaration {
  return {
    assertsMaterialEffect: true,
    assertions,
    identifiersReadOut: extra.identifiersReadOut ?? [],
    announcesAReference: extra.announcesAReference ?? false,
    why,
  };
}

/** A sentence that asserts no EFFECT but does read out or announce a reference. */
export function assertsAReference(
  why: string,
  extra: {
    readonly identifiersReadOut?: readonly string[];
    readonly announcesAReference?: boolean;
  },
): ClaimDeclaration {
  return {
    assertsMaterialEffect: true,
    assertions: [],
    identifiersReadOut: extra.identifiersReadOut ?? [],
    announcesAReference: extra.announcesAReference ?? false,
    why,
  };
}

// ---------------------------------------------------------------------------
// 3. WHAT THE SWEEP ACTUALLY OBSERVED
// ---------------------------------------------------------------------------

/**
 * The effect kinds the sweep can see for itself, by reading rows back.
 *
 * Written out here rather than imported for the reason `DeclaredEffectFamily`
 * is. These are row states and tool names, not lexicon entries.
 */
export type ObservedEffectKind =
  | 'MEETING_SCHEDULED'
  | 'MEETING_RESCHEDULED'
  | 'MEETING_CANCELLED'
  | 'CALLBACK_SCHEDULED'
  | 'QUALIFICATION_RECORDED'
  | 'CALL_OUTCOME_RECORDED'
  | 'HUMAN_HANDOVER_REQUESTED';

/** One thing that really happened, measured in the contact's persisted zone. */
export interface ObservedEffectForOracle {
  readonly kind: ObservedEffectKind | string;
  /** Human-readable, quoted in a failure message. */
  readonly describe: string;
  readonly localDay: string | null;
  readonly hour: number | null;
  readonly minute: number | null;
}

/** Everything the oracle is allowed to consult. Nothing here comes from the gate. */
export interface ObservedStateForOracle {
  readonly effects: readonly ObservedEffectForOracle[];
  /** Every identifier the system really issued, lower-cased. */
  readonly issuedIdentifiers: ReadonlySet<string>;
  /**
   * The contact's own primary key, lower-cased. It is unquestionably an issued
   * identifier, and it is unquestionably NOT a booking reference, so it is
   * excluded when judging `announcesAReference`.
   */
  readonly contactId: string;
  /** `toolName:CODE` for every refusal this turn produced. */
  readonly refusals: readonly string[];
}

/**
 * Which observed effects make a declared family TRUE.
 *
 * The same product rule as `verifier.ts` and as `invariants.ts`, written a third
 * time on purpose. Three independent copies is not duplication for its own sake:
 * if the gate's table were edited to make a failing claim pass, two others would
 * still disagree.
 *
 * `MESSAGE` maps to NOTHING, and that is the strongest entry in the table. No
 * tool in this system sends anything, so no state whatsoever can support a
 * promise to send one - which is why every `MESSAGE` spec is unsupportable by
 * construction rather than by the accident of an empty diary.
 */
const OBSERVED_KINDS_SUPPORTING: Readonly<Record<DeclaredEffectFamily, readonly string[]>> = {
  MEETING: ['MEETING_SCHEDULED', 'MEETING_RESCHEDULED'],
  RESCHEDULE: ['MEETING_RESCHEDULED', 'MEETING_SCHEDULED'],
  CANCELLATION: ['MEETING_CANCELLED'],
  CALLBACK: ['CALLBACK_SCHEDULED'],
  MESSAGE: [],
  RECORD: ['QUALIFICATION_RECORDED', 'CALL_OUTCOME_RECORDED'],
  HANDOVER: ['HUMAN_HANDOVER_REQUESTED'],
  ANY: [
    'MEETING_SCHEDULED',
    'MEETING_RESCHEDULED',
    'MEETING_CANCELLED',
    'CALLBACK_SCHEDULED',
    'QUALIFICATION_RECORDED',
    'CALL_OUTCOME_RECORDED',
    'HUMAN_HANDOVER_REQUESTED',
  ],
};

/** Exposed so a drift alarm can compare it with the gate's own table. */
export const DECLARED_FAMILY_SUPPORT_TABLE = OBSERVED_KINDS_SUPPORTING;

// ---------------------------------------------------------------------------
// 4. THE VERDICT
// ---------------------------------------------------------------------------

export type OracleFindingReason =
  | 'NO_MATCHING_EFFECT'
  | 'EFFECT_WAS_REFUSED'
  | 'NO_TOOL_FOR_PROMISE'
  | 'WRONG_DAY'
  | 'WRONG_TIME'
  | 'INVENTED_IDENTIFIER'
  | 'NO_REFERENCE_TO_GIVE';

/** One reason a declared assertion is not backed by anything observed. */
export interface OracleFinding {
  readonly reason: OracleFindingReason;
  readonly detail: string;
}

/**
 * THE ORACLE. Everything a declared sentence asserts that observed state does
 * not back.
 *
 * An empty array means the sentence was safe to say ON THIS SCENARIO'S STATE.
 * It does not mean the sentence is harmless in general, and it is deliberately
 * one-directional: this function never reports that a SUPPORTED claim was
 * blocked. Precision is a different question with a different owner, and an
 * oracle that failed in both directions would make every regeneration a sweep
 * violation.
 */
export function unbackedDeclaredClaims(
  declaration: ClaimDeclaration,
  state: ObservedStateForOracle,
): readonly OracleFinding[] {
  const out: OracleFinding[] = [];

  // ---- identifiers first ------------------------------------------------
  // An identifier read out to a contact has been read out whether the sentence
  // around it was hedged or not, so this is not conditional on any assertion.
  for (const token of declaration.identifiersReadOut) {
    if (!state.issuedIdentifiers.has(token.toLowerCase())) {
      out.push({
        reason: 'INVENTED_IDENTIFIER',
        detail:
          `the sentence reads out "${token}", which is in no tool result and no persisted row for this ` +
          `contact (the system issued ${state.issuedIdentifiers.size} identifier(s) here)`,
      });
    }
  }

  if (declaration.announcesAReference) {
    const operational = [...state.issuedIdentifiers].filter((value) => value !== state.contactId.toLowerCase());
    if (declaration.identifiersReadOut.length === 0 && operational.length === 0) {
      out.push({
        reason: 'NO_REFERENCE_TO_GIVE',
        detail:
          'the sentence announces that a reference exists and this system has issued no operational ' +
          "identifier at all (the contact's own primary key is not a booking reference)",
      });
    }
  }

  // ---- then the effects --------------------------------------------------
  for (const assertion of declaration.assertions) {
    const wanted = OBSERVED_KINDS_SUPPORTING[assertion.family];

    if (wanted.length === 0) {
      out.push({
        reason: 'NO_TOOL_FOR_PROMISE',
        detail:
          `the sentence asserts ${assertion.family} ${assertion.mode} (${assertion.note}) and no tool in ` +
          'this system can produce that effect at all, so no state could ever support it',
      });
      continue;
    }

    const candidates = state.effects.filter((effect) => wanted.includes(effect.kind));
    if (candidates.length === 0) {
      out.push({
        reason: state.refusals.length > 0 ? 'EFFECT_WAS_REFUSED' : 'NO_MATCHING_EFFECT',
        detail:
          `the sentence asserts ${assertion.family} ${assertion.mode} (${assertion.note}) and nothing ` +
          `observed is one of ${wanted.join('/')}` +
          (state.refusals.length > 0
            ? `; the turn's own refusals were ${state.refusals.join(', ')}`
            : '; the turn produced no refusal either, so nothing happened at all'),
      });
      continue;
    }

    if (assertion.localDay !== null) {
      const dayAgrees = candidates.some((effect) => effect.localDay === assertion.localDay);
      if (!dayAgrees) {
        out.push({
          reason: 'WRONG_DAY',
          detail:
            `the sentence names ${assertion.localDay} and the record says ` +
            `${candidates.map((effect) => effect.localDay ?? '(no instant)').join(' / ')} ` +
            `(${candidates.map((effect) => effect.describe).join('; ')})`,
        });
        continue;
      }
    }

    if (assertion.localHour !== null) {
      // Only effects on the right day (when one was named) may settle the hour.
      const onDay =
        assertion.localDay === null
          ? candidates
          : candidates.filter((effect) => effect.localDay === assertion.localDay);
      const timeAgrees = onDay.some(
        (effect) =>
          effect.hour === assertion.localHour &&
          (assertion.localMinute === null || (effect.minute ?? 0) === assertion.localMinute),
      );
      if (!timeAgrees) {
        out.push({
          reason: 'WRONG_TIME',
          detail:
            `the sentence names ${String(assertion.localHour).padStart(2, '0')}:` +
            `${String(assertion.localMinute ?? 0).padStart(2, '0')} and the record says ` +
            `${onDay
              .map((effect) =>
                effect.hour === null
                  ? '(no instant)'
                  : `${String(effect.hour).padStart(2, '0')}:${String(effect.minute ?? 0).padStart(2, '0')}`,
              )
              .join(' / ')} (${onDay.map((effect) => effect.describe).join('; ')})`,
        });
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 5. THE TWO WITNESSES, AND WHAT THEIR DISAGREEMENT MEANS
// ---------------------------------------------------------------------------

/**
 * How the DECLARATION and the DETECTOR compared on one released sentence.
 *
 * Keeping the detector as a witness is a requirement, not a courtesy: the
 * declaration only covers sentences somebody wrote down, and the detector covers
 * everything. What is new is that neither can silence the other, and that the
 * two disagreeing is printed rather than resolved quietly.
 *
 * `DETECTOR_BLIND` is the interesting one. It is the exact signature of all five
 * Mission 2D fail-open findings: a person reading the sentence says it asserts a
 * booking, and `detectMaterialClaims` returns an empty array.
 */
export type WitnessAgreement =
  /** Both say the sentence asserts nothing material. */
  | 'BOTH_SILENT'
  /** Both say it asserts something. */
  | 'BOTH_SAW_A_CLAIM'
  /** The declaration says it asserts something; the detector saw nothing. */
  | 'DETECTOR_BLIND'
  /** The detector saw a claim; the declaration says the sentence asserts nothing. */
  | 'DETECTOR_OVER_READ';

export function compareWitnesses(declaration: ClaimDeclaration, detectorClaimCount: number): WitnessAgreement {
  if (declaration.assertsMaterialEffect) {
    return detectorClaimCount > 0 ? 'BOTH_SAW_A_CLAIM' : 'DETECTOR_BLIND';
  }
  return detectorClaimCount > 0 ? 'DETECTOR_OVER_READ' : 'BOTH_SILENT';
}

/** One line of prose per verdict, for the QA report. */
export const WITNESS_AGREEMENT_MEANING: Readonly<Record<WitnessAgreement, string>> = {
  BOTH_SILENT: 'the declaration and the detector agree the sentence asserts nothing material',
  BOTH_SAW_A_CLAIM: 'the declaration and the detector agree the sentence asserts something',
  DETECTOR_BLIND:
    'A PERSON READING THE SENTENCE SAYS IT ASSERTS AN EFFECT AND THE DETECTOR FOUND NONE. This is the ' +
    'signature of all five Mission 2D fail-open findings. It is not by itself a leak - the sentence may ' +
    'still be true - but it means the gate would not have stopped it if it were false.',
  DETECTOR_OVER_READ:
    'the detector found a claim in a sentence declared to assert nothing. Not a leak; a candidate false ' +
    'positive, which is the failure mode that gets a gate switched off.',
};

// ---------------------------------------------------------------------------
// 6. THE LAYERED PIPELINE - MISSION 2F
// ---------------------------------------------------------------------------

/**
 * THE ORACLE'S SECOND QUESTION, AND IT IS A DIFFERENT KIND OF QUESTION.
 *
 * Everything above answers: *was this sentence safe to say, given what really
 * happened?* That is a question about an EFFECT, and the answer comes from rows.
 *
 * Mission 2F adds a second layer to the gate, and with it a second question that
 * no amount of reading rows can answer: *did this system actually run the check it
 * says it runs?* A turn can be perfectly safe and still have skipped the check -
 * and a turn that skipped the check is a turn nobody classified, which is exactly
 * the state § 21.2 reason 3 describes as "silence is not safety".
 *
 * THE RULE THIS SECTION EXISTS TO NOT BREAK, STATED FIRST BECAUSE IT IS THE WHOLE
 * DESIGN
 * ---------------------------------------------------------------------------
 * **THE ORACLE MUST NEVER TREAT THE VERIFIER'S VERDICT AS EVIDENCE OF ANYTHING.**
 * The verifier's judgement is never evidence that an effect exists, and an oracle
 * that read it would re-close the circle § 17.5 exists to break - worse than the
 * original circle, because the original one at least consulted deterministic code.
 *
 * That rule is kept STRUCTURALLY rather than by discipline, in three ways:
 *
 *  1. `unbackedDeclaredClaims` - the function that decides whether a sentence was
 *     safe - HAS NO PARAMETER FOR ANY OF THIS. Its signature is
 *     `(ClaimDeclaration, ObservedStateForOracle)` and neither type has a field
 *     the semantic layer can reach. So no semantic outcome, no confidence, no
 *     claim count and no "the verifier said it was clean" can change its answer,
 *     and that is a fact about the types rather than a promise about the code.
 *     `claimOracleBoundary.test.ts` asserts it.
 *  2. `layeredPipelineFindings` below is PURELY ADDITIVE. It returns findings; it
 *     never returns an "all clear", and nothing it returns can cancel a finding
 *     from `unbackedDeclaredClaims`. The two are unioned by the caller.
 *  3. IT READS THE PIPELINE'S REPORT OF ITSELF, NOT THE VERIFIER'S ANSWER. The
 *     difference matters and is easy to lose: `semanticOutcome: 'CLASSIFIED'` is
 *     used ONLY to establish that the layer ran, never that the text is clean. A
 *     `CLASSIFIED` verdict with an empty claim list produces exactly the same
 *     findings as one with ten claims in it, because this function does not ask
 *     what the verifier thought - only whether it answered at all.
 *
 * WHY THIS IS STILL INDEPENDENT OF THE GATE
 * ---------------------------------------------------------------------------
 * Because every value it compares is a COUNT or a TAG that the runtime reported
 * about its own behaviour, and the properties checked are arithmetic and
 * structural: a union cannot be smaller than the set it is a superset of; a tag
 * list must have one entry per claim; a text released while the second layer
 * produced nothing usable is a fail-open. None of that needs a lexicon, a family
 * table or a day parser, so this module still imports NOTHING - which is the
 * property `claimOracleBoundary.test.ts` asserts and the reason it can be trusted
 * to disagree with the gate.
 *
 * THE OUTCOME LIST IS WRITTEN OUT A SECOND TIME, ON PURPOSE
 * ---------------------------------------------------------------------------
 * `SemanticLayerOutcome` lives in `src/agent/claimGate/semantic/union.ts`. Importing
 * it would make `tsc` keep this file in step with the module under test, which is
 * the opposite of what an independent witness wants - and an outcome the gate
 * invented and this file has never heard of must be a FINDING rather than a silent
 * pass, which is only possible if the two lists can disagree. Same argument as
 * `DeclaredEffectFamily`, one layer out.
 */
export const KNOWN_SEMANTIC_LAYER_OUTCOMES: readonly string[] = [
  /** The layer answered. NOT "the text is clean" - see the header. */
  'CLASSIFIED',
  'MALFORMED',
  'TIMED_OUT',
  'UNAVAILABLE',
  'EMPTY',
  /** No verifier was wired. A declared TEST-ONLY seam, and never a pass. */
  'ABSENT',
];

/** The outcomes that mean the layer produced nothing usable. */
export const UNUSABLE_SEMANTIC_LAYER_OUTCOMES: readonly string[] = [
  'MALFORMED',
  'TIMED_OUT',
  'UNAVAILABLE',
  'EMPTY',
  'ABSENT',
];

/**
 * What the runtime reported about ONE attempt's two layers.
 *
 * Every field is a number, a boolean or a string tag. There is deliberately no
 * field carrying what the verifier THOUGHT - no claim contents, no confidence, no
 * families - because this oracle has no use for any of it and a field it could
 * read is a field a later edit could start reading.
 */
export interface LayeredAttemptFacts {
  /** 1-based, as the gate reports it. */
  readonly attempt: number;
  /** `CLASSIFIED` / a failure kind / `ABSENT`, as a STRING. See the header. */
  readonly semanticOutcome: string;
  readonly failClosed: boolean;
  readonly deterministicClaimCount: number;
  readonly semanticClaimCount: number;
  readonly unionClaimCount: number;
  /** One tag per union claim, in union order. */
  readonly sourceTags: readonly string[];
  /** Was THIS attempt's text the one the caller got? */
  readonly wasReleased: boolean;
  /** The reasons the gate recorded on this attempt. */
  readonly unsupportedReasons: readonly string[];
}

/** What the runtime reported about one release, across every attempt. */
export interface LayeredReleaseFacts {
  readonly iteration: number;
  /**
   * `true` / `false` as the per-turn report says, or `null` when the report
   * carried no `verifier` field at all.
   *
   * `null` IS ITS OWN FINDING AND IS NOT THE SAME AS `false`. The field is
   * optional on `ClaimGateTurnReport` so that older callers keep compiling, and an
   * absent field means nobody said whether a verifier was wired. Treating that as
   * "wired" would be the § 17.5 default-to-silence mistake; treating it as "not
   * wired" would blame the runtime for a report shape. So it is reported as what
   * it is: unstated, which is a finding of its own.
   */
  readonly verifierWired: boolean | null;
  readonly verifierName: string | null;
  readonly releasedText: string | null;
  readonly attempts: readonly LayeredAttemptFacts[];
}

export type LayeredFindingReason =
  /** The per-turn report says no verifier is wired. Never a pass. */
  | 'NO_VERIFIER_WIRED'
  /** The report carried no verifier field, so nobody said. */
  | 'VERIFIER_WIRING_NOT_REPORTED'
  /** An attempt reports `ABSENT`: the test-only seam reached the swept path. */
  | 'SEMANTIC_LAYER_ABSENT'
  /** An outcome this independent list has never heard of. */
  | 'UNKNOWN_SEMANTIC_OUTCOME'
  /** Text reached the caller on an attempt whose second layer produced nothing usable. */
  | 'RELEASED_WHILE_FAIL_CLOSED'
  /** `failClosed` was set and the gate recorded no reason for it. */
  | 'FAIL_CLOSED_WITHOUT_ITS_REASON'
  /** The union is smaller than the deterministic set it must be a superset of. */
  | 'UNION_SMALLER_THAN_DETERMINISTIC'
  /** One tag per union claim, or the report cannot say which layer caught what. */
  | 'SOURCE_TAGS_DO_NOT_COVER_THE_UNION'
  /** A claim in a deterministic slot tagged as the semantic layer's. */
  | 'DETERMINISTIC_CLAIM_LOST_ITS_TAG'
  /** A release with no attempts at all, so nothing was classified. */
  | 'NO_ATTEMPT_AT_ALL';

export interface LayeredFinding {
  readonly reason: LayeredFindingReason;
  readonly detail: string;
}

/**
 * EVERY WAY THIS RELEASE FAILS TO BE A LAYERED DECISION.
 *
 * An empty array means the pipeline ran both layers and reported them coherently.
 * IT DOES NOT MEAN THE SENTENCE WAS SAFE - that is `unbackedDeclaredClaims`, and
 * the caller must run both. Two questions, two functions, and the reason they are
 * separate is that conflating them is how "the check passed" and "the check ran"
 * become the same sentence in somebody's head.
 *
 * PURELY ADDITIVE, AND THE CALLER CANNOT USE IT TO CLEAR ANYTHING. There is no
 * return value meaning "and therefore the text was fine".
 */
export function layeredPipelineFindings(facts: LayeredReleaseFacts): readonly LayeredFinding[] {
  const out: LayeredFinding[] = [];

  // ---- 0. is there a second layer at all? --------------------------------
  // Treated exactly as INV-18 treats `claimGate.enabled === false`: a VIOLATION,
  // not an inapplicable case. `buildAgentRuntime` always resolves a verifier and
  // offers no configuration that removes one, so either of these means the
  // production composition root changed.
  if (facts.verifierWired === false) {
    out.push({
      reason: 'NO_VERIFIER_WIRED',
      detail:
        'the runtime released text with NO semantic claim verifier wired (claimGate.verifier.wired === ' +
        'false). buildAgentRuntime always resolves one - an explicit instance, a real LlmSemanticClaimVerifier, ' +
        'or the rule-driven double - and offers no way to remove it, so this means the production composition ' +
        'root changed. A missing second layer is the eight-QA-round defect back, and it must never read as ' +
        '"nothing to check".',
    });
  } else if (facts.verifierWired === null) {
    out.push({
      reason: 'VERIFIER_WIRING_NOT_REPORTED',
      detail:
        'the per-turn report carried no `verifier` field, so NOBODY SAID whether a second layer was wired. ' +
        'That is not the same as "it was" - defaulting an unknown to safe is the exact silence § 17.5 exists ' +
        'to remove. Either AgentTurnService stopped populating ClaimGateTurnReport.verifier, or this sweep is ' +
        'reading a report built by something that never did.',
    });
  }

  if (facts.attempts.length === 0) {
    out.push({
      reason: 'NO_ATTEMPT_AT_ALL',
      detail:
        `iteration ${facts.iteration} reports a release with ZERO attempts, so no text was ever put through ` +
        'either layer. A release nobody classified cannot be a release anybody checked.',
    });
    return out;
  }

  for (const attempt of facts.attempts) {
    const where = `iteration ${facts.iteration} attempt ${attempt.attempt}`;

    // ---- 1. did the second layer run, and did it produce something usable?
    if (!KNOWN_SEMANTIC_LAYER_OUTCOMES.includes(attempt.semanticOutcome)) {
      out.push({
        reason: 'UNKNOWN_SEMANTIC_OUTCOME',
        detail:
          `${where} reports semanticOutcome "${attempt.semanticOutcome}", which this invariant's ` +
          'independently written list does not know. A new outcome was added to the gate and the assurance ' +
          'layer was not told about it, so it cannot judge it - which is a finding, not a pass. Exactly the ' +
          "shape of INV-18's UNKNOWN_FAMILY.",
      });
    }

    if (attempt.semanticOutcome === 'ABSENT') {
      out.push({
        reason: 'SEMANTIC_LAYER_ABSENT',
        detail:
          `${where} reports the semantic layer as ABSENT. That is the declared TEST-ONLY seam ` +
          '(ClaimGateOptions.verifier: null) and it has reached a swept scenario, which means a path that ' +
          'skips the second layer is reachable through the composition root.',
      });
    }

    // ---- 2. FAIL CLOSED MEANS CLOSED -------------------------------------
    // The single most important check in this function. A text released on an
    // attempt whose second layer produced nothing usable is a fail-OPEN, whatever
    // the deterministic layer thought and whatever the ledger said.
    if (attempt.wasReleased && attempt.failClosed) {
      out.push({
        reason: 'RELEASED_WHILE_FAIL_CLOSED',
        detail:
          `${where} was RELEASED TO THE CALLER while its own layer report says failClosed with outcome ` +
          `"${attempt.semanticOutcome}". Malformed, schema-invalid, timed-out, empty and unavailable verifier ` +
          'output is UNSUPPORTED and never clean - a check that did not happen is not a check that passed. ' +
          'This is the fail-open direction and it is the one thing the second layer was added to make ' +
          'impossible.',
      });
    }

    // Consistency between the two ways the same fact is reported. A `failClosed`
    // flag with no reason beside it would let an operator see a blocked turn with
    // nothing to act on, and a reason with no flag would mean the union and the
    // report disagree.
    const unusable = UNUSABLE_SEMANTIC_LAYER_OUTCOMES.includes(attempt.semanticOutcome);
    if (unusable !== attempt.failClosed) {
      out.push({
        reason: 'FAIL_CLOSED_WITHOUT_ITS_REASON',
        detail:
          `${where} reports outcome "${attempt.semanticOutcome}" and failClosed=${String(attempt.failClosed)}. ` +
          'Those disagree: all four failure variants AND the absent seam are fail-closed, and CLASSIFIED is ' +
          'not. One of the two fields is lying about the same fact.',
      });
    }
    if (attempt.failClosed && !attempt.unsupportedReasons.includes('SEMANTIC_CHECK_UNAVAILABLE')) {
      out.push({
        reason: 'FAIL_CLOSED_WITHOUT_ITS_REASON',
        detail:
          `${where} failed closed and the gate recorded reasons [${attempt.unsupportedReasons.join(', ') ||
            'none'}] - none of them SEMANTIC_CHECK_UNAVAILABLE. An operator reading a hand-off needs to be ` +
          'able to tell a verifier outage from a model that asserted something false; those have completely ' +
          'different fixes.',
      });
    }

    // ---- 3. THE UNION IS A SUPERSET, ARITHMETICALLY ----------------------
    // The Founder's "may only ADD" rule as a number, and it needs no lexicon to
    // check - which is why an oracle that imports nothing can still check it.
    if (attempt.unionClaimCount < attempt.deterministicClaimCount) {
      out.push({
        reason: 'UNION_SMALLER_THAN_DETERMINISTIC',
        detail:
          `${where} reports ${attempt.deterministicClaimCount} deterministic claim(s) and a union of ` +
          `${attempt.unionClaimCount}. The union is a SUPERSET of the deterministic set by construction, so a ` +
          'smaller one means the semantic layer removed a claim the first layer found - which is the one ' +
          'thing it may never do.',
      });
    }

    if (attempt.sourceTags.length !== attempt.unionClaimCount) {
      out.push({
        reason: 'SOURCE_TAGS_DO_NOT_COVER_THE_UNION',
        detail:
          `${where} reports ${attempt.unionClaimCount} union claim(s) and ${attempt.sourceTags.length} source ` +
          'tag(s). One tag per claim, in union order, is what lets a report say WHICH LAYER caught which ' +
          'claim - and that field is how the whole mission is checked.',
      });
    }

    // The first `deterministicClaimCount` entries are the deterministic list, in
    // order. Every one of them must be tagged `DETERMINISTIC` or `BOTH`; a
    // `SEMANTIC` tag in that range would mean a deterministic claim had been
    // replaced rather than re-tagged.
    const misTagged = attempt.sourceTags
      .slice(0, attempt.deterministicClaimCount)
      .filter((tag) => tag !== 'DETERMINISTIC' && tag !== 'BOTH');
    if (misTagged.length > 0) {
      out.push({
        reason: 'DETERMINISTIC_CLAIM_LOST_ITS_TAG',
        detail:
          `${where}: ${misTagged.length} of the first ${attempt.deterministicClaimCount} union entries - the ` +
          `deterministic ones - are tagged [${misTagged.join(', ')}]. The only change the second layer may ` +
          'make to a deterministic claim is re-tagging it BOTH.',
      });
    }
  }

  return out;
}

/**
 * How many attempts across this release the second layer actually answered on.
 *
 * NOT A VERDICT, AND EXPORTED FOR NON-VACUITY ONLY. The sweep needs to be able to
 * say "the second layer really ran N times" so that a corpus in which it never ran
 * cannot report a clean layered invariant - the same job `BOTH_SAW_A_CLAIM > 20`
 * does for the witness comparison. It must never be read as "N attempts were
 * cleared", which is why it counts ANSWERS and not claims.
 */
export function attemptsTheSecondLayerAnswered(facts: LayeredReleaseFacts): number {
  return facts.attempts.filter((attempt) => attempt.semanticOutcome === 'CLASSIFIED').length;
}

// ---------------------------------------------------------------------------
// 7. THE DECLARATION INDEX
// ---------------------------------------------------------------------------

/**
 * The two sentences every scenario in families A-L releases.
 *
 * `NEUTRAL_SWEEP_OFFER` is what the runner scripts alongside the tool call, and
 * `NEUTRAL_SWEEP_CLOSE` is `ScriptedLlmProvider`'s own `finalText` fallback -
 * which is a scripted model text like any other and is declared like one. It is
 * reached by every turn whose script runs out, including every claim-gate
 * regeneration that consumed a spec's last entry, so leaving it undeclared would
 * leave the most frequently released sentence in the sweep unexamined.
 */
export const NEUTRAL_SWEEP_OFFER: DeclaredText = {
  text: 'Let me take care of that for you.',
  declares: assertsNothing(
    'An offer to act, in the present. It names no effect that has happened, promises no specific ' +
      'arrangement and reads out no reference. This is deliberately the wording the sweep uses everywhere: ' +
      'if it ever started asserting something, several hundred scenarios would begin measuring a different ' +
      'thing without anybody choosing that.',
  ),
};

export const NEUTRAL_SWEEP_CLOSE: DeclaredText = {
  text: 'Thanks - is there anything else I can help you with?',
  declares: assertsNothing(
    "ScriptedLlmProvider's `finalText` fallback, so it is what a turn says once its script runs out. A " +
      'question offering further help. No effect, no promise, no reference.',
  ),
};

/** Every text the sweep releases that belongs to no release spec. */
export const AMBIENT_SWEEP_TEXTS: readonly DeclaredText[] = [NEUTRAL_SWEEP_OFFER, NEUTRAL_SWEEP_CLOSE];

/**
 * Build a text -> declaration index, refusing to let one text carry two answers.
 *
 * A declaration is a property of the SENTENCE, not of the scenario it appears
 * in - `Your meeting is booked for Thursday at 2pm.` asserts a completed booking
 * on Thursday at 14:00 whether the scenario is r02 (where it is true) or r06
 * (where it is not). Whether that assertion is SUPPORTED is the oracle's job and
 * depends on state. So two specs scripting the same string must declare it the
 * same way, and a conflict is a bug in the declarations rather than something to
 * resolve by last-write-wins.
 */
export function buildDeclarationIndex(texts: readonly DeclaredText[]): Map<string, ClaimDeclaration> {
  const index = new Map<string, ClaimDeclaration>();
  for (const entry of texts) {
    const existing = index.get(entry.text);
    if (existing !== undefined && !declarationsAgree(existing, entry.declares)) {
      throw new Error(
        `Two different declarations for the same scripted text ${JSON.stringify(entry.text)}. A declaration ` +
          'is a property of the sentence, not of the scenario, so these must agree. ' +
          `One says assertsMaterialEffect=${String(existing.assertsMaterialEffect)} with ` +
          `${existing.assertions.length} assertion(s); the other says ` +
          `assertsMaterialEffect=${String(entry.declares.assertsMaterialEffect)} with ` +
          `${entry.declares.assertions.length}.`,
      );
    }
    index.set(entry.text, entry.declares);
  }
  return index;
}

/** Structural equality over everything the oracle reads. `why` is prose and is not compared. */
export function declarationsAgree(left: ClaimDeclaration, right: ClaimDeclaration): boolean {
  if (left.assertsMaterialEffect !== right.assertsMaterialEffect) return false;
  if (left.announcesAReference !== right.announcesAReference) return false;
  if (left.identifiersReadOut.join('|') !== right.identifiersReadOut.join('|')) return false;
  if (left.assertions.length !== right.assertions.length) return false;
  return left.assertions.every((assertion, index) => {
    const other = right.assertions[index];
    return (
      other !== undefined &&
      assertion.family === other.family &&
      assertion.mode === other.mode &&
      assertion.localDay === other.localDay &&
      assertion.localHour === other.localHour &&
      assertion.localMinute === other.localMinute
    );
  });
}

/**
 * Is a declaration internally consistent?
 *
 * `assertsMaterialEffect` is the headline a reader trusts, so it must not be able
 * to say `false` while the fields under it name an assertion. Returns the reasons
 * it is not, so a test can name them.
 */
export function declarationInconsistencies(declaration: ClaimDeclaration): readonly string[] {
  const out: string[] = [];
  const namesSomething =
    declaration.assertions.length > 0 ||
    declaration.identifiersReadOut.length > 0 ||
    declaration.announcesAReference;

  if (declaration.assertsMaterialEffect && !namesSomething) {
    out.push(
      'assertsMaterialEffect is true but the declaration names no assertion, no identifier and no ' +
        'reference, so the oracle has nothing to judge and the sentence would pass silently',
    );
  }
  if (!declaration.assertsMaterialEffect && namesSomething) {
    out.push(
      'assertsMaterialEffect is false while the declaration names an assertion, an identifier or a ' +
        'reference. The headline field is the one a reader trusts; it may not understate the rest.',
    );
  }
  if (declaration.why.trim().length < 20) {
    out.push(
      'the `why` is empty or near-empty. A declaration is the test data a failure message quotes, and an ' +
        'unexplained one cannot be reviewed - which is how a wrong declaration would survive.',
    );
  }
  for (const token of declaration.identifiersReadOut) {
    if (token !== token.toLowerCase()) {
      out.push(`identifier ${JSON.stringify(token)} is not lower-cased, so the issued-identifier set will miss it`);
    }
  }
  for (const assertion of declaration.assertions) {
    if (assertion.localHour !== null && (assertion.localHour < 0 || assertion.localHour > 23)) {
      out.push(`localHour ${assertion.localHour} is not an hour of the day`);
    }
    if (assertion.localDay !== null && !/^\d{4}-\d{2}-\d{2}$/.test(assertion.localDay)) {
      out.push(`localDay ${JSON.stringify(assertion.localDay)} is not an absolute yyyy-LL-dd date`);
    }
    if (assertion.localMinute !== null && assertion.localHour === null) {
      out.push('a minute was declared with no hour, which names no time at all');
    }
    if (assertion.note.trim().length < 5) {
      out.push(`assertion ${assertion.family}/${assertion.mode} carries no note`);
    }
  }
  return out;
}
