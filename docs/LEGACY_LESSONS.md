# What was carried forward from the legacy prototype

> **Provenance note, stated first because it matters.**
>
> The Founder designated `C:\Users\afiks\AI_Scheduling_Agent_Legacy_Export\`
> (`REBUILD_NOTES.md`, and `legacy_project\PLAN.md`, `ARCHITECTURE.md`,
> `FEATURES.md`, `DATA_MODEL.md`, `INTEGRATIONS.md`, `CODEBASE_MAP.md`) as
> required reading. **That folder is not reachable from the agent execution
> environment** — confirmed independently by the Coordinator and re-checked by
> this task. There is no mounted Windows filesystem and a filesystem search
> found nothing.
>
> **This document is therefore written from the description of the legacy system
> given in the mission brief, and from nothing else.** Nothing here is quoted
> from, attributed to, or invented on behalf of those files. Where a legacy
> detail would be needed and the brief does not supply it, this document says so
> rather than filling the gap. See `docs/DECISIONS.md` § 2.
>
> Both legacy folders are read-only reference and were never written to.

This is a **from-scratch rebuild, not a port**. No legacy code was copied. What
follows is what was worth re-expressing, and what was worth structurally
eliminating.

---

## 1. Ideas re-expressed, not transplanted

### 1.1 The qualification rubric, with its decision-maker hard cap

**The legacy idea:** score a prospect against weighted factors, and refuse to let
someone who cannot sign be scored as a hot lead however enthusiastic they sound.

**Re-expressed as:** `src/agent/tools/qualificationRubric.ts`, version
`schedule-ai-voice-rubric@v1`. Five weighted factors summing to 100
(`need_established` 25, `budget_signal` 25, `timeline_urgency` 20,
`authority_signal` 15, `engagement` 15), and `NON_DECISION_MAKER_SCORE_CEILING =
60`.

**What changed in the re-expression, and why it is better:**

- The cap is applied from the **persisted `Contact.isDecisionMaker` row**, not
  from anything the model asserted during the call. A model cannot flatter its
  way past it, because it is not the model's variable.
- `rawScore` and `cappedScore` are persisted **separately**, so the cap is
  visible in the data rather than implied by a number being suspiciously round.
- A score the model proposes directly is **advisory**: recorded, used as
  `rawScore` only when no evidence was supplied at all, and still capped.
- The only thing that lifts the ceiling is `is_decision_maker: true`, which
  changes the durable CRM record — an auditable edit, not a per-call flag.
- Scoring is a **pure function**, so a persisted `factorsJson` is a re-computable
  explanation rather than a snapshot of a mood.

**Proved by:** `INV-08` across the `I-qualification-cap` sweep family, crossing
both values of `isDecisionMaker` with five evidence strengths and with
flattering proposed scores — plus `tests/agent/qualification.test.ts`.

### 1.2 Never-fabricate prompt guardrails

**The legacy idea:** the agent must not invent availability, contact details, or
confirmations.

**Re-expressed as:** named, versioned clauses in `src/agent/prompt/clauses.ts`,
composed by `systemPromptRef` (`sales-scheduler@v1`). `REQUIRED_CLAUSE_IDS`
cannot be dropped — `resolvePromptComposition` throws and a test fails the
build.

**The important change:** every clause names, in its `enforcedBy` field, the
mechanism that actually backs it. Because:

> **None of the prompt enforces anything. The dispatcher enforces.**

A guardrail that exists only as an instruction is a guardrail the model can talk
itself out of. So "never invent availability" is backed by `check_availability`
being the only way to see the diary; "nothing is booked until a tool says it is"
is backed by the tool returning the persisted row; "never invent a contact id"
is backed by the dispatcher resolving the subject **from the database** and
refusing anything else.

`buildSystemPrompt` is pure and is a function of the *set* of permitted tools
(names sorted), so the `promptFingerprint` on an audit event is a real pin on
the exact instructions used. The prompt carries **no secrets and no per-contact
PII** — per-turn facts go in a separate turn-context message that discloses the
contact id, name, timezone, local time and decision-maker flag, and deliberately
**not** the phone number or email.

### 1.3 Booking-negotiation natural-language parsing

**The legacy idea:** a contact says "tomorrow afternoon at 3", not
`2026-03-05T15:00:00-05:00`, and the agent has to cope.

**Re-expressed as:** `src/scheduling/naturalLanguage.ts` +
`src/scheduling/dateTimeResolver.ts`, covering `today` · `tomorrow` · `day after
tomorrow` · weekday names bare and with `next` · `end of the week` ·
`morning`/`afternoon`/`evening`/`tonight` · `noon`/`midday`/`midnight` · clock
times with and without am/pm, `HH:mm`, `o'clock`, `p.m.` · `in N
minutes/hours/days/weeks` including `in a couple of hours` and `half an hour` ·
explicit `YYYY-MM-DD` dates.

**The two changes that matter most:**

1. **The model passes the contact's words through, and never a timestamp.** Every
   time-bearing tool takes `when` as a string of what was said. A model that
   converts "tomorrow at 3" itself has to know today's date, the zone, and
   whether a DST transition falls in between — and it will get that wrong
   eventually, and silently. Application code does it correctly and records how
   in `ValidationProvenance`, so the audit trail preserves **what the person
   actually said** — which is what an auditor asking "why did you call them
   then?" needs to see.
2. **It refuses rather than guesses.** `tomorrow at 3` (no am/pm), `tomorrow
   morning at 3pm` (contradiction), `sometime next week` (a period, not a
   moment), `next tuesday` (a day with no time), `asap` — all `INVALID_FORMAT`,
   with a reason that names the question the agent should ask. A bare time that
   has already passed is reported `IN_THE_PAST` rather than silently rolled
   forward to tomorrow.

### 1.4 The invariant-sweep QA philosophy — **the part most relevant here**

**The legacy idea:** the harness ran **538 scenarios**, asserting properties that
must always hold across a matrix of inputs, rather than writing one test per
example.

**Re-expressed as:** `tests/invariants/`. **509 generated scenarios** across nine
named families, crossing 5 timezones, 10 `now` instants, 17 time expressions,
4 persisted policies, 4 availability states and 6 tool shapes; **11 per-scenario
invariants**, plus determinism and a network trap. All 13 declared
`ValidationErrorCode`s are exercised. `npm run qa:sweep` reports it.

**What the adaptation had to get right:**

- **Fully deterministic generation.** Fixed seed (`SWEEP_SEED`), no `Date.now()`,
  no unseeded randomness, no network. Every scenario carries a **stable id**
  that appears in the failure message and is sufficient to reproduce it alone.
- **The generator never predicts an outcome.** Computing the expected instant
  would mean reimplementing `DateTimeResolver` in the test suite, which proves
  only that two copies of the same idea agree. Scenarios supply inputs and
  declare a direction only where it is unconditional; the invariants are
  conditional — "IF a meeting was persisted THEN it sits inside business hours".
- **Independent oracles.** Business-hours containment and interval overlap are
  re-derived with Luxon rather than by calling the system's own functions — so an
  off-by-one in `checkBusinessHours` is caught rather than mirrored.
- **Non-vacuity guards.** A corpus of conditional properties can pass while
  proving nothing. The sweep asserts it persisted >100 rows, refused >100 calls,
  and that **no invariant had zero applicable checks**; the report prints
  `VACUOUS` in capitals if one ever does.
- **The dimensions are themselves tested.** `dimensions.test.ts` re-derives every
  factual claim — that `2026-03-08T02:30` really does not exist in New York, that
  Kolkata really has a half-hour offset, that Sydney's transition really runs the
  other way — so a comment can never quietly become a lie while the sweep stays
  green and meaningless.

**Honest difference in scale and shape:** 509 vs 538, and this corpus covers a
first vertical slice rather than a whole product. What the sweep does **not**
cover is listed in `docs/DECISIONS.md` § 6.6 and printed by every report run.

---

## 2. Legacy limitations this slice structurally eliminates

"Structurally" means the old failure mode is now **unreachable**, not merely
discouraged — there is a table, a constraint or a failing test in the way.

| # | Legacy limitation | Eliminated by | Test that holds the line |
|---|---|---|---|
| 1 | **Browser-only state** — everything lived in a tab | `Conversation` + `ConversationTurn` tables; `ConversationService` rebuilds history from rows every turn and **caches nothing** | `tests/agent/conversationService.test.ts`, `tests/foundation/durability.test.ts` |
| 2 | **No database** | `prisma/schema.prisma` — 18 models, a committed migration, real foreign keys and unique constraints | `tests/foundation/schemaRoundTrip.test.ts` |
| 3 | **Synthetic availability** — invented on the fly, so a clash could never be proved | `AvailabilityProvider` port + `DeterministicAvailabilityProvider`: every busy interval comes from something a caller **wrote down**, and identical input gives byte-identical output | `INV-03` over 101 persisted meetings; `F-availability-matrix` sweeps free / exact / partial / adjacent |
| 4 | **Web Speech API as telephony** — browser speech standing in for a phone call | `TelephonyProvider` port; `Call` / `CallOutcome` tables; vendor identity confined to `providerName` / `providerCallId` | `tests/scheduling/providers.test.ts`; boundary guards |
| 5 | **No follow-up engine** — a promise was a sentence | `FutureAction` **is** the durable queue: validated instant, timezone, self-sufficient payload, idempotency key, provenance. `DueActionRunner` claims with an atomic lease, retries with backoff, gives up terminally | `tests/scheduling/dueActionRunner.restart.test.ts` proves a promise survives destroying every in-memory object and Prisma client |
| 6 | **No durable conversation state** | `@@unique([conversationId, index])` — an ordered, gap-free turn log, including tool calls and tool results | `tests/agent/conversationService.test.ts` |
| 7 | **No auth** | **Only partially addressed — see § 3.1** | — |
| 8 | **No CRM abstraction** | `Contact`, `Lead`, `QualificationState` with typed repositories; `contacts.create` validates E.164 and **real IANA zones only** (`-05:00` rejected, because an offset carries no DST rule) | `tests/foundation/schemaRoundTrip.test.ts` |
| 9 | **No background execution** — nothing happened unless a human had the tab open | `DueActionRunner.runDueActions` is one deterministic pass over the database, in a process with **no LLM in it** | `tests/scheduling/dueActionRunner.test.ts` |
| 10 | **One-call-only lifecycle** | `Conversation.status` + `startOrResume`; a `FutureAction` carries the **original turn's `correlationId`**, so a callback days later lands on the audit chain of the conversation that promised it | `tests/e2e/followupSlice.test.ts` |

### Two more the brief did not list, eliminated anyway

| Legacy failure mode | Eliminated by |
|---|---|
| **An action nobody can explain** | `AuditEvent` with `@@unique([correlationId, sequence])`; audit writes throw rather than fail silently; `INV-06` proves every one of 509 outcomes is explained |
| **A booking with no record of what justified it** | `validationProvenanceJson` is `NOT NULL` *and* structurally validated on write — `"{}"` is refused. `INV-04` proves the receipt's resolved instant **equals** the persisted instant and preserves the raw words, across 201 rows |

---

## 3. Honest about what a first slice only partially addresses

### 3.1 Authentication — **the largest remaining gap**

Limitation 7 above is **not** eliminated. `User` exists so Lead ownership and
Task assignment have a real foreign key, and the schema is multi-tenant
throughout — every query takes an `organizationId`. But there are **no password
hashes, no sessions, no API keys, and no authorization checks**, and **nothing
currently stops a caller from passing a different `organizationId`**.

This slice has no HTTP surface, so there is no live exposure today. It is
nonetheless the single largest gap between this and a deployable product, and it
is listed in `docs/DECISIONS.md` § 1.6.

What *was* achieved is the precondition: tenancy is in the data model from the
first migration rather than retrofitted, which is the part that is genuinely
expensive to add later.

### 3.2 The real telephony media path — **dispatch only, no audio**

Limitation 4 is **partially** addressed. The *architecture* is right: telephony
is behind a port, the domain holds `Call` and `CallOutcome`, and no vendor type
leaks. `DueActionRunner` really does dispatch a `CALL_CONTACT` through the
provider and record the outcome.

But this slice **dispatches a call; it does not carry a conversation**. Streaming
audio to and from a live human — media streams or WebRTC, speech-to-text,
text-to-speech, barge-in, turn-taking under latency — is a substantial separate
build, not a matter of swapping the double for Twilio. The legacy prototype's
Web Speech API at least made *noise*; this slice makes none, and is honest about
it.

Also incomplete: webhook-driven completion. A non-terminal provider status
(`QUEUED`/`RINGING`/`IN_PROGRESS`) currently leaves the action due again rather
than being resolved by a callback.

### 3.3 Calendar integration — real shape, no real calendar

`DeterministicCalendarProvider` reports `canInvite: false` **on purpose**,
because it delivers no invitations. Attendee invitations, free/busy against a
real account, and recurring events are untouched. `CalendarConnection` stores
**no OAuth tokens**, and must not until a secrets mechanism is approved
(`docs/DECISIONS.md` § 1.2, § 1.4).

### 3.4 Scale and operations

SQLite is single-writer and file-based. `DueActionRunner` is safe to run in
multiple processes — the claim is an atomic lease and an expired lease is
reclaimable — but it has not been *run* that way at scale here. There is no
metrics endpoint, no structured log shipping, and no alerting. The move to
Postgres is a datasource change plus `SELECT ... FOR UPDATE SKIP LOCKED`, and
should touch nothing outside `src/db/`.
