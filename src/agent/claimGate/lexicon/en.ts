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
 * the perfect, the first-person SUBJECT, or the possessive `you are` - and the
 * bare participle is absent. What that buys is measurable: across the whole
 * existing test corpus, the only pre-tool sentence this lexicon fires on is one
 * that really does promise a callback before anything is booked, and that one is
 * a defect (`docs/MISSION_2D_CLAIM_GATE.md` names it).
 *
 * THAT ARGUMENT IS UNCHANGED, AND IT MADE THE FRAMES BRITTLE UNTIL § 16
 * ---------------------------------------------------------------------------
 * Because every form here is a multi-token frame, and because the matcher only
 * compared ADJACENT tokens, one word inside a frame used to defeat it completely:
 * `Your meeting is booked for tomorrow at 3pm.` was caught and `Your meeting is NOW
 * booked for tomorrow at 3pm.` was released to a real caller and persisted as a
 * spoken agent turn. Hebrew was immune, because `נקבעה` is one word and has no
 * inside - which is the diagnostic, not a coincidence. `../text.ts`
 * (`FrameGapAllowance`) now lets a frame tolerate a bounded run of intervening
 * tokens, and `frameBlockers` below is what keeps that from reaching the honest
 * intention readings this section is about. The bare-participle exclusion is
 * untouched by any of it: `Booked.` is still missed, still deliberately.
 *
 * THE FIRST-PERSON PRETERITE IS A FRAME TOO, AND IT USED TO BE MISSING
 * ---------------------------------------------------------------------------
 * The first revision of this file carried only the perfect and the passive -
 * `i've booked`, `is booked`, `has been booked` - and no simple past at all. So
 * `I've booked the callback for 3pm tomorrow.` was caught and
 * `I booked the callback for 3pm tomorrow.` was released, which is the § 6.5.4
 * defect one inflection sideways. Independent QA drove eight such sentences
 * through the real `AgentTurnService` and seven of them reached the caller AND
 * were persisted as spoken agent turns.
 *
 * That was an omission rather than a trade, and the argument at the top of this
 * file is precisely why: the reason the bare participle is excluded is that
 * `booked` has an INTENTION reading (`let me get that booked`). `I booked`,
 * `I cancelled`, `I sent`, `I scheduled` have no such reading - a first-person
 * subject with a past-tense verb is a completion in every context - so adding
 * them cannot suppress a single honest sentence. `lexicon/he.ts` has carried the
 * Hebrew first-person past (`קבעתי`, `ביטלתי`, `שלחתי`) since it was written, and
 * says so in its own header; English omitting the same tense was an asymmetry,
 * not a decision.
 *
 * WHY THE FRAMES ARE GENERATED AND NOT TYPED OUT
 * ---------------------------------------------------------------------------
 * A model does not write `I booked`. It writes `I just booked`, `we've gone
 * ahead and booked`, `I already put you down`. The SUBJECT varies independently of
 * the VERB, so the two are declared once each and crossed (`firstPersonFrames`
 * below) instead of being hand-listed as hundreds of strings that would drift apart
 * at the first edit. The product contains a few ungrammatical strings -
 * `i gone ahead and booked` - which cost one array slot each and match nothing;
 * filtering them would mean encoding English morphology in a data table, which is
 * worse than carrying them.
 *
 * THE ADVERBIAL IS NO LONGER ONE OF THE CROSSED AXES, AND THAT IS THE § 16 FIX.
 * It used to be fused onto the subjects (`i just`, `i already`, `i've already`),
 * which made the coverage exactly as wide as the eight spellings somebody typed and
 * left every other adverb - and every PASSIVE frame, which no prefix list touches -
 * open. It is now handled generally by the interruption rule above, so
 * `FIRST_PERSON_PREFIXES` carries subjects only. Its own comment names what stayed
 * and why.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * ---------------------------------------------------------------------------
 *  - `booked`, `confirmed`, `scheduled`, `cancelled`, `sent` as bare words. See
 *    above. A model that writes `Booked.` as a whole turn is therefore missed,
 *    and that is recorded as a known limit rather than fixed by making the rule
 *    fire on the participle.
 *  - `get that booked`, `get you in the diary` and the other intention forms.
 *    They are not claims and must pass through untouched.
 *  - `all sorted` and `on the calendar` as bare phrases, for exactly the
 *    participle reason: `let me get that all sorted` and `let me get you on the
 *    calendar` are honest. Only the framed spellings (`that's sorted`, `you're
 *    on the calendar`) are here.
 *  - Anything that only reads as a claim with a question mark removed. An
 *    interrogative sentence is excluded by the engine, not by this data.
 */
import type { ClaimLexicon } from './types.js';

/**
 * The SUBJECTS a first-person completion arrives behind.
 *
 * THIS LIST USED TO CARRY THE ADVERBIAL TOO, AND THAT WAS THE MERGE BLOCKER
 * ---------------------------------------------------------------------------
 * It held eighteen entries, eight of which were a subject with an adverb already
 * fused on: `i just`, `i've just`, `i have just`, `we just`, `i already`,
 * `i've already`, `i have already`, `we already`. That is an enumeration of
 * SPELLINGS, and its coverage was exactly the eight spellings somebody typed:
 * `I already booked` was caught and `I now booked`, `I successfully booked`,
 * `I have now booked` and every other adverb were released - to real callers, and
 * persisted as spoken agent turns with nothing in the ledger. Measured on the pure
 * detector, 8 adverbs crossed with 7 frames missed 53 of 56 sentences.
 *
 * The adverbial is now handled GENERALLY, one layer down: a completion frame
 * tolerates a bounded run of skipped tokens (`../text.ts`, `FrameGapAllowance`),
 * so `i booked` matches `I now booked`, `I finally booked` and `I, at last,
 * booked` without any of them being written here. Every deleted entry is still
 * detected - `tests/claimGate/claimGateCorpus.ts` asserts `I just booked it.` and
 * the rest by name - and an adverb nobody anticipated is detected too, which is
 * the whole difference.
 *
 * WHAT IS STILL HAND-LISTED, AND WHY IT HAS TO BE
 * ---------------------------------------------------------------------------
 * `went ahead and` is not an adverb, it is a clause. The `and` in it is an
 * English `clauseBreaker`, and the engine refuses to skip a clause joiner inside a
 * frame - deliberately, because `I have checked AND confirmed your details`
 * asserts nothing and must not become `i have confirmed`. So the four
 * `gone ahead and` spellings stay written out: they are the case where the general
 * rule correctly declines, not the case it was hiding.
 */
const FIRST_PERSON_PREFIXES: readonly string[] = [
  'i',
  'we',
  "i've",
  'i have',
  "we've",
  'we have',
  'i went ahead and',
  'we went ahead and',
  "i've gone ahead and",
  'i have gone ahead and',
];

/** Every prefix crossed with every verb, in one flat list of forms. */
function firstPersonFrames(verbs: readonly string[]): readonly string[] {
  return FIRST_PERSON_PREFIXES.flatMap((prefix) => verbs.map((verb) => `${prefix} ${verb}`));
}

/**
 * The past-tense verbs, grouped by the family the VERB commits to.
 *
 * Grouped by verb and not by object, because the object comes after the verb and
 * `matchCompletionMarkers` cannot see it from the position the frame starts at.
 * That is the cause of the three entries in `KNOWN_FALSE_POSITIVES`
 * (`tests/claimGate/claimGateCorpus.ts`) and it is unchanged here: `I booked the
 * callback` is read as MEETING for the same reason `I've booked the callback`
 * already was. `docs/MISSION_2D_CLAIM_GATE.md` § 8 names it.
 *
 * `saved` is the one verb that carries its object, because `I saved you some
 * time by checking first` is not a booking and a bare `i saved` would block it.
 */
const BOOKING_VERBS: readonly string[] = [
  'booked',
  'scheduled',
  'confirmed',
  'reserved',
  'set up',
  'locked in',
  'put you down',
  'put you in',
  'got you in',
  'signed you up',
  'pencilled you in',
  'penciled you in',
  'saved the appointment',
  'saved your appointment',
  'saved the slot',
];

const RESCHEDULE_VERBS: readonly string[] = ['moved', 'rescheduled', 'shifted', 'pushed back', 'brought forward'];

const CANCELLATION_VERBS: readonly string[] = ['cancelled', 'canceled', 'called off'];

/** `arranged` is CALLBACK here because `is arranged` already is, below. */
const CALLBACK_VERBS: readonly string[] = ['arranged'];

const MESSAGE_VERBS: readonly string[] = ['sent', 'emailed', 'texted', 'messaged'];

const RECORD_VERBS: readonly string[] = ['recorded', 'noted', 'logged'];

/**
 * `sorted` carries its object for the same reason `saved` does: a bare
 * `i sorted` fires on `I sorted through the options with you`, which asserts
 * nothing and was caught by the precision half of the probe that drove this fix.
 */
const UNNAMED_COMPLETION_VERBS: readonly string[] = [
  'sorted that',
  'sorted it',
  'sorted everything',
  'taken care of that',
  'taken care of it',
];

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
    // `that's`, `it's` and `you're` are listed as whole forms on purpose:
    // `text.ts` keeps an apostrophe INSIDE a token, so `that's` never tokenises
    // as `that` + `is` and `is sorted` cannot reach it. That is what let
    // `That's sorted for 3pm tomorrow.` through.
    {
      forms: [
        'all set',
        'is done',
        'that is done',
        "that's done",
        "it's done",
        'is all done',
        "that's all done",
        'is sorted',
        'that is sorted',
        "that's sorted",
        "that's all sorted",
        "it's sorted",
        "you're sorted",
        'you are sorted',
        'is taken care of',
        'has been taken care of',
        "you're on the calendar",
        'you are on the calendar',
        "you're booked in",
        'you are booked in',
        "you're down for",
        'you are down for',
      ],
      family: 'ANY',
      mode: 'COMPLETED',
    },

    // ---- the first-person past, which is a claim in every reading ---------
    // Generated, and the header says why. These entries come LAST so that where
    // a generated form repeats one written out above - `i have booked`,
    // `i've sent` - the hand-written entry still wins the tie and `matchedForm`
    // is unchanged for every text that already fired. The families agree either
    // way; the tie only decides which string is quoted in the audit detail.
    { forms: firstPersonFrames(BOOKING_VERBS), family: 'MEETING', mode: 'COMPLETED' },
    { forms: firstPersonFrames(RESCHEDULE_VERBS), family: 'RESCHEDULE', mode: 'COMPLETED' },
    { forms: firstPersonFrames(CANCELLATION_VERBS), family: 'CANCELLATION', mode: 'COMPLETED' },
    { forms: firstPersonFrames(CALLBACK_VERBS), family: 'CALLBACK', mode: 'COMPLETED' },
    { forms: firstPersonFrames(MESSAGE_VERBS), family: 'MESSAGE', mode: 'COMPLETED' },
    { forms: firstPersonFrames(RECORD_VERBS), family: 'RECORD', mode: 'COMPLETED' },
    { forms: firstPersonFrames(UNNAMED_COMPLETION_VERBS), family: 'ANY', mode: 'COMPLETED' },
  ],

  // The bare participles, which assert nothing alone and assert a completion beside a
  // domain object. `lexicon/types.ts` carries the argument; what follows is why these
  // words and not others.
  //
  // THESE ARE EXACTLY THE WORDS THE `completionMarkers` ABOVE EXCLUDE. The whole
  // reason every form up there is a frame is that `booked` on its own appears in
  // `let me get that booked`. That exclusion is not being reversed - `Booked.` as a
  // whole turn is still missed, and `let me get that booked` is still clean, because
  // neither names a thing this system creates. What changed is that the OBJECT is now
  // read, so `I have finally and officially booked your MEETING` no longer depends on
  // the words between `have` and `booked` being arrangeable into a frame.
  //
  // `saved`, `sorted` and `set` are DELIBERATELY ABSENT even though the frames above
  // carry them with their objects. `I saved you some time by checking the diary`,
  // `I sorted through the options with you` and `set a time` are honest, and `diary`
  // IS a domain object - so a bare `saved` or `sorted` here would flag the first two.
  // The framed spellings (`i saved the appointment`, `sorted that`) already catch what
  // matters, and those two sentences are asserted clean in MUST_NOT_FLAG.
  //
  // `checked` is absent for the same reason and a sharper one: checking availability
  // is not an effect at all, and `I have checked the diary` is the single most
  // ordinary true sentence this agent says.
  completionParticiples: [
    {
      forms: ['booked', 'scheduled', 'confirmed', 'reserved', 'rebooked'],
      family: 'MEETING',
      mode: 'COMPLETED',
    },
    { forms: ['moved', 'rescheduled', 'shifted'], family: 'RESCHEDULE', mode: 'COMPLETED' },
    { forms: ['cancelled', 'canceled'], family: 'CANCELLATION', mode: 'COMPLETED' },
    { forms: ['arranged'], family: 'CALLBACK', mode: 'COMPLETED' },
    { forms: ['sent', 'emailed', 'texted', 'messaged'], family: 'MESSAGE', mode: 'COMPLETED' },
    { forms: ['recorded', 'logged'], family: 'RECORD', mode: 'COMPLETED' },
  ],

  // What a participle has to stand near. Narrow on purpose - see the type. Every entry
  // is a thing a tool in this system writes a row for, or a message family nothing in
  // it can send.
  //
  // `details`, `options`, `time`, `price` and `number` are ABSENT and the first is the
  // one that matters: `I have checked and confirmed your details.` is honest, and it is
  // asserted clean in MUST_NOT_FLAG precisely so this list cannot quietly grow to
  // include it.
  domainObjects: [
    { forms: ['meeting', 'meetings', 'appointment', 'appointments'], family: 'MEETING' },
    { forms: ['slot', 'booking', 'reservation'], family: 'ANY' },
    { forms: ['diary', 'calendar'], family: 'ANY' },
    { forms: ['callback', 'callbacks', 'call back', 'follow-up', 'followup'], family: 'CALLBACK' },
    { forms: ['email', 'e-mail', 'message', 'text'], family: 'MESSAGE' },
    { forms: ['reminder', 'note'], family: 'RECORD' },
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

  // The words that join one clause to the next when the model did not bother with
  // a comma. `I cannot take payments but I have booked your meeting for Thursday
  // at 2pm.` is the leak these close; with a comma, `text.ts` already finds the
  // boundary.
  //
  // Coordinators (`but`, `so`, `and`) and subordinators (`because`, `while`,
  // `since`) are both here, because both bound a negation: in `I could not reach
  // them because your meeting is booked for Thursday`, `not` governs the reaching
  // and says nothing whatever about the booking.
  //
  // `yet`, `if`, `once` and `unless` are deliberately ABSENT even though they join
  // clauses in some readings. Each is already a `negator` or a
  // `conditionalMarker` above, and a token that both bounds a suppression and IS
  // one would be arguing with itself.
  clauseBreakers: [
    'but',
    'so',
    'and',
    'however',
    'although',
    'though',
    'whereas',
    'because',
    'therefore',
    'while',
    'since',
  ],

  // The words that may NOT stand inside a completion frame, because they turn one
  // back into an intention. `types.ts` argues why this is a list of BLOCKERS and
  // not a list of skippable adverbs; what follows is what each entry actually buys.
  //
  // MODALS AND THE INFINITIVE are the load-bearing half. Without them, a frame that
  // tolerates two skipped tokens reads `I can have that booked for you.` and `I
  // will have that booked shortly.` as `i have booked` - two honest intentions, and
  // exactly the wording `NEVER_CLAIM_BOOKED_WITHOUT_CONFIRMATION` asks the model
  // for. `to` alone closes `I have to get that booked`, `I need to get that booked`
  // and `I am happy to get that booked`.
  //
  // THE PROGRESSIVE is the other half and is easy to miss: `Your callback is being
  // arranged.` and `Your meeting is getting booked now.` say the work is in FLIGHT,
  // not done, and `is arranged` / `is booked` would otherwise read them as
  // completions. `get` and `getting` are here for the same reason, and they are the
  // verb of every honest intention form this lexicon deliberately excludes
  // (`let me get that booked`, `get you in the diary`).
  //
  // The INTENTION VERBS (`want`, `need`, `hope`, `try`, `plan`, `intend`, `aim`)
  // are the weakest entries and are included on the block-list logic: each costs
  // one array slot and can only ever prevent a false positive.
  //
  // DELIBERATELY ABSENT: `just`, `already`, `now`, `successfully`, `officially`,
  // `finally`, `all`, `still` and every other adverb. Those are precisely the
  // tokens a frame MUST tolerate, and listing an adverb here would re-open the
  // defect this field exists to close. `been` is absent too - it is a form token in
  // `has been booked`, and blocking it would be blocking a frame's own word.
  //
  // `may` IS ABSENT ON PURPOSE, and it is the one entry a reader should check. An
  // over-broad blocker costs the opposite of an incomplete one: it costs a MISS. And
  // `may` is also a MONTH in this same lexicon, so blocking it would lose
  // `I have May 5th booked for you.` - a real claim - to buy `it may be booked`,
  // which `be` already blocks. Every other entry here has no such collision.
  frameBlockers: [
    'will',
    'would',
    'can',
    'could',
    'shall',
    'should',
    'might',
    'must',
    'to',
    'be',
    'going',
    'gonna',
    'about',
    'being',
    'get',
    'gets',
    'getting',
    'let',
    'want',
    'wants',
    'need',
    'needs',
    'hope',
    'hoping',
    'try',
    'trying',
    'plan',
    'planning',
    'intend',
    'aim',
  ],

  // Noun-phrase material, which may not sit INSIDE a frame and is ordinary in front of
  // one. `types.ts` argues the split; the sentence that forced this list is
  // `I will have your call back booked shortly.`, where `i will call` closed across
  // `have your` and read an honest intention as a callback promise.
  //
  // `the` and `that` are the two a reader should check, because both look like they
  // might be needed INSIDE something. They are not: no English completion frame has a
  // determiner interior to it, and `is in the diary` / `got that booked` carry theirs
  // as FORM tokens, which this list never touches. On the other side, `The meeting is
  // now booked.` and `That is now booked.` both still fire - a determiner in FRONT of
  // a frame is tested against `moodTokens`, which this list is deliberately not part of.
  frameDeterminers: [
    'a',
    'an',
    'the',
    'this',
    'that',
    'these',
    'those',
    'my',
    'our',
    'your',
    'his',
    'her',
    'their',
    'its',
  ],

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
