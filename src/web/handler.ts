/**
 * The Schedule AI Voice web demo - a STATELESS request handler over the real runtime.
 *
 * Stateless so it can run as a serverless function (Vercel), where consecutive requests may land
 * on different instances and there is no durable local disk. All state lives in the database:
 *
 *   - Each visitor session is its own demo world (organization, user, agent, configuration,
 *     contact, calendar connection), seeded with a unique suffix into ONE shared database.
 *   - The browser holds a session token: the ids of that world and its conversation, signed with
 *     an HMAC key derived from a server-side secret. It cannot be forged or pointed at another
 *     visitor's world, and it carries nothing secret.
 *   - Every request rebuilds the runtime over the shared database client, exactly as the local
 *     demo does, and reads the transcript and the persisted actions back from the database.
 *
 * Every turn goes through the one composition root: the real model provider, the real
 * `ToolDispatcher` validation, the real claim gate (both layers - the server refuses to serve if
 * the semantic verifier is not the real LLM verifier), real persistence, the real audit trail and
 * the real `DueActionRunner` (scoped to the visitor's own organization).
 *
 * Public surface: GET / /app.js /style.css /healthz; POST /api/session; GET /api/session;
 * POST /api/message; POST /api/followup. Everything else is 404.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DateTime } from 'luxon';

import { LOCAL_BRAIN_SYSTEM_PROMPT_REF } from '../agent/prompt/systemPrompt.js';
import { buildAgentRuntime, type AgentRuntime, type BuildAgentRuntimeOptions } from '../app/composition.js';
import { seedSliceWorld } from '../app/seedSliceWorld.js';
import { loadBusinessProfile } from '../context/businessProfile.js';
import { createDatabase, type Database } from '../db/index.js';
import { OpenAiLlmProvider } from '../llm/openAiLlmProvider.js';
import { FixedClock } from '../ports/clock.js';
import type { DeterministicTelephonyProvider } from '../providers/deterministicTelephonyProvider.js';
import { createProviderRegistry } from '../providers/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, 'public');
const NUM_CTX = 16_384;

// ---------------------------------------------------------------- model backend
// 'openrouter' = Qwen 2.5 7B Instruct through OpenRouter's OpenAI-compatible API (cloud hosting);
// 'local'      = Ollama on the host (the original local demo). Keys come from the environment only.
const LLM_BACKEND = process.env['WEB_DEMO_LLM'] === 'openrouter' ? 'openrouter' : 'local';
const OPENROUTER_MODEL = process.env['OPENROUTER_MODEL'] ?? 'qwen/qwen-2.5-7b-instruct';
const LOCAL_MODEL = process.env['LOCAL_LLM_MODEL'] ?? 'qwen2.5:7b-instruct';
const LOCAL_BASE_URL = process.env['LOCAL_LLM_BASE_URL'] ?? 'http://host.docker.internal:11434';
export const MODEL_LABEL =
  LLM_BACKEND === 'openrouter' ? `${OPENROUTER_MODEL} via OpenRouter` : `${LOCAL_MODEL} via local Ollama`;

function modelOptions(): Pick<BuildAgentRuntimeOptions, 'llm' | 'llmProviderConfig'> {
  if (LLM_BACKEND === 'openrouter') {
    const apiKey = process.env['OPENROUTER_API_KEY'] ?? '';
    if (apiKey.trim().length === 0) throw new Error('WEB_DEMO_LLM=openrouter requires OPENROUTER_API_KEY.');
    return {
      llm: new OpenAiLlmProvider({
        apiKey,
        baseUrl: 'https://openrouter.ai/api/v1',
        model: OPENROUTER_MODEL,
        temperature: 0,
        timeoutMs: 45_000,
        structuredOutput: true,
        defaultHeaders: { 'X-Title': 'Schedule AI Voice (student demo)' },
      }),
    };
  }
  return {
    llmProviderConfig: {
      kind: 'local', model: LOCAL_MODEL, baseUrl: LOCAL_BASE_URL, numCtx: NUM_CTX,
      temperature: 0, keepAlive: '30m', streamByDefault: false,
    },
  };
}

// ---------------------------------------------------------------- limits
const LIMITS = {
  bodyBytes: 4_096,
  messageChars: 500,
  turnsPerSession: 20,
  sessionMaxAgeMs: 6 * 60 * 60_000,
  sessionsPerClientPer10Min: 8,
  messagesPerClientPer10Min: 40,
  turnsPerInstancePerDay: 1500,
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

// ---------------------------------------------------------------- database (one client per instance)
let dbSingleton: Database | null = null;
function database(): Database {
  if (dbSingleton) return dbSingleton;
  let url = process.env['DATABASE_URL'] ?? '';
  if (url.length === 0) throw new Error('DATABASE_URL is not set.');
  // Neon's pooled endpoint runs PgBouncer in transaction mode; tell Prisma so it avoids
  // named prepared statements. Harmless on a direct connection; not applied to SQLite.
  if (url.startsWith('postgres') && !/[?&]pgbouncer=/.test(url)) url += (url.includes('?') ? '&' : '?') + 'pgbouncer=true';
  dbSingleton = createDatabase({ datasourceUrl: url, clock: new FixedClock(new Date().toISOString()) });
  return dbSingleton;
}

const businessProfile = loadBusinessProfile();

function runtimeFor(clock: FixedClock): { runtime: AgentRuntime; telephony: DeterministicTelephonyProvider } {
  const providers = createProviderRegistry({});
  const runtime = buildAgentRuntime({
    clock,
    db: database(),
    providers,
    ...modelOptions(),
    contextAssembly: { businessProfile, budget: { modelNumCtx: NUM_CTX } },
  });
  const verifierName = runtime.claimGate.semanticVerifier?.verifierName ?? 'none';
  if (verifierName !== 'llm-semantic-claim-verifier') {
    throw new Error(`Refusing to serve: semantic claim verifier is '${verifierName}', not the real LLM verifier.`);
  }
  return { runtime, telephony: providers.telephony as DeterministicTelephonyProvider };
}

// ---------------------------------------------------------------- signed session tokens
interface SessionClaims {
  readonly v: 1;
  readonly org: string;
  readonly contact: string;
  readonly conv: string;
  readonly tz: string;
  readonly name: string;
  readonly iat: number;
}

function signingKey(): Buffer {
  const secret = process.env['SESSION_SECRET'] ?? process.env['OPENROUTER_API_KEY'] ?? process.env['DATABASE_URL'] ?? '';
  if (secret.length < 16) throw new Error('No server-side secret available to sign session tokens.');
  return createHash('sha256').update(`schedule-ai-voice-session:${secret}`).digest();
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function issueToken(claims: SessionClaims): string {
  const body = b64url(Buffer.from(JSON.stringify(claims), 'utf8'));
  const mac = b64url(createHmac('sha256', signingKey()).update(body).digest());
  return `${body}.${mac}`;
}

function readToken(token: unknown): SessionClaims | null {
  if (typeof token !== 'string' || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [body, mac] = token.split('.') as [string, string];
  const expected = createHmac('sha256', signingKey()).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionClaims;
    if (claims.v !== 1 || Date.now() - claims.iat > LIMITS.sessionMaxAgeMs) return null;
    return claims;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- rate limiting (best effort, per instance)
const buckets = new Map<string, number[]>();
function allow(key: string, max: number, windowMs = 10 * 60_000): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { buckets.set(key, hits); return false; }
  hits.push(now); buckets.set(key, hits);
  if (buckets.size > 5000) buckets.clear();
  return true;
}
let dayKey = '';
let turnsToday = 0;
function underDailyCap(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) { dayKey = today; turnsToday = 0; }
  if (turnsToday >= LIMITS.turnsPerInstancePerDay) return false;
  turnsToday += 1;
  return true;
}
function clientKey(req: IncomingMessage): string {
  const header = (name: string): string | undefined => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  // Vercel sets x-real-ip / x-forwarded-for; Cloudflare sets cf-connecting-ip.
  return header('x-real-ip') ?? header('cf-connecting-ip') ?? header('x-forwarded-for')?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
}

// ---------------------------------------------------------------- views of persisted state
function localTime(isoUtc: string, zone: string): string {
  return DateTime.fromISO(isoUtc, { zone: 'utc' }).setZone(zone).toFormat("cccc d LLLL yyyy, HH:mm '('ZZZZ')'");
}

async function persistedActions(db: Database, contactId: string) {
  const futureActions = await db.futureActions.listByContact(contactId);
  const meetings = await db.meetings.listByContact(contactId);
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

/** The visible transcript, read back from the persisted conversation turns. */
async function transcript(db: Database, conversationId: string) {
  const conv = await db.conversations.requireByIdWithTurns(conversationId);
  const entries: { role: 'contact' | 'agent' | 'system'; text: string }[] = [];
  for (const t of conv.turns) {
    if (t.role === 'CONTACT' && t.text) entries.push({ role: 'contact', text: t.text });
    else if (t.role === 'AGENT' && t.text && !t.toolName) entries.push({ role: 'agent', text: t.text });
  }
  const contactTurns = entries.filter((e) => e.role === 'contact').length;
  return { entries, contactTurns };
}

function sessionView(c: SessionClaims, token: string, turnsUsed: number) {
  return {
    sessionId: token,
    contactName: c.name,
    contactTimezone: c.tz,
    company: businessProfile.company.name,
    model: MODEL_LABEL,
    nowLocal: localTime(new Date().toISOString(), c.tz),
    turnsLeft: LIMITS.turnsPerSession - turnsUsed,
  };
}

// ---------------------------------------------------------------- http helpers
function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  // Some serverless runtimes pre-parse the body.
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined) {
    const v = typeof pre === 'string' ? safeParse(pre) : pre;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > LIMITS.bodyBytes) return null;
    chunks.push(chunk as Buffer);
  }
  const v = safeParse(Buffer.concat(chunks).toString('utf8') || '{}');
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function safeParse(text: string): unknown {
  if (text.length > LIMITS.bodyBytes) return null;
  try { return JSON.parse(text); } catch { return null; }
}

const EXPIRED = 'This conversation has expired. Start a new one.';

// ---------------------------------------------------------------- routes
async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  const file = req.method === 'GET' ? STATIC[path] : undefined;
  if (file) {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': file.type, 'Cache-Control': 'no-cache' });
    res.end(file.body);
    return;
  }
  if (req.method === 'GET' && path === '/healthz') { send(res, 200, { ok: true }); return; }

  if (req.method === 'POST' && path === '/api/session') {
    if (!allow(`s:${clientKey(req)}`, LIMITS.sessionsPerClientPer10Min)) { send(res, 429, { error: 'Too many new conversations - please wait a few minutes.' }); return; }
    const clock = new FixedClock(new Date().toISOString());
    const { runtime } = runtimeFor(clock);
    const world = await seedSliceWorld(runtime.db, { suffix: randomBytes(8).toString('hex'), systemPromptRef: LOCAL_BRAIN_SYSTEM_PROMPT_REF });
    const conversation = await runtime.conversations.start({
      organizationId: world.organization.id,
      contactId: world.contact.id,
      aiAgentId: world.aiAgent.id,
      agentConfigurationId: world.agentConfiguration.id,
      channel: 'VOICE',
    });
    const claims: SessionClaims = {
      v: 1, org: world.organization.id, contact: world.contact.id, conv: conversation.id,
      tz: world.contact.timezone, name: world.contact.fullName, iat: Date.now(),
    };
    const token = issueToken(claims);
    send(res, 200, { ...sessionView(claims, token, 0), transcript: [] });
    return;
  }

  if (req.method === 'GET' && path === '/api/session') {
    const token = url.searchParams.get('id');
    const c = readToken(token);
    if (!c) { send(res, 404, { error: EXPIRED }); return; }
    const db = database();
    const t = await transcript(db, c.conv);
    send(res, 200, { ...sessionView(c, token as string, t.contactTurns), transcript: t.entries, ...(await persistedActions(db, c.contact)) });
    return;
  }

  if (req.method === 'POST' && path === '/api/message') {
    const body = await readJson(req);
    const token = body?.['sessionId'];
    const c = readToken(token);
    if (!c) { send(res, 404, { error: EXPIRED }); return; }
    const text = typeof body?.['text'] === 'string' ? (body['text'] as string).trim() : '';
    if (text.length === 0 || text.length > LIMITS.messageChars) { send(res, 400, { error: `Messages must be 1-${LIMITS.messageChars} characters.` }); return; }
    if (!allow(`m:${clientKey(req)}`, LIMITS.messagesPerClientPer10Min)) { send(res, 429, { error: 'Too many messages - please wait a few minutes.' }); return; }
    const db = database();
    const before = await transcript(db, c.conv);
    if (before.contactTurns >= LIMITS.turnsPerSession) { send(res, 400, { error: 'This demo conversation has reached its turn limit. Start a new one.' }); return; }
    if (!underDailyCap()) { send(res, 503, { error: 'The demo has reached its daily usage limit. Please try again tomorrow.' }); return; }

    const clock = new FixedClock(new Date().toISOString());
    const { runtime } = runtimeFor(clock);
    const turn = await runtime.agent.handleTurn({ conversationId: c.conv, utterance: text });
    const tools = turn.toolOutcomes.map((o) =>
      o.ok ? { tool: o.toolName, ok: true, detail: o.summary } : { tool: o.toolName, ok: false, detail: o.reason });
    const audit = await db.audit.listByCorrelationId(turn.correlationId);
    const withheld = audit.some((e) => e.type === 'CLAIM_GATE_TEXT_WITHHELD');
    send(res, 200, {
      agent: turn.assistantMessages,
      tools,
      withheld,
      auditEvents: audit.map((e) => ({ type: e.type, summary: e.summary })),
      correlationId: turn.correlationId,
      turnsLeft: LIMITS.turnsPerSession - (before.contactTurns + 1),
      ...(await persistedActions(db, c.contact)),
    });
    return;
  }

  if (req.method === 'POST' && path === '/api/followup') {
    const body = await readJson(req);
    const c = readToken(body?.['sessionId']);
    if (!c) { send(res, 404, { error: EXPIRED }); return; }
    const db = database();
    const pending = (await db.futureActions.listByContact(c.contact)).filter((a) => a.status === 'PENDING');
    if (pending.length === 0) { send(res, 200, { ran: false, message: 'Nothing is scheduled yet, so there is no promise to keep.', ...(await persistedActions(db, c.contact)) }); return; }
    const latest = pending.map((a) => Date.parse(a.scheduledForUtc)).reduce((x, y) => Math.max(x, y));
    // Simulate the promised time arriving: the clock moves forward for THIS run only, and the
    // runner is scoped to this visitor's own organization.
    const clock = new FixedClock(new Date(latest + 60_000).toISOString());
    const { runtime, telephony } = runtimeFor(clock);
    const pass = await runtime.dueActions.runDueActions(clock.nowUtc(), { organizationId: c.org });
    const calls = telephony.placedCalls.map((call) => ({ to: call.request.toE164, status: call.status }));
    send(res, 200, { ran: true, executed: pass.executed, failed: pass.failed, calls, ...(await persistedActions(db, c.contact)) });
    return;
  }

  send(res, 404, { error: 'Not found' });
}

/** The single entry point, shared by the local listener and the serverless function. */
export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await route(req, res);
  } catch (error: unknown) {
    console.error('[web-demo] request failed:', error instanceof Error ? error.message : 'unknown error');
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong. Please start a new conversation.' });
  }
}
