# Decision log

Why this slice is built the way it is, what was deliberately deferred, and what
the Founder now has to decide.

Read **§ 1 FOUNDER DECISIONS REQUIRED** first. Everything below it is context.

---

## 1. FOUNDER DECISIONS REQUIRED

> **Nothing in this list was purchased, activated, configured, or connected
> during this mission.** No paid service was signed up for. No credential was
> created, stored, or committed. No real phone number was dialled. No real
> calendar was written to. No message was sent to any real person.
>
> Each item below is a place where the architecture has a **port and a working
> deterministic double**, and where going to production needs a commercial and
> security decision that is yours, not an engineer's.

### 1.1 Telephony vendor — **decision required, nothing purchased**

| | |
|---|---|
| Port | `src/ports/telephony.ts` |
| Today | `DeterministicTelephonyProvider` — scripted outcomes, imports no transport at all |
| Needed | An account with Twilio / Telnyx / Vonage / Vapi / Retell, a purchased originating number, and per-minute spend |
| Also needed | A **real-time media path**. This slice *dispatches* a call; it does not carry audio. Streaming speech to and from a live caller is a separate build (media streams / WebRTC, STT, TTS, barge-in), not a configuration change |
| Blocked on you | Vendor choice, account, number purchase, spend ceiling, and the regulatory questions below |

Regulatory matters that are **not** engineering decisions: outbound calling
consent and do-not-call registry scrubbing, per-jurisdiction call-recording
consent, and disclosure that the caller is an AI. These vary by territory and
need a decision before a single real number is dialled.

### 1.2 Calendar OAuth — **decision required, nothing connected**

| | |
|---|---|
| Ports | `src/ports/calendar.ts`, `src/ports/availability.ts` |
| Today | `DeterministicCalendarProvider` — idempotency-keyed, stable hashed `externalEventId`, reports `canInvite: false` because it delivers nothing |
| Needed | A Google Cloud project or Microsoft Entra app registration, OAuth consent screen, verification, and scopes |
| Blocked on you | Which provider, and the app-verification process (Google restricted-scope review takes weeks and may need a security assessment) |

`CalendarConnection` deliberately stores **no tokens**. `externalAccountRef` is
an opaque, non-secret pointer. **Do not add a token column until § 1.4 is
decided** — a refresh token in a `String` column of a SQLite file is a breach
waiting to happen.

### 1.3 Hosted database — **decision required, nothing provisioned**

| | |
|---|---|
| Today | File-based SQLite via Prisma (`file:./dev.db`) |
| Needed | Managed Postgres (RDS / Cloud SQL / Neon / Supabase), with backups, PITR and an encryption-at-rest decision |
| Blocked on you | Provider, region (**data-residency matters here — this database holds contact names, phone numbers and call transcripts**), and retention policy |

The migration itself is small and was planned for: the Prisma datasource
provider changes, the `String` enum columns can become real Postgres enums, and
`claimDue` can use `SELECT ... FOR UPDATE SKIP LOCKED` instead of the
lease-column dance. **No application code outside `src/db/` should need to
change.** That is what the repository layer is for.

### 1.4 Secrets management — **decision required, nothing configured**

| | |
|---|---|
| Today | `.env`, git-ignored, with `OPENAI_API_KEY` **empty** in `.env.example` |
| Needed | AWS Secrets Manager / GCP Secret Manager / Vault / Doppler, plus rotation |
| Blocked on you | Which, and who holds the root of trust |

This gates § 1.2: OAuth refresh tokens are long-lived credentials to a
customer's calendar and must not be stored until there is somewhere proper to
put them.

### 1.5 OpenAI spend — **account assumed, no key present, no call made**

The `openai` package is a dependency and `src/llm/openAiLlmProvider.ts` is
written, but **`OPENAI_API_KEY` is empty in `.env.example`, no key exists in
this repository, and the entire test suite plus `npm run slice:demo` run green
with it unset.** The single live test (`tests/agent/openAiLive.test.ts`) skips
cleanly when the key is absent and is never required.

Needed from you: a funded account, a monthly spend ceiling, a decision on
zero-data-retention / no-training terms (**call transcripts are customer
personal data**), and a model choice with a pinned version.

### 1.6 Authentication and multi-tenancy enforcement — **not built**

`User` exists so Lead ownership and Task assignment have a real foreign key.
There are **no password hashes, no sessions, no API keys, and no authorization
checks**. Every query takes an `organizationId` and the schema is multi-tenant
throughout, but **nothing currently stops a caller from passing a different
one.** This slice has no HTTP surface, so there is no exposure today — but it is
the largest single gap between this and a deployable product, and it is called
out again in `docs/LEGACY_LESSONS.md`.

### 1.7 Smaller decisions that are genuinely product decisions

| Question | Today | Why it is yours |
|---|---|---|
| Does a shared phone line mean one contact or several? | `(organizationId, primaryPhoneE164)` is indexed but **not unique** | Deduplicating contacts silently merges two people's histories |
| Should the agent see the full phone number? | `get_contact_context` **masks** it; `DueActionRunner` dials from the persisted payload | Putting a dialable number in a context window is a data-exposure choice |
| Transcript retention | Full `ConversationTurn` history, no truncation, no expiry | Retention is a legal question |
| Should conflicts also check our own `Meeting` rows? | Only the `AvailabilityProvider` is consulted | See § 5.3 |

---

## 2. Could the legacy export be read?

**No.** The Founder designated as required reading:

```
C:\Users\afiks\AI_Scheduling_Agent_Legacy_Export\REBUILD_NOTES.md
C:\Users\afiks\AI_Scheduling_Agent_Legacy_Export\legacy_project\PLAN.md
                                                 \ARCHITECTURE.md
                                                 \FEATURES.md
                                                 \DATA_MODEL.md
                                                 \INTEGRATIONS.md
                                                 \CODEBASE_MAP.md
```

That folder is **not reachable from the agent execution environment**, which the
Coordinator had already verified independently. This task searched for it again
and confirmed the same result: the execution environment is Linux, there is no
mounted Windows filesystem (`/mnt/c` does not exist), and a filesystem search for
`REBUILD_NOTES.md` and `*Legacy_Export*` returned nothing.

**Consequently, nothing in this repository is quoted from, or attributed to,
those documents.** `docs/LEGACY_LESSONS.md` is written from the description of
the legacy system given in the mission brief, and says so at the top. Where this
documentation describes legacy behaviour, it is describing what the brief said,
not what a file said. **No content has been fabricated from documents that could
not be read.**

Both legacy folders are read-only reference and **were never written to**.

---

## 3. Platform choices

### 3.1 SQLite + Prisma for this mission

**Decision:** file-based SQLite through Prisma, with a committed migration.

- A fresh clone needs **no credentials, no network, and no running service** to
  get a green test suite. That property is worth a great deal at this stage, and
  it is load-bearing for the invariant sweep: 509 scenarios across 16 disposable
  databases would be intolerable against a hosted Postgres.
- Prisma gives a typed client and real migrations, so the move to Postgres is a
  datasource change rather than a rewrite.
- Per-test isolation is cheap: the schema is applied once into a template keyed
  by a hash of `schema.prisma`, and each test database is a **file copy**
  (milliseconds). See `tests/helpers/testDb.ts`.

**Costs, accepted knowingly:** the SQLite connector cannot express `enum` (hence
`String` columns plus `src/domain/enums.ts`), there are no nested transactions
(`withTransaction` runs inline when already transactional), and write
concurrency is single-writer. None of these shape the domain model, which is why
they are acceptable now and removable later.

### 3.2 OpenAI as the model provider

**Decision:** OpenAI, behind `src/ports/llm.ts`.

Chosen for mature, well-specified function/tool calling with a strict-schema
mode, which is what this architecture actually leans on. The dependency is
**one file deep**: `src/llm/openAiLlmProvider.ts` translates and does nothing
else — no validation, no interpretation, no state. Swapping vendors means
writing one adapter.

The guard is mechanical, not cultural: `tests/invariants/vendorBoundary.test.ts`
fails the build if any other file in `src/` imports a vendor SDK.

### 3.3 Deterministic doubles instead of real Twilio and Google

**Decision:** `DETERMINISTIC_TEST` is the only authorized provider kind in this
mission. Requesting `GOOGLE`, `MICROSOFT_GRAPH`, `TWILIO`, `TELNYX`, `VONAGE`,
`VAPI` or `RETELL` throws a `ConfigurationError` naming the extension point.

Three reasons, in order of importance:

1. **The mission forbids it.** No real calls, no real calendars, no paid service
   without Founder approval. A provider registry that *could* be pointed at
   Twilio by an environment variable would be one typo away from breaking that.
2. **Determinism is a testing prerequisite.** A conflict detected against a real
   calendar is a conflict that cannot be reproduced tomorrow. Every busy interval
   in this repository comes from something a test **wrote down**.
3. **Failing safe.** `createProviderRegistry` throws rather than falling back to
   a double, so a half-configured production deployment stops instead of
   quietly pretending to book meetings.

A deliberate honesty in the calendar double: it reports `canInvite: false`,
because it delivers no invitations. A double that claimed it could would make
the system lie to a user.

---

## 4. Policy defaults, and where they are configured

**Every one of these is a row, not a constant.** Policy is read from the
`AgentConfiguration` pinned to the conversation
(`schedulingPolicyFromAgentConfiguration`, `src/scheduling/policy.ts`), never
from a literal in scheduling code and never from the model. The
`E-policy-matrix` sweep family exists specifically to catch a regression where
one of them starts being read from a constant.

| Setting | Default | Column | Constant |
|---|---|---|---|
| Business hours | **Mon–Fri 09:00–17:00 local** | `AgentConfiguration.businessHoursJson` | `weekdayBusinessHours()`, `src/domain/businessHours.ts` |
| Minimum lead time | **30 minutes** | `AgentConfiguration.minLeadTimeMinutes` | `SLICE_WORLD.minLeadTimeMinutes` |
| Scheduling horizon | **180 days** | `AgentConfiguration.maxSchedulingHorizonDays` | `SLICE_WORLD.maxSchedulingHorizonDays` |
| Default meeting length | **30 minutes** | `businessHoursJson.defaultMeetingDurationMinutes` | `DEFAULT_MEETING_DURATION_MINUTES`, `src/scheduling/policy.ts` |
| Default timezone | **America/New_York** | `AgentConfiguration.defaultTimezone` | `APP_TIMEZONE_DEFAULT` in `.env.example` |
| Permitted tools | **all nine** | `AgentConfiguration.allowedToolsJson` | `TOOL_NAMES` |
| Day parts | morning 08:00–12:00 (→09:00), afternoon 12:00–17:00 (→14:00), evening 17:00–21:00 (→18:00) | `businessHoursJson.dayParts` | `DEFAULT_DAY_PARTS`, `src/scheduling/policy.ts` |
| Follow-up retries | **3 attempts**, backoff 300s ×2, capped 3600s | `FutureAction.maxAttempts` | `DEFAULT_BACKOFF`, `src/followup/dueActionRunner.ts` |
| Claim lease | **60s**, expired leases reclaimable | — | `DueActionRunner.leaseMilliseconds` |

**Day parts are deliberately independent of business hours.** "This evening"
resolves to 18:00 and is *then* refused with `OUTSIDE_BUSINESS_HOURS`, rather
than being silently shifted into hours. Silently moving a time the contact
proposed is how a system books a meeting nobody agreed to.

---

## 5. Domain decisions worth recording

### 5.1 The qualification rubric and its cap

**Rubric version: `schedule-ai-voice-rubric@v1`** (`QUALIFICATION_RUBRIC_VERSION`,
`src/agent/tools/qualificationRubric.ts`). Five weighted factors summing to 100:

| Factor | Weight |
|---|---|
| `need_established` | 25 |
| `budget_signal` | 25 |
| `timeline_urgency` | 20 |
| `authority_signal` | 15 |
| `engagement` | 15 |

Bands are applied to the **capped** score: HIGH ≥ 80, MEDIUM ≥ 60, LOW ≥ 35,
UNQUALIFIED below.

**The decision-maker hard cap ceiling is `60`**
(`NON_DECISION_MAKER_SCORE_CEILING`). When `Contact.isDecisionMaker` is false —
read from the **persisted row**, never from the model's assertion — the stored
score is `min(rawScore, 60)`, whatever the rubric or the model produced.

`rawScore` and `cappedScore` are persisted **separately**, so the cap is visible
rather than implied. A score the model proposes directly is **advisory**:
recorded, and used as `rawScore` only when no factor evidence was supplied at
all — and the cap still applies. **There is no argument that lifts the ceiling.**
The only thing that lifts it is `is_decision_maker: true`, which changes the
durable `Contact` record — an auditable CRM edit, not a per-call flag.

Proved as a property by `INV-08` across the `I-qualification-cap` family, which
crosses both values of `isDecisionMaker` with five evidence strengths and with
flattering proposed scores.

### 5.2 Domain `createdAt` is insert time, not decision time

Found by the invariant sweep, and worth writing down because it changed an
invariant.

Domain rows use `createdAt DateTime @default(now())` — the **database's** clock —
while `AuditEvent` carries **both** `occurredAt` (from the injected `Clock`) and
`createdAt`. Under a `FixedClock` set to March 2026 those diverge by design: the
audit trail says a `FutureAction` was created at `2026-03-04T15:00:00Z` and the
row says whatever today's real wall clock is.

**Reading adopted:** the `occurredAt`/`createdAt` split on `AuditEvent` is
deliberate — `createdAt` is a physical insert timestamp, not domain time. The
authoritative record of when a decision was made is
**`ValidationProvenance.nowUtc`**, which is clock-injected and recorded
precisely so the decision can be re-run.

The mission words invariant 1 as "`scheduledForUtc` strictly greater than its
`createdAt`", which assumed the two were the same thing. `INV-01` therefore
asserts the **stronger** property: `scheduledForUtc` is strictly after the
validator's own `nowUtc` **and** strictly after the clock the turn actually ran
at (sourced from the scenario definition, so the system cannot satisfy it by
writing a convenient receipt). The reasoning is in
`tests/invariants/invariants.ts` beside the check.

**Raised with `MISSION-48d6ff04-AUTO-FOUNDATION`** through the coordination
mailbox as a contract-clarity question: if `createdAt` is meant to be
insert-only, `FOUNDATION_CONTRACT.md` § 4 should say so next to the "inject a
Clock into anything time-dependent" rule, because the natural reading of that
rule is that `createdAt` follows the clock too. If instead it was meant to be
domain time, the fix is to pass `clock.nowUtc()` on the repository create paths,
and `INV-01` will assert `scheduledForUtc > createdAt` as well. **No `src/` file
was changed for this.**

### 5.3 Conflicts are checked against the AvailabilityProvider only

The organization's own `Meeting` rows are **not** also consulted, even though
`meetings.listOverlapping` exists. In this slice the deterministic availability
double is the single source of truth for the diary, so checking both would be
checking one thing twice. Against a real calendar the two can disagree, and
`listOverlapping` becomes the tie-breaker. **Deliberate non-goal, not an
oversight.**

### 5.4 One contact per conversation

`ToolDispatchContext.contact` is fixed for the turn, which is what makes the
anti-fabrication gate simple: any `contact_id` that is not this one is refused,
full stop. A three-way call would need a different shape.

### 5.5 `schedule_followup` with a non-`CALL_CONTACT` type refuses loudly

The tool declares the full `FutureActionType` enum but only executes
`CALL_CONTACT`. Asking for `SEND_FOLLOWUP_MESSAGE` returns a structured,
audited `POLICY_VIOLATION` and writes nothing. **A silent no-op is forbidden:**
a model told "done" for something that will never happen will tell the contact
it is done.

---

## 6. Testing decisions

### 6.1 Why an invariant sweep rather than more example tests

The Founder asked for the legacy harness's invariant-sweep philosophy, adapted.
The distinction that matters: an example test asserts an expected value; an
invariant asserts a property that holds across a matrix. `tests/e2e/adversarial.test.ts`
proves 13 hostile turns are refused. `INV-05` proves **"a rejected tool call
changes no row count"** across 278 rejections spanning five timezones, ten `now`
instants, four policies and every refusal code the system can emit.

**Scale: 509 scenarios.** The legacy harness ran 538; this is the honest
equivalent for a slice this size, and all 13 declared `ValidationErrorCode`s are
exercised.

### 6.2 The generator never predicts an outcome

The single most important constraint on `tests/invariants/scenarios.ts`.
Computing the expected instant for "tomorrow afternoon at 3" in
Australia/Sydney on a DST boundary would mean reimplementing `DateTimeResolver`
in the test suite, and a test that reimplements its subject proves only that two
copies agree.

So scenarios supply **inputs**, and declare a direction (`ACCEPT`/`REJECT`/
`EITHER`) **only where it is unconditional**. Most honestly declare `EITHER` —
"tomorrow at 2pm" is a fine proposal, but tomorrow may be a Saturday. The
invariants are conditional ("IF a meeting was persisted THEN ...").

The same rule drove the availability states: busy intervals are expressed as
**local wall-clock rules** in the contact's zone (busy 14:00–15:00 their time),
never as UTC instants, because computing the instant to place a conflict on
would again mean reimplementing the resolver.

**The deliberate exception:** `invariants.ts` re-derives business-hours
containment and interval overlap with Luxon rather than calling
`checkBusinessHours`. That is an *independent oracle*, which is the opposite of
the prohibition — calling the system's own function would hide an off-by-one in
it.

### 6.3 Non-vacuity guards

A corpus of conditional properties can pass while proving nothing, if everything
was refused or nothing was checked. So `sweep.test.ts` also asserts the sweep
persisted >100 rows, refused >100 calls, produced >20 meetings, >20 future
actions and >10 qualification states, and that **no invariant had zero
applicable checks**. The report marks any such invariant `VACUOUS` in capitals.

### 6.4 One shared database per chunk of scenarios

509 fresh SQLite files plus Prisma clients costs over a minute of pure setup.
Scenarios are grouped into chunks sharing one database, and isolation is
achieved the way the application achieves it: each scenario seeds its **own**
organization, contact, configuration and calendar via
`seedSliceWorld({ suffix })`.

This is **stronger**, not weaker: `INV-05` is then asserted against a database
already holding hundreds of other organizations' rows, so a query missing an
`organizationId` filter has somewhere to go wrong. Chunks run concurrently for
wall-clock reasons; `determinism.test.ts` asserts that changing the chunk size
and concurrency changes no outcome.

### 6.5 Determinism is checked on a cross-section in `npm run test`

Running all 509 scenarios twice doubles the slowest thing in the repository. So
`npm run test` asserts determinism over a **cross-section that touches every
family** (a stride, not the first N — the first N are all one family), and
`npm run qa:sweep -- --determinism` runs the complete double pass for a release
check. **This is a real limitation**, and it is stated in the sweep report's
coverage section rather than hidden.

### 6.6 What the sweep does NOT cover

Reproduced from `KNOWN_COVERAGE_GAPS` in `tests/qa/report.ts`, which the
generated report prints in full every run:

1. The corpus is **named families, not the full Cartesian product** (which would
   be >800,000 cases). Every axis the mission names is crossed exhaustively in at
   least one family, but not every axis with every other — the four availability
   states are swept across all five timezones at **one** `now` instant, not ten.
2. DST gap and ambiguous times are supplied as **explicit ISO local datetimes**.
   The natural-language route into a DST gap is not swept, because generating one
   per zone per transition means computing the transition — the logic under test.
3. Only `schedule_followup`, `schedule_meeting`, `check_availability`,
   `update_qualification` and two fabricated-subject calls are driven.
   `reschedule_meeting`, `cancel_meeting` on a real meeting, `record_call_outcome`,
   `transfer_to_human` and `get_contact_context` are covered by `tests/e2e` and
   `tests/agent`, **not by the sweep**.
4. **The sweep stops at persistence.** `DueActionRunner` claim/lease/retry is
   proved by `tests/scheduling/dueActionRunner*.test.ts`; no sweep scenario
   places a call through the telephony double at all.
5. **Concurrency is not swept.** Two agents racing one idempotency key is a
   dedicated test, not a matrix dimension.
6. **The live OpenAI provider is not exercised** — by design, but it means the
   sweep says nothing about whether a real model emits well-formed calls.
