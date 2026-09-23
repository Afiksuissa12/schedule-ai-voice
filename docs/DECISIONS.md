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
  it is load-bearing for the invariant sweep: 601 scenarios across 19 disposable
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

### 5.6 Business hours are anchored in a zone the model cannot choose

*Recorded 2026-09-23, in response to an independent QA review that reproduced the
bypass below against the real integrated stack.*

Every time-bearing tool takes an optional `timezone` argument. It exists for a
real reason — "I'm in Denver this week" genuinely changes which instant "10am"
names — but it used to decide a second thing as well: the wall-clock window that
instant was then judged against. Those are different questions, and conflating
them made the business-hours guardrail advisory rather than enforced.

**The concrete failure.** Contact `Jordan Prospect`, `Contact.timezone =
America/New_York`, policy 09:00–17:00 Mon–Fri. Asking for `today at 11:30pm` was
refused, correctly. Asking for `tomorrow at 10am` **with `timezone:
Asia/Kolkata`** was accepted: 10:00 Kolkata is 04:30 UTC, which is 23:30 the
previous day in New York. The `FutureAction` persisted, `business_hours` recorded
`passed: true`, and advancing the clock made `DueActionRunner` place a real
(deterministic-double) call to a US number at half past eleven at night. The
model chose the window, so the model chose the verdict.

**The decision.** The window is read in an **anchor** zone, resolved by
`businessHoursAnchor` (`src/scheduling/businessHours.ts`) from persisted data
only, in this order:

1. `BusinessHoursPolicy.timezone` — a business whose hours are its own clock, when
   the configuration row says so explicitly.
2. `Contact.timezone` — the ordinary case, and what "business hours in the
   contact's local time" actually means. No policy in `seedSliceWorld` pins a
   zone, so this is the shipped default.
3. `AgentConfiguration.defaultTimezone` — only if a contact row carries no zone.

`businessHoursAnchor` takes **no slot zone parameter at all**, so there is no
argument through which a model-supplied value could reach it, and
`ValidateSlotInput.persistedContactTimezone` is a **required** field — a new call
site that forgets it fails `npm run typecheck` rather than silently reopening the
hole. Both zones, and whether they differed, are recorded in
`ValidationProvenance.notes.businessHours`.

**What was deliberately NOT done.** The override is demoted, not removed. A New
York contact who says they are in Denver still gets "10am" read as 10:00 Denver
(= noon New York) and still gets booked; the slot is stored and spoken back in
the zone it was agreed in. Refusing every override would have passed every
"must be refused" test in `tests/e2e/timezoneOverride.test.ts` and been a
regression, which is why each refusal there is paired with a control.

**Replaces:** `businessHoursTimezone(policy, slotTimezone)`, which is deleted
rather than deprecated. Its signature was the bug — it invited a model-supplied
fallback — and leaving it exported would let the hole be reopened by a caller
doing the obvious thing. It was exported from `src/scheduling/index.ts`, which is
a declared contract with the agent layer, so its removal was announced through
the coordination mailbox. Nothing outside `SchedulingValidator` called it.

### 5.7 The minimum lead time is compared in milliseconds, and reported truthfully

*Same review, same date.*

`SchedulingValidator` rounded the lead time to the nearest minute **before**
comparing it to `minLeadTimeMinutes`, so any shortfall up to 30 seconds cleared
the gate: with `now = 14:00:30Z` and a target of `14:30:00Z`, a true lead of 29.5
minutes passed a 30-minute minimum. It then wrote `"lead time 30 min >= 30 min"`
into `validationProvenanceJson`.

The leak matters; the receipt matters more. `ValidationProvenance` exists so a
decision is **re-runnable by hand**, and a receipt that rounds the deciding
quantity in the direction that makes the decision look correct cannot be re-run —
it is not a record, it is a rationalisation. The comparison is now exact
(milliseconds against `minLeadTimeMinutes * 60_000`) and the recorded figure is
the true one, to sub-minute precision: `lead time 29.5 min is below the
configured minimum of 30 min.`

Every `now` instant in `NOW_INSTANTS` sits on a whole minute, which is precisely
why 509 scenarios could not see this. `LEAD_TIME_BOUNDARY_CASES` carries seconds,
and `dimensions.test.ts` asserts that `NOW_INSTANTS` still does not — so the two
axes cannot quietly converge and lose the coverage again.

---

## 6. Testing decisions

### 6.1 Why an invariant sweep rather than more example tests

The Founder asked for the legacy harness's invariant-sweep philosophy, adapted.
The distinction that matters: an example test asserts an expected value; an
invariant asserts a property that holds across a matrix. `tests/e2e/adversarial.test.ts`
proves 13 hostile turns are refused. `INV-05` proves **"a rejected tool call
changes no row count"** across 278 rejections spanning five timezones, ten `now`
instants, four policies and every refusal code the system can emit.

**Scale: 601 scenarios.** The legacy harness ran 538; this is the honest
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

601 fresh SQLite files plus Prisma clients costs over a minute of pure setup.
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

Running all 601 scenarios twice doubles the slowest thing in the repository. So
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
   `tests/agent`, **not by the sweep**. `reschedule_meeting` takes the same
   model-supplied `timezone` argument family J sweeps, so that tool's override
   path is proved by a unit test rather than across this matrix.
7. Family J sweeps the **model-asserted `timezone` axis at one `now` instant and
   one policy** (`p1-default`). Crossing it with all ten instants and all four
   policies would be 2,800 cases for an axis whose interesting behaviour — which
   window the resulting instant is judged in — depends on neither.
8. **No policy in this matrix pins `BusinessHoursPolicy.timezone`**, so the
   `policy` branch of `businessHoursAnchor` is never taken here; it is covered by
   `tests/scheduling/schedulingValidator.test.ts`. The consequence is worth
   stating rather than hiding: under such a policy a distant contact **can** be
   booked outside their own working hours. That is the documented meaning of
   pinning a zone, it is a decision made by whoever wrote the configuration row,
   and it is not something a model can bring about.
4. **The sweep stops at persistence.** `DueActionRunner` claim/lease/retry is
   proved by `tests/scheduling/dueActionRunner*.test.ts`; no sweep scenario
   places a call through the telephony double at all.
5. **Concurrency is not swept.** Two agents racing one idempotency key is a
   dedicated test, not a matrix dimension.
6. **The live OpenAI provider is not exercised** — by design, but it means the
   sweep says nothing about whether a real model emits well-formed calls.

---

## 7. Known dependency advisories — not fixed, deliberately

`npm audit` on a clean checkout reports **5 vulnerabilities (2 moderate, 3
high)**. Recorded here rather than silently patched, because every available fix
is a breaking major upgrade and that is a decision, not a chore.

| Advisory | Package | Severity | Where it sits | Suggested fix |
|---|---|---|---|---|
| [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) — path traversal / arbitrary file read via mock redirect | `@vitest/mocker` (via `vitest`) | moderate | **devDependency** | `vitest@5` (breaking) |
| [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) — stack exhaustion merging recursive object graphs | `deepmerge-ts` (via `@prisma/config` → `prisma` CLI) | high | **devDependency** | `prisma@6.12` (breaking, a *downgrade*) |

**Assessment:** all five are in **devDependencies** — the test runner and the
Prisma CLI. Neither is in the runtime dependency tree (`@prisma/client`,
`luxon`, `openai`, `zod`), so **nothing that would ship is affected**, and
neither advisory is reachable from untrusted input in this repository: the
mocker path is exercised only by test code we write, and the Prisma CLI reads
our own `schema.prisma`.

**Recommendation:** upgrade `vitest` to 5.x as a separate, reviewable change
rather than inside this mission. `npm audit fix --force` would *downgrade*
Prisma, which is worse than the advisory it closes.

---

## 8. Verification actually observed

The commands below were run against a **clean `git clone` into an empty
directory**, with `OPENAI_API_KEY` unset, on 2026-09-23. This records what was
observed, not what is expected.

| Command | Result |
|---|---|
| `npm install` | OK (5 dev-only advisories, § 7) |
| `npm run db:generate` | OK — created `.env` from `.env.example`, `OPENAI_API_KEY` empty; Prisma Client v6.19.3 |
| `npm run typecheck` | OK, exit 0 |
| `npm run test` | **33 files passed, 1 skipped; 455 tests passed, 2 skipped** (the 2 skips are the optional live-OpenAI test) |
| `npm run slice:demo` | OK, exit 0 — 13 audit events on one `correlationId`, `FutureAction` persisted and dispatched through the telephony double |
| `npm run qa:sweep -- --determinism` | OK, exit 0 — **509 scenarios, 2169 applicable checks, 0 violations, 0 network attempts**, and a second full run produced byte-identical classifications for every scenario id |

### 8.1 Re-verification after the § 5.6 / § 5.7 fixes

Same conditions, same machine, on **2026-09-23**, after the two defects an
independent QA review reproduced were fixed and the sweep was extended to cover
them. The corpus grew from 509 to 601 scenarios (families **J** and **K**) and
the invariant count from 11 to 12 (**INV-14**).

| Command | Result |
|---|---|
| `npm install` | OK (same 5 dev-only advisories, § 7) |
| `npm run db:setup` | OK — generate, push, seed all clean, no credential, no network |
| `npm run typecheck` | OK, exit 0 |
| `npm run test` | **36 files passed, 1 skipped; 500 tests passed, 2 skipped** |
| `npm run slice:demo` | OK, exit 0 — 13 audit events on one `correlationId`, all eight checks recorded, `FutureAction` persisted |
| `npm run qa:sweep` | OK, exit 0 — **601 scenarios, 2791 applicable checks, 0 violations, 0 network attempts**, no vacuous invariant |
| `npm run qa:sweep -- --determinism` | OK, exit 0 — same figures, and a second full run produced byte-identical classifications for every scenario id |

**The new coverage was checked against the bug, not just against itself.** With
the fix reverted and nothing else changed, `INV-14` fails **48** of its 80
applicable checks in family J — across all five contact zones, including the
reviewer's exact case (`FutureAction … starts at Wed 23:30 America/New_York …
[stored zone Asia/Kolkata differs from the anchor]`) — `INV-02` fails alongside
it, `INV-11` fails the four committed override cases, and family K's `INV-11`
reports `declared REJECT but the system accepted it` for both sub-minute
shortfalls. Six of the seven cases in `tests/e2e/timezoneOverride.test.ts` fail;
the seventh is a control that is meant to pass either way. An invariant that
cannot fail is not evidence, so this was established rather than assumed.
