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

**Layer A was not touched.** `ScriptedLlmProvider` is unchanged, no LLM call was added to anything the
test suite or the sweep executes, and the numbers are the same as before this work:

```
npm test          500 passed | 2 skipped
npm run qa:sweep  601 scenarios, 0 violations, 0 network attempts
```

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

Useful flags on `eval:run`:

| Flag | Effect |
| --- | --- |
| `--model <tag>` | Restrict to one model. Repeatable. |
| `--scenario <id>` | Restrict to one scenario. Repeatable. |
| `--force` | Re-run scenarios that already have a recorded result. |
| `--skip-judge` | Programmatic results only. Roughly 3x faster. |
| `--baseline-context` | Run the Baseline V1 context path instead of the production one. |
| `--num-ctx <n>` | Override the context window. |

Environment: `LOCAL_LLM_BASE_URL` (default `http://host.docker.internal:11434` - inside a container
`localhost` is the container), `EVAL_OUT_DIR`, `EVAL_NUM_CTX`.

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
parser table and the end-to-end repro, is `FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 8.3.

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
  runs/<model>/<scenario>.json         gitignored raw per-run records (large, regenerable)
```

The first four are meant to be **committed** next to the Founder Review — a judged score nobody can
check against its transcript is not evidence. `runs/` is gitignored: it is large, it is regenerable,
and it is the resume checkpoint rather than a result.

> **This is not a formality.** All 57 of those files were dropped during the branch merge that carried
> the Founder Review, so for three branches the review cited evidence that was not in the repository.
> `.gitignore` has one line for this (`eval-output/runs/`) and it means what it says: everything else
> under `eval-output/` is committed. Restored — see `FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 5.2.

`results.json` carries the harness, corpus, rubric and judge-prompt versions, the full rubric with
weights and rationales, the candidate set and the rejected list, the coverage map, the per-model
aggregates and the per-scenario breakdown. Nothing in it is fabricated: a metric with no observations
is `null`, never `0`, and every aggregate carries its own `n`.

No new database tables were added. `prisma/schema.prisma` is untouched.

---

## 9. Results

<!-- RESULTS:BEGIN -->
_Populated by the completed benchmark run - see below._
<!-- RESULTS:END -->
