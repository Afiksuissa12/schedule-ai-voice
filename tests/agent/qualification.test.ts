/**
 * The qualification rubric, and the rule it exists to enforce.
 *
 * THE DECISION-MAKER HARD CAP
 * ---------------------------------------------------------------------------
 * Enthusiasm from someone who cannot sign is the most expensive false signal in
 * outbound sales, and a model in a friendly conversation will reliably
 * over-score it, because the conversation really was good. So the cap is not
 * advice in a prompt: it is arithmetic in application code, applied to a value
 * read from the PERSISTED Contact row.
 *
 * Both sides are tested here - the uncapped path, the capped path, and the case
 * the brief calls out explicitly: the model proposing a score above the cap.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  bandFor,
  explainScoring,
  NON_DECISION_MAKER_SCORE_CEILING,
  QUALIFICATION_RUBRIC_VERSION,
  RUBRIC_FACTORS,
  scoreQualification,
} from '../../src/agent/tools/qualificationRubric.js';
import { scriptedArgs } from '../../src/llm/scriptedLlmProvider.js';
import { parseJson } from '../../src/shared/json.js';
import type { Conversation } from '../../src/domain/entities.js';
import { createSliceHarness, type SliceHarness } from '../e2e/support.js';

const STRONG_OBSERVATIONS = RUBRIC_FACTORS.map((factor) => ({
  factor: factor.name,
  value: 100,
  evidence: `They said something unambiguous about ${factor.name}.`,
}));

describe('scoreQualification (pure)', () => {
  it('weights the factors to a 0-100 score', () => {
    expect(RUBRIC_FACTORS.reduce((sum, factor) => sum + factor.weight, 0)).toBe(100);

    const perfect = scoreQualification({ observations: STRONG_OBSERVATIONS, isDecisionMaker: true });
    expect(perfect.rawScore).toBe(100);
    expect(perfect.cappedScore).toBe(100);
    expect(perfect.band).toBe('HIGH');

    const nothing = scoreQualification({ observations: [], isDecisionMaker: true });
    expect(nothing.rawScore).toBe(0);
    expect(nothing.band).toBe('UNQUALIFIED');
  });

  it('records every factor, including the ones the model never mentioned', () => {
    const scoring = scoreQualification({
      observations: [{ factor: 'need_established', value: 80, evidence: 'Their CRM cannot do renewals.' }],
      isDecisionMaker: true,
    });

    expect(scoring.factors).toHaveLength(RUBRIC_FACTORS.length);
    const observed = scoring.factors.find((factor) => factor.name === 'need_established')!;
    expect(observed.unobserved).toBe(false);
    expect(observed.value).toBe(80);
    expect(observed.contribution).toBe(20); // 25 weight * 80 / 100

    // An unobserved factor scores zero and SAYS it was unobserved, so a reader
    // can tell "no evidence" from "evidence of absence".
    const silent = scoring.factors.find((factor) => factor.name === 'budget_signal')!;
    expect(silent.unobserved).toBe(true);
    expect(silent.value).toBe(0);
    expect(silent.evidence).toBeNull();
  });

  it('leaves a decision maker’s score uncapped', () => {
    const scoring = scoreQualification({ observations: STRONG_OBSERVATIONS, isDecisionMaker: true });

    expect(scoring.capApplied).toBe(false);
    expect(scoring.rawScore).toBe(scoring.cappedScore);
    expect(scoring.score).toBe(100);
    expect(explainScoring(scoring)).not.toContain('CAPPED');
  });

  it('caps a non-decision maker at the documented ceiling', () => {
    const scoring = scoreQualification({ observations: STRONG_OBSERVATIONS, isDecisionMaker: false });

    expect(scoring.rawScore).toBe(100);
    expect(scoring.cappedScore).toBe(NON_DECISION_MAKER_SCORE_CEILING);
    expect(scoring.score).toBe(NON_DECISION_MAKER_SCORE_CEILING);
    expect(scoring.capApplied).toBe(true);
    // rawScore and cappedScore are persisted SEPARATELY, so the cap is visible
    // rather than implied: a reader sees that we thought 100 and stored 60.
    expect(scoring.rawScore).not.toBe(scoring.cappedScore);
    expect(explainScoring(scoring)).toContain('CAPPED');
    expect(explainScoring(scoring)).toContain('not recorded as the decision maker');
  });

  it('does not let a high authority_signal lift the cap', () => {
    // The model insisting "they said they can sign" must not be the thing that
    // raises the ceiling. Only the persisted Contact row does that.
    const scoring = scoreQualification({
      observations: [
        ...STRONG_OBSERVATIONS,
        { factor: 'authority_signal', value: 100, evidence: 'They told me they sign everything.' },
      ],
      isDecisionMaker: false,
    });

    expect(scoring.cappedScore).toBe(NON_DECISION_MAKER_SCORE_CEILING);
    expect(scoring.capApplied).toBe(true);
  });

  it('treats a proposed score as advisory when there is evidence', () => {
    const scoring = scoreQualification({
      observations: [{ factor: 'engagement', value: 100, evidence: 'They asked six questions.' }],
      modelProposedScore: 99,
      isDecisionMaker: true,
    });

    // 15 weight * 100 / 100 = 15. The model's 99 is recorded, and ignored.
    expect(scoring.rawScore).toBe(15);
    expect(scoring.modelProposedScore).toBe(99);
    expect(scoring.usedModelProposedScore).toBe(false);
  });

  it('falls back to the proposed score only when no evidence was supplied - and still caps it', () => {
    const uncapped = scoreQualification({ modelProposedScore: 95, isDecisionMaker: true });
    expect(uncapped.rawScore).toBe(95);
    expect(uncapped.usedModelProposedScore).toBe(true);
    expect(uncapped.cappedScore).toBe(95);

    const capped = scoreQualification({ modelProposedScore: 95, isDecisionMaker: false });
    expect(capped.rawScore).toBe(95);
    expect(capped.cappedScore).toBe(NON_DECISION_MAKER_SCORE_CEILING);
    expect(capped.capApplied).toBe(true);
  });

  it('clamps an out-of-range proposed score rather than trusting it', () => {
    expect(scoreQualification({ modelProposedScore: 5000, isDecisionMaker: true }).rawScore).toBe(100);
    expect(scoreQualification({ modelProposedScore: -40, isDecisionMaker: true }).rawScore).toBe(0);
    expect(scoreQualification({ modelProposedScore: Number.NaN, isDecisionMaker: true }).modelProposedScore).toBeNull();
  });

  it('derives the band from the CAPPED score, not the raw one', () => {
    const scoring = scoreQualification({ observations: STRONG_OBSERVATIONS, isDecisionMaker: false });
    // 100 would be HIGH; 60 is MEDIUM. The cap must move the band too, or it
    // achieves nothing downstream.
    expect(bandFor(scoring.rawScore)).toBe('HIGH');
    expect(scoring.band).toBe('MEDIUM');
  });

  it('is deterministic and versioned', () => {
    const a = scoreQualification({ observations: STRONG_OBSERVATIONS, isDecisionMaker: true });
    const b = scoreQualification({ observations: STRONG_OBSERVATIONS, isDecisionMaker: true });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.rubricVersion).toBe(QUALIFICATION_RUBRIC_VERSION);
  });
});

describe('update_qualification, end to end', () => {
  let harness: SliceHarness;
  let conversation: Conversation;

  afterEach(async () => {
    await harness.cleanup();
  });

  async function setUp(isDecisionMaker: boolean) {
    harness = await createSliceHarness({
      label: `agent-qual-${isDecisionMaker ? 'dm' : 'nondm'}`,
      world: { contactIsDecisionMaker: isDecisionMaker },
    });
    conversation = await harness.startConversation();
  }

  function scriptScoring(contactId: string, args: Record<string, unknown>) {
    harness.llm.setScript([
      {
        assistantText: 'Let me note that down.',
        toolCalls: [
          {
            toolCallId: 'call_qual_1',
            toolName: 'update_qualification',
            argumentsJson: scriptedArgs({ contact_id: contactId, ...args }),
          },
        ],
      },
      { assistantText: 'Noted, thank you.' },
    ]);
  }

  it('persists rawScore and cappedScore separately for a decision maker', async () => {
    await setUp(true);
    scriptScoring(harness.world.contact.id, { observations: STRONG_OBSERVATIONS });

    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'We have budget approved and we need this before renewal in June.',
    });
    expect(turn.toolOutcomes[0]?.ok).toBe(true);

    const state = await harness.db.qualificationStates.requireByContactId(harness.world.contact.id);
    expect(state.rawScore).toBe(100);
    expect(state.cappedScore).toBe(100);
    expect(state.score).toBe(100);
    expect(state.band).toBe('HIGH');
    expect(state.rubricVersion).toBe(QUALIFICATION_RUBRIC_VERSION);
    expect(state.updatedByToolCallId).toBe('call_qual_1');

    const factors = parseJson<Record<string, unknown>>(state.factorsJson);
    expect(factors['capApplied']).toBe(false);
    expect(Array.isArray(factors['factors'])).toBe(true);
  });

  it('caps the persisted score when the contact is not the decision maker', async () => {
    await setUp(false);
    scriptScoring(harness.world.contact.id, { observations: STRONG_OBSERVATIONS, proposed_score: 100 });

    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'I love it, the whole team is excited.',
    });
    expect(turn.toolOutcomes[0]?.ok).toBe(true);

    const state = await harness.db.qualificationStates.requireByContactId(harness.world.contact.id);
    expect(state.rawScore).toBe(100);
    expect(state.cappedScore).toBe(NON_DECISION_MAKER_SCORE_CEILING);
    expect(state.score).toBe(NON_DECISION_MAKER_SCORE_CEILING);
    expect(state.band).toBe('MEDIUM');
    expect(state.isDecisionMaker).toBe(false);

    const factors = parseJson<Record<string, unknown>>(state.factorsJson);
    expect(factors['capApplied']).toBe(true);
    expect(factors['capCeiling']).toBe(NON_DECISION_MAKER_SCORE_CEILING);

    // The tool told the model what happened, so it does not try again harder.
    const outcome = turn.toolOutcomes[0];
    if (outcome?.ok) {
      expect(outcome.data['cap_applied']).toBe(true);
      expect(outcome.summary).toContain('CAPPED');
    }

    // And the audit event explains it in one readable line.
    const persisted = (await harness.db.audit.listByCorrelationId(turn.correlationId)).find(
      (event) => event.subjectType === 'QUALIFICATION_STATE',
    );
    expect(persisted?.summary).toContain('CAPPED');
  });

  it('caps a bare proposed score above the ceiling, with no evidence at all', async () => {
    // The case the brief calls out by name: the model simply asserts 95 for a
    // contact who cannot sign.
    await setUp(false);
    scriptScoring(harness.world.contact.id, {
      proposed_score: 95,
      notes: 'Very enthusiastic, says the whole team wants it.',
    });

    await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Honestly we are sold, this is exactly what we need.',
    });

    const state = await harness.db.qualificationStates.requireByContactId(harness.world.contact.id);
    expect(state.rawScore).toBe(95);
    expect(state.cappedScore).toBe(NON_DECISION_MAKER_SCORE_CEILING);
    expect(state.score).toBe(NON_DECISION_MAKER_SCORE_CEILING);
  });

  it('lets the cap lift only by changing the durable record of who signs', async () => {
    await setUp(false);
    scriptScoring(harness.world.contact.id, {
      observations: STRONG_OBSERVATIONS,
      is_decision_maker: true,
    });

    await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Actually I own this budget - I sign for it.',
    });

    // The Contact row itself changed, which is an auditable CRM edit rather
    // than a per-call flag the model can set to dodge the ceiling.
    const contact = await harness.db.contacts.requireById(harness.world.contact.id);
    expect(contact.isDecisionMaker).toBe(true);

    const state = await harness.db.qualificationStates.requireByContactId(contact.id);
    expect(state.cappedScore).toBe(100);
    expect(state.isDecisionMaker).toBe(true);
  });

  it('upserts rather than accumulating rows', async () => {
    await setUp(true);

    scriptScoring(harness.world.contact.id, { proposed_score: 20 });
    await harness.runtime.agent.handleTurn({ conversationId: conversation.id, utterance: 'Maybe.' });

    scriptScoring(harness.world.contact.id, { proposed_score: 80 });
    await harness.runtime.agent.handleTurn({ conversationId: conversation.id, utterance: 'Actually, yes.' });

    expect(await harness.db.prisma.qualificationState.count()).toBe(1);
    const state = await harness.db.qualificationStates.requireByContactId(harness.world.contact.id);
    expect(state.score).toBe(80);
  });
});
