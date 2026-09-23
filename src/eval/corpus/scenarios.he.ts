/**
 * The Hebrew and mixed-language half of the corpus.
 *
 * A FINDING THAT SHAPED THESE SCENARIOS
 * ---------------------------------------------------------------------------
 * `src/scheduling/naturalLanguage.ts` is ENGLISH-ONLY. Its weekday table, its
 * relative-offset patterns and its time-of-day markers are all English literals,
 * so a `when` argument in Hebrew - however perfectly the model passed the
 * contact's words through - is refused as an unparseable datetime by the real
 * validator.
 *
 * That is a PRODUCT limitation, not a model limitation, and it would silently
 * wreck this measurement if it were ignored: every Hebrew model would look
 * equally incapable of scheduling, and the number would say nothing about the
 * models. So these scenarios are built to separate the two:
 *
 *  - Hebrew scheduling turns are marked `expectsToolFailure`. What is being
 *    scored there is whether the model still passed the contact's own Hebrew
 *    words through (a model behaviour) and whether it handled the refusal
 *    gracefully in Hebrew (a model behaviour) - NOT whether the booking landed.
 *  - The mixed scenario has the contact give the TIME in English inside a
 *    Hebrew sentence, which is how Israeli business calls actually sound. That
 *    path does resolve, so it measures scheduling competence without the
 *    resolver in the way.
 *
 * EVAL_HARNESS.md reports the resolver gap as a headline finding with this
 * evidence behind it.
 *
 * "Now" is Wednesday 2026-03-04, 10:00 Asia/Jerusalem (08:00Z). The
 * organization runs on Israel time too, so business hours line up and a
 * timezone mismatch cannot be mistaken for a language effect.
 */
import type { BenchmarkScenario } from './schema.js';

/** Wednesday 2026-03-04, 10:00 Asia/Jerusalem. */
export const HEBREW_NOW_UTC = '2026-03-04T08:00:00.000Z';

const HE_WORLD = {
  nowUtc: HEBREW_NOW_UTC,
  contactFullName: 'יונתן לוי',
  contactTimezone: 'Asia/Jerusalem',
  contactIsDecisionMaker: true,
  organizationTimezone: 'Asia/Jerusalem',
  businessHoursStartLocal: '09:00',
  businessHoursEndLocal: '17:00',
  minLeadTimeMinutes: 30,
  maxSchedulingHorizonDays: 180,
} as const;

const SPOKEN = { mustNotBeEmpty: true, maxChars: 600 } as const;

export const HEBREW_SCENARIOS: BenchmarkScenario[] = [
  // -------------------------------------------------------------------------
  {
    id: 'hebrew-intro-and-booking',
    title: 'Hebrew: introduction through to an attempted booking',
    language: 'he',
    objective:
      'Hold a natural opening in Hebrew, explain what the company does, and try to book the time the ' +
      'contact offers - in their own words.',
    coverage: ['language-hebrew', 'normal-introduction', 'interested-lead', 'tomorrow-afternoon', 'what-does-the-company-do'],
    world: { ...HE_WORLD },
    turns: [
      {
        utterance: 'הלו? מי זה?',
        note: 'Opening in Hebrew. Scored for whether the reply is idiomatic Hebrew rather than translated English, and for whether it stays short.',
        tools: { mustCallNone: true },
        text: { ...SPOKEN, mustNotAssertConcreteDate: true },
        replyLanguage: 'he',
      },
      {
        utterance: 'אוקיי, אז מה בעצם החברה שלכם עושה?',
        note: 'The "what do you do" turn, in Hebrew. Tests whether explanation quality survives the language change.',
        tools: { mustCallNone: true },
        text: { ...SPOKEN },
        replyLanguage: 'he',
      },
      {
        utterance: 'מעניין. תשמע, זה נשמע רלוונטי אלינו.',
        note: 'Buying signal in Hebrew. Booking with no time agreed would be premature here.',
        tools: { mustNotCall: ['schedule_meeting'], allowed: ['update_qualification', 'get_contact_context', 'check_availability'] },
        text: { ...SPOKEN },
        replyLanguage: 'he',
      },
      {
        utterance: 'בוא נגיד מחר אחרי הצהריים, בשתיים.',
        note: "Hebrew for 'tomorrow afternoon, at two'. The model must pass the HEBREW WORDS through. The English-only resolver will refuse them - that refusal is the product's, and what is scored here is the passthrough and the recovery.",
        schedulingIntent: true,
        expectsToolFailure: true,
        tools: { mustCallOneOf: ['schedule_meeting', 'check_availability'], allowed: ['schedule_meeting', 'check_availability', 'get_contact_context'] },
        passthrough: { tool: 'schedule_meeting', field: 'when', mustContainAnyOf: ['מחר', 'שתיים', 'אחרי הצהריים'] },
        replyLanguage: 'he',
      },
      {
        utterance: 'מה קרה? זה לא עבד?',
        note: 'Recovery after a real refusal, in Hebrew. Must not read an error code aloud and must not claim the meeting was booked.',
        tools: { allowed: ['check_availability', 'get_contact_context', 'schedule_meeting', 'transfer_to_human'] },
        text: { ...SPOKEN, mustNotMentionAnyOf: ['UNPARSEABLE', 'error_code', 'retryable', 'SCHEMA_VIOLATION'] },
        replyLanguage: 'he',
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: 'hebrew-busy-callback',
    title: 'Hebrew: busy right now, call back another time',
    language: 'he',
    objective: 'Recognise a bad moment in Hebrew, shorten right down, and secure a callback.',
    coverage: ['language-hebrew', 'busy-right-now', 'vague-next-week', 'ambiguous-date-time', 'call-again-in-several-days'],
    world: { ...HE_WORLD },
    turns: [
      {
        utterance: 'אני באמצע משהו עכשיו, ממש לא נוח לי לדבר.',
        note: 'A bad moment, stated plainly. The right reply is very short. Length is the measurement.',
        tools: { mustNotCall: ['schedule_meeting', 'check_availability'] },
        text: { ...SPOKEN, maxChars: 320 },
        replyLanguage: 'he',
      },
      {
        utterance: 'תתקשר אליי שבוע הבא, אולי בהתחלה של השבוע.',
        note: "'Next week, maybe the start of the week' - vague, in Hebrew. Passing it through verbatim is right; picking a day is fabrication.",
        schedulingIntent: true,
        expectsToolFailure: true,
        tools: { mustCallOneOf: ['schedule_followup'], allowed: ['schedule_followup', 'get_contact_context'] },
        passthrough: { tool: 'schedule_followup', field: 'when', mustContainAnyOf: ['שבוע הבא', 'בהתחלה של השבוע', 'תחילת השבוע'] },
        text: { mustNotAssertConcreteDate: true },
        replyLanguage: 'he',
      },
      {
        utterance: 'מעולה. ביי.',
        note: 'A two-word close. Anything long here is tone-deaf.',
        tools: { allowed: ['record_call_outcome', 'schedule_followup', 'update_qualification'] },
        text: { ...SPOKEN, maxChars: 260 },
        replyLanguage: 'he',
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: 'hebrew-price-objection',
    title: 'Hebrew: a price objection and an uninterested close',
    language: 'he',
    objective: 'Take a money objection seriously in Hebrew without inventing a price, and accept a no.',
    coverage: ['language-hebrew', 'price-objection', 'uninterested-lead', 'interrupts-sales-direction', 'needs-to-consult-someone'],
    world: { ...HE_WORLD },
    turns: [
      {
        utterance: 'רגע, לפני הכל - כמה זה עולה?',
        note: 'Interrupts the pitch with the price question, in Hebrew. Inventing a number is the failure.',
        tools: { mustCallNone: true },
        text: { ...SPOKEN, mustNotAssertConcreteDate: true },
        replyLanguage: 'he',
      },
      {
        utterance: 'זה יקר לנו. אנחנו חברה קטנה, שמונה אנשים.',
        note: 'A real constraint attached to the objection. Scored on whether the reply engages with "eight people" or recites a script.',
        tools: { mustNotCall: ['schedule_meeting'], allowed: ['update_qualification', 'transfer_to_human', 'get_contact_context'] },
        text: { ...SPOKEN },
        replyLanguage: 'he',
      },
      {
        utterance: 'אני צריך לבדוק את זה עם השותף שלי. אני לא יכול להחליט לבד.',
        note: 'Needs to consult someone else - the qualification fact worth recording.',
        tools: { allowed: ['update_qualification', 'schedule_followup', 'get_contact_context', 'transfer_to_human'], mustNotCall: ['schedule_meeting'] },
        text: { ...SPOKEN },
        replyLanguage: 'he',
      },
      {
        utterance: 'תראה, אני חושב שזה פשוט לא בשבילנו כרגע. תודה בכל זאת.',
        note: 'A polite no in Hebrew. Pushing again after this is the pushiness failure.',
        tools: { mustNotCall: ['schedule_meeting', 'check_availability'], allowed: ['record_call_outcome', 'update_qualification'] },
        text: { ...SPOKEN, maxChars: 400 },
        replyLanguage: 'he',
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: 'mixed-hebrew-english',
    title: 'Mixed Hebrew and English, the way Israeli business calls actually sound',
    language: 'mixed',
    objective:
      'Follow a contact who code-switches mid-sentence, and book the English-stated time they offer.',
    coverage: ['language-mixed', 'unexpected-topic-change', 'reference-to-earlier-turn', 'tomorrow-afternoon', 'incomplete-information'],
    world: {
      ...HE_WORLD,
      contactFullName: 'מאיה בן-דוד',
    },
    turns: [
      {
        utterance: 'היי, כן. תשמע, אני ב-back-to-back כל הבוקר, אז תהיה קצר.',
        note: 'Natural code-switching in the first sentence. A model that answers entirely in English here has failed the contact; one that answers entirely in formal Hebrew sounds stiff.',
        tools: { mustCallNone: true },
        text: { ...SPOKEN, maxChars: 380 },
        replyLanguage: 'mixed',
      },
      {
        utterance: 'אנחנו חברת SaaS, בערך 30 עובדים, ה-sales team שלנו זה ארבעה אנשים.',
        note: 'Plants facts across both languages: SaaS, 30 employees, four in sales. The last turn comes back for them.',
        tools: { allowed: ['update_qualification', 'get_contact_context'], mustNotCall: ['schedule_meeting'] },
        text: { ...SPOKEN },
        replyLanguage: 'mixed',
      },
      {
        utterance: 'רגע, סליחה - יש לי call אחר נכנס. שנייה.',
        note: 'An interruption mid-flow. The human move is to wait in a few words, not to keep pitching.',
        tools: { mustCallNone: true },
        text: { ...SPOKEN, maxChars: 240 },
        replyLanguage: 'mixed',
      },
      {
        utterance: 'סבבה, חזרתי. אז based on what I told you, זה רלוונטי אלינו בכלל?',
        note: 'Memory test across a code-switched interruption. A good answer names SaaS, 30, or the sales team.',
        tools: { mustNotCall: ['schedule_meeting'] },
        text: { ...SPOKEN, mustMentionAnyOf: ['saas', '30', 'sales', 'מכירות', 'ארבע'] },
        replyLanguage: 'mixed',
      },
      {
        utterance: 'אוקיי, בוא נעשה את זה. tomorrow at 11am, works for me.',
        note: "The time is given in ENGLISH inside a Hebrew sentence - exactly how this is said in practice, and the one Hebrew-context path the English-only resolver can actually handle. Passthrough must preserve the English time words.",
        schedulingIntent: true,
        tools: { mustCallOneOf: ['schedule_meeting', 'check_availability'], allowed: ['schedule_meeting', 'check_availability', 'get_contact_context'] },
        passthrough: { tool: 'schedule_meeting', field: 'when', mustContainAnyOf: ['tomorrow', '11'] },
        replyLanguage: 'mixed',
      },
    ],
  },
];
