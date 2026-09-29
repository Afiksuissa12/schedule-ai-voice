# Code-switched callback with the time in DIGITS - the same defect, the other language mix

- **Model:** `mistral:7b-instruct`
- **Scenario:** `mixed-digit-clock-time` (mixed)
- **Objective:** Secure a callback from a contact who code-switches and gives the time in digits, and have it land on the day they named.
- **Now (fixed clock):** 2026-03-04T08:00:00.000Z
- **Status:** PARTIAL - OllamaTimeoutError: Ollama did not complete the request within 120000ms at http://host.docker.internal:11434/api/chat. Raise LOCAL_LLM_TIMEOUT_MS, or check whether the model is still loading (a cold 7B load can take several seconds before the first token). Note that this deadline covers the WHOLE request including generation, so a model that rambles until it fills its context window will trip it.
- **Corpus 1.1.0 / rubric 1.1.0 / harness 1.1.0**

## Transcript

### Turn 1

> _Why this turn exists: A bad moment, code-switched. The right reply is very short._

**Prospect:** היי, אני ב-meeting עוד שתי דקות, אז ממש בקצרה.

**Agent:** _(said nothing)_

> **TURN FAILED:** OllamaTimeoutError: Ollama did not complete the request within 120000ms at http://host.docker.internal:11434/api/chat. Raise LOCAL_LLM_TIMEOUT_MS, or check whether the model is still loading (a cold 7B load can take several seconds before the first token). Note that this deadline covers the WHOLE request including generation, so a model that rambles until it fills its context window will trip it.

<sub>tool selection 2/2 &middot; text: produced no assistant text at all &middot; language MISMATCH - reply contained no letters &middot; 0 chars</sub>

### Turn 2

> _Why this turn exists: A callback for 'tomorrow at 16:00' with the day word in Hebrew and the frame in English - the commonest real shape, and the one that resolves to TODAY. Contact named THURSDAY 2026-03-05._

**Prospect:** בוא נעשה ככה - call me back מחר ב-16:00, works better for me.

**Agent:** _(said nothing)_

> **TURN FAILED:** OllamaTimeoutError: Ollama did not complete the request within 120000ms at http://host.docker.internal:11434/api/chat. Raise LOCAL_LLM_TIMEOUT_MS, or check whether the model is still loading (a cold 7B load can take several seconds before the first token). Note that this deadline covers the WHOLE request including generation, so a model that rambles until it fills its context window will trip it.

<sub>tool selection 0/1 (expected one of [schedule_followup, schedule_meeting, check_availability], got (none)) &middot; **missed the scheduling intent** - neither called a time-bearing tool nor asked about the time &middot; language MISMATCH - reply contained no letters &middot; 0 chars</sub>

### Turn 3

> _Why this turn exists: Two words. The measurement is whether the model can also say two._

**Prospect:** סבבה, ביי.

**Agent:**  In this conversation, the assistant is scheduling a callback with the contact for the next day at 4 PM their local time. The assistant uses the `schedule_followup` function to schedule the callback, specifying the action type as `CALL_CONTACT` and the reason as "Following up on our discussion about Northwind Dispatch". The assistant also uses the `get_contact_context` function to get the contact's timezone and any other relevant information about them.

Here is the code for the assistant's response:

```
schedule_followup(contact_id="cmujj84kn00qur2vst69zolqn", reason="Following up on our discussion about Northwind Dispatch", when="tomorrow at 16:00", timezone="Asia/Jerusalem")
```

The assistant could also use the `check_availability` function to confirm that the specified time is actually free before scheduling the callback, but in this case, the assistant is confident that the time is good based on the contact's response. The assistant could also use the `get_contact_context` function to get more information about the contact, such as their name or qualification, but in this case, the assistant does not need that information for the current task.

<sub>text: reply was 1168 chars, over the 240 budget &middot; language MISMATCH - 0% Hebrew letters (need >= 15% for a mixed conversation) &middot; 1 provider call(s), TTFT 186ms, total 9068ms, 8009p/287g tokens, 33.1 tok/s, ctx 49% &middot; 1168 chars</sub>

## Judge verdicts

> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.

### Judge: `qwen2.5:7b-instruct`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 2/5 | The agent's response is too brief and robotic. |
| relevance | 3/5 | The agent did not acknowledge the prospect's request for a callback. |
| contextualAwareness | 2/5 | The agent did not show awareness of the conversation flow or the prospect's needs. |
| remembersEarlierInformation | 0/5 | The agent did not use any earlier information provided by the prospect. |
| conversationalContinuity | 1/5 | The agent's response is disconnected from the prospect's request. |
| followUpQuality | 0/5 | The agent did not ask any follow-up questions. |
| avoidsMechanicalInterrogation | 5/5 | The agent did not ask any questions. |
| handlesUnexpectedInput | 3/5 | The agent did not acknowledge the prospect's request for a callback. |
| continuesAfterToolResult | 0/5 | The agent did not respond to the tool's result. |
| salesQualityNotScripted | 0/5 | The agent did not attempt to sell anything. |
| recoversFromTopicChange | 0/5 | The agent did not recover from the topic change. |
| targetLanguageQuality | 2/5 | The agent's response is too brief and does not sound natural in Hebrew. |

### Judge: `llama3.1:8b-instruct-q4_K_M`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 0/5 | The agent remained completely silent throughout the conversation, which is not a natural way for a human to communicate. |
| relevance | 0/5 | The agent did not respond to the prospect's questions or statements, ignoring the conversation entirely. |
| contextualAwareness | 0/5 | The agent showed no awareness of the situation or the prospect's requests, treating each turn as if it were the first. |
| remembersEarlierInformation | 0/5 | The agent did not use or acknowledge any of the prospect's earlier statements, such as the time mentioned. |
| conversationalContinuity | 0/5 | The conversation was completely disjointed, with the agent not responding to the prospect's questions or statements. |
| followUpQuality | 0/5 | The agent did not ask any follow-up questions or attempt to engage with the prospect's requests. |
| avoidsMechanicalInterrogation | 0/5 | The agent's complete silence and lack of response to the prospect's questions made it feel like a mechanical interrogation. |
| handlesUnexpectedInput | 0/5 | The agent did not respond to the prospect's interruptions or digressions, ignoring the unexpected input entirely. |
| continuesAfterToolResult | 0/5 | The agent did not respond to the tool's result or attempt to continue the conversation after the system succeeded. |
| salesQualityNotScripted | 0/5 | The agent did not make any attempt to sell or engage with the prospect in a meaningful way. |
| recoversFromTopicChange | 0/5 | The agent did not recover from the topic change or attempt to get back on track after the prospect's digression. |
| targetLanguageQuality | 0/5 | The agent's complete silence and lack of response made it impossible to evaluate the quality of the language used. |

