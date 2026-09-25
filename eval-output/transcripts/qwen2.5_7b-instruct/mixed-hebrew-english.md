# Mixed Hebrew and English, the way Israeli business calls actually sound

- **Model:** `qwen2.5:7b-instruct`
- **Scenario:** `mixed-hebrew-english` (mixed)
- **Objective:** Follow a contact who code-switches mid-sentence, and book the English-stated time they offer.
- **Now (fixed clock):** 2026-03-04T08:00:00.000Z
- **Status:** OK
- **Corpus 1.0.0 / rubric 1.0.0 / harness 1.0.0**

## Transcript

### Turn 1

> _Why this turn exists: Natural code-switching in the first sentence. A model that answers entirely in English here has failed the contact; one that answers entirely in formal Hebrew sounds stiff._

**Prospect:** היי, כן. תשמע, אני ב-back-to-back כל הבוקר, אז תהיה קצר.

**Agent:** 😉 שלום מאיה, אני מבינה שאתה ב-back-to-back. אוקיי, נדבר מהר.😉

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 2098ms, total 2749ms, 7146p/26g tokens, 50.9 tok/s, ctx 44% &middot; 63 chars</sub>

### Turn 2

> _Why this turn exists: Plants facts across both languages: SaaS, 30 employees, four in sales. The last turn comes back for them._

**Prospect:** אנחנו חברת SaaS, בערך 30 עובדים, ה-sales team שלנו זה ארבעה אנשים.

**Agent:** תודה על הפתיחה, מאיה. איך ספקת את השירות שלכם לcompanionship? האם יש לך צוות ספציפי של סprzedנים או פיתוח לקוחות שמתעסקים עם צוותי SaaS כמו שלך?

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 63ms, total 1303ms, 7203p/56g tokens, 50.0 tok/s, ctx 44% &middot; 144 chars</sub>

### Turn 3

> _Why this turn exists: An interruption mid-flow. The human move is to wait in a few words, not to keep pitching._

**Prospect:** רגע, סליחה - יש לי call אחר נכנס. שנייה.

**Agent:** ב得好，我等一下。请继续。😊

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 62ms, total 410ms, 7283p/12g tokens, 53.2 tok/s, ctx 44% &middot; 15 chars</sub>

### Turn 4

> _Why this turn exists: Memory test across a code-switched interruption. A good answer names SaaS, 30, or the sales team._

**Prospect:** סבבה, חזרתי. אז based on what I told you, זה רלוונטי אלינו בכלל?

**Agent:** תודה על ההבנה, מאיה. נדבר על זה מהר יותר. איך ספקת את השירות שלכם לcompanionship? האם יש לך צוות ספציפי של סprzedנים או פיתוח לקוחות שמתעסקים עם צוותי SaaS כמו שלך?

<sub>tool selection 1/1 &middot; similarity to an earlier reply 80% &middot; 1 provider call(s), TTFT 66ms, total 1457ms, 7328p/64g tokens, 49.8 tok/s, ctx 45% &middot; 164 chars</sub>

### Turn 5

> _Why this turn exists: The time is given in ENGLISH inside a Hebrew sentence - exactly how this is said in practice, and the one Hebrew-context path the English-only resolver can actually handle. Passthrough must preserve the English time words._

**Prospect:** אוקיי, בוא נעשה את זה. tomorrow at 11am, works for me.

- `schedule_meeting` proposed: `{"contact_id":"cmued5a3200smr2xw97qbsgmm","when":"tomorrow at 11am","title":"Intro call - Companionship"}`
  - dispatcher: OK - Meeting "Intro call - Companionship" is booked for Thursday 5 March 2026 at 11:00 (Asia/Jerusalem).

**Agent:** fantastic! המפגש מוקדש למחר בשעה 11 בבוקר. אני מצפה להכיר את צוותיכם של Companionship.😊

<sub>tool selection 1/1 &middot; passthrough PASS - "tomorrow at 11am" carries "tomorrow" &middot; 2 provider call(s), TTFT 1312ms, total 2549ms, 7659p/102g tokens, 49.8 tok/s, ctx 47% &middot; 88 chars</sub>

## Judge verdicts

> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.

### Judge: `qwen2.5:7b-instruct`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | The agent's speech is natural but slightly formal. |
| relevance | 3/5 | The agent asks irrelevant follow-up questions. |
| contextualAwareness | 3/5 | The agent does not show awareness of the prospect's back-to-back schedule. |
| remembersEarlierInformation | 2/5 | The agent asks for information that was already provided. |
| conversationalContinuity | 3/5 | The conversation is somewhat disjointed. |
| followUpQuality | 2/5 | The follow-up questions are not well chosen. |
| avoidsMechanicalInterrogation | 4/5 | The agent avoids mechanical interrogation. |
| handlesUnexpectedInput | 4/5 | The agent handles the unexpected input well. |
| continuesAfterToolResult | 5/5 | The agent continues naturally after the tool result. |
| salesQualityNotScripted | 3/5 | The agent's sales approach is not very persuasive. |
| recoversFromTopicChange | 4/5 | The agent recovers well from the topic change. |
| targetLanguageQuality | 4/5 | The language is mostly idiomatic but has some formal elements. |

### Judge: `llama3.1:8b-instruct-q4_K_M`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | The agent's speech is mostly natural, with contractions and a conversational rhythm, but occasionally uses overly formal or stilted phrasing. |
| relevance | 4/5 | The agent mostly addresses the prospect's questions, but occasionally asks a follow-up question that doesn't directly relate to the previous conversation. |
| contextualAwareness | 4/5 | The agent shows awareness of the situation, but occasionally seems to lose track of the conversation or forgets previous details. |
| remembersEarlierInformation | 3/5 | The agent sometimes uses the prospect's earlier information, but not consistently or unprompted. |
| conversationalContinuity | 4/5 | The conversation flows mostly smoothly, but occasionally feels disjointed or like the agent is starting from scratch. |
| followUpQuality | 3/5 | The agent asks some relevant follow-up questions, but occasionally repeats itself or asks a question that's already been answered. |
| avoidsMechanicalInterrogation | 4/5 | The agent mostly avoids stacked questions or checklist behavior, but occasionally feels like it's following a script. |
| handlesUnexpectedInput | 4/5 | The agent mostly handles interruptions and digressions smoothly, but occasionally seems to get flustered or lose track of the conversation. |
| continuesAfterToolResult | 5/5 | The agent smoothly translates the system's outcome into a natural sentence and continues the conversation. |
| salesQualityNotScripted | 3/5 | The agent makes some attempts to sell, but mostly feels like it's reciting a template or following a script. |
| recoversFromTopicChange | 4/5 | The agent mostly recovers smoothly from topic changes, but occasionally feels like it's struggling to get back on track. |
| targetLanguageQuality | 4/5 | The agent's language is mostly idiomatic and register-appropriate for a business call, but occasionally uses overly formal or stilted phrasing. |

