# EVAL_HARNESS.md - the local-model evaluation layer

This document describes **Layer B** of Schedule AI Voice's two-layer testing design: an opt-in,
explicitly-invoked benchmark that runs real local language models through the real product and scores
how close they get to sounding like a human sales representative.

It is not a test suite. It never runs under `npm test` or `npm run qa:sweep`, and nothing in the
default import graph reaches `src/eval/`.

---

## 0. The two layers, and why they must not merge

| | Layer A - the test suite | Layer B - this harness |
| --- | --- | --- |
| What it proves | Validation, persistence, scheduling, timezones, FutureActions, audit, tool execution | Conversation quality, reasoning, context use, tool selection, natural-language scheduling |
| Model | `ScriptedLlmProvider` and other deterministic doubles | Real local models via Ollama |
| Determinism | Total. Same bytes every run | None. Generative by nature |
| How it runs | `npm test`, `npm run qa:sweep` | `npm run eval:run`, explicitly |
| Network | Zero outbound attempts, asserted | Talks to Ollama on the host |

**Layer A was not touched *by this harness*.** `ScriptedLlmProvider` is unchanged and no LLM call was
added to anything the test suite or the sweep executes. When this document was written, adding Layer B
left Layer A at the numbers it already had:

```
npm test          500 passed | 2 skipped
npm run qa:sweep  601 scenarios, 0 violations, 0 network attempts
```

Those two lines are a record of *that* comparison and are **not** the current totals. Layer A has grown
since, for reasons that have nothing to do with this harness — the Mission 2B scheduling work added
locale regression files and three invariants. On this branch:

```
npm test          1017 passed | 2 skipped  (49 files passed, 1 skipped)
npm run qa:sweep  823 scenarios, 0 violations, 0 network attempts
```

The invariant that matters here is the one that has not moved: **0 network attempts**, with the
benchmark in the same source tree.

The separation is enforced structurally rather than by convention. `tests/invariants/networkTrap.ts`
asserts zero outbound attempts across the whole sweep, and it still passes with the benchmark sitting
in the same source tree - because importing `src/eval/**` dials nothing, and nothing outside
`src/eval/**` imports it.

---

## 1. Reproducing a run, end to end

```bash
npm install
npm run db:generate
npm run db:push

npm run eval:corpus     # validate the corpus and print its coverage. No model, no network.
npm run eval:pull       # pull any candidate not already on the host
npm run eval:models     # inventory + measured resident VRAM -> eval-output/models.json
npm run eval:run        # THE BENCHMARK. Hours. Resumable.
npm run eval:report     # -> results.json, COMPARISON.md, transcripts/
```

`eval:run` does both phases — generate, then judge — in one invocation, which is what the line above
gets you. A **fair cross-model comparison** splits them, and the exact commands for that are § 9.2
steps 8 and 11. There is no separate judge CLI: judging is phase 2 of this command, and re-running it
over already-recorded runs is how you reach that phase on its own (§ 9.4).

Useful flags on `eval:run`:

| Flag | Effect |
| --- | --- |
| `--model <tag>` | Restrict to one model. Repeatable. |
| `--scenario <id>` | Restrict to one scenario. Repeatable. |
| `--force` | Re-run scenarios that already have a recorded result. **Never pass this to a judging pass** — see § 9.4. |
| `--skip-judge` | Programmatic results only. Roughly 3x faster. |
| `--baseline-context` | Run the Baseline V1 context path instead of the production one. |
| `--num-ctx <n>` | Override the context window. |

Environment: `LOCAL_LLM_BASE_URL` (default `http://host.docker.internal:11434` - inside a container
`localhost` is the container), `EVAL_OUT_DIR`, `EVAL_NUM_CTX`.

**For a comparison across candidates, the steps above are not sufficient on their own.** Latency and
throughput are properties of the machine as much as of the model, so a like-for-like ranking needs
sequential runs, a cold GPU between them, one shared `num_ctx`, a forced re-run, judging as a separate
phase, and the host conditions recorded per run. That protocol is **§ 9**, and it is written to be
followed without asking anyone a question.

**The run is resumable.** Each `(model, scenario)` pair writes its own JSON file the instant it
finishes, and a re-run skips whatever is already on disk. An interrupted run loses the scenario in
flight and nothing else.

**A failing candidate produces a recorded failure, not an aborted run.** A model that stalls, throws
or returns garbage gets a recorded `ERROR` and the run continues to the next scenario. A weak
candidate has to be weak on the record; it is not allowed to vanish from the comparison.

---

## 2. What "through the real system" means

Every turn goes through `AgentTurnService.handleTurn` - the production class. Which means it goes
through:

- the production system prompt (`sales-scheduler-local@v2`) built from the persisted
  `AgentConfiguration`;
- the CONTEXT task's real `ConversationContextAssembler`, with the committed business profile from
  `src/context/profiles/default.json`;
- the real nine tool JSON Schemas, generated from the real Zod definitions;
- the real `ToolDispatcher` chokepoint, the real `SchedulingValidator`, and the real deterministic
  datetime resolver;
- the real `ConversationService`, rebuilding the message array from database rows each iteration;
- the real audit writes.

The only substitutions are the ones `src/app/sliceDemo.ts` already makes: a `FixedClock`, the
deterministic provider doubles, and a throwaway SQLite file created under `.tmp/` and deleted
afterwards.

A benchmark that assembled its own prompt and called Ollama directly would produce prettier numbers
and prove nothing, because what ships is the whole chain and not the model.

Two composition notes, stated because they are the kind of thing that quietly drifts:

- **The runner composes through `buildAgentRuntime`'s `contextAssembly` option and nothing else.**
  It did not always. Before that seam existed, the runner took the runtime the composition root
  returned and replaced its turn service with a hand-built one — which reused that runtime's
  `ToolDispatcher`, **constructed without a business profile**. So every benchmarked turn ran against
  an agent whose `get_contact_context` silently came back with no `business` block, and the benchmark
  was measuring a differently-wired agent than the one that ships. That is the concrete cost of a
  second hand-rolled dependency graph, and it is why there is now only one.
- The rolling-summary `ConversationMemoryWriter` is **deliberately off**. It issues its own model call
  to summarise, and including it would attribute summarisation latency and tokens to conversational
  turns - confounding the exact comparison this benchmark exists to make. The corpus scenarios are 2-5
  turns, so nothing scrolls out of the transcript window and the summary would have almost nothing to
  recap. Measuring the memory writer is a separate, worthwhile run.

Both context modes are recorded on every result (`contextMode`, `systemPromptRef`) and write to
**different output directories**, because results from them are not comparable and a resumed run must
not be able to blend them.

---

## 3. The candidate set

Hardware, measured on the host: NVIDIA GeForce RTX 4060 Laptop GPU, **8188 MiB VRAM**, driver 566.24,
CUDA 12.7; Intel Core i9-14900HX 24c/32t; 31.71 GB RAM. Working budget: **7.5 GiB** for weights plus
KV cache.

VRAM below was measured by this harness (`npm run eval:models`), by loading each model at the
benchmark's own context length and reading `/api/ps` while it was resident. Loading at the real
context length matters - the KV cache is a real part of the footprint.

| Model | Params | Quant | Disk | VRAM @ 8k | VRAM @ 16k | Tools | Fits |
| --- | ---: | --- | ---: | ---: | ---: | --- | --- |
| `qwen2.5:7b-instruct` | 7.6B | Q4_K_M | 4.36 GiB | 4.64 GiB | 5.09 GiB | yes | yes |
| `mistral:7b-instruct` | 7.2B | Q4_K_M | 4.07 GiB | 5.11 GiB | 5.77 GiB | yes | yes |
| `llama3.1:8b-instruct-q4_K_M` | 8.0B | Q4_K_M | 4.58 GiB | 5.41 GiB | 5.88 GiB | yes | yes |
| `aya-expanse:8b` | 8.0B | Q4_K_M | 4.71 GiB | 5.81 GiB | ~5.8 GiB | yes | yes |
| `hermes3:8b` | 8.0B | **Q4_0** | 4.34 GiB | 5.17 GiB | 5.86 GiB | yes | yes |

All five fit with at least 1.6 GiB of headroom at 16k. None was rejected for VRAM after being pulled.

### Why each model is in the set

Popularity is not a reason and is not used below.

- **`qwen2.5:7b-instruct`** - named in the brief, and the strongest instruction-follower of the 7B
  generation. It is the control for structured output: if a model cannot reliably emit a native tool
  call, nothing else about it matters. It is also the provider task's current default, so it is the
  incumbent this benchmark must confirm or unseat.
- **`mistral:7b-instruct`** - named in the brief. The oldest architecture and the smallest model here,
  so it is the floor: it answers "what does the extra billion parameters actually buy on this task?"
- **`llama3.1:8b-instruct-q4_K_M`** - named in the brief. Trained with tool use as a first-class
  objective, and the reference point most external tool-calling evaluations are stated against.
  **Note the tag.** Plain `llama3.1:8b-instruct` *does not exist* in the Ollama registry - the
  instruct builds are published only with an explicit quantization suffix - so the brief's name would
  never have resolved. This was reported to the provider task.
- **`aya-expanse:8b`** - **added**, and the addition this harness would defend hardest. The corpus is
  required to contain Hebrew and mixed Hebrew/English conversations, and every other candidate is a
  predominantly-English model that happens to have seen some Hebrew. aya-expanse is Cohere's
  explicitly multilingual release, trained across 23 languages including Hebrew. Without it, the
  Hebrew result would only say how badly English-first models cope - not whether the requirement is
  achievable at this size at all.
- **`hermes3:8b`** - **added** to isolate one variable. It is a fine-tune of Llama-3.1-8B specifically
  tuned for multi-turn conversation and tool use, and *its base model is also in this set*. The pair
  answers a question no single model can: does a conversation-focused fine-tune measurably improve
  human-likeness, or is the base already at the ceiling for 8B? It ships at **Q4_0** rather than
  Q4_K_M - a slightly cruder quantization, recorded here as a mild confound.

### Considered and not run

| Model | Reason |
| --- | --- |
| `qwen2.5:14b-instruct` | Rejected on VRAM, on the registry's published ~9 GiB 4-bit weight size before any KV cache, against an 8188 MiB card. **Not measured here** - it was not pulled, precisely because it could only run by spilling into system RAM, at which point every latency number would describe the spill. Revisit on a 12 GiB card. |
| `mistral-small:22b`, `gemma2:27b`, larger | Rejected on VRAM, decisively and without measurement: 13 GiB and up at 4-bit. |
| `llama3.2:3b`, `qwen2.5:3b`, other sub-4B | Rejected on *expected* capability, not size - they would fit easily. The brief asks for 7-9B absent a stated reason. **This harness has no evidence either way about 3B models on this task**; the reason is the brief, not a measurement. If latency turns out to be the binding constraint for voice, this is the first assumption to re-test. |
| `gemma2:9b` | Deprioritised, not disqualified. The multilingual slot went to aya-expanse, which is explicitly trained for it, and a sixth model would have cost corpus depth. **No claim is made about its tool-calling support** - it was not pulled and therefore not measured. |

### Download cost, actually observed

`qwen2.5:7b-instruct` and `mistral:7b-instruct` were already on the host. The three added models were
pulled by this task over `POST /api/pull`, concurrently, and all three completed:

| Model | Size pulled | Notes |
| --- | ---: | --- |
| `llama3.1:8b-instruct-q4_K_M` | 4.58 GiB | |
| `aya-expanse:8b` | 4.71 GiB | |
| `hermes3:8b` | 4.34 GiB | |

Three concurrent pulls totalling ~13.6 GiB completed in roughly 25 minutes of wall-clock on this
link. `npm run eval:pull` pulls **sequentially** rather than concurrently, because three at once
shares one link and one disk and makes the progress output unreadable for no wall-clock gain.

---

## 4. The corpus

`src/eval/corpus/`, Zod-validated at load time and versioned as a whole (`CORPUS_VERSION`). A corpus
that fails its own schema, repeats an id, or leaves a required conversational shape unclaimed **throws
at load** rather than running and quietly testing less than it claims to.

**Multi-turn by construction.** `turns` is an ordered array and the conversation is *not* reset
between them. A single-turn prompt cannot show whether a model remembers what was said four exchanges
ago, recovers from a topic change, or continues naturally after a tool result - which is most of what
decides whether this sounds like a person.

Each scenario carries a seeded world (contact, timezone, decision-maker status, business hours, lead
time, diary, optional prior conversation, optional already-booked meeting), a stated objective, an
ordered list of what the human says, and **per-turn expectations that a program can check**.

There is deliberately **no expected assistant text**. Scoring a generative model against one blessed
sentence measures conformity to whoever wrote the fixture, not conversation quality.

### Coverage against the required list

**Corpus 1.1.0: 21 scenarios, 65 turns**, covering all 26 required shapes. (Corpus 1.0.0 had 19 and
59; an earlier draft of this line said 66, and `npm run eval:corpus` is the authority. The two added
scenarios are `hebrew-digit-clock-time` and `mixed-digit-clock-time` — see *Wrong-day resolution* in
§ 6.)

| Required shape | Scenario(s) |
| --- | --- |
| normal introduction | `intro-interested-lead`, `hebrew-intro-and-booking` |
| interested lead | `intro-interested-lead`, `hebrew-intro-and-booking`, `hebrew-digit-clock-time` |
| uninterested lead | `uninterested-lead`, `hebrew-price-objection` |
| busy right now | `busy-right-now`, `hebrew-busy-callback`, `mixed-digit-clock-time` |
| what exactly does the company do | `what-does-the-company-do`, `hebrew-intro-and-booking`, `hebrew-digit-clock-time` |
| contact changes topic unexpectedly | `topic-change-and-callback`, `mixed-hebrew-english` |
| question before answering | `what-does-the-company-do` |
| incomplete information | `incomplete-information`, `mixed-hebrew-english` |
| "maybe call me sometime next week" | `vague-next-week`, `hebrew-busy-callback` |
| "tomorrow afternoon should work" | `intro-interested-lead`, `hebrew-intro-and-booking`, `mixed-hebrew-english`, `hebrew-digit-clock-time`, `mixed-digit-clock-time` |
| reschedule | `reschedule-existing-meeting` |
| cancellation | `cancellation` |
| not the decision maker | `not-decision-maker` |
| price objection | `price-objection-interrupt`, `hebrew-price-objection` |
| needs to discuss with someone else | `not-decision-maker`, `hebrew-price-objection` |
| call again after several days | `busy-right-now`, `hebrew-busy-callback` |
| reference back several turns earlier | `topic-change-and-callback`, `resumed-session`, `mixed-hebrew-english` |
| continuing a previous session | `resumed-session` |
| English | 15 scenarios |
| Hebrew | `hebrew-intro-and-booking`, `hebrew-busy-callback`, `hebrew-price-objection`, `hebrew-digit-clock-time` |
| mixed Hebrew/English | `mixed-hebrew-english`, `mixed-digit-clock-time` |
| ambiguous date and time language | `vague-next-week`, `hebrew-busy-callback` |
| interrupts the expected sales direction | `price-objection-interrupt`, `hebrew-price-objection` |
| unexpected but relevant product question | `what-does-the-company-do` |
| **tool result returns a failure** | `tool-failure-outside-hours`, `tool-failure-slot-taken` |
| adversarial / guardrail | `adversarial-guardrail` |

### Tool failures are real, not mocked

The two `tool-failure-*` scenarios do not inject a fake refusal. They **seed a world in which the real
dispatcher really refuses**:

- `tool-failure-outside-hours` asks for 07:00 against business hours that open at 09:00, so the real
  `SchedulingValidator` rejects it.
- `tool-failure-slot-taken` seeds a genuine recurring busy block into the deterministic availability
  provider, so the real availability check finds the slot occupied.

What is then scored is the model's *recovery*: did it explain the refusal in ordinary language, did it
avoid reading an error code to the customer, and did it avoid claiming something was booked that was
not. In practice additional real refusals appear across the corpus too (am/pm ambiguity, unparseable
phrasing), and those are recorded wherever they occur.

### "Continuing a previous session" - honest scope

This is modelled by replaying an earlier exchange into the same conversation before the scenario's own
turns run, so the model genuinely sees it in its transcript. That is what this architecture can
express. **True cross-conversation recall** is the context assembler's job; the assembler is in the
loop for every run, but the corpus does not construct a second, separate `Conversation` row to prove
cross-conversation memory specifically.

---

## 5. The rubric

`src/eval/rubric/rubric.ts`, versioned (`RUBRIC_VERSION`). Weights are asserted to sum to 1 at module
load.

| Category | Weight | Why |
| --- | ---: | --- |
| **Conversation quality** | **55%** | The mission is a system that sounds close to a human representative. |
| Tool and structural correctness | 30% | Necessary but not sufficient - what a model must get right to be usable at all, not what makes it worth deploying. |
| Language quality | 15% | Weighted separately because a model can be excellent in English and unusable in Hebrew, and an average would hide exactly what a bilingual deployment needs to know. |

The lopsidedness is the point. **A technically correct model that sounds robotic must not become the
recommended default**, and a rubric that averaged "called the right tool" with "sounded human" would
not protect that - tool correctness is cheap to measure and easy to score highly, so it would dominate
by being easy.

### Conversation quality (55%)

| Dimension | Weight | Method |
| --- | ---: | --- |
| Naturalness | 12% | judged |
| Relevance | 10% | judged |
| Contextual awareness | 10% | judged |
| Remembers earlier information | 9% | judged |
| Conversational continuity | 8% | judged |
| Sensible follow-up questions | 8% | judged |
| Avoids mechanical interrogation | 8% | judged |
| Reacts well to unexpected input | 7% | judged |
| Continues naturally after a tool result | 7% | judged |
| Sales quality without sounding scripted | 3% | judged |
| Recovers after a topic change | 3% | judged |
| **Met the turn's content expectations** | 7% | **programmatic** |
| Appropriate response length | 4% | **programmatic** |
| Non-repetitiveness | 4% | **programmatic** |

`textExpectationsMet` is weighted above the other two programmatic dimensions because it carries the
**memory probes** (turns where the corpus plants a fact and later requires the reply to name it), the
ban on reciting raw error codes to a customer, the ban on asserting a concrete date the model was
never given, and the **passthrough check** - whether the contact's own words survived into the tool
argument. All of those are objectively checkable, so they are checked rather than left to an opinion.

### Tool and structural correctness (30%) - entirely programmatic

| Dimension | Weight |
| --- | ---: |
| Tool-selection accuracy | 30% |
| Valid vs malformed tool arguments | 22% |
| No hallucinated identifiers | 18% |
| No unnecessary or hallucinated tool calls | 12% |
| Scheduling-intent recognition | 10% |
| Structured-output reliability | 8% |

### Language quality (15%)

| Dimension | Weight | Method |
| --- | ---: | --- |
| Quality of the language produced | 60% | judged |
| Replied in the right language | 40% | **programmatic** |

---

## 6. The gates

There are two. **Neither is a weighted dimension.** A gate zeroes the entire tool-and-structural
category for the turn that trips it, and ranks the run below every run that trips nothing.

### Manufactured timestamps

**This is not a weighted dimension. It is a gate.**

> A turn fails the gate when a time-bearing tool argument contains a resolved absolute date or instant
> - an ISO date, an ISO datetime, a numeric date with a year, a month-name date with a year, or a Unix
> epoch - that does **not** appear in anything the contact said.

The exemption matters: passing the contact's own words through, *including a date the contact
themselves stated*, is correct and does not trip the gate. A contact is entitled to say "2026-03-05";
the model is not entitled to derive it.

**Consequence.** A turn that trips it scores **zero for the entire tool-and-structural category**. At
model level the category is scaled by the surviving fraction of turns, so one bad turn in eighty is
recorded as a serious finding without being collapsed into the same number as a model that fabricates
constantly. **In the ranking, any model that trips the gate is placed below every model that does
not, whatever its composite score.** A charming model that invents timestamps is not a better product
than a duller one that does not.

A separate, deliberately softer check flags concrete dates asserted in *assistant prose* on turns that
opt into it. It is not the gate: prose is fuzzier, and a false positive must not be able to fail a
model outright. **Known limitation:** the gate requires a year, so a model that says "Friday at 2pm"
having never been told the date is *not* caught by the gate. That behaviour is left to the judged
dimensions and to the prose check. Tightening the gate to catch it would produce false positives on
legitimate sales behaviour - offering a time is not the same as asserting a resolved one.

### Wrong-day resolution

Added in rubric 1.1.0, and it is the mirror image of the first gate: it grades **application code, not
the model.**

> A turn fails the gate when the corpus states which calendar day the contact named and a time-bearing
> tool was nonetheless **accepted** for a different local calendar day. Comparison is on the local date
> in the zone the slot resolved in.

**A refusal is explicitly not a failure here.** Refusing a `when` the product cannot resolve books
nothing and asks the contact again, which is the safe outcome; scoring it as a failure would push the
fix in the wrong direction. Only a booking that *happened*, on the wrong day, trips it.

**Why it exists.** `src/scheduling/naturalLanguage.ts` is English-only, and until this was measured the
consequence was described everywhere as a clean refusal. It is not, for the commonest real case: a
Hebrew or mixed `when` with the clock time **in digits** (`מחר ב-15:00`, "tomorrow at 15:00") has its
digits recognised, its Hebrew day word **silently dropped**, and is resolved to *today* - a validated,
persisted, audit-trailed booking a day early with no warning anywhere. `expectsToolFailure`, the only
field the corpus previously had, could only have scored that as "expected failure DID NOT OCCUR": an
unmet expectation, reading like a model that did better than predicted. The full finding, with the
parser table and the end-to-end repro, is `docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 8.3.

**How a scenario states it.** A turn carries
`resolvedDay: { mustResolveToLocalDate: '2026-03-05', contactSaid: 'מחר ב-15:00' }`. The date is
written out rather than derived, so the assertion can be checked by hand against the scenario's pinned
`nowUtc`. `hebrew-digit-clock-time` and `mixed-digit-clock-time` are the two scenarios that use it.

**The denominator is not "all turns".** The per-model rate is over turns where a day was asserted *and*
an instant actually resolved. A rate over every turn would shrink toward zero as the corpus grew, and a
model that was refused, or that never reached a time-bearing tool, is reported as `n/a` rather than
credited with a pass it did not earn.

**Expect failures here, and read them correctly.** A candidate that obeys the passthrough rule and
sends the Hebrew through verbatim **fails** this gate; one that silently translates it into English
**passes** it while failing the passthrough check. That incentive is inverted, it lives in the
resolver, and no rubric weighting can fix it - which is the argument for doing the `src/scheduling/`
work rather than deferring it.

---

## 7. Programmatic vs judged - the full split

**Programmatic (10 dimensions).** Computed by code from the real turn. Reproducible byte-for-byte
given the same recorded run.

| Check | How |
| --- | --- |
| Tool selection | Against the turn's stated expectations, with partial credit per sub-assertion |
| Argument validity | Parsed as JSON, then validated against the **real Zod schema**, including its `.strict()` rejection of invented keys - the same check the dispatcher performs |
| Hallucinated `contact_id` | Compared against the real seeded contact id |
| Hallucinated `meeting_id` | Compared against the set of ids the system has actually shown the model, which grows as real tool results arrive |
| Unnecessary calls | Anything outside the turn's defensible set |
| Passthrough | Does the `when` argument still contain the contact's own words? |
| Content expectations | Memory probes, forbidden strings, concrete-date assertions |
| Response length | Continuous score against a per-turn character budget, degrading linearly rather than cliff-edged |
| Non-repetitiveness | Character-trigram Jaccard similarity against every earlier reply in the same conversation. Trigrams because it must work on Hebrew as well as English, and because it catches a model that re-says the same thing with two words swapped |
| Language match | Ratio of Hebrew to Latin letters. Thresholds: `he` >= 50%, `mixed` >= 15%, `en` <= 2%. The raw ratio is recorded so the thresholds can be argued with |
| Structured-output reliability | From the provider's own `toolCallHealth`: native calls score 1, calls recovered from text score 0.5, refused-as-malformed score 0 |

**Judged (12 dimensions).** Opinions from a local model. Labelled as opinions everywhere they appear,
and never presented as measurements.

### The judge, and its limitations

- **Two judges, from different families**: `qwen2.5:7b-instruct` and `llama3.1:8b-instruct-q4_K_M`,
  both at temperature 0 and `num_ctx` 16384.
- **The prompt is committed verbatim** at `src/eval/rubric/judgePrompt.ts`.
- **The judge is blind to model identity.** Transcripts are presented identically and the candidate is
  never named. It also never sees the scenario's expectations - a judge that could see the answer key
  would be grading against it rather than assessing how the conversation sounded.
- **The judge sees the whole conversation**, not a turn, because continuity and memory are properties
  of conversations.
- It is told explicitly **not** to score tool correctness - that is measured, and letting an opinion
  also vote on it would double-count the easy half.
- **Raw transcripts are written** to `eval-output/transcripts/`, showing what the model said next
  to what the machinery did, including the arguments it proposed and the dispatcher's verdict. A
  judged score nobody can check against its conversation is not evidence, so these are intended to
  be committed alongside the review package.

Limitations, stated rather than buried:

1. **The judges are the same size as the candidates.** There is no frontier model available to this
   harness, so 7-8B models are grading 7-8B models. They will miss subtleties a human would catch.
2. **Self-preference.** Both judges are also candidates. LLM judges are known to favour their own
   outputs. This is *mitigated, not solved*, by using two judges from different lineages and
   **reporting their disagreement** - the mean absolute difference across dimensions on the 0-5 scale.
   Where it is large, this harness cannot resolve that dimension and the transcripts should be read.
3. **Hebrew judgement is the weakest part.** A 7-8B model's ability to assess Hebrew register is
   materially worse than its ability to assess English. Hebrew judge scores are a weak prior.
4. **A judge failure is recorded, never dropped.** The report prints how many scenarios went unjudged,
   because a judged average over an unknown denominator is worthless.

Two real judge defects were found and fixed during development, and are recorded because they say
something about using small models as judges:

- **Template echo.** Given a JSON skeleton containing `"score": 0`, `qwen2.5` returned the skeleton
  verbatim - a perfectly valid, silently catastrophic all-zeros verdict. The prompt now uses
  angle-bracket placeholders that *cannot* validate, and `detectTemplateEcho` rejects any reply whose
  justifications are all identical, retries, and records a failure if it persists.
- **Language drift.** Judging a Hebrew transcript, `qwen2.5` wrote all twelve justifications in
  Chinese. The judge is now explicitly instructed to write its reasoning in English whatever the
  language of the call.

---

## 8. Output artefacts

```
eval-output/                           (override the root with EVAL_OUT_DIR)
  models.json                          inventory + measured VRAM
  results.json                         machine-readable, for the Founder Review
  COMPARISON.md                        the human-readable side-by-side
  transcripts/<model>/<scenario>.md    real transcripts + judge verdicts
  environment/<model>.json             host conditions per run, written EXTERNALLY (§ 9)
  runs/<model>/<scenario>.json         gitignored raw per-run records (large, regenerable)
```

Everything except `runs/` is meant to be **committed** next to the Founder Review — a judged score
nobody can check against its transcript is not evidence. `runs/` is gitignored: it is large, it is
regenerable, and it is the resume checkpoint rather than a result.

**`environment/` is COMMITTED**, and for a sharper reason than the rest. It is the only artefact here
that **cannot be regenerated**: you can always re-run a model, but you cannot go back and re-measure
what the machine was doing during a run that has already finished. It is also tiny — a few dozen
readings per model. `.gitignore` names it explicitly as not-ignored so the intent is visible rather
than merely implied by the absence of a rule.

> **This is not a formality.** All 57 of those files were dropped during the branch merge that carried
> the Founder Review, so for three branches the review cited evidence that was not in the repository.
> `.gitignore` has one line for this (`eval-output/runs/`) and it means what it says: everything else
> under `eval-output/` is committed. Restored — see
> [`docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md`](docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md).

**Every path above is derived from the output root**, and the root comes from `EVAL_OUT_DIR`. Nothing
is hardcoded to `eval-output/`, so a fresh run can be written and reported **beside** the preliminary
results instead of overwriting them. That is what makes a re-benchmark comparable against what is
already committed rather than destructive of it, and it is covered by
`tests/eval/customOutputDirectory.test.ts`, which drives the real report generator against a
temporary directory and asserts the committed tree is byte-for-byte untouched.

`results.json` carries the harness, corpus, rubric and judge-prompt versions, the full rubric with
weights and rationales, the candidate set and the rejected list, the coverage map, the per-model
aggregates, the per-scenario breakdown and the per-model host conditions. Nothing in it is fabricated:
a metric with no observations is `null`, never `0`, and every aggregate carries its own `n`.

### `results.json` schema identifier

| Identifier | What changed |
| --- | --- |
| `schedule-ai-voice/eval-results@1` | The original shape. |
| `schedule-ai-voice/eval-results@2` | **Current.** Adds one top-level key, `environment` (§ 9.3). A strict **superset**: every `@1` key is still present, unmoved and unrenamed, so a reader written against `@1` keeps working. The identifier moves because the shape grew, not because it was restructured. |

No new database tables were added. `prisma/schema.prisma` is untouched.

---

## 9. The fairness protocol — re-benchmarking all five under identical conditions

The preliminary results committed under `eval-output/` cover **three** of the five candidates and were
not all produced under recorded conditions. This section is the protocol for producing a comparison
that is actually like-for-like. It is written to be followed **without asking anyone a question**.

Read § 9.6 first if you only read one part: it is the list of things that make the comparison
**invalid**, and it is shorter than the list of things to do.

### 9.1 What is actually being measured, and why conditions decide it

§ 5 scores conversation quality, tool correctness and language. Those are properties of the model.
§ 6 of `COMPARISON.md` reports latency, tokens per second and context utilisation, and **those are
properties of the machine as much as of the model.** A candidate benchmarked while a browser held two
gigabytes of VRAM, or one whose weights spilled into system RAM because the previous model was still
resident, produces slower numbers that say nothing about the candidate.

The failure mode is not that the numbers are wrong. It is that **nothing in the output says they are
not comparable**, so a reader ranks five models on a table where two of them were racing uphill. The
conditions cannot be reconstructed after the fact, which is why they have to be recorded *during* the
run, by the host.

### 9.2 The protocol, step by step

**Preconditions.**

1. Close every other GPU application. If one cannot be closed, that is fine — record it in the
   `note` field (§ 9.3) rather than pretending the machine was quiet.
2. Confirm all five candidates are on the host: `npm run eval:models`. **Do not** pull anything
   mid-sweep; a pull saturates the disk and the link and will distort whatever is running.
3. Pick one `num_ctx` and use it for all five. The harness default for the production context path is
   **16384**. The KV cache is a real part of the VRAM footprint (§ 3), so a model run at 8k is not
   comparable with one run at 16k on any axis.
4. Pick a fresh output directory so the preliminary results survive:

   ```bash
   export EVAL_OUT_DIR="$PWD/eval-output-fair-$(date +%Y%m%d)"
   ```

5. Note the corpus and rubric versions once, from `npm run eval:corpus`. All five models must be run
   against the **same** versions; if either changes mid-sweep, the sweep is void.

**One model at a time, sequentially.**

For each of the five candidates, in any fixed order, do all of the following before starting the next:

6. **Unload every model** from the runtime first, so the candidate starts from a cold, empty GPU and
   cannot be pushed into system RAM by a predecessor that is still resident. Verify the runtime reports
   nothing resident before continuing.
7. **Start the host sampler** for this model (§ 9.3). It writes
   `$EVAL_OUT_DIR/environment/<model-slug>.json`.
8. **Run generation only, forcing a re-run:**

   ```bash
   npm run eval:run -- --model <tag> --num-ctx 16384 --force --skip-judge
   ```

   - `--force` is **required** *here, in the generation pass.* Without it this run is a *resume*: it
     skips every `(model, scenario)` already on disk and silently reuses records made under the old
     conditions. A comparison that mixes fresh and stale records is not a comparison.
   - `--force` is **forbidden** in the judging pass at step 11, for the same reason it is required
     here — it regenerates. Both rules are the one rule "measure once, under recorded conditions".
   - `--skip-judge` keeps judging out of the generation phase — see § 9.4.
9. **Stop the sampler** and confirm the record exists and validates. `npm run eval:report` will refuse
   to run at all if it is malformed, which is the check.
10. **Unload the model again**, then go to step 6 for the next candidate.

**After all five have generated.**

11. **Run the judging phase, once per candidate — with `--force` OMITTED.** This is the one step in the
    whole protocol where `--force` must not be passed, and passing it destroys the sweep:

    ```bash
    npm run eval:run -- --model <tag> --num-ctx 16384     # no --force, no --skip-judge
    ```

    - `EVAL_OUT_DIR` must **still be exported**, exactly as at step 8. In a new shell it is not, and the
      pass would judge whatever is in the default directory while leaving this sweep unjudged.
    - **Why no `--force`.** Without it, the run *skips* every scenario already recorded and judges the
      ones that carry no verdict yet — which, after step 8, is all 21 of them. **With** `--force` it
      re-generates that candidate's 21 scenarios instead, throwing away the runs you just
      measured under recorded conditions while the environment records (written at step 7, by a sampler
      stopped at step 9, and not restartable retroactively) go on describing the discarded generation
      pass. The result is a `COMPARISON.md` whose § 7 conditions belong to different runs than its § 6
      latencies, with nothing saying so. That is § 9.1's failure mode, reached by being thorough.
    - **Why no `--skip-judge`.** That flag is what *suppresses* judging; this pass is the judging.
    - **Do not restart the sampler,** and do not unload between candidates here. Nothing this pass does
      is measured: the judges' own latency is never reported, and the candidate's numbers were fixed at
      step 8 and are only re-read. Both judges are themselves candidates (§ 9.4), so they are already on
      the host from precondition 2 and nothing needs pulling.
    - There is deliberately no judge-only CLI. Judging is phase 2 of `eval:run`, and a resumed run with
      nothing left to generate *is* a judging pass. See § 9.4.
12. `npm run eval:report` — with `EVAL_OUT_DIR` still exported — to write `results.json`,
    `COMPARISON.md` and the transcripts into the fresh directory.
13. Read § 7 and § 8 of the generated `COMPARISON.md` **before** reading § 6. If either of them says a
    model's conditions differ, § 6 is not a ranking for that model.

### 9.3 The environment record

**An external host sampler writes these files. This harness never does, and must not.** `src/eval`
runs inside a container: it would measure the container, not the host whose GPU is doing the work. And
`npm run eval:report` is required to be a pure function of what is already on disk, so it cannot go
looking at the machine. `src/eval/environment/` therefore only ever **reads and validates**.

| | |
| --- | --- |
| **Location** | `<EVAL_OUT_DIR>/environment/<model-slug>.json` — one file per model per run, a sibling of `runs/` and `transcripts/`, so it moves with `EVAL_OUT_DIR` |
| **Slug** | The model tag with every character outside `[A-Za-z0-9._-]` replaced by `_` — the same slugging `runs/` and `transcripts/` use, so the three directories line up by eye |
| **Schema** | `src/eval/environment/schema.ts`, Zod, versioned `1.0.0` via a `z.literal` on `schemaVersion` |
| **Committed?** | **Yes** — see § 8. It is the one artefact here that cannot be regenerated |

**The shape.** A complete, valid example:

```json
{
  "schemaVersion": "1.0.0",
  "modelId": "qwen2.5:7b-instruct",
  "runId": "fairness-sweep-2026-09-27",
  "numCtx": 16384,
  "sampledBy": "host-env-sampler 1.0.0 (external, runs on the Windows host)",
  "startedAtIso": "2026-09-27T09:00:00.000Z",
  "endedAtIso": "2026-09-27T09:40:00.000Z",
  "modelResidentBytes": 5368709120,
  "offload": {
    "reportedBy": "ollama 0.34.3 /api/ps",
    "gpuBytes": 5368709120,
    "cpuBytes": 0,
    "runtimeReportedText": "100% GPU"
  },
  "note": null,
  "samples": [
    {
      "atIso": "2026-09-27T09:00:00.000Z",
      "freeSystemRamBytes": 19327352832,
      "vramUsedBytes": 5368709120,
      "vramTotalBytes": 8585740288,
      "gpuUtilizationPercent": 0,
      "cpuLoadPercent": 8
    }
  ]
}
```

**Every field.**

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Must be exactly `"1.0.0"`. Another version is **rejected**, not partially understood |
| `modelId` | The Ollama tag, spelled as in § 3. Checked against the filename's slug — a mismatch is refused, because crediting one model's conditions to another is the exact unfairness this file exists to expose |
| `runId` | Which sweep this belongs to. **Identical across all five files** of one sweep; that is what makes them a comparison rather than five unrelated measurements |
| `numCtx` | The context length this run used, or `null`. Recorded so a reader can *verify* the "identical `num_ctx`" rule instead of taking it on trust |
| `sampledBy` | The external sampler's name and version |
| `startedAtIso`, `endedAtIso` | ISO 8601 UTC. `endedAtIso` may not precede `startedAtIso` |
| `samples` | **The series — at least one.** A record claiming to be a measurement and containing none is malformed, not empty |
| `samples[].atIso` | When this reading was taken |
| `samples[].freeSystemRamBytes` | Free host system RAM, **in bytes** |
| `samples[].vramUsedBytes` | VRAM in use across the whole device by every process, **in bytes** |
| `samples[].vramTotalBytes` | Total VRAM the device reports, **in bytes**. May not be less than `vramUsedBytes` |
| `samples[].gpuUtilizationPercent` | GPU busy percentage, **0–100** |
| `samples[].cpuLoadPercent` | Host CPU busy percentage across all logical cores, **0–100** |
| `modelResidentBytes` | The model's own resident size, **in bytes** — weights plus KV cache |
| `offload` | The GPU/CPU split, or `null` if the runtime did not report one. **`null` does not mean 100% GPU** |
| `offload.reportedBy` | Which runtime said so, e.g. `ollama 0.34.3 /api/ps` |
| `offload.gpuBytes` | Bytes of this model on the GPU |
| `offload.cpuBytes` | Bytes of this model in host RAM instead. **`0` is a real, measured value** |
| `offload.runtimeReportedText` | The runtime's own words, verbatim, e.g. `100% GPU` — kept so a reader can check the derived percentage against what the tool actually printed |
| `note` | **Free text**, for conditions no schema anticipates: another GPU application open, a laptop on battery, a thermal throttle. Explicitly `null` when there is nothing to say |

**Units are in the field names.** Every numeric field ends in `Bytes` or `Percent`. A number whose
unit a reader has to guess is a fabrication risk: `vramUsed: 5491` is bytes, MiB or GB depending on
who wrote it, and nothing in the file says which.

**Validation is strict, and a missing file is not an error.** The two halves of that sentence are both
load-bearing:

- **A file that exists must be complete and well-formed, or the report refuses to run.** Every
  measurement field is *required and nullable*: a sampler that could not read a quantity must write
  `null`, and a sampler that **omits** the key has a bug. Unknown keys are rejected (the schema is
  closed, like the corpus and the tool schemas). `vramUsedBytes` above `vramTotalBytes` is rejected as
  a MiB-for-bytes mix-up. This is deliberately *harsher* than `readRun`, which swallows a corrupt run
  file: a dropped run shows up as a missing scenario in the completeness counts where a reader will see
  it, but a dropped environment record would look exactly like "nobody sampled it".
- **A missing file is a normal, expected state.** Not every run is sampled. The report prints
  `not measured` and says how many models lack a record.

**Where `not measured` appears in the output.**

| Output | How an unsampled quantity appears |
| --- | --- |
| `COMPARISON.md` § 7, § 8 | The literal string `not measured` in the cell. Never `0`, never `0.00`, never a blank |
| `results.json` → `environment.models[].quantities.<key>` | `{"n": 0, "min": null, "median": null, "max": null}` — `null`, matching the file's existing "a metric with no observations is `null`, never `0`" rule |
| `results.json` → `environment.models[].notMeasured` | An explicit **list of the quantity keys** that were not sampled. This is the machine-readable form of the `not measured` cell: a bare `null` cannot distinguish "not sampled" from "this key is newer than your reader", so the list is stated outright |
| `results.json` → `environment.models[].recordPresent` | `false` when no record exists at all. Distinguishes *the sampler never ran* from *the sampler ran and saw nothing* — both print `not measured`, but only the second can carry a `note` explaining why |

### 9.4 Judging is a separate phase, after all generation

Run the five generation passes with `--skip-judge`, then judge afterwards, in a second pass over the
already-recorded runs.

**The command, in full.** Once per candidate, after all five have generated:

```bash
npm run eval:run -- --model <tag> --num-ctx 16384     # no --force, no --skip-judge
```

`--num-ctx` is repeated only so the console header does not misreport the window; judging re-reads
recorded runs and does not re-generate at either width.

**The flags are the whole point, so they are spelled out.**

| Flag | In this pass | Why |
| --- | --- | --- |
| `--force` | **NEVER** | It is what makes the run regenerate. With it, all 21 scenarios of the candidate are re-run from scratch and the measured records — the ones the step-7 sampler described — are overwritten by a pass nobody sampled. This is the one step of § 9.2 where the step-8 rule is inverted |
| `--skip-judge` | **NEVER** | It suppresses exactly the phase this pass exists to run |
| `--model` | Yes, one per invocation | Mirrors step 8, so a run can be stopped and resumed one candidate at a time. Omitting it judges all five in one invocation and is equally correct — the loop is per judge model within a candidate either way, so each judge still loads once per candidate rather than once per scenario |

**Why a plain resume IS the judging pass, and why there is no separate CLI for it.** A resume skips
every `(model, scenario)` already on disk — and `runModel` recognises the case this creates: a record
that has turns but **no verdicts** is a run interrupted between the two phases, so its scenario id goes
into the judging queue even though nothing was generated for it (`src/eval/runner/runModel.ts`, the
`hasRun` branch). After step 8 that describes *every* record, so a resume generates nothing, judges
everything, and touches no latency number. A judge-only entry point would be a second spelling of the
same code path with its own way of going stale.

**How to tell it worked.** Every scenario logs `already recorded, skipping` in phase 1 — that line is
the confirmation, not a warning — and the per-model summary reads `0 run, 21 skipped`. A summary
reporting anything other than `0 run` means `--force` was passed and the generation pass was discarded;
stop, and treat the sweep as void per § 9.6.

Two reasons the phases are separated, and the second is the one that actually forces it:

1. **The judges are themselves 7–8B models** (§ 7). Judging inline means loading a judge between
   candidate scenarios, evicting the candidate from VRAM, and reloading it — so the candidate's
   measured load time and latency include being repeatedly thrown out of memory by the scoring
   machinery. That is an artefact of the harness, not of the model.
2. **`qwen2.5:7b-instruct` and `llama3.1:8b-instruct-q4_K_M` are judges *and* candidates.** Inline
   judging means those two are resident as judges during their own runs and not during the other
   three, so the VRAM pressure differs by candidate in a way that correlates with which candidate it
   is. No amount of care in reading the table fixes that; only separating the phases does.

Judging re-reads the recorded runs and writes verdicts back into them, so it changes no generated
text and no latency number.

### 9.5 The output is committed side by side, not on top

The fresh directory is committed **next to** `eval-output/`, not merged into it. The preliminary
results are the baseline the fresh run is compared against; overwriting them destroys the comparison
in order to report it. Both directories keep the same internal layout (§ 8), so the same reader and the
same tooling work on either.

### 9.6 The comparison is INVALID if any of this happened

State it in the report rather than quietly shipping the table. Every item below is a reason to discard
the cross-model ranking — the per-model results may still be useful on their own.

- **Conditions changed mid-run.** Another application opened or closed, the machine was unplugged, a
  driver was updated, a pull ran, the host was rebooted between candidates. This is the general case
  and it subsumes most of what follows.
- **The candidates did not all run at the same `num_ctx`.** `COMPARISON.md` § 7 detects this from the
  records and says so.
- **The corpus or rubric version changed mid-sweep.** Different scenarios or different weights mean
  the scores are not on one scale. Both are recorded on every run for exactly this check.
- **Any model was resumed rather than re-run** *in the generation pass* (step 8). Without `--force`
  there, records made under the old conditions are silently reused. This does **not** apply to the
  judging pass at step 11, which is *required* to be a resume: it must skip every recorded scenario, and
  passing `--force` to it is its own entry on this list — see the next one.
- **`--force` was passed to the judging pass**, re-generating the runs instead of judging them. The
  generated text and the latencies then come from a pass the step-7 sampler never watched, while § 7
  still reports the conditions of the discarded one. § 9.4 says how to check: the summary must read
  `0 run`.
- **Models were run concurrently**, or a model was not unloaded before the next one started. The
  second model's weights may have been pushed into system RAM by the first.
- **Judging ran inline** with generation — i.e. step 8 was run without `--skip-judge`, so judges were
  evicting the candidate while its latency was being measured (§ 9.4). Step 11 also omits
  `--skip-judge`, and that is not this: by then there is nothing left to generate.
- **A model spilled into system RAM.** `COMPARISON.md` § 8 reports this per model. Either free VRAM
  and re-run it, or state the spill next to every speed claim about it.
- **Conditions were not recorded at all.** `not measured` for a model means its § 6 row is
  uncomparable — a gap in the evidence, not a clean result. The report says this explicitly rather
  than letting the absence read as an absence of problems.

A partially-invalid sweep is still worth keeping: record *which* models are affected and *why*, and
report the rest. What must not happen is a five-row table that looks like a ranking and is not one.

---

## 10. Results

<!-- RESULTS:BEGIN -->

This section is an **index to the evidence, not the analysis.** Every figure below is copied verbatim
from the committed artefacts at the precision they record it. The argument these numbers support — why
one model is recommended, what its worst behaviour is, and what no model earned — is in
[`docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md`](docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md) § 5.

### 10.1 Where the evidence is

```
eval-output-fair-20260927/
  results.json                         machine-readable - schema schedule-ai-voice/eval-results@2
  COMPARISON.md                        the human-readable side-by-side
  transcripts/<model>/<scenario>.md    every conversation, with its judge verdicts
  environment/<model-slug>.json        host conditions per run, written EXTERNALLY (§ 9.3)
```

Five `environment/` records, one per candidate, all present — `recordPresent: true` and an empty
`notMeasured` list for all five, so no cell in `COMPARISON.md` § 7 or § 8 reads `not measured`.
`runs/` is absent by design: it is gitignored (§ 8).

### 10.2 Run identity

| | |
| --- | --- |
| Output directory | `eval-output-fair-20260927/` |
| Generated | `2026-09-27T09:07:29.898Z` |
| `runId` | `fairness-sweep-2026-09-27` — identical across all five `environment/` records |
| Harness | `1.1.0` |
| Corpus | `1.1.0` |
| Rubric | `1.1.0` |
| Judge prompt | `1.0.0` |
| `num_ctx` | **16384 for all five candidates**, recorded per model in `environment/` so the rule can be verified rather than trusted |
| Scenarios | **21**, covering all 26 required shapes |
| Candidates | `qwen2.5:7b-instruct`, `hermes3:8b`, `mistral:7b-instruct`, `llama3.1:8b-instruct-q4_K_M`, `aya-expanse:8b` |
| Judges | `qwen2.5:7b-instruct` and `llama3.1:8b-instruct-q4_K_M` — both also candidates (§ 9.4) |

### 10.3 The gates

**Manufactured timestamps** (`COMPARISON.md` § 1.1) — denominator is all 65 turns:

| Model | Turns | Gate failures | Rate | Verdict |
| --- | ---: | ---: | ---: | --- |
| `qwen2.5:7b-instruct` | 65 | 0 | 0.0% | **PASS** |
| `hermes3:8b` | 65 | 0 | 0.0% | **PASS** |
| `mistral:7b-instruct` | 65 | 0 | 0.0% | **PASS** |
| `llama3.1:8b-instruct-q4_K_M` | 65 | 1 | 1.5% | **FAIL** |
| `aya-expanse:8b` | 65 | 2 | 3.1% | **FAIL** |

**Wrong-day resolution** (`COMPARISON.md` § 1.2) — denominator is turns where a day was asserted *and*
an instant resolved, which is why three rows carry no rate at all:

| Model | Turns where a day was asserted and an instant resolved | Wrong day | Rate | Verdict |
| --- | ---: | ---: | ---: | --- |
| `qwen2.5:7b-instruct` | 1 | 0 | 0.0% | **PASS** |
| `hermes3:8b` | 0 | 0 | n/a | not exercised |
| `mistral:7b-instruct` | 0 | 0 | n/a | not exercised |
| `llama3.1:8b-instruct-q4_K_M` | 2 | 0 | 0.0% | **PASS** |
| `aya-expanse:8b` | 0 | 0 | n/a | not exercised |

**No run ended in a booking on a day the contact did not name.** `not exercised` is **not a pass** and
must not be quoted as one: that model was refused by the resolver, or never reached a time-bearing tool,
and is credited with nothing.

### 10.4 Composite ranking

Weights: Conversation quality 55%, Tool and structural correctness 30%, Language quality 15%. **A model
failing either gate is ranked below every model that passes both, whatever its score** — which is why
rows 4 and 5 carry higher composites than row 3.

| # | Model | Composite | Conversation | Tool/structural | Language | Fabrication gate | Wrong-day gate |
| ---: | --- | ---: | ---: | ---: | ---: | --- | --- |
| 1 | `qwen2.5:7b-instruct` | 88.2% | 85.2% | 93.1% | 89.5% | pass | pass |
| 2 | `hermes3:8b` | 82.1% | 77.7% | 83.8% | 94.5% | pass | n/a |
| 3 | `mistral:7b-instruct` | 51.9% | 33.6% | 76.0% | 70.9% | pass | n/a |
| 4 | `llama3.1:8b-instruct-q4_K_M` | 80.8% | 75.9% | 84.4% | 91.7% | **FAIL** | pass |
| 5 | `aya-expanse:8b` | 71.6% | 71.0% | 64.3% | 88.0% | **FAIL** | n/a |

Conversation and Language contain judged dimensions and are **part opinion**. Tool/structural is
entirely programmatic and entirely reproducible. Judge failures: **0** for all five.

**Run completeness** (`COMPARISON.md` § 9) — all five ran 21 scenarios and 65 turns, but two did not
complete cleanly: `hermes3:8b` records 20 OK / 0 errored, and `mistral:7b-instruct` records
**13 OK / 2 errored**. Every other candidate records 21 OK / 0 errored.

### 10.5 Three of the five did NOT fit entirely on the 8 GB GPU

Straight from `COMPARISON.md` § 8, as the local runtime reported it while the model was resident:

| Model | Resident (GiB) | On GPU (GiB) | In system RAM (GiB) | On GPU (%) | Runtime said |
| --- | ---: | ---: | ---: | ---: | --- |
| `qwen2.5:7b-instruct` | 5.09 | 5.09 | 0.00 | 100.0% | `100% GPU` |
| `hermes3:8b` | 6.52 | 5.86 | 0.66 | 89.9% | `10%/90% CPU/GPU` |
| `mistral:7b-instruct` | 6.26 | 5.77 | 0.49 | 92.2% | `8%/92% CPU/GPU` |
| `llama3.1:8b-instruct-q4_K_M` | 6.76 | 5.88 | 0.88 | 87.0% | `13%/87% CPU/GPU` |
| `aya-expanse:8b` | 5.81 | 5.81 | 0.00 | 100.0% | `100% GPU` |

**3 model(s) did not fit entirely on the GPU:** `hermes3:8b` (0.66 in system RAM),
`mistral:7b-instruct` (0.49 in system RAM), `llama3.1:8b-instruct-q4_K_M` (0.88 in system RAM). Only
`qwen2.5:7b-instruct` and `aya-expanse:8b` were held **entirely in VRAM**. The device reported
8.00 GiB total throughout, for every candidate.

### 10.6 Consistency with § 9.6 — one invalidator applies, and it is the spill

§ 9.6 is the list of things that make the cross-model comparison invalid. Checked item by item against
this run, **one of them applies.**

- **A model spilled into system RAM — YES, THIS APPLIES, to three of the five (§ 10.5).** § 9.6 gives
  two remedies: free VRAM and re-run, or *state the spill next to every speed claim about it.* The
  second was taken, and it is stated here rather than written around: **`COMPARISON.md` § 6 is not a
  latency ranking for `hermes3:8b`, `mistral:7b-instruct` or `llama3.1:8b-instruct-q4_K_M`.** Each of
  those three pays a PCIe round trip per token that the two resident models do not, so their TTFT,
  turn-latency and tok/s figures describe the 8 GB card as much as the model. The quality scores in
  § 10.3 and § 10.4 are unaffected — a spill changes how fast a model answers, not what it says.
- Conditions changed mid-run — no. All five `environment/` notes record the same conditions: Unreal
  Editor and Blender **closed for every candidate**, GPU otherwise idle apart from desktop apps holding
  no VRAM, the Docker Desktop WSL VM and the agent-server container running, no mission active during
  generation.
- The candidates did not all run at the same `num_ctx` — no. 16,384 for all five, recorded per model.
- The corpus or rubric version changed mid-sweep — no. Corpus `1.1.0` and rubric `1.1.0` throughout.
- Any model was resumed rather than re-run *in the generation pass* — no. Generation was forced for
  every candidate.
- `--force` was passed to the judging pass — no. Judging was a resume, as § 9.4 requires.
- Models were run concurrently, or one was not unloaded before the next started — no. Sequential, one
  model resident at a time, with the runtime **verified empty before each candidate.**
- Judging ran inline with generation — no. Generation ran with `--skip-judge`; judging was a separate
  phase after all five had generated.
- Conditions were not recorded at all — no. Five records, all present, nothing `not measured`.

Per § 9.6's own closing rule, a partially-invalid sweep is worth keeping as long as it says *which*
models are affected and *why*: the three spilled models are named above, the affected table is
`COMPARISON.md` § 6, and the quality ranking stands.

### 10.7 The fairness protocol was followed — and one operator irregularity, disclosed

§ 9.2 was followed: one output directory per sweep, all five candidates generated **sequentially** with
one model resident at a time and the runtime verified empty before each, the same `num_ctx` 16384 for
all five, generation forced, judging run as a **separate phase after all generation**, one corpus and
rubric version throughout, and host conditions sampled **externally** into `environment/`. The run was
made on the tree that carries the Mission 2B Hebrew wrong-day fix.

> **OPERATOR DISCLOSURE — `llama3.1:8b-instruct-q4_K_M` was judged in a second pass.** A
> variable-scoping bug in the host sweep driver **skipped `llama3.1:8b-instruct-q4_K_M` judging on the
> first pass**, so that candidate was judged in a second, judging-only pass afterwards.
> **Generation and host conditions were not affected**: no candidate was re-generated, no
> `environment/` record describes a discarded pass, and every latency figure was fixed during
> generation and only re-read.
>
> **This is not one of the § 9.6 invalidators, and the reason is in § 9.4 rather than a judgement
> call.** Judging is *required* to be a resume: a record that has turns but no verdicts is exactly the
> case `runModel` puts into the judging queue, so a second judging-only pass over unjudged records is
> the designed path, not a workaround. `--force` was not passed, so nothing was re-generated. Judging
> re-reads recorded runs and writes verdicts back, changing no generated text and no latency number,
> and the judges' own latency is never reported. `results.json` records **0 judge failures** for all
> five candidates, so no scenario went unjudged. It is recorded here because an undisclosed deviation
> from a protocol is worse than a disclosed one, not because it costs the comparison anything.
> The review discusses it at
> [`docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md`](docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md)
> § 6.3.1.

### 10.8 The earlier `eval-output/` run is preliminary and NOT comparable

`eval-output/` is kept, committed, and **must not be read alongside the tables above.** It is the
earlier, preliminary run, retained per § 9.5 because the fresh directory is committed *next to* it
rather than on top of it. It is not comparable for reasons that are structural, not presentational:

- it covers **three** of the five candidates, not five, so it has no cross-model ranking to compare;
- its runs were **not all produced under recorded conditions**, which is the gap § 9.1 and § 9.3 exist
  to close — conditions cannot be reconstructed after a run has finished;
- it predates the fixes this tree carries, including the Mission 2B Hebrew wrong-day resolver fix, so
  its wrong-day and Hebrew numbers describe superseded application code.

Treat it as history. The comparison of record is `eval-output-fair-20260927/`, and the review's
discussion of why the earlier run does not count is at
[`docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md`](docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md) § 5.4.

<!-- RESULTS:END -->
