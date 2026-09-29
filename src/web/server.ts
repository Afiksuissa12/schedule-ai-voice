/**
 * `npm run web:demo` - the smallest browser front end for the REAL runtime.
 *
 * WHAT THIS IS
 * ---------------------------------------------------------------------------
 * A deployment shell, not a second application. Every conversation goes through
 * the one composition root (`buildAgentRuntime`), the real local model through
 * `LocalLlmProvider`, the real context assembler and business profile, the real
 * `ToolDispatcher` chokepoint, the real claim gate (both layers - the semantic
 * verifier is built by the composition root over the same local provider), real
 * SQLite persistence and the real `DueActionRunner`. The page shows what the
 * APPLICATION persisted, read back from the database - never what the model said
 * it did.
 *
 * WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * Not multi-tenant, not authenticated, not production. Each browser session gets
 * its own throwaway SQLite file seeded with one demo world; the visitor plays the
 * demo contact. Telephony and calendar are the deterministic in-process doubles:
 * nothing can dial a phone, send a message or touch a real calendar.
 *
 * PUBLIC-EXPOSURE LIMITS (it is meant to sit behind a tunnel)
 * ---------------------------------------------------------------------------
 * Only the routes below exist. No route accepts a tool name, a model name, a URL,
 * a file path, a prompt or an id other than the session id this server issued.
 * Bodies, message length, turns per session, sessions per client and live
 * sessions are all capped; model calls are serialised through one queue with a
 * bounded length. Errors are generic. Nothing from the environment is returned.
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DateTime } from 'luxon';

import { LOCAL_BRAIN_SYSTEM_PROMPT_REF } from '../agent/prompt/systemPrompt.js';
import { buildAgentRuntime, type AgentRuntime } from '../app/composition.js';
import { seedSliceWorld, type SliceWorld } from '../app/seedSliceWorld.js';
import { loadBusinessProfile } from '../context/businessProfile.js';
import { FixedClock } from '../ports/clock.js';
import type { DeterministicTelephonyProvider } from '../providers/deterministicTelephonyProvider.js';
import { createProviderRegistry, type ProviderRegistry } from '../providers/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const PUBLIC_DIR = join(HERE, 'public');

// ---------------------------------------------------------------- configuration
const PORT = Number(process.env['WEB_DEMO_PORT'] ?? 8080);
const HOST = process.env['WEB_DEMO_HOST'] ?? '0.0.0.0';
const DATA_DIR = process.env['WEB_DEMO_DATA_DIR'] ?? join(REPO_ROOT, '.tmp', 'web-demo');
const MODEL = process.env['LOCAL_LLM_MODEL'] ?? 'qwen2.5:7b-instruct';
const BASE_URL = process.env['LOCAL_LLM_BASE_URL'] ?? 'http://host.docker.internal:11434';
const NUM_CTX = 16_384;

const LIMITS = {
  bodyBytes: 4_096,
  messageChars: 500,
  turnsPerSession: 20,
  liveSessions: 25,
  sessionIdleMs: 45 * 60_000,
  sessionsPerClientPer10Min: 8,
  messagesPerClientPer10Min: 40,
  queueLength: 6,
} as const;

// ---------------------------------------------------------------- static files
const STATIC: Record<string, { body: Buffer; type: string }> = {
  '/': { body: readFileSync(join(PUBLIC_DIR, 'index.html')), type: 'text/html; charset=utf-8' },
  '/app.js': { body: readFileSync(join(PUBLIC_DIR, 'app.js')), type: 'text/javascript; charset=utf-8' },
  '/style.css': { body: readFileSync(join(PUBLIC_DIR, 'style.css')), type: 'text/css; charset=utf-8' },
};

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// ---------------------------------------------------------------- sessions
interface TranscriptEntry {
  readonly role: 'contact' | 'agent' | 'system';
  readonly text: string;
}

interface Session {
  readonly id: string;
  readonly dbPath: string;
  readonly clock: FixedClock;
  readonly providers: ProviderRegistry;
  readonly runtime: AgentRuntime;
  readonly world: SliceWorld;
  readonly conversationId: string;
  readonly transcript: TranscriptEntry[];
  userTurns: number;
  lastUsed: number;
}

const sessions = new Map<string, Session>();
const businessProfile = loadBusinessProfile();

function newId(): string {
  return randomBytes(16).toString('hex');
}

/** One schema push at startup; every session copies the empty, migrated file. */
function prepareTemplate(): string {
  mkdirSync(DATA_DIR, { recursive: true });
  const template = join(DATA_DIR, 'template.db');
  rmSync(template, { force: true });
  execFileSync(
    process.execPath,
    [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'db', 'push',
      '--schema', join(REPO_ROOT, 'prisma', 'schema.prisma'), '--skip-generate', '--accept-data-loss'],
    { cwd: REPO_ROOT, env: { ...process.env, DATABASE_URL: `file:${template}`, PRISMA_HIDE_UPDATE_MESSAGE: '1' }, stdio: 'pipe' },
  );
  return template;
}

let templatePath = '';

async function createSession(): Promise<Session> {
  const id = newId();
  const dbPath = join(DATA_DIR, `session-${id}.db`);
  copyFileSync(templatePath, dbPath);

  // The clock starts at the REAL current time so "tomorrow afternoon" means the
  // visitor's tomorrow. It is a FixedClock only so the follow-up button can move
  // it forward to the promised instant, exactly as `demo:local` does.
  const clock = new FixedClock(new Date().toISOString());
  const providers = createProviderRegistry({});
  const runtime = buildAgentRuntime({
    clock,
    datasourceUrl: `file:${dbPath}`,
    providers,
    llmProviderConfig: {
      kind: 'local',
      model: MODEL,
      baseUrl: BASE_URL,
      numCtx: NUM_CTX,
      temperature: 0,
      keepAlive: '30m',
      streamByDefault: false,
    },
    contextAssembly: { businessProfile },
  });
  const world = await seedSliceWorld(runtime.db, { systemPromptRef: LOCAL_BRAIN_SYSTEM_PROMPT_REF });
  const conversation = await runtime.conversations.start({
    organizationId: world.organization.id,
    contactId: world.contact.id,
    aiAgentId: world.aiAgent.id,
    agentConfigurationId: world.agentConfiguration.id,
    channel: 'VOICE',
  });
  const session: Session = {
    id, dbPath, clock, providers, runtime, world, conversationId: conversation.id,
    transcript: [], userTurns: 0, lastUsed: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

async function destroySession(session: Session): Promise<void> {
  sessions.delete(session.id);
  try { await session.runtime.shutdown(); } catch { /* already closed */ }
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(session.dbPath + suffix, { force: true });
}

async function sweepSessions(): Promise<void> {
  const now = Date.now();
  for (const s of [...sessions.values()]) {
    if (now - s.lastUsed > LIMITS.sessionIdleMs) await destroySession(s);
  }
}

// ---------------------------------------------------------------- what the app persisted
function localTime(isoUtc: string, zone: string): string {
  return DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(zone).toFormat("cccc d LLLL yyyy, HH:mm '('ZZZZ')'");
}

async function persistedActions(s: Session) {
  const db = s.runtime.db;
  const futureActions = await db.futureActions.listByContact(s.world.contact.id);
  const meetings = await db.meetings.listByContact(s.world.contact.id);
  return {
    futureActions: futureActions.map((a) => ({
      id: a.id, type: a.type, status: a.status,
      scheduledForUtc: a.scheduledForUtc, local: localTime(a.scheduledForUtc, a.timezone), timezone: a.timezone,
    })),
    meetings: meetings.map((m) => ({
      id: m.id, status: m.status, startUtc: m.startUtc, local: localTime(m.startUtc, m.timezone), timezone: m.timezone,
    })),
  };
}

function sessionView(s: Session) {
  return {
    sessionId: s.id,
    contactName: s.world.contact.fullName,
    contactTimezone: s.world.contact.timezone,
    company: businessProfile.company.name,
    nowLocal: localTime(s.clock.nowUtc(), s.world.contact.timezone),
    turnsLeft: LIMITS.turnsPerSession - s.userTurns,
    transcript: s.transcript,
  };
}

// ---------------------------------------------------------------- model queue
let queueTail: Promise<unknown> = Promise.resolve();
let queued = 0;
function enqueue<T>(work: () => Promise<T>): Promise<T> | null {
  if (queued >= LIMITS.queueLength) return null;
  queued += 1;
  const run = queueTail.then(work, work);
  queueTail = run.catch(() => undefined).finally(() => { queued -= 1; });
  return run;
}

// ---------------------------------------------------------------- rate limiting
const buckets = new Map<string, number[]>();
function allow(key: string, max: number, windowMs = 10 * 60_000): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { buckets.set(key, hits); return false; }
  hits.push(now); buckets.set(key, hits); return true;
}
function clientKey(req: IncomingMessage): string {
  // Behind Cloudflare the socket is the tunnel; CF-Connecting-IP is the visitor.
  const cf = req.headers['cf-connecting-ip'];
  return (Array.isArray(cf) ? cf[0] : cf) ?? req.socket.remoteAddress ?? 'unknown';
}

// ---------------------------------------------------------------- http helpers
function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > LIMITS.bodyBytes) return null;
    chunks.push(chunk as Buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch { return null; }
}

function getSession(id: unknown): Session | null {
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) return null;
  const s = sessions.get(id) ?? null;
  if (s) s.lastUsed = Date.now();
  return s;
}

// ---------------------------------------------------------------- routes
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET' && STATIC[path]) {
    const file = STATIC[path]!;
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': file.type, 'Cache-Control': 'no-cache' });
    res.end(file.body);
    return;
  }
  if (req.method === 'GET' && path === '/healthz') { send(res, 200, { ok: true }); return; }

  if (req.method === 'POST' && path === '/api/session') {
    if (!allow(`s:${clientKey(req)}`, LIMITS.sessionsPerClientPer10Min)) { send(res, 429, { error: 'Too many new conversations - please wait a few minutes.' }); return; }
    await sweepSessions();
    if (sessions.size >= LIMITS.liveSessions) { send(res, 503, { error: 'The demo is busy right now - please try again in a few minutes.' }); return; }
    const s = await createSession();
    send(res, 200, sessionView(s));
    return;
  }

  if (req.method === 'GET' && path === '/api/session') {
    const s = getSession(url.searchParams.get('id'));
    if (!s) { send(res, 404, { error: 'This conversation has expired. Start a new one.' }); return; }
    send(res, 200, { ...sessionView(s), ...(await persistedActions(s)) });
    return;
  }

  if (req.method === 'POST' && path === '/api/message') {
    const body = await readJson(req);
    const s = getSession(body?.['sessionId']);
    if (!s) { send(res, 404, { error: 'This conversation has expired. Start a new one.' }); return; }
    const text = typeof body?.['text'] === 'string' ? (body['text'] as string).trim() : '';
    if (text.length === 0 || text.length > LIMITS.messageChars) { send(res, 400, { error: `Messages must be 1-${LIMITS.messageChars} characters.` }); return; }
    if (s.userTurns >= LIMITS.turnsPerSession) { send(res, 400, { error: 'This demo conversation has reached its turn limit. Start a new one.' }); return; }
    if (!allow(`m:${clientKey(req)}`, LIMITS.messagesPerClientPer10Min)) { send(res, 429, { error: 'Too many messages - please wait a few minutes.' }); return; }

    const work = enqueue(() => s.runtime.agent.handleTurn({ conversationId: s.conversationId, utterance: text }));
    if (!work) { send(res, 503, { error: 'The model is busy with other visitors - please try again in a moment.' }); return; }
    s.userTurns += 1;
    s.transcript.push({ role: 'contact', text });
    const turn = await work;
    for (const m of turn.assistantMessages) s.transcript.push({ role: 'agent', text: m });
    const tools = turn.toolOutcomes.map((o) =>
      o.ok ? { tool: o.toolName, ok: true, detail: o.summary } : { tool: o.toolName, ok: false, detail: o.reason });
    for (const t of tools) s.transcript.push({ role: 'system', text: `${t.ok ? 'APPLICATION ACCEPTED' : 'APPLICATION REFUSED'} ${t.tool}: ${t.detail}` });
    const audit = await s.runtime.db.audit.listByCorrelationId(turn.correlationId);
    // The claim gate is fail-safe: when it cannot verify a reply it releases NO text and asks for a
    // person. Say so, rather than letting it look like silence.
    const withheld = audit.some((e) => e.type === 'CLAIM_GATE_TEXT_WITHHELD');
    if (withheld) s.transcript.push({ role: 'system', text: 'CLAIM GATE withheld the assistant reply (it could not verify it) and asked for a person.' });
    send(res, 200, {
      agent: turn.assistantMessages,
      tools,
      withheld,
      auditEvents: audit.map((e) => ({ type: e.type, summary: e.summary })),
      correlationId: turn.correlationId,
      turnsLeft: LIMITS.turnsPerSession - s.userTurns,
      ...(await persistedActions(s)),
    });
    return;
  }

  if (req.method === 'POST' && path === '/api/followup') {
    const body = await readJson(req);
    const s = getSession(body?.['sessionId']);
    if (!s) { send(res, 404, { error: 'This conversation has expired. Start a new one.' }); return; }
    const pending = (await s.runtime.db.futureActions.listByContact(s.world.contact.id)).filter((a) => a.status === 'PENDING');
    if (pending.length === 0) { send(res, 200, { ran: false, message: 'Nothing is scheduled yet, so there is no promise to keep.', ...(await persistedActions(s)) }); return; }
    const latest = pending.map((a) => Date.parse(a.scheduledForUtc)).reduce((x, y) => Math.max(x, y));
    const realNow = s.clock.nowUtc();
    s.clock.setTo(new Date(latest + 60_000).toISOString());
    const telephony = s.providers.telephony as DeterministicTelephonyProvider;
    const before = telephony.placedCalls.length;
    const pass = await s.runtime.dueActions.runDueActions();
    s.clock.setTo(realNow);
    const calls = telephony.placedCalls.slice(before).map((c) => ({ to: c.request.toE164, status: c.status }));
    s.transcript.push({ role: 'system', text: `FOLLOW-UP ENGINE executed ${pass.executed} action(s) with no model involved (simulated telephony).` });
    send(res, 200, { ran: true, executed: pass.executed, failed: pass.failed, calls, ...(await persistedActions(s)) });
    return;
  }

  send(res, 404, { error: 'Not found' });
}

async function main(): Promise<void> {
  templatePath = prepareTemplate();
  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error('[web-demo] request failed:', error instanceof Error ? error.message : error);
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong. Please start a new conversation.' });
    });
  });
  server.requestTimeout = 180_000;
  setInterval(() => { void sweepSessions(); }, 60_000).unref();
  server.listen(PORT, HOST, () => {
    console.log(`[web-demo] listening on ${HOST}:${PORT} - model ${MODEL} at num_ctx ${NUM_CTX}`);
  });
}

void main();
