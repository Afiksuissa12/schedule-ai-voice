/**
 * The two MODEL-FACING changes of the hosted-demo stabilisation pass, pinned.
 *
 *  - The conversation prompt's `NO_PROMISES_BEYOND_TOOLS` clause now names the
 *    deliveries the model kept promising and no tool can make.
 *  - The semantic classifier's instruction gains a rule of MEANING - readiness is
 *    not a record - without a phrase list, and without narrowing what a record,
 *    a delivery or an arrangement is.
 *
 * Neither is a customer-facing sentence and neither selects or emits one.
 */
import { describe, expect, it } from 'vitest';

import { PROMPT_CLAUSES } from '../../src/agent/prompt/clauses.js';
import { buildSystemPrompt, LOCAL_BRAIN_SYSTEM_PROMPT_REF } from '../../src/agent/prompt/systemPrompt.js';
import {
  SEMANTIC_VERIFIER_INSTRUCTION,
  SEMANTIC_VERIFIER_INSTRUCTION_REF,
} from '../../src/agent/claimGate/semantic/instruction.js';

describe('the conversation prompt forbids promising a delivery', () => {
  const clause = PROMPT_CLAUSES.NO_PROMISES_BEYOND_TOOLS;

  it('names confirmations, emailed details and reminders, and was versioned', () => {
    expect(clause.version).toBe(2);
    for (const words of ['a confirmation', 'email them the details', 'send a reminder', 'remind them closer to the time']) {
      expect(clause.text).toContain(words);
    }
    expect(clause.text).toContain('describe only what the tool result says was saved');
  });

  it('is in the prompt the hosted demo actually runs', () => {
    const prompt = buildSystemPrompt({ promptRef: LOCAL_BRAIN_SYSTEM_PROMPT_REF, allowedToolNames: ['schedule_meeting'] });
    expect(prompt.clauseIds).toContain('NO_PROMISES_BEYOND_TOOLS');
    expect(prompt.text).toContain('never say you will send them a confirmation');
  });
});

describe('the classifier instruction: readiness is not a record', () => {
  it('states the rule and bumps the instruction ref the audit chain pins', () => {
    expect(SEMANTIC_VERIFIER_INSTRUCTION_REF).toBe('semantic-claim-classifier@v3');
    expect(SEMANTIC_VERIFIER_INSTRUCTION).toContain('READINESS IS NOT A RECORD');
    expect(SEMANTIC_VERIFIER_INSTRUCTION).toContain('SIX RULES FOR READING A SEGMENT');
  });

  it('keeps every undertaking that WOULD produce a record or a delivery inside the test', () => {
    const start = SEMANTIC_VERIFIER_INSTRUCTION.indexOf('READINESS IS NOT A RECORD');
    const rule = SEMANTIC_VERIFIER_INSTRUCTION.slice(start, start + 800);
    for (const kept of ['entered', 'noted', 'scheduled', 'called', 'sent', 'reminder', 'confirmation']) {
      expect(rule).toContain(kept);
    }
    expect(SEMANTIC_VERIFIER_INSTRUCTION).toContain('WHEN YOU ARE UNSURE, REPORT IT');
  });

  it('is a rule of meaning, not a phrase list: no reassurance wording is quoted', () => {
    const lower = SEMANTIC_VERIFIER_INSTRUCTION.toLowerCase();
    for (const phrase of ['make sure the team', 'ready for you', 'everything will be ready', "we'll be ready"]) {
      expect(lower).not.toContain(phrase);
    }
  });
});
