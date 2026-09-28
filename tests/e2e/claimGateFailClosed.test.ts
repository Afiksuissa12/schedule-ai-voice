/**
 * FAIL-CLOSED, THROUGH THE REAL FRONT DOOR - Mission 2F.
 *
 * WHAT IS BEING PROVED HERE THAT IS NOT PROVED ANYWHERE ELSE
 * ---------------------------------------------------------------------------
 * `tests/agent/claimGateSemanticPipeline.test.ts` proves every fail-closed variant
 * blocks at `ClaimGate.review`, with a hand-written ledger and no database. That is
 * the right place for it and it is not this claim.
 *
 * This file asks the question that a unit test structurally cannot: **on the real
 * path - `buildAgentRuntime`, the real `AgentTurnService`, the real
 * `ToolDispatcher`, real SQLite - does a verifier that malfunctions keep a sentence
 * away from a caller AND out of the durable transcript AND leave the database
 * alone?** Four things have to be true at once, and each of them lives in a
 * different module:
 *
 *  1. NOTHING REACHES THE CALLER. `handleTurn` returns no text.
 *  2. NOTHING IS PERSISTED. No spoken `AGENT` `ConversationTurn` row carries it,
 *     which is the half independent QA has rated highest every round: a sentence
 *     returned to a caller is a lie told once, and a sentence in
 *     `ConversationTurn` is a lie the next turn reads back as fact.
 *  3. NO DOMAIN ROW IS WRITTEN. In particular the gate never creates the effect
 *     that was falsely claimed - § 9.1 - and a verifier cannot create one either,
 *     because nothing it is handed can.
 *  4. AT THE BOUND, THE EXISTING NON-CANNED AUDITED HAND-OFF. Not a canned
 *     correction, not an apology, not a substituted sentence: the bounded
 *     regeneration this repository already had, and then silence plus one `Task`.
 *
 * AND THE NEGATIVE THAT MATTERS MOST: NO CANNED CUSTOMER-FACING WORDING ON ANY OF
 * THESE PATHS. Asserted structurally rather than by reading the source - every
 * string that ends up anywhere a customer could hear or a later turn could read
 * back is required to be a string the MODEL produced. A gate that could synthesise
 * a correction would be a canned-dialogue mechanism wearing a safety jacket, which
 * `docs/DECISIONS.md` § 0 forbids outright.
 *
 * WHY THE SCENARIOS DISPATCH NO TOOL
 * ---------------------------------------------------------------------------
 * The same reason spec `r08` in the sweep does not (§ 2.3 of the assurance
 * document): with no tool call the turn breaks before anything could legitimately
 * write a row, so "zero domain rows" is a CLEAN measurement of the gate rather
 * than a statement about what the dispatcher happened to allow. A turn whose tool
 * call succeeded would write a `Meeting` legitimately, and then the interesting
 * number would be buried in an argument about which row belonged to whom.
 *
 * NO MODEL IS CALLED. Every verdict comes from `ScriptedSemanticClaimVerifier` and
 * `RuleDrivenSemanticClaimVerifier`, the deterministic doubles in
 * `src/agent/claimGate/semantic/doubles.ts`, handed to the REAL composition root
 * through its documented `claimVerifier` seam. No `eval:*`, no `llm:probe`, no
 * network call to any model host. No timers: a TIMED_OUT verdict is a value.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { MAX_CLAIM_GATE_REGENERATION_ATTEMPTS } from '../../src/agent/claimGate/claimGate.js';
import {
  RuleDrivenSemanticClaimVerifier,
  ScriptedSemanticClaimVerifier,
  classifiedWithNoClaims,
} from '../../src/agent/claimGate/semantic/doubles.js';
import { summarizeChain } from '../../src/app/auditReport.js';
import {
  SEMANTIC_CLAIM_FAILURE_KINDS,
  type SemanticClaimVerdict,
  type SemanticClaimVerifier,
} from '../../src/ports/claimVerifier.js';
import { createSliceHarness, type SliceHarness } from './support.js';

const harnesses: SliceHarness[] = [];

afterEach(async () => {
  while (harnesses.length > 0) await harnesses.pop()?.cleanup();
});

/**
 * A sentence that asserts NOTHING material, and that is the whole point of it.
 *
 * Before Mission 2F this text was released on attempt 1 with no database read at
 * all. With the second layer unusable it must be withheld - which is what makes it
 * the sharpest available fail-closed fixture: no deterministic claim, no ledger
 * problem, nothing wrong with the sentence. The ONLY reason it cannot go out is
 * that the check the Founder ordered did not happen, and a check that did not
 * happen is not a check that passed.
 */
const ASSERTS_NOTHING = 'What time would suit you?';

/**
 * A sentence that DOES assert something the records cannot support.
 *
 * The § 21 class A wording, verbatim from the finding. Used for the cases where
 * the interesting question is "and the deterministic layer's own finding is still
 * reported beside the fail-closed one", which needs there to be one.
 */
const FALSE_CLAIM = "Your meeting's booked for Thursday at 2pm.";

/**
 * A sentence the REAL deterministic detector finds nothing in, measured in
 * `tests/claimGate/layeredClaimCorpus.test.ts` rather than assumed here.
 *
 * `It is in the diary` is a declared completion idiom and `It is on the calendar`
 * is not - two ordinary spellings of one idiom, one of them listed. It is the
 * cross-layer case driven end to end: a claim ONLY the semantic layer sees.
 */
const SEMANTIC_ONLY_CLAIM = 'It is on the calendar for Thursday at 2pm.';

interface Ran {
  readonly harness: SliceHarness;
  readonly conversationId: string;
  readonly turn: Awaited<ReturnType<SliceHarness['runtime']['agent']['handleTurn']>>;
}

/**
 * One turn, through the real runtime, with a chosen verifier.
 *
 * `onExhausted: 'repeat-last'` is the model that argues forever - the same double
 * this repository already uses to prove the turn loop is bounded, and the shape of
 * the § 6.5.4 transcript where the recommended model repeated its assertion when
 * pushed a second time. Pointed at one sentence it produces that sentence on every
 * attempt, so the gate's bound is the only thing that stops the turn.
 */
async function runTurn(
  label: string,
  text: string,
  verifier: SemanticClaimVerifier,
  options: { readonly hebrew?: boolean } = {},
): Promise<Ran> {
  const harness = await createSliceHarness({
    label,
    claimVerifier: verifier,
    llm: { script: [{ assistantText: text }], onExhausted: 'repeat-last' },
    ...(options.hebrew ? { world: { contactTimezone: 'Asia/Jerusalem' } } : {}),
  });
  harnesses.push(harness);
  const conversation = await harness.startConversation();
  const turn = await harness.runtime.agent.handleTurn({
    conversationId: conversation.id,
    utterance: options.hebrew ? 'תודה שסידרת את זה.' : 'Thanks for sorting that out.',
  });
  return { harness, conversationId: conversation.id, turn };
}

/** Every SPOKEN agent turn actually persisted. `toolName === null` is what makes it spoken. */
async function spokenAgentText(ran: Ran): Promise<string[]> {
  const rows = await ran.harness.db.conversationTurns.listByConversation(ran.conversationId);
  return rows.filter((row) => row.role === 'AGENT' && row.toolName === null).map((row) => row.text ?? '');
}

/** A verifier stuck on one failure for the whole turn, which is what an outage is. */
function alwaysFails(kind: (typeof SEMANTIC_CLAIM_FAILURE_KINDS)[number]): ScriptedSemanticClaimVerifier {
  return new ScriptedSemanticClaimVerifier({
    onExhausted: { kind, reason: `${kind}: injected by tests/e2e/claimGateFailClosed.test.ts` } as SemanticClaimVerdict,
    name: `failing-${kind.toLowerCase()}-double`,
  });
}

// ---------------------------------------------------------------------------
// 1. EVERY FAIL-CLOSED VARIANT, END TO END
// ---------------------------------------------------------------------------

describe('a verifier that malfunctions keeps the turn away from the caller and out of the database', () => {
  for (const kind of SEMANTIC_CLAIM_FAILURE_KINDS) {
    describe(`${kind}`, () => {
      it('releases nothing, and the sentence asserted nothing to begin with', async () => {
        // THE LOAD-BEARING CASE. A sentence with no claim in it, which the pre-2F
        // gate released on attempt 1 with no state read. It must not go out now.
        const ran = await runTurn(`fc-${kind}-nothing`, ASSERTS_NOTHING, alwaysFails(kind));

        expect(ran.turn.assistantText).toBeNull();
        expect(ran.turn.assistantMessages).toEqual([]);
        expect(ran.turn.stopReason).toBe('CLAIM_GATE_WITHHELD');
        expect(ran.turn.claimGate.releases[0]?.outcome).toBe('WITHHELD_HANDED_OFF');
        expect(ran.turn.claimGate.releases[0]?.releasedText).toBeNull();
      });

      it('reports the failure by NAME, not as a generic rejection', async () => {
        const ran = await runTurn(`fc-${kind}-reason`, ASSERTS_NOTHING, alwaysFails(kind));
        const attempt = ran.turn.claimGate.releases[0]?.attempts[0];

        expect(attempt?.layers.semanticOutcome).toBe(kind);
        expect(attempt?.layers.failClosed).toBe(true);
        expect(attempt?.unsupportedClaims.map((entry) => entry.reason)).toContain('SEMANTIC_CHECK_UNAVAILABLE');
        // The variant is carried on the claim's own detail, so an operator asking
        // "why did last night hand off four hundred turns" can tell a dead
        // provider from a model emitting prose from a host under load.
        const semantic = attempt?.unsupportedClaims.find(
          (entry) => entry.reason === 'SEMANTIC_CHECK_UNAVAILABLE',
        );
        expect(semantic?.detail.semanticLayer?.outcome).toBe(kind);
        expect(semantic?.detail.semanticLayer?.reason).toContain(kind);
      });

      it('triggers the EXISTING bounded regeneration, and stops at the constant in code', async () => {
        const ran = await runTurn(`fc-${kind}-bound`, ASSERTS_NOTHING, alwaysFails(kind));
        const release = ran.turn.claimGate.releases[0];

        expect(release?.attempts).toHaveLength(1 + MAX_CLAIM_GATE_REGENERATION_ATTEMPTS);
        expect(release?.attempts.map((attempt) => attempt.attempt)).toEqual([1, 2, 3]);
        // One original provider call plus exactly two regenerations. The bound is
        // a number in application code, not an instruction in a prompt.
        expect(ran.harness.llm.callCount).toBe(1 + MAX_CLAIM_GATE_REGENERATION_ATTEMPTS);
        expect(ran.harness.runtime.claimGate.regenerationBound).toBe(MAX_CLAIM_GATE_REGENERATION_ATTEMPTS);
        // And not one regeneration was offered a tool, so no attempt at rewriting
        // the turn could cause an effect even by accident.
        expect(ran.harness.llm.completions.slice(1).map((entry) => entry.request.tools)).toEqual([[], []]);
      });

      it('never persists a spoken AGENT turn carrying the text', async () => {
        const ran = await runTurn(`fc-${kind}-persist`, FALSE_CLAIM, alwaysFails(kind));

        expect(await spokenAgentText(ran)).toEqual([]);
        const rows = await ran.harness.db.conversationTurns.listByConversation(ran.conversationId);
        expect(
          rows.map((row) => row.text ?? '').join(' '),
          'the withheld sentence must appear NOWHERE in the durable transcript, because the next turn reads ' +
            'the transcript back as fact',
        ).not.toContain(FALSE_CLAIM);
      });

      it('writes ZERO domain rows, and the one row it does write is the request for a person', async () => {
        const ran = await runTurn(`fc-${kind}-rows`, FALSE_CLAIM, alwaysFails(kind));
        const counts = await ran.harness.countDomainRows();

        expect({
          meetings: counts.meetings,
          futureActions: counts.futureActions,
          qualificationStates: counts.qualificationStates,
          calls: counts.calls,
          callOutcomes: counts.callOutcomes,
        }).toEqual({ meetings: 0, futureActions: 0, qualificationStates: 0, calls: 0, callOutcomes: 0 });
        expect(counts.tasks, 'exactly one Task: § 9.1, the only row the gate itself writes').toBe(1);
      });

      it('takes the EXISTING non-canned audited hand-off at the bound', async () => {
        const ran = await runTurn(`fc-${kind}-handoff`, FALSE_CLAIM, alwaysFails(kind));
        const chain = await ran.harness.db.audit.listByCorrelationId(ran.turn.correlationId);
        const types = chain.map((event) => event.type);

        // The chain this repository already had, unchanged in shape.
        expect(types.filter((type) => type === 'CLAIM_GATE_CLAIM_REJECTED')).toHaveLength(3);
        expect(types.filter((type) => type === 'CLAIM_GATE_REGENERATION_REQUESTED')).toHaveLength(2);
        expect(types.filter((type) => type === 'CLAIM_GATE_TEXT_WITHHELD')).toHaveLength(1);
        expect(types).toContain('HUMAN_TRANSFER_REQUESTED');
        expect(types).not.toContain('CLAIM_GATE_CLAIM_VERIFIED');
        // The handover FOLLOWS the withholding.
        expect(types.indexOf('CLAIM_GATE_TEXT_WITHHELD')).toBeLessThan(types.indexOf('HUMAN_TRANSFER_REQUESTED'));
        // And it is attributed to the gate, not to a tool call the model never made.
        const transfer = chain.find((event) => event.type === 'HUMAN_TRANSFER_REQUESTED');
        expect(transfer?.toolCallId).toBeNull();
        expect(JSON.parse(transfer?.detailJson ?? '{}')).toMatchObject({ requestedBy: 'CLAIM_GATE' });

        // Everything on ONE correlation id, so the turn is explainable from the
        // chain alone without anybody reading the code.
        expect(chain.every((event) => event.correlationId === ran.turn.correlationId)).toBe(true);

        const summary = summarizeChain(chain);
        expect(summary.whatWasSayable.map((entry) => entry.decision)).toEqual([
          'REJECTED',
          'REGENERATION_REQUESTED',
          'REJECTED',
          'REGENERATION_REQUESTED',
          'REJECTED',
          'WITHHELD',
        ]);
        expect(summary.whatWasSayable.at(-1)?.outcome).toBe('WITHHELD_HANDED_OFF');
      });

      it('records the verifier being ASKED and FAILING, on the same chain, in order', async () => {
        const ran = await runTurn(`fc-${kind}-audit`, ASSERTS_NOTHING, alwaysFails(kind));
        const chain = await ran.harness.db.audit.listByCorrelationId(ran.turn.correlationId);
        const types = chain.map((event) => event.type);

        // Three attempts, so three requests and three failures.
        expect(types.filter((type) => type === 'CLAIM_GATE_SEMANTIC_REQUESTED')).toHaveLength(3);
        expect(types.filter((type) => type === 'CLAIM_GATE_SEMANTIC_FAILED')).toHaveLength(3);
        // And never the success event, because nothing was classified.
        expect(types).not.toContain('CLAIM_GATE_SEMANTIC_CLASSIFIED');
        // The request precedes the failure, which is what makes "in order" mean
        // something - `AuditEvent.@@unique([correlationId, sequence])` is the
        // mechanism behind it.
        expect(types.indexOf('CLAIM_GATE_SEMANTIC_REQUESTED')).toBeLessThan(
          types.indexOf('CLAIM_GATE_SEMANTIC_FAILED'),
        );

        // The failure event names the consequence, because this is the line an
        // operator reads during an outage.
        const failed = chain.find((event) => event.type === 'CLAIM_GATE_SEMANTIC_FAILED');
        const detail = JSON.parse(failed?.detailJson ?? '{}') as Record<string, unknown>;
        expect(detail.outcome).toBe(kind);
        expect(String(detail.consequence)).toContain('withheld');
        expect(String(detail.verifier)).toBe(`failing-${kind.toLowerCase()}-double`);
      });

      it('and emits NO canned customer-facing wording anywhere on the path', async () => {
        const ran = await runTurn(`fc-${kind}-canned`, FALSE_CLAIM, alwaysFails(kind));

        // 1. the caller got nothing at all, so there is nothing canned to hear.
        expect(ran.turn.assistantText).toBeNull();
        expect(ran.turn.assistantMessages).toEqual([]);

        // 2. no spoken AGENT row exists, so nothing canned was persisted as speech.
        expect(await spokenAgentText(ran)).toEqual([]);

        // 3. the ONE durable note is a SYSTEM row, written for a reader of the
        //    transcript rather than for a caller, and it says what happened rather
        //    than apologising on the agent's behalf.
        const rows = await ran.harness.db.conversationTurns.listByConversation(ran.conversationId);
        const notes = rows.filter((row) => row.role === 'SYSTEM');
        expect(notes).toHaveLength(1);
        expect(notes[0]?.text).toContain('claim gate withheld');

        // 4. the handover Task is written in REASON CODES, not in a sentence
        //    anybody reads out. This is the field an operator acts on.
        const tasks = await ran.harness.db.tasks.listByContact(ran.harness.world.contact.id);
        expect(tasks[0]?.title).toContain('Claim gate handover');
        expect(tasks[0]?.description).toContain('SEMANTIC_CHECK_UNAVAILABLE');
        expect(tasks[0]?.status).toBe('OPEN');

        // 5. AND THE STRUCTURAL FORM OF THE SAME CLAIM: every attempt the gate
        //    recorded is a string the MODEL produced. If the gate had substituted
        //    wording of its own, an attempt would carry a sentence the script
        //    never contained.
        const attempts = ran.turn.claimGate.releases[0]?.attempts ?? [];
        expect(attempts.length).toBeGreaterThan(0);
        for (const attempt of attempts) {
          expect(
            attempt.text,
            'the gate recorded an attempt carrying a sentence the model never produced, which means it wrote ' +
              'customer-facing wording of its own',
          ).toBe(FALSE_CLAIM);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 2. THE VERIFIER RECOVERS: THE MODEL'S OWN WORDS, NOT A CORRECTION
// ---------------------------------------------------------------------------

describe('when the verifier comes back, the turn is saved by the MODEL and not by the gate', () => {
  // Without this block the file above would be satisfied by a gate that withheld
  // unconditionally. The regeneration is a real provider call and the released
  // text has to be something the model said.
  const HONEST_SECOND = 'Nothing is arranged yet. What time would suit you?';

  it('releases the model\'s second sentence, byte-identical, once the verifier answers', async () => {
    const verifier = new ScriptedSemanticClaimVerifier({
      // Attempt 1: the provider is down. Attempt 2: it answers, and finds nothing
      // in an honest sentence.
      script: [{ kind: 'UNAVAILABLE', reason: 'the provider was down for attempt 1' }],
      onExhausted: classifiedWithNoClaims('recovered-test-model'),
    });
    const harness = await createSliceHarness({
      label: 'fc-recovers',
      claimVerifier: verifier,
      llm: { script: [{ assistantText: ASSERTS_NOTHING }, { assistantText: HONEST_SECOND }] },
    });
    harnesses.push(harness);
    const conversation = await harness.startConversation();
    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Thanks for sorting that out.',
    });

    expect(turn.claimGate.releases[0]?.outcome).toBe('CORRECTED_AFTER_REGENERATION');
    expect(turn.assistantText).toBe(HONEST_SECOND);
    expect(turn.assistantMessages).toEqual([HONEST_SECOND]);
    // BYTE-IDENTICAL: the released text is exactly what the model produced, not a
    // tidied version of it.
    expect(harness.llm.completions[1]?.result.assistantText).toBe(HONEST_SECOND);
    // Exactly two provider calls: the original and one regeneration. The gate did
    // not keep going after it had something releasable.
    expect(harness.llm.callCount).toBe(2);

    // And it IS persisted, because it was allowed out.
    const rows = await harness.db.conversationTurns.listByConversation(conversation.id);
    expect(rows.filter((row) => row.role === 'AGENT' && row.toolName === null).map((row) => row.text)).toEqual([
      HONEST_SECOND,
    ]);
  });

  it('and the regeneration instruction carries no customer-facing sentence', async () => {
    // The instruction is system-side state, handed back to the same model so it
    // can write its own words again. If it contained a sentence to echo, the
    // "regenerated naturally" property would be a canned correction with extra
    // steps.
    const verifier = new ScriptedSemanticClaimVerifier({
      script: [{ kind: 'MALFORMED', reason: 'the model emitted prose instead of JSON' }],
      onExhausted: classifiedWithNoClaims(),
    });
    const harness = await createSliceHarness({
      label: 'fc-instruction',
      claimVerifier: verifier,
      llm: { script: [{ assistantText: FALSE_CLAIM }, { assistantText: HONEST_SECOND }] },
    });
    harnesses.push(harness);
    const conversation = await harness.startConversation();
    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Thanks for sorting that out.',
    });

    const chain = await harness.db.audit.listByCorrelationId(turn.correlationId);
    const requested = chain.find((event) => event.type === 'CLAIM_GATE_REGENERATION_REQUESTED');
    const instruction = String(
      (JSON.parse(requested?.detailJson ?? '{}') as { instruction?: unknown }).instruction ?? '',
    );

    expect(instruction.length, 'there must BE an instruction, or this assertion is vacuous').toBeGreaterThan(20);

    // It names the failure VARIANT, so the model is told what did not happen
    // rather than told a reason code it has no use for. Model-facing instructions
    // are permitted; customer-facing wording is not.
    expect(instruction).toContain('MALFORMED');
    expect(instruction).toContain('did not complete');

    // AND IT DOES NOT TELL THE MODEL IT ASSERTED SOMETHING IT MAY NOT HAVE. This
    // is the honest half: a fail-closed layer means nothing COULD BE CONFIRMED, not
    // that something was found to be false. Getting this wrong would have the gate
    // arguing with the model about a sentence nobody classified.
    expect(instruction).toContain('could be confirmed');
    expect(instruction).toContain('none of it may stand');

    // And it must not hand the model the sentence under review to echo back.
    expect(
      instruction,
      'the instruction handed the model the exact sentence the gate just refused, which invites it to be ' +
        'repeated. § 5 of the gate document is explicit that there is nothing to echo.',
    ).not.toContain(FALSE_CLAIM);

    // It also has to say plainly that nothing in it is wording to reuse, which is
    // what separates a state instruction from a canned correction.
    expect(instruction).toContain('nothing here is wording to reuse');
    expect(turn.claimGate.releases[0]?.outcome).toBe('CORRECTED_AFTER_REGENERATION');
  });
});

// ---------------------------------------------------------------------------
// 3. THE CROSS-LAYER CASE, END TO END
// ---------------------------------------------------------------------------

describe('a claim only the SEMANTIC layer sees is blocked on the real path too', () => {
  // Cross-layer proof (a), driven through the real service rather than through
  // `ClaimGate.review`. The premise - that the real detector is blind to this
  // wording - is asserted in `tests/claimGate/layeredClaimCorpus.test.ts`, which
  // fails loudly if it stops being true.

  /**
   * A rule-driven double that recognises this one wording.
   *
   * `RuleDrivenSemanticClaimVerifier` rather than the scripted one, because the
   * question here is what happens when a verifier READS a text and finds
   * something - so the double should answer from the text rather than from a
   * queue. The needle is a fragment, not a sentence: it exists to be recognised,
   * exactly as `ScriptedLlmProvider`'s adversarial catalogue does one layer down.
   */
  function seesTheCalendarIdiom(): RuleDrivenSemanticClaimVerifier {
    return new RuleDrivenSemanticClaimVerifier({
      name: 'sees-the-calendar-idiom',
      rules: [
        {
          needle: 'on the calendar',
          effectFamily: 'MEETING',
          status: 'COMPLETED',
          // QUOTED VERBATIM from the text, which the port requires and
          // `schema.ts` enforces. The double drops an ungrounded quote rather
          // than emitting one, so this is a substring or it contributes nothing.
          whenPhrase: 'Thursday at 2pm',
        },
      ],
    });
  }

  it('the pre-2F pipeline releases it and persists it, which is the premise', async () => {
    // The SAME runtime with the SAME text and a verifier that adds nothing - which
    // is what the offline composition wires everywhere and what the absence of
    // this layer looks like. The sentence goes out and is written down.
    const ran = await runTurn('fc-cross-pre', SEMANTIC_ONLY_CLAIM, new RuleDrivenSemanticClaimVerifier());

    expect(ran.turn.assistantText).toBe(SEMANTIC_ONLY_CLAIM);
    expect(await spokenAgentText(ran)).toEqual([SEMANTIC_ONLY_CLAIM]);
    expect(ran.turn.claimGate.releases[0]?.outcome).toBe('NO_MATERIAL_CLAIM');
    // And nothing exists behind it.
    const counts = await ran.harness.countDomainRows();
    expect({ meetings: counts.meetings, futureActions: counts.futureActions }).toEqual({
      meetings: 0,
      futureActions: 0,
    });
  });

  it('and with the semantic layer seeing it, nothing reaches the caller or the transcript', async () => {
    const ran = await runTurn('fc-cross-post', SEMANTIC_ONLY_CLAIM, seesTheCalendarIdiom());

    expect(ran.turn.assistantText).toBeNull();
    expect(ran.turn.assistantMessages).toEqual([]);
    expect(ran.turn.stopReason).toBe('CLAIM_GATE_WITHHELD');
    expect(await spokenAgentText(ran)).toEqual([]);

    const attempt = ran.turn.claimGate.releases[0]?.attempts[0];
    expect(attempt?.layers.deterministicClaimCount, 'the detector really saw nothing').toBe(0);
    expect(attempt?.layers.semanticClaimCount, 'and the semantic layer really saw one').toBe(1);
    expect(attempt?.layers.sources).toEqual(['SEMANTIC']);
    // BLOCKED BY THE EXISTING RECONCILIATION, NAMING AN EXISTING REASON. The
    // semantic layer classified; the ledger decided. `NO_MATCHING_EFFECT` and not
    // `UNREADABLE_WHEN` because the ledger here is EMPTY - there is no MEETING
    // effect of any kind, so the family check answers first and the quoted
    // when-phrase is never reached. That ordering is `verifyClaims`'s and this
    // mission did not change it.
    expect(attempt?.unsupportedClaims.map((entry) => entry.reason)).toEqual(['NO_MATCHING_EFFECT']);
    // And the reason is one of the SEVEN LEDGER reasons, not a verdict this layer
    // invented: the semantic-only claim was routed into the same branch of
    // `verifyClaims` a deterministic claim would have been.
    const detail = attempt?.unsupportedClaims[0]?.detail;
    expect(detail?.family).toBe('MEETING');
    expect(detail?.expectedEffectKinds).toContain('MEETING_SCHEDULED');

    const counts = await ran.harness.countDomainRows();
    expect({ meetings: counts.meetings, futureActions: counts.futureActions }).toEqual({
      meetings: 0,
      futureActions: 0,
    });
    expect(counts.tasks).toBe(1);
  });

  it('and the audit trail says WHICH LAYER caught it, per claim', async () => {
    // The field the mission's premise is checked against: a claim tagged SEMANTIC
    // is a claim that would have leaked before.
    const ran = await runTurn('fc-cross-audit', SEMANTIC_ONLY_CLAIM, seesTheCalendarIdiom());
    const chain = await ran.harness.db.audit.listByCorrelationId(ran.turn.correlationId);

    const layered = chain.filter((event) => event.type === 'CLAIM_GATE_CLAIM_LAYERED');
    expect(layered.length).toBe(1 + MAX_CLAIM_GATE_REGENERATION_ATTEMPTS);
    const detail = JSON.parse(layered[0]?.detailJson ?? '{}') as {
      claims?: readonly { source?: string; family?: string; locale?: string }[];
      layers?: { deterministicClaimCount?: number; semanticClaimCount?: number };
    };
    expect(detail.claims?.map((claim) => claim.source)).toEqual(['SEMANTIC']);
    expect(detail.claims?.[0]?.family).toBe('MEETING');
    // The locale is `semantic` rather than `en` or `he`, because no lexicon fired
    // and writing one of those would make the audit claim a locale rule matched.
    expect(detail.claims?.[0]?.locale).toBe('semantic');
    expect(detail.layers?.deterministicClaimCount).toBe(0);
    expect(detail.layers?.semanticClaimCount).toBe(1);

    // And the classification event carries the structured output verbatim.
    const classified = chain.find((event) => event.type === 'CLAIM_GATE_SEMANTIC_CLASSIFIED');
    expect(classified).toBeDefined();
    const classifiedDetail = JSON.parse(classified?.detailJson ?? '{}') as {
      claims?: readonly { whenPhrase?: string | null }[];
    };
    expect(classifiedDetail.claims?.[0]?.whenPhrase).toBe('Thursday at 2pm');
  });
});

// ---------------------------------------------------------------------------
// 4. THE VERIFIER CANNOT APPROVE, EXECUTE OR CREATE ANYTHING
// ---------------------------------------------------------------------------

describe('nothing on the real path lets the verifier approve, execute or create anything', () => {
  it('a verifier that says a FLAGGED text is clean still cannot release it', async () => {
    // Cross-layer proof (b), on the real path. The corpus proves it over 900
    // sentences at the unit level; this proves the wiring does not undo it.
    const ran = await runTurn('fc-authority-clean', FALSE_CLAIM, new RuleDrivenSemanticClaimVerifier());

    expect(ran.turn.assistantText).toBeNull();
    expect(await spokenAgentText(ran)).toEqual([]);
    const attempt = ran.turn.claimGate.releases[0]?.attempts[0];
    expect(attempt?.layers.semanticOutcome).toBe('CLASSIFIED');
    expect(attempt?.layers.semanticClaimCount).toBe(0);
    expect(attempt?.layers.deterministicClaimCount).toBeGreaterThan(0);
    expect(attempt?.layers.sources).toContain('DETERMINISTIC');
    expect(attempt?.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it('and is handed the TEXT and the turn correlation id, and nothing else', async () => {
    // The request TYPE makes a ledger, a database and a dispatcher
    // unrepresentable. This asserts what was ACTUALLY sent on the real path, so an
    // auditor does not have to take the type's word - and it asserts the
    // correlation id is the TURN's, so the semantic events land on one chain.
    const verifier = new RuleDrivenSemanticClaimVerifier();
    const ran = await runTurn('fc-authority-request', FALSE_CLAIM, verifier);

    expect(verifier.requests.length).toBe(1 + MAX_CLAIM_GATE_REGENERATION_ATTEMPTS);
    for (const request of verifier.requests) {
      expect(Object.keys(request).sort()).toEqual(['correlationId', 'text']);
      expect(request.correlationId).toBe(ran.turn.correlationId);
      expect(request.text).toBe(FALSE_CLAIM);
    }
  });

  it('and a verifier that THROWS - which its contract forbids - blocks rather than aborting the turn', async () => {
    // An exception escaping into `ClaimGate.review` would abort the turn instead
    // of blocking the sentence, and a turn that threw is a turn nobody classified.
    class ThrowingVerifier implements SemanticClaimVerifier {
      readonly verifierName = 'throwing-double';
      async classify(): Promise<SemanticClaimVerdict> {
        throw new Error('the verifier broke its contract');
      }
    }
    const ran = await runTurn('fc-authority-throws', ASSERTS_NOTHING, new ThrowingVerifier());

    // The turn completed as a DECISION, not as an exception.
    expect(ran.turn.stopReason).toBe('CLAIM_GATE_WITHHELD');
    expect(ran.turn.assistantText).toBeNull();
    const attempt = ran.turn.claimGate.releases[0]?.attempts[0];
    expect(attempt?.layers.semanticOutcome).toBe('UNAVAILABLE');
    expect(attempt?.layers.failClosed).toBe(true);
    const counts = await ran.harness.countDomainRows();
    expect(counts.meetings + counts.futureActions + counts.calls).toBe(0);
  });

  it('and no verifier verdict can ever produce a domain row, for any variant', async () => {
    // The Founder rule as one measurement: "it must NEVER execute an action,
    // approve an action, create state, override validation." Four failures, a
    // wrongly-clean classification and a maximally confident one that claims
    // every family - none of them writes anything but the handover Task.
    const verdicts: readonly SemanticClaimVerdict[] = [
      ...SEMANTIC_CLAIM_FAILURE_KINDS.map(
        (kind) => ({ kind, reason: 'r' }) as SemanticClaimVerdict,
      ),
      classifiedWithNoClaims(),
      {
        kind: 'CLASSIFIED',
        claims: [
          {
            assertsEffect: true,
            effectFamily: 'MEETING',
            status: 'COMPLETED',
            whenPhrase: null,
            identifier: null,
            confidence: 1,
          },
        ],
        modelId: 'maximally-confident-double',
      },
    ];

    for (const [index, verdict] of verdicts.entries()) {
      const ran = await runTurn(
        `fc-authority-rows-${index}`,
        FALSE_CLAIM,
        new ScriptedSemanticClaimVerifier({ onExhausted: verdict }),
      );
      const counts = await ran.harness.countDomainRows();
      expect(
        {
          meetings: counts.meetings,
          futureActions: counts.futureActions,
          qualificationStates: counts.qualificationStates,
          calls: counts.calls,
          callOutcomes: counts.callOutcomes,
        },
        `verdict ${index} (${verdict.kind}) wrote a domain row`,
      ).toEqual({ meetings: 0, futureActions: 0, qualificationStates: 0, calls: 0, callOutcomes: 0 });
    }
  });
});

// ---------------------------------------------------------------------------
// 5. THE COMPOSITION ROOT OFFERS NO OFF SWITCH
// ---------------------------------------------------------------------------

describe('the real composition root always wires a verifier', () => {
  // `ClaimGateOptions.verifier: null` is a declared TEST-ONLY seam and
  // `SemanticLayerOutcome` has an `ABSENT` member for it. The property worth
  // asserting end to end is that the seam is NOT REACHABLE through
  // `buildAgentRuntime` - a runtime that could be configured into skipping the
  // check has the defect back, which is the same discipline `claimGate.enabled`
  // has had since Mission 2D.

  it('reports the verifier as wired, by name, with no option to remove it', async () => {
    const harness = await createSliceHarness({
      label: 'fc-root-default',
      llm: { script: [{ assistantText: ASSERTS_NOTHING }] },
    });
    harnesses.push(harness);
    const conversation = await harness.startConversation();
    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Hello.',
    });

    expect(turn.claimGate.enabled).toBe(true);
    expect(turn.claimGate.verifier?.wired).toBe(true);
    expect(turn.claimGate.verifier?.name).toBe('rule-driven-semantic-claim-verifier');
    expect(harness.runtime.claimGate.semanticVerifier).not.toBeNull();
  });

  it('and every attempt of every turn reports a real outcome, never ABSENT', async () => {
    const harness = await createSliceHarness({
      label: 'fc-root-absent',
      llm: { script: [{ assistantText: FALSE_CLAIM }], onExhausted: 'repeat-last' },
    });
    harnesses.push(harness);
    const conversation = await harness.startConversation();
    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Thanks for sorting that out.',
    });

    const attempts = turn.claimGate.releases.flatMap((release) => release.attempts);
    expect(attempts.length).toBeGreaterThan(0);
    for (const attempt of attempts) {
      expect(
        attempt.layers.semanticOutcome,
        'ABSENT on the production path means the composition root stopped wiring a verifier. That is a ' +
          'VIOLATION, exactly as claimGate.enabled === false is, and never a pass.',
      ).not.toBe('ABSENT');
    }
  });

  it('and the offline default adds NOTHING, which is why the rest of the suite is unchanged', async () => {
    // Stated as a test rather than as a comment, because the whole suite's
    // stability rests on it: `RuleDrivenSemanticClaimVerifier` with no rules
    // returns CLASSIFIED with an empty list, so the union equals the deterministic
    // set and no pre-2F expectation moves. It is also why nobody may read a green
    // sweep as evidence that the semantic layer WORKS - only that the pipeline does.
    const verifier = new RuleDrivenSemanticClaimVerifier();
    expect(verifier.ruleCount).toBe(0);
    const verdict = await verifier.classify({ text: FALSE_CLAIM, correlationId: 'c' });
    expect(verdict).toEqual({ kind: 'CLASSIFIED', claims: [], modelId: null });
  });
});
