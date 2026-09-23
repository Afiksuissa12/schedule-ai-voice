/**
 * The qualification rubric, and the decision-maker hard cap.
 *
 * WHAT THIS REPLACES
 * ---------------------------------------------------------------------------
 * The legacy prototype scored leads with a rubric that included a hard rule:
 * a contact who is not the decision maker cannot be scored above a ceiling,
 * however good the conversation sounded. That folder is not reachable from this
 * execution environment, so the rubric below is re-expressed for this
 * architecture from the mission brief's description of it rather than copied.
 * The one rule the brief names explicitly - the decision-maker hard cap - is
 * implemented here exactly, and tested on both sides.
 *
 * THE POINT OF THE CAP
 * ---------------------------------------------------------------------------
 * Enthusiasm from someone who cannot sign is the most expensive false signal in
 * outbound sales. A model in a friendly conversation will reliably over-score
 * it, because the conversation really was good. So the cap is not advice to the
 * model, and it is not a prompt clause: it is arithmetic in application code,
 * applied to a value read from the persisted `Contact` row.
 *
 * WHO DECIDES WHAT
 * ---------------------------------------------------------------------------
 *  - The MODEL supplies evidence: which factors it observed, how strongly, and
 *    the words the contact used. That is genuinely what it is good at.
 *  - APPLICATION CODE computes `rawScore` from the weights below, applies the
 *    cap to produce `cappedScore`, derives the band, and persists both numbers
 *    separately so the cap is visible rather than implied.
 *  - A score the model proposes directly is ADVISORY. It is recorded in the
 *    factors document so a reader can see what the model thought, and it is
 *    used as `rawScore` only when no factors were supplied at all - and even
 *    then the cap still applies. There is no argument the model can send that
 *    lifts the ceiling.
 */
import { z } from 'zod';

import type { QualificationBand } from '../../domain/enums.js';

/** Bumped whenever a weight, a factor, or the cap changes. Persisted per row. */
export const QUALIFICATION_RUBRIC_VERSION = 'schedule-ai-voice-rubric@v1';

/**
 * THE DOCUMENTED CEILING.
 *
 * A contact who is not the decision maker cannot be persisted above this,
 * whatever the rubric or the model produced. 60 sits at the bottom of the
 * MEDIUM band on purpose: the lead stays worth working, and stays out of the
 * HIGH bucket that triggers escalation and forecast weight.
 */
export const NON_DECISION_MAKER_SCORE_CEILING = 60;

/** One scoring dimension. Weights sum to 100. */
export interface RubricFactor {
  readonly name: string;
  readonly weight: number;
  readonly description: string;
}

export const RUBRIC_FACTORS = [
  {
    name: 'need_established',
    weight: 25,
    description:
      'They described a concrete problem this product addresses, in their own words - not a polite ' +
      '"sounds useful".',
  },
  {
    name: 'budget_signal',
    weight: 25,
    description:
      'They indicated money exists for this: a figure, an existing spend they would redirect, or an ' +
      'approved budget line.',
  },
  {
    name: 'timeline_urgency',
    weight: 20,
    description:
      'They named a date, a deadline, a renewal, or an event that makes this time-bound rather than ' +
      'someday.',
  },
  {
    name: 'authority_signal',
    weight: 15,
    description:
      'Evidence about who actually signs: that it is them, or who it is and that they can bring them in. ' +
      'Scoring this high does NOT lift the decision-maker cap - only the persisted Contact record does.',
  },
  {
    name: 'engagement',
    weight: 15,
    description:
      'They stayed in the conversation, asked real questions, and agreed to a next step - as opposed to ' +
      'being politely eager to hang up.',
  },
] as const satisfies readonly RubricFactor[];

export type RubricFactorName = (typeof RUBRIC_FACTORS)[number]['name'];

export const RUBRIC_FACTOR_NAMES = RUBRIC_FACTORS.map((factor) => factor.name) as [
  RubricFactorName,
  ...RubricFactorName[],
];

const TOTAL_WEIGHT = RUBRIC_FACTORS.reduce((sum, factor) => sum + factor.weight, 0);

/** Band thresholds, applied to the CAPPED score. */
export const BAND_THRESHOLDS = [
  { min: 80, band: 'HIGH' },
  { min: 60, band: 'MEDIUM' },
  { min: 35, band: 'LOW' },
  { min: 0, band: 'UNQUALIFIED' },
] as const satisfies readonly { min: number; band: QualificationBand }[];

/**
 * One observation the model supplied. `value` is 0-100 within that factor.
 *
 * `.strict()` for the same reason the tool schemas are strict: an invented key
 * such as `weight_override` must be refused, not silently dropped.
 */
export const RubricObservationSchema = z
  .object({
    factor: z.enum(RUBRIC_FACTOR_NAMES).describe('Which rubric dimension this observation scores.'),
    value: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe('How strongly this dimension was evidenced, 0 (no evidence) to 100 (unambiguous).'),
    evidence: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe('What the contact actually said that justifies this. Their words, not your summary of them.'),
  })
  .strict();

export type RubricObservation = z.infer<typeof RubricObservationSchema>;

/** One scored factor, as persisted in `QualificationState.factorsJson`. */
export interface ScoredFactor {
  readonly name: string;
  readonly weight: number;
  readonly value: number;
  /** `weight * value / 100`, rounded to two places. What it added to rawScore. */
  readonly contribution: number;
  readonly evidence: string | null;
  /** True when the model said nothing about this factor, so it scored zero. */
  readonly unobserved: boolean;
}

/** The complete, persisted explanation of a qualification decision. */
export interface QualificationScoring {
  readonly rubricVersion: string;
  readonly rawScore: number;
  readonly cappedScore: number;
  /** The effective score. Equal to `cappedScore` - named separately because the column is. */
  readonly score: number;
  readonly band: QualificationBand;
  /** From the PERSISTED Contact row, never from the model's assertion. */
  readonly isDecisionMaker: boolean;
  readonly capApplied: boolean;
  readonly capCeiling: number;
  readonly factors: readonly ScoredFactor[];
  /** What the model suggested as a total, recorded whether or not it was used. */
  readonly modelProposedScore: number | null;
  /** True when `rawScore` came from `modelProposedScore` for want of factors. */
  readonly usedModelProposedScore: boolean;
  readonly notes: string | null;
}

export interface ScoreQualificationInput {
  readonly observations?: readonly RubricObservation[];
  readonly modelProposedScore?: number | null;
  /**
   * THE ONLY INPUT THAT CONTROLS THE CAP, and it must come from
   * `Contact.isDecisionMaker` as persisted. The handler reads the row; it does
   * not accept the model's word for this.
   */
  readonly isDecisionMaker: boolean;
  readonly notes?: string | null;
}

/**
 * Score a qualification. Pure: no clock, no database, no I/O.
 *
 * Deterministic for identical input, which is what makes a persisted
 * `factorsJson` a re-computable explanation rather than a snapshot of a mood.
 */
export function scoreQualification(input: ScoreQualificationInput): QualificationScoring {
  const byFactor = new Map<string, RubricObservation>();
  for (const observation of input.observations ?? []) {
    // Last write wins, and it is recorded: a model that scores the same factor
    // twice has told us something, and silently averaging would hide it.
    byFactor.set(observation.factor, observation);
  }

  const factors: ScoredFactor[] = RUBRIC_FACTORS.map((factor) => {
    const observed = byFactor.get(factor.name);
    const value = observed?.value ?? 0;
    return {
      name: factor.name,
      weight: factor.weight,
      value,
      contribution: round2((factor.weight * value) / 100),
      evidence: observed?.evidence ?? null,
      unobserved: observed === undefined,
    };
  });

  const proposed = normalizeProposedScore(input.modelProposedScore);
  const hasObservations = byFactor.size > 0;

  // No observations at all: fall back to the model's total so that a turn which
  // scores holistically is still recorded - clamped, labelled, and still
  // subject to the cap. A model cannot reach a higher number this way than it
  // could through the rubric.
  const usedModelProposedScore = !hasObservations && proposed !== null;
  const rawScore = usedModelProposedScore
    ? (proposed as number)
    : clamp(Math.round(factors.reduce((sum, factor) => sum + factor.contribution, 0) * (100 / TOTAL_WEIGHT)));

  const capApplied = !input.isDecisionMaker && rawScore > NON_DECISION_MAKER_SCORE_CEILING;
  const cappedScore = input.isDecisionMaker ? rawScore : Math.min(rawScore, NON_DECISION_MAKER_SCORE_CEILING);

  return {
    rubricVersion: QUALIFICATION_RUBRIC_VERSION,
    rawScore,
    cappedScore,
    score: cappedScore,
    band: bandFor(cappedScore),
    isDecisionMaker: input.isDecisionMaker,
    capApplied,
    capCeiling: NON_DECISION_MAKER_SCORE_CEILING,
    factors,
    modelProposedScore: proposed,
    usedModelProposedScore,
    notes: input.notes ?? null,
  };
}

/** The band for an already-capped score. */
export function bandFor(score: number): QualificationBand {
  for (const threshold of BAND_THRESHOLDS) {
    if (score >= threshold.min) return threshold.band;
  }
  return 'UNQUALIFIED';
}

/** One line explaining the outcome, for an audit summary and for the model. */
export function explainScoring(scoring: QualificationScoring): string {
  const basis = scoring.usedModelProposedScore
    ? 'from the proposed total (no factor evidence was supplied)'
    : `from ${scoring.factors.filter((f) => !f.unobserved).length}/${scoring.factors.length} observed factors`;

  if (!scoring.capApplied) {
    return `Scored ${scoring.score}/100 (${scoring.band}) ${basis}.`;
  }
  return (
    `Scored ${scoring.rawScore}/100 ${basis}, then CAPPED to ${scoring.cappedScore} (${scoring.band}) ` +
    `because the contact is not recorded as the decision maker (ceiling ${scoring.capCeiling}).`
  );
}

// ---------------------------------------------------------------------------

function normalizeProposedScore(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return clamp(Math.round(value));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
