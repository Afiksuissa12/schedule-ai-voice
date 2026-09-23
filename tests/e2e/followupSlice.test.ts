/**
 * THE HEADLINE TEST.
 *
 * A lead in America/New_York says "Can you call me back tomorrow afternoon at
 * 3?". By the end of this file we have proved, against real rows in a real
 * database:
 *
 *   (a) the datetime was resolved and validated DETERMINISTICALLY by
 *       application code, from the contact's own words;
 *   (b) a FutureAction of type CALL_CONTACT was persisted with the correct UTC
 *       instant, the contact's timezone, and a non-empty
 *       validationProvenanceJson;
 *   (c) the Contact, Conversation, ConversationTurns and FutureAction are all
 *       readable from a FRESHLY CONSTRUCTED client against the same file;
 *   (d) the audit chain for the turn's correlationId contains, in order,
 *       UTTERANCE_RECEIVED, AGENT_DECISION, TOOL_CALL_REQUESTED,
 *       TOOL_CALL_VALIDATED, ENTITY_PERSISTED and FUTURE_ACTION_SCHEDULED;
 *   (e) the chain ALONE is enough to reconstruct what was said, what was
 *       decided, what tool was called, what was validated and what was
 *       persisted;
 *
 * and finally that the promise is KEPT: advance the clock past the promised
 * time, run one DueActionRunner pass, and the deterministic telephony double
 * receives the CALL_CONTACT dispatch - on the same correlation id, with no LLM
 * anywhere in sight.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { summarizeChain } from '../../src/app/auditReport.js';
import { parseValidationProvenance } from '../../src/domain/provenance.js';
import { parseCallContactPayload } from '../../src/followup/payloads.js';
import { scriptedArgs, type ScriptedStep } from '../../src/llm/scriptedLlmProvider.js';
import type { Conversation } from '../../src/domain/entities.js';
import {
  createSliceHarness,
  positionsInOrder,
  SLICE_NOW_UTC,
  TOMORROW_AFTERNOON_AT_3_UTC,
  type SliceHarness,
} from './support.js';

const THE_UTTERANCE = 'Can you call me back tomorrow afternoon at 3?';

/**
 * The model's entire contribution, fixed in advance.
 *
 * Note what it does NOT do: it never converts "tomorrow afternoon at 3" into a
 * date. It passes the contact's words straight through, which is the behaviour
 * the guardrailed prompt asks for and the tool contract requires.
 */
function followupScript(contactId: string): ScriptedStep[] {
  return [
    {
      assistantText: 'Of course - let me get that in the diary.',
      toolCalls: [
        {
          toolCallId: 'call_followup_1',
          toolName: 'schedule_followup',
          argumentsJson: scriptedArgs({
            contact_id: contactId,
            when: 'tomorrow afternoon at 3',
            reason: 'Contact asked to be called back to talk through pricing.',
          }),
        },
      ],
    },
    {
      assistantText: "You're all set - I'll ring you tomorrow, Thursday the 5th, at 3 in the afternoon your time.",
    },
  ];
}

describe('end-to-end: a lead asks to be called back tomorrow afternoon at 3', () => {
  let harness: SliceHarness;
  let conversation: Conversation;

  beforeEach(async () => {
    harness = await createSliceHarness({ label: 'e2e-followup' });
    conversation = await harness.startConversation();
    harness.llm.setScript(followupScript(harness.world.contact.id));
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  const runTurn = () => harness.runtime.agent.handleTurn({ conversationId: conversation.id, utterance: THE_UTTERANCE });

  it('(a) resolves the contact’s own words deterministically, with a complete receipt', async () => {
    const turn = await runTurn();

    const outcome = turn.toolOutcomes[0];
    expect(outcome?.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome?.ok) return;

    expect(outcome.toolName).toBe('schedule_followup');
    expect(outcome.provenance).toBeDefined();
    // Verbatim: the receipt records what the contact said, not our rendering.
    expect(outcome.provenance?.rawProposedValue).toBe('tomorrow afternoon at 3');
    expect(outcome.provenance?.nowUtc).toBe(SLICE_NOW_UTC);
    expect(outcome.provenance?.resolvedTimezone).toBe('America/New_York');
    expect(outcome.provenance?.resolvedStartUtc).toBe(TOMORROW_AFTERNOON_AT_3_UTC);

    const checks = outcome.provenance?.checks ?? [];
    const names = checks.map((check) => check.name);
    expect(names).toContain('timezone_is_iana');
    expect(names).toContain('parse_proposed_value');
    expect(names).toContain('in_the_future');
    expect(names).toContain('min_lead_time');
    expect(names).toContain('within_horizon');
    expect(names).toContain('business_hours');
    expect(checks.every((check) => check.passed)).toBe(true);

    // The model said nothing about a timezone; the CONTACT'S persisted zone was
    // used, and "3" was disambiguated to 15:00 by the afternoon day-part window.
    expect(outcome.data['timezone']).toBe('America/New_York');
    expect(outcome.data['start_local']).toBe('2026-03-05T15:00');
  });

  it('(b) persists a CALL_CONTACT at the right UTC instant, in the contact’s timezone', async () => {
    const turn = await runTurn();

    const actions = await harness.db.futureActions.listByContact(harness.world.contact.id);
    expect(actions).toHaveLength(1);
    const action = actions[0]!;

    expect(action.type).toBe('CALL_CONTACT');
    expect(action.status).toBe('PENDING');
    // 15:00 EST on 2026-03-05 is 20:00 UTC. Written out by hand rather than
    // computed, so this asserts an instant a person checked.
    expect(action.scheduledForUtc).toBe(TOMORROW_AFTERNOON_AT_3_UTC);
    expect(action.timezone).toBe('America/New_York');
    expect(action.conversationId).toBe(conversation.id);
    expect(action.organizationId).toBe(harness.world.organization.id);

    // NOT NULL by schema, and genuinely populated.
    expect(action.validationProvenanceJson.length).toBeGreaterThan(0);
    const provenance = parseValidationProvenance(action.validationProvenanceJson);
    expect(provenance.rawProposedValue).toBe('tomorrow afternoon at 3');
    expect(provenance.checks.length).toBeGreaterThan(0);
    expect(provenance.nowUtc).toBe(SLICE_NOW_UTC);

    // Self-sufficient: a runner months from now needs no conversation context.
    const payload = parseCallContactPayload(action.payloadJson);
    expect(payload.toE164).toBe(harness.world.contact.primaryPhoneE164);
    expect(payload.correlationId).toBe(turn.correlationId);
    expect(payload.scheduledForLocal).toBe('2026-03-05T15:00');
  });

  it('(c) is fully readable from a freshly constructed client against the same file', async () => {
    const turn = await runTurn();

    // Everything above was written through one Prisma client. Throw it away and
    // read with a brand new one against the same database file. Nothing that
    // matters is allowed to live in a process.
    const reopened = harness.testDb.openAnotherClient();

    const contact = await reopened.contacts.requireById(harness.world.contact.id);
    expect(contact.timezone).toBe('America/New_York');

    const rebuilt = await reopened.conversations.requireByIdWithTurns(conversation.id);
    expect(rebuilt.agentConfigurationId).toBe(harness.world.agentConfiguration.id);
    expect(rebuilt.turns.length).toBeGreaterThanOrEqual(5);
    expect(rebuilt.turns.map((t) => t.index)).toEqual(rebuilt.turns.map((_, index) => index));

    expect(rebuilt.turns[0]?.role).toBe('CONTACT');
    expect(rebuilt.turns[0]?.text).toBe(THE_UTTERANCE);
    expect(rebuilt.turns.map((t) => t.role)).toContain('TOOL');

    // The tool-call turn kept the model's arguments byte-for-byte.
    const toolCallTurn = rebuilt.turns.find((t) => t.role === 'AGENT' && t.toolName === 'schedule_followup');
    expect(toolCallTurn?.toolCallId).toBe('call_followup_1');
    expect(toolCallTurn?.rawPayloadJson).toContain('tomorrow afternoon at 3');

    const actions = await reopened.futureActions.listByContact(contact.id);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.scheduledForUtc).toBe(TOMORROW_AFTERNOON_AT_3_UTC);

    const chain = await reopened.audit.listByCorrelationId(turn.correlationId);
    expect(chain.length).toBeGreaterThan(0);
  });

  it('(d) records the required audit events, in order, on one correlationId', async () => {
    const turn = await runTurn();

    const chain = await harness.db.audit.listByCorrelationId(turn.correlationId);
    const types = chain.map((event) => event.type);

    const positions = positionsInOrder(types, [
      'UTTERANCE_RECEIVED',
      'AGENT_DECISION',
      'TOOL_CALL_REQUESTED',
      'TOOL_CALL_VALIDATED',
      'ENTITY_PERSISTED',
      'FUTURE_ACTION_SCHEDULED',
    ]);
    expect(positions, `audit chain was: ${types.join(' -> ')}`).not.toBeNull();

    // Sequence numbers are 1..n with no gaps, so "in order" is a property of
    // the stored chain and not of how this test happened to read it.
    expect(chain.map((event) => event.sequence)).toEqual(chain.map((_, index) => index + 1));

    // Every event belongs to this turn, this conversation and this contact.
    expect(new Set(chain.map((event) => event.correlationId))).toEqual(new Set([turn.correlationId]));
    expect(new Set(chain.map((event) => event.contactId))).toEqual(new Set([harness.world.contact.id]));
    expect(new Set(chain.map((event) => event.conversationId))).toEqual(new Set([conversation.id]));
  });

  it('(e) records a chain sufficient to reconstruct the whole decision', async () => {
    const turn = await runTurn();

    const chain = await harness.db.audit.listByCorrelationId(turn.correlationId);
    const summary = summarizeChain(chain);

    // What was said.
    expect(summary.whatWasSaid).toContain(THE_UTTERANCE);

    // What was decided - the model's intent, recorded before any of it was
    // allowed to happen.
    expect(summary.whatWasDecided.join(' ')).toContain('schedule_followup');

    // What tool was called, with the arguments EXACTLY as the model produced
    // them, including the natural-language time.
    expect(summary.whatToolsWereCalled).toHaveLength(1);
    expect(summary.whatToolsWereCalled[0]?.tool).toBe('schedule_followup');
    expect(summary.whatToolsWereCalled[0]?.rawArgumentsJson).toContain('tomorrow afternoon at 3');

    // What was validated: the named checks and the `now` they ran against, so
    // the decision can be re-run by hand and reach the same answer.
    expect(summary.whatWasValidated.length).toBeGreaterThan(0);
    expect(summary.whatWasValidated[0]?.nowUtc).toBe(SLICE_NOW_UTC);
    expect(summary.whatWasValidated[0]?.checks.join(' ')).toContain('business_hours: pass');

    // What was persisted.
    expect(summary.whatWasPersisted.map((row) => row.subjectType)).toContain('FUTURE_ACTION');

    // Nothing was refused on the happy path.
    expect(summary.whatWasRefused).toEqual([]);

    // And the evidence is genuinely IN the events, not merely summarised: an
    // auditor reading the raw row can see the proposal and the resolved instant.
    const validated = chain.find((event) => event.type === 'TOOL_CALL_VALIDATED');
    expect(validated?.detailJson).toContain('tomorrow afternoon at 3');
    expect(validated?.detailJson).toContain(TOMORROW_AFTERNOON_AT_3_UTC);
  });

  it('keeps the promise: one runner pass dispatches the call through the telephony port', async () => {
    const turn = await runTurn();
    const action = (await harness.db.futureActions.listByContact(harness.world.contact.id))[0]!;

    // Before the promised time nothing is due, and nothing is dialled.
    const early = await harness.runtime.dueActions.runDueActions();
    expect(early.claimed).toBe(0);
    expect(harness.telephony.placedCalls).toHaveLength(0);

    // Move past it. The runner has never seen an LLM context window: it reads
    // the row, and the row is enough.
    harness.clock.setTo(new Date(Date.parse(action.scheduledForUtc) + 60_000).toISOString());
    const pass = await harness.runtime.dueActions.runDueActions();

    expect(pass.claimed).toBe(1);
    expect(pass.executed).toBe(1);
    expect(pass.failed).toBe(0);

    expect(harness.telephony.placedCalls).toHaveLength(1);
    const dispatched = harness.telephony.placedCalls[0]!;
    expect(dispatched.request.toE164).toBe(harness.world.contact.primaryPhoneE164);
    expect(dispatched.status).toBe('COMPLETED');
    // The thread an auditor pulls: the call carries the correlation id of the
    // turn in which the promise was made.
    expect(dispatched.request.correlationId).toBe(turn.correlationId);

    const settled = await harness.db.futureActions.requireById(action.id);
    expect(settled.status).toBe('DONE');
    expect(settled.completedAt).not.toBeNull();

    // "Did we actually phone them?" has an answer in the database, not only in
    // the provider double.
    const calls = await harness.db.calls.listByContact(harness.world.contact.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.status).toBe('COMPLETED');

    // The runner's events joined the SAME chain as the agent turn.
    const types = (await harness.db.audit.listByCorrelationId(turn.correlationId)).map((event) => event.type);
    expect(
      positionsInOrder(types, ['FUTURE_ACTION_SCHEDULED', 'FUTURE_ACTION_CLAIMED', 'FUTURE_ACTION_EXECUTED']),
    ).not.toBeNull();
  });

  it('promises one callback, not two, when the same turn is retried', async () => {
    const first = await runTurn();
    harness.llm.setScript(followupScript(harness.world.contact.id));
    const second = await runTurn();

    expect(first.correlationId).not.toBe(second.correlationId);

    // Same conversation, same agreed instant -> the derived idempotency key
    // matches, so the second attempt returns the existing row rather than
    // promising one person two phone calls.
    const actions = await harness.db.futureActions.listByContact(harness.world.contact.id);
    expect(actions).toHaveLength(1);

    const outcome = second.toolOutcomes[0];
    expect(outcome?.ok).toBe(true);
    if (outcome?.ok) expect(outcome.data['already_existed']).toBe(true);
  });

  it('gives the model the guardrailed prompt and only the permitted tool schemas', async () => {
    await runTurn();

    const prompt = harness.llm.lastSystemPrompt() ?? '';
    // The guardrails are actually in front of the model, not merely in a file.
    expect(prompt).toContain('Never invent availability');
    expect(prompt).toContain('You propose times; you never decide them');
    expect(prompt).toContain('Nothing is booked until a tool says it is');

    // No per-contact PII leaked into the versioned prompt.
    expect(prompt).not.toContain(harness.world.contact.primaryPhoneE164);
    expect(prompt).not.toContain(harness.world.contact.fullName);

    // All nine tools were offered, each with a real JSON Schema.
    const offered = harness.llm.completions[0]?.request.tools ?? [];
    expect(offered).toHaveLength(9);
    const followup = offered.find((tool) => tool.name === 'schedule_followup');
    const schema = followup?.parametersJsonSchema as Record<string, unknown>;
    expect(schema['type']).toBe('object');
    expect(schema['required']).toEqual(['contact_id', 'when']);
    expect(schema['additionalProperties']).toBe(false);
  });
});
