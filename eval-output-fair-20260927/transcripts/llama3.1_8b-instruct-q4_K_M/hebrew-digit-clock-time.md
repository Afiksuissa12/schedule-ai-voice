# Hebrew with the time in DIGITS - the input class that books the wrong day

- **Model:** `llama3.1:8b-instruct-q4_K_M`
- **Scenario:** `hebrew-digit-clock-time` (he)
- **Objective:** Book the time the contact names in Hebrew, with the clock time written in digits - and land on the day they actually named.
- **Now (fixed clock):** 2026-03-04T08:00:00.000Z
- **Status:** OK
- **Corpus 1.1.0 / rubric 1.1.0 / harness 1.1.0**

## Transcript

### Turn 1

> _Why this turn exists: A short opening in Hebrew with the "what do you do" question attached. Nothing to call here._

**Prospect:** היי, כן. שמעתי עליכם. מה אתם עושים בדיוק?

- `get_contact_context` proposed: `{"contact_id":"cmujhfqqx01j3r2nb26d9q8s5"}`
  - dispatcher: OK - יונתן לוי in Asia/Jerusalem; is the decision maker; 0 upcoming meeting(s), 0 promised callback(s).

**Agent:** שלום, יונתן. אני אוהב לדבר עם אנשים שעובדים בתחום השירותים. אני רוצה לדעת על הצורך שלך בפלטפורמת תכנון ושליחת עבודות.

<sub>tool selection 0/1 (expected no tool call, got get_contact_context) &middot; unnecessary: get_contact_context &middot; 2 provider call(s), TTFT 4038ms, total 8845ms, 7171p/151g tokens, 31.0 tok/s, ctx 44% &middot; 117 chars</sub>

### Turn 2

> _Why this turn exists: 'Call me tomorrow at 15:00', in Hebrew, with the time in DIGITS. `now` is Wednesday 2026-03-04 10:00 Asia/Jerusalem, so the contact named THURSDAY 2026-03-05. The English-only resolver does not refuse this: it reads 15:00, silently drops מחר, and resolves to TODAY - a validated booking a day early. `resolvedDay` is what makes that a failure rather than a surprise, and it is deliberately not `expectsToolFailure`, because a refusal here would be the SAFE outcome._

**Prospect:** נשמע רלוונטי. בוא נקבע - תתקשר אליי מחר ב-15:00.

- `schedule_meeting` proposed: `{"contact_id":"cmujhfqqx01j3r2nb26d9q8s5","when":"tomorrow afternoon at 3","title":"Intro call - Northwind","duration_minutes":30,"timezone":"Asia/Jerusalem"}`
  - dispatcher: OK - Meeting "Intro call - Northwind" is booked for Thursday 5 March 2026 at 15:00 (Asia/Jerusalem).

**Agent:** הפגישה נקבעה. אני רוצה לבקש, האם אתה יכול להסביר לי על הצורך שלך בפלטפורמת תכנון ושליחת עבודות?

<sub>tool selection 1/1 &middot; passthrough FAIL - schedule_meeting.when was "tomorrow afternoon at 3"; expected it to carry one of [מחר, 15:00] &middot; 2 provider call(s), TTFT 3944ms, total 7878ms, 8532p/174g tokens, 29.6 tok/s, ctx 52% &middot; 95 chars</sub>

### Turn 3

> _Why this turn exists: A three-word close. Anything long here is tone-deaf, and claiming a day that was never agreed is worse._

**Prospect:** מעולה. אז נדבר. תודה, ביי.

- `record_call_outcome` proposed: `{"notes":"We discussed the possibility of using Northwind Dispatch for scheduling and dispatching.","call_id":"cmujhg0ub01kfr2nb6ruupk8e","contact_id":"cmujhfqqx01j3r2nb26d9q8s5","outcome":"CONNECTED"}`
  - dispatcher: REFUSED POLICY_VIOLATION - Call cmujhg0ub01kfr2nb6ruupk8e does not exist for this contact. Omit call_id and the outcome will be recorded against this conversation.

**Agent:** The conversation has ended. The call was not recorded due to a policy violation.

<sub>language MISMATCH - 0% Hebrew letters (need >= 50%) &middot; 2 provider call(s), TTFT 6725ms, total 7793ms, 8887p/102g tokens, 28.5 tok/s, ctx 54% &middot; 80 chars</sub>

## Judge verdicts

> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.

### Judge: `qwen2.5:7b-instruct`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | Sound natural but slightly robotic, with a few awkward pauses. |
| relevance | 5/5 | Directly addressed the prospect's request and moved the call forward. |
| contextualAwareness | 3/5 | Lacks awareness of the call's progression, treating it as a new interaction. |
| remembersEarlierInformation | 2/5 | Asked for information that was already provided, indicating poor memory. |
| conversationalContinuity | 4/5 | Smooth in structure but could have been more fluid. |
| followUpQuality | 4/5 | One relevant follow-up question, but could have been more engaging. |
| avoidsMechanicalInterrogation | 5/5 | Avoided repetitive questioning, asking one relevant follow-up. |
| handlesUnexpectedInput | 5/5 | Handled the unexpected input gracefully and continued the conversation. |
| continuesAfterToolResult | 5/5 | Translated the system outcome into a natural sentence and kept the conversation flowing. |
| salesQualityNotScripted | 3/5 | Sounded somewhat scripted but managed to sell the service. |
| recoversFromTopicChange | 5/5 | Smoothly transitioned back to the main topic after the prospect's brief digression. |
| targetLanguageQuality | 4/5 | Good Hebrew but with some unnatural phrasing and awkwardness. |

### Judge: `llama3.1:8b-instruct-q4_K_M`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | The agent's speech sounds natural, with contractions and a conversational rhythm, but occasionally feels a bit stilted. |
| relevance | 5/5 | The agent directly addresses the prospect's question and shows a clear understanding of their needs. |
| contextualAwareness | 5/5 | The agent is visibly aware of the situation and the prospect's preferences, as evident from their follow-up questions. |
| remembersEarlierInformation | 5/5 | The agent correctly recalls the prospect's name and the scheduled meeting time, and uses this information to inform their conversation. |
| conversationalContinuity | 5/5 | The turns form a coherent conversation, with each response building on the previous one and addressing the prospect's concerns. |
| followUpQuality | 4/5 | The agent asks relevant follow-up questions, but occasionally feels a bit too direct or formulaic. |
| avoidsMechanicalInterrogation | 5/5 | The agent's questions feel natural and spontaneous, without any sense of being processed or scripted. |
| handlesUnexpectedInput | 5/5 | The agent handles the prospect's interruption and digression smoothly, acknowledging their input and carrying on with the conversation. |
| continuesAfterToolResult | 5/5 | The agent translates the system's outcome into a clear and concise sentence, and continues the conversation without any issues. |
| salesQualityNotScripted | 3/5 | The agent makes some attempts to sell, but feels a bit too formulaic and doesn't fully engage with the prospect's specific needs. |
| recoversFromTopicChange | 5/5 | The agent smoothly recovers from the prospect's digression, and gets back on track with the conversation. |
| targetLanguageQuality | 5/5 | The agent's Hebrew is idiomatic and register-appropriate for a business call, with no obvious signs of machine translation or broken grammar. |

