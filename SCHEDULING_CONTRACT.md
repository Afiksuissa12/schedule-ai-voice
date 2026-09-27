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
  // The natural-language grammar and its locale lexicons, for callers that
  // need to reason about a `when` without going through the validator.
  parseNaturalLanguageDateTime, normalizeScript,
  REGISTERED_LEXICONS, EN_LEXICON, HE_LEXICON,
  type LocaleLexicon, type LexiconEvent, type NaturalLanguageInterpretation,
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

#### The natural-language grammar is fail-closed and its vocabulary is data

> **A phrase may resolve only if EVERY non-whitespace token of the normalised
> text was consumed by a rule. Anything left over is refused, and the refusal
> names the leftover.**

This is the contract's most important sentence and it holds in every language,
including ones the grammar will never learn. Nothing in the resolver names a
script: `غدا في 15:00`, `завтра в 15:00`, `demain à 15:00` and `qqzzx wibble
flurm at 15:00` all refuse through the same branch, each naming the words it
could not read. `docs/DECISIONS.md` § 9 records why, and what used to happen
instead.

Each locale is a declarative lexicon module — `src/scheduling/lexicon/en.ts`,
`src/scheduling/lexicon/he.ts` — exporting one `LocaleLexicon` of pure data.
The resolver holds no language-specific literal, matches against the **union**
of `REGISTERED_LEXICONS`, and matches whole **tokens** rather than substrings.
**Adding a locale is adding a module and registering it**, with no resolver
edit; `tests/scheduling/failClosedGrammar.test.ts` proves that by registering a
synthetic third locale at runtime through `ParseNaturalLanguageOptions.lexicons`.

**There is no language field anywhere.** `Contact` does not carry one and the
model is not asked. Because the union is matched, one rule is stated explicitly:

> **A token that two registered locales would read as DIFFERENT days or
> DIFFERENT times is refused. A token they AGREE on is not an ambiguity** —
> agreement means the same kind of thing with the same value, and two entries of
> *different* kinds always disagree.

`en` and `he` use disjoint scripts, so no token triggers it today. Both sides
are tested against a synthetic locale rather than left untested.

**Carrier tokens.** Each locale declares the filler words it permits and
discards **on purpose** — English `call`, `me`, `back`, `please`; Hebrew
`תתקשר`, `אליי`, `בוא`, `נגיד`. They are matched *last*, so a carrier can never
shadow a real match, and consuming one is a recorded grammar event rather than a
silent drop. `call me back tomorrow afternoon at 3` therefore still resolves,
and the receipt says which three words were ignored and by whose rule.

**Script normalisation** (`src/scheduling/lexicon/script.ts`, exported as
`normalizeScript`) runs first: Unicode NFC, bidi controls and zero-width
characters stripped, Hebrew niqqud stripped, maqaf → hyphen, geresh →
apostrophe, gershayim → double quote. It does **not** lower-case, which is what
makes it provably the identity on English input.

**English coverage.** `today` · `tomorrow` · `day after tomorrow` · weekday
names and abbreviations, bare and with `next` · `end of the week` ·
`morning`/`afternoon`/`evening`/`tonight` · `noon`/`midday`/`midnight` · clock
times with and without am/pm, `HH:mm`, `o'clock`, `p.m.` · `in N
minutes/hours/days/weeks`, including `in a couple of hours`, `in an hour`,
`half an hour` · explicit `YYYY-MM-DD` dates.

**Hebrew coverage.** `היום` / `מחר` / `מחרתיים` · all weekday names in the
`יום X`, `ביום X` and bare forms, with the modifier Hebrew puts *after* the
weekday (`יום חמישי הבא`) · `סוף השבוע` · day parts `בבוקר`,
`אחרי הצהריים`, `בערב`, and `הערב` for this evening · named times `בצהריים`,
`בחצות` · clock times in digits with the prepositional prefix in every written
form — `ב-15:00`, `ב־15:00` (maqaf), `ב15:00`, `ב 15:00`, `בשעה 15:00`,
`ל-15:00` · relative offsets `בעוד N דקות/שעות/ימים/שבועות`, the DUAL forms
`שעתיים` / `יומיים` / `שבועיים`, and `חצי שעה` · dates with or without a time ·
and code-switched phrases such as `call me back מחר ב-16:00`.

*Not covered, deliberately:* an hour spelled out in Hebrew words. `בשתיים`
("at two") refuses **naming that word**, because 02:00 and 14:00 are twelve
hours apart. See `docs/DECISIONS.md` § 9.9.

**Weekday semantics.** A bare weekday means the soonest future one *excluding
today*; `next tuesday` means the Tuesday of the following ISO week; `end of the
week` means Friday of the current ISO week, or the next one if that has passed.
The arithmetic is locale-agnostic and applies to whichever locale's word
matched. *Which* days a business works is policy and lives in `businessHours`.

**It refuses rather than guesses.** All of these return `INVALID_FORMAT`:

- a bare 12-hour time with nothing to settle am vs pm — `tomorrow at 3`,
  `מחר ב-9:00` (Hebrew has no am/pm, so the same rule applies unchanged)
- a contradiction — `tomorrow morning at 3pm`, `tomorrow in two hours`
- vague intent — `sometime next week`, `later`, `soon`, `asap`, `אולי מחר`
- a period rather than a moment — `next week`, `next month`, `שבוע הבא`
- a day with no time — `next tuesday`
- any leftover number the grammar cannot account for — `tomorrow at 3pm on the 15th`
- **any leftover token at all** — `غدا في 15:00`, `qqzzx wibble flurm`
- a genuine cross-locale ambiguity

A bare time with no day resolves to **today** and is *not* rolled forward, so a
time that has passed is reported as `IN_THE_PAST` rather than silently moved.
That branch applies **only** when every token was consumed: a day word the
grammar could not read can no longer become "the contact meant today".

#### What the interpretation records

`NaturalLanguageInterpretation` keeps `matched`, `dayAnchor`, `dayPart`,
`timeAnchor` and `normalized`, and adds, additively: `locales` (which lexicons
matched, in order), `lexicon` (every grammar event with its rule, locale,
declared form and consumed text — carriers included), `carriers`, `leftover`
(empty on success, the evidence on a refusal) and `scriptNormalization`.
`SlotInterpretation` carries `locales`, `lexicon` and `carriers` into
`ResolvedSlot`, and the whole interpretation continues to ride in
`ValidationProvenance.notes.interpretation`. Day-anchor labels stay canonical
and language-neutral, so `מחר ב-15:00` and `tomorrow at 15:00` both record
`dayAnchor: 'tomorrow'` and differ only in `locales`.

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

---

## 6. The regression and invariant coverage that backs § 2

> Added by the locale-regression task. It adds no behaviour and changes no
> existing section: everything below is a description of the tests that now hold
> § 2's promises to account. `src/scheduling` is untouched by it.

§ 2 makes three strong claims — the grammar is **fail-closed**, its vocabulary is
**data**, and the day-anchor labels are **language-neutral**. Those are the kind
of claim that stays true for exactly as long as something is watching. This is
what watches.

### 6.1 Four regression files, and what each one is for

| File | The claim it holds to account |
|---|---|
| `tests/scheduling/localeParity.test.ts` | **Hebrew and English translations resolve to the same instant.** 37 translated pairs × 6 `now` instants × 6 contact zones, asserted on the resolved UTC instant *and* on the local calendar day in the contact's zone — a RELATION, so no expected wall-clock string can go stale. Plus 3 pairs that are faithful translations and deliberately do NOT agree, each carrying its reason and asserted in its divergent shape. |
| `tests/scheduling/localeTimezoneBoundaries.test.ts` | **A day word is counted on the contact's calendar, never on UTC's**, at five instants where the two disagree (Asia/Jerusalem, America/New_York, Pacific/Auckland, Pacific/Honolulu) with one agreeing control; and the **DST gap and autumn repeat in Israel *and* the United States**, plus Pacific/Auckland's southern-hemisphere pair and Pacific/Honolulu's absence of one. Reuses `dst.test.ts`'s idioms, and re-derives every transition date from Luxon so the header table cannot become a lie. |
| `tests/scheduling/localeDateAndTime.test.ts` | **A date without a time is not a slot** — 9 day forms × 3 zones × both languages, refused with the same reason on both sides; and **a date with a time is a slot**, the same slot, for 4 different ways of naming a time. |
| `tests/scheduling/localeRefusalBreadth.test.ts` | **The fail-closed rule names no alphabet.** 13 scripts — Arabic, Cyrillic, French, Han, Hangul, Greek, Thai, Devanagari, Georgian, Ethiopic, Armenian, an invented Latin word, an emoji — each refused with the leftover quoted in the reason *and* recorded as data in the receipt. Plus the **cross-locale ambiguity** rule across all seven kinds of disagreement it distinguishes, each with an agreement control. |

Every refusal in the last file is held to the same three statements: it refuses
with `INVALID_FORMAT`, the reason NAMES the token, and it never becomes "the
contact meant today". The last of those is the one that matters — a refusal
nobody can act on is a nuisance, a wrong day is a customer on the phone at the
wrong hour.

### 6.2 Three new invariants in the sweep

`tests/invariants/` grew from 601 scenarios in 11 families to **823 in 12**, and
from 12 per-scenario invariants to **15**:

| Invariant | Statement |
|---|---|
| `INV-15-no-accepted-resolution-ignores-a-token` | Every ACCEPTED natural-language `when` consumed every token: `interpretation.leftover` is empty. Read from the `TOOL_CALL_VALIDATED` audit event, so it covers `check_availability` too, which accepts a time and writes nothing. |
| `INV-16-hebrew-and-english-parity` | A translated pair resolves to the same instant under the same `now`, zone and policy — and where a row was persisted, that row's instant equals both sides. |
| `INV-17-resolved-day-is-the-day-the-phrase-named` | Every persisted instant falls on the calendar day its own receipt names, read in the zone the phrase was resolved in — which, for every scenario that does not populate the model-supplied `timezone` argument, is asserted to BE the contact's persisted zone. |

The new family is **`L-locale-parity`**: 10 Hebrew/English pairs, *both sides of
each*, through the real dispatcher against a seeded Asia/Jerusalem,
America/New_York or Pacific/Auckland contact. `REJECTED_EXPRESSIONS` also gained
9 entries — the Hebrew refusal classes and four unknown-language ones — which
family C crosses with all five main zones.

### 6.3 What this coverage does NOT give you

Stated here because silent truncation that reads as full coverage is a defect in
itself. All of it is also in `KNOWN_COVERAGE_GAPS`, so it appears in the printed
`npm run qa:sweep` report and not only in a document.

- **Family L is bounded to 3 zones and 2 `now` instants, deliberately.** Adding
  Asia/Jerusalem and Pacific/Auckland to the shared `TIMEZONES` axis would have
  cost ~224 extra scenarios across seven families to re-prove *English* behaviour
  at a different offset. The consequence: Hebrew is not swept in Europe/London,
  Australia/Sydney, Asia/Kolkata or UTC. `localeParity.test.ts` covers six zones
  at the resolver level, where a cell costs microseconds rather than a database.
- **`INV-16` is not an independent oracle.** It resolves the counterpart phrase
  through `DateTimeResolver`, the system under test, because no oracle can know
  what a Hebrew phrase means without a Hebrew dictionary and writing one in the
  harness would be the reimplementation the design forbids. It is worth having
  because the claim is *relational* and because it is tied to the persisted row.
  A change that broke both languages identically passes it — and fails
  `tests/scheduling/naturalLanguage.test.ts`, which pins English independently.
- **`INV-17` re-derives only the day anchors whose meaning is fixed arithmetic**
  (`today`, `implicit_today`, `tonight`, `tomorrow`, `day_after_tomorrow`,
  `iso_date:*`). A `weekday:*`, `next_weekday:*` or `end_of_week` anchor is
  reported INAPPLICABLE *naming the label*, because deriving it would mean
  reimplementing the ISO-week arithmetic under test.
- **The Hebrew grammar cannot name a local time between 01:00 and 03:00**, which
  is where every ordinary DST transition sits: Hebrew has no am/pm and no
  declared day part covers 02:00, so a digit hour of 1–11 is refused first
  (`docs/DECISIONS.md` § 9.9). The gap and repeat classes are therefore driven
  through the locale-agnostic ISO path and the English grammar. That a *Hebrew*
  phrase reaches the same DST checks is proved with America/Havana, whose
  spring-forward happens at local midnight — the one transition hour Hebrew can
  name, because `בחצות` is a declared named time.

### 6.4 The wrong-day gate is still sharp

`tests/eval/wrongDayGate.test.ts` was not weakened. Nothing in this coverage
touches it: it still feeds a **synthetic** wrong-day result to the scorer and
still proves the gate zeroes the tool-and-structural category, moves the
composite, and fails the run. Now that no real run in the suite produces a wrong
day, that file is the only place the gate's teeth can be demonstrated at all.
