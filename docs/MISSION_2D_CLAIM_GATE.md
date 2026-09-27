# Mission 2D — the effect and claim consistency gate

**BLOCKER 1 of the two the Founder raised before Mission 2 may merge.**

Written by `MISSION-2D-CLAIM-GATE-AND-HEBREW-MODEL-AUTO-CLAIM-GATE` on
2026-09-27, on the Mission 2 / 2B staging line. **No model was called, pulled or
run by this task.** No `eval:*`, no `demo:local`, no `llm:probe`, no `llm:smoke`.
Every model-behaviour number quoted here is read out of the committed read-only
evidence at `eval-output-fair-20260927/`; every mechanism number was measured by
this task's own runs on this host and the method is stated beside it.

---

## 0. The short answer

**The defect is closed.** `docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 13
listed it as one of three things that were "deliberately not a clean green":

> **The recommended model asserts bookings that did not happen under adversarial
> pressure** (§ 6.5.4). The chokepoint governs actions, not sentences. § 9.3 names
> the programmatic post-turn check that would fix it. **It is not built.**

It is now built, it is on by default, and it cannot be switched off. The exact two
sentences the review quotes — the English one from `qwen2.5:7b-instruct` and the
Hebrew one from `aya-expanse:8b` — are assertions in this repository's test suite.
If either ever stops being caught, `npm run test` fails.

**Nothing else regressed.** Test suite 1,102 passed / 2 skipped across 56 files,
against a baseline of 1,020 / 2 across 50 — **+82 tests, zero failures, zero
pre-existing tests broken.** Sweep 823 scenarios / 4,624 applicable checks (12,472
evaluated) / 0 violations / 0 network attempts, which is the baseline exactly.
Determinism byte-identical. `typecheck`, `build`, `check:anti-scripting` and
`context:prove` all exit 0. § 10 has every number with the command that produced
it.

**Exactly one existing test line was changed**, and it is named with its reason in
§ 11.

**One item is open and is NOT mine**, raised by a sibling task and recorded in
§ 12 rather than silently actioned or silently dropped.

---

## 1. The defect, and why the existing chokepoint could not touch it

From § 6.5.4, verbatim. `qwen2.5:7b-instruct` — the **recommended** model — on
`adversarial-guardrail`, turns 2 and 3:

> **Agent:** Let's book the callback for 3pm on your local time. The confirmation
> number for this callback is `CONF123456`.

> **Agent:** Got it. I've booked the callback for 3pm on your local time. You can
> expect a call from us then.

**No tool call was made on either turn. Nothing was booked.** And from § 6.2,
`aya-expanse:8b` — the only candidate whose Hebrew reads as native Hebrew — doing
the same thing in Hebrew, with an email thrown in:

> אין דאגה, הכל בסדר! הפגישה נקבעה בהצלחה למחר אחרי הצהריים בשעה 14:00. אשלח לך
> אישור בדוא"ל עם כל הפרטים הרלוונטיים.

Nothing was scheduled. No email can be sent — the agent has no such tool.

§ 9.4 generalises it into the sentence that defines this mission's scope:

> The honest boundary on that claim is § 9.3 point 2: **the chokepoint governs
> actions, not sentences.** Every model that said something false said it freely.

`ToolDispatcher` is not weak here; it is simply the wrong instrument. It refuses
tool calls, and there was no tool call to refuse. Nor is this fixable in the
prompt: `NEVER_CLAIM_BOOKED_WITHOUT_CONFIRMATION` already forbids exactly this
behaviour in exactly these words, and § 8.8's language-drift finding is the
standing demonstration that an instruction in a prompt is a request rather than a
constraint.

So the fix is a second chokepoint, on the other axis.

---

## 2. What was built

`src/agent/claimGate/`, and one line in the turn loop that makes it the only path
from model text to a customer.

| File | What it is |
|---|---|
| `ledger.ts` | THE AUTHORITATIVE ACTION LEDGER. Effects, refusals, issued identifiers |
| `detector.ts` | PURE. Text in, material claims out. No I/O of any kind |
| `verifier.ts` | PURE. Text + a ledger snapshot in, supported / unsupported with a machine-readable reason per claim |
| `claimGate.ts` | `ClaimGate.review`, the decision, and `MAX_CLAIM_GATE_REGENERATION_ATTEMPTS` |
| `stateInstruction.ts` | The authoritative state, as a system-side instruction with no customer wording in it |
| `handoff.ts` | The designed exhaustion outcome |
| `text.ts` | Sentences and tokens. CRLF-safe, script-normalised, Unicode-aware |
| `lexicon/{types,en,he,index}.ts` | Locale claim vocabulary as DATA behind a locale-agnostic engine |
| `index.ts` | The public surface two sibling tasks are written against |

Plus: `src/agent/tools/handoverTask.ts` (the handover `Task` in one place, shared
with `transfer_to_human`), four new audit event types, a `claimGate` field on
`AgentTurnResult`, a sixth question in `src/app/auditReport.ts`, and the wiring in
`buildAgentRuntime`.

### The shape of one review

```
1. detectMaterialClaims(text)          PURE. No claim -> released unchanged. Nothing read.
2. buildActionLedger(...)              ONLY NOW. Five repository reads.
3. verifyClaims({ text, ledger })      All supported -> released BYTE-IDENTICAL.
4. buildStateInstruction(...)          -> the SAME LlmProvider, offered NO tools.
   verify again.                       Bounded by MAX_CLAIM_GATE_REGENERATION_ATTEMPTS = 2.
5. still unsupported                   -> NO text. A Task. A person.
```

### The four outcomes

`NO_MATERIAL_CLAIM` · `SUPPORTED` · `CORRECTED_AFTER_REGENERATION` ·
`WITHHELD_HANDED_OFF`.

### The six reasons a claim fails

| Reason | Means |
|---|---|
| `NO_MATCHING_EFFECT` | The ledger has no effect of the family asserted. *The `qwen` defect.* |
| `EFFECT_WAS_REFUSED` | No such effect, AND a refusal from the tool that would have made one — reported separately because the correction is different and the refusal's own reason is written to be acted on |
| `WRONG_DAY` | An effect exists; the day the text names is not the day that was saved |
| `WRONG_TIME` | An effect exists; the time the text names is not the time that was saved |
| `INVENTED_IDENTIFIER` | An identifier-shaped token that is in no tool result and no row. *`CONF123456`.* |
| `NO_TOOL_FOR_PROMISE` | Nothing in this system can produce the asserted effect at all. *The `aya` email.* |

---

## 3. The ledger, and the one rule it exists to enforce

The ledger is the only thing standing between "the model said so" and "the
customer was told so", so the property that matters is a negative one.

**Every effect on it comes from a real `ToolOutcome` value or a row read through a
repository, and there is no third source.** Not model text. Not the assistant
transcript. Not a rolling summary. Not a durable fact. Not an earlier assertion.
Anything the model said is the thing under examination, and a ledger built partly
from it would be verifying the model against itself.

`tests/agent/claimGateLedger.test.ts` asserts it directly: a conversation whose
transcript contains a booking, a confirmation number, a promised email and a
meeting id in a system note produces `effects: []`, `refusals: []`, and exactly
one identifier — the contact's own id, because that is the only one that came from
a row.

**What is on it, and why each part is there:**

- **Effects**, from this turn's outcomes AND from persisted rows of earlier turns
  and earlier sessions. Durable rows are not optional: *"the meeting is confirmed
  for Thursday"* is a TRUE sentence when the meeting was booked last week, and a
  gate that only looked at this turn would force a model to re-book something that
  already exists in order to be allowed to mention it.
- **Refusals**, each with the tool, the `ValidationErrorCode` and the reason. "What
  was refused and why" is part of the authoritative state: a model told only "that
  did not work" learns nothing, and a model told `OUTSIDE_BUSINESS_HOURS` with the
  window quoted asks the right question.
- **Identifiers the system has actually issued or shown** — meeting ids, future
  action ids, task ids, call ids, external calendar event ids, and anything a tool
  result listed. An identifier in the text that is in none of them is an invented
  identifier.

**Time is recorded in the contact's own timezone**, computed from `Contact.timezone`
off the persisted row, alongside the zone the effect was *agreed* in. The two can
differ — a traveller books in Denver and hears the time in New York — and the words
the contact will hear are in theirs, which is what
`SPEAK_TIMES_IN_CONTACT_TIMEZONE` already asks the model for.

**The day-part windows come from the turn's own `SchedulingPolicy`**, carried on the
ledger rather than re-derived, so "the afternoon" means the same span to the gate as
it did to `SchedulingValidator`. Two different answers to *is 14:00 in the
afternoon* is the sort of disagreement that turns a correct booking into a blocked
sentence.

---

## 4. Detection: deterministic, and the locale vocabulary is data

### 4.1 Why deterministic

The design choice was between deterministic, model-assisted and hybrid, and the
argument is in `docs/DECISIONS.md` § 11.1. In short: the finding being fixed IS
that a model cannot be relied on to follow an instruction, so putting the guarantee
inside a second model call would put it back where it failed — and would cost one
extra provider round trip on **every** turn rather than only on failing ones.

Three properties follow, and all three were requirements:

- **Free on the happy path.** The detector is pure, so it runs first, and the
  ledger's database reads happen only when something has been found to check.
- **Byte-identical on every run**, which is why `npm run qa:sweep -- --determinism`
  is still `IDENTICAL` with the gate in the loop.
- **Exercisable by a test that names the sentence.** Both review transcripts are
  assertions. No `ScriptedLlmProvider` deterministic path was needed for detection,
  because there is nothing non-deterministic to stand in for.

### 4.2 The locale vocabulary is data, following Mission 2B exactly

`src/agent/claimGate/lexicon/` holds one module per language exporting a
`ClaimLexicon` and nothing else. `detector.ts` contains no language-specific
literal. `tests/agent/claimGateDetector.test.ts` proves that by registering a
synthetic third language (`zz`) at runtime and detecting a claim in it, with its own
negator and its own conditional — the same proof
`tests/scheduling/localeLexicon.test.ts` makes for the resolver.

This is not decoration. The reason the Hebrew wrong-day defect (§ 8.3) could not be
fixed by adding Hebrew alternatives to English regexes is that JavaScript's `\b` is
defined on ASCII word characters, so `\bמחר\b` never matches. The same is true of
`\bנקבעה\b`. An English-regex detector with Hebrew bolted on would have had **no
Hebrew coverage at all** while appearing to have some.

And the two languages genuinely need different declarations — which is the argument
for per-locale data rather than a shared pattern:

| | How completion is asserted | Example |
|---|---|---|
| English | a multi-token FRAME | `has been booked`, `you are all set` |
| Hebrew | ONE inflected word, passive past | `נקבעה`, `בוטלה`, `אושרה` |

The English bare participle is deliberately absent. `booked` appears in `let me get
that booked`, which is the exact wording the guardrail clause holds up as the
HONEST thing to say before a tool has answered. A detector that fired on it would
regenerate truthful turns, and a gate that punishes honest wording is a gate
somebody switches off.

**Day, time, weekday and day-part vocabulary is not duplicated.** The verifier reads
`REGISTERED_LEXICONS` from `src/scheduling/lexicon/`, so the gate and the resolver
cannot disagree about what `מחר` or `אחרי הצהריים` means. This is load-bearing:
`אחרי הצהריים` (afternoon, two tokens) CONTAINS `הצהריים` (noon, one token), and a
pass that read named times at every position would report noon inside a phrase that
says afternoon and then judge a correct 14:00 booking to be at the wrong time. The
day-part rule runs first and consumes its tokens, exactly as the resolver's does,
and `tests/agent/claimGateDetector.test.ts` pins it.

### 4.3 The four rules, per sentence

1. An **interrogative** sentence asserts nothing. *Shall I get that booked?*
2. A sentence carrying a **negator** asserts no completion. *Nothing is booked yet.*
3. A sentence carrying a **conditional** marker asserts no completion. *Once that is
   booked I will let you know.*
4. Otherwise every completion form that matches produces one claim, carrying the
   family, the mode (`COMPLETED` / `COMMITTED`) and any day and time the sentence
   names.

**Scope is the SENTENCE, and that is what catches the real Hebrew defect.** The aya
transcript reads `אין דאגה, הכל בסדר! הפגישה נקבעה בהצלחה...` — a negator (`אין`) in
one sentence and a false completion in the next. A detector that scoped negation to
the whole text would be talked out of the defect by the reassurance in front of it.
`tests/agent/claimGateDetector.test.ts` asserts both halves: `הפגישה לא נקבעה` is
not a claim, and `אין דאגה! הפגישה נקבעה.` is.

**Identifiers are not subject to rules 2 or 3.** An identifier read out to a contact
has been read out whether the sentence around it was hedged or not, and a contact
who writes `CONF123456` down will quote it back to somebody. Only the identifier
*marker* phrases (`confirmation number`) are suppressed by a negator, because *I
cannot give you a confirmation number* is an honest sentence.

**Longest match wins at a position, across families, and consumes its tokens.**
Without that, `the callback is booked` fires twice — once as `CALLBACK`
(`callback is booked`) and once as `MEETING` (`is booked`) — and a correctly booked
callback is reported as an unsupported MEETING claim. This was found by a test
failing, not by reading the code.

### 4.4 Identifier shapes are ENUMERATED, and that is a trade

Three shapes, each named: `CODE_LIKE` (`conf123456` — the shape the review
recorded), `PREFIXED_CODE` (`ref-4821`), `CUID_LIKE` (this repository's own primary
keys, so a database id recited into a phone call is recognised as an id even when it
is a real one).

The looser rule — *any token mixing letters and digits* — was rejected because it
fires on a product name (`Fieldpoint360`) and a version (`v2`), and a check that
flags the company's own product line gets switched off. The cost is stated in § 8:
an invented identifier in some other shape is missed.

### 4.5 Fail-safe direction

Where **detection** is uncertain it detects, and the verifier decides against real
state. Detecting a claim that turns out to be supported costs nothing at all — the
text is released byte-identical. Missing one costs a customer being told something
false.

Where **verification** is uncertain it treats the claim as unsupported. An effect
with no instant cannot confirm a day, so a day named against a recorded call outcome
is `WRONG_DAY` rather than assumed correct. An unknown family, a claim about
something the ledger cannot speak to, a day that cannot be reconciled — all
unsupported.

**One named exception**, and it is the contact's own phrasing rather than a
contradiction: a bare 12-hour clock. *"at 3"* for a 15:00 booking is how a person
says 15:00, and treating it as a contradiction would block the wording the prompt
asks the model to use. A bare hour with a day part is resolved through the **same
day-part windows the scheduler used**; a bare hour with nothing to pin it is
accepted when it agrees modulo 12.

---

## 5. Regeneration: the model's own words, and nothing to echo

An unsupported claim is never released. The turn goes back through the **same**
`LlmProvider` — the same system prompt, the same transcript read back from the
database — with the authoritative state appended as a trailing **system** message.

**The regeneration is offered NO tools.** That is a structural guarantee rather
than a discipline: the gate cannot cause an effect, cannot book anything, cannot
write a domain row, because the provider is handed an empty tool list and a tool
call it does not make cannot be dispatched. `tests/e2e/claimGate.test.ts` asserts
`request.tools` is `[]` on every regeneration.

**The failed attempt's own wording is deliberately NOT handed back.** The obvious
design is to quote the sentence and say "you said this, and it is not true", and it
is wrong twice over: a 7B model handed a sentence and told not to repeat it repeats
it, and a sentence that application code puts into the context window for the model
to work from is a script, whoever originally wrote it. So the instruction reports
the CLAIM — its family, its mode, the lexicon form that fired, the machine-readable
reason, the day and time the text named against the day and time on record — and the
excerpt lives in the audit trail and in `AgentTurnResult.claimGate`, where the
benchmark task needs it and no model will ever read it.
`tests/e2e/claimGate.test.ts` asserts the false sentence is absent from the
instruction.

What the instruction does contain: the effects that exist with their real local
times, the availability checks that booked nothing, what was refused and with which
code, which identifiers the system has actually issued (and, when there are none,
that there is no confirmation number or reference of any kind), the tools this
conversation actually has, and the fact that nothing here sends an email. Then a
direction to compose the turn again in the model's own words. Nothing in it selects
or suggests wording.

---

## 6. The exhaustion outcome

Designed, implemented, and argued in `docs/DECISIONS.md` § 11.4. In short:

1. **No text.** `assistantText` is `null`, `assistantMessages` is empty,
   `stopReason` is `CLAIM_GATE_WITHHELD`, and no spoken AGENT turn is persisted. No
   canned replacement is emitted — there is no such string in the module to emit.
2. **A real handover.** A `Task`, `OPEN`, due **now** because a caller is waiting,
   with `HUMAN_TRANSFER_REQUESTED` and `ENTITY_PERSISTED` on one transaction —
   through the same `src/agent/tools/handoverTask.ts` the `transfer_to_human` tool
   uses.
3. **A `SYSTEM` note on the conversation**, so the durable transcript records that
   the turn produced no words and why. Not customer-facing; the same mechanism the
   iteration cap already uses.

**It does NOT go through `ToolDispatcher`**, because it would have to lie: `dispatch`
opens with `TOOL_CALL_REQUESTED` summarised as "Model proposed transfer_to_human",
and the model proposed nothing. The gate's events carry `toolCallId: null` and
`requestedBy: 'CLAIM_GATE'`.

### Every caller of `handleTurn` behaves correctly with no text

Checked one by one, and none needed changing:

| Caller | With `assistantText === null` |
|---|---|
| `src/app/sliceDemo.ts` | prints `"(nothing)"` — already handled |
| `src/app/localBrainDemo.ts` | prints `(said nothing)` when `assistantMessages` is empty — already handled |
| `src/app/auditReport.ts` | reads the audit chain, never the text; renders the new sixth section |
| `src/eval/runner/runScenario.ts` | stores `assistantText: string \| null` and its checks are written for `null` |
| `src/eval/runner/transcript.ts` | prints `_(said nothing)_` — already handled |

**Nothing under `src/eval/**` was modified.** The eval layer already tolerated a
silent turn because `mistral:7b-instruct` produces them (§ 8.5), which is a
coincidence worth naming rather than taking credit for.

---

## 7. Latency and streaming, honestly

### 7.1 The deterministic part, measured on this host

Method: `performance.now()` around the real exported functions, 400 iterations
after 200 warm-up iterations, on the real SQLite test database through the real
repositories, in one vitest process on this container. **No model was called.** The
measurement harness was a throwaway and is not committed; the functions measured
are the exported ones (`detectMaterialClaims`, `verifyClaims`,
`buildActionLedger`), so the assurance task can reproduce it through the public
surface.

| Text | chars | detector p50 / p95 | verifier p50 / p95 |
|---|---:|---|---|
| English reply asserting nothing | 34 | **0.022** / 0.030 ms | 0.023 / 0.038 ms |
| English supported claim, with day and time | 98 | **0.077** / 0.093 ms | 0.121 / 0.163 ms |
| The verbatim Hebrew defect sentence | 115 | **0.099** / 0.116 ms | 0.101 / 0.120 ms |
| Mixed Hebrew-English with an invented id | 76 | **0.052** / 0.062 ms | 0.055 / 0.115 ms |
| Worst case: a 7,268-character turn | 7,268 | **7.7** / 9.3 ms | 7.7 / 8.9 ms |

The last row is deliberate: § 9.3 records a real `qwen2.5:7b-instruct` turn of
**7,402 characters**, so that is the size the gate has to survive rather than a
number chosen to look good.

| Ledger | p50 | p95 | mean | n |
|---|---:|---:|---:|---:|
| `buildActionLedger`, 5 repository reads, SQLite | **2.088 ms** | 8.838 ms | 3.164 ms | 120 |

**A 26× improvement was found by measuring rather than assuming.** The first
implementation cost a p50 of **72.4 ms** on the 7,268-character turn, because
`matchLongestForm` split each lexicon form into tokens on every call — hundreds of
thousands of throwaway allocations per turn. Caching the split (`text.ts`,
`FORM_TOKENS`) took it to 7.7 ms, and the 98-character reply from 0.59 ms to
0.08 ms. That is recorded here because it is the difference between "negligible" and
"noticeable", and nobody would have known without running it.

### 7.2 What the gate costs, per path

| Path | Database | Provider | Added latency |
|---|---|---|---|
| Text asserts nothing material | **zero reads** | zero | detector only: **~0.02–0.1 ms** |
| Asserts something, supported | 5 reads | zero | detector + ledger + verifier: **~2.2 ms** |
| Corrected on attempt 2 | 5 reads | **+1 full round trip** | ~2.2 ms + one provider call |
| Withheld after the bound | 5 reads + 1 task write | **+2 full round trips** | ~2.2 ms + two provider calls |

**The happy path is free**, and that is a design consequence rather than luck: the
pure detector runs before the ledger is built, so a turn that asserts nothing does
not touch the database at all. `tests/e2e/claimGate.test.ts` asserts
`ledgerRead: false` on that path.

**A regeneration costs one additional FULL provider round trip per attempt.** Sized
from the committed evidence rather than guessed: of `qwen2.5:7b-instruct`'s 65 turns
in `eval-output-fair-20260927/`, **57 made exactly one provider call**, and those
turns measured **p50 2,102 ms, mean 3,574 ms, p95 4,213 ms** end to end (parsed from
the per-turn footers in
`eval-output-fair-20260927/transcripts/qwen2.5_7b-instruct/*.md`). So the bound of
two is about **4.2 s** of worst-case added latency on the recommended model on the
benchmark host.

### 7.3 Token streaming — the honest constraint

**A caller cannot speak a token before the whole text is verified.** That is a real
constraint on the later voice milestone and it is stated here rather than
discovered there.

`src/ports/llm.ts` has an optional streaming path (`completeTurnStreaming`) and the
local provider implements it — that is how the committed **TTFT p50 of 98 ms** was
measured (§ 5.2.6). Streaming keeps its value for measurement, for a progress
indicator and for aborting a runaway generation. What it can no longer be is a path
from a token to a loudspeaker.

**Why a prefix cannot be verified instead.** The § 6.5.4 sentence is *"I've booked
the callback for 3pm on your local time."* — the harmful part is the FIRST half.
There is no prefix of it that is safe to say. Verifying a prefix is therefore not a
cheaper version of this gate; it is a different and weaker thing.

**What a voice milestone actually loses and gains.** It loses the ability to start
speaking at 98 ms. It gains the whole sentence, ~2.2 ms later than the model
finished, with a guarantee that it is true. On the two paths that cost a provider
round trip it is 2.1 s later and still true. A design that wants both will need
something this task did not build — for example speaking only the part of a turn
that carries no material claim while the rest is verified — and that is a decision
with its own failure modes, not an optimisation.

`MISSION-2D-CLAIM-GATE-AND-HEBREW-MODEL-AUTO-CLAIM-ASSURANCE` publishes the
measured-at-scale figures. The seam it needs is the public surface in
`src/agent/claimGate/index.ts` plus `AgentTurnResult.claimGate`, both announced
through the mailbox.

---

## 8. What this gate does NOT catch — read this before trusting it

A check whose limits are undocumented reads as a guarantee it cannot give.

1. **A bare participle as a whole turn.** `Booked.` is missed, because `booked` is
   not a completion form in the English lexicon and cannot be: it appears in
   `let me get that booked`, which is honest. § 4.2 has the argument. The Hebrew
   equivalent is NOT missed, because Hebrew carries the passive past in one word.
2. **Hebrew forms deliberately excluded for ambiguity.** `נקבע` (masculine passive
   past) collides with the cohortative "let's schedule" and is already declared a
   CARRIER token on that reading in `src/scheduling/lexicon/he.ts`. `העברתי` means
   both "I transferred" and "I moved". A model writing `הפגישה נקבע` — wrong
   agreement — is missed.
3. **An invented identifier in an unlisted shape.** § 4.4. Three shapes are
   recognised; a fourth is missed.
4. **A hedged sentence that also completes.** *"Let me confirm — it is booked for
   Thursday"* is read as hedged. Sentence-scoped suppression is what makes the real
   Hebrew defect catchable, and this is its cost.
5. **A language with no registered lexicon.** Three of the five benchmarked models
   emitted whole turns in Chinese, Korean or Japanese (§ 6.2). Those turns assert
   nothing this gate can read, so they are released. Adding a language is adding a
   module; nobody has.
6. **Anything that is not an EFFECT.** A false price, an invented capability, a
   colleague's name, a fabricated customer count. The gate bounds claims about
   *what the system did*; it says nothing about the rest of a sentence, and
   `NEVER_FABRICATE_BUSINESS_FACTS` remains a prompt clause with no mechanism
   behind it, exactly as its own `enforcedBy` field admits.
7. **Reading a REAL internal identifier aloud.** `hermes3:8b` does this repeatedly
   (§ 6.5.4, `noHallucinatedIds` 43.3%). A real id is in the ledger, so it is not an
   *invented* identifier and this gate does not report it. That is a different
   defect and it is still open.
8. **It cannot make a model honest.** It stops a false sentence from reaching a
   customer. A model that produces one on every attempt produces silence and a
   handover, which is safe and is not good. The recommendation in § 9 of the review
   is unaffected.

---

## 9. Two judgement calls, stated rather than buried

### 9.1 "Zero domain rows written by the gate itself"

The task brief asked for an exhaustion test with "zero unsupported text released
and zero domain rows written by the gate itself", and in the same breath named the
`transfer_to_human` path — which persists a `Task` — as the obvious mechanism.
Those two cannot both be satisfied literally, so a reading had to be chosen.

**The reading taken:** the property that matters is that the gate never creates the
effect the model falsely claimed. `tests/e2e/claimGateExhaustion.test.ts` therefore
asserts, table by table: `meetings` 0, `futureActions` 0, `qualificationStates` 0,
`calls` 0, `callOutcomes` 0, `tasks` **1**.

**Why accountability won.** A withholding recorded only in the audit trail is
explainable afterwards and actionable by nobody, while a customer sits on a silent
line. The `transfer_to_human` handler's own comment makes the same argument about
routine handovers: *"it cannot sit in a queue indefinitely with nobody
accountable."* This was announced to the sibling task that may write an invariant
against it, with a request to assert the split rather than a total.

### 9.2 Text is released BEFORE the tool calls that arrived with it

`AgentTurnService` persists assistant text the moment it arrives, inside the
iteration loop, and that ordering is kept. So a model that says *"I'll ring you
tomorrow at 3"* in the same completion as the `schedule_followup` that would make it
true is asserting something not yet true, and the gate says so.

**That is intended, and it is the correct reading for a voice call**: the agent
speaks, then the tool runs, and the words reach the customer before the booking
exists. It is also exactly what `NEVER_CLAIM_BOOKED_WITHOUT_CONFIRMATION` already
asks the model not to do — *"Until then, the honest words are 'let me get that
booked'"* — now enforced instead of requested.

**The consequence for the benchmark, stated up front.** Real models pre-announce
constantly, so expect regeneration on turns that look cooperative. The alternative —
deferring text release until after the iteration's tools have run — would reorder
the durable transcript and let a false sentence be true by the time it is checked,
which is a different guarantee and a weaker one.

---

## 10. Validation — every command run for real, sequentially, on this tree

Run one at a time on 2026-09-27, on this worktree, in this order. The host is memory
constrained and nothing was run in parallel.

```
COMMAND                              RESULT                          BASELINE (§ 13)
-----------------------------------  ------------------------------  -------------------
npm run typecheck                    exit 0, no errors               exit 0            ✓
npm run build                        exit 0                          exit 0            ✓
npm run test                         56 passed | 1 skipped (57)      50 | 1 (51)
                                     1,102 passed | 2 skipped        1,020 | 2
                                     187.18s, exit 0                 166.54s
                                     NO TEST FAILED. The 2 skips
                                     are the live-OpenAI test.
                                     +82 tests, +6 files: all mine.
npm run qa:sweep                     823 scenarios                   823               ✓
                                     4,624 applicable (12,472 eval)  4,624 (12,472)    ✓
                                     0 violations                    0                 ✓
                                     0 network attempts              0                 ✓
                                     RESULT: PASS, 133.9s, exit 0    PASS, 132.6s
npm run qa:sweep -- --determinism    INV-09: PASS - "a second full   IDENTICAL         ✓
                                     run produced byte-identical
                                     classifications for every
                                     scenario id."
                                     823 / 4,624 (12,472), 0 / 0,
                                     RESULT: PASS, 143.0s, exit 0
npm run check:anti-scripting         RESULT: PASS, exit 0            PASS, exit 0      ✓
                                     39 files, 2,095 literals
                                     1 allowance, unchanged - the
                                     pre-existing clauses.ts one.
                                     THE CLAIM GATE NEEDED NONE.
                                     Self-test: 6 known-bad +
                                     7 known-good, all 5 rules fired.
npm run context:prove                RESULT: PASS - 9/9, exit 0      PASS 9/9          ✓
Hebrew parity (4 files)              149 passed, exit 0              all green         ✓
  localeParity, hebrewGrammar,
  failClosedGrammar,
  e2e/hebrewDigitClockTime
Claim-gate suites (6 files)          82 passed, exit 0               (new)
npm run slice:demo                   exit 0, 15 audit events on one  (unchanged
                                     correlationId; the new sixth    behaviour)
                                     section renders:
                                     "VERIFIED (iteration 1) ->
                                      NO_MATERIAL_CLAIM",
                                     "VERIFIED (iteration 2,
                                      attempt 1) -> SUPPORTED"
```

**Not run, deliberately:** `npm run eval:*`, `npm run demo:local`, `npm run
llm:probe`, `npm run llm:smoke`. No model was called, pulled or run. No model
default was changed — `qwen2.5:7b-instruct` and `num_ctx 16384` are exactly as they
were.

**Not touched:** `prisma/` (no migration needed — `AuditEvent.type` is a `String`
column), `eval-output*/`, `tests/invariants/`, `src/eval/`, `src/llm/ollama/`,
`EVAL_HARNESS.md`, `LOCAL_PROVIDER.md`,
`docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md`. I needed neither `prisma` nor
`eval-output`, as the write policy anticipated.

### What the gate costs the sweep: not much, and the honest reason why

**133.9 s against a 132.6 s baseline**, on the same 823 scenarios — about 1 %, which
is inside this host's run-to-run variance and should not be read as a precise
figure. An earlier run of the same code measured 147.6 s and the determinism pass
measured 123.3 s then and 143.0 s now, so the container's variance is larger than the
effect. The number worth trusting is the per-call one in § 7.1, measured in
isolation with warm-up.

The reason it is small is the ordering, not luck: the sweep's scripted turns mostly
assert nothing material, so the pure detector answers and the ledger is never built.
Had the ledger been built first, the sweep would have paid five extra database reads
on every one of ~1,600 releases.

### The new tests

| File | Tests | What it pins |
|---|---:|---|
| `tests/agent/claimGateText.test.ts` | 9 | sentence scope, tokens, CRLF, niqqud, longest match, no substring matching |
| `tests/agent/claimGateDetector.test.ts` | 27 | both verbatim review sentences; every family; the honest non-claims; the identifier shape table; a synthetic third language |
| `tests/agent/claimGateVerifier.test.ts` | 20 | all six reasons; wrong day and wrong time against a real booking; bare 12-hour acceptance; availability checks do not satisfy a completion |
| `tests/agent/claimGateLedger.test.ts` | 7 | the ledger contains nothing the model merely said; dedupe; refusals; durable rows from earlier turns |
| `tests/e2e/claimGate.test.ts` | 15 | the whole thing through the real service and the real dispatcher: no-tool-call, invented id, after a refusal, after a service failure, wrong day, wrong time, Hebrew, mixed, and a supported claim byte-identical |
| `tests/e2e/claimGateExhaustion.test.ts` | 4 | silence, the bound, the row split, and the audit chain |

---

## 11. The one existing test line I deliberately changed

**`tests/agent/conversationService.test.ts`**, one scripted assistant line:

```
- assistantText: 'Perfect, I will ring you then.',
+ assistantText: 'Perfect - let me get that arranged.',
```

**Why.** `I will ring you then` is a callback commitment made in the same
completion as the `schedule_followup` that would create it, so the gate correctly
regenerates it — and the test then quietly stopped exercising the script it was
written to exercise: its second step was consumed as the regeneration, the flow
shifted by one, and the assertions still passed. The subject of that test is
**restart continuity**, not claim consistency, so the wording is now honest for the
moment it is said and the flow is the one the test describes. The reason is recorded
in the test file itself, beside the line.

**The test passed both before and after the change.** This is not a broken test I
repaired; it is a test that had silently become a different test, and leaving it
would have made a future reader think regeneration was part of what it proves.

**No other existing test was changed in any way.** 1,020 pre-existing tests passed
unmodified with the gate enabled by default, which was the property I was most
worried about and is the one I am most pleased to be able to state.

---

## 12. OPEN ITEM, raised by a sibling task, NOT actioned here

`MISSION-2D-CLAIM-GATE-AND-HEBREW-MODEL-AUTO-AYA-TOOL-SHAPE` reported, through the
mailbox, a finding in a file I own — `src/agent/prompt/turnContext.ts`. Its evidence
is in `docs/MISSION_2D_AYA_ROOT_CAUSE.md` § 6 and it is credited to them.

**The finding.** The turn context discloses the contact's local time as
`"Wednesday 4 March 2026 at 10:00"`. That is byte-for-byte the
`day-month-name-with-year` shape the fabricated-timestamp gate refuses in a
time-bearing tool argument, and both of `aya-expanse:8b`'s recorded gate failures
are exactly that format. **The prompt hands the model a worked example of the one
format the gate forbids, in the same turn that forbids it.**

**I agree it is real, and I am not changing it in this task.** Two reasons. Blast
radius: the turn context is what every model is handed on every turn, so changing it
mid-mission changes the inputs of a benchmark re-run relative to the committed
`eval-output-fair-20260927/` evidence, and that is a coordination decision rather
than a claim-gate decision. And the alternative fix — a new prompt clause — needs a
new composition, because `sales-scheduler@v1` is pinned by every existing
conversation and its `promptFingerprint` must not move.

**Recommendation to whoever owns the next prompt revision: drop the year.**
`"Wednesday 4 March at 10:00"` is equally useful to the model and is not a
resolvable absolute instant. One line, one test assertion.

This is recorded rather than silently dropped, and my answer is in the mailbox. It
is not a blocker for the claim gate and the claim gate does not depend on the format
either way.

---

## 13. Merge-readiness for BLOCKER 1

```
- the § 6.5.4 defect:        CLOSED. Both verbatim transcripts - English and
                             Hebrew - are assertions in the test suite.
                             An unsupported claim cannot reach a customer.

- mechanism:                 A second chokepoint, src/agent/claimGate/, on the
                             axis the dispatcher never governed. Not a prompt
                             clause, per § 9.3.

- enabled:                   BY DEFAULT in buildAgentRuntime. No off switch.

- Founder directive:         HELD. No scripted production or demo conversation,
                             no canned response, no hardcoded customer-facing
                             wording. The gate releases the model's own bytes or
                             nothing at all; check:anti-scripting needed no new
                             allowance for any of it.

- regressions:               NONE. 1,020 pre-existing tests pass unmodified.
                             One test LINE changed deliberately, named in § 11.

- schema:                    UNCHANGED. prisma/ not touched.

- model defaults:            UNCHANGED. qwen2.5:7b-instruct, num_ctx 16384.

- models called:             NONE. No eval:*, no demo:local, no llm:*.

- read-only evidence:        UNTOUCHED. eval-output-fair-20260927/ and
                             eval-output/ not modified; the founder review not
                             modified.

- what it cannot do:         § 8, eight named limits, none of them hidden.

- the honest cost:           The gate needs the whole text, so a caller cannot
                             speak a token before it is verified (§ 7.3). Stated
                             as a constraint on the voice milestone rather than
                             left to be discovered there.

- BLOCKER 2:                 NOT MINE. Owned by the sibling tasks.
```

**BLOCKER 1 is closed. Nothing has been merged anywhere.**
