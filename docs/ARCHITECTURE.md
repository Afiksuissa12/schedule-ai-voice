# Architecture

The architecture **as built**, not as planned. Every path below is a real file
in this repository, and every claim is backed by a test named beside it.

This slice is deliberately narrow and deliberately complete: one Contact, one
Conversation, one agent turn, one structured tool call, one validated datetime,
one persisted outcome, and an audit trail that can explain the whole thing
afterwards.

---

## 1. The governing rule

> **The LLM reasons and converses. Application code owns state and executes
> actions.**

Everything else here is a mechanism for making that enforceable rather than
aspirational. A rule that lives only in a prompt is a rule the model can talk
itself out of.

| Mechanism | File | What it makes impossible |
|---|---|---|
| One chokepoint from model to effect | `src/agent/tools/dispatcher.ts` | A model-originated action nobody checked |
| Tool schemas are `.strict()`, JSON Schema **generated** from Zod | `src/agent/tools/definitions.ts`, `jsonSchema.ts` | Telling the model one contract and judging it by another |
| `validationProvenanceJson` is `NOT NULL` and structurally validated on write | `prisma/schema.prisma`, `src/db/repositories/scheduling.ts`, `src/domain/provenance.ts` | A scheduling decision with no record of what justified it |
| History rebuilt from the database each turn | `src/conversation/conversationService.ts` | Business-critical state living in a context window |
| Turn loop capped in code, not in the prompt | `src/agent/agentTurnService.ts` | A confused model acting forever |
| `AuditEvent` with `@@unique([correlationId, sequence])` | `src/audit/` | An action nobody can reconstruct |

---

## 2. Layers and dependency direction

```
        src/app/            composition root, seed world, demo, audit report
             |
   +---------+---------+----------------+
   |                   |                |
src/agent/        src/conversation/  src/followup/
 prompt, tools,    durable turns      FutureActionService
 dispatcher,                          DueActionRunner
 AgentTurnService
   |                   |                |
   +---------+---------+----------------+
             |
      src/scheduling/      DateTimeResolver, SchedulingValidator,
             |             MeetingSchedulingService, policy, business hours
        src/domain/        entities, enums, provenance schema, business hours
             |
         src/db/           Prisma repositories, mappers, transactions
             |
        src/ports/         Clock, Availability, Calendar, Telephony, Llm, Validation
             ^
             |  implements
   src/providers/  (deterministic doubles)     src/llm/ (OpenAI adapter)
```

Dependencies point **inwards and downwards only**. `src/ports` is types plus the
two `Clock` implementations and imports nothing from the layers above it.

### The vendor boundary

`src/llm/openAiLlmProvider.ts` is the **only** file in `src/` permitted to
import a vendor SDK. This is enforced, not documented:

- `tests/scheduling/providerBoundary.test.ts` guards `src/scheduling`,
  `src/followup`, `src/domain`, `src/providers`.
- `tests/invariants/vendorBoundary.test.ts` makes the stronger claim over the
  whole of `src/`, with a one-file allowlist, so a new directory is covered on
  the day it is created.
- `tests/invariants/networkTrap.ts` patches `fetch`, `http`, `https` and
  `net.connect` for the duration of the sweep and asserts **zero** outbound
  attempts.

---

## 3. Domain boundaries and their persistence

| Domain | Entities | Owned by | Table notes |
|---|---|---|---|
| Tenancy | `Organization`, `User`, `AiAgent`, `AgentConfiguration` | `src/db/repositories/tenancy.ts` | `AgentConfiguration` is where authority lives: `allowedToolsJson`, `businessHoursJson`, `minLeadTimeMinutes`, `maxSchedulingHorizonDays`, `systemPromptRef` |
| CRM | `Contact`, `Lead`, `QualificationState` | `src/db/repositories/crm.ts` | `contacts.create` accepts E.164 phone numbers and **real IANA zone names only** - `-05:00` is rejected, because an offset carries no DST rule |
| Conversation | `Conversation`, `ConversationTurn` | `src/db/repositories/conversations.ts` | `@@unique([conversationId, index])` - turns are an ordered, gap-free log |
| Scheduling | `Meeting`, `CalendarConnection` | `src/db/repositories/scheduling.ts` | `Meeting.validationProvenanceJson` is `NOT NULL` |
| Follow-up | `FutureAction`, `Task` | `src/db/repositories/scheduling.ts` | `FutureAction` **is** the durable queue - no broker |
| Telephony | `Call`, `CallOutcome` | `src/db/repositories/telephony.ts` | Vendor identity confined to `providerName` / `providerCallId` |
| Audit | `AuditEvent` | `src/audit/` | `@@unique([correlationId, sequence])` |

Two conventions worth knowing before reading any of it:

- **Domain entities are not Prisma rows.** Instants are ISO-8601 UTC *strings*
  and enum columns are *union types*. `src/db/mappers.ts` is the only crossing
  point and re-checks stored enum values on read.
- **Enums are `String` columns**, because the Prisma SQLite connector cannot
  express `enum`. The permitted values live once in `src/domain/enums.ts`.

### Time discipline

No business logic calls `Date.now()`, `new Date()` or `DateTime.now()`. A
`Clock` is injected into everything time-dependent, and the `now` a validator
used is recorded in `ValidationProvenance.nowUtc` so any decision can be re-run
by hand.

One distinction that catches people, and that the invariant sweep had to be
corrected for: `AuditEvent` carries **both** `occurredAt` (domain time, from the
injected `Clock`) and `createdAt` (`@default(now())`, the physical instant the
row reached the disk). Domain rows carry only `createdAt`, so **the authoritative
record of when a decision was made is `ValidationProvenance.nowUtc`, not
`createdAt`**. See `docs/DECISIONS.md` § "Domain `createdAt` is insert time".

---

## 4. Ports and adapters

| Port | File | Adapter in this mission | Real adapter deferred to |
|---|---|---|---|
| `Clock` | `src/ports/clock.ts` | `SystemClock`, `FixedClock` | n/a |
| `AvailabilityProvider` | `src/ports/availability.ts` | `DeterministicAvailabilityProvider` | Google / Microsoft Graph |
| `CalendarProvider` | `src/ports/calendar.ts` | `DeterministicCalendarProvider` | Google / Microsoft Graph |
| `TelephonyProvider` | `src/ports/telephony.ts` | `DeterministicTelephonyProvider` | Twilio / Telnyx / Vonage / Vapi / Retell |
| `LlmProvider` | `src/ports/llm.ts` | `ScriptedLlmProvider` (all tests), `OpenAiLlmProvider` | n/a - real |

`createProviderRegistry` accepts **only** `DETERMINISTIC_TEST`. Asking for
`GOOGLE`, `TWILIO` or any other named vendor throws a `ConfigurationError`
naming the extension point, rather than silently falling back to a double.

`buildAgentRuntime` (`src/app/composition.ts`) defaults to the scripted model
and the deterministic providers, so a wiring mistake fails towards *"does
nothing to anybody"* rather than towards *"phones a stranger"*.

---

## 5. The tool-call validation chokepoint

Every model-originated action passes through
`ToolDispatcher.dispatch` (`src/agent/tools/dispatcher.ts`), in this order.
**The order is the contract**: cheap and structural first, provider I/O last, so
a malformed proposal never costs a provider call.

| # | Step | On failure |
|---|---|---|
| 1 | Emit `TOOL_CALL_REQUESTED` with the raw arguments **verbatim** | - |
| 2 | Is the tool name one of the nine? | `UNSUPPORTED_TOOL` |
| 3 | `JSON.parse`, then Zod `.strict()` | `SCHEMA_VIOLATION` |
| 4 | Is it in this conversation's `allowedToolsJson`? | `POLICY_VIOLATION` |
| 5 | Resolve the subject **from the database** | `UNKNOWN_CONTACT` / `POLICY_VIOLATION` |
| 6 | `SchedulingValidator.validate` (time-bearing tools only) | whatever code it returns |
| 7 | Emit `TOOL_CALL_VALIDATED` **or** `TOOL_CALL_REJECTED` | - |
| 8 | Execute via a service; emit `TOOL_CALL_EXECUTED` | `TOOL_CALL_REJECTED` |

Two consequences, both asserted:

- **On any rejection, zero domain rows.** `tests/e2e/adversarial.test.ts` proves
  it for 13 hostile turns; `INV-05` proves it as a *property* across 278
  rejections in the sweep, counting all eight writable tables.
- **Nothing reaches a service without `TOOL_CALL_VALIDATED` first.**
  `tests/agent/dispatcher.test.ts` wires an availability provider that throws if
  consulted, and shows it is never reached for an invalid call.

### The nine tools

`get_contact_context`, `check_availability`, `schedule_meeting`,
`reschedule_meeting`, `cancel_meeting`, `schedule_followup`,
`update_qualification`, `record_call_outcome`, `transfer_to_human`.

Every time-bearing tool takes `when` **as the contact's own words** -
`"tomorrow afternoon at 3"` - never a resolved timestamp. A model that converts
"tomorrow at 3" to an instant has to know today's date, the contact's zone, and
whether a DST transition falls in between; it will get that wrong eventually and
silently. Application code does it correctly and writes down how.

---

## 6. The datetime validation pipeline

`src/scheduling/dateTimeResolver.ts` + `src/scheduling/schedulingValidator.ts`.
The ordered checks are `SCHEDULING_CHECK_NAMES` in `src/scheduling/checkLog.ts`:

| # | Check | Failure code |
|---|---|---|
| 1 | `timezone_is_iana` | `UNKNOWN_TIMEZONE` |
| 2 | `parse_proposed_value` | `INVALID_FORMAT` |
| 3 | `local_time_exists` (not in a DST gap) | `NONEXISTENT_LOCAL_TIME` |
| 4 | `local_time_unambiguous` (not a fall-back repeat) | `AMBIGUOUS_LOCAL_TIME` |
| 5 | `in_the_future` | `IN_THE_PAST` |
| 6 | `min_lead_time` | `BELOW_MIN_LEAD_TIME` |
| 7 | `within_horizon` | `BEYOND_HORIZON` |
| 8 | `business_hours` | `OUTSIDE_BUSINESS_HOURS` |
| 9 | `no_busy_conflict` | `CONFLICT_WITH_BUSY_INTERVAL` |

Boundaries, stated so nobody has to guess:

- lead time and horizon are **inclusive** at the boundary; `in_the_future` is **strict**
- a slot starting exactly at business-hours open is inside; one *ending* exactly
  at close is inside; one *starting* at close is outside
- overlap is half-open, so a slot adjacent to a busy interval does **not** conflict
- the horizon is measured in fixed 24-hour days, not calendar days

The check order is itself evidence: "we refused this because the timezone was
not real" is a different story from "we refused it because it clashed, having
already established the zone was real". `ValidationCheckLog` is append-only, so
the order recorded is always the order they ran, and **skipped checks are named
in `provenance.notes.skippedChecks`** - a reader can always tell a check that
passed from one that never ran.

Policy comes from the `AgentConfiguration` row **pinned to the conversation** -
never from a constant, never from the model. `INV-05` and the
`E-policy-matrix` family exist to keep that true.

---

## 7. The durable follow-up engine

A promised callback is a database row, not a timer.
`FutureActionService.schedule` (`src/followup/futureActionService.ts`) runs the
same validate-then-persist discipline as meetings and produces a `PENDING`
`CALL_CONTACT` with `scheduledForUtc`, `timezone`, a self-sufficient
`payloadJson`, an `idempotencyKey` and a `validationProvenanceJson`.

`checkBusinessHours` defaults to **true**; `checkAvailability` defaults to
**false** - a callback does not occupy a calendar slot, so a busy diary is not a
reason to refuse to phone someone. That asymmetry is a product decision, and the
`F-availability-matrix` family sweeps both sides of it.

### Claim / lease / retry

`DueActionRunner` (`src/followup/dueActionRunner.ts`) has never seen an LLM
context window.

| Property | Value | Where |
|---|---|---|
| Claim | `futureActions.claimDue({ nowUtc, leaseOwner, leaseMilliseconds })`, atomic, increments `attempts` | `src/db/repositories/scheduling.ts` |
| Lease | 60s default; an **expired lease is reclaimable** - that is the crash-recovery path | `DueActionRunner.leaseMilliseconds` |
| Batch | 10 per pass | `batchSize` |
| Backoff | `baseSeconds: 300`, `factor: 2`, `maxSeconds: 3600` | `DEFAULT_BACKOFF` |
| Give up | after `maxAttempts` (default 3) the action is terminally `FAILED` | `claimDue` will not claim a row whose budget is spent, so a poison action cannot loop forever |

Telephony status mapping: `COMPLETED` → `CONNECTED`, done. `NO_ANSWER` →
retryable. `FAILED` or a thrown transport error → retryable. A non-terminal
status (`QUEUED`/`RINGING`/`IN_PROGRESS`) leaves the action due again;
webhook-driven completion is out of this slice.

Durability is proved by destroying every in-memory object and Prisma client and
reading the promise back:
`tests/scheduling/dueActionRunner.restart.test.ts`.

---

## 8. The audit model

One `correlationId` is minted per agent turn and threaded through everything the
turn does - including any provider call and any `FutureAction` it schedules, so
a callback executed days later still lands on the chain of the conversation that
promised it.

`AuditEvent` carries `sequence`, unique per `correlationId`. Audit writes
**never fail silently**: they throw `AuditWriteError`, and callers let it
propagate. An action we cannot explain is an action we should not claim to have
taken.

```ts
await db.audit.listByCorrelationId(correlationId);   // replay this turn, in order
await db.audit.listBySubject('MEETING', meeting.id); // why does this row exist?
```

`src/app/auditReport.ts` renders a chain and answers the five questions it must
be able to answer: what was said, what was decided, what tool was called, what
was validated, what was persisted.

---

## 9. End to end: utterance → persisted follow-up

The sequence `npm run slice:demo` runs (`src/app/sliceDemo.ts`), with the audit
event emitted at each step.

```
CONTACT: "Can you call me back tomorrow afternoon at 3?"
   |
   v
AgentTurnService.handleTurn                       -> UTTERANCE_RECEIVED
   |  mints ONE correlationId; pins nowUtc once   -> AGENT_TURN_STARTED
   |  loads history from the DATABASE                (config, prompt fingerprint,
   |                                                   offered tools, disclosures)
   v
ConversationService.buildMessages
   |  reads ConversationTurn rows - no cache
   v
LlmProvider.completeTurn                          -> PROVIDER_INVOKED
   |  scripted here, OpenAI in production
   |  returns: schedule_followup
   |           { contact_id, when: "tomorrow afternoon at 3" }
   |           ^ THE CONTACT'S WORDS, not a timestamp
   v                                              -> AGENT_DECISION
ToolDispatcher.dispatch                           -> TOOL_CALL_REQUESTED
   |                                                 (raw arguments, verbatim)
   |  2. known tool?            else UNSUPPORTED_TOOL
   |  3. JSON + Zod .strict()   else SCHEMA_VIOLATION
   |  4. in allowedToolsJson?   else POLICY_VIOLATION
   |  5. contact FROM THE DB    else UNKNOWN_CONTACT
   v
SchedulingValidator.validate
   |  timezone_is_iana -> parse -> local_time_exists ->
   |  local_time_unambiguous -> in_the_future -> min_lead_time ->
   |  within_horizon -> business_hours     (availability SKIPPED for a callback)
   |  builds ValidationProvenance: nowUtc, rawProposedValue, resolved instant,
   |  every check in the order it ran
   v                                              -> TOOL_CALL_VALIDATED
FutureActionService.schedule                         (or TOOL_CALL_REJECTED
   |                                                   / VALIDATION_REJECTED)
   |  ONE transaction:
   |    INSERT FutureAction (PENDING, CALL_CONTACT, -> ENTITY_PERSISTED
   |      scheduledForUtc, timezone, payloadJson,   -> FUTURE_ACTION_SCHEDULED
   |      idempotencyKey, validationProvenanceJson)
   v                                              -> TOOL_CALL_EXECUTED
Tool result persisted as a TOOL ConversationTurn
   |
   v
LlmProvider.completeTurn (2nd iteration)          -> PROVIDER_INVOKED
   |  "That's booked - I'll call you at 3pm."     -> AGENT_DECISION
   v
stopReason: MODEL_FINISHED

============ later, in a process with NO LLM in it ============

clock advances past scheduledForUtc
   |
   v
DueActionRunner.runDueActions
   |  claimDue: atomic, leases the row, attempts++ -> FUTURE_ACTION_CLAIMED
   |  reads the phone number from the PAYLOAD         (same correlationId)
   |  (the model never saw it - get_contact_context masks it)
   v
TelephonyProvider.placeCall  (deterministic double)
   |  COMPLETED -> Call + CallOutcome, status DONE -> FUTURE_ACTION_EXECUTED
   |  NO_ANSWER / FAILED / throw -> back to PENDING -> FUTURE_ACTION_FAILED
   |     with exponential backoff, until maxAttempts
```

The follow-up chain, in order, as `INV-06` asserts it (as an ordered
**subsequence**, not adjacency - a chain that also records a provider call still
satisfies it):

```
UTTERANCE_RECEIVED -> AGENT_TURN_STARTED -> PROVIDER_INVOKED -> AGENT_DECISION
-> TOOL_CALL_REQUESTED -> TOOL_CALL_VALIDATED -> ENTITY_PERSISTED
-> FUTURE_ACTION_SCHEDULED -> TOOL_CALL_EXECUTED -> PROVIDER_INVOKED -> AGENT_DECISION
-> [later] FUTURE_ACTION_CLAIMED -> FUTURE_ACTION_EXECUTED
```

---

## 10. How this is proved

| Suite | What it establishes |
|---|---|
| `tests/foundation/` | Schema round-trips, transaction atomicity, audit chain, provenance refusal, per-test isolation |
| `tests/scheduling/` | Resolver grammar, the nine ordered checks, DST, policy from the persisted row, provider boundary, runner restart/backoff |
| `tests/agent/` | Prompt composition, the nine-tool contract, dispatcher ordering, conversation durability, qualification rubric |
| `tests/e2e/` | The slice end to end, 13 adversarial turns, the bounded turn loop |
| `tests/invariants/` | **The sweep**: 509 generated scenarios x 11 per-scenario invariants, plus determinism and the network trap |

### The invariant sweep

`tests/invariants/` carries forward the legacy harness's philosophy: assert
properties that must **always** hold across a matrix of inputs, rather than
writing one test per example.

| File | Role |
|---|---|
| `dimensions.ts` | The axes: 5 timezones, 10 `now` instants, 17 expressions, 4 policies, 4 availability states. Pure data. |
| `dimensions.test.ts` | Re-derives every factual claim the dimensions make (that a local time really is in a DST gap, that Kolkata really has a half-hour offset) so a comment can never quietly become a lie |
| `scenarios.ts` | Crosses them into **509** scenarios in 9 named families. Pure function, fixed seed, stable ids |
| `runner.ts` | Drives each scenario through `AgentTurnService.handleTurn` - the real front door |
| `invariants.ts` | The 11 per-scenario properties |
| `networkTrap.ts` | Patches `fetch`/`http`/`https`/`net` and records any outbound attempt |
| `sweep.ts` | generate → run → check → summarize |
| `sweep.test.ts` | Asserts zero violations, plus **non-vacuity** guards |
| `determinism.test.ts` | Same classification on a second run, and under different chunking |
| `vendorBoundary.test.ts` | The vendor SDK is confined to one file in all of `src/` |

Run it standalone with `npm run qa:sweep`; the report lands in `.tmp/qa/`.

The design constraint that matters: **the generator never predicts an outcome.**
Computing the expected answer would mean reimplementing `DateTimeResolver`
inside the test suite, which proves only that two copies of the same idea agree.
Scenarios declare a *direction* (`ACCEPT` / `REJECT` / `EITHER`) only where it is
unconditional, and most honestly declare `EITHER`. The invariants are conditional
- "IF a meeting was persisted THEN ..." - which is what lets one function police
a matrix no one could enumerate by hand.

Because a corpus of conditional properties could pass vacuously,
`sweep.test.ts` additionally asserts the sweep persisted >100 rows, refused >100
calls, and that **no invariant had zero applicable checks**.
