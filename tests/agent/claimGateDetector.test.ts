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
import type { ClaimLexicon } from '../../src/agent/claimGate/lexicon/index.js';

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
    expect(claims.map((claim) => claim.family)).toContain('MEETING');
    expect(claims.map((claim) => claim.family)).toContain('CALLBACK');
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
    ['I booked the callback for 3pm tomorrow.', 'MEETING'],
    ['I scheduled the callback for 3pm tomorrow.', 'MEETING'],
    ['I confirmed your meeting for tomorrow at 3pm.', 'MEETING'],
    ['I booked you in for tomorrow at 3pm.', 'MEETING'],
    ['I have reserved tomorrow at 3pm for you.', 'MEETING'],
    ['I saved the appointment for Thursday.', 'MEETING'],
    ["I've put you down for tomorrow at 3pm.", 'MEETING'],
    ['We booked the callback for 3pm.', 'MEETING'],
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
    // pronoun, which can head a subject; `snerk` is its word for a worry and is
    // deliberately NOT here at all, which is what makes `Nix snerk vorp grobbled` -
    // the synthetic form of `אין בעיה הפגישה נקבעה` - a detected claim. Nothing in
    // `detector.ts` has heard of any of the three.
    suppressionCarriers: [{ forms: ['vorp'], role: 'MODIFIER' }, { forms: ['zub'] }],
    // `nix` is subject-capable and `nox` is not, which is the synthetic form of
    // English `nothing` versus `not`.
    subjectNegators: ['nix'],
    conditionalMarkers: ['iffen'],
    clauseBreakers: ['ond'],
    frameBlockers: ['kanna'],
    frameDeterminers: ['dez'],
    months: [{ forms: ['zzmarch'], month: 3 }],
    ordinalSuffixes: ['xx'],
  };

  it('detects a claim in a language it was told about one line ago', () => {
    const claims = detectMaterialClaims('Vorp grobbled 5xx zzmarch.', { lexicons: [SYNTHETIC] });
    expect(claims.map((claim) => claim.family)).toEqual(['MEETING']);
    expect(claims[0]?.locale).toBe('zz');
    expect(claims[0]?.assertedDay).toMatchObject({ dayOfMonth: 5, month: 3 });
  });

  it('and honours that language own negator and its own conditional', () => {
    expect(detectMaterialClaims('Vorp nix grobbled.', { lexicons: [SYNTHETIC] })).toEqual([]);
    expect(detectMaterialClaims('Iffen vorp grobbled.', { lexicons: [SYNTHETIC] })).toEqual([]);
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
      detectMaterialClaims('Nix vorp grobbled.', { lexicons: [SYNTHETIC] }),
      'a carrier is crossed, so the negator governs the completion and it is a plan',
    ).toEqual([]);
    const claims = detectMaterialClaims('Nix snerk vorp grobbled.', { lexicons: [SYNTHETIC] });
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
    expect(familiesIn('Nix vorp vorp vorp vorp grobbled.', [SYNTHETIC])).toEqual([]);
    expect(familiesIn('Nix vorp vorp vorp vorp vorp grobbled.', [SYNTHETIC])).toEqual(['MEETING']);
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
      detectMaterialClaims('Nix vorp grobbled.', { lexicons: [SYNTHETIC] }),
      'a MODIFIER heads nothing, so the negator is still looking for the predicate it finds',
    ).toEqual([]);
    expect(
      familiesIn('Nix vorp zub grobbled.', [SYNTHETIC]),
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
      familiesIn('Nox vorp grobbled.', [SYNTHETIC]),
      'a clause-initial negator with no possible subject governs only its own modifiers',
    ).toEqual(['MEETING']);
    expect(
      detectMaterialClaims('Zub nox vorp grobbled.', { lexicons: [SYNTHETIC] }),
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
