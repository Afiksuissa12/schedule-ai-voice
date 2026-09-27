# Agent contract

What the agent task publishes: the LLM boundary, the guardrailed prompt, the
tool contract, the dispatcher chokepoint, the durable conversation service, the
agent turn, and the runnable end-to-end slice.

Builds on `FOUNDATION_CONTRACT.md` and `SCHEDULING_CONTRACT.md`. Everything here
is real and running: `npm run verify`, and `npm run slice:demo` for a human.

---

## 0. The thirty-second version

```bash
npm install
npm run db:generate
npm run slice:demo      # the whole slice, end to end, no network, no key
npm run verify          # typecheck + 414 tests, green with OPENAI_API_KEY unset
```

`slice:demo` creates its own temporary SQLite file, seeds a world, runs an agent
turn against a scripted model, persists a `FutureAction`, advances a
`FixedClock`, dispatches the callback through the deterministic telephony
double, refuses an adversarial turn, prints the audit chain in order, and
deletes the file. It cannot call a phone, write to a calendar, or spend money.
Pass `--keep` to leave the database behind.

---

## 1. The rule this layer enforces

> The LLM reasons and converses, but **application code owns state and executes
> actions.** A tool call must never mutate persisted state without passing
> through validation.

Five mechanisms make that enforceable rather than aspirational:

| Mechanism | Where | What it prevents |
|---|---|---|
| `ToolDispatcher.dispatch` is the single path from model to effect | `src/agent/tools/dispatcher.ts` | A model-originated action that nobody checked |
| `ClaimGate.review` is the single path from model TEXT to a customer | `src/agent/claimGate/` | A sentence asserting an effect that never happened |
| Tool schemas are `.strict()`, and the JSON Schema is GENERATED from them | `src/agent/tools/definitions.ts`, `jsonSchema.ts` | The model being told one contract and judged by another |
| `ConversationService` reconstructs history from the DATABASE every turn | `src/conversation/conversationService.ts` | Business-critical state living in a context window |
| The turn loop is hard-capped in code, not in the prompt | `src/agent/agentTurnService.ts` | A confused model looping forever, acting each time |

The second row is new in Mission 2D, and it closes the boundary the first row
always had: **the dispatcher governs actions, not sentences.** See § 10.

---

## 2. Entry points

```ts
import { buildAgentRuntime } from './src/app/composition.js';
import { seedSliceWorld } from './src/app/seedSliceWorld.js';
import { ScriptedLlmProvider } from './src/llm/scriptedLlmProvider.js';

const runtime = buildAgentRuntime({ clock, db, providers, llm });
//   runtime.agent          AgentTurnService
//   runtime.conversations  ConversationService
//   runtime.dispatcher     ToolDispatcher
//   runtime.dueActions     DueActionRunner
//   runtime.meetings / runtime.futureActions / runtime.validator
//   runtime.shutdown()     closes the db only if buildAgentRuntime opened it
```

Defaults are SAFE: `ScriptedLlmProvider` and the deterministic providers. A
wiring mistake fails towards "does nothing to anybody".

### The turn

```ts
await runtime.agent.handleTurn({ conversationId, utterance }): Promise<AgentTurnResult>

interface AgentTurnResult {
  correlationId: string;          // mint ONCE per turn, threaded everywhere
  conversationId: string;
  contactId: string;
  assistantMessages: string[];    // only text the claim gate RELEASED
  assistantText: string | null;   // the last thing the agent said; null if withheld
  toolOutcomes: ToolOutcome[];
  iterations: number;
  stopReason: 'MODEL_FINISHED' | 'ITERATION_CAP_REACHED' | 'CLAIM_GATE_WITHHELD';
  promptFingerprint: string;      // pins the exact instructions used
  claimGate: ClaimGateTurnReport; // ALWAYS present - see § 10
}
```

**`assistantText` can be `null`, and a caller must handle it.** It always could -
a model is entitled to call a tool and say nothing - and since Mission 2D there is
a second cause: the claim gate withheld the turn because it could not be made
truthful. Every caller of `handleTurn` in this repository already renders that
case rather than filling the gap with wording of its own: `src/app/sliceDemo.ts`
prints `(nothing)`, `src/app/localBrainDemo.ts` prints `(said nothing)`,
`src/eval/runner/transcript.ts` prints `_(said nothing)_`, and
`src/app/auditReport.ts` reads the chain rather than the text.

### The claim gate report

```ts
interface ClaimGateTurnReport {
  enabled: boolean;                    // false only on a hand-wired service
  releases: ClaimGateRelease[];        // ONE per piece of text, in order
}

interface ClaimGateRelease {
  iteration: number;                   // which turn-loop iteration produced it
  attempts: ClaimGateAttempt[];        // in order; [0] is the model's RAW wording
  releasedText: string | null;         // null when withheld
  outcome: 'NO_MATERIAL_CLAIM' | 'SUPPORTED'
         | 'CORRECTED_AFTER_REGENERATION' | 'WITHHELD_HANDED_OFF';
}

interface ClaimGateAttempt {
  attempt: number;                     // 1-based
  text: string;                        // exactly what the model produced
  unsupportedClaims: UnsupportedClaim[];   // reason + machine-readable detail
  supportedClaimCount: number;
}
```

`attempts[0].unsupportedClaims` is the **raw model's** behaviour; a non-empty
`unsupportedClaims` on the attempt whose `text` equals `releasedText` would be a
**leak**. There is no such case today.

### The conversation

```ts
runtime.conversations.start({ organizationId, contactId, aiAgentId, agentConfigurationId, channel? })
runtime.conversations.startOrResume(sameInput)
runtime.conversations.load(conversationId)          // { conversation, turns }
runtime.conversations.buildMessages(conversationId, { maxTurns?, leadingMessages? })
runtime.conversations.appendContactUtterance / appendAgentText / appendToolCall / appendToolResult / appendSystemNote
runtime.conversations.complete(conversationId, summary?)
```

`buildMessages` reads the rows. This class caches nothing, by design.

### The chokepoint

```ts
runtime.dispatcher.dispatch(toolCallRequest, ctx): Promise<ToolOutcome>

interface ToolDispatchContext {
  correlationId; organizationId; conversationId;
  contact;                 // the row - the model does not choose this
  agentConfiguration;      // pinned to the conversation
  policy;                  // schedulingPolicyFromAgentConfiguration(...)
  allowedToolNames;        // parsed from allowedToolsJson
  nowUtc;                  // pinned ONCE per turn
}
```

---

## 3. The nine tools

`TOOL_NAMES` in `src/agent/tools/definitions.ts` is the contract:

| tool | time-bearing | writes | notes |
|---|---|---|---|
| `get_contact_context` | – | – | persisted facts ONLY; phone returned masked |
| `check_availability` | yes (avail ✓) | – | consults the `AvailabilityProvider`; books nothing |
| `schedule_meeting` | yes (avail ✓) | `Meeting` | via `MeetingSchedulingService.schedule` |
| `reschedule_meeting` | yes (avail ✓) | `Meeting` | via `.reschedule` |
| `cancel_meeting` | – | `Meeting` | via `.cancel`; idempotent |
| `schedule_followup` | yes (avail ✗) | `FutureAction` | via `FutureActionService.schedule` |
| `update_qualification` | – | `QualificationState` | rubric + decision-maker cap |
| `record_call_outcome` | – | `Call`, `CallOutcome` | |
| `transfer_to_human` | – | `Task` | emits `HUMAN_TRANSFER_REQUESTED` |

All nine are fully executed and persisted. Nothing is a no-op. The one
"declared but not executable" path is `schedule_followup` with an
`action_type` other than `CALL_CONTACT`: it returns a structured, audited
`POLICY_VIOLATION` and writes nothing.

**Every time-bearing tool takes `when` as the contact's own words** -
`"tomorrow afternoon at 3"` - never a timestamp. Application code resolves it,
and `ValidationProvenance` records how.

---

## 4. Dispatch order (this is the contract)

1. `TOOL_CALL_REQUESTED` with the raw arguments **verbatim**
2. unknown tool name → `UNSUPPORTED_TOOL`
3. `JSON.parse` then Zod `.strict()` → `SCHEMA_VIOLATION`
4. not in `allowedToolsJson` → `POLICY_VIOLATION`
5. subject resolved **from the database** → `UNKNOWN_CONTACT` / `POLICY_VIOLATION`
6. `SchedulingValidator.validate` → whatever code it returns
7. `TOOL_CALL_VALIDATED` **or** `TOOL_CALL_REJECTED`
8. execute, via a service → `TOOL_CALL_EXECUTED`

Cheap and structural first, provider I/O last.
`tests/agent/dispatcher.test.ts` wires an availability provider that THROWS if
consulted and shows it is never reached for an invalid call.

**On any rejection: zero domain rows.** Asserted by row count across
`meetings`, `futureActions`, `qualificationStates`, `calls`, `callOutcomes`,
`tasks`, `leads`, `contacts` in `tests/e2e/adversarial.test.ts`.

---

## 5. Audit events this layer emits

| event | emitted by |
|---|---|
| `UTTERANCE_RECEIVED` | `AgentTurnService` |
| `AGENT_TURN_STARTED` | `AgentTurnService` — config, prompt fingerprint, offered tools, what was disclosed |
| `PROVIDER_INVOKED` | `AgentTurnService` (the LLM), `MeetingSchedulingService` (the calendar) |
| `AGENT_DECISION` | `AgentTurnService` — the model's text and its INTENDED tool calls |
| `TOOL_CALL_REQUESTED` | `ToolDispatcher` — raw arguments verbatim |
| `TOOL_CALL_VALIDATED` | `ToolDispatcher`, `MeetingSchedulingService` |
| `TOOL_CALL_REJECTED` | `ToolDispatcher`, `AgentTurnService` (iteration cap) |
| `TOOL_CALL_EXECUTED` | `ToolDispatcher` |
| `ENTITY_PERSISTED` | the services, and the `update_qualification` / `record_call_outcome` / `transfer_to_human` handlers |
| `FUTURE_ACTION_SCHEDULED` | `FutureActionService` |
| `HUMAN_TRANSFER_REQUESTED` | `transfer_to_human` handler |
| `VALIDATION_REJECTED` | the scheduling services |
| `CLAIM_GATE_CLAIM_VERIFIED` | `ClaimGate` — text checked against the ledger and released unchanged |
| `CLAIM_GATE_CLAIM_REJECTED` | `ClaimGate` — text asserted something the ledger does not support; NOT released |
| `CLAIM_GATE_REGENERATION_REQUESTED` | `ClaimGate` — the authoritative state was handed back and the turn asked for again |
| `CLAIM_GATE_TEXT_WITHHELD` | `ClaimGate` — every bounded attempt failed; nothing released, a person asked for |

The four `CLAIM_GATE_*` types are in `AUDIT_EVENT_TYPES` (`src/audit/types.ts`),
validated by Zod on write and re-checked by `src/db/mappers.ts` on read.
`AuditEvent.type` is a `String` column, so **no schema migration was needed** and
`prisma/schema.prisma` is unchanged.

The chain for a follow-up turn, in order:

```
UTTERANCE_RECEIVED → AGENT_TURN_STARTED → PROVIDER_INVOKED → AGENT_DECISION
→ CLAIM_GATE_CLAIM_VERIFIED → TOOL_CALL_REQUESTED → TOOL_CALL_VALIDATED
→ ENTITY_PERSISTED → FUTURE_ACTION_SCHEDULED → TOOL_CALL_EXECUTED
→ PROVIDER_INVOKED → AGENT_DECISION → CLAIM_GATE_CLAIM_VERIFIED
```

A turn whose text had to be corrected reads, at that point:

```
→ AGENT_DECISION → CLAIM_GATE_CLAIM_REJECTED → CLAIM_GATE_REGENERATION_REQUESTED
→ PROVIDER_INVOKED → CLAIM_GATE_CLAIM_VERIFIED
```

and a turn that could not be made truthful within the bound ends:

```
→ CLAIM_GATE_CLAIM_REJECTED → CLAIM_GATE_TEXT_WITHHELD
→ HUMAN_TRANSFER_REQUESTED → ENTITY_PERSISTED
```

and later, on the SAME correlationId, from a process with no LLM in it:

```
→ FUTURE_ACTION_CLAIMED → FUTURE_ACTION_EXECUTED
```

`src/app/auditReport.ts` renders a chain and answers the five questions it must
be able to answer: what was said, what was decided, what tool was called, what
was validated, what was persisted - and, since Mission 2D, a sixth: what the
agent was ALLOWED to say (`summarizeChain().whatWasSayable`).

---

## 6. The qualification rubric

`rubricVersion` = `schedule-ai-voice-rubric@v1`. Five weighted factors summing
to 100: `need_established` 25, `budget_signal` 25, `timeline_urgency` 20,
`authority_signal` 15, `engagement` 15.

**The decision-maker hard cap.** `NON_DECISION_MAKER_SCORE_CEILING = 60`. When
`Contact.isDecisionMaker` is false - read from the PERSISTED row, never from
the model's assertion - the stored score is `min(rawScore, 60)`, whatever the
rubric or the model produced. `rawScore` and `cappedScore` are persisted
separately so the cap is visible rather than implied, and the band is derived
from the capped value.

A score the model proposes directly is **advisory**: recorded, and used as
`rawScore` only when no factor evidence was supplied at all - and the cap still
applies. There is no argument that lifts the ceiling. The only thing that lifts
it is `is_decision_maker: true`, which changes the durable `Contact` record -
an auditable CRM edit, not a per-call flag.

---

## 7. The prompt

Composed from named, versioned clauses in `src/agent/prompt/clauses.ts`,
arranged by `systemPromptRef` (`sales-scheduler@v1`). `REQUIRED_CLAUSE_IDS`
cannot be dropped: `resolvePromptComposition` throws, and a test fails the
build.

Guardrails encoded: never invent availability; never invent contact details;
nothing is booked until a tool says it is; ask when a time is ambiguous; say
times back in the contact's timezone; promise only what the tools can do; the
model proposes times and never decides them.

`buildSystemPrompt` is pure and deterministic, and is a function of the SET of
permitted tools (names are sorted), so `promptFingerprint` on an audit event is
a real pin. The prompt carries **no secrets and no per-contact PII** - per-turn
facts go in a separate turn-context message (`turnContext.ts`), which discloses
the contact id, name, timezone, local time and decision-maker flag, and
deliberately NOT the phone number or email.

**None of this enforces anything.** The dispatcher enforces. Every clause names
the mechanism that actually backs it in its `enforcedBy` field.

---

## 8. The LLM boundary

`src/llm/openAiLlmProvider.ts` is the **only** file in the repository that
imports a vendor SDK. It translates and nothing else: no validation, no
interpretation, no state.

`ScriptedLlmProvider` runs every test. `ADVERSARIAL` is the catalogue of hostile
turns: `unknownTool`, `malformedArgumentsJson`, `missingRequiredField`,
`datetimeInThePast`, `bogusTimezone`, `fabricatedContactId`,
`outsideBusinessHours`, `toolNotPermittedByConfiguration`,
`qualificationScoreAboveTheCap`, `unsupportedFollowupType`.

`setScript(steps)` rescripts it after a world has been seeded.
`onExhausted: 'repeat-last'` makes it genuinely unbounded, which is how the
turn-loop cap is tested. `completions[]` records exactly what the model was
handed, so a test can assert on the prompt and the offered schemas.

`tests/agent/openAiLive.test.ts` is the ONE optional live test. It skips
cleanly when `OPENAI_API_KEY` is absent and is never required.

**One thing to know before writing a script.** A regeneration CONSUMES a script
step. If a scripted reply asserts something the ledger does not support, the claim
gate asks for the turn again and the NEXT step answers that request rather than
the next iteration. Fix the script; never the gate.

---

## 9. Known limits, stated rather than hidden

- **One contact per conversation.** `ToolDispatchContext.contact` is fixed for
  the turn, which is what makes the anti-fabrication gate simple. A
  three-way call would need a different shape.
- **No transcript windowing by default.** `BuildMessagesOptions.maxTurns`
  exists but is unset: this slice's conversations are short, and silently
  truncating history is the kind of thing that should be a decision.
- **`AgentLlmMessage` extends the port rather than changing it.** `LlmMessage`
  cannot express the tool NAME on an assistant tool-call turn, which OpenAI
  needs. An additive `toolName?: string` on `src/ports/llm.ts` would be tidier
  and was suggested to the foundation task; if it lands, deleting
  `src/llm/agentMessage.ts` is the whole migration.
- **Coordinated change in a sibling's file.** `FutureActionService.schedule`
  now emits `ENTITY_PERSISTED` immediately before `FUTURE_ACTION_SCHEDULED`,
  on the same transaction. Requested from `MISSION-48d6ff04-AUTO-SCHEDULING`
  through the mailbox, announced before it was made, and disclosed again
  afterwards together with the three test assertions it required. See
  `src/followup/futureActionService.ts` for the in-place note.
- **`get_contact_context` masks the phone number.** The model never dials;
  `DueActionRunner` does, from the persisted payload. If a future product
  decision needs the full number in the context window, that is a decision, not
  a bug fix.
- **The claim gate is a recall floor, not a proof.** § 10 lists what it catches.
  What it does NOT catch is in `docs/MISSION_2D_CLAIM_GATE.md` § 8 and is worth
  reading before trusting it: a bare participle used as a whole turn (`Booked.`),
  a completion form in a language no lexicon covers, an invented identifier in a
  shape the table does not list, and a false statement about something that is
  not an EFFECT at all (a price, a capability, a person's name). The gate bounds
  claims about *what the system did*; it says nothing about the rest of a
  sentence.
- **The gate reads text, and therefore needs all of it.** A caller cannot speak a
  token before the whole turn is verified. That is a real constraint on the voice
  milestone and it is stated with its measured cost in
  `docs/MISSION_2D_CLAIM_GATE.md` § 7 rather than discovered later.
- **Coordinated change in this layer, announced.** `transfer_to_human`'s `Task`
  creation moved to `src/agent/tools/handoverTask.ts` so the claim gate's
  exhaustion path could use the same row, the same transaction and the same two
  audit events. Every string the tool path used to build is still built by the
  tool path and passed in, so its summaries and `detailJson` are byte-identical.

---

## 10. The effect and claim consistency gate

`src/agent/claimGate/` - the single path from model text to a customer, and the
answer to the one boundary § 1's first row always had.
`docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 9.4 stated it plainly: *"the
chokepoint governs actions, not sentences. Every model that said something false
said it freely."*

```ts
runtime.claimGate                                   // always present
MAX_CLAIM_GATE_REGENERATION_ATTEMPTS === 2          // a constant in code

const decision = await runtime.claimGate.review({
  text,                                             // what the model produced
  loadLedger,                                       // called ONLY if a claim is found
  regenerate,                                       // the SAME provider, no tools offered
  record,                                           // one callback per audit event
});
// decision.outcome, decision.attempts, decision.releasedText
```

**Enabled by default, with no off switch.** `buildAgentRuntime` always constructs
one. `BuildAgentRuntimeOptions.claimGate.maxRegenerationAttempts` is the only
knob, and lowering it makes the gate stricter rather than weaker. This is
deliberately unlike `contextAssembly`, which is a capability a deployment opts
into: the gate is a guarantee about what may reach a customer.

**What it releases.** The model's own bytes, unchanged, or nothing. It never
edits, trims, rewrites or substitutes text, and it contains no customer-facing
string of its own - there is nothing in the module to emit.

**The surface**, for the tasks written against it:

| Name | Where | What it is |
|---|---|---|
| `ActionLedger`, `buildActionLedger` | `claimGate/ledger.ts` | effects, refusals, issued identifiers - from `ToolOutcome` values and rows ONLY |
| `detectMaterialClaims` | `claimGate/detector.ts` | PURE. text (+ locale options) in, `DetectedClaim[]` out |
| `verifyClaims` | `claimGate/verifier.ts` | PURE. text + ledger in, supported / unsupported with a reason per claim |
| `ClaimGate` | `claimGate/claimGate.ts` | the decision, and the bound |
| `buildStateInstruction` | `claimGate/stateInstruction.ts` | the authoritative state, system-side, no wording |
| `handOffAfterClaimGateExhaustion` | `claimGate/handoff.ts` | the designed exhaustion outcome |
| `REGISTERED_CLAIM_LEXICONS` | `claimGate/lexicon/` | `en` + `he` as DATA behind a locale-agnostic engine |

`UNSUPPORTED_CLAIM_REASONS` = `NO_MATCHING_EFFECT`, `EFFECT_WAS_REFUSED`,
`WRONG_DAY`, `WRONG_TIME`, `INVENTED_IDENTIFIER`, `NO_TOOL_FOR_PROMISE`.

**The order matters, and it is a latency decision.** The pure detector runs
FIRST. A turn that asserts nothing material therefore costs no database read and
no provider call at all - measured at a p50 of 0.022 ms on a short reply. The
ledger's five repository reads happen only once something has been found to check.

**The exhaustion outcome writes exactly ONE domain row**: an `OPEN`, due-now
`Task`, with `HUMAN_TRANSFER_REQUESTED` and `ENTITY_PERSISTED` carrying
`toolCallId: null` and `requestedBy: 'CLAIM_GATE'` - because application code
asked, not a model-proposed tool call, and recording a tool call id there would
invent one. Zero meetings, zero future actions, zero qualification states, zero
calls, zero call outcomes: **the gate never creates the effect that was falsely
claimed.** A `SYSTEM` note goes on the conversation so the durable transcript
records that the turn produced no words.

**Text is released BEFORE the tool calls that arrived with it are dispatched**,
because that is the order a voice call happens in: the agent speaks, then the tool
runs. So a model that says *"I'll ring you tomorrow at 3"* in the same completion
as the `schedule_followup` that would make it true has asserted something that is
not true yet, and the gate says so. That is not a false positive - it is exactly
what the clause `NEVER_CLAIM_BOOKED_WITHOUT_CONFIRMATION` already asks the model
not to do, now enforced instead of requested.
