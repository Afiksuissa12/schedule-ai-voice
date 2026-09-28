/**
 * Turning a recorded run into something a person reads.
 *
 * THE TRANSCRIPTS ARE THE EVIDENCE. Every judged score in this harness is an
 * opinion produced by a 7-8B model, and the only thing that makes such an
 * opinion reviewable is the ability to go and read the conversation it was
 * formed from. So these renderings are committed, and they show what the model
 * SAID next to what the machinery DID - including the arguments it proposed and
 * the dispatcher's verdict on them - rather than a cleaned-up summary.
 */
import type { JudgeRequest } from '../rubric/judgePrompt.js';
import type { ScenarioRun, TurnRecord } from '../types.js';

/**
 * The judge's view of a conversation.
 *
 * The model's identity is NOT included, and neither are the scenario's
 * expectations. A judge that could see "this turn was supposed to call
 * schedule_followup" would be grading against the answer key rather than
 * assessing how the conversation sounded.
 */
export function toJudgeRequest(run: ScenarioRun): JudgeRequest {
  return {
    objective: run.objective,
    language: run.language,
    priorConversation: run.priorConversation.map((t) => ({
      role: t.role === 'CONTACT' ? 'PROSPECT' : 'AGENT',
      text: t.text,
    })),
    turns: run.turns.map((turn) => ({
      contact: turn.utterance,
      agent: turn.assistantText ?? '',
      systemEvents: systemEventsFor(turn),
    })),
  };
}

/**
 * What the machinery did, in one phrase per event.
 *
 * Deliberately terse and outcome-only. The judge needs to know that a booking
 * was refused in order to assess what the agent then said about it; it does not
 * need the argument JSON, and giving it that would invite it to grade the
 * mechanics it was told to ignore.
 */
function systemEventsFor(turn: TurnRecord): string[] {
  return turn.toolOutcomes.map((outcome) =>
    outcome.ok
      ? `${outcome.toolName} succeeded - ${outcome.summary ?? 'no summary'}`
      : `${outcome.toolName} was REFUSED by the system - ${outcome.reason ?? outcome.code ?? 'no reason given'}`,
  );
}

// ---------------------------------------------------------------------------
// Markdown.
// ---------------------------------------------------------------------------

export function renderTranscript(run: ScenarioRun): string {
  const lines: string[] = [];

  lines.push(`# ${run.title}`);
  lines.push('');
  lines.push(`- **Model:** \`${run.modelId}\``);
  lines.push(`- **Scenario:** \`${run.scenarioId}\` (${run.language})`);
  lines.push(`- **Objective:** ${run.objective}`);
  lines.push(`- **Now (fixed clock):** ${run.nowUtc}`);
  lines.push(`- **Status:** ${run.status}${run.error ? ` - ${run.error}` : ''}`);
  lines.push(`- **Corpus ${run.corpusVersion} / rubric ${run.rubricVersion} / harness ${run.harnessVersion}**`);
  lines.push('');

  if (run.priorConversation.length > 0) {
    lines.push('## Earlier in this conversation');
    lines.push('');
    for (const turn of run.priorConversation) {
      lines.push(`- **${turn.role === 'CONTACT' ? 'Prospect' : 'Agent'}:** ${turn.text}`);
    }
    lines.push('');
  }

  lines.push('## Transcript');
  lines.push('');

  for (const turn of run.turns) {
    lines.push(`### Turn ${turn.index + 1}`);
    lines.push('');
    lines.push(`> _Why this turn exists: ${turn.note}_`);
    lines.push('');
    lines.push(`**Prospect:** ${turn.utterance}`);
    lines.push('');

    for (const call of turn.toolCalls) {
      const outcome = turn.toolOutcomes.find((o) => o.toolCallId === call.toolCallId);
      const verdict = outcome
        ? outcome.ok
          ? `OK - ${outcome.summary ?? ''}`
          : `REFUSED ${outcome.code ?? ''} - ${outcome.reason ?? ''}`
        : '(no outcome recorded)';
      lines.push(`- \`${call.toolName}\` proposed: \`${truncate(call.argumentsJson, ARGUMENTS_RENDER_LIMIT)}\``);
      lines.push(`  - dispatcher: ${verdict}`);
    }
    if (turn.toolCalls.length > 0) lines.push('');

    // WHAT THE PROVIDER REFUSED BEFORE THE DISPATCHER EVER SAW IT.
    // docs/MISSION_2D_AYA_ROOT_CAUSE.md § 10 asked for this. The loop above
    // renders calls that were DISPATCHED; a span the mapper refused never
    // becomes a call and so never appears there. It used to be visible anyway,
    // because a refused span stayed in the assistant text - but § 8.2 now
    // removes an action list from the text whether its calls were accepted or
    // refused (reading JSON down a phone line being the worse failure), which
    // left `malformed` as a bare count and the reasons nowhere.
    //
    // Rendered from `metrics.toolCallHealth.refusalReasons`, which is a
    // diagnostic and is never branched on.
    const refusalReasons = turn.metrics?.toolCallHealth?.refusalReasons ?? [];
    if (refusalReasons.length > 0) {
      lines.push(`- provider refused ${refusalReasons.length} tool-call-shaped span(s) before dispatch:`);
      for (const reason of refusalReasons) lines.push(`  - ${reason}`);
      lines.push('');
    }

    lines.push(`**Agent:** ${turn.assistantText ?? '_(said nothing)_'}`);
    lines.push('');

    if (turn.error) {
      lines.push(`> **TURN FAILED:** ${turn.error}`);
      lines.push('');
    }

    lines.push(`<sub>${renderTurnChecks(turn)}</sub>`);
    lines.push('');
  }

  const judges = Object.values(run.judges);
  if (judges.length > 0) {
    lines.push('## Judge verdicts');
    lines.push('');
    lines.push('> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.');
    lines.push('');
    for (const judge of judges) {
      lines.push(`### Judge: \`${judge.judgeModel}\``);
      lines.push('');
      if (!judge.ok) {
        lines.push(`**FAILED after ${judge.attempts} attempt(s):** ${judge.error}`);
        lines.push('');
        continue;
      }
      lines.push('| Dimension | Score | Why |');
      lines.push('| --- | ---: | --- |');
      for (const [key, value] of Object.entries(judge.scores)) {
        lines.push(`| ${key} | ${value.score}/5 | ${escapePipes(value.why)} |`);
      }
      lines.push('');
    }
  }

  return `${lines.join('\n')}\n`;
}

function renderTurnChecks(turn: TurnRecord): string {
  const c = turn.checks;
  const parts: string[] = [];

  if (c.fabricatedTimestamps.length > 0) {
    parts.push(
      `**GATE FAILED - manufactured timestamp:** ${c.fabricatedTimestamps
        .map((f) => `${f.toolName}.${f.field}="${f.matched}"`)
        .join(', ')}`,
    );
  }
  // A LEAK IS THE LOUDEST THING ON THE TURN, so it is printed first and in the
  // same shape as the other gate failures. A reader scanning a transcript for
  // "what did this turn actually get wrong" must not have to reach the end.
  const claims = c.unsupportedClaims;
  if (claims && claims.leaks.length > 0) {
    parts.push(
      `**GATE FAILED - unsupported claim RELEASED to the contact:** ${claims.leaks
        .map((claim) => `${claim.kind} "${claim.matched}"`)
        .join(', ')} (the real dispatcher had succeeded at ${
        claims.ledgerSucceededTools.length === 0 ? 'NOTHING' : claims.ledgerSucceededTools.join(', ')
      })`,
    );
  }
  // Attempts are reported even when nothing leaked, because "the model tried and
  // the gate stopped it" is the observation that makes the gate worth having, and
  // a transcript that only showed failures would make a working gate invisible.
  if (claims && claims.attemptsIndependentlyObserved && claims.attempts.length > 0 && claims.leaks.length === 0) {
    parts.push(
      `claim gate CORRECTED an unsupported claim before release: ${claims.attempts
        .map((claim) => `${claim.kind} "${claim.matched}"`)
        .join(', ')}`,
    );
  }
  if (c.toolSelection.applicable) {
    parts.push(
      `tool selection ${c.toolSelection.assertionsPassed}/${c.toolSelection.assertionsChecked}` +
        (c.toolSelection.failures.length ? ` (${c.toolSelection.failures.join('; ')})` : ''),
    );
  }
  if (c.unnecessaryCalls.length > 0) parts.push(`unnecessary: ${c.unnecessaryCalls.join(', ')}`);
  if (c.passthrough.applicable) {
    parts.push(`passthrough ${c.passthrough.passed ? 'PASS' : 'FAIL'} - ${c.passthrough.detail}`);
  }
  if (c.text.applicable && c.text.failures.length > 0) parts.push(`text: ${c.text.failures.join('; ')}`);
  if (c.schedulingIntent.applicable && !c.schedulingIntent.recognised) {
    parts.push(`**missed the scheduling intent** - ${c.schedulingIntent.detail}`);
  }
  if (c.toolFailure.expected) {
    parts.push(
      `tool failure expected: ${c.toolFailure.occurred ? `yes (${c.toolFailure.codes.join(', ')})` : 'DID NOT OCCUR'}`,
    );
  }
  if (c.repetition.verbatimRepeat) parts.push('**verbatim repeat of an earlier reply**');
  else if (c.repetition.maxSimilarity > 0.6) {
    parts.push(`similarity to an earlier reply ${(c.repetition.maxSimilarity * 100).toFixed(0)}%`);
  }
  if (!c.language.matched) parts.push(`language MISMATCH - ${c.language.detail}`);

  const invalid = c.toolCalls.filter((call) => !call.schemaValid);
  if (invalid.length > 0) {
    parts.push(`invalid args: ${invalid.map((i) => `${i.toolName} (${i.schemaErrors.join('; ')})`).join(' | ')}`);
  }
  const hallucinated = c.toolCalls.filter((call) => call.hallucinatedContactId || call.hallucinatedMeetingId);
  if (hallucinated.length > 0) {
    parts.push(`**hallucinated id in ${hallucinated.map((h) => h.toolName).join(', ')}**`);
  }

  const m = turn.metrics;
  if (m) {
    parts.push(
      `${turn.providerCalls} provider call(s), ` +
        `TTFT ${fmt(m.timeToFirstTokenMs)}ms, total ${turn.turnLatencyMs}ms, ` +
        `${fmt(m.promptTokens)}p/${fmt(m.generatedTokens)}g tokens, ` +
        `${m.tokensPerSecond === null ? 'n/a' : m.tokensPerSecond.toFixed(1)} tok/s, ` +
        `ctx ${m.contextUtilization === null ? 'n/a' : `${(m.contextUtilization * 100).toFixed(0)}%`}`,
    );
  }

  parts.push(`${c.text.lengthChars} chars`);
  return parts.join(' &middot; ');
}

function fmt(value: number | null): string {
  return value === null ? 'n/a' : String(Math.round(value));
}

/**
 * How much of a tool call's arguments a transcript shows.
 *
 * WAS 400, AND 400 COST A REPORT TWO ANSWERS IT COULD OTHERWISE HAVE HAD.
 * docs/MISSION_2D_AYA_ROOT_CAUSE.md § 5.1: `not-decision-maker` turn 1 and
 * `price-objection-interrupt` turn 3 both had their `urgency` value cut off, so
 * two of forty-four calls in § 5's counterfactual are recorded INDETERMINATE
 * rather than answered - and § 10 asked for the limit to be reconsidered.
 *
 * 4,000 is chosen against the real distribution rather than picked for looking
 * round. The widest legal arguments object in `TOOL_DEFINITIONS` is
 * `update_qualification`, whose `observations` array allows 20 rubric
 * observations each carrying the contact's own words as evidence; a full one of
 * those runs to a few thousand characters. 4,000 shows every argument object
 * this corpus can legally produce in full, while still bounding a pathological
 * generation - a model that emits 200 kB of JSON should still not produce a
 * 200 kB line in a committed transcript.
 *
 * THIS DOES NOT INVALIDATE THE COMMITTED EVIDENCE. `eval-output/` and
 * `eval-output-fair-20260927/` are unchanged and remain byte-identical to each
 * other; the two indeterminate rows stay indeterminate, because the bytes were
 * lost at render time in a run that has already happened and no re-render can
 * recover them. What this buys is that the OPERATOR'S NEXT RUN records them.
 */
const ARGUMENTS_RENDER_LIMIT = 4_000;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
