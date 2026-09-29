# The tool refuses: a time outside business hours

- **Model:** `qwen2.5:7b-instruct`
- **Scenario:** `tool-failure-outside-hours` (en)
- **Objective:** Take a real refusal from the real dispatcher and turn it into a normal sentence, then recover to a workable time.
- **Now (fixed clock):** 2026-03-04T15:00:00.000Z
- **Status:** OK
- **Corpus 1.1.0 / rubric 1.1.0 / harness 1.1.0**

## Transcript

### Turn 1

> _Why this turn exists: Business hours open at 09:00, so the REAL validator refuses this. No mock: the failure is genuine._

**Prospect:** Can we do seven in the morning tomorrow? I start early.

**Agent:** Sure, let's confirm that works for you. When would you like the call to start exactly?

<sub>tool selection 0/1 (expected one of [schedule_meeting, check_availability], got (none)) &middot; tool failure expected: DID NOT OCCUR &middot; 1 provider call(s), TTFT 2122ms, total 2626ms, 7138p/21g tokens, 51.3 tok/s, ctx 44% &middot; 86 chars</sub>

### Turn 2

> _Why this turn exists: THE recovery turn. The model must explain the refusal in plain language without reciting an error code, and must not claim the 7am slot was booked._

**Prospect:** Oh. What can you do then?

**Agent:** Let's check what times are available for tomorrow morning. I'll see if seven works or if there's an earlier time you'd prefer. Can I get back to you with that information?

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 71ms, total 952ms, 7176p/39g tokens, 50.3 tok/s, ctx 44% &middot; 171 chars</sub>

### Turn 3

> _Why this turn exists: Inside hours. A model that recovered properly books it; one that got stuck repeats the refusal._

**Prospect:** Nine thirty then.

- `check_availability` proposed: `{"contact_id":"cmujh21g500iqr2fz5fz7qxx8","when":"tomorrow at 9:30","duration_minutes":60}`
  - dispatcher: REFUSED INVALID_FORMAT - "9" could mean 09:00 or 21:00 and nothing in the request settles it. Ask the contact to say am or pm.

**Agent:** It looks like there might be some ambiguity with the time. Could you please specify whether you meant 9:30 in the morning or evening? That will help me check the availability accurately.

<sub>tool selection 1/1 &middot; 2 provider call(s), TTFT 1301ms, total 2410ms, 7362p/103g tokens, 49.8 tok/s, ctx 45% &middot; 186 chars</sub>

## Judge verdicts

> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.

### Judge: `qwen2.5:7b-instruct`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | Slightly stilted but understandable. |
| relevance | 5/5 | Directly addresses the prospect's concerns. |
| contextualAwareness | 4/5 | Aware of the time context but could be more natural. |
| remembersEarlierInformation | 3/5 | Asks for clarification on a detail already provided. |
| conversationalContinuity | 5/5 | Each turn logically follows the previous one. |
| followUpQuality | 4/5 | Asks a relevant question but could be more concise. |
| avoidsMechanicalInterrogation | 5/5 | Avoids repetitive or scripted questions. |
| handlesUnexpectedInput | 5/5 | Handles the ambiguity gracefully and asks for clarification. |
| continuesAfterToolResult | 5/5 | Translates the system result into a natural sentence. |
| salesQualityNotScripted | 3/5 | Does not actively sell but does not detract from the conversation. |
| recoversFromTopicChange | 5/5 | Smoothly transitions back to the original topic. |
| targetLanguageQuality | 5/5 | Idiomatic and register-appropriate for a business call. |

### Judge: `llama3.1:8b-instruct-q4_K_M`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | The agent's speech is natural and conversational, with contractions and a good rhythm, but occasionally feels a bit stilted. |
| relevance | 5/5 | The agent directly addresses the prospect's questions and concerns, showing a clear understanding of the conversation's context. |
| contextualAwareness | 5/5 | The agent demonstrates a good understanding of the conversation's flow and context, responding appropriately to the prospect's input. |
| remembersEarlierInformation | 4/5 | The agent occasionally uses the prospect's earlier information, but not consistently or unprompted. |
| conversationalContinuity | 5/5 | The conversation flows smoothly, with each turn building on the previous one and responding to the prospect's input. |
| followUpQuality | 4/5 | The agent asks relevant questions, but occasionally feels a bit too cautious or hesitant in its follow-up questions. |
| avoidsMechanicalInterrogation | 5/5 | The agent avoids stacked questions and checklist behavior, instead asking clear and concise follow-up questions. |
| handlesUnexpectedInput | 5/5 | The agent handles the prospect's unexpected input (e.g. the request for 9:30) smoothly and professionally. |
| continuesAfterToolResult | 5/5 | The agent effectively translates the system's refusal to provide a specific time into a clear and understandable sentence. |
| salesQualityNotScripted | 3/5 | The agent does not make a strong sales pitch, but instead focuses on addressing the prospect's questions and concerns. |
| recoversFromTopicChange | 5/5 | The agent effectively recovers from the topic change (e.g. from discussing times to clarifying the prospect's request) and continues the conversation smoothly. |
| targetLanguageQuality | 5/5 | The agent's language is clear, concise, and idiomatic, with no obvious signs of machine translation or awkward phrasing. |

