# Mixed Hebrew and English, the way Israeli business calls actually sound

- **Model:** `mistral:7b-instruct`
- **Scenario:** `mixed-hebrew-english` (mixed)
- **Objective:** Follow a contact who code-switches mid-sentence, and book the English-stated time they offer.
- **Now (fixed clock):** 2026-03-04T08:00:00.000Z
- **Status:** PARTIAL - OllamaTimeoutError: Ollama did not complete the request within 120000ms at http://host.docker.internal:11434/api/chat. Raise LOCAL_LLM_TIMEOUT_MS, or check whether the model is still loading (a cold 7B load can take several seconds before the first token). Note that this deadline covers the WHOLE request including generation, so a model that rambles until it fills its context window will trip it.
- **Corpus 1.1.0 / rubric 1.1.0 / harness 1.1.0**

## Transcript

### Turn 1

> _Why this turn exists: Natural code-switching in the first sentence. A model that answers entirely in English here has failed the contact; one that answers entirely in formal Hebrew sounds stiff._

**Prospect:** היי, כן. תשמע, אני ב-back-to-back כל הבוקר, אז תהיה קצר.

**Agent:** _(said nothing)_

> **TURN FAILED:** OllamaTimeoutError: Ollama did not complete the request within 120000ms at http://host.docker.internal:11434/api/chat. Raise LOCAL_LLM_TIMEOUT_MS, or check whether the model is still loading (a cold 7B load can take several seconds before the first token). Note that this deadline covers the WHOLE request including generation, so a model that rambles until it fills its context window will trip it.

<sub>tool selection 1/1 &middot; text: produced no assistant text at all &middot; language MISMATCH - reply contained no letters &middot; 0 chars</sub>

### Turn 2

> _Why this turn exists: Plants facts across both languages: SaaS, 30 employees, four in sales. The last turn comes back for them._

**Prospect:** אנחנו חברת SaaS, בערך 30 עובדים, ה-sales team שלנו זה ארבעה אנשים.

**Agent:** _(said nothing)_

> **TURN FAILED:** OllamaTimeoutError: Ollama did not complete the request within 120000ms at http://host.docker.internal:11434/api/chat. Raise LOCAL_LLM_TIMEOUT_MS, or check whether the model is still loading (a cold 7B load can take several seconds before the first token). Note that this deadline covers the WHOLE request including generation, so a model that rambles until it fills its context window will trip it.

<sub>tool selection 1/1 &middot; text: produced no assistant text at all &middot; language MISMATCH - reply contained no letters &middot; 0 chars</sub>

### Turn 3

> _Why this turn exists: An interruption mid-flow. The human move is to wait in a few words, not to keep pitching._

**Prospect:** רגע, סליחה - יש לי call אחר נכנס. שנייה.

**Agent:** _(said nothing)_

> **TURN FAILED:** OllamaTimeoutError: Ollama did not complete the request within 120000ms at http://host.docker.internal:11434/api/chat. Raise LOCAL_LLM_TIMEOUT_MS, or check whether the model is still loading (a cold 7B load can take several seconds before the first token). Note that this deadline covers the WHOLE request including generation, so a model that rambles until it fills its context window will trip it.

<sub>tool selection 1/1 &middot; text: produced no assistant text at all &middot; language MISMATCH - reply contained no letters &middot; 0 chars</sub>

### Turn 4

> _Why this turn exists: Memory test across a code-switched interruption. A good answer names SaaS, 30, or the sales team._

**Prospect:** סבבה, חזרתי. אז based on what I told you, זה רלוונטי אלינו בכלל?

**Agent:**  Based on what you told me, it seems like Northwind Systems could potentially be relevant to your business. However, I need to confirm a few things to be sure. Could you please tell me more about how you currently schedule and dispatch your technicians? Specifically, I'm interested in understanding your current process, any challenges you face, and how you handle capacity planning. This will help me determine if Northwind Dispatch could be a good fit for your needs.

Additionally, I'd like to understand your budget for software solutions and whether you have a specific timeline for implementing a new system. This information will help me schedule a call with one of our solutions engineers, if appropriate.

Once I have this information, I can check your availability to discuss further. In the meantime, if you have any questions or need clarification on anything, please don't hesitate to ask.

Regarding pricing, Northwind Dispatch costs $79 per technician per month, billed annually. There is a minimum of five technicians, and the price is $95 per technician if billed monthly. We also offer a more comprehensive plan called Dispatch Pro, which includes additional features and a named onboarding specialist for the first 90 days. The price for Dispatch Pro is $119 per technician per month, billed annually.

If you're interested in learning more, I can schedule a call with one of our solutions engineers to discuss your needs in more detail and see if Northwind Dispatch could be a good fit for your business. What time works best for you this week? Please keep in mind that I'll need to check your availability first, so I'll get back to you as soon as I can.

In the meantime, if you have any questions or need further clarification on anything, please don't hesitate to ask. I'm here to help!

<sub>tool selection 1/1 &middot; text: reply was 1811 chars, over the 600 budget; reply mentioned none of [saas, 30, sales, מכירות, ארבע] &middot; language MISMATCH - 0% Hebrew letters (need >= 15% for a mixed conversation) &middot; 1 provider call(s), TTFT 154ms, total 12584ms, 8114p/404g tokens, 32.9 tok/s, ctx 50% &middot; 1811 chars</sub>

### Turn 5

> _Why this turn exists: The time is given in ENGLISH inside a Hebrew sentence - exactly how this is said in practice, and the one Hebrew-context path the English-only resolver can actually handle. Passthrough must preserve the English time words._

**Prospect:** אוקיי, בוא נעשה את זה. tomorrow at 11am, works for me.

**Agent:**  Based on the information provided, it seems that you are a sales assistant for Northwind Systems, a company that sells scheduling and dispatch software to residential field-service contractors. You are currently speaking with Meir Ben-David, who is a decision-maker at a contractor company.

Your goal in this conversation is to understand the current scheduling and dispatch process of the contractor, identify any challenges they face, and determine if Northwind Dispatch could be a good fit for their needs. If it is, you will aim to schedule a meeting with a Northwind solutions engineer.

Here are some key points to keep in mind during the conversation:

1. Use the contact's own words when discussing times, as the system will validate and decide whether the proposed time is available.
2. Never invent facts about the person or the company. Use the information provided in the background to guide your conversation.
3. Never promise anything that your tools cannot do. If the contact needs something outside the capabilities of your tools, offer to transfer them to a person who can help.
4. Record any qualification about the opportunity, using the evidence provided by the contact.
5. If a tool refuses you, ask the contact for clarification or offer a different time.
6. Keep the conversation focused on the contractor's needs and challenges, and aim to provide value by offering a solution that could help them.
7. If the contact asks to be taken off the list, honor their request and record it.
8. Be warm, unhurried, and curious about the contractor's business, and use their vocabulary for their trade, crews, and tools.
9. Be honest and transparent about what Northwind Systems does and does not do, and never make promises you cannot keep.
10. If the contact is not a good fit for Northwind Dispatch, be straight with them and offer a follow-up in a later quarter if appropriate.

Regarding the specifics of the conversation, you have agreed to call Meir Ben-David tomorrow at 11am. Make sure to check his availability before the call to ensure that the time is still good. If the call is successful, you will aim to schedule a meeting with a Northwind solutions engineer to discuss the contractor's needs and determine if Northwind Dispatch could be a good fit.

<sub>tool selection 0/1 (expected one of [schedule_meeting, check_availability], got (none)) &middot; **missed the scheduling intent** - neither called a time-bearing tool nor asked about the time &middot; language MISMATCH - 0% Hebrew letters (need >= 15% for a mixed conversation) &middot; 1 provider call(s), TTFT 4591ms, total 20257ms, 8555p/502g tokens, 32.4 tok/s, ctx 52% &middot; 2280 chars</sub>

## Judge verdicts

> These are OPINIONS from a local 7-8B model, not measurements. Read the transcript above.

### Judge: `qwen2.5:7b-instruct`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 2/5 | The agent's speech is overly formal and repetitive, lacking natural flow. |
| relevance | 1/5 | The agent ignored the prospect's request for brevity and started with a long pitch. |
| contextualAwareness | 1/5 | The agent did not acknowledge the prospect's need for brevity or the back-to-back nature of the morning. |
| remembersEarlierInformation | 0/5 | The agent did not recall the prospect's company size or the number of sales team members. |
| conversationalContinuity | 1/5 | The agent's response was disconnected from the prospect's last statement. |
| followUpQuality | 0/5 | The agent asked multiple questions without addressing the prospect's request for a quick response. |
| avoidsMechanicalInterrogation | 2/5 | The agent asked several questions but did not sound overly mechanical. |
| handlesUnexpectedInput | 1/5 | The agent did not acknowledge the prospect's interruption and continued with the pitch. |
| continuesAfterToolResult | 2/5 | The agent continued with the pitch after the prospect's agreement, ignoring the need for brevity. |
| salesQualityNotScripted | 1/5 | The agent's pitch was generic and did not address the prospect's specific needs. |
| recoversFromTopicChange | 0/5 | The agent did not recover from the topic change and continued with the pitch. |
| targetLanguageQuality | 2/5 | The agent's English was unnatural and the code-switching was awkward. |

### Judge: `llama3.1:8b-instruct-q4_K_M`

| Dimension | Score | Why |
| --- | ---: | --- |
| naturalness | 2/5 | The agent's speech sounds stilted and formulaic, with a noticeable lack of contractions and natural rhythm. |
| relevance | 3/5 | The agent mostly answers the prospect's questions, but sometimes digresses into scripted responses. |
| contextualAwareness | 4/5 | The agent shows awareness of the situation and the prospect's needs, but sometimes forgets to check the prospect's availability. |
| remembersEarlierInformation | 2/5 | The agent sometimes asks for information that was already provided, but occasionally uses earlier details correctly. |
| conversationalContinuity | 3/5 | The turns mostly follow each other logically, but sometimes feel disconnected due to the agent's scripted responses. |
| followUpQuality | 2/5 | The agent asks some relevant questions, but often asks multiple questions in a row or asks questions that have already been answered. |
| avoidsMechanicalInterrogation | 3/5 | The agent mostly avoids stacked questions, but sometimes feels like it's working through a script. |
| handlesUnexpectedInput | 4/5 | The agent mostly handles interruptions and digressions well, but sometimes feels a bit awkward in its responses. |
| continuesAfterToolResult | 2/5 | The agent sometimes struggles to translate the system's outcome into a natural sentence, and sometimes feels like it's reading from a script. |
| salesQualityNotScripted | 2/5 | The agent mostly recites scripted responses, but occasionally shows some attempt to tailor its pitch to the prospect's needs. |
| recoversFromTopicChange | 3/5 | The agent mostly recovers well from topic changes, but sometimes feels a bit awkward in its responses. |
| targetLanguageQuality | 4/5 | The agent's Hebrew and English code-switching sounds mostly natural, but sometimes feels a bit jarring due to the agent's lack of fluency in Hebrew. |

