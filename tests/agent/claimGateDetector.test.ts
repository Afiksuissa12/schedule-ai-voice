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

const familiesIn = (text: string): string[] =>
  detectMaterialClaims(text)
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
    completionMarkers: [{ forms: ['grobbled'], family: 'MEETING', mode: 'COMPLETED' }],
    identifierMarkers: ['snerk kod'],
    negators: ['nix'],
    conditionalMarkers: ['iffen'],
    clauseBreakers: ['ond'],
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

  it('and its own clause breaker, which bounds that negator to its own clause', () => {
    // The engine knows no conjunction in any language: `ond` is this synthetic
    // locale's `but`, and nothing in detector.ts has heard of either.
    expect(familiesIn('Vorp nix zzmarch ond vorp grobbled.')).toEqual([]);
    const claims = detectMaterialClaims('Vorp nix zzmarch ond vorp grobbled.', { lexicons: [SYNTHETIC] });
    expect(claims.map((claim) => claim.family)).toEqual(['MEETING']);
  });
});
