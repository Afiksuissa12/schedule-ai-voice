/**
 * The claim gate's text engine: sentences, tokens, and how a form is matched.
 *
 * These are the properties everything else in the gate rests on, and every one of
 * them has been a live fail-open defect at some point. If SENTENCE scope is wrong, a
 * negation in one sentence silences a false claim in the next - which is EXACTLY the
 * shape of the real `aya-expanse:8b` defect. If CLAUSE scope is wrong, a negation in
 * a leading reassurance silences a false claim after the comma - the same defect one
 * punctuation mark narrower, and it was reachable, released and persisted
 * (`docs/MISSION_2D_CLAIM_GATE.md` § 15). If FORM MATCHING requires adjacency, one
 * adverb inside a frame silences the claim entirely - the same defect one word
 * narrower, also released and persisted (§ 16). If tokenisation is wrong for one
 * script, that language has no gate at all.
 *
 * The CRLF case is here rather than implied. A regex that could not consume a
 * `\r` once made `npm run check:anti-scripting` pass or fail depending on how
 * the reader had cloned the repository
 * (`docs/FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 13), and model output arrives
 * with whatever line endings the model felt like.
 */
import { describe, expect, it } from 'vitest';

import { matchLongestForm, readSentences, readTokens } from '../../src/agent/claimGate/text.js';

describe('the claim gate text engine', () => {
  it('splits on every terminator, and keeps the question mark as a question', () => {
    const sentences = readSentences('It is booked. Shall I confirm? Nothing else!');
    expect(sentences.map((sentence) => sentence.raw)).toEqual([
      'It is booked',
      'Shall I confirm',
      'Nothing else',
    ]);
    expect(sentences.map((sentence) => sentence.interrogative)).toEqual([false, true, false]);
  });

  it('treats a line break as a sentence boundary, so a bulleted turn is not one claim', () => {
    const sentences = readSentences('- nothing is booked yet\n- it is booked for Thursday');
    expect(sentences).toHaveLength(2);
    expect(sentences[0]?.raw).toBe('- nothing is booked yet');
    expect(sentences[1]?.raw).toBe('- it is booked for Thursday');
  });

  it('is byte-for-byte indifferent to CRLF', () => {
    const lf = readSentences('nothing is booked yet\nit is booked for Thursday');
    const crlf = readSentences('nothing is booked yet\r\nit is booked for Thursday');
    expect(crlf.map((sentence) => sentence.raw)).toEqual(lf.map((sentence) => sentence.raw));
    expect(crlf.map((sentence) => sentence.tokens.map((token) => token.text))).toEqual(
      lf.map((sentence) => sentence.tokens.map((token) => token.text)),
    );
  });

  it('ends a sentence after a number but not inside one', () => {
    expect(readSentences('I have booked it for 3. Anything else').map((s) => s.raw)).toEqual([
      'I have booked it for 3',
      'Anything else',
    ]);
    expect(readSentences('booked for 15.30 tomorrow')[0]?.tokens.map((t) => t.text)).toContain('15.30');
  });

  it('keeps a clock time, a Hebrew attached prefix and an apostrophe whole', () => {
    expect(readTokens('at 15:00').map((token) => token.text)).toEqual(['at', '15:00']);
    expect(readTokens('מחר ב-15:00').map((token) => token.text)).toEqual(['מחר', 'ב-15:00']);
    expect(readTokens("you're all set").map((token) => token.text)).toEqual(["you're", 'all', 'set']);
  });

  it('strips niqqud and bidi controls before comparing, through normalizeScript', () => {
    // U+200F RIGHT-TO-LEFT MARK either side, and a qamats inside the word.
    const withMarks = readTokens('‏נִקְבעה‏');
    expect(withMarks.map((token) => token.text)).toEqual(['נקבעה']);
  });

  it('strips punctuation from the edges of a token but not from the middle', () => {
    expect(readTokens('(booked)').map((token) => token.text)).toEqual(['booked']);
    expect(readTokens('"CONF123456"').map((token) => token.text)).toEqual(['conf123456']);
    expect(readTokens('a.m').map((token) => token.text)).toEqual(['a.m']);
  });

  it('prefers the longest matching form, which is what stops a frame being read as a word', () => {
    const tokens = readTokens('it has been booked');
    expect(matchLongestForm(tokens, 1, ['booked', 'been booked', 'has been booked'])?.form).toBe(
      'has been booked',
    );
  });

  it('matches whole tokens only, never substrings', () => {
    const tokens = readTokens('overbooked capacity');
    expect(matchLongestForm(tokens, 0, ['booked'])).toBeNull();
  });
});

/**
 * THE INTERRUPTED FRAME.
 *
 * `matchLongestForm` matched only ADJACENT tokens, and because every English
 * completion form is a multi-token frame, one word inside a frame defeated the whole
 * detector: `Your meeting is NOW booked for tomorrow at 3pm.` was released to a real
 * caller and persisted with an empty ledger while the same sentence without `now` was
 * blocked (`docs/MISSION_2D_CLAIM_GATE.md` § 16).
 *
 * Asserted HERE, directly on the matcher, and not only through the detector, for the
 * reason the clause block below gives: a detector verdict cannot tell a wrong matcher
 * from a wrong lexicon, and this is the matcher.
 */
describe('a form whose tokens are not adjacent', () => {
  // `your` is in `blockedTokens` and NOT in `moodTokens`, which is the split the two
  // fields exist for: a determiner may not be interior to a frame and is ordinary in
  // front of one.
  const ALLOWANCE = {
    maxSkippedTokens: 2,
    blockedTokens: new Set(['not', 'can', 'and', 'your', 'the']),
    moodTokens: new Set(['not', 'can']),
  };

  it('does not match at all without an allowance, which is the behaviour that leaked', () => {
    const tokens = readTokens('your meeting is now booked');
    expect(matchLongestForm(tokens, 2, ['is booked'])).toBeNull();
  });

  it('matches across one skipped token, and reports the span and the skip', () => {
    const tokens = readTokens('your meeting is now booked');
    const hit = matchLongestForm(tokens, 2, ['is booked'], ALLOWANCE);
    // The SPAN is 3 - `is now booked` - because the caller advances its cursor by it.
    // The FORM is still `is booked`, because that is what the lexicon declared.
    expect(hit).toEqual({ length: 3, form: 'is booked', skipped: 1 });
  });

  it('matches across a skip at EACH seam of a three-token frame', () => {
    const tokens = readTokens('your meeting has now been successfully booked');
    const hit = matchLongestForm(tokens, 2, ['has been booked'], ALLOWANCE);
    expect(hit).toEqual({ length: 5, form: 'has been booked', skipped: 2 });
  });

  it('stops at the bound, so a frame stays a frame', () => {
    const tokens = readTokens('i have a slot free and booked');
    expect(matchLongestForm(tokens, 0, ['i have booked'], ALLOWANCE)).toBeNull();
  });

  it('refuses to skip a blocked token, which is how a negator inside a frame is kept out', () => {
    // `not` stands AFTER the form's first token, where the detector's suppression
    // rules cannot see it, so the MATCHER has to decline.
    const tokens = readTokens('i have not booked anything');
    expect(matchLongestForm(tokens, 0, ['i have booked'], ALLOWANCE)).toBeNull();
  });

  it('refuses when a blocked token stands immediately in front of the frame', () => {
    // `have booked` is a form of its own, so without this rule `I can have that
    // booked for you` - an honest intention - reads as a completed booking.
    const tokens = readTokens('i can have that booked for you');
    expect(matchLongestForm(tokens, 2, ['have booked'], ALLOWANCE)).toBeNull();
  });

  it('but only when that blocker is in the SAME clause, because a modal stops at a comma', () => {
    const tokens = readTokens('if not, i have now booked it');
    // `not` is token 1 and clause 0; the frame starts at token 2 in clause 1.
    expect(tokens[1]?.clause).toBe(0);
    expect(tokens[2]?.clause).toBe(1);
    expect(matchLongestForm(tokens, 2, ['i have booked'], ALLOWANCE)?.form).toBe('i have booked');
  });

  it('leaves an ADJACENT match byte-identical, allowance or not', () => {
    // The property that makes this change incapable of turning a detection into a
    // miss: the adjacent pass runs first and is untouched.
    const tokens = readTokens('your meeting is booked');
    const without = matchLongestForm(tokens, 2, ['is booked', 'booked']);
    const with_ = matchLongestForm(tokens, 2, ['is booked', 'booked'], ALLOWANCE);
    expect(with_).toEqual(without);
    expect(with_).toEqual({ length: 2, form: 'is booked', skipped: 0 });
  });

  it('refuses to skip a DETERMINER, because noun-phrase material is not frame interior', () => {
    // `I will have your call back booked shortly.` - an honest intention - closed the
    // frame `i will call` across `have your` and reported a callback promise.
    const tokens = readTokens('i will have your call back booked shortly');
    expect(matchLongestForm(tokens, 0, ['i will call'], ALLOWANCE)).toBeNull();
  });

  it('but a determiner in FRONT of a frame silences nothing, which is why the sets differ', () => {
    // `the` is in `blockedTokens` and not in `moodTokens`. `The meeting is now booked.`
    // is a claim and the article is just the subject's article.
    const tokens = readTokens('the meeting is now booked');
    expect(matchLongestForm(tokens, 2, ['is booked'], ALLOWANCE)?.form).toBe('is booked');
  });

  it('prefers the form with MORE OF ITS OWN TOKENS, not the one that covers more text', () => {
    // `callback is booked` must beat `is booked` across an interruption too, or a
    // correctly booked callback is reported as an unsupported meeting.
    const tokens = readTokens('your callback is already booked');
    const hit = matchLongestForm(tokens, 2, ['is booked'], ALLOWANCE);
    expect(hit?.form).toBe('is booked');
    const longer = matchLongestForm(tokens, 1, ['callback is booked', 'callback is arranged'], ALLOWANCE);
    expect(longer).toEqual({ length: 4, form: 'callback is booked', skipped: 1 });
  });
});

/**
 * The CLAUSE rules.
 *
 * These are the boundaries a negator may not cross, and getting them wrong in
 * either direction is a live defect: too wide and `אין דאגה, הפגישה נקבעה` is
 * released with nothing booked, too narrow and `הפגישה לא נקבעה` is regenerated
 * though it is true. `.clause` is asserted directly here rather than only through
 * the detector, because the detector's verdict cannot tell a wrong boundary from a
 * wrong lexicon.
 */
describe('the clause boundaries inside a sentence', () => {
  const clausesOf = (sentence: string): number[] => readTokens(sentence).map((token) => token.clause);

  it('breaks on a comma, which is not a sentence terminator', () => {
    // The whole defect in one assertion: `אין` must not be in the same clause as
    // `נקבעה`, and only the comma stands between them.
    expect(clausesOf('אין דאגה, הפגישה נקבעה')).toEqual([0, 0, 1, 1]);
    expect(clausesOf("Don't worry, your meeting is booked")).toEqual([0, 0, 1, 1, 1, 1]);
  });

  it('breaks on a standalone dash and on a colon, and on neither inside a token', () => {
    expect(clausesOf('Never fear - I have booked it')).toEqual([0, 0, 1, 1, 1, 1]);
    expect(clausesOf('Details: it is booked')).toEqual([0, 1, 1, 1]);

    // The same two characters INSIDE a token separate nothing - they have to
    // stay, or `ב-15:00` and `15:00` come apart and the gate loses the time.
    expect(clausesOf('מחר ב-15:00')).toEqual([0, 0]);
    expect(clausesOf('booked at 15:00 tomorrow')).toEqual([0, 0, 0, 0]);
  });

  it('is contiguous from zero even when the sentence opens with punctuation', () => {
    // The bullet shape a model answers in. A leading `-` must not create an empty
    // clause 0 with everything in clause 1: the interrogative rule reads the LAST
    // clause index, and an off-by-one there silences the wrong clause.
    expect(clausesOf('- nothing is booked yet')).toEqual([0, 0, 0, 0]);
    expect(readTokens('- nothing is booked yet')[0]?.clause).toBe(0);
  });

  it('does not break on a quotation mark, so a quoted identifier stays one clause', () => {
    expect(clausesOf('your reference is "CONF123456" for that')).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('reports the clause count on the sentence, per sentence', () => {
    const sentences = readSentences('Nothing yet. No need to worry, it is booked - honestly.');
    expect(sentences.map((sentence) => sentence.clauseCount)).toEqual([1, 3]);
  });

  it('holds no conjunction of any language, because those are lexicon data', () => {
    // `but` divides two clauses in English and this module must not know that:
    // `text.ts` is the half that is not a language. `ClaimLexicon.clauseBreakers`
    // is where the conjunctions live, and `claimGateDetector.test.ts` proves a
    // synthetic locale's own conjunction is honoured by the engine.
    expect(clausesOf('I cannot take payments but I have booked it')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
