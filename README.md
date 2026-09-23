# Schedule AI Voice

A production-oriented AI Voice Sales & Scheduling platform: natural-language
sales conversations, real meeting scheduling, durable conversation state, and
autonomous follow-up.

This repository is a **from-scratch rebuild**, not a port of the legacy
browser-only prototype, built by the Autonomous Development Team
(`C:\Users\afiks\AutonomousDevTeam`) against a Founder mission. This is its
**first end-to-end vertical slice**.

> **Status: Baseline V1** — Founder-reviewed and merged to `master`
> (`docs/FOUNDER_REVIEW.md`, `docs/BASELINE_V1.md`). The next milestone has
> deliberately not started yet.

---

## Quick start

Node 20 or newer. No credentials, no network, no running services.

```bash
npm install
npm run db:generate      # prisma generate (creates .env from .env.example if absent)
npm run db:push          # apply prisma/schema.prisma to ./prisma/dev.db
npm run db:seed          # one Organization / User / AiAgent / Contact / CalendarConnection

npm run slice:demo       # the whole slice, end to end, in one command
npm run verify           # typecheck + the full test suite
npm run qa:sweep         # the 601-scenario invariant sweep, with a report
```

`npm run db:setup` does generate + push + seed in one go. A committed migration
also exists, so `npm run db:migrate` (`prisma migrate deploy`) is the
deterministic alternative to `db:push`.

> **`OPENAI_API_KEY` is not required for anything above.** The whole test suite,
> the demo and the sweep run green with it unset. The single live OpenAI test
> skips cleanly when it is absent.

### All the scripts

| Command | What it does |
|---|---|
| `npm run db:generate` | Generate the Prisma client; writes `.env` from `.env.example` if missing |
| `npm run db:push` | Apply the schema to `./prisma/dev.db` |
| `npm run db:migrate` | Apply the committed migration instead (deterministic) |
| `npm run db:seed` | Seed one coherent world |
| `npm run db:setup` | generate + push + seed |
| `npm run db:reset` | Force-reset the database and re-seed |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | The full vitest suite, including the invariant sweep |
| `npm run verify` | `typecheck` then `test` |
| `npm run slice:demo` | The runnable end-to-end slice (see below) |
| `npm run qa:sweep` | The invariant sweep + QA report into `.tmp/qa/` |
| `npm run build` | Compile to `dist/` |

---

## `npm run slice:demo`

Creates its own temporary SQLite file, seeds a world, runs an agent turn against
a scripted model, persists a `FutureAction`, advances a `FixedClock` past the
promised time, dispatches the callback through the deterministic telephony
double, refuses an adversarial turn, prints the audit chain in order, and
deletes the file. Pass `--keep` to leave the database behind.

It **cannot** call a phone, write to a calendar, or spend money.

What it demonstrates, in order:

1. A `Contact` in `America/New_York` with a persisted `Conversation`.
2. The contact says *"Can you call me back tomorrow afternoon at 3?"*
3. The model proposes `schedule_followup` carrying **those words** — not a
   timestamp it worked out for itself.
4. Application code resolves and validates the datetime deterministically
   against a `FixedClock` and the persisted `AgentConfiguration` policy.
5. A `FutureAction` is persisted with the correct UTC instant, the contact's
   timezone, and a non-empty `ValidationProvenance`.
6. The clock moves past the promised time; one `DueActionRunner` pass dispatches
   the call — on the **same correlation id** as the turn that made the promise.
7. An adversarial turn is refused, with **zero** domain rows written.
8. The audit chain is printed, followed by the five questions it must answer.

---

## `npm run qa:sweep`

The invariant sweep, carrying forward the legacy QA harness's philosophy: assert
properties that must **always** hold across a matrix of inputs, rather than
writing one test per example.

**601 generated scenarios** crossing 5 contact timezones (including
`Asia/Kolkata` for its half-hour offset), 7 timezones the MODEL can assert in a
tool argument, 10 `now` instants (either side of DST transitions in both
hemispheres, a Friday afternoon, a weekend, month boundaries) plus 5 sub-minute
instants straddling the minimum-lead-time boundary, 17 time expressions,
4 persisted policies, 4 availability states and 6 tool shapes — against
**12 per-scenario invariants** plus determinism and a network trap.

`INV-14` is the one worth naming here: for every persisted `Meeting` and
`FutureAction` it re-reads the instant on the clock of the person who will
actually be contacted, using `Contact.timezone` off the row rather than the zone
the slot was agreed in. That distinction is a guardrail, not a formality — see
`businessHoursAnchor` in `src/scheduling/businessHours.ts`.

```bash
npm run qa:sweep                        # all 601, report to stdout and .tmp/qa/
npm run qa:sweep -- --determinism       # run the corpus TWICE and compare
npm run qa:sweep -- --family B          # just one family
npm run qa:sweep -- --concurrency 8
```

Exits non-zero if any invariant fails, anything reaches the network, or a
requested determinism check disagrees. The report deliberately prints **what the
sweep does not cover** as prominently as what it does.

Generation is fully deterministic — fixed seed, no `Date.now()`, no unseeded
randomness, no network — and every scenario has a stable id that appears in the
failure message and is enough to reproduce it on its own.

---

## What this slice does

**Contact → persistent Conversation → AI agent turn → structured tool call →
deterministic datetime/timezone validation → Availability Provider → persisted
Meeting or FutureAction → auditable event trail.**

The governing rule, in one sentence: **the LLM reasons and converses, but
application code owns state and executes actions.**

- **Durable conversations.** History is rebuilt from `ConversationTurn` rows
  every turn. Nothing business-critical lives in a context window.
- **A single validation chokepoint.** `ToolDispatcher`
  (`src/agent/tools/dispatcher.ts`) is the only path from model to effect:
  unknown tool → strict schema → policy allowlist → subject resolved *from the
  database* → nine ordered datetime checks. **On any rejection, zero domain
  rows.**
- **Deterministic datetime resolution.** The model passes the contact's own
  words; application code resolves them against the zone, DST, lead time,
  horizon, business hours and the diary — and records exactly how in
  `ValidationProvenance`.
- **Durable follow-up.** A promised callback is a database row with a validated
  instant, executed by a background runner with atomic claim/lease, exponential
  backoff and a bounded attempt budget. No broker, nothing paid.
- **An audit trail that explains itself.** One `correlationId` per turn,
  threaded through everything — including a callback executed days later.
- **Nine tools, fully executed.** Nothing is a no-op; an unexecutable request
  refuses in structured, audited form rather than silently succeeding.

## What this slice deliberately does **not** do

| Not built | Where it is recorded |
|---|---|
| **Authentication / authorization.** No password hashes, no sessions, no API keys. Tenancy is in the schema but nothing enforces it | `docs/DECISIONS.md` § 1.6 |
| **Real telephony.** A call is *dispatched* through a deterministic double; no audio is carried. Live media, STT, TTS and barge-in are a separate build | `docs/LEGACY_LESSONS.md` § 3.2 |
| **Real calendar integration.** No OAuth, no tokens stored, no invitations delivered | `docs/DECISIONS.md` § 1.2 |
| **A hosted database.** File-based SQLite | `docs/DECISIONS.md` § 1.3 |
| **Secrets management.** A git-ignored `.env` and nothing more | `docs/DECISIONS.md` § 1.4 |
| **Any paid external service.** Nothing was purchased, activated or configured | `docs/DECISIONS.md` § 1 |
| **An HTTP API or a UI.** This slice is driven by its composition root | — |

> **No paid service was signed up for, no credential was created or committed,
> no real phone number was dialled, no real calendar was written to, and no
> message was sent to any real person during this mission.** Every external
> dependency sits behind a port with a deterministic double, and
> `createProviderRegistry` **throws** rather than silently falling back if asked
> for a real vendor.

---

## Documentation

| Document | What is in it |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The architecture as built: layers, ports, the validation chokepoint, the datetime pipeline, the follow-up engine, the audit model, and the full utterance→persisted-follow-up sequence |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | **Start with § 1 FOUNDER DECISIONS REQUIRED.** Then: why SQLite, why OpenAI, why deterministic doubles, exact policy defaults and where they are configured, the qualification rubric and its cap |
| [`docs/LEGACY_LESSONS.md`](docs/LEGACY_LESSONS.md) | What was re-expressed from the legacy prototype, which of its limitations are structurally eliminated, and which are only *partially* addressed |
| `FOUNDATION_CONTRACT.md` | Schema, repositories, audit store, ports, test helpers |
| `SCHEDULING_CONTRACT.md` | Datetime resolution and validation, provider doubles, meetings, durable follow-up |
| `AGENT_CONTRACT.md` | LLM boundary, guardrailed prompt, the nine tools, the dispatcher chokepoint, conversations, the agent turn |

### Layout

```
prisma/schema.prisma      18 models, one committed migration
src/ports/                Clock, Availability, Calendar, Telephony, Llm, Validation
src/domain/               entities, enums, provenance schema, business hours
src/db/                   Prisma repositories, mappers, transactions
src/audit/                the append-only, per-correlation-id trail
src/scheduling/           resolver, validator, policy, MeetingSchedulingService
src/followup/             FutureActionService, DueActionRunner
src/providers/            deterministic Availability / Calendar / Telephony doubles
src/llm/                  ScriptedLlmProvider + the ONE file importing a vendor SDK
src/conversation/         durable conversation + turn log
src/agent/                prompt, the nine tools, the dispatcher, AgentTurnService
src/app/                  composition root, seed world, slice demo, audit report
tests/invariants/         the 601-scenario sweep
tests/qa/                 the sweep report + `npm run qa:sweep`
```

---

## Legacy reference (read-only, not part of this repo)

- `C:\Users\afiks\AI_Scheduling_Agent_Legacy_Export\REBUILD_NOTES.md`
- `C:\Users\afiks\AI_Scheduling_Agent_Legacy_Export\legacy_project\PLAN.md`

**These were not reachable from the environment this slice was built in.**
`docs/LEGACY_LESSONS.md` is written from the mission brief's description of the
legacy system, and nothing in this repository is attributed to files that could
not be read. See `docs/DECISIONS.md` § 2.
