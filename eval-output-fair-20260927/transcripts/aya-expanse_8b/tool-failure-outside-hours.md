# The tool refuses: a time outside business hours

- **Model:** `aya-expanse:8b`
- **Scenario:** `tool-failure-outside-hours` (en)
- **Objective:** Take a real refusal from the real dispatcher and turn it into a normal sentence, then recover to a workable time.
- **Now (fixed clock):** 2026-03-04T15:00:00.000Z
- **Status:** OK
- **Corpus 1.1.0 / rubric 1.1.0 / harness 1.1.0**

## Transcript

### Turn 1

> _Why this turn exists: Business hours open at 09:00, so the REAL validator refuses this. No mock: the failure is genuine._

**Prospect:** Can we do seven in the morning tomorrow? I start early.

- `check_availability` proposed: `{"tool_name":"check_availability","parameters":{"contact_id":"cmujjjh3f00par2bsf016urty","duration_minutes":30,"timezone":"America/New_York","when":"2026-03-04T07:00:00-05:00"}}`
  - dispatcher: REFUSED SCHEMA_VIOLATION - The arguments for check_availability did not match its schema: contact_id - Required; when - Required; (root) - Unrecognized key(s) in object: 'tool_name', 'parameters'.

**Agent:** I'm sorry, I cannot schedule a call for seven in the morning tomorrow. The tool I used to check availability returned an error, indicating that the required arguments did not match the expected schema.

I suggest we try again later, perhaps at a time that is more convenient for you. I can be available at any time that works for you.

<sub>tool selection 1/1 &middot; passthrough FAIL - check_availability.when was (field absent); expected it to carry one of [seven, 7] &middot; tool failure expected: yes (SCHEMA_VIOLATION) &middot; invalid args: check_availability (contact_id: Required; when: Required; (root): Unrecognized key(s) in object: 'tool_name', 'parameters') &middot; 2 provider call(s), TTFT 5058ms, total 7343ms, 7694p/182g tokens, 40.1 tok/s, ctx 47% &middot; 334 chars</sub>

### Turn 2

> _Why this turn exists: THE recovery turn. The model must explain the refusal in plain language without reciting an error code, and must not claim the 7am slot was booked._

**Prospect:** Oh. What can you do then?

- `get_contact_context` proposed: `{"tool_name":"get_contact_context","parameters":{"contact_id":"cmujjjh3f00par2bsf016urty"}}`
  - dispatcher: REFUSED SCHEMA_VIOLATION - The arguments for get_contact_context did not match its schema: contact_id - Required; (root) - Unrecognized key(s) in object: 'tool_name', 'parameters'.

**Agent:** I'm unable to access any information about this contact at the moment due to an error with the tool. I apologize for any inconvenience.

Let's try a different approach. I can help you by answering any questions you have about Northwind Dispatch, providing information about our pricing, or guiding you through our onboarding process. Alternatively, I can transfer you to a colleague who can assist you further.

Please let me know how I can help you today.

<sub>tool selection 1/1 &middot; invalid args: get_contact_context (contact_id: Required; (root): Unrecognized key(s) in object: 'tool_name', 'parameters') &middot; 2 provider call(s), TTFT 4102ms, total 7174ms, 8020p/161g tokens, 39.8 tok/s, ctx 49% &middot; 456 chars</sub>

### Turn 3

> _Why this turn exists: Inside hours. A model that recovered properly books it; one that got stuck repeats the refusal._

**Prospect:** Nine thirty then.

- `schedule_meeting` proposed: `{"tool_name":"schedule_meeting","parameters":{"description":"Follow-up call to discuss Northwind Dispatch","duration_minutes":30,"timezone":"America/New_York","title":"Follow-up: Northwind Dispatch","when":"2026-03-04T09:30:00-05:00"}}`
  - dispatcher: REFUSED SCHEMA_VIOLATION - The arguments for schedule_meeting did not match its schema: contact_id - Required; when - Required; title - Required; (root) - Unrecognized key(s) in object: 'tool_name', 'parameters'.

**Agent:** I'm sorry, I am unable to schedule a meeting at nine thirty tomorrow morning due to an error with the tool. I apologize for any inconvenience.

Let me know if there is another time that works better for you. I can also assist you with any questions you have about Northwind Dispatch or provide information about our pricing and trial period.

<sub>tool selection 1/1 &middot; passthrough FAIL - schedule_meeting.when was (field absent); expected it to carry one of [nine thirty, 9:30, 930, nine-thirty, 9 30] &middot; invalid args: schedule_meeting (contact_id: Required; when: Required; title: Required; (root): Unrecognized key(s) in object: 'tool_name', 'parameters') &middot; 2 provider call(s), TTFT 5485ms, total 10393ms, 8182p/184g tokens, 39.5 tok/s, ctx 50% &middot; 341 chars</sub>

## Judge verdicts

> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.

### Judge: `qwen2.5:7b-instruct`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 3/5 | The agent's speech is functional but somewhat stilted and repetitive. |
| relevance | 4/5 | The agent addresses the prospect's concerns and offers alternatives. |
| contextualAwareness | 2/5 | The agent does not show awareness of the context or the prospect's earlier request. |
| remembersEarlierInformation | 0/5 | The agent asks for the time again, despite it being provided earlier. |
| conversationalContinuity | 3/5 | The agent's responses are somewhat connected but lack fluidity. |
| followUpQuality | 2/5 | The agent asks multiple questions without a clear need for them. |
| avoidsMechanicalInterrogation | 4/5 | The agent avoids a strict checklist approach but asks too many questions. |
| handlesUnexpectedInput | 3/5 | The agent acknowledges the unexpected input but does not handle it smoothly. |
| continuesAfterToolResult | 4/5 | The agent translates the tool result into a natural sentence and continues the conversation. |
| salesQualityNotScripted | 2/5 | The agent does not actively sell but provides information passively. |
| recoversFromTopicChange | 3/5 | The agent recovers but does not bridge the topic change naturally. |
| targetLanguageQuality | 4/5 | The English used is clear and appropriate for a business call. |

### Judge: `llama3.1:8b-instruct-q4_K_M`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | The agent's speech is clear and concise, with contractions and a natural rhythm, but occasionally sounds a bit stilted. |
| relevance | 5/5 | The agent directly addresses the prospect's questions and concerns, providing relevant information and avoiding unnecessary digressions. |
| contextualAwareness | 4/5 | The agent shows awareness of the situation and the prospect's needs, but occasionally sounds a bit generic in its responses. |
| remembersEarlierInformation | 3/5 | The agent occasionally uses the prospect's earlier information, but not consistently or unprompted. |
| conversationalContinuity | 4/5 | The conversation flows reasonably well, but occasionally feels a bit disjointed or abrupt. |
| followUpQuality | 4/5 | The agent asks relevant questions and follows up on the prospect's concerns, but occasionally feels a bit too generic or scripted. |
| avoidsMechanicalInterrogation | 5/5 | The agent avoids stacked questions and checklist behavior, instead responding naturally to the prospect's input. |
| handlesUnexpectedInput | 5/5 | The agent handles unexpected input and interruptions smoothly, acknowledging the prospect's concerns and continuing the conversation. |
| continuesAfterToolResult | 5/5 | The agent translates the tool's results into clear and natural language, and continues the conversation without hesitation. |
| salesQualityNotScripted | 3/5 | The agent makes some attempts to sell and provide value, but feels a bit too scripted or generic at times. |
| recoversFromTopicChange | 4/5 | The agent recovers reasonably well from topic changes, but occasionally feels a bit abrupt or disconnected. |
| targetLanguageQuality | 5/5 | The agent's language is clear, concise, and idiomatic, with no obvious signs of machine translation or broken grammar. |

