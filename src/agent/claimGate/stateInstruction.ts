/**
 * The authoritative state, handed back to the model so it can write the turn
 * again TRUTHFULLY.
 *
 * WHAT THIS IS, AND WHAT IT IS CAREFULLY NOT
 * ---------------------------------------------------------------------------
 * It is a system-side instruction, in the same family as
 * `src/agent/prompt/clauses.ts`: application code telling the model what is
 * true and what its job is. It is NOT a correction to read out, and it contains
 * no customer-facing sentence anywhere.
 *
 * That constraint is why the failed attempt's own wording is ABSENT from here.
 * The obvious design is to quote the sentence back - "you said X, and X is not
 * true" - and it is the wrong one twice over. A 7B model handed a sentence and
 * told not to repeat it repeats it; and a sentence this code puts into the
 * context window for the model to work from is a script, whoever originally
 * wrote it. So the instruction reports the CLAIM - its family, the form that
 * fired, the machine-readable reason - and the excerpt lives in the audit trail
 * and in `AgentTurnResult.claimGate`, where the benchmark task needs it and no
 * model will ever read it.
 *
 * Nothing here selects or suggests wording. Every line is either a fact read
 * off a row, a refusal code, or a statement of what the model must now decide
 * for itself.
 */
import type { ActionLedger, LedgerEffect } from './ledger.js';
import type { UnsupportedClaim } from './verifier.js';

/** A heading that cannot be mistaken for something to say out loud. */
const HEADING = 'AUTHORITATIVE STATE - read from application records, not from anything that was said';

export interface BuildStateInstructionInput {
  readonly ledger: ActionLedger;
  readonly unsupported: readonly UnsupportedClaim[];
  /** Which regeneration this is. Reported so the model can see it is bounded. */
  readonly attempt: number;
  readonly maxAttempts: number;
}

/**
 * Render the instruction.
 *
 * Deterministic and pure: the same ledger and the same claims produce the same
 * bytes, which is what lets a test assert the instruction rather than assert
 * around it.
 */
export function buildStateInstruction(input: BuildStateInstructionInput): string {
  const { ledger } = input;
  const lines: string[] = [HEADING, ''];

  // ---- what actually exists ----------------------------------------------
  lines.push('EFFECTS THAT EXIST:');
  const effects = ledger.effects.filter((effect) => effect.kind !== 'AVAILABILITY_CHECKED');
  if (effects.length === 0) {
    lines.push('  none. No meeting, no callback, no cancellation, no handover, for this contact.');
  } else {
    for (const effect of effects) lines.push(`  - ${describeEffect(effect)}`);
  }

  const checks = ledger.effects.filter((effect) => effect.kind === 'AVAILABILITY_CHECKED');
  if (checks.length > 0) {
    lines.push('AVAILABILITY CHECKED BUT NOTHING BOOKED:');
    for (const effect of checks) lines.push(`  - ${describeEffect(effect)}`);
  }

  // ---- what was refused, and why -----------------------------------------
  lines.push('', 'REFUSED THIS TURN:');
  if (ledger.refusals.length === 0) {
    lines.push('  nothing was refused.');
  } else {
    for (const refusal of ledger.refusals) {
      lines.push(`  - ${refusal.toolName}: ${refusal.code} - ${refusal.reason}`);
    }
  }

  // ---- which identifiers are real ----------------------------------------
  lines.push('', 'IDENTIFIERS THE SYSTEM HAS ISSUED:');
  const operational = ledger.identifiers.filter((identifier) => identifier.kind !== 'CONTACT');
  if (operational.length === 0) {
    lines.push('  none. There is no confirmation number, reference or booking code of any kind.');
  } else {
    for (const identifier of operational) lines.push(`  - ${identifier.kind} ${identifier.value}`);
  }
  lines.push('  Internal identifiers are not for the contact to hear in any case.');

  // ---- what this system cannot do at all ---------------------------------
  lines.push(
    '',
    'WHAT THIS SYSTEM CAN DO:',
    `  only these tools, and nothing else: ${[...ledger.permittedToolNames].sort().join(', ')}.`,
    '  There is no tool that sends an email, a text or a document.',
  );

  // ---- why the previous attempt was not released -------------------------
  lines.push(
    '',
    `NOT RELEASED (regeneration ${input.attempt} of ${input.maxAttempts}): the previous version of this turn ` +
      'asserted the following, and the records above do not support it.',
  );
  for (const entry of input.unsupported) {
    // MISSION 2F. A fail-closed SECOND-LAYER entry is not a claim anybody found,
    // so reporting it in the "you asserted X" shape would tell the model
    // something false about its own previous turn - and a model handed a false
    // premise argues with it, which is the § 6.5.4 behaviour this gate exists to
    // stop rather than to provoke. It gets its own line, which says exactly what
    // happened and what that means for what the model must now do.
    if (entry.reason === 'SEMANTIC_CHECK_UNAVAILABLE') {
      const layer = entry.detail.semanticLayer;
      lines.push(
        `  - the independent second check on the previous version did not complete ` +
          `(${layer?.outcome ?? 'UNKNOWN'}${layer?.reason ? `: ${layer.reason}` : ''}). ` +
          'Nothing about what that version asserted could be confirmed, so none of it may stand. ' +
          'State only what the records above show.',
      );
      continue;
    }
    lines.push(`  - asserted ${entry.claim.family} ${entry.claim.mode}; reason ${entry.reason}${describeDetail(entry)}`);
  }

  lines.push(
    '',
    'Compose this turn again from the records above. Decide for yourself what to say and how to say it; ' +
      'nothing here is wording to reuse. State only what the records support, name what was refused in ' +
      'ordinary language if that is what the person needs to know, and do not give a reference the system ' +
      'has not issued. Times belong in the contact’s own local time as the records give them.',
  );

  return lines.join('\n');
}

function describeEffect(effect: LedgerEffect): string {
  const parts: string[] = [effect.kind];
  if (effect.entity) parts.push(`${effect.entity.type} ${effect.entity.id}`);
  if (effect.localTime) parts.push(`${effect.localTime.local} (${effect.localTime.timezone})`);
  if (effect.status) parts.push(`status ${effect.status}`);
  if (effect.title) parts.push(`title ${JSON.stringify(effect.title)}`);
  parts.push(effect.source === 'TOOL_OUTCOME' ? 'executed this turn' : 'already on record');
  return parts.join(' | ');
}

function describeDetail(entry: UnsupportedClaim): string {
  const detail = entry.detail;
  const parts: string[] = [];
  if (detail.invalidIdentifier) parts.push(`identifier ${detail.invalidIdentifier} exists nowhere`);
  if (detail.assertedLocal) parts.push(`text said ${detail.assertedLocal}`);
  if (detail.recordedLocal) parts.push(`record says ${detail.recordedLocal}`);
  if (detail.refusal) parts.push(`refused as ${detail.refusal.code}`);
  return parts.length > 0 ? ` (${parts.join('; ')})` : '';
}
