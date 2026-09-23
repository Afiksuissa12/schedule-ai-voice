# Foundation contract

What the foundation task publishes, and what the scheduling, agent and QA tasks
build on. **The exported names below are a contract.** If one has to change, it
is announced through the coordination mailbox to all dependent tasks *before*
the change is committed.

Everything here is real and running: `npm run verify` builds and tests it.

---

## 1. Getting a working checkout

```bash
npm install
npm run db:generate     # prisma generate (creates .env from .env.example if absent)
npm run db:push         # apply prisma/schema.prisma to ./prisma/dev.db
npm run db:seed         # one Organization/User/AiAgent/Contact/CalendarConnection
npm run verify          # typecheck + full test suite
```

`npm run db:setup` does generate + push + seed in one command.
A committed migration also exists (`prisma/migrations/`), so
`npm run db:migrate` (`prisma migrate deploy`) is the deterministic alternative
to `db:push`.

**No test requires a network connection, a credential, or `OPENAI_API_KEY`.**

---

## 2. The governing rule this schema enforces

> The LLM reasons and converses, but **application code owns state and executes
> actions.** Tool calls are validated by application code before any external
> effect or any persistence.

Three places make that enforceable rather than aspirational:

| Mechanism | Where | What it prevents |
|---|---|---|
| `Meeting.validationProvenanceJson` / `FutureAction.validationProvenanceJson` are `NOT NULL`, and the repositories reject a receipt with no recorded checks | `prisma/schema.prisma`, `src/db/repositories/scheduling.ts` | A scheduling decision existing with no record of which checks justified it |
| `AuditEvent` with a per-`correlationId` `sequence` and `@@unique([correlationId, sequence])` | `src/audit/` | An action nobody can explain after the fact |
| `Conversation` + `ConversationTurn` with `@@unique([conversationId, index])` | `src/db/repositories/conversations.ts` | Business-critical state living only in an LLM context window |

---

## 3. Ports — `src/ports/` (import from `src/ports/index.js`)

Types only, plus the two `Clock` implementations. **Nothing in the core domain
may import a Google, Microsoft, Twilio, Telnyx, Vonage, Vapi or Retell type.**
All instants crossing a port boundary are ISO-8601 UTC strings.

| File | Exports |
|---|---|
| `clock.ts` | `Clock`, `SystemClock`, `FixedClock` (`advance(ms)`, `setTo(iso)`), `IsoUtcString` |
| `availability.ts` | `BusyInterval`, `GetBusyIntervalsRequest`, `AvailabilityProvider` |
| `calendar.ts` | `CalendarProvider`, `CalendarProviderCapabilities`, `CalendarAttendee`, `CreateCalendarEventRequest`, `UpdateCalendarEventRequest`, `CancelCalendarEventRequest`, `CalendarEventRef` |
| `telephony.ts` | `TelephonyProvider`, `TelephonyProviderCapabilities`, `TelephonyCallStatus`, `PlaceCallRequest`, `PlaceCallResult` |
| `llm.ts` | `LlmProvider`, `ToolCallRequest`, `LlmMessage`, `LlmMessageRole`, `LlmToolDefinition`, `CompleteTurnRequest`, `CompleteTurnResult` |
| `validation.ts` | `ValidationResult<T>`, `ValidationSuccess<T>`, `ValidationFailure`, `ValidationProvenance`, `ValidationCheck`, `ValidationErrorCode`, `VALIDATION_ERROR_CODES`, helpers `validationOk` / `validationFailed` / `isValidationSuccess` / `isValidationFailure` / `firstFailedCheck` |

**Inject a `Clock` into anything time-dependent.** No business logic calls
`Date.now()`, `new Date()` or `DateTime.now()`. The `now` a validator used is
recorded in `ValidationProvenance.nowUtc` so the decision can be re-run by hand.

`ValidationErrorCode` includes: `INVALID_FORMAT`, `UNKNOWN_TIMEZONE`,
`AMBIGUOUS_LOCAL_TIME`, `NONEXISTENT_LOCAL_TIME`, `IN_THE_PAST`,
`BELOW_MIN_LEAD_TIME`, `BEYOND_HORIZON`, `OUTSIDE_BUSINESS_HOURS`,
`CONFLICT_WITH_BUSY_INTERVAL`, `UNKNOWN_CONTACT`, `UNSUPPORTED_TOOL`,
`SCHEMA_VIOLATION`, `POLICY_VIOLATION`.

---

## 4. Persistence — `src/db/`

```ts
import { createDatabase } from './src/db/database.js';

const db = createDatabase({ datasourceUrl, clock });   // both injectable

await db.contacts.requireById(contactId);
await db.futureActions.claimDue({ nowUtc, leaseOwner, leaseMilliseconds });

// A domain row and the audit events that explain it commit atomically.
await db.withTransaction(async (tx) => {
  const meeting = await tx.meetings.create({ /* ... */ });
  await tx.audit.record({ /* ... */ subjectType: 'MEETING', subjectId: meeting.id });
});
```

Repositories on `Database` / `Repositories`: `organizations`, `users`,
`aiAgents`, `agentConfigurations`, `contacts`, `leads`, `qualificationStates`,
`conversations`, `conversationTurns`, `calls`, `callOutcomes`,
`calendarConnections`, `meetings`, `futureActions`, `tasks`, plus `audit` and
`clock`.

Notes that will save you time:

- **Domain entities are not Prisma rows.** Instants are ISO-8601 UTC *strings*
  and enum columns are *union types*. `src/db/mappers.ts` is the only crossing
  point, and it re-checks stored enum values on read.
- **Enums are `String` columns.** The Prisma SQLite connector cannot express
  `enum`. The permitted values live once in `src/domain/enums.ts` as a const
  object + union type + Zod schema, and every repository write path accepts only
  the union.
- **`withTransaction` nests safely.** Calling it on an already-transactional
  container runs inline on the same transaction; SQLite has no nested
  transactions.
- **`contacts.create` validates.** E.164 phone numbers and real IANA zone names
  only — `-05:00` is rejected, because an offset carries no DST rule.
- `futureActions.claimDue` increments `attempts` on each claim and will not
  claim a row whose budget is spent, so a poison action cannot loop forever. An
  expired lease is reclaimable — that is the crash-recovery path.

---

## 5. Audit — `src/audit/`

```ts
await db.audit.record({
  type: 'TOOL_CALL_VALIDATED',
  organizationId,
  correlationId,          // mint ONCE per agent turn, thread it everywhere
  conversationId, contactId, toolCallId,
  subjectType: 'MEETING', subjectId: meeting.id,
  summary: 'Proposed time passed all deterministic checks',
  detailJson: { provenance },     // object or pre-serialized string
  // occurredAt defaults to the injected Clock
});

await db.audit.listByCorrelationId(correlationId);   // replay, in sequence order
await db.audit.listBySubject('MEETING', meeting.id); // why is this row here?
```

`AuditEventType`: `UTTERANCE_RECEIVED`, `AGENT_TURN_STARTED`, `AGENT_DECISION`,
`TOOL_CALL_REQUESTED`, `TOOL_CALL_VALIDATED`, `TOOL_CALL_REJECTED`,
`TOOL_CALL_EXECUTED`, `PROVIDER_INVOKED`, `ENTITY_PERSISTED`,
`FUTURE_ACTION_SCHEDULED`, `FUTURE_ACTION_CLAIMED`, `FUTURE_ACTION_EXECUTED`,
`FUTURE_ACTION_FAILED`, `VALIDATION_REJECTED`, `HUMAN_TRANSFER_REQUESTED`.

`AuditSubjectType` covers every model. **Audit writes never fail silently** —
they throw `AuditWriteError`. Let it propagate.

---

## 6. Test helper — `tests/helpers/testDb.ts`

```ts
import { createTestDatabase, DEFAULT_TEST_NOW_UTC } from '../helpers/testDb.js';
import { FIXTURE, testProvenanceJson } from '../helpers/fixtures.js';

const harness = await createTestDatabase({ label: 'my-suite' });
const fixtures = await harness.seedFixtures();
// harness.db, harness.clock (FixedClock), harness.databaseUrl, harness.filePath
// harness.openAnotherClient()  -> prove durability across a "restart"
await harness.cleanup();        // always
```

- Every call gets its **own SQLite file**, so test files run in parallel safely.
- The schema is applied once into a template keyed by a hash of
  `schema.prisma`; each test database is a file copy (milliseconds). Editing the
  schema rebuilds the template automatically.
- `DEFAULT_TEST_NOW_UTC = '2026-03-04T15:00:00.000Z'` — Wednesday, 10:00
  America/New_York, inside business hours, four days before the 2026-03-08 US
  DST transition.
- `FIXTURE.contactTimezone` is `America/New_York` **on purpose**. A UTC-only
  fixture would let a whole class of timezone bug pass every test.
- `testProvenance()` / `testProvenanceJson()` produce a valid receipt for tests
  that need to persist a Meeting or FutureAction without exercising the
  validator themselves.

---

## 7. Deferred, pending Founder approval

- **OAuth / secrets.** `CalendarConnection` stores **no** tokens.
  `externalAccountRef` is an opaque non-secret pointer. Do not add a token
  column without an approved secrets mechanism.
- **Authentication.** `User` records who exists so Lead ownership and Task
  assignment have a real foreign key. No password hashes, no sessions.
- **Contact de-duplication.** `(organizationId, primaryPhoneE164)` is indexed
  but **not** unique: whether a shared line means one contact or several is a
  product decision that has not been made.
