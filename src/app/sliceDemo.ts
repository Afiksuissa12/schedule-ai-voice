/**
 * `npm run slice:demo` - the whole vertical slice, end to end, in one command.
 *
 * WHAT IT PROVES, IN ORDER
 * ---------------------------------------------------------------------------
 *  1. A Contact exists in America/New_York, with a persisted Conversation.
 *  2. The contact says "Can you call me back tomorrow afternoon at 3?"
 *  3. The model proposes `schedule_followup` carrying THOSE WORDS - not a
 *     timestamp it worked out for itself.
 *  4. Application code resolves and validates the datetime deterministically
 *     against a `FixedClock` and the persisted `AgentConfiguration` policy.
 *  5. A `FutureAction` is persisted with the correct UTC instant, the contact's
 *     timezone, and a non-empty `ValidationProvenance`.
 *  6. The clock moves past the promised time, one `DueActionRunner` pass runs,
 *     and the deterministic telephony double receives the CALL_CONTACT
 *     dispatch - on the SAME correlation id as the turn that made the promise.
 *  7. An adversarial turn is refused, with zero domain rows written.
 *  8. The audit chain is printed in order, followed by the five questions it
 *     has to be able to answer.
 *
 * NO NETWORK, NO SECRETS, NO SHARED STATE
 * ---------------------------------------------------------------------------
 * A `ScriptedLlmProvider` stands in for the model, the providers are the
 * deterministic doubles, and the database is a fresh SQLite file created under
 * `.tmp/` and deleted at the end. Running this cannot call a phone, write to a
 * calendar, spend money, or touch your development database. `--keep` leaves
 * the file behind if you want to poke at it.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderChain, renderChainAnswers, summarizeChain } from './auditReport.js';
import { buildAgentRuntime } from './composition.js';
import { seedSliceWorld } from './seedSliceWorld.js';
import { ADVERSARIAL, ScriptedLlmProvider, scriptedArgs, type ScriptedStep } from '../llm/scriptedLlmProvider.js';
import { FixedClock } from '../ports/clock.js';
import { parseCallContactPayload } from '../followup/payloads.js';
import type { DeterministicTelephonyProvider } from '../providers/deterministicTelephonyProvider.js';
import { createProviderRegistry } from '../providers/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

/**
 * Wednesday 2026-03-04, 10:00 America/New_York.
 *
 * A weekday inside business hours, and four days before the 2026-03-08 US DST
 * transition - close enough that "tomorrow afternoon" is unambiguous but the
 * surrounding week is not a timezone-free zone.
 */
const DEMO_NOW_UTC = '2026-03-04T15:00:00.000Z';

const THE_UTTERANCE = 'Can you call me back tomorrow afternoon at 3?';

async function main(): Promise<void> {
  const keepDatabase = process.argv.includes('--keep');
  const databasePath = join(REPO_ROOT, '.tmp', `slice-demo-${process.pid}-${randomUUID().slice(0, 8)}.db`);

  mkdirSync(dirname(databasePath), { recursive: true });
  applySchema(databasePath);

  const clock = new FixedClock(DEMO_NOW_UTC);

  // The model's whole contribution, written down before anything runs.
  // Determinism is the point: this demo produces the same output every time.
  const llm = new ScriptedLlmProvider();
  const providers = createProviderRegistry({});
  const runtime = buildAgentRuntime({ clock, datasourceUrl: `file:${databasePath}`, providers, llm });

  try {
    // ---- 1. a world -------------------------------------------------------
    const world = await seedSliceWorld(runtime.db);
    heading('1. SEEDED');
    console.log(`  Organization  ${world.organization.name} (${world.organization.defaultTimezone})`);
    console.log(`  Contact       ${world.contact.fullName} - ${world.contact.timezone}`);
    console.log(`  Agent config  v${world.agentConfiguration.version} (${world.agentConfiguration.systemPromptRef})`);
    console.log(`  Business hrs  09:00-17:00 weekdays, min lead ${world.agentConfiguration.minLeadTimeMinutes} min`);
    console.log(`  Now           ${clock.nowUtc()}  (10:00 ${world.contact.timezone})`);

    // The script was written before the contact existed, so bind the real id.
    llm.setScript(followupScript(world.contact.id));

    const conversation = await runtime.conversations.start({
      organizationId: world.organization.id,
      contactId: world.contact.id,
      aiAgentId: world.aiAgent.id,
      agentConfigurationId: world.agentConfiguration.id,
      channel: 'VOICE',
    });

    // ---- 2. the turn ------------------------------------------------------
    heading('2. THE AGENT TURN');
    console.log(`  Contact says: "${THE_UTTERANCE}"`);
    const turn = await runtime.agent.handleTurn({ conversationId: conversation.id, utterance: THE_UTTERANCE });
    console.log(`  Agent says:   "${turn.assistantText ?? '(nothing)'}"`);
    console.log(`  Correlation:  ${turn.correlationId}`);
    console.log(`  Iterations:   ${turn.iterations} (stopped: ${turn.stopReason})`);

    // ---- 3. what was actually saved ---------------------------------------
    heading('3. WHAT WAS PERSISTED');
    const futureActions = await runtime.db.futureActions.listByContact(world.contact.id);
    const action = futureActions[0];
    if (!action) throw new Error('The demo scheduled no FutureAction - the slice is broken.');

    const payload = parseCallContactPayload(action.payloadJson);
    console.log(`  FutureAction  ${action.id}`);
    console.log(`  type          ${action.type}`);
    console.log(`  scheduledFor  ${action.scheduledForUtc}  (${action.timezone})`);
    console.log(`  status        ${action.status}, attempt budget ${action.maxAttempts}`);
    console.log(`  payload       toE164=${payload.toE164} correlationId=${payload.correlationId}`);
    console.log(`  provenance    ${action.validationProvenanceJson.length} bytes, NOT NULL by schema`);

    const turns = await runtime.db.conversationTurns.listByConversation(conversation.id);
    console.log(`  Conversation  ${conversation.id} with ${turns.length} durable turns:`);
    for (const row of turns) {
      const label = row.toolName ? `${row.role}/${row.toolName}` : row.role;
      console.log(`      ${String(row.index).padStart(2, ' ')}. ${label.padEnd(28, ' ')} ${preview(row)}`);
    }

    // ---- 4. the promise is kept, with no LLM anywhere ---------------------
    heading('4. THE FOLLOW-UP ENGINE KEEPS THE PROMISE');
    console.log(`  Advancing the clock past ${action.scheduledForUtc} ...`);
    clock.setTo(new Date(Date.parse(action.scheduledForUtc) + 60_000).toISOString());
    const pass = await runtime.dueActions.runDueActions();
    console.log(`  Runner pass:  claimed=${pass.claimed} executed=${pass.executed} failed=${pass.failed}`);

    const telephony = providers.telephony as DeterministicTelephonyProvider;
    for (const call of telephony.placedCalls) {
      console.log(
        `  Dispatched:   ${call.request.toE164} from ${call.request.fromE164} -> ${call.status} ` +
          `(${call.providerCallId})`,
      );
      console.log(`                on correlationId ${call.request.correlationId}`);
    }
    const settled = await runtime.db.futureActions.requireById(action.id);
    console.log(`  FutureAction  ${settled.id} is now ${settled.status}`);

    // ---- 5. an adversarial turn is refused --------------------------------
    heading('5. AN ADVERSARIAL TURN IS REFUSED');
    clock.setTo(DEMO_NOW_UTC);
    const before = await countDomainRows(runtime);
    const hostile = new ScriptedLlmProvider({
      script: [
        {
          assistantText: 'Let me sort that out.',
          toolCalls: [ADVERSARIAL.fabricatedContactId(), ADVERSARIAL.malformedArgumentsJson()],
        },
        { assistantText: 'Sorry - I could not arrange that. Can I take a time from you?' },
      ],
    });
    const hostileRuntime = buildAgentRuntime({
      clock,
      db: runtime.db,
      providers,
      llm: hostile,
    });
    const hostileTurn = await hostileRuntime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Just book something, whenever.',
    });
    for (const outcome of hostileTurn.toolOutcomes) {
      if (!outcome.ok) {
        console.log(`  REFUSED ${outcome.toolName.padEnd(20, ' ')} ${outcome.code}`);
        console.log(`          ${outcome.reason}`);
      }
    }
    const after = await countDomainRows(runtime);
    console.log(`  Domain rows before: ${JSON.stringify(before)}`);
    console.log(`  Domain rows after:  ${JSON.stringify(after)}`);
    console.log(
      `  Unchanged: ${JSON.stringify(before) === JSON.stringify(after) ? 'YES - nothing was written' : 'NO - INVESTIGATE'}`,
    );

    // ---- 6. the audit chain -----------------------------------------------
    heading('6. THE AUDIT CHAIN FOR THE SCHEDULING TURN');
    const chain = await runtime.db.audit.listByCorrelationId(turn.correlationId);
    console.log(renderChain(chain));

    heading('7. WHAT THE CHAIN ALONE CAN TELL YOU');
    console.log(renderChainAnswers(summarizeChain(chain)));

    heading('DONE');
    console.log(`  ${chain.length} audit events on one correlationId, in sequence, explaining the whole turn.`);
    console.log('  No network was used. No key was needed. No real number was called.');
  } finally {
    await runtime.shutdown();
    if (keepDatabase) {
      console.log(`\n  Database kept at ${databasePath}`);
    } else {
      for (const suffix of ['', '-journal', '-wal', '-shm']) {
        rmSync(`${databasePath}${suffix}`, { force: true });
      }
    }
  }
}

// ---------------------------------------------------------------------------

function applySchema(databasePath: string): void {
  execFileSync(
    process.execPath,
    [
      join(REPO_ROOT, 'node_modules', 'prisma', 'build', 'index.js'),
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

/**
 * The model's script for the scheduling turn.
 *
 * Note what it does NOT do: it never converts "tomorrow afternoon at 3" into a
 * date. It passes the contact's words straight through, and application code
 * does the rest.
 */
function followupScript(contactId: string): ScriptedStep[] {
  return [
    {
      assistantText: 'Of course - let me get that booked for you.',
      toolCalls: [
        {
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
      assistantText:
        "You're all set - I'll give you a ring tomorrow, Thursday the 5th, at 3 in the afternoon your time.",
    },
  ];
}

async function countDomainRows(runtime: ReturnType<typeof buildAgentRuntime>): Promise<Record<string, number>> {
  const { prisma } = runtime.db;
  const [meetings, futureActions, qualificationStates, calls, callOutcomes, tasks] = await Promise.all([
    prisma.meeting.count(),
    prisma.futureAction.count(),
    prisma.qualificationState.count(),
    prisma.call.count(),
    prisma.callOutcome.count(),
    prisma.task.count(),
  ]);
  return { meetings, futureActions, qualificationStates, calls, callOutcomes, tasks };
}

function preview(row: { text: string | null; rawPayloadJson: string | null }): string {
  const value = row.text ?? row.rawPayloadJson ?? '';
  return value.length <= 76 ? value : `${value.slice(0, 75)}…`;
}

function heading(title: string): void {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

main().catch((error: unknown) => {
  console.error('\nslice:demo FAILED\n');
  console.error(error);
  process.exitCode = 1;
});
