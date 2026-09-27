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
   is gone, **15 of the 44 calls are still refused**, on three further model defects the
   wrapper was hiding: a free-text `outcome` on **7 of 7** `record_call_outcome` calls, a
   free-text `urgency` on at least **3 of 5** `transfer_to_human` calls, and one
   `schedule_meeting` with no `contact_id` at all. §6.

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

That is not hallucination. **It is format imitation of the one absolute date in its window** —
in-context learning doing exactly what it does. And the ISO variants are the same reflex with
more arithmetic: `adversarial-guardrail` turn 1's `2026-03-04T10:30:00-05:00` is the disclosed
local now **plus thirty minutes**, with the UTC offset derived from the zone name (the prompt
discloses `America/New_York`, never `-05:00`).

### 9.2 What this task did about it, and what it did not

`src/agent/prompt/turnContext.ts` is `src/agent/**`, owned by
`MISSION-2D-...-CLAIM-GATE`. **Changed nothing there. Requested through the mailbox**, with
two options and no preference forced:

- **(a)** Drop the year from the disclosed string. `Wednesday 4 March at 10:00` is equally
  useful to the model and is not a resolvable absolute, so the exemplar stops matching the
  forbidden pattern. Cheapest, and it removes the imitation target rather than arguing with it.
- **(b)** Keep the year and add a model-facing clause beside it saying the date is context to
  reason with and must never be copied into a tool argument. Model-facing text is permitted;
  on the review's own §8.8 evidence it is also a request rather than a constraint.

**Not proposed, and worth saying so explicitly:** stop disclosing the local time (the model
needs it, and `turnContext.ts` is right to give it); relax the gate; relax the resolver;
detect-and-rewrite an absolute date in a tool argument (that would be the provider deciding
what the contact meant, which is the authority this architecture denies it).

### 9.3 Nothing in the provider or its configuration contributes

Checked, and negative. `LocalLlmProvider` has no `Date`, no clock and no timezone, and sends
no date of its own: `buildRequest` sends the messages, the tool specs and
`{temperature, num_ctx}`. `toOllamaTool` passes the generated JSON Schema through untouched,
including the `when` description that forbids conversion. The one thing that cannot be
inspected from committed bytes is whether `aya-expanse:8b`'s own Ollama template injects a
date into its preamble — Cohere's published Command-R templates conventionally do. That is the
same `ollama show --template aya-expanse:8b` check as §2, and it is the operator's to run.

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
2. **The fabricated-timestamp behaviour itself.** Located (§9), not fixed, because the fix is
   in a file another task owns and has been requested there. The gate stands untouched.
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
