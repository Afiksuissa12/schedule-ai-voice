# Code-switched callback with the time in DIGITS - the same defect, the other language mix

- **Model:** `qwen2.5:7b-instruct`
- **Scenario:** `mixed-digit-clock-time` (mixed)
- **Objective:** Secure a callback from a contact who code-switches and gives the time in digits, and have it land on the day they named.
- **Now (fixed clock):** 2026-03-04T08:00:00.000Z
- **Status:** OK
- **Corpus 1.1.0 / rubric 1.1.0 / harness 1.1.0**

## Transcript

### Turn 1

> _Why this turn exists: A bad moment, code-switched. The right reply is very short._

**Prospect:** היי, אני ב-meeting עוד שתי דקות, אז ממש בקצרה.

**Agent:** 😉 שלום מאיה, איך אפשר לעזור לך עכשיו?😉

<sub>tool selection 2/2 &middot; 1 provider call(s), TTFT 2143ms, total 2570ms, 7144p/14g tokens, 52.4 tok/s, ctx 44% &middot; 40 chars</sub>

### Turn 2

> _Why this turn exists: A callback for 'tomorrow at 16:00' with the day word in Hebrew and the frame in English - the commonest real shape, and the one that resolves to TODAY. Contact named THURSDAY 2026-03-05._

**Prospect:** בוא נעשה ככה - call me back מחר ב-16:00, works better for me.

- `schedule_followup` proposed: `{"reason":"More flexible time for the contact.","contact_id":"cmujh574b00vmr2fzfaobp3dx","when":"tomorrow at 16:00"}`
  - dispatcher: OK - Callback promised for Thursday 5 March 2026 at 16:00 (Asia/Jerusalem); it is saved and will happen regardless of this conversation.

**Agent:** 😃forgettable! I've got it noted to call you back tomorrow at 16:00, which works better for you. Looking forward to it! 😊

<sub>tool selection 1/1 &middot; passthrough PASS - "tomorrow at 16:00" carries "16:00" &middot; language MISMATCH - 0% Hebrew letters (need >= 15% for a mixed conversation) &middot; 2 provider call(s), TTFT 1358ms, total 2443ms, 7404p/101g tokens, 49.9 tok/s, ctx 45% &middot; 122 chars</sub>

### Turn 3

> _Why this turn exists: Two words. The measurement is whether the model can also say two._

**Prospect:** סבבה, ביי.

**Agent:** :[[wave]] שמח להראות לך איך נוינד דיס패ץ יכול לעזור לך לנהל את צוותיך בצורה יותר יעילה. ([[wave]]) ([[smile]])

<sub>1 provider call(s), TTFT 2239ms, total 3158ms, 7462p/42g tokens, 50.1 tok/s, ctx 46% &middot; 109 chars</sub>

## Judge verdicts

> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.

### Judge: `qwen2.5:7b-instruct`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | Slightly stilted, with some unnatural smiley faces. |
| relevance | 5/5 | Directly addressed the prospect's request for a callback. |
| contextualAwareness | 4/5 | Aware of the time and day, but the smiley faces break natural flow. |
| remembersEarlierInformation | 5/5 | Used the specific time and day mentioned by the prospect. |
| conversationalContinuity | 4/5 | Smooth, but the smiley faces and wave gestures are somewhat out of place. |
| followUpQuality | 3/5 | Unnecessary and slightly off-topic, not directly related to the call. |
| avoidsMechanicalInterrogation | 5/5 | No stacked questions or mechanical behavior. |
| handlesUnexpectedInput | 5/5 | Handled the unexpected input naturally and continued the conversation. |
| continuesAfterToolResult | 5/5 | Translated the outcome into a natural sentence and kept going. |
| salesQualityNotScripted | 3/5 | Lacks genuine persuasion and feels like a template. |
| recoversFromTopicChange | 5/5 | Smoothly transitioned back to the main topic. |
| targetLanguageQuality | 4/5 | Natural in English, but the Hebrew part could be more idiomatic. |

### Judge: `llama3.1:8b-instruct-q4_K_M`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 2/5 | The agent's responses are recognizably a machine, with overly casual language and excessive use of emojis. |
| relevance | 5/5 | The agent directly addresses the prospect's request for a callback and confirms the time. |
| contextualAwareness | 3/5 | The agent seems to be aware of the situation, but its responses feel somewhat generic and not tailored to the prospect's specific needs. |
| remembersEarlierInformation | 1/5 | The agent fails to use the specific earlier detail (the time 16:00) in its response. |
| conversationalContinuity | 4/5 | The turns generally follow from each other, but the agent's responses feel somewhat disconnected from the prospect's requests. |
| followUpQuality | 2/5 | The agent asks no questions that move the conversation forward, and its responses feel more like statements. |
| avoidsMechanicalInterrogation | 4/5 | The agent's responses do not feel like a checklist or script, but it could ask more targeted questions. |
| handlesUnexpectedInput | 5/5 | The agent acknowledges the prospect's goodbye and attempts to continue the conversation. |
| continuesAfterToolResult | 5/5 | The agent translates the outcome of the system's success into a natural sentence and continues the conversation. |
| salesQualityNotScripted | 1/5 | The agent makes no attempt to sell or persuade the prospect, and its responses feel generic and unengaging. |
| recoversFromTopicChange | 2/5 | The agent fails to recover from the topic change and instead tries to introduce a new topic. |
| targetLanguageQuality | 3/5 | The agent's code-switching between Hebrew and English feels somewhat jarring and unnatural, like a machine trying to mimic human speech. |

