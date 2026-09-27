/**
 * Script normalisation - the step BEFORE any grammar runs.
 *
 * WHY IT IS ITS OWN MODULE AND ITS OWN TEST
 * ---------------------------------------------------------------------------
 * Hebrew text arrives from a phone, a CRM, a browser or a model, and the same
 * three words can be spelled with vowel points or without, with a maqaf or a
 * hyphen, and wrapped in invisible bidi control characters that a right-to-left
 * editor inserts without telling anybody. A grammar that matches on whole
 * tokens has to see one spelling, not five.
 *
 * It is separated from the grammar because it is the step most likely to break
 * something silently. A normalisation that quietly changed English input would
 * be a regression in the one language that already worked, so this function is
 * exported, documented, and tested on its own - including a test asserting it
 * is the IDENTITY on every English expression the suite uses.
 *
 * EVERY CHARACTER IS WRITTEN AS A NUMBER, ON PURPOSE
 * ---------------------------------------------------------------------------
 * The characters this file removes are INVISIBLE. Written literally into a
 * regex they would be unreviewable: nobody can tell a zero-width joiner from a
 * left-to-right mark by looking, and no reviewer can confirm by eye that a
 * range excludes the one code point that has to survive. So the rules are a
 * table of numeric code-point ranges, each named, and the substitution is a
 * single pass over the input's code points.
 *
 * WHAT IT DOES
 * ---------------------------------------------------------------------------
 *  1. Unicode NFC. Composes decomposed sequences so two visually identical
 *     strings compare equal. Identity on ASCII.
 *  2. Removes bidi controls and zero-width characters. They are invisible,
 *     carry no meaning for a scheduler, and would otherwise sit inside a token
 *     and stop it matching.
 *  3. Removes Hebrew points and cantillation marks - niqqud.
 *  4. Maps Hebrew punctuation onto its ASCII counterpart: maqaf to hyphen,
 *     geresh to apostrophe, gershayim to double quote, and paseq / sof pasuq /
 *     nun hafukha to a space.
 *  5. Maps curly quotes and the modifier apostrophe onto a straight
 *     apostrophe, so `o’clock` and `o'clock` become one token.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 *  - It does not lower-case. Case folding is a GRAMMAR step, not a script step,
 *    and keeping it out is what lets the identity-on-English test be exact.
 *  - It does not convert Arabic-Indic or Devanagari digits. No registered
 *    locale needs it, and inventing a digit rule nobody has tested would be
 *    guessing. A phrase carrying such digits therefore fails closed - it
 *    refuses, naming the leftover - which is the correct outcome for a form
 *    this scheduler has never been shown.
 *  - It does not strip Hebrew final-letter forms or otherwise "correct"
 *    spelling. Normalisation may not change which word was said.
 */

/** An inclusive code-point range. */
type CodePointRange = readonly [number, number];

interface ScriptRule {
  /** Recorded in the provenance when this rule actually changed something. */
  readonly step: string;
  /** What the matched code point becomes. `''` deletes it. */
  readonly replacement: string;
  readonly ranges: readonly CodePointRange[];
}

/**
 * THE TABLE. Order is the order the step names are reported in.
 *
 * Note what is NOT in `strip_hebrew_marks`: U+05BE MAQAF, U+05C0 PASEQ,
 * U+05C3 SOF PASUQ and U+05C6 NUN HAFUKHA all live inside the same Unicode
 * block as the points but are punctuation, not marks, and are mapped rather
 * than deleted. Sweeping U+0591..U+05C7 in one range would have silently
 * deleted the maqaf that `ב־15:00` depends on.
 */
const SCRIPT_RULES: readonly ScriptRule[] = [
  {
    // U+061C ARABIC LETTER MARK, U+200E LEFT-TO-RIGHT MARK,
    // U+200F RIGHT-TO-LEFT MARK, U+202A..U+202E the embedding/override block,
    // U+2066..U+2069 the isolate block.
    step: 'strip_bidi_controls',
    replacement: '',
    ranges: [
      [0x061c, 0x061c],
      [0x200e, 0x200f],
      [0x202a, 0x202e],
      [0x2066, 0x2069],
    ],
  },
  {
    // U+200B ZERO WIDTH SPACE, U+200C ZERO WIDTH NON-JOINER,
    // U+200D ZERO WIDTH JOINER, U+FEFF ZERO WIDTH NO-BREAK SPACE (BOM).
    step: 'strip_zero_width',
    replacement: '',
    ranges: [
      [0x200b, 0x200d],
      [0xfeff, 0xfeff],
    ],
  },
  {
    // U+0591..U+05BD accents and points, U+05BF RAFE, U+05C1/U+05C2 shin and
    // sin dots, U+05C4/U+05C5 upper and lower marks, U+05C7 QAMATS QATAN.
    step: 'strip_hebrew_marks',
    replacement: '',
    ranges: [
      [0x0591, 0x05bd],
      [0x05bf, 0x05bf],
      [0x05c1, 0x05c2],
      [0x05c4, 0x05c5],
      [0x05c7, 0x05c7],
    ],
  },
  {
    // U+05BE HEBREW PUNCTUATION MAQAF - a hyphen in every way that matters here.
    step: 'maqaf_to_hyphen',
    replacement: '-',
    ranges: [[0x05be, 0x05be]],
  },
  {
    // U+05F3 HEBREW PUNCTUATION GERESH.
    step: 'geresh_to_apostrophe',
    replacement: "'",
    ranges: [[0x05f3, 0x05f3]],
  },
  {
    // U+05F4 HEBREW PUNCTUATION GERSHAYIM.
    step: 'gershayim_to_quote',
    replacement: '"',
    ranges: [[0x05f4, 0x05f4]],
  },
  {
    // U+05C0 PASEQ, U+05C3 SOF PASUQ, U+05C6 NUN HAFUKHA.
    step: 'hebrew_stops_to_space',
    replacement: ' ',
    ranges: [
      [0x05c0, 0x05c0],
      [0x05c3, 0x05c3],
      [0x05c6, 0x05c6],
    ],
  },
  {
    // U+02BC MODIFIER LETTER APOSTROPHE, U+2018/U+2019 curly single quotes.
    step: 'curly_apostrophes_to_ascii',
    replacement: "'",
    ranges: [
      [0x02bc, 0x02bc],
      [0x2018, 0x2019],
    ],
  },
];

/** The normalised text plus the names of the steps that actually changed it. */
export interface ScriptNormalizationResult {
  readonly text: string;
  /** Steps that changed the input, in table order. Empty when nothing applied. */
  readonly applied: readonly string[];
}

/** Every step name this module can report, for tests and documentation. */
export const SCRIPT_NORMALIZATION_STEPS: readonly string[] = [
  'unicode_nfc',
  ...SCRIPT_RULES.map((rule) => rule.step),
];

function ruleFor(codePoint: number): ScriptRule | undefined {
  return SCRIPT_RULES.find((rule) =>
    rule.ranges.some(([low, high]) => codePoint >= low && codePoint <= high),
  );
}

/**
 * Normalise script-level spelling without changing which words were said.
 *
 * Returns the normalised text plus the names of the steps that actually fired,
 * so a receipt can say "the niqqud was stripped" instead of leaving a reader to
 * diff two strings by eye.
 */
export function normalizeScript(raw: string): ScriptNormalizationResult {
  const composed = raw.normalize('NFC');
  const fired = new Set<string>();
  if (composed !== raw) fired.add('unicode_nfc');

  let text = '';
  for (const character of composed) {
    const codePoint = character.codePointAt(0);
    const rule = codePoint === undefined ? undefined : ruleFor(codePoint);
    if (rule === undefined) {
      text += character;
      continue;
    }
    fired.add(rule.step);
    text += rule.replacement;
  }

  return { text, applied: SCRIPT_NORMALIZATION_STEPS.filter((step) => fired.has(step)) };
}
