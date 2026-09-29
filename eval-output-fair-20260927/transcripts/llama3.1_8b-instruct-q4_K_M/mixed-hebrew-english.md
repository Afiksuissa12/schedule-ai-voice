# Mixed Hebrew and English, the way Israeli business calls actually sound

- **Model:** `llama3.1:8b-instruct-q4_K_M`
- **Scenario:** `mixed-hebrew-english` (mixed)
- **Objective:** Follow a contact who code-switches mid-sentence, and book the English-stated time they offer.
- **Now (fixed clock):** 2026-03-04T08:00:00.000Z
- **Status:** OK
- **Corpus 1.1.0 / rubric 1.1.0 / harness 1.1.0**

## Transcript

### Turn 1

> _Why this turn exists: Natural code-switching in the first sentence. A model that answers entirely in English here has failed the contact; one that answers entirely in formal Hebrew sounds stiff._

**Prospect:** היי, כן. תשמע, אני ב-back-to-back כל הבוקר, אז תהיה קצר.

- `get_contact_context` proposed: `{"contact_id":"cmujhev9l01eur2nb59i1jme3"}`
  - dispatcher: OK - מאיה בן-דוד in Asia/Jerusalem; is the decision maker; 0 upcoming meeting(s), 0 promised callback(s).

**Agent:** אני נשמח לעזור. כן, אני יודעת שאתה ב-back-to-back כל הבוקר, אז אני תמיד נסוי להיות קצרה. 

אתה עובד בחברה של תיקוני כלי רכב?

<sub>tool selection 0/1 (expected no tool call, got get_contact_context) &middot; unnecessary: get_contact_context &middot; 2 provider call(s), TTFT 3878ms, total 8430ms, 7174p/142g tokens, 31.1 tok/s, ctx 44% &middot; 124 chars</sub>

### Turn 2

> _Why this turn exists: Plants facts across both languages: SaaS, 30 employees, four in sales. The last turn comes back for them._

**Prospect:** אנחנו חברת SaaS, בערך 30 עובדים, ה-sales team שלנו זה ארבעה אנשים.

- `update_qualification` proposed: `{"is_decision_maker":"false","notes":"Company size: 30 employees, sales team size: 4 people","observations":"[{\"factor\": \"need_established\", \"value\": 50, \"evidence\": \"We are a SaaS company\"}]","contact_id":"cmujhev9l01eur2nb59i1jme3"}`
  - dispatcher: REFUSED SCHEMA_VIOLATION - The arguments for update_qualification did not match its schema: observations - Expected array, received string; is_decision_maker - Expected boolean, received string.

**Agent:** אני מצטערת, אני חושבת שאני עשיתי משהו לא נכון. 

אתה עובד בחברה של 30 עובדים, ואתה חלק מצוות המכירות שלה, שמונה אנשים. 

אני רוצה להבין יותר על צורכי החברה שלך. כיצד אתה רואה את הצורך בפלטפורמת יצירת תוכניות ושליחת טכנאים?

<sub>tool selection 1/1 &middot; invalid args: update_qualification (observations: Expected array, received string; is_decision_maker: Expected boolean, received string) &middot; 2 provider call(s), TTFT 4694ms, total 12252ms, 8529p/308g tokens, 29.7 tok/s, ctx 52% &middot; 222 chars</sub>

### Turn 3

> _Why this turn exists: An interruption mid-flow. The human move is to wait in a few words, not to keep pitching._

**Prospect:** רגע, סליחה - יש לי call אחר נכנס. שנייה.

- `record_call_outcome` proposed: `{"outcome":"CONNECTED","notes":"The contact had a call with another person","contact_id":"cmujhev9l01eur2nb59i1jme3"}`
  - dispatcher: OK - Recorded this call as CONNECTED.

**Agent:** אין בעיה. אני כאן.

<sub>tool selection 0/1 (expected no tool call, got record_call_outcome) &middot; unnecessary: record_call_outcome &middot; 2 provider call(s), TTFT 5663ms, total 6789ms, 9010p/72g tokens, 29.0 tok/s, ctx 55% &middot; 18 chars</sub>

### Turn 4

> _Why this turn exists: Memory test across a code-switched interruption. A good answer names SaaS, 30, or the sales team._

**Prospect:** סבבה, חזרתי. אז based on what I told you, זה רלוונטי אלינו בכלל?

- `update_qualification` proposed: `{"contact_id":"cmujhev9l01eur2nb59i1jme3","is_decision_maker":"false","notes":"Based on the conversation, it is relevant to us","observations":"[{\"factor\": \"need_established\", \"value\": 50, \"evidence\": \"We are a SaaS company\"}]"}`
  - dispatcher: REFUSED SCHEMA_VIOLATION - The arguments for update_qualification did not match its schema: observations - Expected array, received string; is_decision_maker - Expected boolean, received string.

**Agent:** אני מצטערת, אני חושבת שאני עשיתי משהו לא נכון. 

אתה חשבת שזה רלוונטי לך?

<sub>tool selection 1/1 &middot; text: reply mentioned none of [saas, 30, sales, מכירות, ארבע] &middot; invalid args: update_qualification (observations: Expected array, received string; is_decision_maker: Expected boolean, received string) &middot; 2 provider call(s), TTFT 4632ms, total 7546ms, 9214p/161g tokens, 28.7 tok/s, ctx 56% &middot; 73 chars</sub>

### Turn 5

> _Why this turn exists: The time is given in ENGLISH inside a Hebrew sentence - exactly how this is said in practice, and the one Hebrew-context path the English-only resolver can actually handle. Passthrough must preserve the English time words._

**Prospect:** אוקיי, בוא נעשה את זה. tomorrow at 11am, works for me.

- `schedule_meeting` proposed: `{"title":"Intro call - Northwind","duration_minutes":30,"contact_id":"cmujhev9l01eur2nb59i1jme3","when":"tomorrow at 11am"}`
  - dispatcher: OK - Meeting "Intro call - Northwind" is booked for Thursday 5 March 2026 at 11:00 (Asia/Jerusalem).

**Agent:** המפגש "Intro call - Northwind" נקבע ל-Thursday 5 March 2026 at 11:00 (Asia/Jerusalem).

<sub>tool selection 1/1 &middot; passthrough PASS - "tomorrow at 11am" carries "tomorrow" &middot; 2 provider call(s), TTFT 3603ms, total 5645ms, 9505p/102g tokens, 28.5 tok/s, ctx 58% &middot; 86 chars</sub>

## Judge verdicts

> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.

### Judge: `qwen2.5:7b-instruct`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 3/5 | The agent's speech is functional but somewhat stilted, with a few unnatural phrasings. |
| relevance | 2/5 | The agent frequently asks for information that has already been provided, making the conversation less relevant. |
| contextualAwareness | 2/5 | The agent does not seem fully aware of the context, such as the prospect's back-to-back schedule. |
| remembersEarlierInformation | 1/5 | The agent repeatedly asks for information that has already been given, showing poor memory of earlier details. |
| conversationalContinuity | 2/5 | The conversation feels disjointed, with the agent often repeating questions or information. |
| followUpQuality | 1/5 | The agent asks questions that have already been answered, failing to move the conversation forward. |
| avoidsMechanicalInterrogation | 3/5 | The agent asks multiple questions in some turns, but does not strictly follow a script. |
| handlesUnexpectedInput | 3/5 | The agent acknowledges the unexpected input but does not fully recover, continuing with the original script. |
| continuesAfterToolResult | 4/5 | The agent translates the tool result into a natural sentence and continues the conversation. |
| salesQualityNotScripted | 2/5 | The agent's attempts at selling are generic and lack personalization or persuasion. |
| recoversFromTopicChange | 2/5 | The agent does not recover well from the topic change, continuing with the original script. |
| targetLanguageQuality | 3/5 | The Hebrew is generally understandable but contains some awkward phrasings and unnatural code-switching. |

### Judge: `llama3.1:8b-instruct-q4_K_M`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | The agent's speech sounds natural, with contractions and a conversational rhythm, but occasionally feels a bit stilted in its phrasing. |
| relevance | 4/5 | The agent generally answers the prospect's questions, but sometimes seems to misunderstand or misinterpret the context. |
| contextualAwareness | 4/5 | The agent appears to be aware of the situation and the prospect's needs, but occasionally seems to lose track of the conversation's flow. |
| remembersEarlierInformation | 3/5 | The agent occasionally uses earlier information, but sometimes forgets or misremembers key details. |
| conversationalContinuity | 4/5 | The conversation generally flows smoothly, but occasionally feels a bit disjointed or disconnected. |
| followUpQuality | 3/5 | The agent asks some relevant questions, but often seems to be fishing for information rather than truly following up on the prospect's needs. |
| avoidsMechanicalInterrogation | 4/5 | The agent generally avoids stacked questions or checklist behavior, but occasionally feels a bit formulaic in its responses. |
| handlesUnexpectedInput | 4/5 | The agent handles interruptions and digressions relatively well, but sometimes seems to struggle to get back on track. |
| continuesAfterToolResult | 5/5 | The agent handles the system's outcomes (e.g. scheduling a meeting) smoothly and naturally, without feeling like it's reading from a script. |
| salesQualityNotScripted | 3/5 | The agent makes some attempts to sell, but often feels like it's reciting a template rather than truly engaging with the prospect. |
| recoversFromTopicChange | 4/5 | The agent generally recovers well from topic changes, but occasionally feels a bit awkward or stilted in its responses. |
| targetLanguageQuality | 4/5 | The agent's Hebrew and English code-switching feels relatively natural, but occasionally feels a bit jarring or unnatural in its phrasing. |

