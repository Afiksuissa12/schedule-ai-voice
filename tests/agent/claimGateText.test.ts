/**
 * The claim gate's text engine: sentences and tokens.
 *
 * These are the three properties everything else in the gate rests on. If SENTENCE
 * scope is wrong, a negation in one sentence silences a false claim in the next -
 * which is EXACTLY the shape of the real `aya-expanse:8b` defect. If CLAUSE scope is
 * wrong, a negation in a leading reassurance silences a false claim after the comma -
 * which is the same defect one punctuation mark narrower, and it was reachable,
 * released and persisted (`docs/MISSION_2D_CLAIM_GATE.md` § 15). If tokenisation is
 * wrong for one script, that language has no gate at all.
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
