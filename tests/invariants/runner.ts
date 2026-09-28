/**
 * THE SWEEP RUNNER: drives every scenario through the system's real front door.
 *
 * WHAT "REAL FRONT DOOR" MEANS HERE
 * ---------------------------------------------------------------------------
 * Every scenario goes in through `AgentTurnService.handleTurn`, exactly as the
 * demo and the production path would, with a scripted model standing in for
 * OpenAI. Nothing in this file calls `SchedulingValidator`, `FutureActionService`
 * or a repository write method directly. That restraint is the whole point: an
 * invariant proved by reaching past the dispatcher would prove nothing about
 * the chokepoint the mission is actually asking about.
 *
 * The only private-looking thing it touches is `db.prisma.<model>.count()`, for
 * the before/after row counts that invariant 5 is made of. Counting rows is an
 * observation, not a mutation, and there is no public API for "how many rows
 * exist right now" - `tests/e2e/support.ts` does the same thing for the same
 * reason.
 *
 * WHY ONE DATABASE PER CHUNK AND NOT PER SCENARIO
 * ---------------------------------------------------------------------------
 * A fresh SQLite file plus a fresh Prisma client costs roughly 150ms. At 500
 * scenarios that is over a minute of pure setup. So scenarios are grouped into
 * CHUNKS that share one database, and isolation is achieved the way the
 * application itself achieves it: every scenario seeds its OWN organization,
 * contact, agent configuration and calendar via `seedSliceWorld({ suffix })`,
 * and every assertion is scoped to those ids.
 *
 * That is not a weaker test - it is a stronger one. Hundreds of scenarios
 * sharing a database means invariant 5 ("a rejected tool call changes no row
 * counts") is asserted against a database that already contains hundreds of
 * other organizations' rows, so a query missing an `organizationId` filter has
 * somewhere to go wrong.
 *
 * DETERMINISM
 * ---------------------------------------------------------------------------
 * Chunks run concurrently for wall-clock reasons, but each scenario's outcome
 * depends only on its own seeded world and its own `FixedClock` setting, and
 * results are re-sorted into generated order before anything looks at them. The
 * sweep is therefore reproducible regardless of how the chunks interleave -
 * which `invariant 9` re-checks by running the whole thing twice.
 */
import { buildAgentRuntime, type AgentRuntime } from '../../src/app/composition.js';
import { seedSliceWorld, type SliceWorld } from '../../src/app/seedSliceWorld.js';
import type { AuditEvent } from '../../src/audit/types.js';
import type { Database } from '../../src/db/database.js';
import type {
  Contact,
  FutureAction,
  Meeting,
  QualificationState,
  Task,
} from '../../src/domain/entities.js';
import type { ClaimGateTurnReport } from '../../src/agent/agentTurnService.js';
import type { ToolOutcome } from '../../src/agent/tools/results.js';
import { ScriptedLlmProvider } from '../../src/llm/scriptedLlmProvider.js';
import type { BusyInterval } from '../../src/ports/availability.js';
import { createProviderRegistry } from '../../src/providers/index.js';
import type { DeterministicTelephonyProvider } from '../../src/providers/deterministicTelephonyProvider.js';
import { createTestDatabase, type TestDatabase } from '../helpers/testDb.js';
import { NEUTRAL_SWEEP_OFFER } from './claimOracle.js';
import { rulesFor, SEMANTIC_SWEEP_SCRIPT } from './dimensions.js';
import { SemanticSweepVerifier } from './semanticSweepVerifier.js';
import { proposedWhen, renderArguments, type Scenario } from './scenarios.js';

/** Every table a tool call could conceivably write. */
export interface DomainRowCounts {
  readonly meetings: number;
  readonly futureActions: number;
  readonly qualificationStates: number;
  readonly calls: number;
  readonly callOutcomes: number;
  readonly tasks: number;
  readonly leads: number;
  readonly contacts: number;
}

/**
 * The coarse verdict for a scenario, used for the determinism comparison and
 * for the report's headline table.
 *
 * `PERSISTED` and `ACCEPTED_NO_WRITE` are kept apart because
 * `check_availability` legitimately succeeds without writing anything, and
 * collapsing the two would hide a tool that stopped persisting.
 */
export type OutcomeKind =
  | 'PERSISTED'
  | 'ACCEPTED_NO_WRITE'
  | 'REJECTED'
  | 'NO_TOOL_CALL'
  | 'ERROR';

export interface ScenarioObservation {
  readonly scenarioId: string;
  readonly family: string;
  readonly outcome: OutcomeKind;
  /** The `ValidationErrorCode` on a rejection, else null. */
  readonly errorCode: string | null;
  readonly correlationId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly organizationId: string;
  readonly calendarRef: string;
  /** Audit event types for this turn's correlation id, in sequence order. */
  readonly auditTypes: readonly string[];
  readonly auditEvents: readonly AuditEvent[];
  readonly rowsBefore: DomainRowCounts;
  readonly rowsAfter: DomainRowCounts;
  /** Rows this scenario's own contact owns, after the turn. */
  readonly meetings: readonly Meeting[];
  readonly futureActions: readonly FutureAction[];
  readonly qualificationStates: readonly QualificationState[];
  /**
   * Handover tasks this contact owns, after the turn.
   *
   * Read for INV-18: a HANDOVER claim is supported by a `Task`, and the claim
   * gate's own exhaustion path writes exactly one. Without this the invariant
   * could not tell "a person really was asked for" from "the model said so".
   */
  readonly tasks: readonly Task[];
  /**
   * Every `ToolOutcome` the turn produced, successes and refusals.
   *
   * INV-18 needs these as its INDEPENDENT source of what this turn actually did:
   * a `check_availability` that succeeded wrote no row, and a refusal wrote no
   * row either, so the rows alone cannot distinguish "nothing happened" from
   * "something happened that persists nothing". This is the same data the claim
   * gate's ledger is built from, read here separately off the turn result rather
   * than by calling `buildActionLedger` - see the note on INV-18's oracle.
   */
  readonly toolOutcomes: readonly ToolOutcome[];
  /**
   * What the claim gate decided, per piece of customer-facing text.
   *
   * The whole subject of INV-18. `enabled` is carried through rather than
   * discarded because a runtime with no gate is itself a violation, and an
   * invariant that silently treated it as "nothing to check" would report the
   * one configuration that matters as green.
   */
  readonly claimGate: ClaimGateTurnReport;
  /**
   * The text that actually reached the caller, in order.
   *
   * Cross-checked against `claimGate.releases` by INV-18: every returned message
   * must correspond to a release the gate approved. That is what closes the gap
   * between "the gate said no" and "the caller got it anyway".
   */
  readonly assistantMessages: readonly string[];
  readonly contact: Contact;
  /** `AgentConfiguration.businessHoursJson`, for the business-hours invariant. */
  readonly businessHoursJson: string;
  /** Exactly what the model put in the `when` argument, or null. */
  readonly rawProposedValue: string | null;
  /** Busy intervals the provider reports over each persisted meeting's window. */
  readonly busyOverMeetings: readonly (readonly BusyInterval[])[];
  /** Row counts after the SECOND dispatch, for replay scenarios. */
  readonly replayRowsAfter: DomainRowCounts | null;
  readonly stopReason: string;
  /** Populated only when `outcome` is `ERROR`. */
  readonly error: string | null;
}

async function countRows(db: Database): Promise<DomainRowCounts> {
  const { prisma } = db;
  const [meetings, futureActions, qualificationStates, calls, callOutcomes, tasks, leads, contacts] =
    await Promise.all([
      prisma.meeting.count(),
      prisma.futureAction.count(),
      prisma.qualificationState.count(),
      prisma.call.count(),
      prisma.callOutcome.count(),
      prisma.task.count(),
      prisma.lead.count(),
      prisma.contact.count(),
    ]);
  return { meetings, futureActions, qualificationStates, calls, callOutcomes, tasks, leads, contacts };
}

/**
 * What families A-L have always said, and still say.
 *
 * Kept as a named constant because INV-18 and `dimensions.ts` both need to be
 * able to point at it, and because the one property that matters about it is
 * that it asserts NOTHING material - which `tests/claimGate/` verifies against
 * the real detector rather than assuming.
 *
 * SINCE § 17.5 IT IS ALSO DECLARED. `NEUTRAL_SWEEP_OFFER` in `claimOracle.ts`
 * carries the hand-authored ground truth that this sentence asserts nothing, so
 * INV-18's independent oracle judges the ~1,900 releases of families A-L rather
 * than taking the detector's silence for an answer. The string is taken from
 * there rather than written twice.
 */
export const NEUTRAL_SWEEP_TEXT = NEUTRAL_SWEEP_OFFER.text;

/**
 * The scripted turn for one scenario.
 *
 * One model step carrying exactly one tool call, then exhaustion returns plain
 * text so the turn terminates. That shape keeps the audit chain readable and
 * makes "the rows this scenario wrote" unambiguous.
 *
 * FAMILY M IS THE ONE EXCEPTION, AND IT CHANGES NOTHING FOR THE OTHERS.
 * A scenario carrying a `release` spec scripts what that spec says instead: its
 * `withToolCall` text in the same step as the tool call, and one further step per
 * `afterToolResult` entry. Every scenario WITHOUT a spec gets exactly the array
 * this function has always returned, byte for byte, which is why adding the axis
 * moved no existing count.
 *
 * Note what the extra steps are for. A claim-gate REGENERATION is a real call to
 * `LlmProvider.completeTurn`, so it consumes the next scripted step - which is
 * the mechanism family M uses to drive the bounded regeneration loop
 * deterministically without a model. When a spec's steps run out,
 * `ScriptedLlmProvider` falls back to its `finalText`, which asserts nothing, so
 * an unsupported turn ends in a truthful sentence rather than in silence. `r08`
 * supplies one more unsupported step than the bound allows, which is how it
 * reaches the withholding path instead.
 */
function scriptFor(scenario: Scenario, contactId: string) {
  const toolCalls = [
    {
      toolCallId: `sweep-${scenario.id}`,
      toolName: scenario.toolName,
      argumentsJson: renderArguments(scenario.args, contactId),
    },
  ];

  const release = scenario.release;
  if (release === undefined) {
    return [{ assistantText: NEUTRAL_SWEEP_TEXT, toolCalls }];
  }

  return [
    { assistantText: release.withToolCall === null ? null : release.withToolCall.text, toolCalls },
    ...release.afterToolResult.map((declared) => ({ assistantText: declared.text, toolCalls: [] })),
  ];
}

/** Classify a turn result without consulting what the scenario hoped for. */
function classify(toolOutcomes: readonly { ok: boolean; persisted?: unknown; code?: string }[]): {
  outcome: OutcomeKind;
  errorCode: string | null;
} {
  if (toolOutcomes.length === 0) return { outcome: 'NO_TOOL_CALL', errorCode: null };
  const rejection = toolOutcomes.find((outcome) => !outcome.ok);
  if (rejection) return { outcome: 'REJECTED', errorCode: rejection.code ?? null };
  const wrote = toolOutcomes.some((outcome) => outcome.persisted != null);
  return { outcome: wrote ? 'PERSISTED' : 'ACCEPTED_NO_WRITE', errorCode: null };
}

/** Run one scenario against an already-built runtime. */
async function runScenario(
  scenario: Scenario,
  runtime: AgentRuntime,
  testDb: TestDatabase,
  llm: ScriptedLlmProvider,
): Promise<ScenarioObservation> {
  const db = testDb.db;
  // The clock is set BEFORE the world is seeded so that `createdAt` on every
  // row belongs to the same instant the validator will call `now`.
  testDb.clock.setTo(scenario.nowUtc);

  const world: SliceWorld = await seedSliceWorld(db, {
    suffix: scenario.id.toLowerCase(),
    contactTimezone: scenario.world.contactTimezone,
    businessHoursStartLocal: scenario.world.businessHoursStartLocal,
    businessHoursEndLocal: scenario.world.businessHoursEndLocal,
    minLeadTimeMinutes: scenario.world.minLeadTimeMinutes,
    maxSchedulingHorizonDays: scenario.world.maxSchedulingHorizonDays,
    contactIsDecisionMaker: scenario.world.contactIsDecisionMaker,
    ...(scenario.world.allowedTools ? { allowedTools: scenario.world.allowedTools } : {}),
  });

  const conversation = await runtime.conversations.start({
    organizationId: world.organization.id,
    contactId: world.contact.id,
    aiAgentId: world.aiAgent.id,
    agentConfigurationId: world.agentConfiguration.id,
    channel: 'VOICE',
  });

  const base = {
    scenarioId: scenario.id,
    family: scenario.family,
    conversationId: conversation.id,
    contactId: world.contact.id,
    organizationId: world.organization.id,
    calendarRef: world.calendarConnection.calendarRef,
    contact: world.contact,
    businessHoursJson: world.agentConfiguration.businessHoursJson,
    rawProposedValue: proposedWhen(scenario.args),
  };

  const rowsBefore = await countRows(db);

  try {
    llm.setScript(scriptFor(scenario, world.contact.id));
    const result = await runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: scenario.utterance,
    });

    const rowsAfter = await countRows(db);

    // A replay is the SAME call again, in the SAME conversation, at the SAME
    // instant - so the derived idempotency key is identical by construction.
    let replayRowsAfter: DomainRowCounts | null = null;
    if (scenario.replay) {
      llm.setScript(scriptFor(scenario, world.contact.id));
      await runtime.agent.handleTurn({
        conversationId: conversation.id,
        utterance: scenario.utterance,
      });
      replayRowsAfter = await countRows(db);
    }

    const { outcome, errorCode } = classify(
      result.toolOutcomes as readonly { ok: boolean; persisted?: unknown; code?: string }[],
    );

    // Read back through the REPOSITORIES, so every row an invariant inspects
    // has been through `src/db/mappers.ts` - instants are ISO-8601 UTC strings
    // and enum columns have been re-checked on the way out. Reading raw Prisma
    // rows here would let a mapper bug pass the sweep unnoticed.
    const auditEvents = await db.audit.listByCorrelationId(result.correlationId);
    const meetings = await db.meetings.listByContact(world.contact.id);
    const futureActions = await db.futureActions.listByContact(world.contact.id);
    const qualification = await db.qualificationStates.findByContactId(world.contact.id);
    const qualificationStates = qualification ? [qualification] : [];
    const tasks = await db.tasks.listByContact(world.contact.id);

    // Asked of the SAME provider instance the validator consulted, over each
    // persisted meeting's exact window. This is the oracle for invariant 3, and
    // it is deliberately a fresh question rather than a value read back out of
    // the provenance the system wrote for itself.
    const busyOverMeetings: BusyInterval[][] = [];
    for (const meeting of meetings) {
      busyOverMeetings.push(
        await runtime.providers.availability.getBusyIntervals({
          calendarRef: world.calendarConnection.calendarRef,
          fromUtc: meeting.startUtc,
          toUtc: meeting.endUtc,
        }),
      );
    }

    return {
      ...base,
      outcome,
      errorCode,
      correlationId: result.correlationId,
      auditTypes: auditEvents.map((event) => event.type),
      auditEvents,
      rowsBefore,
      rowsAfter,
      meetings,
      futureActions,
      qualificationStates,
      tasks,
      toolOutcomes: result.toolOutcomes,
      claimGate: result.claimGate,
      assistantMessages: result.assistantMessages,
      busyOverMeetings,
      replayRowsAfter,
      stopReason: result.stopReason,
      error: null,
    };
  } catch (error) {
    // A thrown turn is a defect, not a rejection - rejections come back as
    // values. It is recorded as ERROR so the sweep reports it rather than
    // aborting and losing the other 508 results.
    return {
      ...base,
      outcome: 'ERROR',
      errorCode: null,
      correlationId: '',
      auditTypes: [],
      auditEvents: [],
      rowsBefore,
      rowsAfter: await countRows(db),
      meetings: [],
      futureActions: [],
      qualificationStates: [],
      tasks: [],
      toolOutcomes: [],
      // A thrown turn released nothing, so there is nothing for INV-18 to
      // examine. Reported as an empty report rather than as `enabled: false`,
      // which would be a LIE about the wiring - INV-13 is the invariant that
      // fails a throw, and INV-18 must not double-report it as a gate defect.
      claimGate: { enabled: true, releases: [] },
      assistantMessages: [],
      busyOverMeetings: [],
      replayRowsAfter: null,
      stopReason: 'THREW',
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

export interface RunSweepOptions {
  /** Scenarios per shared database. */
  readonly chunkSize?: number;
  /** Databases opened at once. */
  readonly concurrency?: number;
  readonly label?: string;
  /** Called after each chunk, for CLI progress. */
  readonly onProgress?: (done: number, total: number) => void;
}

/**
 * Run a corpus and return one observation per scenario, in GENERATED order.
 *
 * Never throws for a scenario-level failure: a thrown turn becomes an `ERROR`
 * observation. It throws only if the harness itself cannot start.
 */
export async function runSweep(
  scenarios: readonly Scenario[],
  options: RunSweepOptions = {},
): Promise<readonly ScenarioObservation[]> {
  const chunkSize = options.chunkSize ?? 32;
  const concurrency = options.concurrency ?? 4;
  const label = options.label ?? 'sweep';

  const chunks: Scenario[][] = [];
  for (let index = 0; index < scenarios.length; index += chunkSize) {
    chunks.push(scenarios.slice(index, index + chunkSize) as Scenario[]);
  }

  const observations = new Map<string, ScenarioObservation>();
  let completed = 0;

  async function runChunk(chunk: readonly Scenario[], chunkIndex: number): Promise<void> {
    const testDb = await createTestDatabase({
      label: `${label}-${chunkIndex}`,
      nowUtc: (chunk[0] as Scenario).nowUtc,
    });

    // Availability is configured per CALENDAR REF, and `seedSliceWorld` derives
    // the ref from the scenario id - so one provider instance serves the whole
    // chunk while still giving each scenario its own diary.
    const calendars: Record<string, { rules: ReturnType<typeof rulesFor> }> = {};
    for (const scenario of chunk) {
      calendars[`northwind-primary-${scenario.id.toLowerCase()}`] = {
        rules: rulesFor(scenario.availability, scenario.world.contactTimezone),
      };
    }

    const providers = createProviderRegistry({ availability: { options: { calendars } } });
    const llm = new ScriptedLlmProvider({});
    // MISSION 2F: THE SECOND LAYER IS A SWEPT DIMENSION, NOT A CONSTANT.
    //
    // Handed to the REAL composition root through its documented `claimVerifier`
    // seam, so every scenario still goes in through `buildAgentRuntime` exactly as
    // the demo and the production path would. What varies is which verifier the
    // root is given - the root itself still offers no way to have none.
    //
    // The double is keyed on the EXACT BYTES of a scripted text, which is what
    // makes it order-independent: a chunk of 32 scenarios shares one runtime and
    // which worker takes which chunk is not deterministic, so a verifier answering
    // a queue in call order would make the sweep's verdicts depend on scheduling.
    // Keying on the text removes that entirely, which is why INV-09 still holds and
    // why `npm run qa:sweep -- --determinism` is byte-identical.
    //
    // Every text carrying no declared behaviour gets `CLASSIFIED` with no claims -
    // the same verdict `RuleDrivenSemanticClaimVerifier` with no rules returns and
    // the same one the offline composition wires - so the 1,127 scenarios that
    // predate this mission keep byte-identical outcomes.
    const runtime = buildAgentRuntime({
      clock: testDb.clock,
      db: testDb.db,
      providers,
      llm,
      claimVerifier: new SemanticSweepVerifier(SEMANTIC_SWEEP_SCRIPT),
    });

    try {
      for (const scenario of chunk) {
        observations.set(scenario.id, await runScenario(scenario, runtime, testDb, llm));
      }
    } finally {
      completed += chunk.length;
      options.onProgress?.(completed, scenarios.length);
      await testDb.cleanup();
    }
  }

  // A fixed-size worker pool over a fixed chunk list. Which worker takes which
  // chunk does not affect any scenario's outcome, and results are re-sorted
  // below, so this is deterministic despite being concurrent.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, chunks.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        const chunk = chunks[index];
        if (chunk === undefined) return;
        await runChunk(chunk, index);
      }
    }),
  );

  return scenarios.map((scenario) => {
    const observation = observations.get(scenario.id);
    if (observation === undefined) {
      throw new Error(`Scenario "${scenario.id}" produced no observation. The sweep runner is broken.`);
    }
    return observation;
  });
}

/** The deterministic telephony double, for the "nothing was dialled" check. */
export function telephonyOf(runtime: AgentRuntime): DeterministicTelephonyProvider {
  return runtime.providers.telephony as DeterministicTelephonyProvider;
}
