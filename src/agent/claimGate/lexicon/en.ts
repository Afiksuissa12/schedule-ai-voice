/**
 * The English claim lexicon.
 *
 * WHY EVERY ENTRY IS A FRAME AND NOT A BARE PARTICIPLE
 * ---------------------------------------------------------------------------
 * `booked` on its own is not a claim. It appears in `let me get that booked`,
 * which is the exact wording the guardrail clause
 * `NEVER_CLAIM_BOOKED_WITHOUT_CONFIRMATION` holds up as the HONEST thing to say
 * before a tool has answered (`src/agent/prompt/clauses.ts`). A detector that
 * fired on it would regenerate truthful turns, and a gate that punishes honest
 * wording gets switched off.
 *
 * So every English form below carries its own completion frame - the auxiliary,
 * the perfect, or the possessive `you are` - and the bare participle is absent.
 * What that buys is measurable: across the whole existing test corpus, the only
 * pre-tool sentence this lexicon fires on is one that really does promise a
 * callback before anything is booked, and that one is a defect
 * (`docs/MISSION_2D_CLAIM_GATE.md` names it).
 *
 * WHAT IS DELIBERATELY NOT HERE
 * ---------------------------------------------------------------------------
 *  - `booked`, `confirmed`, `scheduled`, `cancelled`, `sent` as bare words. See
 *    above. A model that writes `Booked.` as a whole turn is therefore missed,
 *    and that is recorded as a known limit rather than fixed by making the rule
 *    fire on the participle.
 *  - `get that booked`, `get you in the diary` and the other intention forms.
 *    They are not claims and must pass through untouched.
 *  - Anything that only reads as a claim with a question mark removed. An
 *    interrogative sentence is excluded by the engine, not by this data.
 */
import type { ClaimLexicon } from './types.js';

export const EN_CLAIM_LEXICON: ClaimLexicon = {
  locale: 'en',
  displayName: 'English',

  completionMarkers: [
    // ---- a meeting exists -------------------------------------------------
    {
      forms: [
        'is booked',
        'are booked',
        'was booked',
        'has been booked',
        'have been booked',
        'have booked',
        "i've booked",
        'i have booked',
        "it's booked",
        'got you booked',
        'got that booked',
        'is in the diary',
        'are in the diary',
        "you're in the diary",
        'you are in the diary',
        'is on the books',
        'is confirmed',
        'are confirmed',
        "it's confirmed",
        'has been confirmed',
        'have been confirmed',
        "i've confirmed",
        'i have confirmed',
        'is scheduled',
        'are scheduled',
        'has been scheduled',
        'have been scheduled',
        "i've scheduled",
        'i have scheduled',
        'is set up',
        'has been set up',
        'is locked in',
      ],
      family: 'MEETING',
      mode: 'COMPLETED',
    },

    // ---- a meeting moved --------------------------------------------------
    {
      forms: [
        'is moved',
        'moved to',
        'has been moved',
        'have moved',
        "i've moved",
        'is rescheduled',
        'has been rescheduled',
        'have rescheduled',
        "i've rescheduled",
      ],
      family: 'RESCHEDULE',
      mode: 'COMPLETED',
    },

    // ---- a meeting is off -------------------------------------------------
    {
      forms: [
        'is cancelled',
        'is canceled',
        'has been cancelled',
        'has been canceled',
        'have cancelled',
        'have canceled',
        "i've cancelled",
        "i've canceled",
        'i have cancelled',
        'i have canceled',
        'is off the books',
      ],
      family: 'CANCELLATION',
      mode: 'COMPLETED',
    },

    // ---- a callback exists, or is promised --------------------------------
    // `will call` is named in the mission brief as a material assertion, and it
    // is: a contact told a call is coming arranges their afternoon around it.
    {
      forms: [
        'callback is booked',
        'callback is arranged',
        'callback is set',
        'callback has been booked',
        'callback has been arranged',
        'is arranged',
        'has been arranged',
      ],
      family: 'CALLBACK',
      mode: 'COMPLETED',
    },
    {
      forms: [
        "i'll call you",
        'i will call you',
        "i'll call",
        'i will call',
        "we'll call you",
        'we will call you',
        "i'll ring you",
        'i will ring you',
        "i'll ring",
        'i will ring',
        "i'll give you a ring",
        'i will give you a ring',
        "i'll phone you",
        'i will phone you',
        'expect a call',
        'expect our call',
        'can expect a call',
      ],
      family: 'CALLBACK',
      mode: 'COMMITTED',
    },

    // ---- something was sent, or will be ----------------------------------
    // There is no tool in this system that sends anything. Every form here is
    // therefore unsupportable by construction, which is exactly how
    // `aya-expanse:8b`'s promised confirmation email is caught (§ 6.2).
    {
      forms: [
        'has been sent',
        'have been sent',
        'is sent',
        "i've sent",
        'i have sent',
        "i've emailed",
        'i have emailed',
      ],
      family: 'MESSAGE',
      mode: 'COMPLETED',
    },
    {
      forms: [
        "i'll send you an email",
        'i will send you an email',
        "i'll send you a confirmation",
        'i will send you a confirmation',
        "i'll send a confirmation",
        'i will send a confirmation',
        "i'll email you",
        'i will email you',
        "i'll text you",
        'i will text you',
        "i'll message you",
        'i will message you',
      ],
      family: 'MESSAGE',
      mode: 'COMMITTED',
    },

    // ---- something was written down --------------------------------------
    {
      forms: ['is recorded', 'has been recorded', "i've recorded", 'i have recorded', 'is on your record'],
      family: 'RECORD',
      mode: 'COMPLETED',
    },

    // ---- a person is taking it over --------------------------------------
    {
      forms: ['has been passed to', 'has been passed on', 'will be in touch', 'will get back to you', 'will pick this up'],
      family: 'HANDOVER',
      mode: 'COMMITTED',
    },

    // ---- completion with nothing named -----------------------------------
    {
      forms: ['all set', 'is done', 'that is done', 'is all done', 'is sorted', 'is taken care of', 'has been taken care of'],
      family: 'ANY',
      mode: 'COMPLETED',
    },
  ],

  identifierMarkers: [
    'confirmation number',
    'confirmation code',
    'confirmation reference',
    'reference number',
    'booking reference',
    'booking number',
    'booking id',
    'your reference',
  ],

  // Bare `no` is deliberately ABSENT. `No problem - you're all set.` is a
  // completion claim, and a negator list containing `no` would suppress it
  // sentence-wide over a politeness word. `not`, `nothing` and `yet` carry the
  // real negations, including the one that matters most - `nothing is booked
  // yet`, which must pass through as the truthful sentence it is.
  negators: [
    'not',
    "isn't",
    "aren't",
    "wasn't",
    "don't",
    "didn't",
    "doesn't",
    "haven't",
    "hasn't",
    "won't",
    "can't",
    "couldn't",
    'cannot',
    'nothing',
    'none',
    'nobody',
    'never',
    'yet',
    'unable',
    'without',
  ],

  conditionalMarkers: ['if', 'once', 'as soon as', 'shall i', 'should i', 'would you like', 'do you want', 'unless'],

  months: [
    { forms: ['january', 'jan'], month: 1 },
    { forms: ['february', 'feb'], month: 2 },
    { forms: ['march', 'mar'], month: 3 },
    { forms: ['april', 'apr'], month: 4 },
    { forms: ['may'], month: 5 },
    { forms: ['june', 'jun'], month: 6 },
    { forms: ['july', 'jul'], month: 7 },
    { forms: ['august', 'aug'], month: 8 },
    { forms: ['september', 'sept', 'sep'], month: 9 },
    { forms: ['october', 'oct'], month: 10 },
    { forms: ['november', 'nov'], month: 11 },
    { forms: ['december', 'dec'], month: 12 },
  ],

  ordinalSuffixes: ['st', 'nd', 'rd', 'th'],
};
