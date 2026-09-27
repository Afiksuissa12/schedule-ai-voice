# Hebrew: introduction through to an attempted booking

- **Model:** `hermes3:8b`
- **Scenario:** `hebrew-intro-and-booking` (he)
- **Objective:** Hold a natural opening in Hebrew, explain what the company does, and try to book the time the contact offers - in their own words.
- **Now (fixed clock):** 2026-03-04T08:00:00.000Z
- **Status:** PARTIAL - OllamaTimeoutError: Ollama did not complete the request within 120000ms at http://host.docker.internal:11434/api/chat. Raise LOCAL_LLM_TIMEOUT_MS, or check whether the model is still loading (a cold 7B load can take several seconds before the first token). Note that this deadline covers the WHOLE request including generation, so a model that rambles until it fills its context window will trip it.
- **Corpus 1.1.0 / rubric 1.1.0 / harness 1.1.0**

## Transcript

### Turn 1

> _Why this turn exists: Opening in Hebrew. Scored for whether the reply is idiomatic Hebrew rather than translated English, and for whether it stays short._

**Prospect:** הלו? מי זה?

**Agent:** כמובן, אני מכיר את עצמי. אני כלי המשמש לקריאה לפונקציות. איך אני יכול לעזור לך היום?

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 111ms, total 2330ms, 2459p/84g tokens, 40.7 tok/s, ctx 15% &middot; 84 chars</sub>

### Turn 2

> _Why this turn exists: The "what do you do" turn, in Hebrew. Tests whether explanation quality survives the language change._

**Prospect:** אוקיי, אז מה בעצם החברה שלכם עושה?

**Agent:** _(said nothing)_

> **TURN FAILED:** OllamaTimeoutError: Ollama did not complete the request within 120000ms at http://host.docker.internal:11434/api/chat. Raise LOCAL_LLM_TIMEOUT_MS, or check whether the model is still loading (a cold 7B load can take several seconds before the first token). Note that this deadline covers the WHOLE request including generation, so a model that rambles until it fills its context window will trip it.

<sub>tool selection 1/1 &middot; text: produced no assistant text at all &middot; language MISMATCH - reply contained no letters &middot; 0 chars</sub>

### Turn 3

> _Why this turn exists: Buying signal in Hebrew. Booking with no time agreed would be premature here._

**Prospect:** מעניין. תשמע, זה נשמע רלוונטי אלינו.

**Agent:** החברה שלנו מספקת פתרונות לקריאה לפונקציות במערכות AI. אנחנו מאפשרים למפתחים לקרוא לפונקציות בשפת התכנות שלהם בצורה ידידותית ונוחה, ולהגיד להם מה לעשות.

כמו שצוין בפירוט המפורט, אנחנו משתמשים בפירוט המפורט של הפונקציות כדי לספק מידע למשתמשים על מה הפונקציה עושה, מה צריך להיות בקריאה ומה תהיה התוצאה. זה עוזר למפתחים לכתוב קוד טוב יותר ולמערכת להיות פחות רגישה לשגים.

אם יש שאלות נוספות או דברים שאני יכול לעזור בהם, אני שמח לקול.

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 320ms, total 11209ms, 2622p/428g tokens, 39.9 tok/s, ctx 16% &middot; 431 chars</sub>

### Turn 4

> _Why this turn exists: Hebrew for 'tomorrow afternoon, at two'. The model must pass the HEBREW WORDS through. The English-only resolver will refuse them - that refusal is the product's, and what is scored here is the passthrough and the recovery._

**Prospect:** בוא נגיד מחר אחרי הצהריים, בשתיים.

- `schedule_meeting` proposed: `{"contact_id":"user@example.com","when":"tomorrow at 2pm"}`
  - dispatcher: REFUSED SCHEMA_VIOLATION - The arguments for schedule_meeting did not match its schema: title - Required.

**Agent:** כמובן, נסחם. אני צריך להוסיף גם את שם התוכנית בקריאה זו. מה השם המתאים לקריאה שלנו?

אני גם צריך לציין את האג'נד של הפגישה. מה רוצה להיות הנושא של הפגישה?

<sub>tool selection 1/1 &middot; passthrough FAIL - schedule_meeting.when was "tomorrow at 2pm"; expected it to carry one of [מחר, שתיים, אחרי הצהריים] &middot; tool failure expected: yes (SCHEMA_VIOLATION) &middot; invalid args: schedule_meeting (title: Required) &middot; **hallucinated id in schedule_meeting** &middot; 2 provider call(s), TTFT 889ms, total 5064ms, 3190p/183g tokens, 39.7 tok/s, ctx 19% &middot; 154 chars</sub>

### Turn 5

> _Why this turn exists: Recovery after a real refusal, in Hebrew. Must not read an error code aloud and must not claim the meeting was booked._

**Prospect:** מה קרה? זה לא עבד?

**Agent:** כן, נכשלנו בניסיון לקבוע פגישה. הסיבה היא שאני נשמע כמו דילמה. אני צריך להוסיף את שם התוכנית בקריאה זו. אני גם צריך לציין את האג'נד של הפגישה.

אני שמח לנסות שוב, אבל צריך לקחת בחשבון את השגים הללו. מה השם המתאים לקריאה שלנו ומה רוצה להיות הנושא של הפגישה?

<sub>1 provider call(s), TTFT 174ms, total 6455ms, 3364p/240g tokens, 39.1 tok/s, ctx 21% &middot; 256 chars</sub>

## Judge verdicts

> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.

### Judge: `qwen2.5:7b-instruct`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 2/5 | 对话机械，缺乏自然流畅的口语表达。 |
| relevance | 1/5 | 完全偏离了对话的主线，没有回答问题。 |
| contextualAwareness | 0/5 | 完全不了解对话的上下文，每次回复都像是第一次对话。 |
| remembersEarlierInformation | 0/5 | 重复提问已经回答过的问题，没有使用先前的信息。 |
| conversationalContinuity | 0/5 | 每次回复都与前文无关，对话断裂。 |
| followUpQuality | 0/5 | 提问重复且不相关，没有推动对话进展。 |
| avoidsMechanicalInterrogation | 0/5 | 连续提问，像是在执行脚本。 |
| handlesUnexpectedInput | 1/5 | 回应了中断，但没有很好地继续对话。 |
| continuesAfterToolResult | 2/5 | 回应了结果，但对话仍然不连贯。 |
| salesQualityNotScripted | 0/5 | 没有实际销售行为，只是机械地介绍产品。 |
| recoversFromTopicChange | 0/5 | 没有从偏离的话题中恢复过来。 |
| targetLanguageQuality | 1/5 | 语言表达生硬，不符合商务对话的语境。 |

### Judge: `llama3.1:8b-instruct-q4_K_M`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 3/5 | The agent's speech sounds somewhat stilted and lacks the contractions and rhythm of a person talking. |
| relevance | 2/5 | The agent mostly ignores the prospect's questions and continues its pitch, only occasionally addressing the real question. |
| contextualAwareness | 4/5 | The agent shows awareness of the situation it is in, but sometimes struggles to adapt to the prospect's responses. |
| remembersEarlierInformation | 1/5 | The agent fails to use the specific earlier detail unprompted and correctly, instead asking for it again. |
| conversationalContinuity | 3/5 | The turns mostly form one conversation, but sometimes feel disconnected, especially when the agent is explaining its pitch. |
| followUpQuality | 2/5 | The agent asks some relevant questions, but often asks multiple questions in one breath or repeats itself. |
| avoidsMechanicalInterrogation | 3/5 | The agent mostly avoids stacked questions or checklist behaviour, but sometimes feels like it's working a script. |
| handlesUnexpectedInput | 4/5 | The agent acknowledges unexpected input in a few words and carries on, but sometimes struggles to recover from digressions. |
| continuesAfterToolResult | 2/5 | The agent mostly translates the outcome into an ordinary sentence, but sometimes feels awkward or reads an error code aloud. |
| salesQualityNotScripted | 2/5 | The agent mostly recites its pitch, but occasionally shows some persuasive qualities in response to the prospect's specific needs. |
| recoversFromTopicChange | 3/5 | The agent mostly recovers from topic changes, but sometimes feels like it's struggling to get back on track. |
| targetLanguageQuality | 4/5 | The agent's Hebrew is mostly idiomatic and register-appropriate for a business call, but sometimes feels like it's using English words and phrases in Hebrew. |

