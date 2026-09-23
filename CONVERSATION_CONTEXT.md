# Conversation context and memory

**Mission 2, Local AI Brain — what the model is *told*.**

This document covers the layer between the database and the model's context window:
conversational memory across turns and across sessions, and the business, product,
persona and objective facts a local 7B model needs in order to sound like a person who
works here.

It is the companion to `docs/ARCHITECTURE.md`, which covers everything the model is
allowed to *do*. The division is the point, and it is the governing rule of the whole
system:

> **The LLM reasons and converses. Application code owns truth, validation, state and
> external actions.**

Everything described here is **read-only background**. Not one byte of it reaches a
validator, a scheduling decision, a permission check or an authoritative timestamp. The
context layer is a **fact supplier**, never a dialogue manager.

---

## 0. The rule this layer is most likely to break, and what stops it

> Production and demo customer-facing dialogue must **never** be canned responses,
> scripted conversation trees, predefined question sequences, hardcoded sales scripts,
> if-X-then-say-Y conversational logic, or fixed response templates.

A memory and context layer is exactly where that rule gets broken by accident, because a
"conversation state" that decides what to say next looks so much like a legitimate
feature. Four things are in place against it, in descending order of how much they
actually help:

**1. The type has nowhere to put a script.** Read `ContextFacts` in
`src/conversation/contextAssembly.ts`. There is no `nextQuestion`, no `stage`, no `step`,
no `agenda`, no `script`, and no field anywhere that holds a sentence for the agent to
utter. A conversation state machine cannot be built from this type, because the type has
nowhere to put the state or the transitions. This is the defence that does the most work,
and it costs nothing at runtime.

**2. The business profile schema has no such field either.** `BusinessProfileSchema`
(`src/context/businessProfile.ts`) has fields for facts, limitations, prices, policies,
objectives and knowledge goals. It has no field for an opening line, a pitch, an objection
rebuttal, a closing line or a question sequence. Not "a field we leave empty" — no field,
so no profile can express one.

**3. Free text in a profile is checked for dialogue shape at load time.** Every
free-text string runs through `findDialogueShape` (`src/context/dialogueShape.ts`). A
profile containing `"Great — let me get that booked for you!"`, or an
`if they object then say this` entry, **fails to load** — here and in production, because
this is the production code path. The same filter runs over LLM-written conversation
memory on read, so a summariser cannot smuggle a canned line into tomorrow's prompt by
calling it a remembered fact. (`npm run context:prove` demonstrates exactly that, and
names the rule that caught it.)

**4. `npm run check:anti-scripting` scans the customer-facing path.** Details and — more
importantly — its limits are in § 7.

### The three places this genuinely bites, and how each was resolved

| Temptation | What was done instead |
|---|---|
| "The agent should ask about timeline next." | `openKnowledgeGoals` is a **set** of things we do not know, rendered **alphabetically** — an order chosen precisely because it is not a priority order — under a heading that says in words that it is not a queue and that leaving every one of them open is an acceptable call. |
| "Unresolved topics should be worked through in order." | `unresolved` is a set tagged with *who* left it hanging and *when*. Sorted by id for byte-determinism; the prompt says it has no order. |
| "Give the model the right words for this objection." | `topics[]` in the profile carries **facts** about a subject — real prices, real policy, real numbers. There is no `response` field, no `rebuttal` field, no `say` field. The model composes the sentence, in the register of the conversation it is actually in. |

---

## 1. The memory model

Assembled fresh from the database every turn by
`ConversationContextAssembler.assemble()` (`src/conversation/contextAssembler.ts`).
Nothing is cached between turns; `ConversationService`'s "this class holds no conversation
state in memory, none" rule extends to everything the model is told, not just to the
transcript.

| Element | Read from | Why it earns its place in a 7B context window |
|---|---|---|
| **Contact facts** | `Contact`, `Lead` | Name, timezone, **their current local time**, decision-maker status, the CRM note a colleague wrote, lead source/status. Without the local clock, "tomorrow afternoon" is meaningless and times cannot be spoken back correctly. The contact id is included because every tool call must name a subject and the alternative is a model inventing identifiers. |
| **Recent turns** | `ConversationTurn` | The live conversation. Bounded — see § 2. |
| **Rolling summary** | `Conversation.summary` | What the window can no longer hold. Without it, a long call loses its own beginning at a cliff edge; with it, returning to an earlier subject works. |
| **Durable facts** | `Conversation.summary` of *this* and *earlier* conversations, plus `Contact.notes` | The difference between recognising someone and interrogating them again. Each is **labelled by origin** (this conversation / an earlier one / the CRM record) because "we think we heard this months ago" and "a colleague typed this in" deserve different confidence, and only the model can weigh that in the moment. |
| **Previous conversation outcome** | `Conversation`, `Call`, `CallOutcome` | A returning contact greeted as a stranger is the single most obvious tell that they are talking to a machine. Deliberately **not** filtered to `COMPLETED`: a conversation that was abandoned mid-sentence is often the most important thing to remember. |
| **Qualification state** | `QualificationState` incl. parsed `factorsJson` | Band, score, whether the decision-maker cap bit, which rubric factors have evidence and which have none. The last of those is what makes "what we still do not know" real rather than a guess. |
| **Open knowledge goals** | profile × `QualificationState` | Gaps in what we have **recorded**. A goal closes when the *persisted* row has evidence for its rubric factor — not when the model believes it covered something. |
| **Loose ends** | rolling summaries (this + earlier) **and** failed tool calls | Two independent sources. The second needs no model at all: a tool call that came back refused with no later success of the same tool is an outstanding thing *by construction*. It is what stops the agent cheerfully moving on from a booking that was rejected thirty seconds ago. |
| **Commitments** | `FutureAction`, `Meeting` | Promises the **system** has already persisted. They will happen whether or not this call goes well, so contradicting one is a failure the contact can verify. Overdue-but-unrun callbacks are included deliberately: the promise was made and the runner will get to it. |
| **Business facts** | the loaded `BusinessProfile` | § 6. |

### Cross-session continuity

A first-class requirement, not a nice-to-have, and proved rather than asserted
(`npm run context:prove`, proof 5). A second conversation for the same contact sees:

- the previous conversation's **status** and its **`CallOutcome`** with notes;
- every **durable fact** the earlier conversation recorded, labelled `EARLIER_CONVERSATION`;
- every **loose end** the earlier conversation left, labelled as being from an earlier
  conversation so the model can raise it as such;
- any **commitment** still outstanding across both.

The proof checks all of it is in the **rendered prompt**, not merely in the object — the
difference between a feature and a feature that reaches the model.

### The memory envelope, and legacy rows

`prisma/schema.prisma` is frozen for this mission, so memory rides inside the existing
nullable `Conversation.summary` column as a versioned, Zod-validated JSON envelope
(`src/conversation/conversationMemory.ts`):

```json
{ "kind": "schedule-ai-voice/conversation-memory", "v": 1,
  "narrative": "...", "durableFacts": [...], "unresolvedTopics": [...],
  "coveredThroughTurnIndex": 31, "generatedBy": "...", "generatedAtUtc": "..." }
```

**Baseline V1 rows contain a plain string, and that is the normal case, not the edge
case.** `readConversationMemory` never throws and never returns null for something it
cannot parse:

| Stored value | Result |
|---|---|
| a valid envelope | parsed, `source: 'ENVELOPE'` |
| plain prose (Baseline V1) | `{ narrative: <the string> }`, `source: 'LEGACY_PLAIN_TEXT'` |
| broken JSON, or a foreign envelope | the raw string as narrative, `source: 'UNREADABLE'` |
| `null` / blank | empty memory, `source: 'ABSENT'` |

A conversation whose memory cannot be read is a worse conversation. A conversation whose
memory *throws* is a dropped call. Those are not close.

---

## 2. How unbounded transcript growth was avoided

`messagesFromTurns` has always defaulted to **no** truncation, and its comment explains
why that was right for Baseline V1: truncation loses history, and the slice's
conversations were short. Both halves stop holding the moment a model with a fixed
`num_ctx` is on the other end of the port. An unbounded transcript against a fixed window
does not degrade — it **overflows**, and what falls out is chosen by whatever the runtime
does when it runs out of room, which is usually "silently drop the oldest messages" and
occasionally "drop the system prompt". Losing the guardrails to make room for small talk
is the worst available failure, and it is the *default* one.

Three mechanisms, in the order they apply:

**A bounded window** (`selectRecentTurns`, `src/conversation/contextWindow.ts`). The most
recent turns that fit, bounded by both a turn count and a character budget. Not
`slice(-n)`: a tool-calling transcript has *pairs* in it, and a blind cut can leave a
`tool` result message whose assistant call fell outside the window — which OpenAI-style
APIs and llama.cpp chat templates both reject, presenting as a dropped call rather than as
a truncation bug. The front edge is repaired. `npm run context:prove` sweeps **every**
window size from 2 to 40 over a tool-heavy conversation and asserts zero orphans.

**A rolling summary** (`ConversationMemoryWriter`), so what leaves the window is compacted
rather than lost. See § 3.

**A budget ladder** (`fitToBudget`), for the facts block. Render, measure, shed the next
named thing, repeat. The **order is a product decision written down as code** — the
marketing surface first, then product depth, then the policy list, then pricing in three
separate rungs so the discount policy can go without taking the actual numbers with it,
then the profile down to identity and objective, then — and only then — the memory of this
particular person. The authority list ("this agent cannot change a price…") is the very
last thing sacrificed, because it is the only entry that *stops* a promise rather than
improving one.

A cheaper implementation would trim whichever section is longest. On a rich profile that
means discarding the fact that we spoke to this person three weeks ago in order to keep a
list of integrations, and nobody would notice until a customer did.

Every applied rung is named in `AssembledContext.reductionsApplied` and recorded on the
turn's `AGENT_TURN_STARTED` audit event. **No silent truncation:** if the ladder runs out
(a budget below the irreducible core), the text is cut, `hardTruncated` is `true`, and the
disclosure metadata says so.

### Why characters and not tokens

Because this layer **may not** import a tokenizer, and that is architecture, not laziness:
`tests/invariants/vendorBoundary.test.ts` asserts that no file under `src/conversation`
imports a vendor SDK or HTTP client, and every accurate tokenizer for a given model is one.
A tokenizer would also be model-specific, so it would be wrong for whichever model the
deployment actually loaded.

Characters are what this layer can count exactly. `charsPerToken` is set at a pessimistic
**4** (the true figure for most BPE vocabularies on English prose is nearer 4.5), so the
estimate errs towards leaving room. The direction of the error is the point: an
over-cautious budget costs a little context, an over-confident one costs the system prompt.

---

## 3. The rolling summary

`ConversationMemoryWriter` (`src/conversation/conversationMemoryWriter.ts`) is the **only**
part of this subsystem that talks to a model.

**Using an LLM here is not scripting.** The Founder directive forbids scripted
*customer-facing* dialogue. A recap of a conversation, written for another model to read
and never spoken to anybody, is internal machinery — the same category as an audit summary.
The guardrail clause `MEMORY_IS_BACKGROUND_NOT_TRUTH` tells the model exactly what it is
reading.

**It runs after the turn, not during it**, for three reasons in order of weight:

1. **It must never cost a caller a pause.** Compaction is a second provider round trip; on
   a local 7B that is seconds, and doing it between a person finishing a sentence and the
   agent replying would be audible.
2. **It must never break a turn.** `refresh()` does not throw. Ever. It returns a status.
   Every failure — provider down, prose instead of JSON, a document that fails validation —
   resolves to "the memory is not refreshed this time".
3. **It keeps assembly deterministic.** Because the summary is *written* here and merely
   *read* by the assembler, context assembly stays a pure function of the database, and
   "byte-identical across two runs" is testable.

**Atomicity, and a deliberate divergence.** `docs/ARCHITECTURE.md` § 8 sets the rule that
audit writes never fail silently. This file swallows its errors, so it earns that by making
the two writes **atomic**: the summary row and the audit events explaining it go through one
`withTransaction`, so a failed audit write rolls the summary back with it. The state after a
swallowed error is always "nothing was written and nothing was claimed" — the property that
rule exists to protect, reached by a different route.

**It is bounded.** `MEMORY_LIMITS`: narrative ≤ 1,200 chars, ≤ 12 durable facts of ≤ 220
chars, ≤ 8 loose ends. An unbounded "memory" is how a context window quietly stops fitting.

**It is optional.** Without a writer, the window still bounds the transcript and the
background still carries contact facts, continuity and commitments — there is simply no
recap of the part that scrolled off.

`npm run context:prove` covers: a successful round trip with id slugification and length
clamping; `NOT_DUE` when nothing new has happened; a scripted line being dropped and
*reported*; and five distinct failure modes (provider throws, prose, empty, broken JSON,
wrong shape) each leaving the database untouched and the next turn able to assemble.

---

## 4. What a turn actually costs

Run `npm run context:render --sizes`. Today, for the local-brain composition with all nine
tools:

```
  system prompt (sales-scheduler-local@v2)   10130 chars  ~  2533 tok
  tool schemas (9 tools)............         11256 chars  ~  2814 tok
    = fixed overhead................         21386 chars  ~  5347 tok
  reserved for the reply............          2048 chars  ~   512 tok
  assembled background (actual).....         11575 chars  ~  2894 tok
    its budget......................         12000 chars  ~  3000 tok
  transcript window (actual)........           414 chars  ~   104 tok
    its budget......................         30102 chars  ~  7526 tok
  TOTAL USED........................         33375 chars  ~  8344 tok
  CEILING (num_ctx 16384)...........         65536 chars  ~ 16384 tok
```

**The important number is the fixed overhead: ~5,350 tokens before a single word of
conversation.** At `num_ctx` 8192 that is 65% of the entire window, and the ladder has to
strip the whole business profile — pricing included — to fit. An agent that cannot answer
"what does this actually cost?" is not a demo.

`DEFAULT_CONTEXT_BUDGET.modelNumCtx` is therefore **16384**, set as a *measured minimum*
rather than a preference. 16k is unremarkable for the 7B/8B models this mission targets:
Qwen2.5 and Llama 3.1 both support far more natively, and it is **Ollama's 2048 default**,
not the model, that is the real constraint. Raising it costs KV cache and nothing else.

Everything still works at 8192 — all nine proofs pass there — it just produces a visibly
worse conversation. If a deployment genuinely cannot afford 16k, the better lever is
**fewer tools**: nine tool schemas are 2,814 tokens, and narrowing
`AgentConfiguration.allowedToolsJson` is already supported end to end. That is a product
decision, flagged rather than taken.

This was sent to `MISSION-2-LOCAL-BRAIN-AUTO-PROVIDER` with the measurements, since
`num_ctx` is their configuration to set. `modelNumCtx` is one field of one object and
changing it changes nothing else.

The **irreducible core** — what survives every rung of the ladder — measures **3,275
characters**: the anti-scripting frame, who this is, their clock, the time discipline,
whatever memory fitted, and the objective. `minFactsChars` is set at 3,400, and
`npm run context:prove` asserts the ladder reaches a fitting context at exactly that floor.
If the core ever grows past it, that proof fails rather than a caller silently receiving
cut text.

---

## 5. Why there is no vector store

**Because the retrieval problem this scope has is not the problem embeddings solve.** No
RAG layer was built, and the evidence says one is not needed here:

- **The corpus is one contact's own history.** Tens of turns and a handful of previous
  conversations — not millions of documents. The measurements above show the *whole* rich
  business profile is 15,140 characters and the entire relevant history of a returning
  contact fits in a few thousand more. Embedding a corpus that fits in the window is
  paying retrieval cost to solve a problem that does not exist.
- **The selection criteria are structural, not semantic.** What belongs in a turn is: this
  contact, this conversation, the most recent turns, the previous outcome, the open
  promises, the unmet knowledge goals. Every one of those is an indexed database query
  returning the exact right rows. Nearest-neighbour search would be a fuzzy, non-deterministic
  approximation of a lookup that is already exact.
- **Determinism is a hard requirement here, and ANN search is not deterministic across
  index rebuilds.** `npm run context:prove` asserts byte-identical context for a fixed
  database and a fixed clock, which is what makes an audit replay a real replay. That
  property is worth more to this system than fuzzy recall.
- **It would need a network or a native dependency.** An embedding model means either an
  HTTP call or a vendor SDK, and `tests/invariants/vendorBoundary.test.ts` forbids both
  anywhere under `src/conversation`. Working around that invariant to add a feature nothing
  has asked for would be the wrong trade twice over.

**What would change the answer**, stated so it is a position rather than a prejudice:

1. A single conversation routinely exceeding a few hundred turns, where the rolling summary
   starts losing things a contact demonstrably expected to be remembered.
2. A *knowledge base* — many documents of product/policy material, too large for any
   window — as opposed to today's single curated profile. This is the likeliest trigger,
   and it is a retrieval problem over documents, not over conversation memory.
3. Cross-*contact* retrieval ("what did we tell other HVAC contractors about QuickBooks"),
   which is a genuinely semantic query with no structural equivalent.

The first two of those would be visible in `AssembledContext.reductionsApplied` and in the
rolling summary's behaviour long before a customer noticed, which is the signal to watch.

---

## 6. The business context

`src/context/` supplies company, product, pricing, policy, persona and objective
information as **structured facts and goals**.

### Changing the business profile without touching code

The profile is a **JSON document**, not TypeScript, and this is the point: a business's
facts change far more often than its software does, and the person who knows the correct
price is rarely the person who can edit a `.ts` file.

1. Copy `src/context/profiles/default.json` somewhere.
2. Edit it. Prices, plans, policies, limitations, objectives, persona — all data.
3. Point at it: `loadBusinessProfile({ profilePath: '/path/to/profile.json' })`.

It **replaces** the default rather than merging with it, deliberately. A deep merge of
business facts produces a document nobody wrote — half this quarter's pricing and half last
quarter's, with no way to tell by reading either file. A profile is a whole statement of
what is true, or it is nothing.

Validation is strict and loud. `.strict()` throughout, so a typo'd key is a refusal rather
than a fact that silently never reaches the model; and `ConfigurationError` rather than a
fallback to the default, because an agent quietly reverting to last quarter's prices
misleads a customer while an agent that will not start merely wakes an engineer.

Lint a profile before deploying it with `npm run check:anti-scripting`, which loads every
`src/context/profiles/*.json` through the production schema.

### The schema, in one table

| Section | Holds | Note |
|---|---|---|
| `company` | what we are, what we do, proof points, operating regions | |
| `persona` | agent name, role, **voice traits**, what a contact is entitled to hear, what is out of scope | Voice traits constrain *delivery* without supplying a single word — legitimate persona, not a script |
| `products[]` | summary, best-for, capabilities, **limitations**, integrations | Limitations are the most useful facts in the document and the last product detail the ladder trims |
| `pricing` | currency, plans with real headline prices, discount **facts**, `agentMayNotCommit` | `agentMayNotCommit` duplicates no enforcement — `allowedToolsJson` and the nine-tool contract do that — it just saves a cooperative model from discovering the limit by being refused |
| `policies[]` | topic + fact | Trial, contract term, migration, support, security, opt-out |
| `topics[]` | a subject a contact may raise + **facts** about it | The closest thing to objection handling, and the difference is that there is no `response` field |
| `objectives` | primary, supporting, `knowledgeGoals[]`, acceptable outcomes | A knowledge goal may name a rubric factor, which is how "still unknown" is computed from the *persisted* qualification |
| `meetingTypes[]` | what happens, who attends, duration | |

Versioned by `schemaVersion` (refused on mismatch) and identified by `profileRef`
(e.g. `northwind-dispatch@v1`), which is recorded in the turn's audit metadata — the same
discipline `systemPromptRef` already applies to the guardrails.

The committed default is a realistic profile for **Northwind Systems**, the organization
`seedSliceWorld` already creates, selling a field-service scheduling platform. It is
deliberately good enough for a live demo: real prices, real limitations, real policy, and
the sort of subjects a contractor actually raises.

### Reaching it through `get_contact_context`

When a `BusinessProfile` is wired into `ToolDependencies`, `get_contact_context` returns a
**digest** of it alongside the contact facts: who we are, headline prices, what each
product does *not* do, the policy list, and what the agent may not commit to.

A digest rather than the whole document, because the full profile is already in the turn's
background and repeating it would double its cost in the scarcest resource this milestone
has. This also gives the budget ladder somewhere to fall back to: when policy facts are
shed from the window, they remain reachable on demand — which is why that tool carries a
business block at all.

`ToolDispatcherOptions extends ToolDependencies`, so wiring it is one constructor field and
`dispatcher.ts` needed no edit. Absent, the tool's output is byte-identical to Baseline V1's.

---

## 7. The anti-scripting check, and what it cannot catch

```
npm run check:anti-scripting
```

Exits non-zero on violation. Scans `src/agent/**`, `src/conversation/**`, `src/context/**`.

**Two surfaces, two kinds of rule**, because they need different tools:

- **Data** — `src/context/profiles/*.json`, checked **lexically** by loading each profile
  through `BusinessProfileSchema`. This re-runs the production code path rather than
  approximating it.
- **Code** — checked **structurally**, for the shapes a canned conversation actually takes.

| Rule | Catches |
|---|---|
| `DIALOGUE_BRANCH` | a conditional branch that returns an utterance — the directive's if-X-then-say-Y, in any spelling JavaScript offers |
| `CANNED_UTTERANCE_ASSIGNMENT` | an utterance assigned to something named like spoken output |
| `CANNED_REPLY_TABLE` | ≥2 utterances as values in one object literal, keyed by situation |
| `FIXED_QUESTION_SEQUENCE` | ≥2 written-out questions in one array |
| `SPEECH_LITERAL` | a long sentence that reads as speech, wherever it sits |
| `PROFILE_REJECTED` | a profile that fails the production schema |

**Why code is not also checked lexically:** the customer-facing path is full of text that is
*supposed* to be there. `src/agent/prompt/clauses.ts` is guardrails — instructions to the
model about how to conduct itself — and instructions about speech necessarily talk about
speech. Running the lexical rules over it would produce a wall of findings on the most
carefully reviewed file in the repository, and a check that cries wolf on its best file gets
switched off. So code is judged on what text **does**, not on what it says.

**It is proved non-vacuous on every run.** A green result that has not demonstrated the
rules can still fire is not evidence of anything, so the CLI always runs a corpus with the
answers written down: six known-bad samples (each must produce a specific rule, and every
rule must be triggered by something) and six known-good samples drawn from shapes this
codebase really contains (guardrail prose, an error-code branch, a validation message, a
business fact, summariser instructions) which must stay clean. Precision matters as much as
recall: a check that fails on real code gets turned off, which is worse than no check.

### What it cannot catch — read this before trusting it

1. **A declarative fact an author privately intends to be read out verbatim.** "Our
   onboarding takes two weeks" is a legitimate fact *and* a usable sentence, and no rule can
   tell intent apart. The defence is the rendering frame — facts arrive under an explicit
   "these are not sentences to say" heading — plus review.
2. **An utterance assembled at runtime from fragments**, where no single literal looks like
   speech.
3. **Speech inside a template-literal `${}` interpolation**, which the scanner deliberately
   does not descend into.
4. **Anything outside the three scanned directories**, or loaded from the database at
   runtime.

**(1) and (2) are the realistic ways this rule gets broken by somebody who is not trying to
break it, and neither is caught.** That is stated here, in the source, and in the CLI's own
output on every run, because a check whose limits are undocumented reads as a guarantee it
cannot give.

`src/cli/**` is **not** scanned. It contains seeded transcript text for the rendering
example — fixture data in the same category as `ScriptedLlmProvider`, which
`docs/BASELINE_V1.md` § 4 explicitly permits for deterministic tooling. No customer ever
hears it.

### The allowlist

A line-scoped comment — `anti-scripting:allow <RULE_ID> - <reason>`, after `//`, on the
offending line or the one above it. **The reason is required**: an allowance with nothing
after the rule id is itself a violation, because an exemption nobody had to justify is an
exemption nobody will review. Every allowance is printed with its reason on every run, so
the set can only grow in public.

There is currently **one**, in `clauses.ts`: a guardrail that contrasts an honest phrasing
with a dishonest one. Both quotes exist to be *compared*, and the clause cannot make its
point without exhibiting one of each.

There is also **one whole-file exemption**: `src/context/antiScriptingSelfTest.ts`, the
known-bad corpus. Its samples exist to be detected — and they are, by the same
`inspectSource` the walk uses. It escapes only the assertion that the rules find nothing.

---

## 8. Guardrail clauses added

Appended to `src/agent/prompt/clauses.ts` in its existing idiom, and carried by a **new**
composition `sales-scheduler-local@v2` — a strict superset of `sales-scheduler@v1`.
`v1` and its rendered text are untouched, because every Baseline V1 conversation has pinned
its `promptFingerprint` and a prompt change that rewrote history would make every existing
audit replay a fiction. `DEFAULT_SYSTEM_PROMPT_REF` is still `v1`; a deployment opts in by
pointing a new `AgentConfiguration` version at the new ref.

| Clause | `enforcedBy` — the real mechanism |
|---|---|
| `NEVER_FABRICATE_BUSINESS_FACTS` | Company facts reach the prompt only from a Zod-validated `BusinessProfile`; no tool can change a price or a term, so an invented one cannot become an obligation. **Stated honestly in the clause itself: nothing stops the model *saying* an invented figure — this bounds what is in the window, not what is in the sentence.** |
| `NEVER_STATE_A_TIME_YOU_WERE_NOT_GIVEN` | `SchedulingValidator` resolves every proposed time against the turn's pinned `nowUtc` and the persisted timezone; the background carries the contact's current local time and no other instant. |
| `QUOTE_THEIR_WORDS_INTO_TOOLS` | `DateTimeResolver` parses natural language directly and records `ValidationProvenance.rawProposedValue` verbatim plus `interpretation.source`, so a model that pre-converted a phrase to `ISO_INSTANT` is **visible in the audit trail of every booking it made**. |
| `RECOVER_FROM_TOOL_FAILURE` | `ToolOutcome` carries `ok=false` with a reason written to be read aloud from and a `retryable` flag; `isRetryable` marks codes a retry cannot improve; `messagesFromTurns` synthesises `NO_RECORDED_RESULT` for any call whose result never got written. |
| `MEMORY_IS_BACKGROUND_NOT_TRUTH` | Memory lives in `Conversation.summary` and is read-only background: no validator, dispatcher or scheduling path reads it, and `fromEnvelope` drops dialogue-shaped entries before they reach a prompt. |
| `NO_FIXED_FLOW` | **Honest answer: no mechanism forces this** — it is a disposition, not a rule code can check. What *is* mechanical is that the alternative cannot be built: `ContextFacts` has no field for a stage, a step or a next question, and `npm run check:anti-scripting` fails the build if dialogue-selecting branches appear. |

`NO_FIXED_FLOW` is rendered **last**, because the last thing in a prompt is what a small
model weights most heavily, and "there is no running order" is the instruction most likely
to be overridden by the habit of working through a list.

---

## 9. Configuration knobs

Every one is a constructor option. **Nothing here reads an environment variable** — no
`.env.example` or `src/config/env.ts` change was needed or made.

### `ContextBudgetConfig` (`src/conversation/contextWindow.ts`)

| Knob | Default | Meaning |
|---|---|---|
| `modelNumCtx` | `16384` | The local model's context length, in tokens. See § 4 — this is a measured minimum, not a preference. |
| `reserveForResponseTokens` | `512` | Left free for the model's reply and its tool call. |
| `charsPerToken` | `4` | Pessimistic conversion. Lower = more cautious. |
| `factsShare` | `0.55` | Share of free space the facts block may take, before the caps. |
| `maxFactsChars` | `12000` | Ceiling on the background. Set high on purpose: the transcript's binding constraint is `maxRecentTurns`, not characters, so characters withheld in the transcript's name are characters nobody spends. |
| `minFactsChars` | `3400` | Floor. Measured against the 3,275-char irreducible core; `context:prove` asserts the ladder reaches it. |
| `maxRecentTurns` | `24` | Hard cap on transcript turns. |
| `minTranscriptChars` | `1500` | The transcript never shrinks below this; if this floor applies, `transcriptFloorApplied` says the configuration does not fit the model. |

### `ConversationMemoryWriter`

| Knob | Default | Meaning |
|---|---|---|
| `refreshAfterTurns` | `10` | New turns beyond the coverage line before a compaction is due. |
| `keepRecentTurns` | `8` | Left out of compaction because the live window still carries them — otherwise they would be in the prompt twice, once verbatim and once paraphrased. |
| `maxTurnsPerRefresh` | `60` | Upper bound on turns fed to one compaction call. |

### `ConversationContextAssembler`

| Knob | Default | Meaning |
|---|---|---|
| `businessProfile` | — | `null` is supported, not broken: the agent keeps contact facts, memory, continuity and commitments, and simply has nothing to say about pricing — better than having something wrong to say. |
| `budget` | `DEFAULT_CONTEXT_BUDGET` | Partial override. |

### `AgentTurnService`

| Knob | Default | Meaning |
|---|---|---|
| `contextAssembly` | **absent** | `{ assembler, memoryWriter? }`. Absent = the Baseline V1 path, bit-for-bit. |

### Hard-coded caps worth knowing

`MEMORY_LIMITS` (§ 3); `PREVIOUS_CONVERSATIONS_SCANNED = 6`; `MAX_DURABLE_FACTS = 10`;
`MAX_UNRESOLVED = 8`; `MAX_COMMITMENTS = 6`.

---

## 10. Everything is opt-in, and why

`npm test` stays at **500 passed / 2 skipped** and `npm run qa:sweep` at **601 scenarios /
0 violations / 0 network attempts**, because the Baseline V1 path is untouched:

| Change | How Baseline V1 stays identical |
|---|---|
| `AgentTurnService.contextAssembly` | Optional. Absent → the same unbounded transcript, the same turn-context block, the same disclosure keys, the same audit detail. |
| `buildTurnContext({ background })` | Optional. Absent → every line and every one of the seven `disclosed` keys is byte-identical. Present → the legacy block is *replaced*, not prefixed, because a 7B model handed the same four facts twice in two phrasings spends attention reconciling them instead of listening. |
| New prompt clauses | In a new composition. `sales-scheduler@v1` and its fingerprint do not move. |
| `ToolDependencies.businessProfile` | Optional. Absent → `get_contact_context` output is byte-identical (the key is spread in, not set to `null`). |
| `messagesFromTurns` | Unchanged in behaviour. The new windowing is a separate function. |
| `ScriptedLlmProvider`, every deterministic double | Untouched. |
| `prisma/schema.prisma` | Untouched. No table, no column. |
| The nine tools, `dispatcher.ts` validation | Untouched. |

### 10.1 Reaching it from the composition root

Added at integration, once this layer and `AUTO-PROVIDER`'s local provider were in the
same tree. Until then the richer context was reachable only by constructing
`AgentTurnService` by hand — which the CLIs in § 11 do and the demo did not, so the one
path a reader is most likely to run was the one path that could not see any of this.

`buildAgentRuntime` now takes a `contextAssembly` option, on exactly the footing as
`llmProviderConfig` beside it: **omit it and nothing changes**. There is no code path on
which an absent option reaches an assembler, and nothing in the process environment turns
it on.

```ts
buildAgentRuntime({ ... })                                  // Baseline V1, untouched
buildAgentRuntime({ ..., contextAssembly: {} })              // committed default profile
buildAgentRuntime({ ..., contextAssembly: { profilePath } }) // a profile from a file
buildAgentRuntime({ ..., contextAssembly: { businessProfile: null } })  // memory, no business facts
buildAgentRuntime({ ..., contextAssembly: { memory: true } })           // + rolling summary
```

Two details worth stating, because both are the kind of thing a second composition root
would have got wrong. The assembler shares this function's `db` and `clock`, so the
background a turn reasons against cannot drift from the tools that act on it. And
`memory` reuses the runtime's `llm` rather than accepting its own — summarising a
conversation through a different model than the one holding it is a configuration nobody
asked for. It stays off by default because it costs a second round trip per turn.

`AgentRuntime` exposes `contextAssembler` and `memoryWriter` (both `null` when not opted
in) so a demo or benchmark can inspect what the model was handed rather than rebuilding an
assembler that might not match.

#### It wires BOTH routes to the business profile, and for a while it wired only one

The profile reaches the model two ways, and § 6 makes the second load-bearing rather than
convenient: the assembler writes it into the turn's background, and `get_contact_context`
answers from it **on demand** — which is what the budget ladder falls back to when policy
facts are shed from the window, so that "they remain reachable on demand".

The first version of this option wired the assembler and **not** the dispatcher. So a
runtime built exactly as documented above returned `ok: true` from `get_contact_context`
with **no `business` key at all**, while its own background carried the profile the whole
time. Nothing errored. The ladder's documented fallback fell back to nothing, and the
symptom — an agent that changes the subject when asked what something costs — is
indistinguishable from the model simply choosing not to answer. It was found at QA by
dispatching the tool, not by reading the wiring, and no test covered it.

The profile is now resolved **once**, above the dispatcher, and the same value is handed to
both collaborators. Two `loadBusinessProfile()` calls could return two different documents
if the file changed between them, and a background that disagrees with a tool result is
worse than either being absent.

`businessProfile: null` and an omitted `contextAssembly` both leave the dispatcher without
a profile, and `handlers.ts` spreads the block in only when one is present — so
`get_contact_context` on the Baseline V1 path is byte-identical to what it always returned.
That is what keeps the 601-scenario sweep at 0 violations.

#### The budget and the model cannot disagree about the window

`budget.modelNumCtx` is normally omitted. When the same `buildAgentRuntime` call is also
building the local provider (`llmProviderConfig: { kind: 'local' }`), the budget's window
is **derived** from that provider's `num_ctx`; an explicit one that is *larger* raises
`ConfigurationError`, and a smaller one is left alone because a caller budgeting under the
window is being careful.

This exists because the two numbers arrived from different slices — 16384 from this layer,
8192 from the provider — and Ollama's response to a prompt that does not fit is to **drop
whole older messages, silently**, reporting the post-drop `prompt_eval_count` so the turn
looks like it fitted. The system prompt survives, so the guardrails hold; **the
conversation history is what is lost**, which is precisely what this layer exists to
preserve. See `LOCAL_PROVIDER.md` § 6 for the canary that establishes that, and
`resolveContextBudget` in `src/app/composition.ts` for the reconciliation.

When the provider is passed as an already-built instance via `llm`, its window is not
visible to the composition root — `LlmProvider` exposes no context length — so the default
stands and such a caller should pass both numbers. The demo and the benchmark both do.

---

## 11. How to run everything

```bash
npm run check:anti-scripting   # the no-canned-dialogue check + its non-vacuity self-test
npm run context:prove          # 9 deterministic proofs, non-zero exit on failure
npm run context:verify         # both of the above
npm run context:render         # a real rendered context (returning contact, two sessions)
npm run context:render --json   # the whole AssembledContext, for the benchmark
npm run context:render --sizes  # where every character of a turn goes
npm run context:render --terse  # a tiny facts budget, to watch the ladder work
```

These are **CLIs and not vitest files** because `vitest.config.ts` includes only `tests/**`
and this mission may edit neither that file nor that directory. They assert, they exit
non-zero, and they print the numbers the assertion was made on — a green tick with nothing
behind it is the kind of reassurance this repository's test suite goes out of its way not
to give.

### The nine proofs

| # | Proof | What it would catch |
|---|---|---|
| 1 | **Determinism** | Assembly reading a wall clock, iterating a `Set`, or depending on row order — i.e. an audit replay that is not a replay. |
| 2 | **Boundedness** | The reason this layer exists. 100 turns fit the budget, *and* the bound demonstrably had to bite (otherwise the proof would pass while proving nothing). |
| 3 | **Transcript legality** | An orphaned tool result — a provider rejecting the whole request, presenting as a dropped call. Sweeps every window size from 2 to 40. |
| 4 | **Legacy tolerance** | Every conversation row that already exists. Plain string, broken JSON, foreign envelope, null, blank — none may throw. |
| 5 | **Cross-session** | The mission's first-class requirement. Outcome, durable facts and loose ends carried forward, verified **in the rendered prompt**. |
| 6 | **Disclosure** | The audit claim, plus a phone number or email reaching a context window. |
| 7 | **Ladder** | A budget at the documented floor still fits without cutting; below the floor, the backstop cuts **and says so** in the result and the audit metadata. |
| 8 | **Rolling summary** | Compaction round-trips and stays bounded; a scripted line is refused as a remembered fact and the refusal is reported. |
| 9 | **Summary failure** | Five ways a summariser can fail, each leaving the turn working and the database untouched. |

### The disclosure record

`AGENT_TURN_STARTED` carries `turnContextDisclosed`, offered as proof of what the model was
told. For that to be a *record* rather than a *claim*, it is split:

- **`disclosed`** — what the prompt says. **Every string leaf is a substring of the rendered
  text**, and proof 6 fails if one is not.
- **`disclosureMetadata`** — ids, enum tags, counts, budget outcomes. Just as durable, never
  claimed to be in the prompt, because none of it is.

Without that split the invariant would have to be softened to "most strings appear", and an
invariant with an exceptions list is not one.

Proof 6 also asserts, on both the text and the record: no phone number, no email address,
nothing phone-shaped, nothing email-shaped — **and** that the contact id *is* present,
because tool calls need it. Its non-vacuity guard names the specific facts that must be in
the record (the name, the timezone, the narrative, a durable fact, a loose end), because a
count threshold would pass the day somebody emptied the map of everything but a timezone.

---

## 12. Schema changes recommended but NOT made

`prisma/schema.prisma` is frozen for this mission and **was not touched**. The JSON envelope
in `Conversation.summary` works, degrades gracefully, and is validated on read — but it is a
workaround, and these are its real costs. **This is a recommendation for Founder Review, not
a change.**

### R1 — Promote durable facts to a `ContactFact` table *(highest value)*

```prisma
model ContactFact {
  id, contactId, key, value, origin, confidence,
  learnedInConversationId, supersededAt, createdAt, updatedAt
  @@unique([contactId, key])
}
```

**Why.** A durable fact is a property of the **contact**, not of the conversation that
happened to learn it. Today they are copied forward by re-reading up to six previous
conversations' envelopes and merging by id, which means: (a) the fact count is capped by an
arbitrary scan depth rather than by relevance; (b) superseding a stale fact is impossible —
the newest conversation simply wins; (c) nothing can query "which contacts run QuickBooks",
which is the first thing a sales team will ask for.

### R2 — Promote unresolved topics to their own table

```prisma
model UnresolvedTopic { id, contactId, conversationId, topic, raisedBy, resolvedAt, ... }
```

**Why.** A loose end has a **lifecycle** — raised, carried, resolved — and the envelope can
only express "currently listed". Today a topic is closed by the summariser not re-listing
it, which is indistinguishable from the summariser forgetting. A `resolvedAt` column makes
"we answered that" a fact rather than an absence.

### R3 — A `conversationMemoryJson` column, separate from `summary`

**Why.** `Conversation.summary` has an existing meaning — a human-readable recap — and this
mission has overloaded it with a machine document. Anything already reading that column for
display now gets JSON. A separate column would let `summary` stay prose (rendered from the
memory) and end the legacy-string ambiguity entirely.

### R4 — Index `Conversation(contactId, status, startedAt)`

**Why.** Cross-session assembly does `listByContact(contactId, { take: 7 })` on every turn.
`@@index([contactId, startedAt])` already exists and covers it at today's scale; adding
`status` would help once contacts accumulate many conversations. **Low priority — noted for
completeness, not urgency.**

### What is *not* recommended

A vector/embedding table. See § 5, including the three specific signals that would change
that answer.

---

## 13. Dependencies on the sibling tasks

| Task | What is outstanding |
|---|---|
| `MISSION-2-LOCAL-BRAIN-AUTO-PROVIDER` | (a) Confirm `num_ctx` — § 4 has the measurements and the reasoning for the 16384 default. (b) Confirm the port shape is unchanged; if the local provider needs a flattened single-system message rather than a leading `system` message, this layer will render to that shape. (c) ~~A `contextAssembly` pass-through on `buildAgentRuntime`~~ — **done at integration**, see § 10.1. |
| `MISSION-2-LOCAL-BRAIN-AUTO-EVAL` | Entry points, the `AssembledContext` shape and the profile schema are published and stable; `AssembledContext.version` will be bumped rather than changed underneath. Asked of them in return: if a candidate model systematically mishandles a *section* — reading the alphabetical "what we still do not know" list as a question sequence, say — report which section and which model. That is a context-design bug here, not a model bug. |

---

## 14. A real rendered context

Produced by `npm run context:render`, **not typed by hand**. The world: a contact who is not
the decision maker, a completed conversation three weeks ago that ended mid-question with a
recorded `CONNECTED` call outcome, six durable facts and two loose ends carried forward, a
validated callback already promised for Friday, a qualification with real gaps in it, and a
live second call in which they have just asked what it costs.

Note what is happening in it: every fact is a fact, nothing is a sentence to say, the open
unknowns are explicitly not a sequence, the contact's clock arrives bolted to the rule about
what may be done with it, and the objective is a destination rather than a route.

<!-- BEGIN RENDERED EXAMPLE - generated by `npm run context:render` -->
```text
# Background for this turn

Everything in this message is BACKGROUND, assembled for you by the application from its own records.
It is a set of facts and goals. It is not a script, not an agenda, and not an order of play.
Nothing here is a sentence for you to read out. Put anything you use into your own words, in the
register of the conversation you are actually having.
Most of it will not be needed. A fact you do not need is a fact you do not mention.
Headings and lists are for your benefit only - a person on a phone call has never heard a bullet point.

## The person you are speaking with

Name: Jordan Prospect
Contact id: cmuebk60l0008r2qzt8eept14 - use exactly this id in every tool call, and never any other.
Timezone: America/New_York. Their local clock right now reads Wednesday 4 March 2026 at 10:00.
That clock is context for understanding them, not arithmetic for you to do.
When a time comes up, pass the words the contact used - their phrasing, unchanged - to the tool.
Working out a date or a timestamp yourself is not your job and it will be rejected.
Our record has them NOT as the decision maker, so their qualification score is capped until we are talking to whoever signs.
A colleague's note on their record: Runs operations for a family HVAC business; prefers a call to an email.
They came to us through inbound_web_form; the lead is QUALIFYING.

## The last time we spoke

That conversation started Wednesday 11 February 2026 at 10:10 their time and ended COMPLETED.
The call itself was recorded as CONNECTED, noted as: Ran out of time mid-question about QuickBooks. Asked to be picked up again in March.
What it came to: A first conversation three weeks ago. The contact described running fourteen technicians off a whiteboard and a shared calendar, and said same-day reschedules were costing them a job or two a week. They asked how Northwind would handle their QuickBooks setup and never got a full answer before they had to go. They were clear that nothing would change during the summer peak.
They are not a stranger. Opening as though this is a first contact is the single most obvious way to
sound like a machine.

## What we already know about them

Recorded from earlier conversations and from the CRM. Treat it as what we believe, not as gospel:
if something here turns out to be wrong or out of date, the person in front of you is the authority.

- They run QuickBooks Online. (learned in an earlier conversation)
- They run fourteen field technicians across two vans and one truck. (learned in an earlier conversation)
- Runs operations for a family HVAC business; prefers a call to an email. (from their CRM record)
- Scheduling today is a whiteboard in the office plus a shared calendar. (learned in an earlier conversation)
- Their brother co-owns the business and signs for anything over a few thousand. (learned in an earlier conversation)
- Same-day reschedules cost them roughly one or two jobs a week. (learned in an earlier conversation)
- They will not change systems during the summer peak, June to August. (learned in an earlier conversation)

## What the system has already promised

These are saved records, not intentions. They will happen whether or not this call goes well, so
contradicting one would make us look unreliable in a way the contact can verify:

- Callback, Friday 6 March 2026 at 11:00 their time (PENDING).

## Loose ends

Subjects that came up and were never settled. This is a set, not a queue: it has no order and it is
not a list to work through. Pick one up if the conversation goes near it, and let the rest lie.

- What they currently spend on software for the field (we raised it and they never came back to it, from an earlier conversation)
- How the QuickBooks Online sync handles their existing job codes (they raised it and we never came back to it, from an earlier conversation)

## Where their qualification stands

Band UNQUALIFIED, 31 out of 100 (rubric schedule-ai-voice-rubric@v1).
Evidenced so far: need_established, engagement.
Nothing recorded yet for: budget_signal, timeline_urgency, authority_signal.

## What we still do not know

Gaps in what we have recorded, listed alphabetically because alphabetical is not a priority order and
must not be read as one. There is no sequence to follow here and no box to tick.
A gap closes when the contact volunteers something, and a natural conversation closes several at once
without any of them being asked about directly. Leaving every one of them open is an acceptable outcome
for a single call.

- How many field technicians they run, and whether that changes across the year.
- What makes this time-bound for them: a renewal date, a busy season, a deadline or an event.
- Whether money exists for this: a current spend they would redirect, or an approved budget line.
- Which systems they already run, particularly for accounting and for the field.
- Who actually signs for software at this contractor, and whether this contact can bring them in.

## Who you work for

You are Avery. An outbound scheduling assistant for Northwind Systems, working with one contractor at a time to understand how they schedule today and, where it is useful, to get time in the diary with a solutions engineer.
Northwind Systems: A software company selling scheduling and dispatch software to residential field-service contractors in the United States and Canada.
Northwind Systems builds Northwind Dispatch, a scheduling, dispatch and customer-communication platform for HVAC, plumbing and electrical contractors running between five and two hundred field technicians. Around 1,400 contractors run their daily job board on it. The company sells directly, with no reseller channel.

How you come across:
- Warm and unhurried, at the pace of someone who has time for this call.
- Plain spoken: ordinary words, short sentences, and no jargon the contact did not use first.
- More curious about how their business actually runs than eager to describe ours.
- Comfortable with a no, and comfortable with a pause.
- Borrows the contact's own vocabulary for their trade, their crews and their tools.

Things a contact is entitled to hear:
- This assistant is an AI calling on behalf of Northwind Systems, and a contact is entitled to know that whenever they ask or seem unsure.
- A contact who asks to be taken off the list is entitled to hear that the request will be recorded and honoured.

Not yours to handle:
- Contract redlines, legal terms and data-processing agreements sit with a Northwind account executive.
- Billing disputes and refunds on an existing account sit with Northwind support.
- Technical configuration of a live account sits with Northwind onboarding.

## What we sell

### Northwind Dispatch

A scheduling and dispatch platform that turns incoming jobs into an assigned, routed day for each technician.
Best suited to: Residential field-service contractors running five to two hundred technicians who schedule today on a whiteboard, a shared calendar or a spreadsheet.
It does:
- A drag-and-drop job board with automatic travel-time estimates between jobs.
- Automatic SMS to the homeowner at booking, the evening before, and when a technician is on the way.
- Capacity planning by skill and certification, so a job needing a certified gas fitter is only offered to one.
It does NOT do - these are the facts most worth being straight about:
- There is no payroll module. Hours export to a payroll system rather than being run inside Northwind.
- There is no accounting ledger. Invoices sync to QuickBooks or Xero rather than being reconciled in Northwind.
- Inventory covers truck stock only, not warehouse stock or purchasing.
- Commercial and new-construction scheduling is not supported; the product is built around residential service calls.
It connects to:
- Two-way sync with QuickBooks Online and with Xero.
- One-way calendar sync to Google Calendar and Microsoft 365.

### Northwind Customer Hub

An add-on giving homeowners a booking page, live arrival tracking, and a place to approve quotes.
Best suited to: Contractors already on Northwind Dispatch who take a meaningful share of their bookings online.
It does:
- Online booking against real technician availability rather than a request form.
- Live arrival tracking during the appointment window.
- Quote approval and deposit capture before a technician is dispatched.
It does NOT do - these are the facts most worth being straight about:
- Customer Hub requires Northwind Dispatch and is not sold on its own.
- It does not support marketplace listings or lead resale.

## What it costs

All figures in USD. These are the real published numbers.

### Dispatch Core: $79 per technician per month, billed annually

- The job board, the technician mobile app, and homeowner SMS reminders.
- QuickBooks Online or Xero sync.
- Email and in-app support with a one-business-day response target.
- Billed monthly rather than annually, the price is $95 per technician.
- A minimum of five technicians applies.

### Dispatch Pro: $119 per technician per month, billed annually

- Everything in Dispatch Core.
- Capacity planning by skill and certification.
- Reporting on first-time fix rate and revenue per technician.
- A named onboarding specialist for the first ninety days.
- Northwind Customer Hub at no extra charge.
- Billed monthly rather than annually, the price is $143 per technician.

### Customer Hub add-on: $249 per location per month

- Online booking, live arrival tracking, and quote approval.
- Available alongside Dispatch Core only; it is already included with Dispatch Pro.

On discounting:
- Annual billing is roughly 17% below monthly billing. It is the standard discount and it is applied automatically.
- Any discount beyond annual billing needs a Northwind account executive.
- There is no seasonal, end-of-quarter or first-year pricing. The published price is the price.
- There is no setup fee, and migration from a supported system is included.

## Beyond your authority

Not an awkwardness to work around - a fact about what you are:
- This agent cannot change a price, apply a discount, waive a fee or extend a trial.
- This agent cannot promise a delivery date for a capability that does not exist yet.
- This agent cannot agree contract terms, notice periods or service-level credits.
- This agent cannot send an email, a quote or a document. It can book time, or arrange a callback.

## What this conversation is for

Work out whether Northwind Dispatch could plausibly help this contractor and, where it could, get a conversation with a Northwind solutions engineer into the diary.
- Leave every contact with an accurate impression of what Northwind does and does not do, including when the honest conclusion is that it is not a fit.
- Record what was learned about this contractor, so a later conversation does not start from nothing.
- Honour every promise the system has already persisted, including callbacks and booked meetings.

Outcomes that count as a good call:
- A callback at a time the contact chose is a good outcome. So is a clear no.
- Concluding that Northwind is not a fit, and being straight about it, beats a meeting nobody attends.
- An introduction to whoever signs, with the contact's permission, is worth as much as a meeting.
- A contact who wants to be left alone being recorded as opted out is a successful call.

That is the destination, not the route. The route is whatever this particular person needs it to be,
and a call that reaches none of it while leaving them better disposed to us was still worth making.
```
<!-- END RENDERED EXAMPLE -->
