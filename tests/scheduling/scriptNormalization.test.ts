/**
 * Hebrew script normalisation, on its own.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------------------------------------------------------
 * `normalizeScript` runs before any grammar and rewrites the input. That makes
 * it the step most able to break something silently, and the thing it could
 * break is the one language that already worked. So it gets its own unit,
 * including an explicit proof that it is the IDENTITY on English - not "seems
 * fine in a couple of cases", but byte equality across every English
 * expression this suite and the invariant sweep actually use.
 *
 * The characters under test are invisible, so each one is written as a
 * `String.fromCodePoint` with its Unicode name next to it. A test that pasted
 * a zero-width joiner into a string literal would be untrustworthy: nobody
 * reviewing it could tell what was there.
 */
import { describe, expect, it } from 'vitest';

import { normalizeScript } from '../../src/scheduling/lexicon/script.js';

const cp = (codePoint: number): string => String.fromCodePoint(codePoint);

/** U+05B8 QAMATS, U+05B7 PATAH - two of the niqqud marks. */
const QAMATS = cp(0x05b8);
const PATAH = cp(0x05b7);
/** U+05BE HEBREW PUNCTUATION MAQAF. */
const MAQAF = cp(0x05be);
/** U+05F3 GERESH, U+05F4 GERSHAYIM. */
const GERESH = cp(0x05f3);
const GERSHAYIM = cp(0x05f4);
/** U+200F RIGHT-TO-LEFT MARK, U+200E LEFT-TO-RIGHT MARK, U+2066 LRI, U+2069 PDI. */
const RLM = cp(0x200f);
const LRM = cp(0x200e);
const LRI = cp(0x2066);
const PDI = cp(0x2069);
/** U+200B ZERO WIDTH SPACE, U+200D ZERO WIDTH JOINER, U+FEFF BOM. */
const ZWSP = cp(0x200b);
const ZWJ = cp(0x200d);
const BOM = cp(0xfeff);

describe('normalizeScript - niqqud', () => {
  it('strips vowel points so a pointed word equals its unpointed spelling', () => {
    // מָחָר -> מחר. Same word, two spellings, one token.
    const pointed = `מ${QAMATS}ח${QAMATS}ר`;
    const result = normalizeScript(pointed);

    expect(result.text).toBe('מחר');
    expect(result.applied).toContain('strip_hebrew_marks');
  });

  it('strips points from inside a whole phrase without touching the digits', () => {
    const result = normalizeScript(`מ${QAMATS}ח${QAMATS}ר ב${PATAH}-15:00`);
    expect(result.text).toBe('מחר ב-15:00');
  });
});

describe('normalizeScript - Hebrew punctuation', () => {
  it('maps the maqaf onto a hyphen, which is the other way the same phrase is written', () => {
    const result = normalizeScript(`מחר ב${MAQAF}15:00`);

    expect(result.text).toBe('מחר ב-15:00');
    expect(result.applied).toContain('maqaf_to_hyphen');
  });

  it('maps geresh and gershayim onto their ASCII counterparts', () => {
    expect(normalizeScript(`אחה${GERSHAYIM}צ`).text).toBe('אחה"צ');
    expect(normalizeScript(`צ${GERESH}`).text).toBe("צ'");
  });

  it('does NOT delete the maqaf as part of the niqqud sweep', () => {
    // U+05BE sits inside the same Unicode block as the points. A range that
    // swept the whole block would silently destroy `ב־15:00`.
    expect(normalizeScript(MAQAF).text).toBe('-');
    expect(normalizeScript(MAQAF).applied).not.toContain('strip_hebrew_marks');
  });
});

describe('normalizeScript - invisible characters', () => {
  it('removes bidi control marks that a right-to-left editor inserts', () => {
    const result = normalizeScript(`${RLM}מחר${LRM} ${LRI}ב-15:00${PDI}`);

    expect(result.text).toBe('מחר ב-15:00');
    expect(result.applied).toContain('strip_bidi_controls');
  });

  it('removes zero-width marks, including a byte-order mark at the front', () => {
    const result = normalizeScript(`${BOM}מ${ZWSP}חר${ZWJ} ב-15:00`);

    expect(result.text).toBe('מחר ב-15:00');
    expect(result.applied).toContain('strip_zero_width');
  });

  it('reports nothing applied when there was nothing to do', () => {
    expect(normalizeScript('מחר ב-15:00').applied).toEqual([]);
  });
});

describe('normalizeScript - it must not change English', () => {
  /**
   * Every English expression the deterministic suite and the invariant sweep
   * put through the resolver. A normalisation that altered any of these would
   * be a regression in the language that already worked.
   */
  const ENGLISH_EXPRESSIONS = [
    'today at 3pm',
    'tomorrow at 3pm',
    'the day after tomorrow at 3pm',
    'day after tomorrow at 10am',
    'thursday at 11am',
    'on friday at 11am',
    'tuesday at 11am',
    'wednesday at 11am',
    'next thursday at 11am',
    'next tuesday at 2pm',
    'thu at 11am',
    'thurs at 11am',
    'end of the week at 2pm',
    'end of week at 2pm',
    '2026-04-17 at 2pm',
    'tomorrow morning',
    'tomorrow afternoon',
    'tomorrow evening',
    'call me back tomorrow afternoon at 3',
    'tomorrow morning at 9',
    'tomorrow evening at 7',
    'next tuesday morning at 11',
    'tonight at 8',
    'tonight',
    'tomorrow at 12pm',
    'tomorrow at 12am',
    'tomorrow at 12:30pm',
    'tomorrow at 15:30',
    'tomorrow 16:45',
    'noon tomorrow',
    'tomorrow at midnight',
    'tomorrow at 3 p.m.',
    "tomorrow afternoon at 3 o'clock",
    'at 9am',
    'in 30 minutes',
    'in 2 hours',
    'in an hour',
    'half an hour',
    'in a couple of hours',
    'in a few hours',
    'in 3 days',
    'in 2 days at 2pm',
    'in 5 minutes',
    'in 40 minutes',
    'in 3 hours',
    'tomorrow at 3',
    'tomorrow morning at 3pm',
    'tomorrow evening at 9am',
    'tomorrow in two hours',
    'call me back sometime tomorrow',
    'give me a ring later',
    'call me soon',
    'whenever suits you',
    'call me back asap',
    'call me back whenever',
    'next week',
    'some time next month',
    'in the new year',
    'end of the week',
    'next tuesday',
    'tomorrow at 3pm on the 15th',
    'that sounds good',
    'qqzzx wibble flurm',
    'sometime next week',
    'asap',
    'tomorrow at 2pm',
    'tomorrow at 10am',
    'tomorrow at 6am',
    'tomorrow at 11pm',
    'today at 11:30pm',
    'tomorrow at 11am',
    'tomorrow morning at 10',
    'tomorrow afternoon at 1',
    'Friday at 11am',
    '  ToMorrow AfTernoon at 3  ',
  ];

  it.each(ENGLISH_EXPRESSIONS)('leaves %j byte-for-byte unchanged', (expression) => {
    const result = normalizeScript(expression);
    expect(result.text).toBe(expression);
    expect(result.applied).toEqual([]);
  });

  it('does not lower-case, because case folding is a grammar step not a script step', () => {
    // Keeping it out of this function is what makes the identity claim above
    // exact rather than approximate.
    expect(normalizeScript('ToMorrow AfTernoon').text).toBe('ToMorrow AfTernoon');
  });
});
