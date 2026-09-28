/**
 * Rendering an audit chain so a human can read it.
 *
 * THE ACCEPTANCE CRITERION THIS SERVES
 * ---------------------------------------------------------------------------
 * The mission's test of the audit trail is a sentence: the events for one
 * `correlationId` must be sufficient to explain WHY the system scheduled, or
 * planned to contact, this person at that time. "Sufficient" means a person can
 * read it and understand it - so there has to be something that prints it, and
 * this is that something.
 *
 * `npm run slice:demo` ends by printing exactly this. It is how a human
 * verifies the mission without reading a single test.
 *
 * THE FIVE QUESTIONS
 * ---------------------------------------------------------------------------
 * `summarizeChain` pulls out the five things the brief says the chain must
 * answer - what was said, what was decided, what tool was called, what was
 * validated, what was persisted - so the demo can show them side by side with
 * the raw sequence, and so a test can assert that each one is answerable.
 */
import type { AuditEvent } from '../audit/types.js';
import { tryParseJson } from '../shared/json.js';

export interface ChainSummary {
  readonly correlationId: string;
  readonly eventCount: number;
  readonly types: readonly string[];
  /** What the contact said. */
  readonly whatWasSaid: readonly string[];
  /** What the model decided to do, before any of it was allowed. */
  readonly whatWasDecided: readonly string[];
  /** Which tools were requested, with their raw arguments. */
  readonly whatToolsWereCalled: readonly { tool: string; rawArgumentsJson: string }[];
  /** Which deterministic checks ran, and their verdicts. */
  readonly whatWasValidated: readonly { tool: string | null; checks: readonly string[]; nowUtc: string | null }[];
  /** Which rows were written. */
  readonly whatWasPersisted: readonly { subjectType: string; subjectId: string; summary: string }[];
  /** Which actions were refused, and why. */
  readonly whatWasRefused: readonly { tool: string | null; code: string; reason: string }[];
  /**
   * What the claim gate decided about the words themselves - the SIXTH question,
   * added by Mission 2D.
   *
   * The five original questions all answer "what did the system DO". This one
   * answers "what was the system allowed to SAY", which is a different axis and
   * the one § 6.5.4's defect lives on. A reader looking at a turn that produced
   * no text has to be able to find out why from the chain alone.
   */
  readonly whatWasSayable: readonly ClaimGateChainEntry[];
  /**
   * WHICH LAYER caught each claim - the SEVENTH question, added by Mission 2F.
   *
   * WHY IT IS A SEVENTH QUESTION RATHER THAN MORE ENTRIES ON THE SIXTH. The sixth
   * answers *what was the system allowed to say*, and that is a verdict per
   * attempt. This answers *who noticed*, and it is the question eight successive
   * independent QA rounds needed and could not ask: every one of those findings was
   * a sentence the deterministic detector did not recognise, and nothing on the
   * chain could distinguish "no claim in this text" from "no claim THAT LAYER could
   * see". A claim tagged `SEMANTIC` here is a claim that would have leaked before.
   *
   * It is a SEPARATE field, and deliberately not folded into `whatWasSayable`,
   * because that array's contents are asserted exactly by
   * `tests/e2e/claimGate.test.ts` and `tests/e2e/claimGateExhaustion.test.ts` -
   * adding entries to it would have changed a published answer rather than added
   * one.
   */
  readonly whichLayerCaughtIt: readonly ClaimLayerChainEntry[];
}

/** One attempt's layering, read off a `CLAIM_GATE_CLAIM_LAYERED` event. */
export interface ClaimLayerChainEntry {
  readonly attempt: number | null;
  /** How many claims the deterministic lexicon detector found. */
  readonly deterministic: number | null;
  /** What the semantic layer did: a verdict kind, or `ABSENT` when none was wired. */
  readonly semanticOutcome: string | null;
  /** How many semantic claims CONTRIBUTED to the union. */
  readonly semantic: number | null;
  /**
   * `true` when the semantic layer produced nothing usable, so the attempt is
   * UNSUPPORTED whatever else was found. An `ABSENT` verifier counts.
   */
  readonly failClosed: boolean;
  /** One tag per claim, in union order: `DETERMINISTIC`, `SEMANTIC` or `BOTH`. */
  readonly sources: readonly string[];
  readonly summary: string;
}

export interface ClaimGateChainEntry {
  readonly decision: 'VERIFIED' | 'REJECTED' | 'REGENERATION_REQUESTED' | 'WITHHELD';
  /** Which turn-loop iteration the text came from. */
  readonly iteration: number | null;
  /** Which attempt at saying it. */
  readonly attempt: number | null;
  readonly outcome: string | null;
  /** Reason codes, one per unsupported claim. Empty on a verified release. */
  readonly reasons: readonly string[];
  readonly summary: string;
}

export function summarizeChain(events: readonly AuditEvent[]): ChainSummary {
  const detailOf = (event: AuditEvent): Record<string, unknown> => {
    const parsed = tryParseJson<unknown>(event.detailJson);
    return parsed.ok && parsed.value !== null && typeof parsed.value === 'object'
      ? (parsed.value as Record<string, unknown>)
      : {};
  };

  const whatWasSaid: string[] = [];
  const whatWasDecided: string[] = [];
  const whatToolsWereCalled: { tool: string; rawArgumentsJson: string }[] = [];
  const whatWasValidated: { tool: string | null; checks: string[]; nowUtc: string | null }[] = [];
  const whatWasPersisted: { subjectType: string; subjectId: string; summary: string }[] = [];
  const whatWasRefused: { tool: string | null; code: string; reason: string }[] = [];
  const whatWasSayable: ClaimGateChainEntry[] = [];
  const whichLayerCaughtIt: ClaimLayerChainEntry[] = [];

  const readClaimGate = (
    event: AuditEvent,
    detail: Record<string, unknown>,
    decision: ClaimGateChainEntry['decision'],
  ): ClaimGateChainEntry => {
    const claims = Array.isArray(detail['unsupportedClaims'])
      ? (detail['unsupportedClaims'] as Record<string, unknown>[])
      : [];
    return {
      decision,
      iteration: typeof detail['iteration'] === 'number' ? detail['iteration'] : null,
      attempt:
        typeof detail['attempt'] === 'number'
          ? detail['attempt']
          : typeof detail['regeneration'] === 'number'
            ? detail['regeneration']
            : null,
      outcome: typeof detail['outcome'] === 'string' ? detail['outcome'] : null,
      reasons: claims.map((claim) => String(claim['reason'] ?? 'UNKNOWN')),
      summary: event.summary,
    };
  };

  for (const event of events) {
    const detail = detailOf(event);

    switch (event.type) {
      case 'UTTERANCE_RECEIVED':
        whatWasSaid.push(String(detail['text'] ?? event.summary));
        break;

      case 'AGENT_DECISION':
        whatWasDecided.push(event.summary);
        break;

      case 'TOOL_CALL_REQUESTED':
        whatToolsWereCalled.push({
          tool: String(detail['toolName'] ?? 'unknown'),
          rawArgumentsJson: String(detail['rawArgumentsJson'] ?? ''),
        });
        break;

      case 'TOOL_CALL_VALIDATED': {
        const provenance = detail['provenance'] as { checks?: { name: string; passed: boolean }[]; nowUtc?: string } | undefined;
        whatWasValidated.push({
          tool: (detail['toolName'] as string | undefined) ?? null,
          checks: (provenance?.checks ?? []).map((check) => `${check.name}: ${check.passed ? 'pass' : 'FAIL'}`),
          nowUtc: provenance?.nowUtc ?? null,
        });
        break;
      }

      case 'ENTITY_PERSISTED':
      case 'FUTURE_ACTION_SCHEDULED':
        whatWasPersisted.push({
          subjectType: event.subjectType ?? 'UNKNOWN',
          subjectId: event.subjectId ?? 'UNKNOWN',
          summary: event.summary,
        });
        break;

      case 'TOOL_CALL_REJECTED':
      case 'VALIDATION_REJECTED':
        whatWasRefused.push({
          tool: (detail['toolName'] as string | undefined) ?? null,
          code: String(detail['code'] ?? 'UNKNOWN'),
          reason: String(detail['reason'] ?? event.summary),
        });
        break;

      case 'CLAIM_GATE_CLAIM_VERIFIED':
        whatWasSayable.push(readClaimGate(event, detail, 'VERIFIED'));
        break;

      case 'CLAIM_GATE_CLAIM_REJECTED':
        whatWasSayable.push(readClaimGate(event, detail, 'REJECTED'));
        break;

      case 'CLAIM_GATE_REGENERATION_REQUESTED':
        whatWasSayable.push(readClaimGate(event, detail, 'REGENERATION_REQUESTED'));
        break;

      case 'CLAIM_GATE_TEXT_WITHHELD':
        whatWasSayable.push(readClaimGate(event, detail, 'WITHHELD'));
        break;

      case 'CLAIM_GATE_CLAIM_LAYERED':
        whichLayerCaughtIt.push(readClaimLayers(event, detail));
        break;

      // The remaining Mission 2F events - SEMANTIC_REQUESTED, SEMANTIC_CLASSIFIED
      // and SEMANTIC_FAILED - are deliberately NOT summarised into a question. They
      // are the trace of ONE layer's call, and what a reader needs from them is
      // already answered twice over: the LAYERED event above says what the layer
      // contributed, and `whatWasSayable` says what the gate then decided. Folding
      // three more events into either would make a chain harder to read rather than
      // easier. `renderChain` prints them verbatim, in order, like everything else.
      default:
        break;
    }
  }

  return {
    correlationId: events[0]?.correlationId ?? '',
    eventCount: events.length,
    types: events.map((event) => event.type),
    whatWasSaid,
    whatWasDecided,
    whatToolsWereCalled,
    whatWasValidated,
    whatWasPersisted,
    whatWasRefused,
    whatWasSayable,
    whichLayerCaughtIt,
  };
}

/** One `CLAIM_GATE_CLAIM_LAYERED` detail, flattened. Tolerant, like every reader here. */
function readClaimLayers(event: AuditEvent, detail: Record<string, unknown>): ClaimLayerChainEntry {
  const layers = (detail['layers'] ?? {}) as Record<string, unknown>;
  const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);
  return {
    attempt: asNumber(detail['attempt']),
    deterministic: asNumber(layers['deterministicClaimCount']),
    semanticOutcome: typeof layers['semanticOutcome'] === 'string' ? layers['semanticOutcome'] : null,
    semantic: asNumber(layers['semanticClaimCount']),
    failClosed: layers['failClosed'] === true,
    sources: Array.isArray(layers['sources']) ? (layers['sources'] as unknown[]).map(String) : [],
    summary: event.summary,
  };
}

/** The chain as an ordered, readable block of text. */
export function renderChain(events: readonly AuditEvent[]): string {
  const lines: string[] = [];
  for (const event of events) {
    lines.push(`  ${String(event.sequence).padStart(2, ' ')}. ${event.type.padEnd(24, ' ')} ${event.summary}`);
    if (event.subjectType && event.subjectId) {
      lines.push(`      ${'↳'} ${event.subjectType} ${event.subjectId}`);
    }
  }
  return lines.join('\n');
}

/** The five original questions, plus the sixth and the seventh, answered. */
export function renderChainAnswers(summary: ChainSummary): string {
  const section = (title: string, entries: readonly string[]): string =>
    [`  ${title}`, ...(entries.length > 0 ? entries.map((entry) => `    - ${entry}`) : ['    - (none)'])].join('\n');

  return [
    section('WHAT WAS SAID', summary.whatWasSaid),
    section('WHAT THE AGENT DECIDED', summary.whatWasDecided),
    section(
      'WHAT TOOL WAS CALLED',
      summary.whatToolsWereCalled.map((call) => `${call.tool} ${call.rawArgumentsJson}`),
    ),
    section(
      'WHAT WAS VALIDATED',
      summary.whatWasValidated.flatMap((entry) => [
        `${entry.tool ?? 'n/a'} against now=${entry.nowUtc ?? 'n/a'}`,
        ...entry.checks.map((check) => `  ${check}`),
      ]),
    ),
    section(
      'WHAT WAS PERSISTED',
      summary.whatWasPersisted.map((row) => `${row.subjectType} ${row.subjectId} - ${row.summary}`),
    ),
    section(
      'WHAT WAS REFUSED',
      summary.whatWasRefused.map((entry) => `${entry.tool ?? 'n/a'}: ${entry.code} - ${entry.reason}`),
    ),
    section(
      'WHAT THE AGENT WAS ALLOWED TO SAY',
      summary.whatWasSayable.map(
        (entry) =>
          `${entry.decision} (iteration ${entry.iteration ?? 'n/a'}, attempt ${entry.attempt ?? 'n/a'})` +
          `${entry.outcome ? ` -> ${entry.outcome}` : ''}` +
          `${entry.reasons.length > 0 ? `: ${entry.reasons.join(', ')}` : ''}`,
      ),
    ),
    section(
      'WHICH LAYER CAUGHT IT',
      summary.whichLayerCaughtIt.map(
        (entry) =>
          `attempt ${entry.attempt ?? 'n/a'}: deterministic ${entry.deterministic ?? 'n/a'}, ` +
          `semantic ${entry.semantic ?? 'n/a'} (${entry.semanticOutcome ?? 'n/a'})` +
          `${entry.failClosed ? ' FAIL-CLOSED' : ''}` +
          `${entry.sources.length > 0 ? ` -> ${entry.sources.join(', ')}` : ''}`,
      ),
    ),
  ].join('\n\n');
}
