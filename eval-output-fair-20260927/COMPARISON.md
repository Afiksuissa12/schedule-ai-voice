# Local model comparison - Schedule AI Voice, Mission 2

Generated 2026-09-27T09:07:29.898Z

Harness `1.1.0` &middot; corpus `1.1.0` &middot; rubric `1.1.0` &middot; judge prompt `1.0.0`

Every number below comes from a real run against a real local model through the real `AgentTurnService`, the real nine tool schemas and the real `ToolDispatcher`. Transcripts for every conversation are committed next to this file.

## 1. The gates

### 1.1 Manufactured timestamps

> A turn fails the gate when a time-bearing tool argument contains a resolved absolute date or instant (ISO date, ISO datetime, numeric date with a year, month-name date with a year, or a Unix epoch) that does NOT appear in anything the contact said. Passing the contact's own words through - including a date the contact themselves stated - is correct and does not trip the gate.

> **Consequence:** The turn scores zero for the whole tool-and-structural category. The per-model rate is reported as a headline metric, and a model with a non-zero rate must not be adopted as the default without an explicit Founder decision.

| Model | Turns | Gate failures | Rate | Verdict |
| --- | ---: | ---: | ---: | --- |
| `qwen2.5:7b-instruct` | 65 | 0 | 0.0% | **PASS** |
| `hermes3:8b` | 65 | 0 | 0.0% | **PASS** |
| `mistral:7b-instruct` | 65 | 0 | 0.0% | **PASS** |
| `llama3.1:8b-instruct-q4_K_M` | 65 | 1 | 1.5% | **FAIL** |
| `aya-expanse:8b` | 65 | 2 | 3.1% | **FAIL** |

Findings, verbatim:

- `llama3.1:8b-instruct-q4_K_M` - adversarial-guardrail turn 1: schedule_meeting.when = "2024-03-05 14:00" (iso-datetime)
- `llama3.1:8b-instruct-q4_K_M` - adversarial-guardrail turn 1: schedule_meeting.when = "2024-03-05" (iso-date)
- `llama3.1:8b-instruct-q4_K_M` - adversarial-guardrail turn 1: schedule_meeting.when = "2026-03-05 14:00" (iso-datetime)
- `llama3.1:8b-instruct-q4_K_M` - adversarial-guardrail turn 1: schedule_meeting.when = "2026-03-05" (iso-date)
- `aya-expanse:8b` - reschedule-existing-meeting turn 2: check_availability.when = "6 March 2026" (day-month-name-with-year)
- `aya-expanse:8b` - vague-next-week turn 1: schedule_meeting.when = "10 March 2026" (day-month-name-with-year)
- `aya-expanse:8b` - vague-next-week turn 1: check_availability.when = "10 March 2026" (day-month-name-with-year)

### 1.2 Bookings resolved onto the wrong calendar day

> A turn fails the gate when the corpus states which calendar day the contact named and a time-bearing tool was nonetheless ACCEPTED for a different local calendar day. Comparison is on the local date in the zone the slot resolved in. A refusal is NOT a failure here: refusing a `when` this product cannot resolve asks the contact again and books nothing, which is the safe outcome. Only a booking that happened, on the wrong day, trips it.

> **Consequence:** The turn scores zero for the whole tool-and-structural category, and the model is ranked below every model that trips no gate. THIS GATE GRADES APPLICATION CODE, NOT THE MODEL: a non-zero rate here is a product defect in the resolver, and the run that produced it is evidence about `src/scheduling/`, not about the candidate. It is scored inside the model comparison anyway because this harness is the only place the whole chain runs end to end, and a wrong-day booking nothing reports is worse than a refusal everything reports.

| Model | Turns where a day was asserted and an instant resolved | Wrong day | Rate | Verdict |
| --- | ---: | ---: | ---: | --- |
| `qwen2.5:7b-instruct` | 1 | 0 | 0.0% | **PASS** |
| `hermes3:8b` | 0 | 0 | n/a | not exercised |
| `mistral:7b-instruct` | 0 | 0 | n/a | not exercised |
| `llama3.1:8b-instruct-q4_K_M` | 2 | 0 | 0.0% | **PASS** |
| `aya-expanse:8b` | 0 | 0 | n/a | not exercised |

No run ended in a booking on a day the contact did not name. Note the denominator: a model that was refused by the resolver, or that never reached a time-bearing tool, contributes nothing here - it is not credited with a pass it did not earn.

## 2. Composite ranking

Weights: Conversation quality 55%, Tool and structural correctness 30%, Language quality 15%. Conversation quality dominates by design - a technically correct model that sounds robotic must not win. **A model failing either gate is ranked below every model that passes both, whatever its score.**

| # | Model | Composite | Conversation | Tool/structural | Language | Fabrication gate | Wrong-day gate |
| ---: | --- | ---: | ---: | ---: | ---: | --- | --- |
| 1 | `qwen2.5:7b-instruct` | 88.2% | 85.2% | 93.1% | 89.5% | pass | pass |
| 2 | `hermes3:8b` | 82.1% | 77.7% | 83.8% | 94.5% | pass | n/a |
| 3 | `mistral:7b-instruct` | 51.9% | 33.6% | 76.0% | 70.9% | pass | n/a |
| 4 | `llama3.1:8b-instruct-q4_K_M` | 80.8% | 75.9% | 84.4% | 91.7% | **FAIL** | pass |
| 5 | `aya-expanse:8b` | 71.6% | 71.0% | 64.3% | 88.0% | **FAIL** | n/a |

_Conversation and Language contain judged dimensions and are therefore part opinion. Tool/structural is entirely programmatic and entirely reproducible._

## 3. Programmatic results (measured, reproducible)

| Model | Tool selection | Arg validity | No hallucinated ids | No unnecessary calls | Sched. intent | Structured output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 88.0% <sub>n=54</sub> | 100.0% <sub>n=8</sub> | 87.5% <sub>n=8</sub> | 100.0% <sub>n=54</sub> | 89.5% <sub>n=19</sub> | 100.0% <sub>n=8</sub> |
| `hermes3:8b` | 95.4% <sub>n=54</sub> | 90.0% <sub>n=30</sub> | 43.3% <sub>n=30</sub> | 88.9% <sub>n=54</sub> | 89.5% <sub>n=19</sub> | 100.0% <sub>n=30</sub> |
| `mistral:7b-instruct` | 75.9% <sub>n=54</sub> | n/a | n/a | 100.0% <sub>n=54</sub> | 47.4% <sub>n=19</sub> | n/a |
| `llama3.1:8b-instruct-q4_K_M` | 76.5% <sub>n=54</sub> | 87.3% <sub>n=65</sub> | 99.6% <sub>n=65</sub> | 68.1% <sub>n=54</sub> | 94.7% <sub>n=19</sub> | 100.0% <sub>n=65</sub> |
| `aya-expanse:8b` | 78.1% <sub>n=54</sub> | 14.6% <sub>n=41</sub> | 97.6% <sub>n=41</sub> | 77.8% <sub>n=54</sub> | 63.2% <sub>n=19</sub> | 80.9% <sub>n=47</sub> |

| Model | Content expectations | Length budget | Non-repetitive | Language match |
| --- | ---: | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 92.9% <sub>n=56</sub> | 98.0% <sub>n=50</sub> | 100.0% <sub>n=65</sub> | 81.5% <sub>n=65</sub> |
| `hermes3:8b` | 86.2% <sub>n=58</sub> | 92.4% <sub>n=50</sub> | 99.6% <sub>n=65</sub> | 98.5% <sub>n=65</sub> |
| `mistral:7b-instruct` | 13.0% <sub>n=54</sub> | 14.2% <sub>n=50</sub> | 82.4% <sub>n=65</sub> | 61.5% <sub>n=65</sub> |
| `llama3.1:8b-instruct-q4_K_M` | 81.4% <sub>n=59</sub> | 94.5% <sub>n=50</sub> | 97.9% <sub>n=65</sub> | 89.2% <sub>n=65</sub> |
| `aya-expanse:8b` | 57.8% <sub>n=58</sub> | 75.3% <sub>n=50</sub> | 100.0% <sub>n=65</sub> | 81.5% <sub>n=65</sub> |

**Tool-call health, straight from the provider:**

| Model | Native | Recovered from text | Malformed (refused) | Malformed rate |
| --- | ---: | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 8 | 0 | 0 | 0.0% |
| `hermes3:8b` | 30 | 0 | 0 | 0.0% |
| `mistral:7b-instruct` | 0 | 0 | 0 | n/a |
| `llama3.1:8b-instruct-q4_K_M` | 74 | 0 | 0 | 0.0% |
| `aya-expanse:8b` | 36 | 8 | 6 | 12.0% |

## 4. Judged results (opinion, not measurement)

Judges: `qwen2.5:7b-instruct` and `llama3.1:8b-instruct-q4_K_M`. Both are themselves candidates, both are 7-8B models grading 7-8B models, and both read the same committed transcripts a human can read. **These are opinions.** The `judge disagreement` column is the mean absolute difference between the two judges across all dimensions, on the 0-5 scale: where it is large, this harness cannot resolve the dimension and the transcripts should be read directly.

| Model | Naturalness | Relevance | Contextual awareness | Remembers earlier information | Conversational continuity | Sensible follow-up questions | Avoids mechanical interrogation | Reacts well to unexpected input | Continues naturally after a tool result | Sales quality without sounding scripted | Recovers after a topic change | Quality of the language produced | Judge disagreement | Judge failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 77.6% <sub>n=21</sub> | 92.4% <sub>n=21</sub> | 80.0% <sub>n=21</sub> | 65.6% <sub>n=16</sub> | 88.1% <sub>n=21</sub> | 80.0% <sub>n=21</sub> | 95.2% <sub>n=21</sub> | 88.3% <sub>n=6</sub> | 95.7% <sub>n=7</sub> | 61.9% <sub>n=21</sub> | 85.0% <sub>n=2</sub> | 94.8% <sub>n=21</sub> | 0.59 | 0 |
| `hermes3:8b` | 71.0% <sub>n=21</sub> | 83.8% <sub>n=21</sub> | 70.5% <sub>n=21</sub> | 51.9% <sub>n=16</sub> | 78.1% <sub>n=21</sub> | 71.0% <sub>n=21</sub> | 88.6% <sub>n=21</sub> | 86.7% <sub>n=6</sub> | 85.3% <sub>n=17</sub> | 55.2% <sub>n=21</sub> | 90.0% <sub>n=2</sub> | 91.9% <sub>n=21</sub> | 1.10 | 0 |
| `mistral:7b-instruct` | 40.0% <sub>n=21</sub> | 36.2% <sub>n=21</sub> | 35.2% <sub>n=21</sub> | 13.8% <sub>n=16</sub> | 33.3% <sub>n=21</sub> | 22.4% <sub>n=21</sub> | 55.2% <sub>n=21</sub> | 43.3% <sub>n=6</sub> | n/a | 22.9% <sub>n=21</sub> | 25.0% <sub>n=2</sub> | 77.1% <sub>n=21</sub> | 1.26 | 0 |
| `llama3.1:8b-instruct-q4_K_M` | 70.0% <sub>n=21</sub> | 85.7% <sub>n=21</sub> | 71.0% <sub>n=21</sub> | 57.5% <sub>n=16</sub> | 77.1% <sub>n=21</sub> | 63.3% <sub>n=21</sub> | 90.0% <sub>n=21</sub> | 75.0% <sub>n=6</sub> | 88.1% <sub>n=21</sub> | 49.5% <sub>n=21</sub> | 65.0% <sub>n=2</sub> | 93.3% <sub>n=21</sub> | 1.06 | 0 |
| `aya-expanse:8b` | 68.1% <sub>n=21</sub> | 81.4% <sub>n=21</sub> | 66.7% <sub>n=21</sub> | 51.3% <sub>n=16</sub> | 73.3% <sub>n=21</sub> | 61.0% <sub>n=21</sub> | 89.0% <sub>n=21</sub> | 75.0% <sub>n=6</sub> | 84.4% <sub>n=18</sub> | 51.4% <sub>n=21</sub> | 60.0% <sub>n=2</sub> | 92.4% <sub>n=21</sub> | 1.10 | 0 |

**Each judge separately - look for self-preference.**

Both judges are also candidates. If a judge marks its own row materially higher than the other judge does, that is self-preference and the composite for that model should be discounted accordingly. Their own rows are marked.

| Model | Judged by `qwen2.5:7b-instruct` | Judged by `llama3.1:8b-instruct-q4_K_M` | Difference |
| --- | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 79.9% **(self)** | 85.8% | 5.9% |
| `hermes3:8b` | 65.5% | 85.6% | 20.2% |
| `mistral:7b-instruct` | 34.8% | 41.3% | 6.5% |
| `llama3.1:8b-instruct-q4_K_M` | 68.6% | 81.1% **(self)** | 12.5% |
| `aya-expanse:8b` | 62.8% | 81.6% | 18.9% |

## 5. Composite by language

| Model | English | Hebrew | Mixed |
| --- | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 91.1% | 78.4% | 78.7% |
| `hermes3:8b` | 84.8% | 72.6% | 79.1% |
| `mistral:7b-instruct` | 59.7% | 31.7% | 37.1% |
| `llama3.1:8b-instruct-q4_K_M` | 81.4% | 81.3% | 81.4% |
| `aya-expanse:8b` | 68.1% | 73.6% | 79.6% |

## 6. Latency and throughput

Every turn ran through the STREAMING path, so time-to-first-token is real rather than inferred. `TTFT` is the first provider call of a turn - what a caller on a phone perceives. `Total` is the whole agent turn including every tool round-trip and the database writes, which is the number that decides whether this is usable for voice. `tok/s` is generation only, excluding prompt evaluation and model load, as the provider reports it.

**Do not compare these rows without reading section 7 and section 8 first.** Every number in this table is a property of the machine as much as of the model. A candidate benchmarked while another application held VRAM, or one whose weights spilled into system RAM, is slower for reasons that have nothing to do with its quality.

| Model | TTFT p50 | TTFT p95 | Turn p50 | Turn p95 | tok/s | Prompt tokens (mean / max) | Ctx util (mean / max) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 98 ms | 2,271 ms | 2,410 ms | 4,213 ms | 50.2 | 7,502 / 11,539 | 45.8% / 70.4% |
| `hermes3:8b` | 174 ms | 1,263 ms | 2,837 ms | 11,254 ms | 40.4 | 2,837 / 4,318 | 17.3% / 26.4% |
| `mistral:7b-instruct` | 4,304 ms | 4,713 ms | 16,493 ms | 120,122 ms | 32.8 | 8,295 / 10,158 | 50.6% / 62.0% |
| `llama3.1:8b-instruct-q4_K_M` | 4,299 ms | 6,702 ms | 6,649 ms | 11,617 ms | 30.2 | 8,068 / 10,217 | 49.2% / 62.4% |
| `aya-expanse:8b` | 3,947 ms | 6,002 ms | 7,633 ms | 12,144 ms | 39.8 | 7,919 / 8,191 | 48.3% / 50.0% |

## 7. Machine conditions during each run (measured on the host)

Recorded by an **external host sampler**, not by this harness - `src/eval` runs in a container and would measure the container rather than the host whose GPU did the work. One file per model per run under `environment/` in this output directory, schema `1.0.0`.

Each cell is **min / median / max** across that run's samples. `not measured` means no sample carried the quantity. **It does not mean zero, and it is not a default** - a comparison whose conditions were never recorded is one nobody can defend, and saying so is the honest output.

| Model | Free RAM (GiB) | VRAM used (GiB) | VRAM total (GiB) | GPU util (%) | CPU load (%) | Samples | num_ctx |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 4.70 / 5.11 / 12.87 | 0.04 / 5.25 / 5.25 | 8.00 / 8.00 / 8.00 | 0.0% / 98.0% / 100.0% | 0.0% / 7.5% / 22.0% | 18 | 16,384 |
| `hermes3:8b` | 11.54 / 12.45 / 13.62 | 0.04 / 6.02 / 6.02 | 8.00 / 8.00 / 8.00 | 0.0% / 71.5% / 99.0% | 2.0% / 73.0% / 87.0% | 26 | 16,384 |
| `mistral:7b-instruct` | 4.74 / 5.66 / 13.34 | 0.04 / 5.94 / 5.94 | 8.00 / 8.00 / 8.00 | 0.0% / 67.0% / 100.0% | 0.0% / 77.0% / 94.0% | 196 | 16,384 |
| `llama3.1:8b-instruct-q4_K_M` | 4.00 / 4.65 / 13.30 | 0.04 / 6.04 / 6.04 | 8.00 / 8.00 / 8.00 | 0.0% / 62.0% / 100.0% | 0.0% / 25.5% / 88.0% | 32 | 16,384 |
| `aya-expanse:8b` | 4.33 / 5.51 / 13.50 | 0.04 / 5.97 / 5.97 | 8.00 / 8.00 / 8.00 | 0.0% / 98.0% / 100.0% | 0.0% / 3.0% / 29.0% | 33 | 16,384 |

**Conditions the sampler recorded in words:**

- `qwen2.5:7b-instruct` - Unreal Editor and Blender closed for every candidate; GPU otherwise idle apart from desktop apps holding no VRAM; Docker Desktop WSL VM and the agent-server container running; no AutonomousDevTeam mission active during generation.
- `hermes3:8b` - Unreal Editor and Blender closed for every candidate; GPU otherwise idle apart from desktop apps holding no VRAM; Docker Desktop WSL VM and the agent-server container running; no AutonomousDevTeam mission active during generation.
- `mistral:7b-instruct` - Unreal Editor and Blender closed for every candidate; GPU otherwise idle apart from desktop apps holding no VRAM; Docker Desktop WSL VM and the agent-server container running; no AutonomousDevTeam mission active during generation.
- `llama3.1:8b-instruct-q4_K_M` - Unreal Editor and Blender closed for every candidate; GPU otherwise idle apart from desktop apps holding no VRAM; Docker Desktop WSL VM and the agent-server container running; no AutonomousDevTeam mission active during generation.
- `aya-expanse:8b` - Unreal Editor and Blender closed for every candidate; GPU otherwise idle apart from desktop apps holding no VRAM; Docker Desktop WSL VM and the agent-server container running; no AutonomousDevTeam mission active during generation.

## 8. Offload split - how much of each model was on the GPU

As reported by the local runtime while the model was resident. A model held entirely in VRAM and a model whose weights spilled into system RAM are **not competing on the same terms**: the spilled one pays a PCIe round trip per token, and its latency in section 6 describes the spill rather than the model. This is the first thing to check before believing any speed difference between two candidates.

`not measured` means the local runtime's split was not recorded - never that it was 100% GPU.

| Model | Resident (GiB) | On GPU (GiB) | In system RAM (GiB) | On GPU (%) | Runtime said | Reported by |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `qwen2.5:7b-instruct` | 5.09 | 5.09 | 0.00 | 100.0% | `100% GPU` | ollama 0.34.3 /api/ps |
| `hermes3:8b` | 6.52 | 5.86 | 0.66 | 89.9% | `10%/90% CPU/GPU` | ollama 0.34.3 /api/ps |
| `mistral:7b-instruct` | 6.26 | 5.77 | 0.49 | 92.2% | `8%/92% CPU/GPU` | ollama 0.34.3 /api/ps |
| `llama3.1:8b-instruct-q4_K_M` | 6.76 | 5.88 | 0.88 | 87.0% | `13%/87% CPU/GPU` | ollama 0.34.3 /api/ps |
| `aya-expanse:8b` | 5.81 | 5.81 | 0.00 | 100.0% | `100% GPU` | ollama 0.34.3 /api/ps |

**3 model(s) did not fit entirely on the GPU:** `hermes3:8b` (0.66 in system RAM), `mistral:7b-instruct` (0.49 in system RAM), `llama3.1:8b-instruct-q4_K_M` (0.88 in system RAM). Their latency figures are not comparable with the models that fitted. Either free VRAM and re-run them, or state the spill next to every speed claim about them.

## 9. Run completeness

| Model | Scenarios | OK | Errored | Turns |
| --- | ---: | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 21 | 21 | 0 | 65 |
| `hermes3:8b` | 21 | 20 | 0 | 65 |
| `mistral:7b-instruct` | 21 | 13 | 2 | 65 |
| `llama3.1:8b-instruct-q4_K_M` | 21 | 21 | 0 | 65 |
| `aya-expanse:8b` | 21 | 21 | 0 | 65 |

Corpus: 21 scenarios covering all 26 required shapes.

## 10. Corpus coverage

| Required shape | Scenarios |
| --- | --- |
| `normal-introduction` | `intro-interested-lead`, `hebrew-intro-and-booking` |
| `interested-lead` | `intro-interested-lead`, `hebrew-intro-and-booking`, `hebrew-digit-clock-time` |
| `uninterested-lead` | `uninterested-lead`, `hebrew-price-objection` |
| `busy-right-now` | `busy-right-now`, `hebrew-busy-callback`, `mixed-digit-clock-time` |
| `what-does-the-company-do` | `what-does-the-company-do`, `hebrew-intro-and-booking`, `hebrew-digit-clock-time` |
| `unexpected-topic-change` | `topic-change-and-callback`, `mixed-hebrew-english` |
| `question-before-answering` | `what-does-the-company-do` |
| `incomplete-information` | `incomplete-information`, `mixed-hebrew-english` |
| `vague-next-week` | `vague-next-week`, `hebrew-busy-callback` |
| `tomorrow-afternoon` | `intro-interested-lead`, `hebrew-intro-and-booking`, `mixed-hebrew-english`, `hebrew-digit-clock-time`, `mixed-digit-clock-time` |
| `reschedule` | `reschedule-existing-meeting` |
| `cancellation` | `cancellation` |
| `not-decision-maker` | `not-decision-maker` |
| `price-objection` | `price-objection-interrupt`, `hebrew-price-objection` |
| `needs-to-consult-someone` | `not-decision-maker`, `hebrew-price-objection` |
| `call-again-in-several-days` | `busy-right-now`, `hebrew-busy-callback` |
| `reference-to-earlier-turn` | `topic-change-and-callback`, `resumed-session`, `mixed-hebrew-english` |
| `continuing-previous-session` | `resumed-session` |
| `language-english` | `intro-interested-lead`, `uninterested-lead`, `busy-right-now`, `what-does-the-company-do`, `vague-next-week`, `reschedule-existing-meeting`, `cancellation`, `not-decision-maker`, `price-objection-interrupt`, `topic-change-and-callback`, `incomplete-information`, `resumed-session`, `tool-failure-outside-hours`, `tool-failure-slot-taken`, `adversarial-guardrail` |
| `language-hebrew` | `hebrew-intro-and-booking`, `hebrew-busy-callback`, `hebrew-price-objection`, `hebrew-digit-clock-time` |
| `language-mixed` | `mixed-hebrew-english`, `mixed-digit-clock-time` |
| `ambiguous-date-time` | `vague-next-week`, `hebrew-busy-callback` |
| `interrupts-sales-direction` | `price-objection-interrupt`, `hebrew-price-objection` |
| `unexpected-product-question` | `what-does-the-company-do` |
| `tool-result-failure` | `tool-failure-outside-hours`, `tool-failure-slot-taken` |
| `adversarial-guardrail` | `adversarial-guardrail` |

