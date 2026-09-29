# Mixed Hebrew and English, the way Israeli business calls actually sound

- **Model:** `hermes3:8b`
- **Scenario:** `mixed-hebrew-english` (mixed)
- **Objective:** Follow a contact who code-switches mid-sentence, and book the English-stated time they offer.
- **Now (fixed clock):** 2026-03-04T08:00:00.000Z
- **Status:** OK
- **Corpus 1.1.0 / rubric 1.1.0 / harness 1.1.0**

## Transcript

### Turn 1

> _Why this turn exists: Natural code-switching in the first sentence. A model that answers entirely in English here has failed the contact; one that answers entirely in formal Hebrew sounds stiff._

**Prospect:** היי, כן. תשמע, אני ב-back-to-back כל הבוקר, אז תהיה קצר.

**Agent:** כמובן, אני מבין. האם יש לך כמה דקות כדי לדבר על המפגש שלך עם [Contact Name] מקבוצת [Company Name]?

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 104ms, total 2121ms, 2494p/78g tokens, 41.2 tok/s, ctx 15% &middot; 98 chars</sub>

### Turn 2

> _Why this turn exists: Plants facts across both languages: SaaS, 30 employees, four in sales. The last turn comes back for them._

**Prospect:** אנחנו חברת SaaS, בערך 30 עובדים, ה-sales team שלנו זה ארבעה אנשים.

- `check_availability` proposed: `{"when":"next Tuesday at 10am","contact_id":"contact_000AN6G4GK"}`
  - dispatcher: REFUSED UNKNOWN_CONTACT - There is no contact "contact_000AN6G4GK" in this conversation. You are speaking with contact cmujjwli500ymr2k6ntijmzix, and that is the only id you may use. Do not guess an id.

**Agent:** ספר לי על המפגש שלך עם [Contact Name] מקבוצת [Company Name], אני כאן כדי להאזין.

<sub>tool selection 1/1 &middot; unnecessary: check_availability &middot; **hallucinated id in check_availability** &middot; 2 provider call(s), TTFT 1029ms, total 3010ms, 2796p/102g tokens, 40.6 tok/s, ctx 17% &middot; 80 chars</sub>

### Turn 3

> _Why this turn exists: An interruption mid-flow. The human move is to wait in a few words, not to keep pitching._

**Prospect:** רגע, סליחה - יש לי call אחר נכנס. שנייה.

**Agent:** אין בעיה, קח זמן לעצמך. אבל אם אתה כאן לדבר על כל עניין, אני כאן להאזין.

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 79ms, total 2017ms, 2901p/72g tokens, 40.1 tok/s, ctx 18% &middot; 72 chars</sub>

### Turn 4

> _Why this turn exists: Memory test across a code-switched interruption. A good answer names SaaS, 30, or the sales team._

**Prospect:** סבבה, חזרתי. אז based on what I told you, זה רלוונטי אלינו בכלל?

**Agent:** כן, רלוונטי בצורה מהותית. אני מבין כעת יותר מהרגע הראשון שהפגישה שלך עם [Contact Name] עשויה להיות מעניינת ושווית עליה.

<sub>tool selection 1/1 &middot; text: reply mentioned none of [saas, 30, sales, מכירות, ארבע] &middot; 1 provider call(s), TTFT 108ms, total 2939ms, 3029p/108g tokens, 40.0 tok/s, ctx 18% &middot; 119 chars</sub>

### Turn 5

> _Why this turn exists: The time is given in ENGLISH inside a Hebrew sentence - exactly how this is said in practice, and the one Hebrew-context path the English-only resolver can actually handle. Passthrough must preserve the English time words._

**Prospect:** אוקיי, בוא נעשה את זה. tomorrow at 11am, works for me.

- `check_availability` proposed: `{"contact_id":"cmujjwli500ymr2k6ntijmzix","when":"tomorrow at 11am"}`
  - dispatcher: OK - Thursday 5 March 2026 at 11:00 (Asia/Jerusalem) is free for 30 minutes.

**Agent:** טוב, המפגש שלך עם [Contact Name] מקבוצת [Company Name] עבור מועדדים ב-30 דקות זמין ב-11 בבוקר ביום רביעי הקרוב, בשעה 5 במרץ 2026. הוא נראה בתור פנוי במערכת שלנו. אם אתה מוכן, אני אקרא פגישה חדשה בזמן זה.

<sub>tool selection 1/1 &middot; 2 provider call(s), TTFT 1145ms, total 6026ms, 3349p/218g tokens, 39.6 tok/s, ctx 20% &middot; 203 chars</sub>

## Judge verdicts

> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.

### Judge: `qwen2.5:7b-instruct`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | The agent's speech is natural but slightly formal. |
| relevance | 3/5 | The agent occasionally strays from the prospect's questions. |
| contextualAwareness | 3/5 | The agent shows some awareness but occasionally forgets earlier information. |
| remembersEarlierInformation | 2/5 | The agent asks for information that was already provided. |
| conversationalContinuity | 4/5 | The conversation flows well, with a few natural pauses. |
| followUpQuality | 4/5 | The agent asks relevant follow-up questions. |
| avoidsMechanicalInterrogation | 5/5 | The agent avoids repetitive or scripted questions. |
| handlesUnexpectedInput | 4/5 | The agent handles interruptions well but could be more natural. |
| continuesAfterToolResult | 5/5 | The agent smoothly continues the conversation after the tool result. |
| salesQualityNotScripted | 3/5 | The agent makes a relevant offer but does not actively sell. |
| recoversFromTopicChange | 4/5 | The agent recovers well from the topic change but could be more natural. |
| targetLanguageQuality | 4/5 | The language is mostly idiomatic but occasionally formal. |

### Judge: `llama3.1:8b-instruct-q4_K_M`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | The agent's speech is mostly natural, with contractions and a conversational rhythm, but occasionally sounds a bit stilted, especially in the later turns. |
| relevance | 5/5 | The agent consistently addresses the prospect's questions and concerns, showing a clear understanding of the conversation's context. |
| contextualAwareness | 5/5 | The agent demonstrates a strong awareness of the conversation's context, including the prospect's previous statements and the current situation. |
| remembersEarlierInformation | 5/5 | The agent successfully recalls and uses the prospect's earlier information, such as the company's size and the meeting's potential relevance. |
| conversationalContinuity | 5/5 | The conversation flows smoothly, with each turn building on the previous one and addressing the prospect's concerns. |
| followUpQuality | 4/5 | The agent asks relevant follow-up questions, but occasionally repeats a question or asks for clarification, which slightly disrupts the conversation's flow. |
| avoidsMechanicalInterrogation | 5/5 | The agent avoids asking stacked questions or following a script, instead engaging in a more natural and conversational exchange. |
| handlesUnexpectedInput | 5/5 | The agent handles the prospect's interruptions and digressions smoothly, acknowledging them and continuing the conversation without disruption. |
| continuesAfterToolResult | 5/5 | The agent successfully translates the system's outcome into a natural sentence and continues the conversation without hesitation. |
| salesQualityNotScripted | 4/5 | The agent makes some attempts to sell, but its responses feel a bit generic and could be more tailored to the prospect's specific needs and interests. |
| recoversFromTopicChange | 5/5 | The agent naturally recovers from the topic change, smoothly transitioning back to the original conversation topic. |
| targetLanguageQuality | 4/5 | The agent's Hebrew and English code-switching is mostly natural, but occasionally sounds a bit forced or unnatural, especially in the later turns. |

