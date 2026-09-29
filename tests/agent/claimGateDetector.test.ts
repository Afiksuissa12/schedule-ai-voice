/**
 * The detector: what counts as a material claim, and what deliberately does not.
 *
 * WHY THIS FILE IS A TABLE
 * ---------------------------------------------------------------------------
 * The detector is pure, so it can be pinned exhaustively without a database, a
 * clock or a model. Both directions matter equally and are tested equally:
 *
 *  - the CLAIMS, including the two verbatim sentences from the founder review
 *    that this whole gate exists because of;
 *  - the NON-CLAIMS, because a detector that fires on `let me get that booked`
 *    regenerates honest turns, and a gate that punishes honest wording is a gate
 *    somebody switches off.
 *
 * The verbatim review sentences are quoted here ON PURPOSE. They are the
 * specification: if either of them ever stops being detected, this file fails.
 */
import { describe, expect, it } from 'vitest';

import {
  detectMaterialClaims,
  identifierShapeOf,
  markerAdjacentShapeOf,
  IDENTIFIER_SHAPE_FORM,
} from '../../src/agent/claimGate/detector.js';
import {
  REGISTERED_CLAIM_LEXICONS,
  type ClaimLexicon,
  type FirstPersonNumberMarker,
} from '../../src/agent/claimGate/lexicon/index.js';
import { SUPPRESSION_CLAIM_BASES } from '../claimGate/claimGateCorpus.js';

const familiesIn = (text: string, lexicons?: readonly ClaimLexicon[]): string[] =>
  detectMaterialClaims(text, lexicons === undefined ? {} : { lexicons })
    .filter((claim) => claim.kind === 'EFFECT_ASSERTED')
    .map((claim) => claim.family);

describe('the detector finds a material claim', () => {
  it('in the exact English sentence the recommended model produced with no tool call', () => {
    // docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md § 6.5.4, qwen2.5:7b-instruct.
    const claims = detectMaterialClaims(
      "Got it. I've booked the callback for 3pm on your local time. You can expect a call from us then.",
    );
    // Every claim is a CALLBACK claim: the frame `i've booked` now sees its object
    // (§ 8 limit 9, closed on hosted-demo), so it is judged against callbacks - and
    // on this transcript's EMPTY ledger it still fails NO_MATCHING_EFFECT.
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.map((claim) => claim.family).every((family) => family === 'CALLBACK')).toBe(true);
    expect(claims.some((claim) => claim.mode === 'COMMITTED')).toBe(true);
  });

  it('in the invented confirmation number from the same transcript', () => {
    const claims = detectMaterialClaims(
      'The confirmation number for this callback is CONF123456.',
    );
    const identifierClaims = claims.filter((claim) => claim.kind === 'IDENTIFIER_ASSERTED');
    expect(identifierClaims.length).toBeGreaterThanOrEqual(2);
    expect(identifierClaims.some((claim) => claim.matchedForm === 'confirmation number')).toBe(true);
    expect(identifierClaims.some((claim) => claim.matchedForm === IDENTIFIER_SHAPE_FORM)).toBe(true);
    expect(identifierClaims.flatMap((claim) => claim.identifiers)).toContain('conf123456');
  });

  it('in the exact Hebrew sentence aya-expanse produced with no tool call', () => {
    // § 6.2. Two claims: the meeting that was never scheduled, and the email
    // this agent has no tool to send.
    const text =
      'אין דאגה, הכל בסדר! הפגישה נקבעה בהצלחה למחר אחרי הצהריים בשעה 14:00. אשלח לך אישור בדוא"ל עם כל הפרטים הרלוונטיים.';
    const families = familiesIn(text);
    expect(families).toContain('MEETING');
    expect(families).toContain('MESSAGE');
  });

  it('and reads that Hebrew sentence as afternoon at 14:00, not as noon', () => {
    // `אחרי הצהריים` (afternoon) CONTAINS `הצהריים` (noon). Longest-match plus
    // day-part consumption is what stops the gate reading noon out of a phrase
    // that says afternoon - the same trap src/scheduling/lexicon/he.ts names.
    const claim = detectMaterialClaims('הפגישה נקבעה למחר אחרי הצהריים בשעה 14:00').find(
      (entry) => entry.family === 'MEETING',
    );
    expect(claim?.assertedTime?.dayPart).toBe('afternoon');
    expect(claim?.assertedTime?.hour).toBe(14);
    expect(claim?.assertedDay?.offsetDays).toBe(1);
  });

  it('in a mixed Hebrew-and-English sentence, with no mode switch anywhere', () => {
    const claims = detectMaterialClaims('הפגישה נקבעה for Thursday, and the confirmation number is CONF998877.');
    expect(claims.map((claim) => claim.family)).toContain('MEETING');
    expect(claims.flatMap((claim) => claim.identifiers)).toContain('conf998877');
    const meeting = claims.find((claim) => claim.family === 'MEETING' && claim.kind === 'EFFECT_ASSERTED');
    expect(meeting?.locale).toBe('he');
    expect(meeting?.assertedDay?.isoWeekday).toBe(4);
  });

  it('for every family the system can actually produce', () => {
    expect(familiesIn('The meeting is booked.')).toContain('MEETING');
    expect(familiesIn('It has been moved to 11 in the morning.')).toContain('RESCHEDULE');
    expect(familiesIn('That is cancelled.')).toContain('CANCELLATION');
    expect(familiesIn('I will call you tomorrow at 3.')).toContain('CALLBACK');
    expect(familiesIn('I will email you the details.')).toContain('MESSAGE');
    expect(familiesIn('Your answer is recorded.')).toContain('RECORD');
    expect(familiesIn('A colleague will get back to you.')).toContain('HANDOVER');
    expect(familiesIn("You're all set.")).toContain('ANY');
  });

  it('and reads the day and the time the sentence asserts', () => {
    const claim = detectMaterialClaims(
      "You're all set - I'll ring you tomorrow, Thursday the 5th of March, at 3 in the afternoon your time.",
    )[0];
    expect(claim?.assertedDay).toMatchObject({ isoWeekday: 4, offsetDays: 1, dayOfMonth: 5, month: 3 });
    expect(claim?.assertedTime).toMatchObject({ hour: 3, hourIsAmbiguous: true, dayPart: 'afternoon' });
  });

  it('and reads an am/pm hour as an unambiguous 24-hour time', () => {
    const claim = detectMaterialClaims("I've booked the callback for 3pm.")[0];
    expect(claim?.assertedTime).toMatchObject({ hour: 15, hourIsAmbiguous: false });
  });
});

describe('the detector deliberately finds nothing', () => {
  const honest = [
    'Let me check that time and get it booked.',
    'That works - booking it now.',
    'Of course - let me get that in the diary.',
    'Understood - I will take that out of the diary.',
    'No problem, let me move that.',
    'Sorry - I was not able to arrange that.',
    'Nothing is booked yet - can I take a time from you?',
    'Shall I get that booked for you?',
    'Once that is booked I will let you know.',
    'I have not booked anything.',
    'Thanks - is there anything else I can help you with?',
    'Let me take care of that for you.',
  ];

  for (const text of honest) {
    it(`in ${JSON.stringify(text)}`, () => {
      expect(detectMaterialClaims(text)).toEqual([]);
    });
  }

  it('in a negated Hebrew sentence', () => {
    expect(detectMaterialClaims('הפגישה לא נקבעה.')).toEqual([]);
  });

  it('but the negation does NOT reach across a sentence boundary', () => {
    // The reassurance in front of it must not silence the false claim behind it.
    expect(familiesIn('אין דאגה! הפגישה נקבעה.')).toContain('MEETING');
  });

  it('in a product name that merely contains digits', () => {
    expect(detectMaterialClaims('Fieldpoint360 covers that, and v2 is out in March.')).toEqual([]);
  });
});

describe('the detector reads the first-person simple past', () => {
  /**
   * The tense the lexicon did not have, as a table.
   *
   * The first revision of `lexicon/en.ts` carried only the perfect and the
   * passive, so `I've booked the callback for 3pm` was caught and `I booked the
   * callback for 3pm` was released - the § 6.5.4 defect one inflection sideways.
   * Independent QA drove these through the real `AgentTurnService` and seven of
   * eight reached the caller AND were persisted as spoken agent turns, with the
   * gate reporting NO_MATERIAL_CLAIM, which means the ledger was never read.
   *
   * Each row names the family the frame commits to, because a claim that fires
   * with the wrong family is judged against the wrong effects.
   */
  const PRETERITE: readonly (readonly [string, string])[] = [
    ['I booked the callback for 3pm tomorrow.', 'CALLBACK'],
    ['I scheduled the callback for 3pm tomorrow.', 'CALLBACK'],
    ['I confirmed your meeting for tomorrow at 3pm.', 'MEETING'],
    ['I booked you in for tomorrow at 3pm.', 'MEETING'],
    ['I have reserved tomorrow at 3pm for you.', 'MEETING'],
    ['I saved the appointment for Thursday.', 'MEETING'],
    ["I've put you down for tomorrow at 3pm.", 'MEETING'],
    ['We booked the callback for 3pm.', 'CALLBACK'],
    ['I just booked it.', 'MEETING'],
    ['I went ahead and booked it for 3pm tomorrow.', 'MEETING'],
    ['I cancelled your meeting.', 'CANCELLATION'],
    ['I canceled the meeting for you.', 'CANCELLATION'],
    ['I moved your meeting to Friday at 10am.', 'RESCHEDULE'],
    ['I rescheduled your meeting to Friday at 10am.', 'RESCHEDULE'],
    ["I've gone ahead and arranged the callback for 3pm.", 'CALLBACK'],
    ['I sent you a confirmation email with all the details.', 'MESSAGE'],
    ["That's sorted for 3pm tomorrow.", 'ANY'],
    ["Done - you're on the calendar for tomorrow afternoon.", 'ANY'],
    ['סידרתי לך פגישה למחר בשעה 15:00.', 'ANY'],
  ];

  for (const [text, family] of PRETERITE) {
    it(`as a ${family} claim in ${JSON.stringify(text)}`, () => {
      expect(familiesIn(text)).toContain(family);
    });
  }

  it('and still finds nothing in the past-tense sentences that assert nothing', () => {
    // The precision direction. Both of these fired while the frames were being
    // written, which is why `sorted` and `saved` carry their objects.
    expect(detectMaterialClaims('I sorted through the options with you.')).toEqual([]);
    expect(detectMaterialClaims('I saved you some time by checking the diary first.')).toEqual([]);
    expect(detectMaterialClaims("I'll get that all sorted for you.")).toEqual([]);
    expect(detectMaterialClaims('Let me get you on the calendar for Thursday.')).toEqual([]);
  });
});

describe('a number-shaped token beside an identifier marker', () => {
  it('is collected as an identifier, which a bare digit run is not', () => {
    const beside = detectMaterialClaims('Your confirmation number is 483921.');
    expect(beside.flatMap((claim) => claim.identifiers)).toContain('483921');

    // Without the marker phrase the same digits are a price, a duration or a
    // house number, and § 4.4's trade stands: they are NOT an identifier.
    expect(detectMaterialClaims('Your confirmation is 884213.')).toEqual([]);
  });

  it('but a date or a clock reading in the same sentence is not', () => {
    // `2026` is a year and `3pm` is a time, and a sentence that mentions a
    // reference does not turn either of them into one.
    const dated = detectMaterialClaims('Your confirmation number is for the meeting on 5 March 2026.');
    expect(dated.flatMap((claim) => claim.identifiers)).toEqual([]);
    const timed = detectMaterialClaims('Your booking reference relates to the 3pm slot tomorrow.');
    expect(timed.flatMap((claim) => claim.identifiers)).toEqual([]);
  });

  it('and the marker-only shape table says which rule fired', () => {
    expect(markerAdjacentShapeOf('483921')).toBe('DIGIT_RUN');
    expect(markerAdjacentShapeOf('48-3921')).toBe('GROUPED_DIGITS');
    expect(markerAdjacentShapeOf('AB12')).toBe('LETTER_LED_CODE');
    // Letter-first on purpose: a time is not a reference.
    expect(markerAdjacentShapeOf('3pm')).toBeNull();
    expect(markerAdjacentShapeOf('v2')).toBeNull();
    expect(markerAdjacentShapeOf('45')).toBeNull();
  });
});

describe('the identifier shape table', () => {
  it('recognises the shape the review recorded, and this repository own key shape', () => {
    expect(identifierShapeOf('CONF123456')).toBe('CODE_LIKE');
    expect(identifierShapeOf('REF-4821')).toBe('PREFIXED_CODE');
    expect(identifierShapeOf('cmujhci0b010gr2nb2ypg114p')).toBe('CUID_LIKE');
  });

  it('and declines the shapes that are ordinary language', () => {
    expect(identifierShapeOf('3pm')).toBeNull();
    expect(identifierShapeOf('15:00')).toBeNull();
    expect(identifierShapeOf('Fieldpoint360')).toBeNull();
    expect(identifierShapeOf('v2')).toBeNull();
    expect(identifierShapeOf('2026-03-05')).toBeNull();
  });
});

describe('the detector holds no language-specific literal', () => {
  /**
   * A synthetic third language, registered at runtime.
   *
   * This is the same proof `tests/scheduling/localeLexicon.test.ts` makes for the
   * resolver, and it is the only way to show that a locale is DATA rather than a
   * special case somebody remembered to add. Nothing in `detector.ts` knows this
   * language exists.
   */
  const SYNTHETIC: ClaimLexicon = {
    locale: 'zz',
    displayName: 'Synthetic',
    completionMarkers: [
      { forms: ['grobbled'], family: 'MEETING', mode: 'COMPLETED' },
      // A multi-token FRAME, so the interrupted-frame rule has something in this
      // language to work on. English is the language that needed it; the rule
      // itself must not know that.
      { forms: ['zis grobbled'], family: 'CANCELLATION', mode: 'COMPLETED' },
      // A frame whose first token is this locale's AUXILIARY, so the § 18 rule
      // about what a completion form OPENS with has something in this language to
      // work on. English `has been booked` and `is booked` are the same shape.
      { forms: ['bik grobbled'], family: 'MEETING', mode: 'COMPLETED' },
    ],
    // The bare participle rule, in a language the engine has never heard of: `grobbelt`
    // asserts nothing alone and asserts a completion beside `vorpen`, this locale's
    // word for a meeting.
    completionParticiples: [{ forms: ['grobbelt'], family: 'MEETING', mode: 'COMPLETED' }],
    domainObjects: [{ forms: ['vorpen'], family: 'ANY' }],
    identifierMarkers: ['snerk kod'],
    // TWO negators, because § 18's first rule turns on which one it is. `nix` is
    // this locale's `nothing` - it can BE a subject - and `nox` is its `not`, which
    // cannot.
    negators: ['nix', 'nox'],
    // What a `nix` or an `iffen` may reach ACROSS, and what each token IS. `vorp` is
    // this locale's emphatic particle, which heads nothing; `zub` is its third-person
    // pronoun, which can head a subject; `bik` is its auxiliary; and `snerk` is its
    // word for a worry, which is deliberately NOT here at all - that is what makes
    // `Nix snerk vorp bik grobbled` - the synthetic form of `אין בעיה הפגישה נקבעה` -
    // a detected claim. Nothing in `detector.ts` has heard of any of the four.
    suppressionCarriers: [
      { forms: ['vorp'], role: 'MODIFIER' },
      { forms: ['bik'], role: 'VERB' },
      { forms: ['zub'] },
    ],
    // `nix` is subject-capable and `nox` is not, which is the synthetic form of
    // English `nothing` versus `not`.
    subjectNegators: ['nix'],
    conditionalMarkers: ['iffen'],
    clauseBreakers: ['ond'],
    frameBlockers: ['kanna'],
    frameDeterminers: ['dez'],
    months: [{ forms: ['zzmarch'], month: 3 }],
    ordinalSuffixes: ['xx'],
    // § 20, in a language the engine has never heard of. `zat` is this locale's
    // standing temporal preposition and `zo-` is its FUSED one, which is the
    // shape Hebrew's ב- and ל- have; `zug` is the particle that may stand inside
    // a temporal phrase without naming an hour; `mitt` is the preposition that
    // ENDS one. Nothing in `detector.ts` has heard of any of the four.
    temporalOpeners: [
      { forms: ['zat'], attaches: false },
      { forms: ['zo'], attaches: true, attachedSeparators: ['', '-'] },
    ],
    temporalCarriers: ['zug'],
    temporalSlotEnders: ['mitt'],
    // § 21, in a language the engine has never heard of. `'z` is this locale's
    // apostrophe clitic and `zis` - the first token of its CANCELLATION frame - is
    // what the clitic stands for. English `'s` and `is` are the same shape, and
    // nothing in `text.ts` or `detector.ts` holds either.
    copulaClitics: [{ suffix: "'z", copulas: ['zis'] }],
    // § 21's axis, in the same language: `ik-` marks the first person singular and
    // `ib-` the plural, as a PREFIX, which is the shape Hebrew's future has and the
    // opposite of the shape its past has.
    firstPersonNumberMarkers: [{ attaches: 'PREFIX', singular: 'ik', plural: 'ib' }],
  };

  it('detects a claim in a language it was told about one line ago', () => {
    const claims = detectMaterialClaims('Vorp grobbled 5xx zzmarch.', { lexicons: [SYNTHETIC] });
    expect(claims.map((claim) => claim.family)).toEqual(['MEETING']);
    expect(claims[0]?.locale).toBe('zz');
    expect(claims[0]?.assertedDay).toMatchObject({ dayOfMonth: 5, month: 3 });
  });

  it('and honours that language own negator and its own conditional', () => {
    expect(detectMaterialClaims('Vorp nix grobbled.', { lexicons: [SYNTHETIC] })).toEqual([]);
    expect(detectMaterialClaims('Iffen vorp bik grobbled.', { lexicons: [SYNTHETIC] })).toEqual([]);
  });

  it('tolerates an interruption inside a frame of a language it has never heard of', () => {
    // The generalised half of the adverb fix. `flooby` is an adverb in no language
    // and is in no list anywhere; the rule is that an unlisted token may be
    // skipped, so it is skipped here exactly as `now` is in English.
    const claims = detectMaterialClaims('Vorp zis flooby grobbled.', { lexicons: [SYNTHETIC] });
    expect(claims.map((claim) => claim.family)).toEqual(['CANCELLATION']);
    expect(claims[0]?.matchedForm).toBe('zis grobbled');
  });

  it('and honours that language own frame blockers inside the same frame', () => {
    // `kanna` is this locale's `can`. Blocked, so the frame does not close - and
    // the single-token form still fires, which is the honest reading of a sentence
    // that contains the completion word without the frame around it.
    const claims = detectMaterialClaims('Vorp zis kanna grobbled.', { lexicons: [SYNTHETIC] });
    expect(claims.map((claim) => claim.family)).toEqual(['MEETING']);
    expect(claims[0]?.matchedForm).toBe('grobbled');
  });

  it('and refuses to skip that language own negator inside a frame', () => {
    // The direction that matters: a negator INSIDE a frame stands after the frame's
    // first token, so the suppression rules - which only look at or before it -
    // cannot see it. The frame has to decline to swallow it, in every language.
    expect(detectMaterialClaims('Vorp zis nix grobbled.', { lexicons: [SYNTHETIC] })).toEqual([]);
  });

  it('reads that language own APOSTROPHE CLITIC, and reads nothing when it declares none', () => {
    // § 21, in a language the engine has never heard of. `'z` is this locale's
    // clitic and `zis` - the first token of its CANCELLATION frame - is what the
    // clitic stands for, so `vorpen'z grobbled` has to be read as
    // `vorpen zis grobbled`. Nothing in `text.ts` or `detector.ts` holds either
    // string, and the CANCELLATION reading is only reachable through the clitic.
    const claims = detectMaterialClaims("Vorp vorpen'z grobbled.", { lexicons: [SYNTHETIC] });
    expect(claims.map((claim) => claim.family)).toContain('CANCELLATION');
    expect(claims.map((claim) => claim.matchedForm)).toContain('zis grobbled');

    // And with the clitic declaration removed, the CANCELLATION reading is gone -
    // which is what shows the detection above came from the locale's data rather
    // than from a rule that knows what an apostrophe is.
    expect(
      detectMaterialClaims("Vorp vorpen'z grobbled.", {
        lexicons: [{ ...SYNTHETIC, copulaClitics: [] }],
      }).map((claim) => claim.family),
    ).toEqual(['MEETING']);
  });

  it('reads a BARE PARTICIPLE beside that language own domain object', () => {
    // `grobbelt` is in no `completionMarkers` list, so nothing in the frame rules can
    // see it. The participle rule reads it because `vorpen` - this locale's word for a
    // meeting - stands beside it.
    const claims = detectMaterialClaims('Vorp grobbelt dez vorpen.', { lexicons: [SYNTHETIC] });
    expect(claims.map((claim) => claim.family)).toEqual(['MEETING']);
    expect(claims[0]?.matchedForm).toBe('grobbelt + vorpen');
  });

  it('and declines that same participle when nothing names a domain object', () => {
    // The whole precision argument of the rule, in a language the engine holds no
    // literal of: a participle with nothing this system creates beside it asserts
    // nothing. This is the synthetic form of `let me get that booked`.
    expect(detectMaterialClaims('Vorp grobbelt snerk.', { lexicons: [SYNTHETIC] })).toEqual([]);
  });

  it("and declines it when that language own mood word stands in front of it", () => {
    // `kanna` is this locale's `can`. The synthetic form of `I can have your meeting
    // booked for you`, which must stay clean.
    expect(detectMaterialClaims('Vorp kanna grobbelt dez vorpen.', { lexicons: [SYNTHETIC] })).toEqual([]);
  });

  it('and its own clause breaker, which bounds that negator to its own clause', () => {
    // The engine knows no conjunction in any language: `ond` is this synthetic
    // locale's `but`, and nothing in detector.ts has heard of either.
    expect(familiesIn('Vorp nix zzmarch ond vorp grobbled.')).toEqual([]);
    const claims = detectMaterialClaims('Vorp nix zzmarch ond vorp grobbled.', { lexicons: [SYNTHETIC] });
    expect(claims.map((claim) => claim.family)).toEqual(['MEETING']);
  });

  it('and its own suppressionCarriers, which decide how far that negator REACHES', () => {
    // THE § 17 RULE, PROVED TO BE DATA. `vorp` is declared a carrier in this
    // locale and `snerk` is not, so the SAME negator in the SAME clause at the SAME
    // distance suppresses across one and not across the other. Nothing in
    // `detector.ts` has heard of either word, and no rule in it knows what a
    // reassurance is.
    expect(
      detectMaterialClaims('Nix vorp bik grobbled.', { lexicons: [SYNTHETIC] }),
      'a carrier is crossed, so the negator governs the completion and it is a plan',
    ).toEqual([]);
    const claims = detectMaterialClaims('Nix snerk vorp bik grobbled.', { lexicons: [SYNTHETIC] });
    expect(
      claims.map((claim) => claim.family),
      'an UNDECLARED token ends the reach, so the negator governs `snerk` and the completion is asserted - ' +
        'which is the synthetic form of `אין בעיה הפגישה נקבעה`',
    ).toEqual(['MEETING']);
  });

  it('and bounds that reach in tokens as well, which can only ever ADD a detection', () => {
    // Five carriers is past `MAX_CARRIERS_A_SUPPRESSOR_MAY_REACH_ACROSS`, so the
    // negator stops reaching and the completion is detected. The bound is the belt
    // over the carrier list: its only effect is to make suppression stricter, so it
    // cannot turn a detection into a miss.
    expect(familiesIn('Nix vorp vorp vorp vorp bik grobbled.', [SYNTHETIC])).toEqual([]);
    expect(familiesIn('Nix vorp vorp vorp vorp vorp bik grobbled.', [SYNTHETIC])).toEqual(['MEETING']);
  });

  it('and reads that language own CARRIER ROLES, so an all-carrier filler cannot silence it', () => {
    // THE § 18 RULE, PROVED TO BE DATA. Both sentences are built out of NOTHING but
    // tokens this locale declares, at the same distance, behind the same negator.
    // What separates them is the ROLE the locale gave each carrier: `vorp` heads
    // nothing, so `nix` still has its predicate to find and `grobbled` is it; `zub`
    // can head a subject, so a NEW clause starts there and `nix` never reaches it.
    // This is the synthetic form of `Nothing at all has been booked yet.` against
    // `Nothing else your meeting is booked for Thursday at 2pm.`
    expect(
      detectMaterialClaims('Nix vorp bik grobbled.', { lexicons: [SYNTHETIC] }),
      'a MODIFIER heads nothing, so the negator is still looking for the predicate it finds',
    ).toEqual([]);
    expect(
      familiesIn('Nix vorp zub bik grobbled.', [SYNTHETIC]),
      'a SUBJECT standing where a predicate was due is a new clause, so the negator governs none of it',
    ).toEqual(['MEETING']);
  });

  it('and knows that language own negator cannot be a subject, so a bare one governs nothing', () => {
    // § 18 rule 1, in a language the engine holds no literal of. `nox` opens its
    // clause and this locale does not list it in `subjectNegators`, so it has no
    // subject and is a stand-alone negative reply - the synthetic `Not at all`. The
    // SAME negator, the SAME carrier and the SAME form suppress correctly when
    // something before it in the clause can be its subject.
    expect(
      familiesIn('Nox vorp bik grobbled.', [SYNTHETIC]),
      'a clause-initial negator with no possible subject governs only its own modifiers',
    ).toEqual(['MEETING']);
    expect(
      detectMaterialClaims('Zub nox vorp bik grobbled.', { lexicons: [SYNTHETIC] }),
      'and the same negator with a subject in front of it governs its predicate exactly as before',
    ).toEqual([]);
  });

  it('and applies the same reach to that language own BARE PARTICIPLE rule', () => {
    // One definition of "governs" in the module, not two. `kanna` is this locale's
    // `can`: adjacent to the participle it silences it, and behind an undeclared
    // token it does not. Without this, a mood word pooled from ANOTHER locale could
    // silence a participle it has nothing to do with - which is how a Hebrew
    // `אין בעיה` silenced an English `meeting booked`.
    expect(detectMaterialClaims('Vorp kanna grobbelt dez vorpen.', { lexicons: [SYNTHETIC] })).toEqual([]);
    expect(familiesIn('Vorp kanna snerk grobbelt dez vorpen.', [SYNTHETIC])).toEqual(['MEETING']);
  });
});

describe('a negator suppresses only the completion form it GOVERNS', () => {
  /**
   * The § 17 defect, on the pure detector.
   *
   * Every sentence in the first table was returned to a real caller AND PERSISTED as
   * a spoken agent turn with an empty ledger - independent QA round 3 drove the first
   * five through the real `AgentTurnService` against real SQLite. The mechanism was
   * that suppression asked only WHERE a negator stood and never whether it had
   * anything to do with the form it silenced, and Hebrew's ordinary reassurances are
   * built on the two words `lexicon/he.ts` cannot omit from `negators`.
   *
   * The control is the same sentence one comma later, which was always caught. That
   * is the whole finding: for the second time in this gate the verdict depended on a
   * punctuation mark a 7B model happened to type.
   */
  const leaked: readonly (readonly [string, string])[] = [
    ['אין בעיה הפגישה נקבעה למחר בשעה 14:00.', 'MEETING'],
    ['אין בעיה קבעתי לך פגישה למחר בשעה 14:00.', 'MEETING'],
    ['אין דאגה הפגישה נקבעה למחר בשעה 14:00.', 'MEETING'],
    ['לא נורא הפגישה נקבעה למחר בשעה 14:00.', 'MEETING'],
    ['אין צורך לדאוג הפגישה נקבעה למחר בשעה 14:00.', 'MEETING'],
    // Wider than the report, measured on the detector rather than assumed.
    ['אין שום בעיה הפגישה נקבעה למחר בשעה 14:00.', 'MEETING'],
    ['אין בעיה הפגישה בוטלה.', 'CANCELLATION'],
    ['אין בעיה אתקשר אליך מחר בשעה 15:00.', 'CALLBACK'],
    // Wider than HEBREW, which the finding did not claim: `Don't worry` carries a
    // DECLARED English negator and leaked too with no comma after it.
    ["Don't worry your meeting is booked for Thursday at 2pm.", 'MEETING'],
    ['I cannot take payments your meeting is booked for Thursday at 2pm.', 'MEETING'],
    ['If that works for you your meeting is booked for Thursday at 2pm.', 'MEETING'],
    // The cross-locale participle path, which is different code: `blockerStandsBefore`
    // pools mood tokens from every registered locale.
    ['אין בעיה meeting booked for Thursday at 2pm.', 'MEETING'],
  ];

  for (const [text, family] of leaked) {
    it(`detects the claim behind a reassurance with no punctuation: ${JSON.stringify(text)}`, () => {
      expect(familiesIn(text)).toContain(family);
    });
  }

  it('and the comma control, which was the only spelling that ever worked', () => {
    expect(familiesIn('אין בעיה, הפגישה נקבעה למחר בשעה 14:00.')).toContain('MEETING');
  });

  /**
   * QA-3's five precision controls, which are the reason the fix is a governance rule
   * and not a deletion from `negators`.
   *
   * The obvious way to stop `אין בעיה הפגישה נקבעה` leaking is to drop `לא` and `אין`
   * from `lexicon/he.ts`. Every one of these sentences would then become a blocked
   * false claim - and each is what a model must be able to say when nothing is
   * booked, which is the failure mode that gets a gate switched off.
   */
  const governed: readonly string[] = [
    'הפגישה לא נקבעה עדיין.',
    'עדיין לא נקבע כלום.',
    'אין פגישה ביומן.',
    'לא קבעתי כלום עדיין.',
    'אין לי אפשרות לשלוח אימייל.',
  ];

  for (const text of governed) {
    it(`keeps the truthful negation clean: ${JSON.stringify(text)}`, () => {
      expect(detectMaterialClaims(text)).toEqual([]);
    });
  }

  it('and keeps it clean with a reassurance stacked in front of it', () => {
    // The direction a governance rule breaks in: the filler must not make a
    // genuinely governed negation start firing either.
    expect(detectMaterialClaims('אין בעיה הפגישה לא נקבעה עדיין.')).toEqual([]);
    expect(detectMaterialClaims("Don't worry nothing is booked yet.")).toEqual([]);
    expect(detectMaterialClaims('אין צורך לדאוג nothing is booked yet.')).toEqual([]);
  });

  it('and reaches an identifier MARKER across the verb of giving it is the object of', () => {
    // A completion form is a PREDICATE and negation is pre-predicate, so the negator
    // stands next to it. An identifier marker is a NOUN PHRASE in object position, so
    // the verb the negator really negates stands between them. `lexicon/en.ts` lists
    // those verbs with that argument, and this is the sentence that needs them.
    expect(detectMaterialClaims('I cannot give you a confirmation number for that.')).toEqual([]);
    // And the positive spelling is still a claim, so the reach has not swallowed the
    // rule it bounds. An identifier marker is `IDENTIFIER_ASSERTED` rather than an
    // effect, which is why this asserts on the kind.
    expect(
      detectMaterialClaims('I can give you a booking reference for that.').map((claim) => claim.kind),
    ).toContain('IDENTIFIER_ASSERTED');
  });

  it('and a NOUN-SUBJECT copula contraction does not escape a negation that governs it', () => {
    // The precision direction of § 21, and the one that decides whether the clitic
    // reading is safe to add at all. Every honest negation has to survive being read
    // the second way: `your meeting's not booked yet` becomes `your meeting is not
    // booked yet`, where `not` sits INSIDE the frame and the frame refuses to swallow
    // it, and the bare participle is governed by the same `not`.
    expect(detectMaterialClaims("Your meeting's not booked yet.")).toEqual([]);
    expect(detectMaterialClaims("Nothing's booked yet.")).toEqual([]);
    expect(detectMaterialClaims("Your meeting's not confirmed - I still need a time from you.")).toEqual([]);
    expect(detectMaterialClaims("Let's get your meeting booked for Thursday.")).toEqual([]);
    expect(detectMaterialClaims("Here's what I can do - let's check the diary for Thursday.")).toEqual([]);
    expect(detectMaterialClaims("Your meeting's booked for Thursday?")).toEqual([]);
  });

  it('and a multi-token conditional marker does not suppress through ONE of its words', () => {
    // Found by `SUPPRESSION_MATRIX` rather than reported. `would you like` and
    // `do you want` are multi-token `conditionalMarkers`, and splitting them into
    // single mood tokens made bare `you` suppress on its own - so a filler that
    // merely ENDED in `you` silenced the claim behind it.
    expect(familiesIn('If that works for you meeting booked for Thursday at 2pm.')).toContain('MEETING');
    // And the phrase itself still suppresses, because `readSuppression` matches whole
    // forms rather than single tokens.
    expect(detectMaterialClaims('Would you like me to get your meeting booked for Thursday?')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// § 21: the apostrophe clitic, and the person/number axis
// ---------------------------------------------------------------------------

/**
 * CLASS A: a copula fused to a NOUN subject.
 *
 * Four wordings were RELEASED to a real caller and PERSISTED as spoken AGENT turns
 * with zero domain rows behind them, while the identical sentence with the copula
 * spelled out was blocked in the same run. The cause was tokenisation rather than
 * vocabulary - `text.ts` keeps an apostrophe inside a token, so `meeting's` is one
 * word and neither `is booked` nor `domainObjects` can see inside it.
 *
 * The rows below go WIDER than the four reported wordings ON PURPOSE. The fix would
 * be worthless if it covered only the nouns somebody typed, so the table crosses
 * nouns that appear in no fixture (`reservation`, `follow-up`, `booking`) against
 * every family. `docs/MISSION_2D_CLAIM_GATE.md` § 21 has the argument.
 */
describe('a copula contracted onto a NOUN subject is a claim', () => {
  const CONTRACTED: readonly { readonly text: string; readonly family: string }[] = [
    // ---- QA's four, verbatim ---------------------------------------------
    { text: "Your meeting's booked for Thursday at 2pm.", family: 'MEETING' },
    { text: "Your appointment's confirmed for Thursday at 2pm.", family: 'MEETING' },
    { text: "The meeting's been booked for Thursday at 2pm.", family: 'MEETING' },
    { text: "Your callback's arranged for 3pm tomorrow.", family: 'CALLBACK' },
    // ---- the GENERALISATION: nouns nobody listed anywhere ------------------
    { text: "Your reservation's confirmed for Thursday at 2pm.", family: 'MEETING' },
    { text: "Your booking's been cancelled.", family: 'CANCELLATION' },
    { text: "Your follow-up's arranged for 3pm tomorrow.", family: 'CALLBACK' },
    { text: "That appointment's been moved to Friday at 10am.", family: 'RESCHEDULE' },
    { text: "Your confirmation email's been sent.", family: 'MESSAGE' },
    { text: "Your slot's locked in for Thursday at 2pm.", family: 'MEETING' },
  ];

  for (const row of CONTRACTED) {
    it(`detects ${JSON.stringify(row.text)}`, () => {
      expect(familiesIn(row.text)).toContain(row.family);
    });
  }

  it('and the A/B control - the same claim with the copula spelled out - is unchanged', () => {
    expect(familiesIn('Your meeting is booked for Thursday at 2pm.')).toContain('MEETING');
  });

  it('reads the clitic through the BARE-PARTICIPLE route as well as the frame route', () => {
    // Both routes failed on the same token and both have to come back, or the fix is
    // one route wide. A clause joiner may never be skipped inside a frame, so
    // `is booked` cannot close over `finally and officially` - which leaves only the
    // § 16.3b participle rule, and that rule needed `meeting` to be a token at all.
    const claims = detectMaterialClaims("Your meeting's finally and officially booked for Thursday at 2pm.");
    expect(claims.map((claim) => claim.family)).toContain('MEETING');
    expect(
      claims.map((claim) => claim.matchedForm),
      'the audit has to quote BOTH halves, or this was the frame route after all',
    ).toContain('booked + meeting');
  });

  it('and reads it across a sentence cut, so § 19 and § 21 compose', () => {
    // The bridged pass pairs reading k of one segment with reading k of the next.
    // Without that pairing this is a miss: `your meeting's` is one segment and
    // `booked for Thursday` is the other.
    expect(familiesIn("Your meeting's\nbooked for Thursday at 2pm.")).toContain('MEETING');
  });

});

/**
 * CLASS B: a first-person completion form with one NUMBER and not the other.
 *
 * Five wordings were RELEASED and PERSISTED because Hebrew declared `ביטלתי` and not
 * `ביטלנו`, `שלחתי` and not `שלחנו`, `רשמתי` and not `רשמנו`, `שיניתי` and not
 * `שינינו`, and `סגרנו` and not `סגרתי` - the last one being the drift pointing the
 * other way, which is what shows this is drift and not a missing plural rule.
 *
 * The FIX is that `lexicon/he.ts` generates both numbers from one paired declaration.
 * The test below is the proof that nothing reached `completionMarkers` by any other
 * route, and it is deliberately generic over every REGISTERED locale: it reads the
 * person/number morphology each locale declares and asks the lexicon to answer for
 * every form it has. The next unpaired inflection fails here instead of reaching a
 * caller.
 */
describe('every first-person completion form has BOTH numbers', () => {
  interface Declared {
    readonly form: string;
    readonly family: string;
    readonly mode: string;
  }

  const declaredForms = (lexicon: ClaimLexicon): readonly Declared[] =>
    lexicon.completionMarkers.flatMap((entry) =>
      entry.forms.map((form) => ({ form, family: entry.family, mode: entry.mode })),
    );

  /** The counterpart `form` must have under `marker`, or `null` if it is not first person. */
  const counterpartOf = (form: string, marker: FirstPersonNumberMarker): string | null => {
    if (marker.notFirstPerson?.includes(form) === true) return null;
    if (marker.attaches === 'PREFIX') {
      if (form.startsWith(marker.singular)) return `${marker.plural}${form.slice(marker.singular.length)}`;
      if (form.startsWith(marker.plural)) return `${marker.singular}${form.slice(marker.plural.length)}`;
      return null;
    }
    if (form.endsWith(marker.singular)) {
      return `${form.slice(0, form.length - marker.singular.length)}${marker.plural}`;
    }
    if (form.endsWith(marker.plural)) {
      return `${form.slice(0, form.length - marker.plural.length)}${marker.singular}`;
    }
    return null;
  };

  for (const lexicon of REGISTERED_CLAIM_LEXICONS) {
    it(`${lexicon.locale}: declares how it marks person and number at all`, () => {
      // An empty marker list would make the assertion below vacuously true, which is
      // exactly the failure mode `claimGateNonVacuity.test.ts` exists for.
      expect(
        lexicon.firstPersonNumberMarkers.length,
        `${lexicon.locale} declares no person/number axis, so nothing below can fail`,
      ).toBeGreaterThanOrEqual(1);
    });

    it(`${lexicon.locale}: every first-person completion form has its number counterpart declared`, () => {
      const declared = declaredForms(lexicon);
      const index = new Set(declared.map((entry) => `${entry.form}|${entry.family}|${entry.mode}`));
      const unpaired: string[] = [];

      for (const entry of declared) {
        for (const marker of lexicon.firstPersonNumberMarkers) {
          const counterpart = counterpartOf(entry.form, marker);
          if (counterpart === null) continue;
          if (index.has(`${counterpart}|${entry.family}|${entry.mode}`)) continue;
          unpaired.push(
            `${lexicon.locale}: ${JSON.stringify(entry.form)} (${entry.family}/${entry.mode}) has no ` +
              `${JSON.stringify(counterpart)} beside it. Declare the pair, or declare the form in ` +
              `firstPersonNumberMarkers.notFirstPerson with the reason.`,
          );
        }
      }

      expect(
        unpaired,
        'A first-person form with one number and not the other is the § 21 CLASS B defect: ' +
          'five wordings of exactly this shape were released to real callers AND PERSISTED with ' +
          'an empty ledger, while the other number of the same verb was blocked in the same run.',
      ).toEqual([]);
    });

    it(`${lexicon.locale}: the axis test is not vacuous - it sees first-person forms`, () => {
      const seen = declaredForms(lexicon).filter((entry) =>
        lexicon.firstPersonNumberMarkers.some((marker) => counterpartOf(entry.form, marker) !== null),
      );
      expect(
        seen.length,
        `${lexicon.locale}: no declared form matched any person/number marker, so the pairing ` +
          'assertion proved nothing',
      ).toBeGreaterThanOrEqual(4);
    });
  }

  it('and the test FAILS on a lexicon that carries one number of a verb', () => {
    // The self-test. A check that cannot fail is not a check, and this gate has been
    // told so three times (§§ 15.2, 16.4, 17.2). `ביטלנו` is removed from a copy of
    // the real Hebrew lexicon, which is the exact state that leaked.
    const broken: ClaimLexicon = {
      ...REGISTERED_CLAIM_LEXICONS[1] as ClaimLexicon,
      completionMarkers: (REGISTERED_CLAIM_LEXICONS[1] as ClaimLexicon).completionMarkers.map((entry) => ({
        ...entry,
        forms: entry.forms.filter((form) => form !== 'ביטלנו'),
      })),
    };
    const unpaired = declaredForms(broken).filter((entry) =>
      broken.firstPersonNumberMarkers.some((marker) => {
        const counterpart = counterpartOf(entry.form, marker);
        if (counterpart === null) return false;
        return !broken.completionMarkers.some(
          (other) =>
            other.family === entry.family && other.mode === entry.mode && other.forms.includes(counterpart),
        );
      }),
    );
    expect(unpaired.map((entry) => entry.form)).toEqual(['ביטלתי']);
  });
});

/**
 * The generative matrix has to CROSS both new axes, or § 21 is a fixture list.
 *
 * `SUPPRESSION_CLAIM_BASES` declared `contracted` as a dimension and crossed one half
 * of it: every `contracted: true` row was a subject PRONOUN, and every third-person
 * row was `contracted: false`. That is § 17.8 residual 19 arriving again - an axis
 * whose values are drawn from what the lexicon already handles cannot falsify it.
 */
describe('the generated matrix crosses the § 21 axes', () => {
  it('carries THIRD-PERSON contracted rows, over more than one noun', () => {
    const rows = SUPPRESSION_CLAIM_BASES.filter((base) => base.contracted && base.person === 'THIRD');
    const nounSubject = rows.filter((base) => /^(your|the|that|this) [a-z-]+'s /u.test(base.text));
    expect(
      nounSubject.length,
      'a `contracted` axis whose only values are subject pronouns is half an axis, and the half ' +
        'it omits is the one an apostrophe attaches to an arbitrary NOUN in',
    ).toBeGreaterThanOrEqual(5);
    // Distinct NOUNS, so no row can pass because somebody listed its noun.
    const nouns = new Set(nounSubject.map((base) => /^(?:your|the|that|this) ([a-z-]+)'s /u.exec(base.text)?.[1]));
    expect(nouns.size).toBeGreaterThanOrEqual(4);
    // And more than one FAMILY, so the axis is not one frame wide.
    expect(new Set(nounSubject.map((base) => base.family)).size).toBeGreaterThanOrEqual(3);
  });

  it('crosses BOTH numbers for the Hebrew first person, in more than one family', () => {
    const hebrew = SUPPRESSION_CLAIM_BASES.filter((base) => base.language === 'he');
    const singular = hebrew.filter((base) => base.person === 'FIRST_SINGULAR');
    const plural = hebrew.filter((base) => base.person === 'FIRST_PLURAL');
    expect(singular.length).toBeGreaterThanOrEqual(6);
    expect(plural.length).toBeGreaterThanOrEqual(6);
    // Every family that has one number has the other, which is the matrix form of
    // the lexicon's paired declaration.
    expect(new Set(plural.map((base) => base.family))).toEqual(new Set(singular.map((base) => base.family)));
  });
});
