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

Four mechanisms make that enforceable rather than aspirational:

| Mechanism | Where | What it prevents |
|---|---|---|
| `ToolDispatcher.dispatch` is the single path from model to effect | `src/agent/tools/dispatcher.ts` | A model-originated action that nobody checked |
| Tool schemas are `.strict()`, and the JSON Schema is GENERATED from them | `src/agent/tools/definitions.ts`, `jsonSchema.ts` | The model being told one contract and judged by another |
| `ConversationService` reconstructs history from the DATABASE every turn | `src/conversation/conversationService.ts` | Business-critical state living in a context window |
| The turn loop is hard-capped in code, not in the prompt | `src/agent/agentTurnService.ts` | A confused model looping forever, acting each time |

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
  assistantMessages: string[];
  assistantText: string | null;   // the last thing the agent said
  toolOutcomes: ToolOutcome[];
  iterations: number;
  stopReason: 'MODEL_FINISHED' | 'ITERATION_CAP_REACHED';
  promptFingerprint: string;      // pins the exact instructions used
}
```

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

The chain for a follow-up turn, in order:

```
UTTERANCE_RECEIVED → AGENT_TURN_STARTED → PROVIDER_INVOKED → AGENT_DECISION
→ TOOL_CALL_REQUESTED → TOOL_CALL_VALIDATED → ENTITY_PERSISTED
→ FUTURE_ACTION_SCHEDULED → TOOL_CALL_EXECUTED → PROVIDER_INVOKED → AGENT_DECISION
```

and later, on the SAME correlationId, from a process with no LLM in it:

```
→ FUTURE_ACTION_CLAIMED → FUTURE_ACTION_EXECUTED
```

`src/app/auditReport.ts` renders a chain and answers the five questions it must
be able to answer: what was said, what was decided, what tool was called, what
was validated, what was persisted.

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
