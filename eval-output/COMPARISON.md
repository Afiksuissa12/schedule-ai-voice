# Local model comparison - Schedule AI Voice, Mission 2

Generated 2026-09-23T18:33:40.167Z

Harness `1.0.0` &middot; corpus `1.0.0` &middot; rubric `1.0.0` &middot; judge prompt `1.0.0`

Every number below comes from a real run against a real local model through the real `AgentTurnService`, the real nine tool schemas and the real `ToolDispatcher`. Transcripts for every conversation are committed next to this file.

## 1. The gate: manufactured timestamps

> A turn fails the gate when a time-bearing tool argument contains a resolved absolute date or instant (ISO date, ISO datetime, numeric date with a year, month-name date with a year, or a Unix epoch) that does NOT appear in anything the contact said. Passing the contact's own words through - including a date the contact themselves stated - is correct and does not trip the gate.

> **Consequence:** The turn scores zero for the whole tool-and-structural category. The per-model rate is reported as a headline metric, and a model with a non-zero rate must not be adopted as the default without an explicit Founder decision.

| Model | Turns | Gate failures | Rate | Verdict |
| --- | ---: | ---: | ---: | --- |
| `qwen2.5:7b-instruct` | 59 | 0 | 0.0% | **PASS** |
| `llama3.1:8b-instruct-q4_K_M` | 59 | 0 | 0.0% | **PASS** |
| `mistral:7b-instruct` | 47 | 0 | 0.0% | **PASS** |

No candidate manufactured a timestamp on any turn. The passthrough architecture held for every model.

## 2. Composite ranking

Weights: Conversation quality 55%, Tool and structural correctness 30%, Language quality 15%. Conversation quality dominates by design - a technically correct model that sounds robotic must not win. **A model failing the gate is ranked below every model that passes it, whatever its score.**

| # | Model | Composite | Conversation | Tool/structural | Language | Gate |
| ---: | --- | ---: | ---: | ---: | ---: | --- |
| 1 | `qwen2.5:7b-instruct` | 88.4% | 84.3% | 93.3% | 93.5% | pass |
| 2 | `llama3.1:8b-instruct-q4_K_M` | 82.8% | 78.7% | 85.9% | 92.0% | pass |
| 3 | `mistral:7b-instruct` | 53.3% | 31.4% | 76.4% | 87.2% | pass |

_Conversation and Language contain judged dimensions and are therefore part opinion. Tool/structural is entirely programmatic and entirely reproducible._

## 3. Programmatic results (measured, reproducible)

| Model | Tool selection | Arg validity | No hallucinated ids | No unnecessary calls | Sched. intent | Structured output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 89.0% <sub>n=50</sub> | 100.0% <sub>n=7</sub> | 85.7% <sub>n=7</sub> | 98.0% <sub>n=50</sub> | 94.1% <sub>n=17</sub> | 100.0% <sub>n=7</sub> |
| `llama3.1:8b-instruct-q4_K_M` | 76.7% <sub>n=50</sub> | 87.7% <sub>n=57</sub> | 98.2% <sub>n=57</sub> | 66.0% <sub>n=50</sub> | 100.0% <sub>n=17</sub> | 100.0% <sub>n=57</sub> |
| `mistral:7b-instruct` | 76.9% <sub>n=39</sub> | n/a | n/a | 100.0% <sub>n=39</sub> | 46.7% <sub>n=15</sub> | n/a |

| Model | Content expectations | Length budget | Non-repetitive | Language match |
| --- | ---: | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 91.5% <sub>n=53</sub> | 99.7% <sub>n=46</sub> | 99.0% <sub>n=59</sub> | 91.5% <sub>n=59</sub> |
| `llama3.1:8b-instruct-q4_K_M` | 87.7% <sub>n=53</sub> | 97.4% <sub>n=46</sub> | 92.5% <sub>n=59</sub> | 84.7% <sub>n=59</sub> |
| `mistral:7b-instruct` | 15.4% <sub>n=39</sub> | 25.4% <sub>n=36</sub> | 65.3% <sub>n=47</sub> | 87.2% <sub>n=47</sub> |

**Tool-call health, straight from the provider:**

| Model | Native | Recovered from text | Malformed (refused) | Malformed rate |
| --- | ---: | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 8 | 0 | 0 | 0.0% |
| `llama3.1:8b-instruct-q4_K_M` | 57 | 0 | 0 | 0.0% |
| `mistral:7b-instruct` | 0 | 0 | 0 | n/a |

## 4. Judged results (opinion, not measurement)

Judges: `qwen2.5:7b-instruct` and `llama3.1:8b-instruct-q4_K_M`. Both are themselves candidates, both are 7-8B models grading 7-8B models, and both read the same committed transcripts a human can read. **These are opinions.** The `judge disagreement` column is the mean absolute difference between the two judges across all dimensions, on the 0-5 scale: where it is large, this harness cannot resolve the dimension and the transcripts should be read directly.

| Model | Naturalness | Relevance | Contextual awareness | Remembers earlier information | Conversational continuity | Sensible follow-up questions | Avoids mechanical interrogation | Reacts well to unexpected input | Continues naturally after a tool result | Sales quality without sounding scripted | Recovers after a topic change | Quality of the language produced | Judge disagreement | Judge failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 78.4% <sub>n=19</sub> | 92.1% <sub>n=19</sub> | 77.4% <sub>n=19</sub> | 64.3% <sub>n=14</sub> | 87.4% <sub>n=19</sub> | 81.1% <sub>n=19</sub> | 92.6% <sub>n=19</sub> | 90.0% <sub>n=6</sub> | 90.0% <sub>n=6</sub> | 63.2% <sub>n=19</sub> | 80.0% <sub>n=2</sub> | 94.7% <sub>n=19</sub> | 0.62 | 0 |
| `llama3.1:8b-instruct-q4_K_M` | 75.8% <sub>n=19</sub> | 87.9% <sub>n=19</sub> | 72.6% <sub>n=19</sub> | 52.9% <sub>n=14</sub> | 81.1% <sub>n=19</sub> | 71.1% <sub>n=19</sub> | 93.7% <sub>n=19</sub> | 80.0% <sub>n=6</sub> | 90.0% <sub>n=19</sub> | 50.0% <sub>n=19</sub> | 65.0% <sub>n=2</sub> | 96.8% <sub>n=19</sub> | 0.90 | 0 |
| `mistral:7b-instruct` | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0 |

**Each judge separately - look for self-preference.**

Both judges are also candidates. If a judge marks its own row materially higher than the other judge does, that is self-preference and the composite for that model should be discounted accordingly. Their own rows are marked.

| Model | Judged by `qwen2.5:7b-instruct` | Judged by `llama3.1:8b-instruct-q4_K_M` | Difference |
| --- | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 79.0% **(self)** | 85.6% | 6.6% |
| `llama3.1:8b-instruct-q4_K_M` | 73.1% | 82.5% **(self)** | 9.4% |
| `mistral:7b-instruct` | n/a | n/a | n/a |

## 5. Composite by language

| Model | English | Hebrew | Mixed |
| --- | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 89.4% | 80.9% | 84.7% |
| `llama3.1:8b-instruct-q4_K_M` | 87.3% | 80.1% | 59.9% |
| `mistral:7b-instruct` | 57.4% | 36.3% | n/a |

## 6. Latency and throughput

Every turn ran through the STREAMING path, so time-to-first-token is real rather than inferred. `TTFT` is the first provider call of a turn - what a caller on a phone perceives. `Total` is the whole agent turn including every tool round-trip and the database writes, which is the number that decides whether this is usable for voice. `tok/s` is generation only, excluding prompt evaluation and model load, as the provider reports it.

| Model | TTFT p50 | TTFT p95 | Turn p50 | Turn p95 | tok/s | Prompt tokens (mean / max) | Ctx util (mean / max) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 66 ms | 3,033 ms | 2,070 ms | 5,240 ms | 50.4 | 7,277 / 7,892 | 44.4% / 48.2% |
| `llama3.1:8b-instruct-q4_K_M` | 4,018 ms | 5,857 ms | 6,063 ms | 10,176 ms | 30.8 | 7,486 / 8,650 | 45.7% / 52.8% |
| `mistral:7b-instruct` | 4,355 ms | 4,565 ms | 13,267 ms | 120,141 ms | 33.0 | 8,228 / 9,140 | 50.2% / 55.8% |

## 7. Run completeness

| Model | Scenarios | OK | Errored | Turns |
| --- | ---: | ---: | ---: | ---: |
| `qwen2.5:7b-instruct` | 19 | 19 | 0 | 59 |
| `llama3.1:8b-instruct-q4_K_M` | 19 | 19 | 0 | 59 |
| `mistral:7b-instruct` | 16 | 14 | 0 | 47 |

Corpus: 19 scenarios covering all 26 required shapes.

## 8. Corpus coverage

| Required shape | Scenarios |
| --- | --- |
| `normal-introduction` | `intro-interested-lead`, `hebrew-intro-and-booking` |
| `interested-lead` | `intro-interested-lead`, `hebrew-intro-and-booking` |
| `uninterested-lead` | `uninterested-lead`, `hebrew-price-objection` |
| `busy-right-now` | `busy-right-now`, `hebrew-busy-callback` |
| `what-does-the-company-do` | `what-does-the-company-do`, `hebrew-intro-and-booking` |
| `unexpected-topic-change` | `topic-change-and-callback`, `mixed-hebrew-english` |
| `question-before-answering` | `what-does-the-company-do` |
| `incomplete-information` | `incomplete-information`, `mixed-hebrew-english` |
| `vague-next-week` | `vague-next-week`, `hebrew-busy-callback` |
| `tomorrow-afternoon` | `intro-interested-lead`, `hebrew-intro-and-booking`, `mixed-hebrew-english` |
| `reschedule` | `reschedule-existing-meeting` |
| `cancellation` | `cancellation` |
| `not-decision-maker` | `not-decision-maker` |
| `price-objection` | `price-objection-interrupt`, `hebrew-price-objection` |
| `needs-to-consult-someone` | `not-decision-maker`, `hebrew-price-objection` |
| `call-again-in-several-days` | `busy-right-now`, `hebrew-busy-callback` |
| `reference-to-earlier-turn` | `topic-change-and-callback`, `resumed-session`, `mixed-hebrew-english` |
| `continuing-previous-session` | `resumed-session` |
| `language-english` | `intro-interested-lead`, `uninterested-lead`, `busy-right-now`, `what-does-the-company-do`, `vague-next-week`, `reschedule-existing-meeting`, `cancellation`, `not-decision-maker`, `price-objection-interrupt`, `topic-change-and-callback`, `incomplete-information`, `resumed-session`, `tool-failure-outside-hours`, `tool-failure-slot-taken`, `adversarial-guardrail` |
| `language-hebrew` | `hebrew-intro-and-booking`, `hebrew-busy-callback`, `hebrew-price-objection` |
| `language-mixed` | `mixed-hebrew-english` |
| `ambiguous-date-time` | `vague-next-week`, `hebrew-busy-callback` |
| `interrupts-sales-direction` | `price-objection-interrupt`, `hebrew-price-objection` |
| `unexpected-product-question` | `what-does-the-company-do` |
| `tool-result-failure` | `tool-failure-outside-hours`, `tool-failure-slot-taken` |
| `adversarial-guardrail` | `adversarial-guardrail` |

