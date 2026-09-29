/**
 * The shapes the harness writes to disk.
 *
 * These types are the CONTRACT with the Founder Review task, which consumes
 * this harness's output as raw evidence. Everything here is plain JSON: no
 * class instances, no `Date` objects, no `undefined`-only fields that vanish
 * through `JSON.stringify`. A results file has to be readable by something that
 * never imported this repository.
 *
 * `null` means "not measured" throughout, matching the provider's metrics
 * contract. It never means zero.
 */
import type { LlmTurnMetrics } from '../ports/llm.js';
import type { CoverageKey, ScenarioLanguage } from './corpus/schema.js';
import type { JudgeResult } from './rubric/judge.js';
import type { TurnLatencyBreakdown } from './runner/metricsCapturingProvider.js';

/** One proposed tool call, exactly as the model produced it. */
export interface RecordedToolCall {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argumentsJson: string;
}

/** What the REAL dispatcher did with it. */
export interface RecordedToolOutcome {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly ok: boolean;
  readonly summary: string | null;
  readonly code: string | null;
  readonly reason: string | null;
  readonly persisted: { readonly type: string; readonly id: string } | null;
  /**
   * The instant the REAL resolver committed to, as `yyyy-MM-ddTHH:mm` local
   * wall-clock plus its zone. Lifted out of the tool's own `start_local` /
   * `timezone` payload so the results file records WHICH MOMENT was booked and
   * not only that something was.
   *
   * Null on a refusal, and on the tools that carry no time. Present because a
   * booking on the wrong calendar day is otherwise invisible in this file - see
   * `checks.resolvedDay`.
   */
  readonly resolvedStartLocal: string | null;
  readonly resolvedTimezone: string | null;
}

/** Per-turn programmatic verdicts. Every field is reproducible. */
export interface TurnChecks {
  readonly fabricatedTimestamps: ReadonlyArray<{
    readonly pattern: string;
    readonly matched: string;
    readonly toolName: string;
    readonly field: string;
  }>;
  readonly toolSelection: {
    readonly applicable: boolean;
    readonly passed: boolean;
    readonly failures: readonly string[];
    readonly assertionsChecked: number;
    readonly assertionsPassed: number;
  };
  readonly unnecessaryCalls: readonly string[];
  readonly toolCalls: ReadonlyArray<{
    readonly toolName: string;
    readonly known: boolean;
    readonly jsonParsed: boolean;
    readonly schemaValid: boolean;
    readonly schemaErrors: readonly string[];
    readonly hallucinatedContactId: boolean;
    readonly hallucinatedMeetingId: boolean;
  }>;
  readonly passthrough: { readonly applicable: boolean; readonly passed: boolean; readonly detail: string };
  /**
   * Did the resolved instant land on the calendar day the contact named?
   *
   * Optional on the type because results files written before harness 1.1.0 do
   * not carry it, and an older file must still be readable rather than
   * exploding. Absent is treated as "not applicable", never as "passed".
   */
  readonly resolvedDay?: {
    readonly applicable: boolean;
    readonly passed: boolean;
    readonly expectedLocalDate: string | null;
    readonly observedLocalDates: readonly string[];
    readonly detail: string;
  };
  /**
   * Unsupported material claims, as TWO independent counts.
   *
   * `attempts` is a property of the MODEL and is expected to be non-zero.
   * `leaks` is a property of the SYSTEM and MUST be empty. Both are computed by
   * this harness's own detector against this harness's own ledger of real
   * dispatcher outcomes - never read from the claim gate's self-report - so the
   * measure cannot be satisfied by a gate that misreports itself.
   *
   * Optional on the type for the same reason `resolvedDay` is: results files
   * written before harness 1.2.0 do not carry it, and an older file must stay
   * readable rather than exploding. Absent means the check never ran, which is
   * "not applicable" - never "passed" and never "zero leaks".
   */
  readonly unsupportedClaims?: {
    /**
     * Was a well-formed claim-gate report present, making `attempts` an
     * INDEPENDENT observation rather than a second reading of `leaks`?
     *
     * False does not mean there were no attempts. It means the model's raw
     * wording and the released text are the same string, because nothing stood
     * between them.
     */
    readonly attemptsIndependentlyObserved: boolean;
    /** Pre-release attempt texts the detector was run over. */
    readonly attemptTextsInspected: number;
    readonly attempts: ReadonlyArray<{
      readonly kind: string;
      readonly matched: string;
      readonly detail: string;
    }>;
    /** MUST be empty. Anything here reached the contact. */
    readonly leaks: ReadonlyArray<{
      readonly kind: string;
      readonly matched: string;
      readonly detail: string;
    }>;
    /** What the real dispatcher had actually succeeded at when the text went out. */
    readonly ledgerSucceededTools: readonly string[];
    /** Set when a claim-gate report was present but the wrong shape. */
    readonly reportMalformedReason: string | null;
  };
  /**
   * MISSION 2F. WHICH LAYER CAUGHT WHAT, and it is a different KIND of number
   * from `unsupportedClaims` above.
   *
   * `unsupportedClaims.attempts` and `unsupportedClaims.leaks` are computed by
   * this harness's OWN detector against this harness's OWN ledger, and never read
   * from the gate. This field IS read from the gate's per-attempt report, because
   * nothing outside `ClaimGate.review` observes which layer found a claim - by
   * the time an `AgentTurnResult` exists the union is a list with no memory of who
   * found what. The full argument for why that is acceptable here and would not be
   * for the leak number is in `src/eval/runner/claimGateReport.ts`.
   *
   * Optional for the same reason the two above it are: a results file written
   * before harness 1.3.0 does not carry it, and `observed: false` inside it means
   * the gate on that tree predated Mission 2F. Absent is NOT CHECKED - never zero,
   * and never a pass.
   */
  readonly claimLayers?: {
    readonly observed: boolean;
    readonly attemptsWithLayerReport: number;
    readonly deterministicClaims: number;
    /** **The headline of this field.** Claims ONLY the semantic verifier saw. */
    readonly semanticOnlyClaims: number;
    readonly bothLayersClaims: number;
    readonly unionClaims: number;
    /** `null` means the report did not say, which is not the same as `false`. */
    readonly verifierWired: boolean | null;
    readonly verifierName: string | null;
    readonly semanticOutcomes: Readonly<Record<string, number>>;
    readonly failClosedAttempts: number;
  };
  readonly text: {
    readonly applicable: boolean;
    readonly passed: boolean;
    readonly failures: readonly string[];
    readonly lengthChars: number;
    readonly lengthWords: number;
    readonly lengthScore: number | null;
    readonly concreteDatesAsserted: readonly string[];
  };
  readonly repetition: { readonly maxSimilarity: number; readonly verbatimRepeat: boolean; readonly score: number };
  readonly language: {
    readonly expected: ScenarioLanguage;
    readonly hebrewLetterRatio: number;
    readonly matched: boolean;
    readonly detail: string;
  };
  readonly schedulingIntent: { readonly applicable: boolean; readonly recognised: boolean; readonly detail: string };
  readonly toolFailure: {
    readonly expected: boolean;
    readonly occurred: boolean;
    /** Codes the real dispatcher returned, so a reader can see it was genuine. */
    readonly codes: readonly string[];
  };
}

export interface TurnRecord {
  readonly index: number;
  readonly utterance: string;
  readonly note: string;
  /** Everything the agent said this turn, in order. */
  readonly assistantMessages: readonly string[];
  /** The last thing it said - what would be spoken aloud. */
  readonly assistantText: string | null;
  readonly toolCalls: readonly RecordedToolCall[];
  readonly toolOutcomes: readonly RecordedToolOutcome[];
  readonly iterations: number;
  readonly stopReason: string;
  /** Provider telemetry for the LAST provider call of this turn. */
  readonly metrics: LlmTurnMetrics | null;
  /** Wall clock around the whole turn, as the runner measured it. */
  readonly turnLatencyMs: number;
  readonly providerCalls: number;
  /**
   * MISSION 2F. VERIFIER latency, TOTAL TURN latency, and the IMPACT ON TIME TO
   * USER RESPONSE - gate plus verifier overhead versus generation alone.
   *
   * Optional because a results file written before harness 1.3.0 does not carry
   * it. Every field inside it that the runner could not observe is `null` rather
   * than a plausible zero: a turn with no verifier call has an UNMEASURED verifier
   * cost, not a free one. `src/ports/llm.ts` states the rule this follows.
   *
   * `src/eval/runner/metricsCapturingProvider.ts` has the derivation and, more
   * importantly, what `overheadMs` does and does not contain.
   */
  readonly latency?: TurnLatencyBreakdown;
  readonly checks: TurnChecks;
  /** Set when the turn threw. The scenario continues to be recorded. */
  readonly error: string | null;
}

export type ScenarioStatus = 'OK' | 'PARTIAL' | 'ERROR';

export interface ScenarioRun {
  readonly harnessVersion: string;
  readonly corpusVersion: string;
  readonly rubricVersion: string;
  readonly judgePromptVersion: string;

  readonly modelId: string;
  readonly providerName: string;
  /**
   * Which context layer produced this run.
   *
   * `assembled` is the production path: the CONTEXT task's
   * `ConversationContextAssembler` plus the `sales-scheduler-local@v2` prompt.
   * `baseline-v1` is the Baseline V1 path with no assembled background. Runs
   * from the two are NOT comparable and the report must never mix them.
   */
  readonly contextMode: 'baseline-v1' | 'assembled';
  readonly systemPromptRef: string | null;
  readonly scenarioId: string;
  readonly title: string;
  readonly objective: string;
  readonly language: ScenarioLanguage;
  readonly coverage: readonly CoverageKey[];

  readonly status: ScenarioStatus;
  /** Present when the scenario could not be completed. */
  readonly error: string | null;

  readonly contactId: string;
  readonly conversationId: string;
  readonly nowUtc: string;
  readonly priorConversation: ReadonlyArray<{ readonly role: string; readonly text: string }>;

  readonly turns: readonly TurnRecord[];

  /** Keyed by judge model id. A failure is recorded, not omitted. */
  readonly judges: Record<string, JudgeResult>;

  readonly startedAtIso: string;
  readonly durationMs: number;
  /** Cumulative tool-call health from the provider at the end of the scenario. */
  readonly providerStats: {
    readonly turns: number;
    readonly nativeToolCalls: number;
    readonly recoveredToolCalls: number;
    readonly malformedToolCalls: number;
    readonly malformedRate: number | null;
  } | null;
}

/** What `/api/show` and `/api/ps` said about a model. */
export interface ModelInventoryEntry {
  readonly tag: string;
  readonly present: boolean;
  readonly parameterSize: string | null;
  readonly quantizationLevel: string | null;
  readonly family: string | null;
  readonly contextLength: number | null;
  readonly diskSizeBytes: number | null;
  readonly capabilities: readonly string[];
  /** Resident size from `/api/ps` while loaded. Null if never observed. */
  readonly vramBytes: number | null;
  readonly vramContextLength: number | null;
  /** Why this model is in the candidate set, or why it was rejected. */
  readonly rationale: string;
  readonly withinVramBudget: boolean | null;
  /**
   * ADDITIVE, MISSION 2D-R. Present only for a tag the OPERATOR created on the
   * host from a Modelfile in this repository, rather than pulled from the Ollama
   * registry. Omitted entirely for a registry model, so every `models.json`
   * written before this - including the committed evidence - stays byte-valid
   * against this type.
   *
   * It is recorded because a benchmark row for a locally-created model is a
   * different kind of claim from a row for a published one: the published tag is
   * reproducible by anyone with `ollama pull`, and this one is reproducible only
   * from the committed Modelfile named here.
   */
  readonly localOrigin?: {
    readonly modelfile: string;
    readonly baseTag: string;
    readonly deviation: string;
  };
}
