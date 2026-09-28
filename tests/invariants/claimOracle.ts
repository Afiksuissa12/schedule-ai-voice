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
 * `DETECTOR_BLIND` is the interesting one. It is the exact signature of all four
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
    'signature of all four Mission 2D fail-open findings. It is not by itself a leak - the sentence may ' +
    'still be true - but it means the gate would not have stopped it if it were false.',
  DETECTOR_OVER_READ:
    'the detector found a claim in a sentence declared to assert nothing. Not a leak; a candidate false ' +
    'positive, which is the failure mode that gets a gate switched off.',
};

// ---------------------------------------------------------------------------
// 6. THE DECLARATION INDEX
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
