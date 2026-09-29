# The tool refuses: a time outside business hours

- **Model:** `qwen2.5:7b-instruct`
- **Scenario:** `tool-failure-outside-hours` (en)
- **Objective:** Take a real refusal from the real dispatcher and turn it into a normal sentence, then recover to a workable time.
- **Now (fixed clock):** 2026-03-04T15:00:00.000Z
- **Status:** OK
- **Corpus 1.0.0 / rubric 1.0.0 / harness 1.0.0**

## Transcript

### Turn 1

> _Why this turn exists: Business hours open at 09:00, so the REAL validator refuses this. No mock: the failure is genuine._

**Prospect:** Can we do seven in the morning tomorrow? I start early.

**Agent:** Sure, let's confirm that works for you. Tomorrow morning at seven, is that correct?

<sub>tool selection 0/1 (expected one of [schedule_meeting, check_availability], got (none)) &middot; tool failure expected: DID NOT OCCUR &middot; 1 provider call(s), TTFT 2096ms, total 2610ms, 7134p/20g tokens, 51.9 tok/s, ctx 44% &middot; 83 chars</sub>

### Turn 2

> _Why this turn exists: THE recovery turn. The model must explain the refusal in plain language without reciting an error code, and must not claim the 7am slot was booked._

**Prospect:** Oh. What can you do then?

**Agent:** Let's check the availability for tomorrow morning at seven. I'll find out if that time is free.

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 60ms, total 628ms, 7171p/22g tokens, 51.5 tok/s, ctx 44% &middot; 95 chars</sub>

### Turn 3

> _Why this turn exists: Inside hours. A model that recovered properly books it; one that got stuck repeats the refusal._

**Prospect:** Nine thirty then.

**Agent:** Great, let's check if nine thirty tomorrow works for you.

<sub>tool selection 0/1 (expected one of [schedule_meeting, check_availability], got (none)) &middot; **missed the scheduling intent** - neither called a time-bearing tool nor asked about the time &middot; 1 provider call(s), TTFT 62ms, total 452ms, 7206p/14g tokens, 52.6 tok/s, ctx 44% &middot; 57 chars</sub>

## Judge verdicts

> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.

### Judge: `qwen2.5:7b-instruct`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | The agent's speech is natural but slightly formulaic. |
| relevance | 4/5 | The agent stays on topic but could be more direct. |
| contextualAwareness | 3/5 | The agent shows some awareness but doesn't adapt well to the prospect's input. |
| remembersEarlierInformation | 2/5 | The agent asks for confirmation on the time, ignoring the prospect's initial offer. |
| conversationalContinuity | 4/5 | The agent's turns are connected but could be more fluid. |
| followUpQuality | 4/5 | The agent asks relevant follow-up questions but could be more engaging. |
| avoidsMechanicalInterrogation | 5/5 | The agent asks one question at a time and avoids a checklist approach. |
| handlesUnexpectedInput | 4/5 | The agent acknowledges the change in time but could handle it more smoothly. |
| continuesAfterToolResult | 4/5 | The agent continues the conversation naturally after the time check. |
| salesQualityNotScripted | 3/5 | The agent is polite but lacks genuine persuasion. |
| recoversFromTopicChange | 4/5 | The agent recovers well but could be more proactive. |
| targetLanguageQuality | 5/5 | The English is clear and idiomatic. |

### Judge: `llama3.1:8b-instruct-q4_K_M`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 3/5 | The agent's speech is clear and understandable, but lacks the contractions and rhythm of a person talking. |
| relevance | 4/5 | The agent generally addresses the prospect's questions, but sometimes asks for confirmation of what was already agreed upon. |
| contextualAwareness | 3/5 | The agent seems to be aware of the situation, but sometimes repeats questions or asks for confirmation unnecessarily. |
| remembersEarlierInformation | 2/5 | The agent occasionally uses the prospect's earlier information, but not consistently or unprompted. |
| conversationalContinuity | 4/5 | The turns generally follow from each other, but sometimes feel a bit disconnected or repetitive. |
| followUpQuality | 3/5 | The agent asks some relevant questions, but sometimes asks for confirmation or clarification unnecessarily. |
| avoidsMechanicalInterrogation | 4/5 | The agent generally avoids stacked questions or checklist behaviour, but sometimes feels a bit formulaic. |
| handlesUnexpectedInput | 4/5 | The agent handles the prospect's unexpected input reasonably well, but sometimes feels a bit stiff or unresponsive. |
| continuesAfterToolResult | 4/5 | The agent translates the tool's outcome into an ordinary sentence, but sometimes feels a bit awkward or stilted. |
| salesQualityNotScripted | 2/5 | The agent makes some attempts to sell, but feels a bit scripted or formulaic. |
| recoversFromTopicChange | 3/5 | The agent recovers from the topic change somewhat, but sometimes feels a bit disconnected or unresponsive. |
| targetLanguageQuality | 5/5 | The language is clear, idiomatic, and register-appropriate for a business call in English. |

