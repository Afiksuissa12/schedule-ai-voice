/**
 * `npm run demo:local` - the local AI brain, end to end, in one command.
 *
 * WHAT THIS IS, AND WHAT `npm run slice:demo` STILL IS
 * ---------------------------------------------------------------------------
 * `slice:demo` is Baseline V1 and is untouched: a `ScriptedLlmProvider`, a
 * script written down before anything runs, byte-identical output every time.
 * That is the right demo for a credential-less, offline, reproducible smoke
 * test, and it stays the default.
 *
 * This one is the opposite trade and the reason Mission 2 exists. Every word the
 * agent says here is generated, in the moment, by a real language model running
 * on this machine - because `docs/BASELINE_V1.md` § 4 is a Founder directive
 * that customer-facing conversation must not be scripted. Nothing about it is
 * reproducible byte-for-byte, and it needs Ollama to be up. It is opt-in for
 * exactly those reasons.
 *
 * WHAT IS REAL HERE
 * ---------------------------------------------------------------------------
 * All of it except the outside world:
 *
 *  - a real local model, via `LocalLlmProvider` -> Ollama on the host;
 *  - the real `ConversationContextAssembler`, with the committed business
 *    profile from `src/context/profiles/default.json`;
 *  - the real production prompt composition `sales-scheduler-local@v2`;
 *  - the real nine tool JSON Schemas, from the real Zod definitions;
 *  - the real `ToolDispatcher` chokepoint, the real `SchedulingValidator`, the
 *    real deterministic datetime resolution;
 *  - the real `ConversationService`, rebuilt from database rows every iteration;
 *  - the real audit trail, on one correlation id per turn;
 *  - the real `DueActionRunner`, keeping the promise with no model involved.
 *
 * WHAT IS SUBSTITUTED, AND WHY THOSE AND ONLY THOSE
 * ---------------------------------------------------------------------------
 * The same three substitutions `slice:demo` makes: a `FixedClock`, the
 * deterministic telephony/calendar/availability doubles, and a throwaway SQLite
 * file under `.tmp/` that is deleted afterwards. The clock is fixed on purpose -
 * the MODEL's side of this demo is non-deterministic by design, so the
 * APPLICATION's side is pinned, which is what makes "the model said something
 * new but the validated instant is the same" a readable result rather than two
 * variables moving at once. It cannot call a phone, write to a calendar, or
 * spend money: `createProviderRegistry` throws rather than falling back to a
 * real vendor, and no vendor API key is read anywhere on this path.
 *
 * THE CONVERSATION IS DRIVEN FROM THE CONTACT'S SIDE ONLY
 * ---------------------------------------------------------------------------
 * `CONTACT_TURNS` below is what the human says. That is INPUT - the same
 * category as a test fixture, and the same thing `slice:demo`'s single utterance
 * already is. Not one word the AGENT says is written down anywhere: § 6 of the
 * output proves that by checking every generated sentence against every string
 * literal in `src/`.
 *
 * The contact also ANSWERS, once, if answering is what a human would do: see
 * `CLARIFICATION_ANSWER`.
 *
 * WHAT THE EXIT CODE IS GATED ON - AND WHAT IT DELIBERATELY IS NOT
 * ---------------------------------------------------------------------------
 * The checks that can fail this run are the ones APPLICATION code guarantees,
 * on every run, with every model, or the build is broken: no tool argument
 * carrying an instant the model resolved for itself, no prewritten sentence
 * reaching the contact, the non-vacuity control firing, one correlation id
 * explaining the scheduling turn, and - when something did get booked - the
 * follow-up engine dispatching it with no model involved.
 *
 * Whether the model proposes a booking AT ALL is not one of them, and used to
 * be. That is model behaviour, it varies run to run, and this repository's own
 * system prompt invites the variance: `ASK_WHEN_AMBIGUOUS` tells the model that
 * "three" with no am or pm is "the beginning of a time" and to ask. The contact
 * says "at 3". A model that asks to confirm it is obeying a guardrail clause,
 * and a demo that exits 1 for that is reporting on the model while claiming to
 * report on the build. So § 3 prints it as a labelled OBSERVATION - the same
 * treatment `(no tool call this turn - the model just talked, which is often
 * correct)` already gets - and the run's verdict stays a statement about the
 * code. `FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 8.6 carries the measured
 * rate; the benchmark's scheduling-intent metric is where that number belongs.
 *
 * Flags: `--model <tag>`, `--num-ctx <n>`, `--base-url <url>`, `--rolling-summary`,
 * `--keep`, `--json`.
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderChain, renderChainAnswers, summarizeChain } from './auditReport.js';
import {
  buildAgentRuntime,
  createLlmProvider,
  DEFAULT_LOCAL_BRAIN_NUM_CTX,
  type AgentRuntime,
} from './composition.js';
import { checkGeneratedLanguage, type GeneratedLanguageReport } from './generatedLanguageCheck.js';
import { seedSliceWorld, type SliceWorld } from './seedSliceWorld.js';
import { LOCAL_BRAIN_SYSTEM_PROMPT_REF } from '../agent/prompt/systemPrompt.js';
import { loadBusinessProfile } from '../context/businessProfile.js';
import { serializeConversationMemory } from '../conversation/conversationMemory.js';
import { parseCallContactPayload } from '../followup/payloads.js';
import { DEFAULT_LOCAL_LLM_BASE_URL, DEFAULT_LOCAL_LLM_MODEL } from '../llm/localLlmProvider.js';
import { OllamaClient } from '../llm/ollama/client.js';
import type { OllamaShowResponse, OllamaTagsResponse } from '../llm/ollama/wire.js';
import { FixedClock } from '../ports/clock.js';
import type {
  CompleteTurnRequest,
  CompleteTurnResult,
  LlmProvider,
  LlmStreamHandler,
  LlmTurnMetrics,
} from '../ports/llm.js';
import type { DeterministicTelephonyProvider } from '../providers/deterministicTelephonyProvider.js';
import { createProviderRegistry } from '../providers/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

/**
 * Wednesday 2026-03-04, 10:00 America/New_York - the same instant
 * `npm run slice:demo` and `npm run context:prove` pin, so all three demos
 * describe one world rather than three subtly different ones.
 */
const DEMO_NOW_UTC = '2026-03-04T15:00:00.000Z';

/**
 * What the contact says, in order. INPUT, not agent speech - see the header.
 *
 * Three turns, each chosen to make a different part of the local brain visible
 * and each of which would be answerable only by a model with that part wired:
 *
 *  1. A returning contact who refers to a previous call. Answerable only from
 *     the cross-session memory the assembler carried forward - a stranger's
 *     greeting here is the most obvious possible tell that it is a machine.
 *  2. A product-and-price question. Answerable only from the business profile,
 *     and the one place a model is most tempted to invent a number.
 *  3. A callback in the contact's own words. The architecture's load-bearing
 *     moment: the model must pass "tomorrow afternoon at 3" through UNRESOLVED
 *     and let application code decide what instant that is.
 *
 * A fourth utterance, `CLARIFICATION_ANSWER`, is spoken only on the runs that
 * need it.
 */
const CONTACT_TURNS: readonly string[] = [
  "Hi, it's Jordan. You caught me at a better time than last week.",
  'Remind me what you actually do - and what would it run for eight technicians?',
  'Alright, that is worth a proper look. Can you call me back tomorrow afternoon at 3?',
];

/**
 * The one adaptive contact utterance: what Jordan says if the agent asks rather
 * than acts.
 *
 * `ASK_WHEN_AMBIGUOUS` tells the model, in as many words, that a bare "three" is
 * "the beginning of a time" and that it should ask. Turn 3 ends on "at 3". So on
 * some fraction of runs - it is a real model, so the fraction is a rate, not a
 * constant - the last thing that happens is a sensible question. With three
 * fixed turns there was no room left to answer it, and the demo ended with the
 * conversation hanging mid-exchange on the one turn it exists to show.
 *
 * A human would have answered, so the script answers: ONE further utterance,
 * appended only when the scripted turns ended with nothing on the books, spoken
 * under its own heading so a reader can see it happened and why. It is a cap,
 * not a loop - the demo does not keep talking until it likes the result, and
 * because the booking is no longer a gate (see the header) there is nothing for
 * a retry to rescue. What it buys is that the interesting half of the demo -
 * validated instant, provenance, `DueActionRunner`, audit chain - is reachable
 * whether the model books immediately or confirms first.
 *
 * The condition is "nothing persisted", not "the model asked a question",
 * because the third thing that can happen is a proposal the dispatcher REFUSED,
 * and that case wants the same turn for a better reason: a refusal is only half
 * a story until you see what the model does with it. `hermes3:8b` invented a
 * contact id here, was refused by name, and corrected it on this turn.
 *
 * Worded to answer whichever confirming question got asked - am or pm, which
 * afternoon, what time - without handing the model a resolved instant: "3 pm
 * tomorrow" is still words, and application code still decides what they mean.
 */
const CLARIFICATION_ANSWER = 'Afternoon, yes - 3 pm tomorrow. Go ahead and lock it in.';

/**
 * A line that IS in the source tree, used as the non-vacuity control for § 7.
 *
 * It is `ScriptedLlmProvider`'s own demo line, quoted from
 * `src/app/sliceDemo.ts`. The check must catch it; if it ever does not, the
 * check has stopped working and § 6's green result means nothing.
 */
const KNOWN_RECITAL_CONTROL =
  "You're all set - I'll give you a ring tomorrow, Thursday the 5th, at 3 in the afternoon your time.";

/**
 * Budget-ladder steps that mean the agent can no longer talk about money.
 *
 * The ladder is working correctly when it applies these - it is shedding the
 * least essential facts to fit a window. The problem is that the SYMPTOM is
 * invisible: nothing errors, and the model answers a pricing question by
 * changing the subject. So the demo names them.
 */
const STARVATION_STEPS: readonly string[] = [
  'drop-pricing-detail',
  'drop-business-except-identity-and-objective',
];

interface Options {
  readonly model: string;
  readonly numCtx: number;
  /**
   * Where `numCtx` came from, printed rather than assumed.
   *
   * Worth its own field because this value has a genuinely surprising
   * provenance: importing `@prisma/client` loads `.env` into `process.env` as a
   * side effect (dotenv arrives transitively through `@prisma/config`), so the
   * `LOCAL_LLM_NUM_CTX` line in `.env` silently wins over every default in the
   * source - and `npm run db:generate` writes that `.env` from `.env.example`
   * for you. An operator who believed the code's default would have been running
   * a different configuration from the one they read about, with no error and
   * only a quiet loss of the pricing facts to show for it.
   */
  readonly numCtxSource: string;
  readonly baseUrl: string;
  readonly rollingSummary: boolean;
  readonly keepDatabase: boolean;
  readonly json: boolean;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const failures: string[] = [];
  const check = (ok: boolean, label: string): void => {
    if (ok) {
      console.log(`  PASS  ${label}`);
    } else {
      failures.push(label);
      console.log(`  FAIL  ${label}`);
    }
  };

  heading('0. PRECONDITIONS - is there a model on this host at all');
  console.log(`  base URL      ${options.baseUrl}`);
  console.log(`  model         ${options.model}`);
  console.log(`  num_ctx       ${options.numCtx}  (from ${options.numCtxSource})`);
  console.log(`  temperature   0`);
  await preflight(options, check);
  if (failures.length > 0) {
    console.log('\n  Preconditions failed. Start Ollama and pull the model, then run this again:');
    console.log(`    ollama pull ${options.model}`);
    process.exitCode = 1;
    return;
  }

  const databasePath = join(REPO_ROOT, '.tmp', `local-brain-demo-${process.pid}-${randomUUID().slice(0, 8)}.db`);
  mkdirSync(dirname(databasePath), { recursive: true });
  applySchema(databasePath);

  const clock = new FixedClock(DEMO_NOW_UTC);
  const providers = createProviderRegistry({});
  const businessProfile = loadBusinessProfile();

  // The provider is built through the composition root's OWN factory - the one
  // `buildAgentRuntime` would call - and then wrapped in a read-only recorder, so
  // the demo can print what each turn cost. `createLlmProvider` is exported for
  // exactly this: a caller that needs the constructed provider in hand should not
  // have a second way of constructing it.
  const metrics = new TurnMetricsLog(
    createLlmProvider({
      kind: 'local',
      model: options.model,
      baseUrl: options.baseUrl,
      numCtx: options.numCtx,
      temperature: 0,
      keepAlive: '10m',
      // Streaming, so time-to-first-token is measurable. Identical results
      // either way - see `LocalLlmProvider`.
      streamByDefault: true,
    }),
  );

  // ONE call to the composition root. No hand-rolled turn service, no second
  // dependency graph: `contextAssembly` is the whole opt-in, and the same call
  // is what a deployment would make.
  //
  // `modelNumCtx` is passed explicitly BECAUSE the provider is passed as an
  // instance. `resolveContextBudget` can derive it from `llmProviderConfig` but
  // not from an already-built provider, and the two numbers disagreeing is the
  // silent-truncation bug that function exists to prevent - so the demo states
  // it rather than relying on a default that is 16384 while this run may be 8192.
  const runtime = buildAgentRuntime({
    clock,
    datasourceUrl: `file:${databasePath}`,
    providers,
    llm: metrics.provider,
    contextAssembly: {
      businessProfile,
      budget: { modelNumCtx: options.numCtx },
      ...(options.rollingSummary ? { memory: true } : {}),
    },
  });

  try {
    // ---- 1. a world, including a call that already happened ----------------
    heading('1. SEEDED WORLD - a contact we have spoken to before');
    const world = await seedSliceWorld(runtime.db, { systemPromptRef: LOCAL_BRAIN_SYSTEM_PROMPT_REF });
    const previous = await seedPreviousCall(runtime, world, clock);

    console.log(`  Organization  ${world.organization.name} (${world.organization.defaultTimezone})`);
    console.log(`  Contact       ${world.contact.fullName} - ${world.contact.timezone}`);
    console.log(`  Agent config  v${world.agentConfiguration.version} (${world.agentConfiguration.systemPromptRef})`);
    console.log(`  Business hrs  09:00-17:00 weekdays, min lead ${world.agentConfiguration.minLeadTimeMinutes} min`);
    console.log(`  Now           ${clock.nowUtc()}  (10:00 ${world.contact.timezone}, FixedClock)`);
    console.log(`  Business ctx  ${businessProfile.profileRef} - ${businessProfile.company.name}`);
    console.log(`  Earlier call  conversation ${previous.conversationId}, COMPLETED, outcome CONNECTED`);
    console.log('                two durable facts and one loose end recorded on it');

    const conversation = await runtime.conversations.start({
      organizationId: world.organization.id,
      contactId: world.contact.id,
      aiAgentId: world.aiAgent.id,
      agentConfigurationId: world.agentConfiguration.id,
      channel: 'VOICE',
    });
    console.log(`  This call     conversation ${conversation.id}`);

    // ---- 2. the conversation ----------------------------------------------
    heading('2. THE CONVERSATION - every agent word generated, now, by the local model');
    const assistantUtterances: string[] = [];
    const correlationIds: string[] = [];

    // Mutable, because of the one conditional utterance at the bottom of the
    // loop. Nothing else appends to it.
    const script: string[] = [...CONTACT_TURNS];
    let clarificationOffered = false;

    for (let index = 0; index < script.length; index += 1) {
      const utterance = script[index] as string;
      const turnHeading =
        index < CONTACT_TURNS.length
          ? `turn ${index + 1} of ${CONTACT_TURNS.length}`
          : `turn ${index + 1} - the contact answers, because nothing was on the books yet`;
      console.log(`\n  ---- ${turnHeading} ${'-'.repeat(48)}`);
      console.log(`  CONTACT:  ${utterance}`);

      metrics.openTurn(index);
      const turn = await runtime.agent.handleTurn({ conversationId: conversation.id, utterance });
      correlationIds.push(turn.correlationId);
      assistantUtterances.push(...turn.assistantMessages);

      for (const message of turn.assistantMessages) {
        console.log(`  AGENT:    ${message}`);
      }
      if (turn.assistantMessages.length === 0) {
        console.log('  AGENT:    (said nothing)');
      }

      // What the model WANTED, then what application code allowed. Both, always,
      // because the difference between them is the whole architecture.
      for (const outcome of turn.toolOutcomes) {
        const proposal = metrics.proposalFor(outcome.toolCallId);
        console.log(`  PROPOSED  ${outcome.toolName}`);
        if (proposal) console.log(`            raw argumentsJson: ${proposal}`);
        console.log(
          outcome.ok
            ? `  ALLOWED   ${outcome.toolName} -> application code validated and persisted it`
            : `  REFUSED   ${outcome.toolName}: ${outcome.code} - ${outcome.reason}`,
        );
      }
      if (turn.toolOutcomes.length === 0) {
        console.log('  (no tool call this turn - the model just talked, which is often correct)');
      }

      const assembled = turn.assembledContext;
      if (assembled) {
        console.log(
          `  CONTEXT   ${assembled.rendered.text.length} chars of background, ` +
            `${assembled.facts.durableFacts.length} durable fact(s), ` +
            `${assembled.facts.unresolved.length} loose end(s), ` +
            `previous conversation ${assembled.facts.previousConversation ? 'carried' : 'ABSENT'}, ` +
            `transcript ${assembled.facts.transcript.includedTurnCount}/${assembled.facts.transcript.totalTurnCount} turns`,
        );
        if (assembled.reductionsApplied.length > 0) {
          console.log(`            budget ladder applied: ${assembled.reductionsApplied.join(', ')}`);
        }
        // Named explicitly rather than left as one entry in a list of twenty.
        // When the ladder gets this far the agent has silently lost the ability
        // to answer a pricing question, and it will improvise around the gap
        // rather than say so. See DEFAULT_LOCAL_BRAIN_NUM_CTX.
        const starved = assembled.reductionsApplied.filter((step) => STARVATION_STEPS.includes(step));
        if (starved.length > 0) {
          console.log(
            `            WARNING: num_ctx ${options.numCtx} is too small for this profile - the ladder had to ` +
              `apply ${starved.join(', ')}, so the agent no longer has the prices in front of it. Raise it to ` +
              `${DEFAULT_LOCAL_BRAIN_NUM_CTX}.`,
          );
        }
      }

      const turnMetrics = metrics.forTurn(index);
      if (turnMetrics.length > 0) {
        for (const [call, measurement] of turnMetrics.entries()) {
          console.log(
            `  METRICS   iteration ${call + 1}: ttft ${fmtMs(measurement.timeToFirstTokenMs)}, ` +
              `total ${fmtMs(measurement.totalLatencyMs)}, ` +
              `${measurement.generatedTokens ?? '?'} tok at ${fmt(measurement.tokensPerSecond)} tok/s, ` +
              `prompt ${measurement.promptTokens ?? '?'} tok, ` +
              `ctx ${measurement.contextUtilization === null ? '?' : `${(measurement.contextUtilization * 100).toFixed(1)}%`}`,
          );
        }
      }
      if (turn.memoryRefresh && turn.memoryRefresh.status !== 'NOT_DUE') {
        console.log(
          `  MEMORY    rolling summary ${turn.memoryRefresh.status}` +
            (turn.memoryRefresh.failureReason ? ` (${turn.memoryRefresh.failureReason})` : ''),
        );
      }
      console.log(`  (iterations ${turn.iterations}, stopped: ${turn.stopReason}, correlation ${turn.correlationId})`);

      // The one adaptive moment in the script. See `CLARIFICATION_ANSWER`.
      if (
        index === CONTACT_TURNS.length - 1 &&
        !clarificationOffered &&
        !(await anythingOnTheBooks(runtime, world.contact.id))
      ) {
        clarificationOffered = true;
        script.push(CLARIFICATION_ANSWER);
        console.log('');
        console.log('  The scheduling request has gone by with nothing on the books yet: either the model');
        console.log('  asked to confirm the bare "at 3" instead of acting - which is exactly what');
        console.log('  ASK_WHEN_AMBIGUOUS tells it to do - or what it proposed was refused above. A real');
        console.log('  contact would say something either way, so the script does: one more contact');
        console.log('  utterance, once, only on runs that get here.');
      }
    }

    // ---- 3. what the model was actually allowed to change -----------------
    heading('3. WHAT APPLICATION CODE PERSISTED');
    const futureActions = await runtime.db.futureActions.listByContact(world.contact.id);
    const meetings = await runtime.db.meetings.listByContact(world.contact.id);

    console.log(`  FutureActions ${futureActions.length}, Meetings ${meetings.length} (excluding the seeded call)`);
    for (const action of futureActions) {
      const payload = parseCallContactPayload(action.payloadJson);
      console.log(`  FutureAction  ${action.id}  ${action.type}  ${action.status}`);
      console.log(`    scheduledFor  ${action.scheduledForUtc}  (${action.timezone})`);
      console.log(`    provenance    ${action.validationProvenanceJson.length} bytes, NOT NULL by schema`);
      console.log(`    payload       toE164=${payload.toE164}`);
    }
    for (const meeting of meetings) {
      console.log(`  Meeting       ${meeting.id}  ${meeting.status}  ${meeting.startUtc} (${meeting.timezone})`);
      console.log(`    provenance    ${meeting.validationProvenanceJson.length} bytes, NOT NULL by schema`);
    }

    const scheduled = futureActions[0] ?? null;

    // An OBSERVATION, deliberately not a `check`. See the header: whether the
    // model proposes a booking is model behaviour and varies run to run, and
    // `ASK_WHEN_AMBIGUOUS` actively invites the run where it confirms instead.
    // Gating the exit code on it made the flagship demo's verdict a statement
    // about qwen2.5 wearing the clothes of a statement about this build. The
    // number that belongs to this behaviour is the benchmark's
    // scheduling-intent rate, measured over many runs, not one run's pass/fail.
    if (scheduled !== null || meetings.length > 0) {
      console.log('  OBSERVED      the model got something onto the books through the real validation');
      console.log('                chokepoint - which is what a scheduling agent is for.');
    } else {
      console.log('  OBSERVED      the model never proposed a booking, so nothing reached the chokepoint');
      console.log('                this run. That is a fact about this model today, not a failed gate:');
      console.log('                it either kept asking, or talked instead of acting. The rest of this');
      console.log('                section is therefore empty, and § 4 has no promise to keep.');
    }

    // THE gate, checked here and not only in the benchmark: did the model
    // manufacture an authoritative instant instead of passing the words through?
    const fabricated = metrics.proposalsMentioningAnInstant();
    check(
      fabricated.length === 0,
      'no time-bearing tool argument carried a timestamp the model resolved for itself',
    );
    for (const offender of fabricated) {
      console.log(`        FABRICATED: ${offender}`);
    }

    const passthrough = metrics.proposalsCarryingContactWords(script);
    if (passthrough.length > 0) {
      console.log(`  Passthrough   the contact's own words survived into: ${passthrough.join(', ')}`);
    }

    // ---- 4. the promise is kept, with no model anywhere -------------------
    heading('4. THE FOLLOW-UP ENGINE KEEPS THE PROMISE - no model involved');
    if (scheduled) {
      console.log(`  Advancing the clock past ${scheduled.scheduledForUtc} ...`);
      clock.setTo(new Date(Date.parse(scheduled.scheduledForUtc) + 60_000).toISOString());
      const pass = await runtime.dueActions.runDueActions();
      console.log(`  Runner pass:  claimed=${pass.claimed} executed=${pass.executed} failed=${pass.failed}`);

      const telephony = providers.telephony as DeterministicTelephonyProvider;
      for (const call of telephony.placedCalls) {
        console.log(`  Dispatched:   ${call.request.toE164} -> ${call.status} (${call.providerCallId})`);
        console.log(`                on correlationId ${call.request.correlationId}`);
      }
      const settled = await runtime.db.futureActions.requireById(scheduled.id);
      console.log(`  FutureAction  ${settled.id} is now ${settled.status}`);
      check(telephony.placedCalls.length > 0, 'the promised callback was dispatched through the deterministic double');
      clock.setTo(DEMO_NOW_UTC);
    } else {
      console.log('  Nothing was scheduled, so there is no promise to keep.');
    }

    // ---- 5. the audit trail ------------------------------------------------
    heading('5. THE AUDIT CHAIN FOR THE SCHEDULING TURN');
    const schedulingCorrelationId = correlationIds.at(-1) as string;
    const chain = await runtime.db.audit.listByCorrelationId(schedulingCorrelationId);
    console.log(renderChain(chain));
    console.log(renderChainAnswers(summarizeChain(chain)));
    check(chain.length > 0, 'the turn is fully explained by one correlation id');

    // ---- 6. the directive ---------------------------------------------------
    heading('6. THE FOUNDER DIRECTIVE - generated, not recited');
    const language = checkGeneratedLanguage(assistantUtterances, KNOWN_RECITAL_CONTROL);
    reportGeneratedLanguage(language, assistantUtterances);
    check(language.controlCaught, 'the check can fire at all (a known scripted line IS caught)');
    check(language.ok, "not one word the agent said appears as prewritten speech anywhere in src/");

    // ---- 7. the verdict ----------------------------------------------------
    heading('DONE');
    console.log(`  model             ${runtime.llm.name()}`);
    console.log(
      `  turns             ${script.length} contact utterance(s)` +
        (clarificationOffered ? ` (${CONTACT_TURNS.length} scripted + 1, because turn 3 booked nothing)` : '') +
        `, ${metrics.count()} model calls`,
    );
    console.log(`  tool-call health  ${metrics.healthLine()}`);
    console.log(`  latency           ${metrics.latencyLine()}`);
    console.log('  No vendor API was called. No key was read. No real number was dialled.');
    console.log(`  Ollama at ${options.baseUrl} was the only thing this process talked to.`);

    if (options.json) {
      console.log(`\nJSON\n${JSON.stringify({ assistantUtterances, metrics: metrics.all() }, null, 2)}`);
    }

    console.log(`\n${'='.repeat(78)}`);
    if (failures.length === 0) {
      console.log('  RESULT: PASS - every check above held.');
    } else {
      console.log(`  RESULT: FAIL - ${failures.length} check(s) failed:`);
      for (const failure of failures) console.log(`    - ${failure}`);
      process.exitCode = 1;
    }
  } finally {
    await runtime.shutdown();
    if (options.keepDatabase) {
      console.log(`\n  Database kept at ${databasePath}`);
    } else {
      for (const suffix of ['', '-journal', '-wal', '-shm']) {
        rmSync(`${databasePath}${suffix}`, { force: true });
      }
    }
  }
}

/**
 * Has anything actually been committed for this contact yet?
 *
 * Asked of the database rather than of the turn result on purpose: a proposal
 * the dispatcher REFUSED is not a booking, and the only place that distinction
 * is authoritative is the persisted row. Both tables start empty -
 * `seedSliceWorld` seeds a finished call, never a meeting or a future action -
 * so anything found here was put there by the model through the chokepoint.
 */
async function anythingOnTheBooks(runtime: AgentRuntime, contactId: string): Promise<boolean> {
  const [futureActions, meetings] = await Promise.all([
    runtime.db.futureActions.listByContact(contactId),
    runtime.db.meetings.listByContact(contactId),
  ]);
  return futureActions.length > 0 || meetings.length > 0;
}

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

/**
 * Ask the host what it has, before seeding anything.
 *
 * A demo that fails on turn one with a connection error after three seconds of
 * Prisma setup teaches the operator nothing. This one says which of the three
 * things is wrong: Ollama is down, the model is absent, or the model cannot do
 * tool calls.
 *
 * `OllamaClient` is imported rather than reached for directly because
 * `tests/invariants/vendorBoundary.test.ts` forbids any network transport in a
 * file under `src/app` - and that is the right rule, not an inconvenience.
 */
async function preflight(options: Options, check: (ok: boolean, label: string) => void): Promise<void> {
  const client = new OllamaClient({ baseUrl: options.baseUrl, timeoutMs: 15_000, maxRetries: 0 });

  let tags: OllamaTagsResponse;
  try {
    tags = await client.getJson<OllamaTagsResponse>('/api/tags');
  } catch (error) {
    check(false, `Ollama answers at ${options.baseUrl} (${error instanceof Error ? error.message : String(error)})`);
    return;
  }
  const installed = tags.models ?? [];
  check(true, `Ollama answers at ${options.baseUrl} with ${installed.length} model(s)`);

  const present = installed.find((model) => model.name === options.model || model.model === options.model);
  check(present !== undefined, `the model ${options.model} is present on the host`);
  if (!present) {
    console.log(`        installed: ${installed.map((model) => model.name).join(', ') || '(none)'}`);
    return;
  }

  try {
    const shown = await client.postJson<OllamaShowResponse>('/api/show', { model: options.model });
    console.log(
      `  resolved      ${shown.details?.parameter_size ?? 'unknown'} ` +
        `${shown.details?.quantization_level ?? 'unknown'}, digest ${(present.digest ?? '?').slice(0, 12)}`,
    );
    check(
      (shown.capabilities ?? []).includes('tools'),
      `${options.model} advertises the "tools" capability (native tool calling)`,
    );
  } catch (error) {
    check(false, `/api/show answered for ${options.model} (${error instanceof Error ? error.message : String(error)})`);
  }
}

// ---------------------------------------------------------------------------
// Seeding an earlier call, so cross-session memory has something to carry
// ---------------------------------------------------------------------------

/**
 * A finished conversation with a real memory envelope and a real call outcome.
 *
 * Written the way `ConversationMemoryWriter` writes one, so the assembler reads
 * it through exactly the production path rather than through a shortcut. The
 * facts are deliberately things no model could guess - a specific accounting
 * system and a specific busy season - so § 2 turn 1 either demonstrably used
 * them or demonstrably did not.
 */
async function seedPreviousCall(
  runtime: AgentRuntime,
  world: SliceWorld,
  clock: FixedClock,
): Promise<{ conversationId: string }> {
  const earlier = await runtime.conversations.start({
    organizationId: world.organization.id,
    contactId: world.contact.id,
    aiAgentId: world.aiAgent.id,
    agentConfigurationId: world.agentConfiguration.id,
    channel: 'VOICE',
  });

  await runtime.conversations.appendContactUtterance(
    earlier.id,
    'We are still doing all of this on a whiteboard, to be honest. Now is not a great time though.',
  );
  await runtime.db.conversations.update(earlier.id, {
    status: 'COMPLETED',
    endedAt: clock.nowUtc(),
    summary: serializeConversationMemory({
      narrative:
        'A first call. The contact described dispatching eight field technicians off a whiteboard, asked ' +
        'whether anything connects to QuickBooks, and asked to be called back once their busy week was over.',
      durableFacts: [
        { id: 'accounting_system', fact: 'They run QuickBooks Online for accounting.' },
        { id: 'crew_size', fact: 'They dispatch eight field technicians.' },
      ],
      unresolvedTopics: [
        { id: 'quickbooks_edition', topic: 'Which QuickBooks edition they are on', raisedBy: 'CONTACT' },
      ],
      coveredThroughTurnIndex: 0,
      generatedBy: 'demo-seed',
      generatedAtUtc: clock.nowUtc(),
    }),
  });

  const call = await runtime.db.calls.create({
    organizationId: world.organization.id,
    contactId: world.contact.id,
    conversationId: earlier.id,
    direction: 'OUTBOUND',
    providerName: 'conversation',
    status: 'COMPLETED',
    startedAt: clock.nowUtc(),
    endedAt: clock.nowUtc(),
  });
  await runtime.db.callOutcomes.upsertForCall({
    callId: call.id,
    outcome: 'CONNECTED',
    notes: 'Interested but mid-week busy; asked to be called back.',
    recordedByToolCallId: null,
  });

  return { conversationId: earlier.id };
}

// ---------------------------------------------------------------------------
// Per-turn measurement
// ---------------------------------------------------------------------------

/**
 * A recording wrapper around the runtime's provider.
 *
 * `AgentTurnService` deliberately does not return per-call metrics - it returns
 * what happened in the conversation, and a turn's token cost is not that. So the
 * demo wraps the provider to keep them, along with each proposal's raw
 * `argumentsJson`, which is the string the whole passthrough argument is about.
 *
 * `src/eval/runner/metricsCapturingProvider.ts` does the same job for the
 * benchmark and is NOT reused here on purpose: `EVAL_HARNESS.md` § 0 states that
 * nothing outside `src/eval/**` imports it, and that isolation is what lets the
 * benchmark live in this source tree without appearing in the default import
 * graph. Consolidating the two behind one home in `src/llm/` is worth doing and
 * is recorded as a recommendation rather than done here, where it would mean
 * editing a sibling's tree mid-run.
 */
class TurnMetricsLog {
  /** The wrapped provider. Hand this to `buildAgentRuntime`. */
  readonly provider: LlmProvider;

  private readonly measurements: LlmTurnMetrics[] = [];
  private readonly perTurn: LlmTurnMetrics[][] = [];
  private readonly proposals = new Map<string, string>();
  /** Which contact turn the calls now arriving belong to. Advanced by `openTurn`. */
  private turnIndex = 0;

  constructor(inner: LlmProvider) {
    const record = (result: CompleteTurnResult): CompleteTurnResult => {
      if (result.metrics) {
        this.measurements.push(result.metrics);
        (this.perTurn[this.turnIndex] ??= []).push(result.metrics);
      }
      for (const call of result.toolCalls) this.proposals.set(call.toolCallId, call.argumentsJson);
      return result;
    };

    const streaming = inner.completeTurnStreaming?.bind(inner);

    this.provider = {
      name: () => inner.name(),
      completeTurn: async (request: CompleteTurnRequest) => record(await inner.completeTurn(request)),
      ...(inner.supportsStreaming ? { supportsStreaming: () => inner.supportsStreaming?.() === true } : {}),
      ...(streaming
        ? {
            completeTurnStreaming: async (request: CompleteTurnRequest, onDelta: LlmStreamHandler) =>
              record(await streaming(request, onDelta)),
          }
        : {}),
    };
  }

  /** Attribute subsequent model calls to contact turn `index`. */
  openTurn(index: number): void {
    this.turnIndex = index;
  }

  forTurn(index: number): readonly LlmTurnMetrics[] {
    return this.perTurn[index] ?? [];
  }

  proposalFor(toolCallId: string): string | undefined {
    return this.proposals.get(toolCallId);
  }

  count(): number {
    return this.measurements.length;
  }

  all(): readonly LlmTurnMetrics[] {
    return this.measurements;
  }

  /**
   * Proposals whose arguments carry a resolved absolute instant.
   *
   * The same gate the evaluation harness applies, in its narrow form: an ISO
   * date or datetime the model produced rather than repeated. A contact is
   * entitled to say "2026-03-05"; nothing in `CONTACT_TURNS` does, so any
   * appearance here came from the model.
   */
  proposalsMentioningAnInstant(): string[] {
    const found: string[] = [];
    for (const argumentsJson of this.proposals.values()) {
      if (/\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(argumentsJson) || /\b1[6-9]\d{8,}\b/.test(argumentsJson)) {
        found.push(argumentsJson);
      }
    }
    return found;
  }

  /** Tool calls whose arguments still contain a phrase the contact actually used. */
  proposalsCarryingContactWords(utterances: readonly string[]): string[] {
    const phrases = utterances.flatMap((utterance) =>
      utterance
        .toLowerCase()
        .split(/[.?!,-]/)
        .map((part) => part.trim())
        .filter((part) => part.split(/\s+/).length >= 3),
    );
    const carrying: string[] = [];
    for (const [toolCallId, argumentsJson] of this.proposals) {
      const haystack = argumentsJson.toLowerCase();
      const hit = phrases.find((phrase) => haystack.includes(phrase));
      if (hit) carrying.push(`${toolCallId} ("${hit}")`);
    }
    return carrying;
  }

  /**
   * Tool-call health SUMMED across the run.
   *
   * `metrics.toolCallHealth` is per model call, not cumulative, so reporting the
   * last one reads "native=0" on any run whose final call was the model simply
   * talking - which is most of them, because the last thing a good turn does is
   * speak rather than act.
   */
  healthLine(): string {
    const reported = this.measurements.map((m) => m.toolCallHealth).filter((h): h is NonNullable<typeof h> => !!h);
    if (reported.length === 0) return 'not reported by this provider';
    const total = reported.reduce(
      (sum, health) => ({
        native: sum.native + health.native,
        recoveredFromText: sum.recoveredFromText + health.recoveredFromText,
        malformed: sum.malformed + health.malformed,
      }),
      { native: 0, recoveredFromText: 0, malformed: 0 },
    );
    const attempts = total.native + total.recoveredFromText + total.malformed;
    return (
      `native=${total.native} recovered=${total.recoveredFromText} malformed=${total.malformed}` +
      (attempts > 0 ? ` (malformed rate ${((total.malformed / attempts) * 100).toFixed(1)}%)` : '')
    );
  }

  latencyLine(): string {
    const ttft = this.measurements.map((m) => m.timeToFirstTokenMs).filter((v): v is number => v !== null);
    const speeds = this.measurements.map((m) => m.tokensPerSecond).filter((v): v is number => v !== null);
    if (ttft.length === 0) return 'not reported by this provider';
    return (
      `time to first token: min ${fmtMs(Math.min(...ttft))}, max ${fmtMs(Math.max(...ttft))}` +
      (speeds.length > 0 ? `; generation ${fmt(Math.min(...speeds))}-${fmt(Math.max(...speeds))} tok/s` : '')
    );
  }
}

// ---------------------------------------------------------------------------

function reportGeneratedLanguage(report: GeneratedLanguageReport, utterances: readonly string[]): void {
  console.log(
    `  Scanned ${report.literalsScanned} string literal(s) of ${report.wordRun}+ words across ` +
      `${report.filesScanned} file(s) under src/, of which ${report.utteranceShapedLiterals} read as ` +
      'speech to a person.',
  );
  console.log(`  Checked ${utterances.length} generated agent utterance(s) against all of them.`);
  console.log(
    `  Control (a line that IS in the source): ${report.controlCaught ? 'CAUGHT, as it must be' : 'MISSED - the check is broken'}`,
  );

  for (const verdict of report.verdicts) {
    const label = verdict.utterance.length <= 64 ? verdict.utterance : `${verdict.utterance.slice(0, 63)}…`;
    if (verdict.recitals.length > 0) {
      console.log(`  RECITED  "${label}"`);
      for (const recital of verdict.recitals) {
        console.log(`           ${recital.words} words from ${recital.file}:${recital.line}: "${recital.matched}"`);
      }
    } else if (verdict.longestFactualEcho) {
      console.log(
        `  original "${label}"  (quotes ${verdict.longestFactualEcho.words} words of business fact from ` +
          `${verdict.longestFactualEcho.file}:${verdict.longestFactualEcho.line} - legitimate, that is what the ` +
          'profile is for)',
      );
    } else {
      console.log(`  original "${label}"`);
    }
  }
  console.log(
    '  Limits of this evidence: it sees src/ only, it cannot detect a sentence the model learned in ' +
      'training, and it is evidence from THIS run rather than a proof about every run.',
  );
}

function parseOptions(argv: readonly string[]): Options {
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const numCtxFlag = valueOf('--num-ctx');
  const numCtxEnv = process.env['LOCAL_LLM_NUM_CTX'];
  // DEFAULT_LOCAL_BRAIN_NUM_CTX, not the provider's own 8192: see that constant
  // for the measurement showing the budget ladder drops the pricing facts at
  // 8192. `.env` (via LOCAL_LLM_NUM_CTX) still wins, and `--num-ctx` wins over
  // everything - but which one applied is now reported, not inferred.
  return {
    model: valueOf('--model') ?? process.env['LOCAL_LLM_MODEL'] ?? DEFAULT_LOCAL_LLM_MODEL,
    numCtx: numCtxFlag ? Number.parseInt(numCtxFlag, 10) : Number(numCtxEnv ?? DEFAULT_LOCAL_BRAIN_NUM_CTX),
    numCtxSource: numCtxFlag
      ? '--num-ctx'
      : numCtxEnv !== undefined
        ? 'LOCAL_LLM_NUM_CTX in the environment (note: .env is loaded by @prisma/client)'
        : 'DEFAULT_LOCAL_BRAIN_NUM_CTX',
    baseUrl: valueOf('--base-url') ?? process.env['LOCAL_LLM_BASE_URL'] ?? DEFAULT_LOCAL_LLM_BASE_URL,
    rollingSummary: argv.includes('--rolling-summary'),
    keepDatabase: argv.includes('--keep'),
    json: argv.includes('--json'),
  };
}

function applySchema(databasePath: string): void {
  execFileSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve('prisma/build/index.js'),
      'db',
      'push',
      '--schema',
      join(REPO_ROOT, 'prisma', 'schema.prisma'),
      '--skip-generate',
      '--accept-data-loss',
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: `file:${databasePath.replace(/\\/g, '/')}`,
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
      stdio: 'pipe',
    },
  );
}

function fmt(value: number | null): string {
  return value === null ? '?' : value.toFixed(1);
}

function fmtMs(value: number | null): string {
  return value === null ? '?' : `${value.toFixed(0)} ms`;
}

function heading(title: string): void {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

main().catch((error: unknown) => {
  console.error('\ndemo:local FAILED\n');
  console.error(error);
  process.exitCode = 1;
});
