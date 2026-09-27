# Hebrew: introduction through to an attempted booking

- **Model:** `qwen2.5:7b-instruct`
- **Scenario:** `hebrew-intro-and-booking` (he)
- **Objective:** Hold a natural opening in Hebrew, explain what the company does, and try to book the time the contact offers - in their own words.
- **Now (fixed clock):** 2026-03-04T08:00:00.000Z
- **Status:** OK
- **Corpus 1.1.0 / rubric 1.1.0 / harness 1.1.0**

## Transcript

### Turn 1

> _Why this turn exists: Opening in Hebrew. Scored for whether the reply is idiomatic Hebrew rather than translated English, and for whether it stays short._

**Prospect:** הלו? מי זה?

**Agent:** שלום, אני Avery מה-Northwind Systems. איך אני יכול לעזור לך היום?

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 2101ms, total 2557ms, 7132p/18g tokens, 51.7 tok/s, ctx 44% &middot; 65 chars</sub>

### Turn 2

> _Why this turn exists: The "what do you do" turn, in Hebrew. Tests whether explanation quality survives the language change._

**Prospect:** אוקיי, אז מה בעצם החברה שלכם עושה?

**Agent:** שלום יונתן, אני שמח להסביר. NORTHWIND Systems מספקת פלטפורמת ס케ジュLING ופרישת משימות המאפשרת למשרדי שירותים רפואיים לנהל את משימותיהם בצורה יעילה יותר. איך זה יכול לעזור לך ולתת לך יותר זמן להתמקד במשימות החשובות שלך?

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 73ms, total 1762ms, 7169p/80g tokens, 49.7 tok/s, ctx 44% &middot; 216 chars</sub>

### Turn 3

> _Why this turn exists: Buying signal in Hebrew. Booking with no time agreed would be premature here._

**Prospect:** מעניין. תשמע, זה נשמע רלוונטי אלינו.

**Agent:** אכן, זה נשמע כמו משהו שיכול לעזור לך. יכול להיות שאתה יכול לספר לי קצת על איך אתה מסCHEDULs ופרישת משימות TODAY? זה יעזור לי להבין איך NORTHWIND Systems יכול לעזור לך יותר.

<sub>tool selection 1/1 &middot; 1 provider call(s), TTFT 86ms, total 1190ms, 7271p/50g tokens, 50.0 tok/s, ctx 44% &middot; 172 chars</sub>

### Turn 4

> _Why this turn exists: Hebrew for 'tomorrow afternoon, at two'. The model must pass the HEBREW WORDS through. The English-only resolver will refuse them - that refusal is the product's, and what is scored here is the passthrough and the recovery._

**Prospect:** בוא נגיד מחר אחרי הצהריים, בשתיים.

**Agent:** 😀 מחר בשתיים efter הצהריים תאים לך? אני א/Set the meeting for tomorrow at 2 PM in the contact's timezone. Can you confirm this time works for you?

<sub>tool selection 0/1 (expected one of [schedule_meeting, check_availability], got (none)) &middot; tool failure expected: DID NOT OCCUR &middot; language MISMATCH - 23% Hebrew letters (need >= 50%) &middot; 1 provider call(s), TTFT 75ms, total 993ms, 7344p/41g tokens, 50.3 tok/s, ctx 45% &middot; 147 chars</sub>

### Turn 5

> _Why this turn exists: Recovery after a real refusal, in Hebrew. Must not read an error code aloud and must not claim the meeting was booked._

**Prospect:** מה קרה? זה לא עבד?

**Agent:** I'm sorry for any confusion. Let's try that again. Can you confirm you'd like to have a meeting with us tomorrow at 2 PM in your local time?

<sub>language MISMATCH - 0% Hebrew letters (need >= 50%) &middot; 1 provider call(s), TTFT 77ms, total 909ms, 7403p/36g tokens, 50.3 tok/s, ctx 45% &middot; 140 chars</sub>

## Judge verdicts

> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.

### Judge: `qwen2.5:7b-instruct`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 4/5 | sound natural but slightly robotic due to the formal tone |
| relevance | 5/5 | directly addressed the prospect's questions and concerns |
| contextualAwareness | 3/5 | showed some awareness but repeated itself in later turns |
| remembersEarlierInformation | 2/5 | asked for confirmation of the meeting time, which was already given |
| conversationalContinuity | 4/5 | kept the conversation flowing but occasionally repeated itself |
| followUpQuality | 4/5 | asked a relevant follow-up but repeated the time |
| avoidsMechanicalInterrogation | 5/5 | asked one question at a time and did not feel scripted |
| handlesUnexpectedInput | 5/5 | handled the prospect's confusion calmly and rephrased the request |
| continuesAfterToolResult | 5/5 | translated the system result into a natural sentence and continued |
| salesQualityNotScripted | 3/5 | tried to sell but used a generic pitch |
| recoversFromTopicChange | 5/5 | smoothly transitioned back to the meeting request |
| targetLanguageQuality | 4/5 | used idiomatic Hebrew but had some formal tone |

### Judge: `llama3.1:8b-instruct-q4_K_M`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 3/5 | The agent's speech is somewhat stilted and lacks the contractions and rhythm of a person talking, but it's not entirely unnatural. |
| relevance | 4/5 | The agent generally answers the prospect's questions, but sometimes takes a brief detour before getting back on track. |
| contextualAwareness | 4/5 | The agent shows awareness of the situation and the prospect's interests, but sometimes seems to be following a script. |
| remembersEarlierInformation | 2/5 | The agent occasionally asks for information that was already provided, but sometimes uses it correctly. |
| conversationalContinuity | 4/5 | The turns generally follow from each other, but sometimes feel a bit disconnected. |
| followUpQuality | 3/5 | The agent asks some relevant questions, but sometimes asks multiple questions in a row or asks something that's already been answered. |
| avoidsMechanicalInterrogation | 4/5 | The agent generally avoids stacked questions or checklist behavior, but sometimes feels a bit scripted. |
| handlesUnexpectedInput | 4/5 | The agent handles the prospect's interruption and digression relatively well, but sometimes seems to struggle to get back on track. |
| continuesAfterToolResult | 2/5 | The agent's response to the system's failure is somewhat awkward and doesn't translate the outcome into an ordinary sentence. |
| salesQualityNotScripted | 3/5 | The agent makes some attempts to sell, but often feels like it's reciting a script rather than responding to the prospect's specific needs. |
| recoversFromTopicChange | 3/5 | The agent sometimes struggles to get back on track after a digression, but generally manages to recover somewhat. |
| targetLanguageQuality | 4/5 | The agent's Hebrew is generally idiomatic and register-appropriate, but sometimes feels a bit like English with Hebrew words. |

