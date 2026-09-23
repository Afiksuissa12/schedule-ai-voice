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

/** The five questions, answered. */
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
  ].join('\n\n');
}
