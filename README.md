# Schedule AI Voice

A production-oriented AI Voice Sales & Scheduling platform: natural-language
sales conversations, real meeting scheduling, durable conversation state, and
autonomous follow-up.

This repository is a **from-scratch rebuild**, not a port of the legacy
browser-only prototype, built by the Autonomous Development Team
(`C:\Users\afiks\AutonomousDevTeam`) against a Founder mission. This is its
**first end-to-end vertical slice**.

> **Status: Baseline V1** — Founder-reviewed and merged to `master`
> (`docs/FOUNDER_REVIEW.md`, `docs/BASELINE_V1.md`).
>
> **Mission 2 — Local AI Brain: awaiting Founder review.** A real language model
> running on your own hardware now drives the conversation, opt-in, behind the
> same `LlmProvider` port — see [**the local AI brain**](#the-local-ai-brain-mission-2)
> below and the review package
> [`docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md`](docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md).
> Nothing about the Baseline V1 path changed: it is still the default, still
> offline, still deterministic, and still needs no credential.

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

The local-brain scripts — `demo:local`, `llm:*`, `context:*`, `check:anti-scripting`,
`eval:*` — are listed with their prerequisites [below](#the-local-ai-brain-mission-2).
None of them is needed for anything in this section.

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

## The local AI brain (Mission 2)

**Awaiting Founder review.** Review package:
[`docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md`](docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md),
alongside [`docs/FOUNDER_REVIEW.md`](docs/FOUNDER_REVIEW.md), which is where it
belongs. It sat at the repository root for three branches only because the
mission that produced it had no write access to `docs/`; that move has now been
made.

`docs/BASELINE_V1.md` § 4 records a Founder directive: **customer-facing
conversation must not be scripted.** It must be generated, in the moment, from
the conversation, durable history, contact context, business/product context,
qualification state, previous conversations, tool results and the current
objective. Mission 2 is that directive implemented, with the model running on
your own hardware instead of a vendor's API.

Three things were added, all **opt-in**, none of which changed the Baseline V1
path:

- **`LocalLlmProvider`** (`src/llm/localLlmProvider.ts`) — a real model served by
  [Ollama](https://ollama.com) on the host, behind the same `LlmProvider` port as
  `ScriptedLlmProvider` and `OpenAiLlmProvider`. It holds no clock, no timezone
  and no database handle, and it gets no more authority than the scripted double
  has: it returns `argumentsJson` as a raw, unparsed, untrusted string and
  `ToolDispatcher` still decides everything. Details: `LOCAL_PROVIDER.md`.
- **Conversation memory and business context** (`src/conversation/`,
  `src/context/`) — a bounded, durable, cross-session context assembler and a
  validated business/product/persona profile
  (`src/context/profiles/default.json`), so a returning contact is not greeted as
  a stranger and a price question is answered from data rather than invented.
  Details: `CONVERSATION_CONTEXT.md`.
- **An evaluation harness** (`src/eval/`) — real candidate models run through the
  real product and scored on conversation quality first. Details:
  `EVAL_HARNESS.md`.

### Prerequisites

Only for this section. Everything above still needs nothing.

1. **Ollama running on the host**, reachable from wherever this repository runs.
   `LOCAL_LLM_BASE_URL` defaults to `http://host.docker.internal:11434` because
   this project is developed inside a container, and inside a container
   `localhost` is the container. On bare metal set
   `LOCAL_LLM_BASE_URL=http://localhost:11434`.
2. **The model pulled**: `ollama pull qwen2.5:7b-instruct` (or whichever tag you
   configure). A 7–8B model at Q4_K_M wants roughly 5–6 GiB of VRAM at the
   context lengths used here.
3. `npm run llm:probe` answers "is any of this true on this machine" before you
   debug anything else.

**`OPENAI_API_KEY` is still not required, and still empty in `.env.example`.**
No vendor API is called on any path in this repository. The local path talks to
your Ollama instance and to nothing else.

### Running it

```bash
npm run llm:probe               # is Ollama up, what is on it, what is resident
npm run demo:local              # THE DEMO: a real model, a real conversation, real guardrails
npm run llm:verify              # mapping regression + probe + a real multi-turn smoke test
npm run context:verify          # the anti-scripting check + 9 deterministic context proofs
```

`npm run demo:local` is the local-brain counterpart to `npm run slice:demo`, and
`slice:demo` is unchanged — still scripted, still offline, still byte-identical
every run, still the default. `demo:local` instead runs **three real turns of a
real conversation** against a real local model: a returning contact whose
previous call the assembler carries forward, a product-and-price question
answered from the business profile, and a callback request the model must pass
through in the contact's own words. It then prints what application code did with
all of it — the raw `argumentsJson` the model proposed, the dispatcher's verdict,
the persisted `FutureAction` and its provenance, the `DueActionRunner` keeping the
promise with no model involved, the audit chain on one correlation id, and
per-turn time-to-first-token and tokens/second.

**A fourth contact utterance is spoken only when it is needed.** If the three
scripted turns end with nothing on the books — because the model asked to confirm
the contact's bare "at 3", which the `ASK_WHEN_AMBIGUOUS` guardrail clause tells
it to do, or because what it proposed was refused — the contact answers, once.
That is a cap, not a retry loop, and it is printed under its own heading.

**What the run's exit code is gated on.** The failing checks are the ones
application code guarantees on every run with every model: no tool argument
carrying an instant the model resolved for itself, no prewritten sentence
reaching the contact, the non-vacuity control firing, one correlation id
explaining the scheduling turn, and — when something was booked — the follow-up
engine dispatching it. **Whether the model proposes a booking at all is printed
as a labelled observation, not scored as a check**, because it is model behaviour
that varies run to run; the benchmark's scheduling-intent rate is the number that
measures it. See `docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 8.6.

Its last section is the directive's evidence: every sentence the agent said is
checked against **every string literal under `src/`**, and the check carries a
known-scripted control line that must be caught so a green result cannot be
vacuous. Useful flags: `--model <tag>`, `--num-ctx <n>`, `--base-url <url>`,
`--rolling-summary`, `--keep`, `--json`.

It still cannot call a phone, write to a calendar, or spend money: the clock is a
`FixedClock`, the providers are the deterministic doubles, and the database is a
throwaway SQLite file deleted on exit.

### Turning the local model on in your own code

Opt-in means opt-in: `LLM_PROVIDER=local` sitting in an environment is **not**
sufficient. `buildAgentRuntime` reads no environment variable and defaults to
`ScriptedLlmProvider`; something has to construct the configuration and hand it
in. That is what keeps the sweep's network trap at zero attempts while the local
provider lives in the same source tree.

```ts
import { buildAgentRuntime } from './src/app/composition.js';
import { loadBusinessProfile } from './src/context/businessProfile.js';

const runtime = buildAgentRuntime({
  llmProviderConfig: { kind: 'local', model: 'qwen2.5:7b-instruct', numCtx: 16384 },
  contextAssembly: { businessProfile: loadBusinessProfile() },  // omit for the Baseline V1 turn
});
```

`contextAssembly` wires the context assembler, puts the business profile behind
`get_contact_context`, and optionally starts the rolling-summary writer
(`memory: true`, off by default because it costs an extra model call per
compaction). Omitting it gives the Baseline V1 turn exactly.

Two things worth knowing about `num_ctx` on this path:

- **The context budget's `modelNumCtx` and the provider's `num_ctx` must not
  disagree.** Ollama does not reject an over-long prompt and does not report one:
  it silently **drops whole older messages**. The system prompt survives — so the
  guardrail clauses are safe — and what disappears is the conversation history,
  with `prompt_eval_count` reporting the post-drop figure so the turn looks like
  it fitted. `buildAgentRuntime` derives the budget from the provider it is
  building, and throws rather than letting the two drift.
- **8192 is not enough once the context layer is on**, which is why `.env.example`
  now ships 16384. At 8192 the context budget ladder has to drop
  `drop-pricing-detail`, so the agent silently loses the ability to answer "what
  does it cost" — nothing errors, it just changes the subject. Measured cost of
  16384 over 8192: ~0.45 GiB of VRAM.

Note that **`.env` is loaded whether you ask for it or not**: `dotenv` arrives
transitively through `@prisma/config`, so importing `@prisma/client` reads `.env`
into `process.env`. Whatever is in your `.env` beats the defaults in the source.

**And `npm run db:generate` will not update an existing `.env`** — it copies
`.env.example` only when `.env` is absent. If you have a `.env` from before
`LOCAL_LLM_NUM_CTX` was raised to 16384, it still says 8192 and 8192 is what
applies. Update it by hand, or delete `.env` and re-run.

### Configuration

Every key is optional, defaulted, and Zod-validated. A clone with no `.env` at
all runs the whole test suite and both demos.

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `scripted` | `scripted` \| `local` \| `openai`. States an intent; does not by itself reach a model |
| `LOCAL_LLM_BASE_URL` | `http://host.docker.internal:11434` | Not `localhost` inside a container |
| `LOCAL_LLM_MODEL` | `qwen2.5:7b-instruct` | Must be present on the host |
| `LOCAL_LLM_TEMPERATURE` | `0` | The agent follows a procedure; it is not being creative |
| `LOCAL_LLM_TOP_P` | *(unset)* | Empty leaves the model's own default |
| `LOCAL_LLM_NUM_CTX` | **`16384`** | The nine tool schemas alone cost ~2,354 prompt tokens, and at 8192 the context budget has to drop the pricing facts entirely — see above |
| `LOCAL_LLM_TIMEOUT_MS` | `120000` | Covers the **whole** request including generation, streaming included. A cold 7B load costs 2–4 s |
| `LOCAL_LLM_KEEP_ALIVE` | `5m` | Residency turns a ~4.9 s turn into a ~0.9 s one |

### The local-brain scripts

| Command | Needs a live Ollama? | What it does |
|---|---|---|
| `npm run demo:local` | **yes** | The integrated demo: real model, real conversation, real dispatcher, real audit trail |
| `npm run llm:probe` | **yes** | Is Ollama up, what is installed, what is resident, does the `/v1` shim agree |
| `npm run llm:smoke` | **yes** | One real multi-turn exchange against the configured model, with assertions |
| `npm run llm:mapcheck` | no | 62 assertions replaying recorded Ollama responses through the real mapping code; proves its own isolation by making network access throw |
| `npm run llm:verify` | **yes** | `mapcheck` → `probe` → `smoke` |
| `npm run check:anti-scripting` | no | No canned dialogue on the customer-facing path, plus a non-vacuity self-test |
| `npm run context:prove` | no | 9 deterministic proofs of the context layer |
| `npm run context:verify` | no | Both of the above |
| `npm run context:render` | no | Print a real rendered context (`--json`, `--sizes`, `--terse`) |
| `npm run eval:corpus` | no | Validate the benchmark corpus and print its coverage |
| `npm run eval:pull` | **yes** | Pull any candidate model not already on the host |
| `npm run eval:models` | **yes** | Inventory + **measured** resident VRAM |
| `npm run eval:run` | **yes** | The benchmark. Hours. Resumable — run it detached |
| `npm run eval:report` | no | → `results.json`, `COMPARISON.md`, `transcripts/` |

**No new vitest tests exist for any of this**, and that is a constraint rather
than a choice: `vitest.config.ts` collects `tests/**` only, and the missions that
built this could edit neither that file nor `tests/`. The CLIs above stand in —
they assert, they print the numbers the assertion was made on, and they exit
non-zero. Converting them into real vitest coverage is the first recommendation
in the review package.

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
- **A second chokepoint, for sentences rather than actions.** The dispatcher
  governs what the agent *does*; the **effect and claim consistency gate**
  (`src/agent/claimGate/`) governs what it *says about what it did*. Before any
  customer-facing text is persisted or returned, application code decides whether
  it asserts that something material happened — booked, confirmed, moved,
  cancelled, will call, a confirmation number — and checks every such claim
  against a ledger built only from real tool results and persisted rows, in
  English, Hebrew and mixed Hebrew-English. A supported claim is released
  **byte-identical**. An unsupported one never reaches the customer: the same
  model is handed the authoritative state and writes its own words again, at most
  twice, and if it still will not, the turn releases **no text at all** and asks
  for a human being. It is on by default and there is no switch that turns it off.
  `docs/MISSION_2D_CLAIM_GATE.md` is the report; `docs/ARCHITECTURE.md` § 5A is
  the mechanism.

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
| `AGENT_CONTRACT.md` | LLM boundary, guardrailed prompt, the nine tools, the dispatcher chokepoint, the claim gate (§ 10), conversations, the agent turn |
| [`docs/MISSION_2D_CLAIM_GATE.md`](docs/MISSION_2D_CLAIM_GATE.md) | The effect and claim consistency gate: the defect it closes, the detection design and why it is deterministic, the regeneration bound and why it is two, the exhaustion handover, the measured latency and what it means for token streaming, and what the gate still cannot catch |

**Mission 2 — the local AI brain.** The review package now sits in `docs/`,
alongside the Baseline V1 review. The remaining three still sit at the repository
root because the missions that wrote them had no write access to `docs/`; whoever
merges Mission 2 should move them too.

| Document | What is in it |
|---|---|
| [`docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md`](docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md) | **The review package, and the FINAL revision of it.** The fair five-model benchmark — all five candidates re-run one at a time under recorded host conditions at the same `num_ctx` — the **recommendation** it earns, and the Mission 2B Hebrew wrong-day fix that closes the review's most serious finding. Also: models evaluated and rejected, measured VRAM and the offload split, real committed transcripts, the Baseline V1 re-run, and the `npm audit` assessment |
| [`LOCAL_PROVIDER.md`](LOCAL_PROVIDER.md) | `LocalLlmProvider` and the Ollama transport: the port contract, `num_ctx` sizing and what Ollama actually does with an over-long prompt, timeouts, streaming, the operator CLIs |
| [`CONVERSATION_CONTEXT.md`](CONVERSATION_CONTEXT.md) | The context assembler, the business profile, the budget ladder, the rolling summary, the anti-scripting rule, the nine proofs |
| [`EVAL_HARNESS.md`](EVAL_HARNESS.md) | The benchmark: corpus, rubric, the LLM judges and their known failure modes, and the two gates — manufactured timestamps and wrong-day resolution |

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
src/agent/claimGate/      the effect and claim consistency gate            (Mission 2D)
src/app/                  composition root, seed world, slice demo, audit report
src/context/              the validated business/product/persona profile   (Mission 2)
src/eval/                 the model benchmark: corpus, rubric, judges, runner (Mission 2)
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
