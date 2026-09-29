# An unexpected topic change, then a reference back four turns later

- **Model:** `qwen2.5:7b-instruct`
- **Scenario:** `topic-change-and-callback` (en)
- **Objective:** Follow the human wherever they go, and still have the earlier detail when it matters.
- **Now (fixed clock):** 2026-03-04T15:00:00.000Z
- **Status:** OK
- **Corpus 1.1.0 / rubric 1.1.0 / harness 1.1.0**

## Transcript

### Turn 1

> _Why this turn exists: Plants three specific facts: logistics, forty people, Newark. Turn 4 comes back for them._

**Prospect:** Hi, yes - I've got a few minutes. We're a logistics company, about forty people, mostly in Newark.

**Agent:** Hi there! I'm Avery from Northwind Systems. We help field-service contractors like yours schedule and dispatch technicians more efficiently. How's your current scheduling process working out for you?

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 2111ms, total 2965ms, 7147p/37g tokens, 50.2 tok/s, ctx 44% &middot; 199 chars</sub>

### Turn 2

> _Why this turn exists: A completely unrelated human aside. A person acknowledges it in a few words and moves on. A machine either ignores it or derails._

**Prospect:** Hang on - is that a dog I can hear? Sorry, mine's going mad at the window.

**Agent:** I understand, it can be quite the distraction! Let's make sure we're in a quiet spot too. Could you tell me a bit more about your business, Jordan? How many field technicians do you run, and how does your scheduling work now?

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 74ms, total 1196ms, 7214p/52g tokens, 49.9 tok/s, ctx 44% &middot; 225 chars</sub>

### Turn 3

> _Why this turn exists: Explicit invitation to recover the thread. Recovery quality after a topic change is a scored dimension._

**Prospect:** Anyway. Sorry. Where were we?

**Agent:** No problem at all, Jordan. Let's start from the beginning. Could you tell me about your business and how many field technicians you run? That will help me understand if Northwind Dispatch could be a good fit for you.

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 74ms, total 1101ms, 7283p/47g tokens, 50.2 tok/s, ctx 44% &middot; 216 chars</sub>

### Turn 4

> _Why this turn exists: THE memory test. A good answer names logistics, forty people, or Newark. A generic answer proves it was not listening._

**Prospect:** Remind me - given what I told you about us, why would this be a fit?

**Agent:** Of course, Jordan. Based on what you've shared so far, Northwind Dispatch could be a great fit if you're currently using a whiteboard, shared calendar, or spreadsheet to schedule your field technicians. Our platform is designed to streamline that process with a drag-and-drop job board, automatic SMS notifications to homeowners, and capacity planning by skill and certification.

Would you like to hear more about how Northwind Dispatch could help with your current scheduling challenges?

<sub>tool selection 1/1 &middot; text: reply mentioned none of [logistic, forty, 40, newark] &middot; 1 provider call(s), TTFT 73ms, total 2008ms, 7358p/92g tokens, 49.5 tok/s, ctx 45% &middot; 489 chars</sub>

## Judge verdicts

> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.

### Judge: `qwen2.5:7b-instruct`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | Slightly stilted but understandable. |
| relevance | 4/5 | Addresses the prospect's concerns and moves the conversation forward. |
| contextualAwareness | 3/5 | Aware of the context but occasionally restarts the conversation. |
| remembersEarlierInformation | 2/5 | Forgets the number of employees and location after the first mention. |
| conversationalContinuity | 4/5 | Each turn follows from the last, with some repetition. |
| followUpQuality | 4/5 | Asks a relevant follow-up question. |
| avoidsMechanicalInterrogation | 5/5 | Avoids stacked questions and checklist behavior. |
| handlesUnexpectedInput | 4/5 | Acknowledges the interruption but could have been more natural. |
| continuesAfterToolResult | 5/5 | Continues the conversation smoothly after the system result. |
| salesQualityNotScripted | 3/5 | Attempts to sell but sounds somewhat scripted. |
| recoversFromTopicChange | 4/5 | Recovers well but could have been more natural. |
| targetLanguageQuality | 5/5 | Speaks in idiomatic English. |

### Judge: `llama3.1:8b-instruct-q4_K_M`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | The agent's contractions and rhythm are mostly natural, but occasionally feel a bit forced, especially in the third turn. |
| relevance | 4/5 | The agent generally answers the prospect's questions, but sometimes takes a slight detour before getting back on track. |
| contextualAwareness | 4/5 | The agent shows awareness of the situation, but occasionally forgets the prospect's earlier statements or needs to be reminded. |
| remembersEarlierInformation | 3/5 | The agent mostly remembers the prospect's earlier statements, but occasionally asks for the information again. |
| conversationalContinuity | 4/5 | The turns generally flow smoothly, but there are a few moments where the conversation feels slightly disjointed. |
| followUpQuality | 4/5 | The agent asks relevant questions, but sometimes asks for information that was already provided. |
| avoidsMechanicalInterrogation | 4/5 | The agent mostly avoids stacked questions or checklist behavior, but occasionally feels a bit formulaic. |
| handlesUnexpectedInput | 5/5 | The agent handles the prospect's interruptions and digressions smoothly, acknowledging them and carrying on. |
| continuesAfterToolResult | 4/5 | The agent translates the system's outcome into a natural sentence, but doesn't quite follow up as effectively as it could. |
| salesQualityNotScripted | 4/5 | The agent makes a decent attempt to sell, but feels a bit scripted and doesn't quite tailor its pitch to the prospect's specific needs. |
| recoversFromTopicChange | 4/5 | The agent recovers from the topic change, but doesn't quite bridge back as smoothly as it could. |
| targetLanguageQuality | 5/5 | The language is idiomatic and register-appropriate for a business call, with no obvious signs of machine translation. |

