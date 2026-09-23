# Scheduling contract

What the scheduling task publishes for the agent layer and the integration
slice. **The exported names and signatures below are a contract.** If one has to
change it is announced through the coordination mailbox to every dependent task
*before* the change is committed.

Builds on `FOUNDATION_CONTRACT.md`. Everything here is real and running:
`npm run verify`.

---

## 1. The two rules this code exists to enforce

> **Never trust an LLM-generated datetime blindly.** Every proposed datetime is
> parsed, timezone-resolved, and checked against DST, `now`, lead time, horizon,
> business hours and availability *before* anything is persisted or acted on.

> **Follow-up is durable from the start.** A promised callback is a database row
> with a validated instant, its timezone and a self-sufficient payload, executed
> by a background runner that has never seen an LLM context window.

Three things make those enforceable rather than aspirational:

| Mechanism | Where |
|---|---|
| A `Meeting`/`FutureAction` cannot be written without a `ValidationProvenance` recording which checks ran, in which order, against which `now` | `src/scheduling/checkLog.ts`, enforced by the foundation's repositories |
| On `ok:false` the services persist **nothing** but a `VALIDATION_REJECTED` audit event — asserted for every error code, with row counts | `tests/scheduling/meetingSchedulingService.test.ts`, `futureActionService.test.ts` |
| The durable queue is the database; a promise survives destroying every in-memory object and Prisma client | `tests/scheduling/dueActionRunner.restart.test.ts` |

---

## 2. `src/scheduling` — validation

```ts
import {
  DateTimeResolver, SchedulingValidator, MeetingSchedulingService,
  schedulingPolicyFromAgentConfiguration,
} from './src/scheduling/index.js';
```

### Policy — always from the persisted row

```ts
schedulingPolicyFromAgentConfiguration(config: AgentConfiguration): SchedulingPolicy
```

`SchedulingPolicy` = `{ agentConfigurationId, agentConfigurationVersion,
businessHours, dayParts, minLeadTimeMinutes, maxSchedulingHorizonDays,
defaultTimezone, defaultMeetingDurationMinutes }`.

Business hours, lead time and horizon come from the `AgentConfiguration` row
pinned to the conversation — never from a constant and never from the model.
Day-part windows and the default slot length ride in the same
`businessHoursJson` column as two optional extra keys (`dayParts`,
`defaultMeetingDurationMinutes`); the foundation's `BusinessHoursPolicySchema`
strips them, so its own parse path is unaffected.

### Day-part windows (the documented defaults)

| day part | window (local, half-open) | used when no clock time is given |
|---|---|---|
| morning | 08:00 – 12:00 | 09:00 |
| afternoon | 12:00 – 17:00 | 14:00 |
| evening | 17:00 – 21:00 | 18:00 |

These are wall-clock windows in the contact's zone and are deliberately
independent of business hours: "this evening" resolves, and *then* gets refused
with `OUTSIDE_BUSINESS_HOURS` rather than being silently shifted.

### `DateTimeResolver`

```ts
new DateTimeResolver(clock: Clock)
  .resolve(proposal: DateTimeProposal, options: ResolveOptions): ValidationResult<ResolvedSlot>

interface DateTimeProposal { raw: string; timezone: string; durationMinutes?: number }
interface ResolveOptions   { policy: SchedulingPolicy; nowUtc?: IsoUtcString;
                             checks?: ValidationCheckLog; validatorVersion?: string }
interface ResolvedSlot     { startUtc; endUtc; timezone; startLocal; endLocal;
                             durationMinutes; interpretation }
```

Accepts an ISO instant, an ISO local datetime, or natural language. Pure: no
wall clock, no database, no mutation.

**Natural-language coverage.** `today` · `tomorrow` · `day after tomorrow` ·
weekday names and abbreviations, bare and with `next` · `end of the week` ·
`morning`/`afternoon`/`evening`/`tonight` · `noon`/`midday`/`midnight` · clock
times with and without am/pm, `HH:mm`, `o'clock`, `p.m.` · `in N
minutes/hours/days/weeks`, including `in a couple of hours`, `in an hour`,
`half an hour` · explicit `YYYY-MM-DD` dates.

**Weekday semantics.** A bare weekday means the soonest future one *excluding
today*; `next tuesday` means the Tuesday of the following ISO week; `end of the
week` means Friday of the current ISO week, or the next one if that has passed.

**It refuses rather than guesses.** All of these return `INVALID_FORMAT`:

- a bare 12-hour time with nothing to settle am vs pm — `tomorrow at 3`
- a contradiction — `tomorrow morning at 3pm`, `tomorrow in two hours`
- vague intent — `sometime next week`, `later`, `soon`, `asap`
- a period rather than a moment — `next week`, `next month`
- a day with no time — `next tuesday`
- any leftover number the grammar cannot account for — `tomorrow at 3pm on the 15th`

A bare time with no day resolves to **today** and is *not* rolled forward, so a
time that has passed is reported as `IN_THE_PAST` rather than silently moved.

### `SchedulingValidator`

```ts
new SchedulingValidator({ clock, availability, resolver?, validatorVersion? })
  .validate(input: ValidateSlotInput): Promise<ValidationResult<ResolvedSlot>>

interface ValidateSlotInput {
  proposal: DateTimeProposal;
  policy: SchedulingPolicy;
  persistedContactTimezone: string;  // REQUIRED. Contact.timezone, off the row.
                                     // NOT proposal.timezone - see check 8 below.
  calendarRef?: string;          // required when the availability check runs
  checkBusinessHours?: boolean;  // default true
  checkAvailability?: boolean;   // default true iff calendarRef is supplied
  nowUtc?: IsoUtcString;         // replay only
}
```

**The check order is part of the contract** (`SCHEDULING_CHECK_NAMES`). Cheap
structural questions first, provider I/O last, so a malformed proposal never
costs a provider call:

| # | check | failure code |
|---|---|---|
| 1 | `timezone_is_iana` | `UNKNOWN_TIMEZONE` |
| 2 | `parse_proposed_value` | `INVALID_FORMAT` |
| 3 | `local_time_exists` | `NONEXISTENT_LOCAL_TIME` |
| 4 | `local_time_unambiguous` | `AMBIGUOUS_LOCAL_TIME` |
| 5 | `in_the_future` | `IN_THE_PAST` |
| 6 | `min_lead_time` | `BELOW_MIN_LEAD_TIME` |
| 7 | `within_horizon` | `BEYOND_HORIZON` |
| 8 | `business_hours` | `OUTSIDE_BUSINESS_HOURS` |
| 9 | `no_busy_conflict` | `CONFLICT_WITH_BUSY_INTERVAL` |

Boundaries, stated once so nobody has to guess:

- lead time and horizon are **inclusive** at the boundary; `in_the_future` is **strict**
- lead time is compared in **milliseconds**, not rounded minutes; the receipt records the true lead to sub-minute precision
- a slot starting exactly at business-hours open is inside; one *ending* exactly at close is inside; one *starting* at close is outside
- overlap is half-open, so a slot adjacent to a busy interval does **not** conflict
- the horizon is measured in fixed 24-hour days, not calendar days
- check 8 is evaluated in an **anchor** zone resolved by `businessHoursAnchor` from persisted data only — `BusinessHoursPolicy.timezone`, else `Contact.timezone`, else `AgentConfiguration.defaultTimezone`. It is NOT the zone the slot was agreed in, because that one can come from a model-supplied tool argument. `ValidateSlotInput.persistedContactTimezone` is required for this reason. See `docs/DECISIONS.md` § 5.6.

Skipped checks are named in `provenance.notes.skippedChecks`, so a reader can
always tell a check that passed from one that never ran.

### `MeetingSchedulingService`

```ts
new MeetingSchedulingService({ db, clock, validator, calendar })

schedule(input: ScheduleMeetingInput):     Promise<ValidationResult<ScheduledMeeting>>
reschedule(input: RescheduleMeetingInput): Promise<ValidationResult<ScheduledMeeting>>
cancel(input: CancelMeetingInput):         Promise<ValidationResult<ScheduledMeeting>>

interface ScheduleMeetingInput {
  organizationId: string; contactId: string; conversationId?: string | null;
  agentConfigurationId: string;
  proposal: { raw: string; timezone?: string; durationMinutes?: number };
  title: string; description?: string | null;
  calendarConnectionId?: string | null;
  attendees?: readonly CalendarAttendee[];
  idempotencyKey?: string | null;
  correlationId: string;            // REQUIRED - mint once per agent turn
  toolCallId?: string | null;
}

interface ScheduledMeeting {
  meeting: Meeting; slot: ResolvedSlot;
  reusedExisting: boolean; externalCalendarEventId: string | null;
}
```

- **ok:true** → `Meeting` + `TOOL_CALL_VALIDATED` + `ENTITY_PERSISTED` in one
  transaction, then `CalendarProvider.createEvent` and `PROVIDER_INVOKED`.
- **ok:false** → nothing persisted, one `VALIDATION_REJECTED` audit event, the
  failure returned.
- **idempotency** → the same `idempotencyKey` returns the existing meeting,
  including under two concurrent attempts.

*Deliberate non-goal:* conflicts are checked against the `AvailabilityProvider`
only. Also checking the organization's own `Meeting` rows
(`meetings.listOverlapping`) is a sensible next step and is not in this slice.

---

## 3. `src/followup` — durable promises

```ts
new FutureActionService({ db, clock, validator })
  .schedule(input: ScheduleFutureActionInput): Promise<ValidationResult<ScheduledFutureAction>>
```

Same validate-then-persist discipline, producing a `PENDING` `CALL_CONTACT`
with `scheduledForUtc`, `timezone`, `payloadJson`, `idempotencyKey` and
`validationProvenanceJson`, plus `FUTURE_ACTION_SCHEDULED`.

`checkBusinessHours` defaults to **true**; `checkAvailability` defaults to
**false** — a callback does not occupy a calendar slot, so a busy diary is not a
reason to refuse to phone someone.

```ts
new DueActionRunner({ db, clock, telephony, fromE164,
                      runnerId?, leaseMilliseconds?, batchSize?, backoff? })

runDueActions(nowUtc?: IsoUtcString): Promise<DueActionRunSummary>   // ONE deterministic pass
start(options?: { intervalMs?: number; onError?: (e: unknown) => void }): void
stop(): void
```

Claims `PENDING` (and lease-expired) actions due at `nowUtc`, dispatches
`CALL_CONTACT` through the `TelephonyProvider`, writes `Call` + `CallOutcome`,
and transitions to `DONE` or back to `PENDING` with exponential backoff until
`maxAttempts`, then `FAILED`. Emits `FUTURE_ACTION_CLAIMED`,
`FUTURE_ACTION_EXECUTED` and `FUTURE_ACTION_FAILED` on the **original agent
turn's `correlationId`**, which is carried in the payload.

Telephony status mapping: `COMPLETED` → `CONNECTED`, done. `NO_ANSWER` →
retryable. `FAILED` or a thrown transport error → retryable. A non-terminal
status (`QUEUED`/`RINGING`/`IN_PROGRESS`) leaves the action due again;
webhook-driven completion is out of this slice.

No broker, no hosted scheduler, nothing paid — `FutureAction` is the queue.

---

## 4. `src/providers` — the boundary

```ts
import { createProviderRegistry } from './src/providers/index.js';

const providers = createProviderRegistry({
  availability: { options: { rules: [{ timezone: 'America/New_York',
                                       startLocal: '12:00', endLocal: '13:00' }] } },
  telephony:    { options: { script: [{ status: 'NO_ANSWER' }, { status: 'COMPLETED' }] } },
});
```

`DeterministicAvailabilityProvider` (seeded intervals and/or recurring local
rules, identical output for identical input), `DeterministicCalendarProvider`
(idempotency-keyed, stable hashed `externalEventId`, reports `canInvite: false`
because it delivers nothing), `DeterministicTelephonyProvider` (scripted
outcomes, deterministic `providerCallId`, no network — it imports no transport
at all).

`DETERMINISTIC_TEST` is the only authorized kind. Asking for `GOOGLE`,
`MICROSOFT_GRAPH`, `TWILIO`, `TELNYX`, `VONAGE`, `VAPI` or `RETELL` throws a
`ConfigurationError` naming the extension point rather than silently falling
back to a double. `tests/scheduling/providerBoundary.test.ts` fails the build if
`src/scheduling`, `src/followup`, `src/domain` or `src/providers` ever imports a
vendor SDK.

---

## 5. Known divergence, raised with the foundation

`FutureActionRepository.markFailed` cannot express retry **backoff** — it
returns an action to `PENDING` but leaves `scheduledForUtc` alone, so the next
pass re-claims it immediately and the whole attempt budget burns in one pass.
The requested additive fix is `markFailed(id, { error, terminal, retryAtUtc })`.

Until it lands, `DueActionRunner.applyRetryBackoff` (one method, clearly
marked) writes the transition through `Database.prisma.$transaction` alongside
the `FUTURE_ACTION_FAILED` audit event via `createRepositories(tx)`, so
atomicity and the audit invariant are preserved. This is the only place in
`src/scheduling`, `src/followup` or `src/providers` that reaches past the
repositories.

`src/scheduling/zodJson.ts` exists for a second, smaller reason: the shared
`parseJsonWith` is typed `ZodType<T>`, which resolves to a schema's *input* type
when `.default()` is used, making every defaulted field look
possibly-undefined. Both were reported through the mailbox.
