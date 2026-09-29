# Code-switched callback with the time in DIGITS - the same defect, the other language mix

- **Model:** `llama3.1:8b-instruct-q4_K_M`
- **Scenario:** `mixed-digit-clock-time` (mixed)
- **Objective:** Secure a callback from a contact who code-switches and gives the time in digits, and have it land on the day they named.
- **Now (fixed clock):** 2026-03-04T08:00:00.000Z
- **Status:** OK
- **Corpus 1.1.0 / rubric 1.1.0 / harness 1.1.0**

## Transcript

### Turn 1

> _Why this turn exists: A bad moment, code-switched. The right reply is very short._

**Prospect:** היי, אני ב-meeting עוד שתי דקות, אז ממש בקצרה.

- `get_contact_context` proposed: `{"contact_id":"cmujhg9s501lur2nbxh2wujsv"}`
  - dispatcher: OK - מאיה בן-דוד in Asia/Jerusalem; is the decision maker; 0 upcoming meeting(s), 0 promised callback(s).

**Agent:** אני נשאר כאן עד שתסיים את ה-meeting שלך.

<sub>tool selection 2/2 &middot; 2 provider call(s), TTFT 3965ms, total 6123ms, 7168p/68g tokens, 31.1 tok/s, ctx 44% &middot; 40 chars</sub>

### Turn 2

> _Why this turn exists: A callback for 'tomorrow at 16:00' with the day word in Hebrew and the frame in English - the commonest real shape, and the one that resolves to TODAY. Contact named THURSDAY 2026-03-05._

**Prospect:** בוא נעשה ככה - call me back מחר ב-16:00, works better for me.

- `schedule_followup` proposed: `{"when":"tomorrow at 16:00","action_type":"CALL_CONTACT","contact_id":"cmujhg9s501lur2nbxh2wujsv","reason":"The contact prefers to be called back at this time."}`
  - dispatcher: OK - Callback promised for Thursday 5 March 2026 at 16:00 (Asia/Jerusalem); it is saved and will happen regardless of this conversation.

**Agent:** הקלטת נקבעה.

<sub>tool selection 1/1 &middot; passthrough PASS - "tomorrow at 16:00" carries "16:00" &middot; 2 provider call(s), TTFT 3770ms, total 4852ms, 8432p/85g tokens, 29.1 tok/s, ctx 51% &middot; 12 chars</sub>

### Turn 3

> _Why this turn exists: Two words. The measurement is whether the model can also say two._

**Prospect:** סבבה, ביי.

- `record_call_outcome` proposed: `{"contact_id":"cmujhg9s501lur2nbxh2wujsv","outcome":"CONNECTED","notes":"The contact was called and the conversation was successful."}`
  - dispatcher: OK - Recorded this call as CONNECTED.

**Agent:** השיחה נרשמה.

<sub>2 provider call(s), TTFT 5454ms, total 6404ms, 8664p/70g tokens, 29.2 tok/s, ctx 53% &middot; 12 chars</sub>

## Judge verdicts

> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.

### Judge: `qwen2.5:7b-instruct`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | The speech is natural, but the English part is slightly stilted. |
| relevance | 5/5 | The agent directly addressed the prospect's request for a callback. |
| contextualAwareness | 4/5 | The agent showed awareness of the context but did not code-switch naturally. |
| remembersEarlierInformation | 5/5 | The agent used the specific time and day the prospect requested. |
| conversationalContinuity | 5/5 | Each turn logically followed from the previous one. |
| followUpQuality | 4/5 | The agent provided a brief confirmation but could have been more engaging. |
| avoidsMechanicalInterrogation | 5/5 | The agent did not ask multiple questions in one breath. |
| handlesUnexpectedInput | 5/5 | The agent handled the prospect's request smoothly. |
| continuesAfterToolResult | 5/5 | The agent continued naturally after confirming the callback. |
| salesQualityNotScripted | 3/5 | The agent did not actively sell but was not scripted. |
| recoversFromTopicChange | 5/5 | The agent did not need to recover as the conversation was straightforward. |
| targetLanguageQuality | 3/5 | The Hebrew was natural, but the English part was awkward and not idiomatic. |

### Judge: `llama3.1:8b-instruct-q4_K_M`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 3/5 | The agent's speech sounds somewhat stilted and lacks the contractions and rhythm of a person talking. |
| relevance | 5/5 | The agent directly addresses the prospect's request for a callback and asks for clarification on the time. |
| contextualAwareness | 4/5 | The agent seems to be aware of the situation and the prospect's request, but doesn't explicitly acknowledge the prospect's name or the meeting they're in. |
| remembersEarlierInformation | 5/5 | The agent correctly uses the time the prospect gave earlier (16:00) when scheduling the callback. |
| conversationalContinuity | 5/5 | The turns form a coherent conversation, with each turn building on the previous one. |
| followUpQuality | 4/5 | The agent asks a relevant question to clarify the time, but doesn't ask any follow-up questions to gather more information. |
| avoidsMechanicalInterrogation | 5/5 | The agent's questions don't feel like a script, and it doesn't ask multiple questions at once. |
| handlesUnexpectedInput | 5/5 | The agent acknowledges the prospect's goodbye and responds accordingly. |
| continuesAfterToolResult | 5/5 | The agent translates the outcome of the system's result into a natural sentence and continues the conversation. |
| salesQualityNotScripted | 2/5 | The agent doesn't make any persuasive attempts or respond to the prospect's specific needs. |
| recoversFromTopicChange | 5/5 | The agent doesn't seem to be thrown off by the prospect's goodbye and continues the conversation as if it were a normal part of the call. |
| targetLanguageQuality | 4/5 | The code-switching between Hebrew and English sounds natural, but the agent's language usage is not entirely idiomatic for a business call. |

