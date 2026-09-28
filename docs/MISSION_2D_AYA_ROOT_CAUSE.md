# Mission 2D — `aya-expanse:8b`: the tool-argument shape, from the evidence

- **Task:** `MISSION-2D-CLAIM-GATE-AND-HEBREW-MODEL-AUTO-AYA-TOOL-SHAPE`
- **Blocker owned:** BLOCKER 2 of the two the Founder raised before Mission 2 may merge.
- **Evidence read:** every file under `eval-output-fair-20260927/transcripts/aya-expanse_8b/`
  (21 transcripts, 65 turns) and `eval-output-fair-20260927/results.json`. Nothing under
  `eval-output-fair-20260927/` was added, modified or deleted.
- **Models run:** **none.** No `eval:*`, no `demo:local`, no `llm:probe`, no `llm:smoke`,
  no `POST /api/chat`. Every number below is computed from committed bytes by
  `tests/llm/ollamaAyaToolShape.test.ts` and `npm run llm:mapcheck`, both pure.

---

## 0. The answer, before the argument

**A clean scoped fix exists for the wrapper, and it is not sufficient.** That is the whole
finding, and it contradicts the shape of the Founder review's follow-up recommendation
rather than the facts in it.

1. **The wrapper is real, it is mechanical, and it is fixed.** Every one of aya's 36 native
   tool calls arrived with its entire arguments object replaced by
   `{"tool_name": "<tool>", "parameters": {...}}`. A narrow normalization in
   `src/llm/ollama/mapping.ts` removes that container and nothing else. §4 states every
   precondition; §5 is the per-call counterfactual.

2. **Argument validity goes to 61.0–65.9%, not to ~100%.** The review says the wrapper is
   *"a single, mechanical, addressable defect ... the only thing standing between the one
   fluent Hebrew speaker in the set and a usable candidate"* (§6.2) and that *"that, and not
   a vocabulary problem, is why its argument validity is 14.6%"* (§5.2.4). The first half is
   right about the mechanism and the second half is not the whole reason. Once the container
   is gone, **15 of the 44 calls are still refused**, on three further defects the
   wrapper was hiding: a free-text `outcome` on **7 of 7** `record_call_outcome` calls, a
   free-text `urgency` on at least **3 of 5** `transfer_to_human` calls, and one
   `schedule_meeting` with no `contact_id` at all. §6.

   > **CORRECTED BY MISSION 2D-R — these are defects of the TEMPLATE, not of the model.** This
   > section originally called them *"model defects"* and §6 argued they were *"not obviously
   > fixable by a prompt or a schema description, because the generated JSON Schema already
   > carries the enum"*. **The schema carried the enum to Ollama; `aya-expanse:8b`'s chat template
   > then dropped it before the model saw it.** The template renders each tool as a Python stub
   > that reads only name, type and description off each property — no `enum`, no `required`, no
   > nested structure. The model was never told the seven legal values. See point 7 below and
   > §14–§17.

3. **THE FABRICATED-TIMESTAMP GATE GETS FOUR TIMES WORSE, and this is the finding that
   should change the decision.** `detectFabricatedTimestamps` walks only the **top level** of
   `argumentsJson`. The wrapper put every `when` one level down, so the gate never saw them.
   aya is recorded at 2 failing turns of 65 (**3.1%**). On the same committed evidence,
   unwrapped, it is **8 of 65 (12.3%)** — six further turns, each carrying an ISO instant the
   model built by arithmetic. **The wrapper was masking the fabrication, not causing it.** §7.

4. **A defect the review does not record: five real tool calls were dropped in silence AND
   spoken to the contact.** aya also writes Cohere's action list into its assistant text.
   Eleven turns do it. The six *fenced* ones were seen and refused; the five *unfenced* ones
   were invisible to all four span shapes, so the call never happened, the JSON went down the
   phone line, and none of it appears in `toolCallHealth` — not as native, not as recovered,
   not even as malformed. §8.

5. **A correction to the malformed rate.** All **6** of aya's recorded malformed calls are
   the same pseudo-tool, `directly-answer` — Cohere's documented no-op sentinel for "call
   nothing, just reply". Refusing it was correct. So the recorded **12.0% malformed rate is
   not six broken attempts at real tools**; it is six correct refusals of a sentinel whose
   only real defect was that the JSON stayed in the spoken channel. §8.1.

6. **The absolute dates have a cause in this repository, and it is not the provider.**
   `src/agent/prompt/turnContext.ts` discloses the contact's local now as
   `"Wednesday 4 March 2026 at 10:00"` — the day-month-name-**with-year** shape that
   `FABRICATION_PATTERNS` calls `day-month-name-with-year` and that the gate refuses in a
   tool argument. Both of aya's recorded gate failures are that exact format, one of them
   carrying the prompt's own `10:00` for a time the contact never gave. The prompt hands the
   model a worked example of the one format it forbids. `turnContext.ts` is `src/agent/**`,
   which another task owns, so this is **requested through the mailbox, not changed here**.
   §9.

7. **MISSION 2D-R: THE REMAINING DEFECTS WERE THE TEMPLATE'S, AND THE PROMPT CAUSE OF THE
   ABSOLUTE DATES IS FIXED.** Two additions, from the operator's captured `ollama show` output and
   from re-reading the prompt against the transcripts. Both change conclusions above rather than
   adding to them.

   - **`aya-expanse:8b` was never shown a single schema constraint.** Its template renders tools
     as a Python `def` stub carrying only name, type and description. **`enum`, `required`, nested
     `properties`, array `items`, `minLength`, `minimum` and `format` are all dropped** before the
     model sees them. `qwen2.5:7b-instruct`, the configured default, sends the **whole JSON
     Schema**. That moves defects 1, 2, 5, 6 and 7 of §16 off the model and onto the template, and
     the proof is a dissociation nothing else explains: aya's **tool selection is 78.1%, third of
     five**, while its **argument validity is 14.6%, six times worse than the next-worst model.**
     Selection needs the name and description, which its template passes; arguments need the
     enums, which its template destroys. A model that were simply bad at tools would be bad at
     both. §14–§17.
   - **The absolute dates had three sources in this repository, not one, and all three are now
     fixed.** The year is dropped from the disclosed local time at
     `src/agent/prompt/turnContext.ts`:82, `src/agent/tools/handlers.ts`:68 and
     `src/conversation/contextAssembler.ts`:283, so the exemplar no longer matches
     `day-month-name-with-year`. The evidence is stronger than §9 had it: in `vague-next-week` t1
     aya passed the contact's own words, the **tool result** handed the resolved instant back as
     `Tuesday 10 March 2026 at 10:00`, and aya's next two calls **copied that string verbatim** —
     a string the disclosure could not have produced. §9.1a, §9.1b, §9.2. **The operator's
     re-benchmark measures the effect; this task ran no model and cannot.**
   - **A clean, narrow remedy exists and is shipped as a file, not as a model.**
     `src/eval/models/modelfiles/aya-expanse-8b-schema-tools.Modelfile` is stock aya with the
     template corrected to send the full schema, under the distinct tag
     `m2b/aya-expanse-schema-tools:v1`. **Nothing in this repository creates, pulls or runs it**;
     the operator does, per `EVAL_HARNESS.md` §9.8. It relaxes no `.strict()` and coerces no
     value. §18.
   - **§9.3's open question is settled: NO.** The aya template injects **no date** of any kind.
     Cohere's published Command-R templates conventionally do; the build Ollama ships does not. So
     every absolute date in aya's window came from this repository.

**What was NOT fixed, deliberately, and why:** §11.

---

## 1. The population, and the arithmetic that reproduces the published figures

| Quantity | Value | Where it comes from |
|---|---:|---|
| Scenarios | 21 | 21 transcript files |
| Turns | 65 | `results.json` -> `models[aya].turnsRun` |
| Turns that dispatched at least one tool call | 41 | counted from the transcripts |
| Tool calls dispatched | **44** | every `` - `<tool>` proposed: `` line |
| ... arriving natively | **36** | `results.json` -> `toolCallHealth.native` |
| ... recovered from text | **8** | `results.json` -> `toolCallHealth.recovered` |
| Refused by the mapper before dispatch | **6** | `results.json` -> `toolCallHealth.malformed` |
| Turns with any tool-call activity | 47 | 41 + 6 malformed-only turns; = `structuredOutputReliability` n |
| Malformed rate | 12.0% | 6 / (36 + 8 + 6) |

**The partition is exact, and it is not a label.** All 36 native calls carry the
`{tool_name, parameters}` wrapper and all 8 recovered calls do not — checked per call in
`tests/llm/ollamaAyaToolShape.test.ts` by parsing each recorded string rather than by
trusting a field. The reason is in the existing code: `evaluateCandidate` accepts
`parameters` as one of its two argument keys, so **a wrapper written into TEXT is already
unwrapped by a rule that has been there since Mission 2.** The wrapper could only ever reach
the dispatcher down the native path.

**Argument validity reproduces to the digit.** `src/eval/rubric/score.ts` scores
`argumentValidity` as a mean over turns of (valid calls / calls in that turn). Six of the 41
turns score 1.0 and 35 score 0.0, so the published **14.6% <sub>n=41</sub>** is exactly
6/41 = 14.634%. The six are precisely the six turns whose calls all arrived flat. **At the
call level: 8 of 44, 18.2%.** Every wrapped call was refused; no flat call was.

---

## 2. Which layer produces the wrapper

**Not the mapping layer.** `mapNativeToolCalls` did one thing to those arguments:
`JSON.stringify` over the object Ollama had already parsed. No key was added, renamed or
moved. `npm run llm:mapcheck` has asserted that byte for byte since Mission 2.

**Not the dispatcher.** It received the wrapper and said so, by name, 36 times:
`SCHEMA_VIOLATION - ... (root) - Unrecognized key(s) in object: 'tool_name', 'parameters'`,
with every required field reported missing because none of them was where the schema looks.

**The model's own trained tool protocol, with the runtime's template failing to parse half of
it.** Three things in the evidence force that reading:

1. **`directly-answer` appears in the spoken text.** It is not one of the nine tools, it is
   not in `TOOL_DEFINITIONS`, and `grep -r directly-answer` over this repository finds it
   only in the Mission 2D fixtures and docs. It is Cohere's documented sentinel for "call no
   tool". It can only have come from the model's weights.
2. **The protocol is written out in full, in text, with its label.** `Action:` followed by a
   JSON array of `{"tool_name": ..., "parameters": ...}` — Cohere's Command-R tool-use
   format, verbatim, on eleven turns. §8.
3. **`function.name` was right and `function.arguments` was the whole object.** The runtime
   found the tool name — it named `schedule_meeting`, `transfer_to_human` and the rest
   correctly all 36 times — and then handed us the entire Cohere object as the arguments. So
   something between the model's tokens and `message.tool_calls[].function.arguments` matched
   the name and did not match the argument key.

**What the evidence does NOT settle, stated as a limit rather than glossed.** Exactly which
part of Ollama 0.34.3's handling of `aya-expanse:8b` produced that split — the model's chat
template, Ollama's tool-call parser, or the two disagreeing — cannot be determined from
committed bytes, and this mission ran no model. The committed host record
(`eval-output-fair-20260927/environment/aya-expanse_8b.json`) pins the runtime at
**ollama 0.34.3**, `num_ctx` 16384, 100% GPU. An operator who wants the remaining detail can
get it without a benchmark run:

```bash
ollama show --template aya-expanse:8b     # what the template emits, and what it parses back
```

That is a one-command check and it is deliberately left to the operator, because this task
was told not to call, pull or run any model.

**Why that limit does not weaken the fix.** The normalization keys off the *shape of the
value*, not off a model tag, a template version or a runtime version. It fires on an
unambiguous container and on nothing else, so it is correct whichever of those three produced
the container, and it is inert for every model that does not produce one.

---

## 3. The decision

**A clean scoped fix exists for the container. It is conservative tool-call normalization in
the mapping layer, and nothing else.** The four options, and why three were rejected:

| Option | Verdict |
|---|---|
| **Provider-specific structured tool formatting** — detect aya and speak Cohere's protocol to it | **Rejected.** It means a second tool protocol to maintain, a per-model branch in a provider whose whole claim is that it has no per-model branches, and no way to validate either half without running the model — which this task must not do. It also would not help: the model's protocol already reaches us, in text, and §8 handles that without a branch. |
| **Schema adaptation** — teach the Zod schemas to accept `{tool_name, parameters}` | **Rejected, and out of bounds.** It weakens `.strict()`, which is the check that catches an invented key. §6 is the proof of why that matters: unwrapping exposed four *other* argument defects, and every one of them is caught by the same `.strict()` and the same enums. A schema that tolerated the wrapper would have tolerated those too. |
| **Conservative tool-call normalization** in `src/llm/ollama/mapping.ts` | **Chosen.** Pure, in a file this task owns, replayable by `npm run llm:mapcheck` with the network trap armed, and narrow enough to specify completely in prose (§4). The normalized arguments face the same strict Zod schema and the same nine dispatch checks as any other call. |
| **Runtime configuration and prompting** | **Partly applicable, and not to the wrapper.** The prompt already forbids the behaviour the model exhibits, twice and emphatically (`QUOTE_THEIR_WORDS_INTO_TOOLS`, `NEVER_STATE_A_TIME_YOU_WERE_NOT_GIVEN` in `src/agent/prompt/clauses.ts`), and the review's own §8.8 is the standing demonstration that an instruction in a prompt is a request rather than a constraint. No prompt clause can change a trained output protocol. Prompt configuration **is** the right lever for the absolute-dates question, and §9 says where — in a file another task owns. |

---

## 4. The normalization rule, in full

Implemented as `unwrapToolNameParametersWrapper` in `src/llm/ollama/mapping.ts`, applied in
`mapNativeToolCalls` and **nowhere else**. `LOCAL_PROVIDER.md` §4.5 states it for an operator.

It fires only when **all five** hold. Any one failing means the arguments are passed through
completely untouched and the call is accepted or refused downstream exactly as before.

1. The arguments value is a **plain JSON object** `W`.
2. `W`'s own key set is **exactly** `{tool_name, parameters}` — both present, nothing else.
   Key order is irrelevant; aya emitted both orders. Two keys and only two is what makes the
   shape unambiguous: a wrapper carries no arguments of its own, so a third key means this is
   an arguments object that happens to contain `tool_name`, and unwrapping would be a guess.
3. `W.tool_name` is a string **exactly equal** to the tool this call already names. No
   trimming, no case folding, no aliasing.
4. `W.parameters` is a **plain JSON object**. A string that would parse to one is **not**
   accepted here — a native call's arguments were already parsed by the runtime, so a string
   at this depth is double-encoding, and un-double-encoding is repair rather than translation.
5. `W.parameters` is **not itself a wrapper** by tests 2–4. Nested wrappers stay refused.

On success, `argumentsJson` becomes `JSON.stringify(W.parameters)` — **no key and no value
inside it is touched** — and the call carries
`argumentsNormalization: { rule: 'ollama-tool-name-parameters-wrapper', rawArgumentsJson: <the model's own bytes> }`.

**What the rule does to the recorded population, in one line.** Of aya's 36 wrapped calls:
**31 unwrap**, **3 nested ones stay refused**, and **2 are not replayable** because the
transcript renderer truncated their arguments (§5.1). Of the 31 that unwrap, **19 then pass
strict Zod and 12 do not** — §6.

**What is deliberately NOT recognised, and why each stays refused:**

| Shape | Why it is refused |
|---|---|
| `{tool_name, parameters, <anything else>}` | Three keys. Could be an arguments object that happens to carry `tool_name`. |
| `{parameters}` alone, or `{tool_name}` alone | Not the pair. |
| `{tool_name: "<other tool>", parameters}` | The model disagreed with itself about which tool it was calling. Picking a winner is not this layer's authority. |
| `{tool_name: " x"}` / `{tool_name: "X"}` where the call names `x` | A name that differs by whitespace or case is a mismatch. Normalizing the *name* would be interpretation. |
| `parameters` as an array, `null`, a number, or a string | Not an object. |
| `{tool_name, parameters: {tool_name, parameters: {...}}}` | Nested. No single reading of how many layers were meant. |
| `{name, arguments}` | The OpenAI envelope. Ollama already hands that to us unwrapped, and a tool whose own schema declared fields called `name` and `arguments` would be silently mangled by a rule that recognised it. No tool in `TOOL_DEFINITIONS` declares `tool_name` or `parameters`, which is what makes Cohere's pair safe to key on and OpenAI's pair unsafe. |

Each of those is a passing negative test in `tests/llm/ollamaAyaToolShape.test.ts` and in
`npm run llm:mapcheck` §13 — asserted twice: that the rule does not fire, **and** that the
arguments still fail strict validation.

### 4.1 The evidence is preserved, not overwritten

`src/llm/ollama/mapping.ts` documents *"translate, never interpret"* and `argumentsJson` is
read by auditors as what the model actually said. So:

- `src/ports/llm.ts` gains one **optional** field,
  `ToolCallRequest.argumentsNormalization`, carrying the rule id and the pre-normalization
  bytes. Purely additive: every existing producer and consumer compiles unchanged, and
  `ScriptedLlmProvider` and `OpenAiLlmProvider` never set it.
- `src/agent/tools/dispatcher.ts` gains **two optional audit keys** on the existing
  `TOOL_CALL_REQUESTED` detail — `argumentsNormalizationRule` and
  `preNormalizationArgumentsJson` — present only when a rule fired. `rawArgumentsJson` and
  `argumentsByteLength` are unchanged, so every existing audit assertion keeps passing. That
  file is `src/agent/**`, owned by `MISSION-2D-...-CLAIM-GATE`; the change and its exact diff
  were **announced through the mailbox before it was made**, as the task brief requires, and
  the message offers to hand the four lines back for that task to write instead.

---

## 5. The counterfactual, per real aya call

All 44, in scenario then turn order. **BEFORE** is the strict-Zod verdict on the bytes as
recorded; **AFTER** is the strict-Zod verdict on what the rule produces. Both are computed by
`tests/llm/ollamaAyaToolShape.test.ts` through `TOOL_DEFINITIONS[...].schema` — the real
schema the dispatcher uses, not a copy — so this table cannot drift from the code.

| # | scenario | turn | tool | arrival | rule | BEFORE | AFTER | why still refused, or gate finding |
|--:|---|--:|---|---|---|---|---|---|
| 1 | adversarial-guardrail | 1 | `schedule_meeting` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | GATE 2026-03-04T10:30 (iso-datetime) **NEW** |
| 2 | adversarial-guardrail | 2 | `schedule_meeting` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | GATE 2026-03-04T14:00 (iso-datetime) **NEW** |
| 3 | cancellation | 1 | `cancel_meeting` | recovered (flat) | not applied | valid | valid | - |
| 4 | hebrew-busy-callback | 1 | `transfer_to_human` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `urgency` not in ROUTINE\|URGENT (sent `לא דחוף`) |
| 5 | hebrew-busy-callback | 2 | `record_call_outcome` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `outcome` not in CALL_OUTCOME_KINDS (sent `השיחה הסתיימה בהסכמה להתקשר שוב בתחילת השבוע הבא.`); `call_id` is `""`, min is 1 |
| 6 | hebrew-digit-clock-time | 2 | `record_call_outcome` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `outcome` not in CALL_OUTCOME_KINDS (sent `המשתמש הסכים לשיחת מעקב.`); `call_id` is `""`, min is 1 |
| 7 | hebrew-price-objection | 1 | `get_contact_context` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | - |
| 8 | hebrew-price-objection | 2 | `record_call_outcome` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `outcome` not in CALL_OUTCOME_KINDS (sent `הלקוח ביקש מידע נוסף על אפשרויות תמחור גמישות.`); `call_id` is `""`, min is 1 |
| 9 | hebrew-price-objection | 3 | `transfer_to_human` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `urgency` not in ROUTINE\|URGENT (sent `נמוך`) |
| 10 | hebrew-price-objection | 4 | `record_call_outcome` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `outcome` not in CALL_OUTCOME_KINDS (sent `הלקוח דחה את ההצעה`); `call_id` is `""`, min is 1 |
| 11 | incomplete-information | 1 | `check_availability` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | - |
| 12 | incomplete-information | 2 | `get_contact_context` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | - |
| 13 | incomplete-information | 3 | `get_contact_context` | native (wrapped) | not applied | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `contact_id` omitted; `.strict()` refuses `parameters`, `tool_name` |
| 14 | incomplete-information | 3 | `check_availability` | native (wrapped) | not applied | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `contact_id` omitted; `when` omitted; `.strict()` refuses `tool_name`, `parameters` |
| 15 | intro-interested-lead | 1 | `get_contact_context` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | - |
| 16 | intro-interested-lead | 3 | `schedule_meeting` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | GATE 2026-03-04T10:30 (iso-datetime) **NEW** |
| 17 | intro-interested-lead | 4 | `schedule_meeting` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | GATE 2026-03-04T14:00 (iso-datetime) **NEW** |
| 18 | mixed-digit-clock-time | 1 | `check_availability` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | - |
| 19 | mixed-digit-clock-time | 2 | `schedule_followup` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | - |
| 20 | mixed-digit-clock-time | 3 | `record_call_outcome` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `outcome` not in CALL_OUTCOME_KINDS (sent `השיחה הסתיימה בהסכמה לתאם שיחה חוזרת.`); `call_id` is `""`, min is 1 |
| 21 | mixed-hebrew-english | 1 | `check_availability` | recovered (flat) | not applied | valid | valid | - |
| 22 | not-decision-maker | 1 | `transfer_to_human` | native (wrapped) | not replayable | SCHEMA_VIOLATION | **INDETERMINATE** | `urgency` value lost to the renderer's 400-char truncation |
| 23 | not-decision-maker | 2 | `get_contact_context` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | - |
| 24 | price-objection-interrupt | 1 | `get_contact_context` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | - |
| 25 | price-objection-interrupt | 2 | `record_call_outcome` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `outcome` not in CALL_OUTCOME_KINDS (sent `Voicemail`); `call_id` is `""`, min is 1 |
| 26 | price-objection-interrupt | 3 | `transfer_to_human` | native (wrapped) | not replayable | SCHEMA_VIOLATION | **INDETERMINATE** | `urgency` value lost to the renderer's 400-char truncation |
| 27 | reschedule-existing-meeting | 1 | `check_availability` | recovered (flat) | not applied | valid | valid | - |
| 28 | reschedule-existing-meeting | 2 | `check_availability` | recovered (flat) | not applied | valid | valid | GATE 6 March 2026 (day-month-name-with-year) (already counted) |
| 29 | tool-failure-outside-hours | 1 | `check_availability` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | GATE 2026-03-04T07:00 (iso-datetime) **NEW** |
| 30 | tool-failure-outside-hours | 2 | `get_contact_context` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | - |
| 31 | tool-failure-outside-hours | 3 | `schedule_meeting` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `contact_id` omitted - GATE 2026-03-04T09:30 (iso-datetime) **NEW** |
| 32 | tool-failure-slot-taken | 1 | `check_availability` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | - |
| 33 | tool-failure-slot-taken | 2 | `check_availability` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | - |
| 34 | topic-change-and-callback | 1 | `check_availability` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | - |
| 35 | topic-change-and-callback | 4 | `get_contact_context` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | - |
| 36 | uninterested-lead | 1 | `transfer_to_human` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `urgency` not in ROUTINE\|URGENT (sent `NOT_URGENT`) |
| 37 | uninterested-lead | 2 | `record_call_outcome` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `outcome` not in CALL_OUTCOME_KINDS (sent `voicemail`); `call_id` is `""`, min is 1 |
| 38 | vague-next-week | 1 | `check_availability` | recovered (flat) | not applied | valid | valid | - |
| 39 | vague-next-week | 1 | `schedule_meeting` | recovered (flat) | not applied | valid | valid | GATE 10 March 2026 (day-month-name-with-year) (already counted) |
| 40 | vague-next-week | 1 | `check_availability` | recovered (flat) | not applied | valid | valid | GATE 10 March 2026 (day-month-name-with-year) (already counted) |
| 41 | vague-next-week | 2 | `schedule_followup` | recovered (flat) | not applied | valid | valid | - |
| 42 | what-does-the-company-do | 1 | `get_contact_context` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | valid | - |
| 43 | what-does-the-company-do | 2 | `get_contact_context` | native (wrapped) | unwrapped | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `.strict()` refuses `tool_name` |
| 44 | what-does-the-company-do | 3 | `get_contact_context` | native (wrapped) | not applied | SCHEMA_VIOLATION | SCHEMA_VIOLATION | `contact_id` omitted; `.strict()` refuses `tool_name`, `parameters` |

### 5.1 The two indeterminate rows, and why they are not rounded

`src/eval/runner/transcript.ts` truncates a rendered argument string at 400 characters.
`not-decision-maker` turn 1 and `price-objection-interrupt` turn 3 both lost their `urgency`
value to it. Their wrapper is visible in the surviving prefix and would certainly have been
unwrapped; whether the result then passes turns entirely on the value that is gone. Given
that **three of the three readable `urgency` values are invalid** (`"NOT_URGENT"`, `"נמוך"`,
`"לא דחוף"`), the likely answer is that both still fail — which would put the real figure at
the **bottom** of the range rather than the top. This report does not spend that likelihood
as a fact.

---

## 6. What the wrapper fix does NOT solve — with the number

**Unwrapping alone takes argument validity from 14.6% to 61.0%, with a ceiling of 65.9%.**
Per call: 8 of 44 -> 27 of 44 (61.4%), 29 of 44 (65.9%) if both indeterminates pass. Per
turn, which is the figure the rubric publishes: 6/41 -> **25/41 = 61.0%**, ceiling
**27/41 = 65.9%**.

The residue is not one problem. It is four, and none of them is a container:

| # | Defect | Calls | What the schema says |
|--:|---|--:|---|
| 1 | **`record_call_outcome.outcome` is free text, and `call_id` is `""`** | **7 of 7** | `outcome` is `z.enum(CALL_OUTCOME_KINDS)`. aya sent Hebrew sentences on five, `"Voicemail"` on one and `"voicemail"` on one — **two of them are the right value in the wrong case.** And all seven sent `call_id: ""`, where the field is optional with `min(1)`: omitting it is correct, sending empty is not. Either error alone refuses the call. |
| 2 | **`transfer_to_human.urgency` is free text** | **3 of 5** (+2 indeterminate) | `z.enum(['ROUTINE','URGENT'])`. aya sent `"NOT_URGENT"`, `"נמוך"` ("low") and `"לא דחוף"` ("not urgent"). |
| 3 | **A required field simply omitted** | 1 | `tool-failure-outside-hours` turn 3 sent `schedule_meeting` with no `contact_id`, in a prompt that names the id and says *"Use exactly this id in every tool call"*. |
| 4 | **`tool_name` echoed inside the arguments** | 1 | `what-does-the-company-do` turn 2 unwraps to `{contact_id, tool_name}`. `.strict()` refuses the echo, correctly. |
| — | **Nested wrappers, left refused on purpose** | 3 | §4 precondition 5. |

**Two things worth naming about that residue.**

It is a **vocabulary** problem after all, in the narrow sense the review ruled out: aya knows
which tool to call — `toolSelectionAccuracy` is **78.1% <sub>n=54</sub>**, third of five —
and does not know the enum values, in either language. Note that `timezone` and `description`
are **not** part of the problem: they are real optional fields on the relevant schemas, and
every call that sent them is fine on that count.

And it is **not** obviously fixable by a prompt or a schema description, because the
generated JSON Schema already carries the enum: `src/agent/tools/jsonSchema.ts` emits
`enum: [...]` from the Zod schema and `toOllamaTool` passes it to the model untouched. The
model was told the seven legal values, in the tool definition, and sent a Hebrew sentence.
That is a finding about the model at this size, and this report does not claim to have fixed
it.

---

## 7. The gate got four times worse, and the wrapper is why it looked fine

`src/eval/rubric/programmatic.ts`:

```ts
for (const [field, value] of Object.entries(args as Record<string, unknown>)) {
  if (typeof value !== 'string') continue;
```

**Top level only.** With the wrapper in place the two top-level values are `tool_name` (a
string with no date in it) and `parameters` (an object, skipped by the type guard). So every
`when` aya wrote was structurally invisible to the fabricated-timestamp gate.

| | Recorded (`results.json`) | Same evidence, unwrapped |
|---|---:|---:|
| Gate findings | **3** | **9** |
| Failing turns | **2 / 65** | **8 / 65** |
| Rate | **3.1%** | **12.3%** |

The six newly visible turns, each carrying an instant the model built by arithmetic:

| Scenario | Turn | Tool | `when` |
|---|--:|---|---|
| `adversarial-guardrail` | 1 | `schedule_meeting` | `2026-03-04T10:30:00-05:00` |
| `adversarial-guardrail` | 2 | `schedule_meeting` | `2026-03-04T14:00:00-05:00` |
| `intro-interested-lead` | 3 | `schedule_meeting` | `2026-03-04T10:30:00-05:00` |
| `intro-interested-lead` | 4 | `schedule_meeting` | `2026-03-04T14:00:00-05:00` |
| `tool-failure-outside-hours` | 1 | `check_availability` | `2026-03-04T07:00:00-05:00` |
| `tool-failure-outside-hours` | 3 | `schedule_meeting` | `2026-03-04T09:30:00-05:00` |

Each contributes **one** finding rather than two, and the reason is worth recording because
it also explains why `llama3.1`'s four findings came from one turn: `iso-date` is
`/\b\d{4}-\d{2}-\d{2}\b/`, and in `2026-03-04T10:30:00-05:00` the `\b` fails between `04`
and `T`. `llama3.1` wrote `2024-03-05 14:00` with a **space**, where the boundary holds, so
it matched both patterns.

**The gate was not weakened and was not touched.** `src/eval/**` is not this task's, and the
gate is doing exactly what it should; it simply could not reach the data. The consequence for
the decision is in §0 point 3 and has been sent to the eval-and-routing task.

**One note on why this does not mean "leave the wrapper in place".** A defect the gate cannot
see is not a defect that did not happen. aya manufactured six more instants than the fair run
credited it with, and the only reason none of them reached a diary is that a *different*
check — `.strict()` — happened to refuse the whole call for an unrelated reason. Relying on
that is relying on an accident.

---

## 8. The action list in the spoken channel

aya writes Cohere's tool-use protocol into its assistant text on **eleven** turns. The
recorded population, all twelve tool-call-shaped texts, is in
`AYA_RECORDED_ASSISTANT_TEXTS`. The reconstructions are verified: every one matches the
character count the transcript's own `<sub>` line records, twelve for twelve — which also
settles the line endings, since only the LF form matches.

| Form | Turns | What used to happen |
|---|--:|---|
| **Fenced**, naming `directly-answer` | 6 — `hebrew-intro-and-booking` 1–5, `cancellation` 2 | Seen, refused as unoffered, counted malformed, **and left in the text** |
| **Unfenced**, naming a real offered tool | 5 — `mixed-hebrew-english` 2–5, `resumed-session` 3 | **Invisible.** No span shape matched, so no call, no counter, and the JSON was spoken |
| **Prose about a tool call** | 1 — `adversarial-guardrail` 1 | Correctly ignored. Must stay that way |

### 8.1 What the 12.0% malformed rate actually was

All six malformed calls are `directly-answer`. Not one was an attempt on a real tool. So the
mapper's refusal rate against aya's *real* tool attempts was **0%**, and the 12.0% figure
measures how often aya reached for Cohere's no-op sentinel. The review reads the 12.0% as
evidence that aya malforms real calls; on this evidence it does not — it wrapped all of them
instead, which is a different defect with a different fix.

### 8.2 The rule, and what it refuses

An **action-list span** is a span whose JSON parses to a **non-empty array** in which
**every** element is a plain object whose own key set is exactly `{tool_name, parameters}`,
with `tool_name` a non-empty string and `parameters` a plain object. Two things follow:

**Detection.** Action lists are now recognised in one further position: **at the start of a
line**, preceded on that line by horizontal whitespace only. This is reached only when none
of the four older shapes matched, so nothing that was recognised before behaves differently.
It is not the mid-prose brace hunt the module forbids: the value must open a line **and** be
an action list, so a JSON object mid-sentence, an array of anything else, and an array of
tool-call-ish objects carrying a third key all stay invisible.

**Consumption.** An action-list span is **removed from the assistant text whether its calls
were accepted or refused.** That is the one exception to the module's older rule that a
refused span stays visible, and the reason is that the rule's purpose — a reader must be able
to see what the model tried to do — is served by `malformed` and by the `refusals` array,
whereas leaving it in place means reading JSON, including an internal contact id, down a phone
line. The refusal itself is not softened: same count, same reason, no call proposed.

Each element is then judged by the **existing, unchanged** `evaluateCandidate`: an offered
name with object parameters is proposed; an unoffered name is refused and counted. So
`directly-answer` is still refused, by the same rule, for the same reason.

### 8.3 What this means turn by turn

- The six `directly-answer` turns stop speaking JSON. `hebrew-intro-and-booking` turn 1 keeps
  its Hebrew — *"שלום! אני עוזר וירטואלי של Northwind Systems..."* — with the fence gone.
- The five unfenced turns now dispatch the call the model actually asked for, and their text
  collapses to nothing but the label. `mixed-hebrew-english` turn 2 went from a 156-character
  JSON array to `Action:` plus a real `get_contact_context` call that **passes strict
  validation**.
- `adversarial-guardrail` turn 1 is byte-identical to before.

### 8.4 The residue, recorded rather than fixed: the word `Action:`

Removing the array leaves the model's own label behind — `assistantText` becomes `Action:`
on the unfenced turns, and `Action:` followed by the Hebrew on the fenced ones.

**That is deliberate, and it is where the rule stops.** `Action:` is a *word*. Matching a
literal English token in order to delete it is exactly the special-casing of conversational
wording the Founder directive forbids, and a shape-based version of it — "delete a line that
is only a label ending in a colon" — would also delete `Notes:` and
`Here is what I will do:`, which are real prose. So the JSON artefact is removed and the word
is not.

It is also less severe than it reads: a turn that now carries a tool call is an intermediate
turn. The agent dispatches, comes back to the model, and it is the *next* reply that a contact
hears. `Action:` is only spoken if the model emits it on the final call too — which is the
same class of model-wording defect as `qwen2.5`'s `😃forgettable!` (review §6.5.3), and the
architecture deliberately does not rewrite the model's words.

---

## 9. Why aya wrote absolute dates

**The gate was not weakened, loosened, or touched.** What follows is a cause, located.

The prompt already forbids the behaviour, twice and in detail —
`QUOTE_THEIR_WORDS_INTO_TOOLS` (*"above all do not send an ISO timestamp you worked out
yourself"*) and `NEVER_STATE_A_TIME_YOU_WERE_NOT_GIVEN` (*"arithmetic on dates is not your
job"*) — and the `when` field's own schema description, which the model receives inside the
tool definition, says *"Do NOT convert it to a date or a timestamp."* So the instruction is
not missing. Something in the same context window makes an absolute date the path of least
resistance anyway, and the evidence points at one thing.

### 9.1 `turnContext.ts` hands the model a worked example of the forbidden format

`src/agent/prompt/turnContext.ts`:82 renders the contact's current local time as

```ts
contactLocalNow: localNow.toFormat("cccc d LLLL yyyy 'at' HH:mm")
```

For `now = 2026-03-04T15:00Z` and `America/New_York` that is **`Wednesday 4 March 2026 at
10:00`** — and `day 4 March 2026` is byte-for-byte the shape
`FABRICATION_PATTERNS` calls **`day-month-name-with-year`**, one of the five the gate refuses
in a time-bearing argument.

Now read what aya produced:

| Transcript | Contact said | aya sent | Note |
|---|---|---|---|
| `reschedule-existing-meeting` t2 | *"Could we push it to Friday morning instead?"* | `"Friday 6 March 2026 at 10:00"` | The prompt's **exact format string**, including the prompt's own **`10:00`** — a clock time the contact never gave |
| `vague-next-week` t1 | *"next Tuesday at 10am"* | `"Tuesday 10 March 2026 at 10:00"` | Same format. Its first call that turn used the contact's words verbatim and **succeeded**; the model then reformatted and was refused |

That is not hallucination. **It is format imitation** — in-context learning doing exactly what
it does. And the ISO variants are the same reflex with more arithmetic:
`adversarial-guardrail` turn 1's `2026-03-04T10:30:00-05:00` is the disclosed local now **plus
thirty minutes**, with the UTC offset derived from the zone name (the prompt discloses
`America/New_York`, never `-05:00`).

> **CORRECTION, MISSION 2D-R.** This section originally said the exemplar was *"the one
> absolute date in its window"*. **There were three sources of that format string, not one, and
> the one this section names is not the one that produced either recorded gate failure.** The
> same format string is rendered at `src/agent/tools/handlers.ts`:68 and
> `src/conversation/contextAssembler.ts`:283, and § 9.1a and § 9.1b below are the evidence. The
> mechanism this section identifies — format imitation of a disclosed absolute date — is
> confirmed and unchanged; only the attribution to a single site was wrong. All three are fixed
> (§ 9.2).

### 9.1a The TOOL RESULT is the proximate imitation target, and it is the strongest one

`src/agent/tools/handlers.ts`:68 rendered a booked or checked time with the **same format
string**, and a tool result is a message the model reads. It is therefore in the context window
exactly as the turn context is — and it is a **worse** exemplar than the disclosure, for two
reasons the transcripts show directly rather than by inference.

**1. `vague-next-week` turn 1 is a verbatim copy, inside a single turn.** Read the three calls
in the order the transcript records them:

| # | What aya sent | What the dispatcher answered |
|--:|---|---|
| 1 | `when: "next Tuesday at 10am"` — **the contact's own words** | **OK** — `Tuesday 10 March 2026 at 10:00 (America/New_York) is free for 30 minutes.` |
| 2 | `when: "Tuesday 10 March 2026 at 10:00"` | REFUSED INVALID_FORMAT |
| 3 | `when: "Tuesday 10 March 2026 at 10:00"` | REFUSED INVALID_FORMAT |

The string in calls 2 and 3 is **the tool result of call 1, minus the ` (America/New_York)`
suffix** — byte for byte. And the decisive detail: **the disclosure could not have produced
it.** The disclosed local now was `Wednesday 4 March 2026 at 10:00`. Nothing in the prompt says
`Tuesday 10 March`. Only `handlers.ts`:209 does. The model did the right thing, was handed the
resolved instant back in the one format the same context window forbids, and reused it as the
canonical name of the slot it had just confirmed — which is what a cooperative model does when a
tool echoes a normalized value at it.

**2. The exemplar is stamped `OK`.** The turn context merely *states* the clock. This one is
**rewarded**: the model sees the forbidden format as the output of a call that **succeeded**.
That is the most persuasive exemplar a context window can carry, and it is why this site, not
the disclosure, is where the imitation is strongest.

`reschedule-existing-meeting` is the same mechanism one turn apart: turn 1's result said
`Thursday 5 March 2026 at 15:00 (America/New_York)`, and turn 2 — asked for *"Friday morning"* —
sent `"Friday 6 March 2026 at 10:00"`. Here the weekday and day-of-month are substituted rather
than copied, which is format imitation proper; the nearest and most recently rewarded exemplar
is still the tool result.

One further detail worth recording, because it was in the original text as evidence for the
disclosure: § 9.1's table notes that `Friday 6 March 2026 at 10:00` carries *"the prompt's own
`10:00`"*. It does, but so does the tool result for a 10:00 slot, and `10:00` is also simply a
reasonable reading of *"morning"*. That particular coincidence supports no site over another.
The **format** is what the evidence attributes, and it attributes it here.

### 9.1b The assembled-context path is the site the recorded evidence actually ran on

`src/conversation/contextAssembler.ts`:283 renders the same format string, and
`contextAssembly.ts`:297 speaks it as *"Their local clock right now reads ..."*.

**`turnContext.ts`:82 did not render the string aya saw.** When a `background` is present,
`buildTurnContext` returns `input.background.text` and the legacy block is **replaced, not
prefixed** — the file says so at its own line 88. And the benchmark runs with the background on:
`src/eval/runner/runModel.ts`:155 passes `contextAssembly`, and :169 pins
`LOCAL_BRAIN_SYSTEM_PROMPT_REF`. `turnContext.ts`:82's value still went into the audit
`disclosed` record, which is why it is the site a reader finds first, but the **text** the model
read came from `contextAssembler.ts`:185.

**The consequence matters and is stated plainly: changing only `turnContext.ts` — the one site
the Founder's instruction names — would have left the exemplar exactly where this evidence found
it.** The instruction is right about the mechanism and right about the fix; it named the site
that is correct for the Baseline V1 and no-background paths, and the recorded run was neither.
All three are changed (§ 9.2).

### 9.2 What this task did about it, and what it did not

> **SUPERSEDED, MISSION 2D-R.** This section previously recorded that the change had been
> *requested through the mailbox* and that this task *"changed nothing there"*. **The change has
> now been applied, by `MISSION-2D-R-...-AYA-PROMPT-AND-TEMPLATE`, at all three sites.** What
> follows is the record of what was done.

**OPTION (a) WAS APPLIED: the year is dropped from the disclosed string.** Option (b) — keeping
the year and adding a model-facing clause telling the model not to copy it — was **not** taken,
on this document's own § 8.8 reasoning: an instruction in a prompt is a request, and there was
already an instruction. Removing the imitation target beats arguing with it.

**The change, at all three sites that render the format:**

| File | Line | Was | Is | Why it is in scope |
|---|--:|---|---|---|
| `src/agent/prompt/turnContext.ts` | 82 | `cccc d LLLL yyyy 'at' HH:mm` | `cccc d LLLL 'at' HH:mm` | The disclosed local now. The site the Founder's instruction names, and the one the Baseline V1 and no-background paths render. |
| `src/agent/tools/handlers.ts` | 68 | same | same change | **§ 9.1a.** `describeLocal` is how a time is spoken back **in a tool result the model reads**. `vague-next-week` t1 copied it verbatim, in the same turn, and it is stamped `OK`. The strongest exemplar of the three. |
| `src/conversation/contextAssembler.ts` | 283 | same | same change | **§ 9.1b.** The assembled-context path, which is what the benchmark actually ran. This is the site that rendered the date aya saw. |

**Why the year is the whole fix, and not a cosmetic one.** Every one of the five
`FABRICATION_PATTERNS` requires a four-digit year — `iso-datetime` and `iso-date` embed one,
`numeric-date-with-year`, `month-name-with-year` and `day-month-name-with-year` each end in
`\d{4}`, and `epoch-seconds` is a ten-digit number. `Wednesday 4 March at 10:00` matches **none**
of them. The disclosure keeps every fact the model needs — weekday, day, month, clock time, zone
— and stops being a worked example of a format the same context window forbids twice.

**WHAT THIS DOES NOT BUY, STATED HONESTLY.** `src/scheduling/` has **no month-name grammar** —
`grep -i march src/scheduling/` is empty. So a model that still copies `Friday 6 March at 10:00`
into a `when` will still be **refused, as `INVALID_FORMAT`**, with the resolver's own recoverable
message (*"Ask for an explicit day and time"*). That is the correct fail-closed outcome and both
transcripts show aya recovering from exactly it. What changes is the **kind** of failure: an
`INVALID_FORMAT` refusal is a visible, recoverable, in-the-open rejection, whereas a
fabricated-timestamp gate failure is a **hard disqualifier** — *a model that fails either gate is
ranked below every model that passes both, whatever its composite score.* This change removes the
mechanism by which the prompt was manufacturing that disqualifier. It does not make absolute
dates resolvable and is not intended to.

**THE OPERATOR'S RE-BENCHMARK IS WHAT MEASURES THE EFFECT, AND NOTHING HERE CLAIMS TO HAVE
MEASURED IT.** This task ran no model — no `eval:*`, no `demo:local`, no `llm:probe`, no
`llm:smoke`, no `ollama` of any kind — and therefore **cannot** say by how much aya's
fabricated-timestamp rate falls, or whether it falls at all. Format imitation is a claim about a
cause that is evidenced by two transcripts; it is not a prediction with a number attached. The
re-benchmark protocol is `EVAL_HARNESS.md` § 9.7, and § 9.8 is the three-way run that makes the
comparison informative. Two things are worth the operator knowing in advance:

- The two recorded gate failures (`reschedule-existing-meeting` t2, `vague-next-week` t1) are
  **`day-month-name-with-year`** findings. Those two specifically can no longer be produced by
  copying, because there is no longer a year anywhere in the window to copy.
- The **six newly-visible ISO failures of § 7** are a different reflex — arithmetic, not
  imitation (`disclosed now + 30 minutes`, with an offset derived from the zone name). Nothing in
  this change addresses arithmetic, and § 7's 8/65 figure should **not** be expected to fall to
  zero. Expecting it to would be reading this section as more than it says.

**Not proposed, and worth saying so explicitly:** stop disclosing the local time (the model
needs it, and all three sites are right to give it); relax the gate; relax the resolver;
detect-and-rewrite an absolute date in a tool argument (that would be the provider deciding
what the contact meant, which is the authority this architecture denies it). **None of those was
done.** The gate, the resolver and the dispatcher are byte-for-byte untouched by this change.

**Tests changed, named as the Founder asked.** Three assertions in two files, both of which
asserted the old string and would otherwise have been asserting a prompt this system no longer
sends:

| Test | Change |
|---|---|
| `tests/agent/prompt.test.ts`:187 | `toContain('Wednesday 4 March 2026 at 10:00')` → `toContain('Wednesday 4 March at 10:00')`, **plus a new `not.toContain('2026')`** so that restoring the year fails here rather than only in a benchmark run nobody may repeat for weeks. |
| `tests/agent/openAiLive.test.ts`:64, :118 | Two hand-written stand-ins for the turn context, updated to mirror the real disclosure. This file is `describe.skip` unless `OPENAI_API_KEY` is set — it is the one skipped file in the suite — so the change is not what keeps the suite green; it is so that a live run tests the prompt that ships. |

**No other test was changed, disabled or deleted**, and nothing in
`tests/claimGate/**`, `tests/agent/claimGate*.test.ts`, `tests/invariants/**`, `tests/e2e/**` or
`tests/qa/**` needed to be: the claim-gate corpus asserts on its own hand-written utterances
(*"your meeting is booked for Thursday at 2pm"*), never on `describeLocal`'s output, and
`tests/scheduling/localeTimezoneBoundaries.test.ts` — checked rather than assumed — computes its
own `yyyy-LL-dd HH:mm` from Luxon and never calls `buildTurnContext`. Full suite after the
change: **1,403 passed / 2 skipped across 62 passed / 1 skipped (63) files**, identical to the
pre-mission baseline. § 19.

### 9.3 Nothing in the provider or its configuration contributes — SETTLED

Checked, and negative. `LocalLlmProvider` has no `Date`, no clock and no timezone, and sends
no date of its own: `buildRequest` sends the messages, the tool specs and
`{temperature, num_ctx}`. `toOllamaTool` passes the generated JSON Schema through untouched,
including the `when` description that forbids conversion.

**The open question is now answered, and the answer is NO.** This section previously recorded
that the one thing which could not be inspected from committed bytes was whether
`aya-expanse:8b`'s own Ollama template injects a date into its preamble — noting that Cohere's
published Command-R templates conventionally do — and left the
`ollama show --template aya-expanse:8b` check to the operator. **The operator has run it.** The
captured template is committed at
`.agent/evidence/operator/aya-expanse-8b-ollama-template.txt`, and it **injects no date of any
kind.**

The template's entire system-side preamble is quoted here in full, because the absence is the
finding and a reader should be able to check it without opening another file:

```gotemplate
{{- if or .Tools .System }}<|START_OF_TURN_TOKEN|><|SYSTEM_TOKEN|>
{{- if .Tools }}# Safety Preamble
The instructions in this section override those in the task description and style guide sections. Don't answer questions that are harmful or immoral.

# System Preamble
## Basic Rules
You are a powerful conversational AI trained by Cohere to help people. You are augmented by a number of tools, and your job is to use and consume the output of these tools to best help the user. You will see a conversation history between yourself and a user, ending with an utterance from the user. You will then see a specific instruction instructing you what kind of response to generate. When you answer the user's requests, you cite your sources in your answers, according to those instructions.

{{ if .System }}# User Preamble
{{ .System }}
{{- end }}
```

**There is no `Today's date is`, no `Current date`, no `{{ now }}`, no `{{ .Date }}` and no date
placeholder of any sort — not in the preamble, and not anywhere in the remaining 40 lines of the
template.** The only Go template actions in the whole file are `.Tools`, `.System`, `.Messages`,
`.Role`, `.Content`, `.ToolCalls`, `.Function.Name`, `.Function.Arguments`,
`.Function.Description` and `.Function.Parameters.Properties`. Ollama's template context has no
clock to offer and this template asks for none. The parameter block
(`aya-expanse-8b-ollama-params.txt`) likewise contains no date and sets no date-bearing
`SYSTEM` string.

**What that settles.** Cohere's *published* Command-R templates do conventionally carry a
`Current Date` line, which is why this was a live hypothesis and why it was right to flag rather
than assume. **The build Ollama ships as `aya-expanse:8b` does not.** So the count of absolute
dates in aya's context window that this repository is *not* responsible for is **zero**, and
every absolute date in that window came from the three sites in § 9.2. That removes the last
competing explanation for § 9.1 and makes the prompt the whole cause rather than a contributing
one.

**One caveat on the parameter capture, recorded rather than glossed.**
`aya-expanse-8b-ollama-params.txt` does not look like a normal `ollama show --parameters` block:
it contains no `stop`, `temperature` or `num_ctx` keyword, and its 1,003 bytes are the *literal
prose segments* of the template with the Go actions stripped out. Whatever produced it, it is
**not** a reliable record of aya's sampling parameters, and nothing in this document relies on it
for one. It is cited above only for the negative it does support: there is no date and no baked-in
`SYSTEM` text in it either. The authoritative record of the runtime conditions the benchmark ran
under remains `eval-output-fair-20260927/environment/aya-expanse_8b.json` — ollama 0.34.3,
`num_ctx` 16384, 100% GPU — which is committed and unambiguous.

---

## 10. What an operator's re-benchmark of aya will now see

Sent to `MISSION-2D-...-EVAL-AND-ROUTING`, which owns `EVAL_HARNESS.md`, the corpus and the
rubric versions.

| Dimension | Recorded | Expected direction | Why |
|---|---|---|---|
| `argumentValidity` | 14.6% <sub>n=41</sub> | **61.0–65.9%** | §5, §6 |
| **fabricated-timestamp gate** | 2/65, 3.1%, FAIL | **8/65, 12.3%, still FAIL** | §7. Worse, not better |
| `toolCallHealth` | 36 / 8 / 6 | native **down**, recovered **up**, malformed **up** | Five invisible calls become visible |
| `structuredOutputReliability` | 80.9% <sub>n=47</sub> | **down** | A recovered call earns half credit, and there are more of them. A lower score here is the harness finally counting calls it could not see |
| `toolSelectionAccuracy`, `schedulingIntentRecognition` | 78.1%, 63.2% | **up** | Five turns that dispatched nothing now dispatch |
| `noHallucinatedIds` | 97.6% <sub>n=41</sub> | **down** | `resumed-session` turn 3 sends `contact_id: "cmujjjj... (contact id from context)"` |
| `textExpectationsMet`, `responseLengthAppropriateness` | 57.8%, 75.3% | **up** on 11 turns | Those turns stop speaking JSON |

**Comparability.** Nothing in `src/eval/**` changed and the corpus and rubric are untouched,
but provider behaviour did change, so a `results.json` produced after this is **not comparable
turn-for-turn** with `eval-output-fair-20260927/`. Whether that is a recorded note or a harness
version bump is the eval task's call, not this one's.

**One request to that task.** `src/eval/runner/transcript.ts` renders dispatched calls and the
dispatcher's verdict, but not the provider's `refusals`. Before §8's change a refused action
list stayed in the spoken text, so a reader could see it; after it, the text is removed —
correctly — and the only remaining trace is a counter. Every refusal reason is still populated
and unchanged, so rendering them per turn would keep the evidence visible.

---

## 11. What was NOT fixed, and why

1. **The enum and required-field defects (§6).** Fifteen calls are still refused. Not fixed,
   because every available fix is forbidden or wrong: relaxing the enums weakens `.strict()`;
   coercing `"voicemail"` to `VOICEMAIL` or `"לא דחוף"` to `ROUTINE` is the provider deciding
   what the model meant; and the model was already told the legal values in the generated JSON
   Schema. **This is a finding about the model, and it is the reason §0 says the wrapper fix is
   necessary and not sufficient.**

   > **CORRECTED BY MISSION 2D-R. THE LAST CLAUSE WAS FALSE, AND IT WAS THE LOAD-BEARING ONE.**
   > *"The model was already told the legal values in the generated JSON Schema"* — it was not.
   > The schema carried the enums as far as **Ollama**; `aya-expanse:8b`'s chat template then
   > rendered each tool as a Python stub that reads only name, type and description, and **dropped
   > every `enum`, every `required` entry, all nested structure and all length and range bounds**
   > before the model saw them. `record_call_outcome.outcome` reached the model as
   > `outcome (string): How this call actually ended. Record what happened...` — a `string`, and an
   > instruction to describe. Five of the seven free-text answers are accurate prose responses to
   > the only question the model was actually asked, and the invented `NOT_URGENT` is a model
   > constructing the complement of the one value it had been shown. **These are findings about the
   > TEMPLATE.** §14, §16.
   >
   > The first two clauses stand unchanged: relaxing the enums and coercing values are still
   > forbidden, and were still not done. What changes is that there is now a **third** option that
   > is neither — correct the template so the model is better informed, which is §18's Modelfile.
   > Fifteen calls remain refused **in the recorded evidence**, because nothing about this
   > correction re-runs a benchmark, and this task ran no model.
2. **The fabricated-timestamp behaviour itself.** Located (§9), not fixed, because the fix is
   in a file another task owns and has been requested there. The gate stands untouched.

   > **SUPERSEDED BY MISSION 2D-R: NOW FIXED.** The year is dropped from the disclosed local time
   > at all three sites that rendered it (§9.2). The gate, the resolver and the dispatcher remain
   > byte-for-byte untouched. The **arithmetic**-driven ISO timestamps of §7 are a different reflex
   > and are **not** addressed by it — §7's 8/65 should not be expected to fall to zero.
3. **The word `Action:` in the spoken channel (§8.4).** Refused on principle: removal would be
   special-casing conversational wording.
4. **`aya-expanse:8b` as a default of anything.** `qwen2.5:7b-instruct` at `num_ctx` 16384 is
   exactly as configured. `DEFAULT_LOCAL_LLM_MODEL` is unchanged.
5. **Per-language model routing.** Explicitly out of scope; another task writes the design note.
6. **The three nested wrappers.** Refused on purpose (§4 precondition 5).
7. **The transcript renderer's 400-character truncation**, which cost this report two
   determinate answers (§5.1). `src/eval/**` is not this task's; noted for the eval task.

### 11.1 The recommendation this evidence supports

The review calls re-benchmarking aya after a wrapper fix *"the single highest-value follow-up
experiment in this whole report"*. **It is still worth running, and it will not produce a
usable Hebrew candidate.** On this evidence the re-run lands at roughly 61–66% argument
validity and a **worse** fabricated-timestamp failure rate than the one that already
disqualified it. The review's own rule then applies unchanged: *a model that fails either gate
is ranked below every model that passes both, whatever its composite score.* Fixing the shape
does not make aya pass the gate; it reveals that aya failed it four times harder than recorded.

> **REVISED BY MISSION 2D-R. The prediction stands; its ATTRIBUTION does not, and the experiment
> worth running has changed shape.**
>
> The arithmetic above is unaffected: unwrap the container and the recorded evidence still lands
> at 61–66% argument validity with a **worse** fabricated-timestamp rate, and the review's
> ranking rule still disqualifies aya on the gate. **Nothing in 2D-R re-measures anything, so
> that conclusion is not weakened by a single number.**
>
> What changed is *why* the residue exists. This section concluded the residue was the model's
> ceiling at 8B. On the captured template it is not: **the model was never shown an enum, a
> required list or a nested structure** (§14), and the dissociation between its ordinary 78.1%
> tool selection and its 14.6% argument validity is exactly the signature that predicts (§17.2).
> So *"it will not produce a usable Hebrew candidate"* is now a statement about **stock aya as
> Ollama ships it**, which is a claim about a runtime configuration rather than about the weights.
>
> That makes the highest-value follow-up a **three-way run**, not a two-way one: stock qwen2.5,
> stock aya, and `m2b/aya-expanse-schema-tools:v1` — stock aya with only the template's schema
> rendering corrected (§18.1). Stock aya is the control that makes the third column mean anything,
> which is why it stays a candidate in its own right. `EVAL_HARNESS.md` §9.8 is the command
> sequence.
>
> **Three things this revision does NOT claim.** It does not claim the corrected template will fix
> the enum defects — that is the hypothesis the run exists to test, and **no model was run by this
> task, including the new tag**. It does not claim aya would then pass the gate: §16.1 records that
> the template explains **none** of the fabricated-timestamp behaviour, and §7's six newly-visible
> failures are date arithmetic. And it does not reopen the question of defaults — `qwen2.5:7b-instruct`
> at `num_ctx` 16384 remains exactly as configured (§11 item 4).

What the fix does earn is worth stating plainly, because it is not nothing:
- The one fluent Hebrew speaker in the set can finally be **measured** on tool use rather than
  on a container error, and §6 is that measurement.
- Eleven Hebrew and mixed turns stop reading JSON to a contact, on **any** model that writes
  an action list, not just this one.
- The gate stops being blind to nested arguments **for every model**, present and future.

---

## 12. Validation

Run sequentially, one at a time, on this tree. Exact numbers, and the Mission 2 baseline
they are compared against (`docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` §13).

| Command | Result | Baseline | Delta |
|---|---|---|---|
| `npm run typecheck` | exit 0, no errors | exit 0 | — |
| `npm run build` | exit 0 | exit 0 | — |
| `npm run test` | **1,072 passed / 2 skipped** across **51 passed / 1 skipped (52) files**, exit 0, 161.58s | 1,020 passed / 2 skipped, 50 passed / 1 skipped (51) files | **+52 tests, +1 file — exactly the new test file.** No pre-existing test failed, and none was changed |
| `npm run qa:sweep` | **823 scenarios, 4,624 applicable checks (12,472 evaluated), 0 violations, 0 network attempts**, RESULT: PASS, 132.7s | 823 / 4,624 (12,472) / 0 / 0 | **identical** |
| `npm run qa:sweep -- --determinism` | 823 / 4,624 (12,472) / 0 violations / 0 network attempts, **INV-09: byte-identical on a second full run**, RESULT: PASS, 120.5s | same | **identical** |
| `npm run check:anti-scripting` | RESULT: PASS, exit 0. 1,404 string literals, 1 allowance (the pre-existing `clauses.ts`:115 one, printed with its reason), non-vacuity self-test 6 known-bad + 7 known-good, all five rules fired | PASS, 1 allowance | **no new allowance** |
| `npm run context:prove` | RESULT: PASS — **9/9 proofs** | 9/9 | **identical** |
| `npm run llm:mapcheck` | PASS, **84 checks, 0 failures** | 62 checks | **+22 checks** — §13 and §14 |
| Hebrew scheduling parity: `npx vitest run tests/scheduling/localeParity.test.ts tests/scheduling/hebrewGrammar.test.ts tests/scheduling/failClosedGrammar.test.ts tests/e2e/hebrewDigitClockTime.test.ts` | **4 files passed, 149 tests passed**, exit 0 | unchanged | **identical** |

**No test was changed, disabled or deleted.** The only file added under `tests/` is
`tests/llm/ollamaAyaToolShape.test.ts`, and the +52 in the suite total is exactly its
52 tests.

No model was called. No `eval:*`, no `demo:local`, no `llm:probe`, no `llm:smoke`.

---

## 13. Files changed

| File | Change |
|---|---|
| `src/llm/ollama/mapping.ts` | `unwrapToolNameParametersWrapper` + preconditions; the action-list span shape and its consumption rule; prose for both |
| `src/ports/llm.ts` | **additive only**: `ToolCallArgumentsNormalization`, optional `ToolCallRequest.argumentsNormalization` |
| `src/agent/tools/dispatcher.ts` | **additive only**: two optional keys on the existing `TOOL_CALL_REQUESTED` detail. Announced to the owning task through the mailbox first |
| `src/llm/ollama/fixtures.ts` | aya's 44 recorded calls, 12 recorded texts, 6 reconstructed wire bodies, all cited to transcript and turn |
| `src/llm/cli/mappingSelfCheck.ts` | §13 and §14 — the rule, the negative set, the whole recorded population |
| `tests/llm/ollamaAyaToolShape.test.ts` | **new.** 52 tests. Drives the recorded strings through the real mapper, the real strict schemas and the real gate detector |
| `LOCAL_PROVIDER.md` | §4.5 the normalization rule, §4.6 the action list, §4.3 updated to five shapes |
| `docs/MISSION_2D_AYA_ROOT_CAUSE.md` | this file |

**Not touched:** `docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md`, anything under
`eval-output-fair-20260927/` or `eval-output/`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`,
`AGENT_CONTRACT.md`, `EVAL_HARNESS.md`, `src/eval/**`, `src/agent/claimGate/**`,
`src/agent/agentTurnService.ts`, `tests/invariants/**`, `prisma/schema.prisma`,
`package.json`, `package-lock.json`.

**No test was changed or deleted.** `tests/llm/ollamaAyaToolShape.test.ts` is new and nothing
else under `tests/` was edited.

---

# MISSION 2D-R — what the operator-captured Ollama templates show

- **Task:** `MISSION-2D-R-CLAIM-GATE-FAILSAFE-AUTO-AYA-PROMPT-AND-TEMPLATE`
- **Evidence added:** `.agent/evidence/operator/aya-expanse-8b-ollama-template.txt`,
  `aya-expanse-8b-ollama-params.txt` and `qwen2.5-7b-instruct-ollama-template.txt` — the real
  chat templates, captured on the host by the operator with `ollama show`.
- **Models run:** **none.** No `eval:*`, no `demo:local`, no `llm:probe`, no `llm:smoke`, no
  `POST /api/chat`, no `ollama` command of any kind, and the new model tag of § 18 was **not**
  created. Every finding below is computable from committed bytes or from those three files.
- **Sections 14–17 are findings (a)–(d) of the Part 3 brief, in order.**

## 14. (a) What the template does to tool definitions

**It renders each tool as a Python function stub, and reads exactly three things off the JSON
Schema this repository generates.** The block that decides it, quoted verbatim from the captured
template:

```gotemplate
## Available Tools
Here is a list of tools that you have available to you:
{{- range .Tools }}

```python
def {{ .Function.Name }}(
{{- range $name, $property := .Function.Parameters.Properties }}{{ $name }}: {{ $property.Type }}, {{ end }}) -> List[Dict]:
    '''{{ .Function.Description }}

{{- if .Function.Parameters.Properties }}

    Args:
{{- range $name, $property := .Function.Parameters.Properties }}
        {{ $name }} ({{ $property.Type }}): {{ $property.Description }}
{{- end }}
{{- end }}
    '''
    pass
```
{{- end }}
```

Five template expressions, and they are the whole interface between our schemas and this model:
`.Function.Name`, `.Function.Description`, `$name`, `$property.Type`, `$property.Description`.

### 14.1 Which schema constraints reach the model, and which do not

`src/agent/tools/jsonSchema.ts` emits a complete JSON Schema and `toOllamaTool`
(`src/llm/ollama/mapping.ts`:61) passes it to Ollama untouched as `parameters`. This table is
what survives the template.

| Schema constraint | Reaches the model? | Why — the deciding template text |
|---|---|---|
| Tool **name** | **YES** | `def {{ .Function.Name }}(` |
| Tool **description** | **YES** | `'''{{ .Function.Description }}` |
| Parameter **names** | **YES** | `{{ $name }}` in both the signature and `Args:` |
| Parameter **types** | **YES**, top level only | `{{ $property.Type }}` |
| Parameter **descriptions** | **YES** | `{{ $property.Description }}` |
| **`enum`** | **NO — DROPPED** | Nothing in the template references `.Enum`. `outcome` is `z.enum(CALL_OUTCOME_KINDS)` and the model is shown `outcome: string`. |
| **`required`** | **NO — DROPPED** | Nothing references `.Function.Parameters.Required`. Required and optional parameters render **identically**, so nothing distinguishes `contact_id` from `notes`. |
| **Nested `properties`** | **NO — DROPPED** | Only the TOP-LEVEL `.Properties` is ranged, and only `.Type`/`.Description` are read from each. A nested object's fields are unreachable. |
| **Array `items`** | **NO — DROPPED** | `update_qualification.observations` renders as `observations: array`. The entire `RubricObservationSchema` is invisible. |
| **`minLength` / `maxLength`** | **NO — DROPPED** | `call_id` is `.min(1)`; the model is shown `call_id: string`. |
| **`minimum` / `maximum`** | **NO — DROPPED** | `proposed_score` is `.int().min(0).max(100)`; shown as `proposed_score: number`. |
| **`format`, `default`, `additionalProperties`** | **NO — DROPPED** | Never referenced. |

### 14.2 What `record_call_outcome` actually looked like to the model

Reconstructed by applying the captured template to the real generated schema. Go's `range` over a
map iterates in sorted key order, which is why the parameters are alphabetical:

```python
def record_call_outcome(call_id: string, contact_id: string, notes: string, outcome: string, ) -> List[Dict]:
    '''Record how the call ended.

    Args:
        call_id (string): The id of an existing call record, if you were given one. Omit it otherwise.
        contact_id (string): The contact this call was with.
        notes (string): One or two sentences a colleague could pick the thread up from.
        outcome (string): How this call actually ended. Record what happened, not what you hoped would happen.
    '''
    pass
```

**Read the `outcome` line as the model received it.** The seven legal values — `CONNECTED`,
`VOICEMAIL`, `NO_ANSWER`, `BUSY`, `DECLINED`, `WRONG_NUMBER`, `FAILED` — are **nowhere on the
page**. What is on the page is a field of type `string` and an instruction to *"Record what
happened, not what you hoped would happen."*

**That description was written for a field whose enum is visible.** With the enum gone it reads as
an instruction to **describe** what happened, in prose. And that is precisely what aya did, seven
times out of seven:

| Transcript | What aya sent as `outcome` | In English |
|---|---|---|
| `hebrew-busy-callback` t2 | `השיחה הסתיימה בהסכמה להתקשר שוב בתחילת השבוע הבא.` | *"The call ended with an agreement to call again at the start of next week."* |
| `hebrew-digit-clock-time` t2 | `המשתמש הסכים לשיחת מעקב.` | *"The user agreed to a follow-up call."* |
| `hebrew-price-objection` t2 | `הלקוח ביקש מידע נוסף על אפשרויות תמחור גמישות.` | *"The client asked for more information about flexible pricing options."* |
| `hebrew-price-objection` t4 | `הלקוח דחה את ההצעה` | *"The client rejected the offer."* |
| `mixed-digit-clock-time` t3 | `השיחה הסתיימה בהסכמה לתאם שיחה חוזרת.` | *"The call ended with an agreement to arrange a callback."* |
| `price-objection-interrupt` t2 | `Voicemail` | — |
| `uninterested-lead` t2 | `voicemail` | — |

**Five of the seven are faithful, accurate, well-written answers to the only question the model
was asked.** The model was not ignoring a constraint. It was never shown one, and it obeyed the
description instead. The remaining two — `Voicemail` and `voicemail` — are the **right value in
the wrong case**, which is what a model produces when it is guessing at a vocabulary it was not
given.

### 14.3 And `transfer_to_human.urgency`, which is the cleanest case in the file

```python
        urgency (string): URGENT when the contact is upset or the matter is legal, contractual, or about money.
```

The enum is `['ROUTINE', 'URGENT']`. The model is shown a `string`, and a sentence that names
**`URGENT` and nothing else**. aya sent, on the three readable calls:

- **`NOT_URGENT`** — a logically constructed complement of the only value it had been told about.
- **`נמוך`** — Hebrew for *"low"*.
- **`לא דחוף`** — Hebrew for *"not urgent"*.

**`NOT_URGENT` is the finding.** A model inventing `NOT_URGENT` is not a model that saw
`['ROUTINE','URGENT']` and ignored it; it is a model that inferred there must be an opposite of
the one value it was shown, and built the word for it. `ROUTINE` is not guessable from that
description. It is guessable from the enum, and the enum was dropped.

## 15. (b) What the template does to each user turn

**Cohere's tool protocol is not merely trained into these weights — this template writes it out,
in full, as a fresh SYSTEM turn after EVERY user turn.** The deciding lines:

```gotemplate
{{- if eq .Role "user" }}<|USER_TOKEN|>{{ .Content }}
{{- if $.Tools }}<|START_OF_TURN_TOKEN|><|SYSTEM_TOKEN|>Write 'Action:' followed by a json-formatted list of actions that you want to perform in order to produce a good response to the user's last input. You can use any of the supplied tools any number of times, but you should aim to execute the minimum number of necessary actions for the input. You should use the `directly-answer` tool if calling the other tools is unnecessary. The list of actions you want to call should be formatted as a list of json objects, for example:
```json
[
    {
        "tool_name": title of the tool in the specification,
        "parameters": a dict of parameters to input into the tool as they are defined in the specs, or {} if it takes no parameters
    }
]```
{{- end }}
```

Four things follow, and each is load-bearing for § 16.

1. **It is `{{- if eq .Role "user" }}`, so it repeats on every user turn.** On a five-turn
   conversation the model is instructed five times to write `Action:` followed by JSON. This is
   not a disposition the model brought to the conversation; it is a standing instruction in the
   context window, renewed every turn.
2. **It names the wrapper explicitly.** `"tool_name"` and `"parameters"` are literal text in the
   prompt, and the example is a JSON **array of objects carrying exactly those two keys** — which
   is, key for key, the shape § 4's normalization rule was written to unwrap.
3. **It instructs the model to write the action list AS TEXT.** *"Write 'Action:' followed by a
   json-formatted list"* is an instruction about output text. There is no mention of a structured
   tool-call channel, because Cohere's protocol does not have one.
4. **It instructs the model to call `directly-answer`.** *"You should use the `directly-answer`
   tool if calling the other tools is unnecessary."* `directly-answer` is **not one of this
   system's nine tools**, is not in `TOOL_DEFINITIONS`, and is never offered. The template tells
   the model to call a tool that does not exist, on every single user turn.

### 15.1 The template's ASSISTANT side round-trips correctly, which narrows § 2's open limit

§ 2 recorded, as a limit rather than a gloss, that *"exactly which part of Ollama 0.34.3's
handling of `aya-expanse:8b` produced that split — the model's chat template, Ollama's tool-call
parser, or the two disagreeing — cannot be determined from committed bytes."* The captured
template narrows that, and it is worth being precise about how far.

The template's own rendering of a **previous** assistant tool call is:

```gotemplate
Action: ```json
[
{{- range .ToolCalls }}
    {
        "tool_name": "{{ .Function.Name }}",
        "parameters": {{ .Function.Arguments }}
    }
{{- end }}
]```
```

**So the template maps `tool_name` ← `Function.Name` and `parameters` ← `Function.Arguments`.**
That is the correct correspondence, and it is Ollama's own stated intent for this model: the
write direction is right. The recorded defect is in the **read** direction — Ollama found the name
correctly all 36 times and handed us the **entire object** as `function.arguments` instead of the
value under `parameters`.

**What that settles and what it does not.** It settles that the **template is not the cause of
the mismapping**: a template that writes the pair correctly cannot be what reads it back wrongly,
and the wrapper shape the model emitted is exactly what § 15 point 2 instructed. So the remaining
candidate is **Ollama 0.34.3's tool-call parser for this model**, and § 2's three-way uncertainty
collapses to one. It does **not** settle the parser's internals, which are not in this repository
and not in the captured evidence. § 4's normalization keys off the shape of the value and is
correct either way, exactly as § 2 said.

## 16. (c) Does that explain the remaining aya defects? Defect by defect

**Mostly yes, and the ones it explains were recorded in § 11.1 as findings about the MODEL.**
Each row states what the template accounts for and what it does not.

| # | Defect | Recorded at | Does the template explain it? |
|--:|---|---|---|
| 1 | **`record_call_outcome.outcome` free text, 7 of 7** | § 6 defect 1 | **YES, FULLY.** The `enum` is dropped (§ 14.1) and the surviving description asks the model to *describe* what happened (§ 14.2). Five of seven answers are accurate prose responses to the only instruction present; two are the right value in the wrong case. **This is a finding about the template.** |
| 2 | **`transfer_to_human.urgency` free text, 3 of 5** | § 6 defect 2 | **YES, FULLY.** The `enum` is dropped and the description names only `URGENT`. `NOT_URGENT` is a constructed complement; `ROUTINE` is not guessable from what the model was shown (§ 14.3). **A finding about the template.** |
| 3 | **`schedule_meeting` with no `contact_id` at all** | § 6 defect 3 | **PARTLY.** `required` is dropped, so nothing in the tool definition marks `contact_id` as mandatory — required and optional parameters render identically. But the **system prompt** did say *"Use exactly this id in every tool call; never any other"*, so one of two channels carried the requirement and the model missed it. One call of forty-four. **Template contributes; not wholly excused.** |
| 4 | **`call_id: ""` on all 7 calls** | § 6 defect 1 | **PARTLY, AND THIS ONE LEANS TOWARD THE MODEL.** `minLength: 1` is dropped, so nothing said an empty string was illegal. But the description the model DID receive says, in plain words, *"Omit it otherwise."* The model was told what to do and did something else. **A finding about the model.** |
| 5 | **Action lists spoken to the contact, 11 turns (5 invisible)** | § 8 | **YES, FULLY.** The template instructs *"Write 'Action:' followed by a json-formatted list"* as **text**, on every user turn (§ 15). The model wrote an action list into its assistant text because a standing instruction in its context window told it to, five times over. **A finding about the template**, and § 8's span rule is the right defence precisely because it is shape-based and helps any model whose template does this. |
| 6 | **The `{tool_name, parameters}` wrapper on all 36 native calls** | § 2–5 | **THE SHAPE, YES; THE MISMAPPING, NO.** The wrapper is literal text in the prompt on every turn (§ 15 point 2), so the model emitting it is obedience, not malfunction. The failure to read `parameters` back out is Ollama's parser, and § 15.1 narrows § 2's three candidates to that one. |
| 7 | **All 6 malformed calls were `directly-answer`** | § 8.1 | **YES, FULLY.** The template instructs the model to call `directly-answer` on every user turn, and it is not one of the nine tools. § 8.1 said the 12.0% malformed rate *"measures how often aya reached for Cohere's no-op sentinel"*; more precisely, **it measures how often aya obeyed its own template**. Refusing the calls was still correct. **A finding about the template.** |

### 16.1 What the template does NOT explain, stated so the correction is not overdrawn

The template is not a universal excuse, and three of aya's defects survive it intact:

- **The fabricated timestamps — all of them.** The template injects no date (§ 9.3) and says
  nothing about time formats. The two recorded gate failures are prompt-caused (§ 9.1a, § 9.1b)
  and the **six newly-visible ISO instants of § 7 are date arithmetic**, which nothing in the
  template invites. § 7's `8/65, 12.3%` stands, and § 9.2's change is not expected to take it to
  zero.
- **`resumed-session` t3's hallucinated id**, `contact_id: "cmujjjj... (contact id from
  context)"` — a parenthetical instruction copied into an argument value. `contact_id` is a plain
  string with a plain description; both reached the model intact.
- **Tool selection, which was never the problem.** The template passes names and descriptions
  correctly, and aya's `toolSelectionAccuracy` is **78.1%** — third of five. See § 17.2, because
  that dissociation is the strongest single piece of evidence in this document.

## 17. (d) The control: how `qwen2.5:7b-instruct` renders the same tools

This is the comparison that separates *"this model is bad at tools"* from *"this model was never
shown the schema"*. `qwen2.5:7b-instruct` is the configured default, it ran on the same host, the
same Ollama 0.34.3 and the same nine tool definitions, and its captured template does something
categorically different.

```gotemplate
# Tools

You may call one or more functions to assist with the user query.

You are provided with function signatures within <tools></tools> XML tags:
<tools>
{{- range .Tools }}
{"type": "function", "function": {{ .Function }}}
{{- end }}
</tools>
```

**`{{ .Function }}` prints the WHOLE function object as JSON** — Ollama marshals a
`ToolFunction` to JSON when a template prints it — so qwen receives `name`, `description` and
`parameters` **with the complete JSON Schema inside it**: every `enum`, the `required` array,
nested `properties`, `items`, `minLength`, `minimum`, every one of the constraints § 14.1 records
as dropped for aya.

| | `aya-expanse:8b` | `qwen2.5:7b-instruct` |
|---|---|---|
| Tool definitions rendered as | Python `def` stub | JSON, `{{ .Function }}` |
| `enum` reaches the model | **NO** | **YES** |
| `required` reaches the model | **NO** | **YES** |
| Nested objects / array `items` | **NO** | **YES** |
| `minLength` / `minimum` / `format` | **NO** | **YES** |
| Tool call emitted as | `Action:` + JSON array **in assistant text** | `<tool_call>{"name":…,"arguments":…}</tool_call>` |
| Argument envelope | `{tool_name, parameters}` — **a wrapper** | `{name, arguments}` — **flat** |
| Tool results delivered as | a SYSTEM turn, `console_output:` | a USER turn, `<tool_response>` |
| Per-turn instruction to write an action list | **YES, after every user turn** | **NO** |
| Instruction to call a non-existent tool | **YES** — `directly-answer` | **NO** |

### 17.1 Why the wrapper was never a qwen problem

qwen's own template emits `{"name": …, "arguments": …}` — the OpenAI envelope, flat, which
Ollama's parser reads correctly. So the two halves of aya's wrapper defect are both absent for
qwen: it is never instructed to produce a `{tool_name, parameters}` object, and there is no
second key for a parser to mismap. The wrapper was never evidence that aya is worse at JSON; it
was evidence that aya was given a different protocol.

### 17.2 The dissociation, which is the finding

The recorded numbers from `eval-output-fair-20260927/results.json`, unmodified:

| Model | `toolSelectionAccuracy` | `argumentValidity` | malformed | recovered |
|---|---:|---:|---:|---:|
| `hermes3:8b` | 95.4% <sub>n=54</sub> | 90.0% <sub>n=30</sub> | 0 | 0 |
| `qwen2.5:7b-instruct` | 88.0% <sub>n=54</sub> | 100% <sub>n=8</sub> | 0 | 0 |
| **`aya-expanse:8b`** | **78.1%** <sub>n=54</sub> | **14.6%** <sub>n=41</sub> | **6** | **8** |
| `llama3.1:8b-instruct-q4_K_M` | 76.5% <sub>n=54</sub> | 87.3% <sub>n=65</sub> | 0 | 0 |
| `mistral:7b-instruct` | 75.9% <sub>n=54</sub> | — <sub>n=0</sub> | 0 | 0 |

**Read the two middle columns against § 14.1.** Choosing the right tool needs the tool's **name
and description** — both of which the aya template passes through intact. Producing valid
arguments needs **`enum`, `required` and nested structure** — every one of which the aya template
drops. The template therefore predicts a very specific, falsifiable signature: **normal tool
selection, collapsed argument validity.**

That is exactly what the recorded data shows. aya's tool selection is **78.1%, third of five and
within two points of llama3.1** — an unremarkable mid-pack result. Its argument validity is
**14.6%, lower than the next-worst scoring model by a factor of six.** aya is also the **only**
model in the set with any malformed calls and the **only** one with any recovered-from-text calls
— and § 8.1 and § 16 row 7 now attribute both to its template.

**A model that were simply "bad at tools" would be bad at both columns.** aya is ordinary at the
column its template serves and catastrophic at the column its template destroys. The dissociation
tracks the template, not the model.

### 17.3 The honest limits of this control

- **It is one control, not an experiment.** qwen2.5 differs from aya in weights, training data and
  template at once. The comparison shows the template is *sufficient* to explain the argument
  collapse; it does not prove nothing else contributes. **§ 18's corrected-template tag is the
  experiment that would isolate it, and it has not been run** — by anyone, including this task.
- **`llama3.1` and `hermes3` templates were not captured**, so their strong argument validity
  cannot be attributed to schema rendering here. Only qwen2.5's was captured.
- **qwen2.5's `argumentValidity` n is 8**, against aya's 41. It made far fewer tool calls, so
  100% is a weaker measurement than the number looks. It is cited as the template control, not as
  a ranking.
- **Nothing above re-measures anything.** No model was run. Every number is read from committed
  evidence and every template claim is read from the captured files.

## 18. The runtime remedy, the harness change, and § 10's two requests

### 18.1 A clean, narrow remedy exists, and it is shipped as a file — not as a model

`src/eval/models/modelfiles/aya-expanse-8b-schema-tools.Modelfile` is stock `aya-expanse:8b`
with the one defect of § 14 corrected: the `## Available Tools` block renders
`{"type": "function", "function": {{ .Function }}}` — the complete schema — instead of the lossy
Python stub. Cohere's protocol is otherwise kept verbatim: same special tokens, same safety and
system preambles, same `Action:` shape, same `<results>` framing, because the model is trained on
it and rewriting it would trade a known defect for an unknown one.

**NOTHING IN THIS REPOSITORY CREATES, PULLS OR RUNS IT.** The file ships with the operator's
command in it and says so in its own header. The tag is
**`m2b/aya-expanse-schema-tools:v1`** — namespaced, versioned and obviously project-owned — and
`FROM aya-expanse:8b` **reads** the stock manifest while `ollama create` **writes a new one**, so
the stock tag is never modified and stays a candidate in its own right. `EVAL_HARNESS.md` § 9.8 is
the operator's instructions.

**Why this is a clean remedy and not a bypass.** It changes only what the model is **told**. It
relaxes no `.strict()`, coerces no argument value, and special-cases no conversational wording.
Every argument the new tag produces meets the same strict Zod schemas, the same nine dispatch
checks and the same fabricated-timestamp gate as any other model's. If the remedy had required
loosening `.strict()` or mapping `"voicemail"` onto `VOICEMAIL`, it would not have been clean and
it would not have been shipped — § 11 item 1's reasoning is unchanged on that point.

**The one thing the file cannot prove without running a model.** That `{{ .Function }}` renders as
JSON is evidenced rather than assumed: it is exactly what the stock `qwen2.5:7b-instruct` template
does on this same host and this same Ollama 0.34.3, and that model's tool calls work. But
"evidenced by a sibling template" is not "verified on this tag", and this task could not verify it.
`EVAL_HARNESS.md` § 9.8 therefore opens with a **one-command check** that costs no benchmark time
and fails loudly if the assumption is wrong.

**A second deviation, declared because it confounds the experiment.** The file also drops the
stock instruction to call `directly-answer` (§ 15 point 4, § 16 row 7), replacing it with the same
intent expressed without naming an unoffered tool. That is a second variable. It is included
because leaving it in guarantees the operator's run reproduces six malformed sentinel calls whose
cause is already understood, and the Modelfile states how to isolate the two if that trade is
unwanted.

### 18.2 The harness change: a locally-created tag is not a missing download

`eval:pull` would have tried to **download** a tag that exists in no registry, and `eval:run` and
`eval:models` would have told the operator to *"run `npm run eval:pull`"* — advice that can never
succeed. Minimum change, built on what already existed (`--model`/`-m` repeated, `EVAL_OUT_DIR`,
`CANDIDATES` with a rationale per entry):

| File | Change |
|---|---|
| `src/eval/models/candidates.ts` | `Candidate.origin?: 'registry' \| 'local'` and `localProvenance` (Modelfile path, base tag, one-line deviation). Helpers `isLocalOrigin`, `findCandidate`, `defaultBenchmarkTags()`. The new tag is **appended**, so no existing row or table order moves. |
| `src/eval/cli/pull.ts` | A local tag is **never pulled** — reported with its `ollama create` line and skipped. Not counted as a failure: it is opt-in. |
| `src/eval/cli/run.ts` | Default model list is `defaultBenchmarkTags()` — **registry only**, so a host that never created the tag is unaffected. A missing local tag gets the `ollama create` instruction instead of pull advice. |
| `src/eval/cli/models.ts` | Records `localOrigin` provenance into `models.json`. An absent local tag is reported and **does not** fail the inventory; an absent registry model still does. |
| `src/eval/types.ts` | `ModelInventoryEntry.localOrigin?` — optional and additive, so every `models.json` already committed stays valid against the type. |

**The local tag is OPT-IN, and that is the load-bearing property.** It runs only when named with
`--model`. `tests/eval/localOriginCandidates.test.ts` pins it: 20 tests covering the default list
being unchanged, the tag being excluded from it, stock aya remaining a candidate in its own right,
the Modelfile's `FROM`, its full-schema rendering, the absence of the Python stub from the active
template, and the absence of any `PARAMETER`/`SYSTEM` override.

### 18.3 § 10's two requests, both actioned

**Request 1 — render the provider's `refusals` per turn.** Done, and it needed one additive field
first. The refusal reasons existed only inside `src/llm/ollama/mapping.ts` and
`LocalLlmProvider` **deliberately strips** the top-level `refusals` key with the comment
*"a diagnostic channel for the CLIs, not part of the port"*. Rather than reverse that decision,
the reasons now travel inside `metrics.toolCallHealth` — where every other per-turn diagnostic
already lives — as an **optional** `refusalReasons`. `src/eval/runner/transcript.ts` renders them
under each turn. Nothing branches on it.

**This touched two files outside this task's declared ownership**, `src/ports/llm.ts` and
`src/llm/ollama/mapping.ts`, and it is named here rather than left to be discovered. Both changes
are purely additive optional fields; neither is in any sibling task's NOT-YOURS list; every
existing producer (`ScriptedLlmProvider`, `OpenAiLlmProvider`, `mappingSelfCheck`'s fixtures)
compiles untouched, and a turn that refused nothing produces byte-identical metrics to before.

**Request 2 — the 400-character truncation that cost § 5.1 two determinate answers.** The limit is
now `ARGUMENTS_RENDER_LIMIT = 4_000`, chosen against the widest arguments object
`TOOL_DEFINITIONS` can legally produce (`update_qualification` with 20 rubric observations
carrying the contact's own words), not picked for looking round. A pathological generation is still
bounded — a model that emits 200 kB of JSON must not put 200 kB on one line of committed evidence.

**This does not recover § 5.1's two rows and does not pretend to.** `not-decision-maker` t1 and
`price-objection-interrupt` t3 lost their `urgency` values **at render time in a run that has
already happened**; no re-render can bring back bytes that were never written. They stay
**INDETERMINATE**, and § 5.1's reasoning that both probably fail stays a likelihood rather than a
fact. What this buys is that **the operator's next run records them.**

**Nothing was written into `eval-output/` or `eval-output-fair-20260927/`.** Both remain
byte-identical to each other and to their committed state;
`tests/eval/evidenceCompatibility.test.ts` and `tests/eval/rebenchmarkReadiness.test.ts` assert it
and both pass.

## 19. Validation — Mission 2D-R

Run sequentially on this tree, heavy commands one at a time. **No model was called, pulled or
created**, including `m2b/aya-expanse-schema-tools:v1`.

| # | Command | Result | Baseline before this mission | Delta |
|--:|---|---|---|---|
| 1 | `npm run typecheck` | **exit 0**, no errors | exit 0 | — |
| 2 | `npm run build` | **exit 0** | exit 0 | — |
| 3 | `npm run test` | **1,424 passed / 2 skipped** across **63 passed / 1 skipped (64)** files, exit 0, 322.44s | 1,403 passed / 2 skipped across 62 passed / 1 skipped (63) files | **+21 tests, +1 file — exactly `tests/eval/localOriginCandidates.test.ts` and its 21 tests.** No pre-existing test failed. |
| 4 | `npm run qa:sweep` | **983 scenarios, 8,086 applicable checks (17,098 evaluated), 0 violations, 0 network attempts**, INV-18 **2,094/2,094**, RESULT: PASS | 983 / 0 violations / 0 network / INV-18 2,094/2,094 | **identical** |
| 5 | `npm run qa:sweep -- --determinism` | 983 / 8,086 (17,098) / **0 violations** / **0 network attempts**, **INV-09: PASS — a second full run produced byte-identical classifications for every scenario id**, RESULT: PASS | same | **identical** |
| 6 | `npm run check:anti-scripting` | RESULT: **PASS**, exit 0. 39 files, 2,356 string literals, **1 allowance** (the pre-existing `clauses.ts`:115, printed with its reason), non-vacuity self-test 6 known-bad + 7 known-good, all five rules fired | PASS, 1 allowance | **no new allowance** |
| 7 | `npm run context:prove` | RESULT: **PASS — 9/9 proofs** | 9/9 | **identical** |
| 8 | Hebrew scheduling parity: `localeParity`, `hebrewGrammar`, `localeLexicon`, `localeRefusalBreadth`, `scriptNormalization`, `tests/e2e/hebrewDigitClockTime` | **6 files passed, 294 tests passed**, exit 0 | unchanged | **identical** |
| 9 | Claim-gate adversarial: `tests/claimGate/**`, `tests/agent/claimGate*.test.ts`, `tests/e2e/claimGate*.test.ts` | **8 files passed, 181 tests passed**, exit 0 | unchanged | **identical — the § 9.2 prompt change is upstream of the turn loop and disturbed none of it** |

**The +21 is one new file and nothing else.** `tests/eval/localOriginCandidates.test.ts` — the
local-tag distinction, the Modelfile's contents, and § 18.3's two rendering changes.

### 19.1 Tests deliberately changed, named — the Founder asked for this by name

Four assertions in three files. **Nothing was disabled, skipped or deleted.**

| Test | Change | Why |
|---|---|---|
| `tests/agent/prompt.test.ts`:187 | `'Wednesday 4 March 2026 at 10:00'` → `'Wednesday 4 March at 10:00'`, **plus a new `not.toContain('2026')`** | It asserted the old disclosure and would otherwise assert a prompt this system no longer sends. The added negative makes restoring the year fail here rather than only in a benchmark. |
| `tests/agent/openAiLive.test.ts`:64, :118 | Two hand-written turn-context stand-ins, year dropped | Same reason. This file is `describe.skip` without `OPENAI_API_KEY` — it is the suite's one skipped file — so this is not what keeps the run green; it is so a live run tests the shipping prompt. |
| `tests/llm/ollamaAyaToolShape.test.ts`:450 | `toolCallHealth` equality now includes `refusalReasons: ['names "directly-answer", which was not offered this turn']` | **A mechanical consequence of § 18.3**, named here as the brief requires. The assertion is `toEqual` on the whole object, so the additive field broke it. It was **tightened rather than loosened** — the same string the next line already asserts on the CLI channel, so the two cannot drift. The other two `toolCallHealth` equalities in that file (`malformed: 0`) were untouched and still pass, which is the proof that the field is omitted when empty and a clean turn's metrics are byte-identical to before. |

**No test in a file this task does not own needed changing.** `tests/claimGate/**`,
`tests/agent/claimGate*.test.ts`, `tests/invariants/**`, `tests/e2e/**` and `tests/qa/**` all pass
untouched — the claim-gate corpus asserts on its own hand-written utterances, never on
`describeLocal`'s output — so no cross-task dependency was raised and none needed to be.

### 19.2 What was NOT run, and why

No `eval:pull`, no `eval:run`, no `eval:report`, no `eval:models`, no `demo:local`, no
`llm:probe`, no `llm:smoke`, no `POST /api/chat`, no `ollama` command of any kind. **The tag
`m2b/aya-expanse-schema-tools:v1` was not created and has never been run by anybody.** Every
number above is from a pure command; every template claim is read from the operator's captured
files; every claim about aya's recorded behaviour is read from
`eval-output-fair-20260927/`, which was not modified.

**Nothing was written into `eval-output/` or `eval-output-fair-20260927/`.**
`tests/eval/evidenceCompatibility.test.ts` (9 tests) and
`tests/eval/rebenchmarkReadiness.test.ts` (20 tests) assert both directories are byte-identical
and untouched; both pass.

## 20. Files changed — Mission 2D-R

| File | Change |
|---|---|
| `src/agent/prompt/turnContext.ts` | Year dropped from the disclosed `contactLocalNow`. § 9.2 |
| `src/agent/tools/handlers.ts` | Year dropped from `describeLocal` — the tool-result form. § 9.1a |
| `src/conversation/contextAssembler.ts` | Year dropped from `describeLocal` — the assembled-context form, and the site the evidence ran on. § 9.1b |
| `src/eval/models/modelfiles/aya-expanse-8b-schema-tools.Modelfile` | **new.** Stock aya with the template corrected to render the full tool JSON Schema. Carries its own operator instructions and states that nothing in the repo creates it. § 18.1 |
| `src/eval/models/candidates.ts` | `origin`/`localProvenance`, `isLocalOrigin`, `findCandidate`, `defaultBenchmarkTags()`; the new tag appended as opt-in. § 18.2 |
| `src/eval/cli/pull.ts` | A local tag is never pulled; reported with its `ollama create` line, not counted as a failure. § 18.2 |
| `src/eval/cli/run.ts` | Default list is registry-only; a missing local tag gets create instructions, not pull advice. § 18.2 |
| `src/eval/cli/models.ts` | Records `localOrigin` into `models.json`; an absent local tag no longer fails the inventory. § 18.2 |
| `src/eval/types.ts` | **additive only**: optional `ModelInventoryEntry.localOrigin`. |
| `src/eval/runner/transcript.ts` | Renders the provider's refusal reasons per turn; `ARGUMENTS_RENDER_LIMIT` 400 → 4,000. § 18.3 |
| `src/eval/runner/metricsCapturingProvider.ts` | Concatenates `refusalReasons` across a turn's provider calls, in the same order the counts are summed. § 18.3 |
| `src/ports/llm.ts` | **additive only**, and OUTSIDE this task's declared ownership — named in § 18.3: optional `LlmToolCallHealth.refusalReasons`. |
| `src/llm/ollama/mapping.ts` | **additive only**, same note: populates `refusalReasons`, omitted when empty. |
| `tests/eval/localOriginCandidates.test.ts` | **new.** 21 tests. § 18.2, § 18.3 |
| `tests/agent/prompt.test.ts`, `tests/agent/openAiLive.test.ts`, `tests/llm/ollamaAyaToolShape.test.ts` | The four changed assertions of § 19.1 |
| `docs/MISSION_2D_AYA_ROOT_CAUSE.md` | § 9.1's correction, § 9.1a, § 9.1b, § 9.2 rewritten, § 9.3 settled, § 14–§ 20 new, and the corrections carried into § 0, § 11 and § 11.1 |
| `EVAL_HARNESS.md` | § 9.7.6 gap 1 closed; § 9.8 the three-way template experiment |

**Not touched:** `eval-output/**`, `eval-output-fair-20260927/**`, `.agent/**`,
`src/agent/claimGate/**`, `tests/claimGate/**`, `tests/agent/claimGate*.test.ts`,
`tests/invariants/**`, `tests/e2e/**`, `tests/qa/**`, `docs/MISSION_2D_CLAIM_GATE.md`,
`docs/MISSION_2D_CLAIM_GATE_ASSURANCE.md`, `docs/DECISIONS.md`, `AGENT_CONTRACT.md`,
`src/agent/claimGate/**`, `src/scheduling/**`, `src/eval/rubric/**`, `prisma/schema.prisma`,
`package.json`, `package-lock.json`. **No model default changed.** Nothing merged to master.
