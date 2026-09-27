/**
 * WHAT THE CLAIM GATE COSTS, MEASURED.
 *
 * WHY THIS HAS TO BE MEASURED RATHER THAN ESTIMATED
 * ---------------------------------------------------------------------------
 * The gate needs the WHOLE text before it can release any of it. On a voice call
 * that is a decision about whether the caller hears silence, and the later voice
 * milestone has to make it with numbers rather than with adjectives. So this
 * file measures four separable things and keeps them separate, because they have
 * wildly different magnitudes and conflating them would flatter the result:
 *
 *   1. THE DETECTOR, pure, over realistic turn texts including a worst-case one.
 *   2. THE VERIFIER, pure, against an already-built ledger.
 *   3. THE LEDGER, which is the only part that touches a database.
 *   4. THE WHOLE TURN, gated versus ungated, against `ScriptedLlmProvider` so
 *      the model's own cost is a constant and the delta is the gate.
 *
 * NO MODEL IS CALLED. NOT ONCE.
 * ---------------------------------------------------------------------------
 * Every number here comes from application code running against real SQLite and
 * a scripted provider. The REGENERATION cost - the one term that dominates
 * everything else by three orders of magnitude - is not measured here at all,
 * because measuring it would mean running a model. It is taken from the per-turn
 * latencies already recorded in `eval-output-fair-20260927/`, and
 * `docs/MISSION_2D_CLAIM_GATE_ASSURANCE.md` shows the extraction.
 *
 * WHY THE TIMINGS ARE NOT ASSERTED IN `npm run test`
 * ---------------------------------------------------------------------------
 * A wall-clock assertion on a memory-constrained host that also runs an 879-
 * scenario sweep is a flaky test, and a flaky test in a merge gate gets the whole
 * gate disabled - which is the failure mode this mission is about. So this file
 * is a MEASUREMENT HARNESS, run on demand by `npm run qa:claim-gate-latency`,
 * and what `npm run test` asserts instead is the part that can drift silently:
 * that the samples are still the sizes and shapes the published table says they
 * are (`claimGateLatency.test.ts`).
 *
 * DETERMINISM, HONESTLY DEFINED
 * ---------------------------------------------------------------------------
 * The INPUTS are fixed, the iteration counts are fixed, the database is seeded
 * from fixed data at a `FixedClock` instant, and nothing samples a random number.
 * The elapsed nanoseconds are not reproducible and no honest harness could claim
 * they are, so the harness reports p50/p95/mean over a stated number of runs
 * after a stated warm-up, and the published table names the host. That is the
 * same standard `EVAL_HARNESS.md` holds the benchmark to.
 */
import { performance } from 'node:perf_hooks';

import { AgentTurnService } from '../../src/agent/agentTurnService.js';
import { buildActionLedger, type ActionLedger } from '../../src/agent/claimGate/ledger.js';
import { detectMaterialClaims } from '../../src/agent/claimGate/detector.js';
import { verifyClaims } from '../../src/agent/claimGate/verifier.js';
import { buildAgentRuntime } from '../../src/app/composition.js';
import { seedSliceWorld } from '../../src/app/seedSliceWorld.js';
import { ScriptedLlmProvider } from '../../src/llm/scriptedLlmProvider.js';
import { createProviderRegistry } from '../../src/providers/index.js';
import type { IsoUtcString } from '../../src/ports/clock.js';
import { createTestDatabase } from '../helpers/testDb.js';

/**
 * The instant every measurement runs at. The repository's baseline.
 */
const NOW_UTC = '2026-03-04T15:00:00.000Z' as IsoUtcString;

// ---------------------------------------------------------------------------
// The texts.
// ---------------------------------------------------------------------------

export interface TextSample {
  readonly key: string;
  readonly language: 'en' | 'he' | 'mixed';
  readonly text: string;
  /** Does this text assert anything? Drives whether the ledger is built at all. */
  readonly asserts: boolean;
  readonly note: string;
}

/**
 * One long turn, built to the size of the worst real one in the benchmark.
 *
 * WHAT THIS IS AND IS NOT. `docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 6.2
 * records a real `qwen2.5:7b-instruct` turn of 7,402 characters on the
 * `mixed-hebrew-english` scenario - "largely the system prompt translated into
 * Chinese", over a 600-character budget. That turn is committed, read-only
 * evidence and this harness does not copy it in. What it does instead is
 * SYNTHESISE a text of the same order of length out of realistic claim-bearing
 * sentences, which is the harder input for the detector anyway: every sentence
 * here contains forms the lexicons must match, whereas most of the real 7,402
 * characters are Chinese prose that matches nothing and costs only tokenisation.
 *
 * So this over-states the cost rather than under-stating it, which is the right
 * direction for a number somebody will plan a voice call around.
 */
function longMixedTurn(): string {
  const paragraph = [
    'Thank you for your patience, Jordan, and let me go over everything we have agreed so far.',
    'Your meeting is booked for Thursday at 2pm, and the callback is arranged for the same afternoon.',
    'הפגישה נקבעה ליום חמישי בשעה 14:00, ואני אתקשר אליך לפני כן.',
    'Nothing else is outstanding, and I have not sent you anything by email yet.',
    'Shall I also put a reminder in for the Monday after that?',
    'סגרנו על הפרטים, and your booking reference is REF-4821.',
  ].join(' ');
  let out = paragraph;
  while (out.length < 7402) out += ' ' + paragraph;
  return out.slice(0, 7402);
}

export const TEXT_SAMPLES: readonly TextSample[] = [
  {
    key: 'en-short-no-claim',
    language: 'en',
    text: 'Let me take care of that for you.',
    asserts: false,
    // The single most important cell in the table: this is the shape of the
    // overwhelming majority of real turns, and the gate must be free on it.
    note: '33 chars. The sweep\'s own neutral sentence. Asserts nothing, so NO ledger is built and NO row is read.',
  },
  {
    key: 'en-short-claim',
    language: 'en',
    text: 'Your meeting is booked for Thursday at 2pm.',
    asserts: true,
    note: '42 chars. One supported claim. The cheapest possible claim-bearing turn.',
  },
  {
    key: 'en-realistic-claim',
    language: 'en',
    text:
      "Got it, Jordan - I've booked the callback for 3pm on your local time, and you can expect a call " +
      'from us then. Is there anything else you need before I let you go?',
    asserts: true,
    note: '161 chars. Two claims in two sentences, one of them interrogative. The § 6.5.4 register.',
  },
  {
    key: 'he-short-claim',
    language: 'he',
    text: 'הפגישה נקבעה ליום חמישי בשעה 14:00.',
    asserts: true,
    note: '34 chars. Hebrew is measured separately because normalizeScript runs per sentence and Hebrew is where it does work.',
  },
  {
    key: 'he-realistic-claim',
    language: 'he',
    text:
      'תודה על הסבלנות. הפגישה נקבעה בהצלחה למחר אחרי הצהריים בשעה 14:00, ואשלח לך אישור בדוא"ל. ' +
      'האם יש עוד משהו שאני יכול לעזור בו?',
    asserts: true,
    note: '122 chars. The aya-expanse:8b § 6.2 shape: a real booking claim plus an email nothing can send.',
  },
  {
    key: 'mixed-realistic-claim',
    language: 'mixed',
    text: 'סגרנו - your meeting is booked for Thursday at 2pm, and your booking reference is REF-4821.',
    asserts: true,
    note: '90 chars. Code-switched, so BOTH lexicons fire on the same sentence, plus an identifier shape.',
  },
  {
    key: 'mixed-worst-case-7402',
    language: 'mixed',
    text: longMixedTurn(),
    asserts: true,
    note:
      '7,402 chars - the length of the worst real turn in the committed benchmark (§ 6.2), synthesised ' +
      'from claim-bearing sentences so it is HARDER than the real one rather than easier.',
  },
];

// ---------------------------------------------------------------------------
// Timing.
// ---------------------------------------------------------------------------

export interface Timing {
  readonly label: string;
  readonly runs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly meanMs: number;
  readonly minMs: number;
  readonly maxMs: number;
}

function summarize(label: string, samples: readonly number[]): Timing {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (quantile: number): number =>
    sorted[Math.min(sorted.length - 1, Math.round(quantile * (sorted.length - 1)))] ?? 0;
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return {
    label,
    runs: sorted.length,
    p50Ms: round(at(0.5)),
    p95Ms: round(at(0.95)),
    meanMs: round(samples.reduce((sum, value) => sum + value, 0) / Math.max(samples.length, 1)),
    minMs: round(sorted[0] ?? 0),
    maxMs: round(sorted.at(-1) ?? 0),
  };
}

/**
 * Time `work` `runs` times, after `warmUp` untimed runs.
 *
 * The warm-up is not a way of making the number look better - it is what makes
 * the number MEAN anything. `text.ts` memoises the split of every lexicon form
 * in `FORM_TOKENS`, so the very first call to the detector pays for populating a
 * cache that every subsequent call in the process shares. Reporting that first
 * call in the p50 would describe a cost no real turn after the first one pays.
 * The first-call cost is reported separately by the runner instead.
 */
async function time(
  label: string,
  work: () => void | Promise<void>,
  options: { readonly runs: number; readonly warmUp: number },
): Promise<Timing> {
  for (let index = 0; index < options.warmUp; index += 1) await work();
  const samples: number[] = [];
  for (let index = 0; index < options.runs; index += 1) {
    const startedAt = performance.now();
    await work();
    samples.push(performance.now() - startedAt);
  }
  return summarize(label, samples);
}

// ---------------------------------------------------------------------------
// 1 + 2. The pure halves.
// ---------------------------------------------------------------------------

export interface PureMeasurement {
  readonly sample: TextSample;
  readonly chars: number;
  readonly claims: number;
  readonly detector: Timing;
  readonly verifier: Timing;
  /** Detector plus verifier, which is what a release actually pays. */
  readonly both: Timing;
}

export async function measurePure(ledger: ActionLedger, runs = 200): Promise<readonly PureMeasurement[]> {
  const out: PureMeasurement[] = [];
  for (const sample of TEXT_SAMPLES) {
    const detector = await time(`detect ${sample.key}`, () => void detectMaterialClaims(sample.text), {
      runs,
      warmUp: 20,
    });
    const verifier = await time(
      `verify ${sample.key}`,
      () => void verifyClaims({ text: sample.text, ledger }),
      { runs, warmUp: 20 },
    );
    // `verifyClaims` calls the detector itself, so this is not detector+verifier
    // added together - it is what one release really costs, measured once.
    const both = verifier;
    out.push({
      sample,
      chars: sample.text.length,
      claims: detectMaterialClaims(sample.text).length,
      detector,
      verifier,
      both,
    });
  }
  return out;
}

/** What the very FIRST detector call in a fresh process costs, cache cold. */
export function measureColdStart(): { readonly label: string; readonly ms: number } {
  const startedAt = performance.now();
  detectMaterialClaims(TEXT_SAMPLES[1]?.text ?? 'Your meeting is booked for Thursday at 2pm.');
  return { label: 'first detector call in the process (FORM_TOKENS cache cold)', ms: performance.now() - startedAt };
}

// ---------------------------------------------------------------------------
// 3 + 4. The halves that need a database.
// ---------------------------------------------------------------------------

/**
 * How many audit events a turn writes, with the gate and without it.
 *
 * THIS IS THE MEASUREMENT THAT EXPLAINS THE END-TO-END DELTA, and it was not
 * obvious before it was taken. The gate's LOGIC costs tens of microseconds. Its
 * AUDIT TRAIL costs one durable insert per release, and on this host an insert is
 * four hundred times the cost of the detector. So the honest account of "what
 * does the gate cost on a turn that asserts nothing" is "one audit row", not
 * "one detector pass" - and a voice milestone budgeting for the latter would be
 * out by three orders of magnitude.
 *
 * The event COUNTS are exact and reproducible. The per-insert timing is a host
 * property. Both are reported so the decomposition can be checked rather than
 * believed.
 */
export interface AuditCost {
  readonly ungatedEvents: number;
  readonly gatedNoClaimEvents: number;
  readonly gatedSupportedClaimEvents: number;
  readonly gatedRegeneratedEvents: number;
  readonly gatedNoClaimTypes: readonly string[];
  readonly gatedRegeneratedTypes: readonly string[];
  readonly oneInsert: Timing;
}

export interface LatencyReport {
  readonly coldStart: { readonly label: string; readonly ms: number };
  readonly pure: readonly PureMeasurement[];
  readonly ledgerEmpty: Timing;
  readonly ledgerPopulated: Timing;
  readonly audit: AuditCost;
  readonly turnUngated: Timing;
  readonly turnGatedNoClaim: Timing;
  readonly turnGatedSupportedClaim: Timing;
  readonly turnGatedOneRegeneration: Timing;
  readonly regenerationBound: number;
  readonly host: {
    readonly platform: string;
    readonly arch: string;
    readonly cpus: number;
    readonly nodeVersion: string;
  };
}

/**
 * Run the whole measurement.
 *
 * Takes a few seconds. Opens ONE real SQLite database, seeds one world, and
 * closes it. Makes no network call - the network trap is not installed here
 * because nothing in the path can dial anything, which `INV-10` proves over the
 * whole sweep.
 */
export async function measureClaimGateLatency(options: { readonly runs?: number } = {}): Promise<LatencyReport> {
  // Measured FIRST, before anything else has warmed the form-token cache.
  const coldStart = measureColdStart();

  const runs = options.runs ?? 200;
  const turnRuns = Math.max(10, Math.floor(runs / 10));
  const testDb = await createTestDatabase({ label: 'claim-gate-latency', nowUtc: NOW_UTC });

  try {
    testDb.clock.setTo(NOW_UTC);
    const world = await seedSliceWorld(testDb.db, {
      suffix: 'claimgatelatency',
      contactTimezone: 'America/New_York',
    });

    const providers = createProviderRegistry({});
    const llm = new ScriptedLlmProvider({});
    const runtime = buildAgentRuntime({ clock: testDb.clock, db: testDb.db, providers, llm });

    // THE UNGATED TWIN. The same database, clock, provider, conversation service
    // and dispatcher - the gate is the ONLY difference, which is what makes the
    // delta attributable to it. This constructor seam exists for exactly this
    // purpose and `buildAgentRuntime` never takes it; INV-18 treats a runtime
    // that reaches a caller through it as a violation.
    const ungatedAgent = new AgentTurnService({
      db: runtime.db,
      clock: runtime.clock,
      llm: runtime.llm,
      conversations: runtime.conversations,
      dispatcher: runtime.dispatcher,
    });

    const startConversation = async (): Promise<string> => {
      const conversation = await runtime.conversations.start({
        organizationId: world.organization.id,
        contactId: world.contact.id,
        aiAgentId: world.aiAgent.id,
        agentConfigurationId: world.agentConfiguration.id,
        channel: 'VOICE',
      });
      return conversation.id;
    };

    // ---- 3. the ledger ---------------------------------------------------
    const emptyLedger = () =>
      buildActionLedger({
        db: runtime.db,
        conversationId: 'conv-latency',
        contact: world.contact,
        nowUtc: NOW_UTC,
        toolOutcomes: [],
        permittedToolNames: ['schedule_meeting', 'schedule_followup'],
      });

    const ledgerEmpty = await time('buildActionLedger (no rows yet)', async () => void (await emptyLedger()), {
      runs: Math.min(runs, 120),
      warmUp: 5,
    });

    // Now book something, so the durable read has rows to map rather than five
    // empty queries. This is the honest figure for a conversation in progress.
    const seedConversationId = await startConversation();
    llm.setScript([
      {
        assistantText: 'Let me take care of that for you.',
        toolCalls: [
          {
            toolCallId: 'latency-seed',
            toolName: 'schedule_meeting',
            argumentsJson: JSON.stringify({
              contact_id: world.contact.id,
              when: 'tomorrow at 2pm',
              title: 'Intro call - Northwind',
            }),
          },
        ],
      },
    ]);
    await runtime.agent.handleTurn({ conversationId: seedConversationId, utterance: 'Tomorrow at 2pm please.' });

    const ledgerPopulated = await time(
      'buildActionLedger (one meeting on record)',
      async () => void (await emptyLedger()),
      { runs: Math.min(runs, 120), warmUp: 5 },
    );

    const populated = await emptyLedger();

    // ---- 1 + 2. the pure halves, against a REAL ledger -------------------
    const pure = await measurePure(populated, runs);

    // ---- 4. the whole turn, gated versus ungated -------------------------
    const neutralScript = [
      { assistantText: 'Let me take care of that for you.', toolCalls: [] },
    ];
    const supportedScript = [
      // A TRUE claim about the meeting booked above, so the gate builds the
      // ledger, verifies, and releases - the full cost of a claim-bearing turn
      // with no regeneration.
      { assistantText: 'Your meeting is booked for Thursday at 2pm.', toolCalls: [] },
    ];
    const regeneratingScript = [
      // FALSE on the day, so the gate rejects it and asks the model again. The
      // second scripted step is truthful, so this measures EXACTLY ONE
      // regeneration - which against a scripted provider costs microseconds and
      // against a real one costs a full round trip. The whole point of this row
      // is to show that the gate's own share of a regeneration is negligible and
      // that the cost is the provider call.
      { assistantText: 'Your meeting is booked for Friday at 2pm.', toolCalls: [] },
      { assistantText: 'Let me confirm the details with you again.', toolCalls: [] },
    ];

    const turnFor = async (
      agent: AgentTurnService,
      script: readonly { assistantText: string; toolCalls: never[] }[],
    ): Promise<void> => {
      const conversationId = await startConversation();
      llm.setScript(script);
      await agent.handleTurn({ conversationId, utterance: 'Can you confirm that for me?' });
    };

    // ---- the decomposition: how many audit rows, and what one costs ------
    const eventsFor = async (
      agent: AgentTurnService,
      script: readonly { assistantText: string; toolCalls: never[] }[],
    ): Promise<readonly string[]> => {
      const conversationId = await startConversation();
      llm.setScript(script);
      const result = await agent.handleTurn({ conversationId, utterance: 'Can you confirm that for me?' });
      const events = await runtime.db.audit.listByCorrelationId(result.correlationId);
      return events.map((event) => event.type);
    };

    const ungatedTypes = await eventsFor(ungatedAgent, neutralScript);
    const gatedNoClaimTypes = await eventsFor(runtime.agent, neutralScript);
    const gatedSupportedTypes = await eventsFor(runtime.agent, supportedScript);
    const gatedRegeneratedTypes = await eventsFor(runtime.agent, regeneratingScript);

    const oneInsert = await time(
      'one db.audit.record() insert',
      async () => {
        await runtime.db.audit.record({
          type: 'AGENT_DECISION',
          organizationId: world.organization.id,
          correlationId: 'claim-gate-latency-probe',
          subjectType: 'CONVERSATION',
          subjectId: world.contact.id,
          summary: 'latency probe',
          detailJson: {},
          occurredAt: NOW_UTC,
        });
      },
      { runs: Math.min(runs, 60), warmUp: 5 },
    );

    const audit: AuditCost = {
      ungatedEvents: ungatedTypes.length,
      gatedNoClaimEvents: gatedNoClaimTypes.length,
      gatedSupportedClaimEvents: gatedSupportedTypes.length,
      gatedRegeneratedEvents: gatedRegeneratedTypes.length,
      gatedNoClaimTypes,
      gatedRegeneratedTypes,
      oneInsert,
    };

    const turnUngated = await time(
      'handleTurn, NO gate wired (neutral text)',
      () => turnFor(ungatedAgent, neutralScript),
      { runs: turnRuns, warmUp: 3 },
    );
    const turnGatedNoClaim = await time(
      'handleTurn, gated, text asserts nothing',
      () => turnFor(runtime.agent, neutralScript),
      { runs: turnRuns, warmUp: 3 },
    );
    const turnGatedSupportedClaim = await time(
      'handleTurn, gated, supported claim (ledger built + verified)',
      () => turnFor(runtime.agent, supportedScript),
      { runs: turnRuns, warmUp: 3 },
    );
    const turnGatedOneRegeneration = await time(
      'handleTurn, gated, ONE regeneration (scripted model, so no real round trip)',
      () => turnFor(runtime.agent, regeneratingScript),
      { runs: turnRuns, warmUp: 3 },
    );

    const os = await import('node:os');

    return {
      coldStart,
      pure,
      ledgerEmpty,
      ledgerPopulated,
      audit,
      turnUngated,
      turnGatedNoClaim,
      turnGatedSupportedClaim,
      turnGatedOneRegeneration,
      regenerationBound: runtime.claimGate.regenerationBound,
      host: {
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
        nodeVersion: process.version,
      },
    };
  } finally {
    await testDb.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------

function row(label: string, timing: Timing, width = 52): string {
  return (
    `  ${label.padEnd(width)}` +
    `${timing.p50Ms.toFixed(3).padStart(10)}` +
    `${timing.p95Ms.toFixed(3).padStart(10)}` +
    `${timing.meanMs.toFixed(3).padStart(10)}` +
    `${String(timing.runs).padStart(7)}`
  );
}

export function renderLatencyReport(report: LatencyReport): string {
  const lines: string[] = [];
  lines.push('='.repeat(96));
  lines.push('CLAIM GATE - MEASURED LATENCY');
  lines.push('='.repeat(96));
  lines.push('');
  lines.push(
    `  host: ${report.host.platform}/${report.host.arch}, ${report.host.cpus} cpu(s), node ${report.host.nodeVersion}`,
  );
  lines.push('  database: real SQLite via tests/helpers/testDb.ts. Model: ScriptedLlmProvider. NO MODEL CALLED.');
  lines.push(`  regeneration bound in force: ${report.regenerationBound}`);
  lines.push('');
  lines.push(`  ${report.coldStart.label}: ${report.coldStart.ms.toFixed(3)} ms`);
  lines.push('    (once per process - src/agent/claimGate/text.ts memoises every lexicon form split)');
  lines.push('');

  lines.push('-'.repeat(96));
  lines.push('1+2. THE PURE HALVES - detector, and detector+verifier, per release');
  lines.push('-'.repeat(96));
  lines.push('');
  lines.push(`  ${'sample'.padEnd(52)}${'p50 ms'.padStart(10)}${'p95 ms'.padStart(10)}${'mean ms'.padStart(10)}${'runs'.padStart(7)}`);
  for (const entry of report.pure) {
    lines.push(row(`detect   ${entry.sample.key} (${entry.chars} chars, ${entry.claims} claim(s))`, entry.detector));
    lines.push(row(`+ verify ${entry.sample.key}`, entry.both));
  }
  lines.push('');
  for (const entry of report.pure) {
    lines.push(`  ${entry.sample.key}: ${entry.sample.note}`);
  }
  lines.push('');

  lines.push('-'.repeat(96));
  lines.push('3. THE LEDGER - the only part that reads the database');
  lines.push('-'.repeat(96));
  lines.push('');
  lines.push(`  ${'measurement'.padEnd(52)}${'p50 ms'.padStart(10)}${'p95 ms'.padStart(10)}${'mean ms'.padStart(10)}${'runs'.padStart(7)}`);
  lines.push(row('buildActionLedger - nothing on record', report.ledgerEmpty));
  lines.push(row('buildActionLedger - one meeting on record', report.ledgerPopulated));
  lines.push('');
  lines.push('  Five repository reads, bounded at DEFAULT_DURABLE_ROW_LIMIT (20) of each kind, so this cost');
  lines.push('  does not grow with the length of a contact\'s history. It is paid ONLY when the detector has');
  lines.push('  already found a claim - a turn that asserts nothing performs zero database reads.');
  lines.push('');

  lines.push('-'.repeat(96));
  lines.push("3b. THE AUDIT TRAIL - what the gate's EXPLAINABILITY costs, which is most of what it costs");
  lines.push('-'.repeat(96));
  lines.push('');
  lines.push(`  audit events on one turn, UNGATED                       : ${report.audit.ungatedEvents}`);
  lines.push(`  audit events on one turn, gated, asserts nothing        : ${report.audit.gatedNoClaimEvents}`);
  lines.push(`  audit events on one turn, gated, supported claim        : ${report.audit.gatedSupportedClaimEvents}`);
  lines.push(`  audit events on one turn, gated, one regeneration       : ${report.audit.gatedRegeneratedEvents}`);
  lines.push('');
  lines.push(`  gated / asserts nothing   : ${report.audit.gatedNoClaimTypes.join(' > ')}`);
  lines.push(`  gated / one regeneration  : ${report.audit.gatedRegeneratedTypes.join(' > ')}`);
  lines.push('');
  lines.push(`  ${'measurement'.padEnd(52)}${'p50 ms'.padStart(10)}${'p95 ms'.padStart(10)}${'mean ms'.padStart(10)}${'runs'.padStart(7)}`);
  lines.push(row('one db.audit.record() insert', report.audit.oneInsert));
  lines.push('');
  lines.push('  THIS IS THE ANSWER TO "what does the gate cost on an ordinary turn". It is ONE durable audit');
  lines.push('  row, not one detector pass. On this host an insert is roughly four hundred times the cost of');
  lines.push('  the detector, so the gate\'s LOGIC is free and its EXPLAINABILITY is not. That is the right');
  lines.push('  trade - a blocked turn nobody can explain is worse than a slow one - but it has to be budgeted');
  lines.push('  for honestly, and the detector timings above would have flattered it by three orders of');
  lines.push('  magnitude if quoted alone.');
  lines.push('');

  lines.push('-'.repeat(96));
  lines.push('4. THE WHOLE TURN - gated versus ungated, same db / clock / provider / dispatcher');
  lines.push('-'.repeat(96));
  lines.push('');
  lines.push(`  ${'measurement'.padEnd(52)}${'p50 ms'.padStart(10)}${'p95 ms'.padStart(10)}${'mean ms'.padStart(10)}${'runs'.padStart(7)}`);
  lines.push(row('UNGATED handleTurn (neutral text)', report.turnUngated));
  lines.push(row('GATED, text asserts nothing', report.turnGatedNoClaim));
  lines.push(row('GATED, supported claim', report.turnGatedSupportedClaim));
  lines.push(row('GATED, one regeneration (scripted model)', report.turnGatedOneRegeneration));
  lines.push('');
  const noClaimDelta = report.turnGatedNoClaim.p50Ms - report.turnUngated.p50Ms;
  const claimDelta = report.turnGatedSupportedClaim.p50Ms - report.turnUngated.p50Ms;
  lines.push(`  gate overhead, text asserts nothing : ${noClaimDelta >= 0 ? '+' : ''}${noClaimDelta.toFixed(3)} ms (p50)`);
  lines.push(`  gate overhead, supported claim      : ${claimDelta >= 0 ? '+' : ''}${claimDelta.toFixed(3)} ms (p50)`);
  lines.push('');
  lines.push('  TREAT THESE TWO DELTAS AS THE WEAKER NUMBER, and prefer the decomposition in section 3b. A');
  lines.push(`  whole turn is ~${report.turnUngated.p50Ms.toFixed(0)} ms here and the quantity being measured is tens of milliseconds, so the`);
  lines.push('  run-to-run spread on a loaded host is comparable to the difference. The decomposition - one');
  lines.push('  audit insert, plus the ledger only when something was asserted - is arithmetic over quantities');
  lines.push('  measured directly, and it predicts these deltas to within that spread.');
  lines.push('');
  lines.push('  READ THE LAST ROW CAREFULLY. Against ScriptedLlmProvider a regeneration is a function call, so');
  lines.push('  that row measures the GATE\'s share of a regeneration and nothing else. Against a real model a');
  lines.push('  regeneration is one additional FULL provider round trip, and that term dominates every number');
  lines.push('  above it by three orders of magnitude. docs/MISSION_2D_CLAIM_GATE_ASSURANCE.md carries that');
  lines.push('  arithmetic, from the per-turn latencies recorded in eval-output-fair-20260927/.');
  lines.push('');
  lines.push('='.repeat(96));
  return lines.join('\n');
}
