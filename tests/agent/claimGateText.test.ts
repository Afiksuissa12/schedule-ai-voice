/**
 * The claim gate's text engine: sentences and tokens.
 *
 * These are the two properties everything else in the gate rests on. If
 * sentence scope is wrong, a negation in one sentence silences a false claim in
 * the next - which is EXACTLY the shape of the real `aya-expanse:8b` defect. If
 * tokenisation is wrong for one script, that language has no gate at all.
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
