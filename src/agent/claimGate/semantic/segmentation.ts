/**
 * SEGMENTATION FOR CLASSIFICATION - how a proposed text is PRESENTED to the
 * verifier, and nothing else.
 *
 * WHAT THIS MODULE IS, AND THE FOUR THINGS IT IS NOT
 * ---------------------------------------------------------------------------
 * It cuts one text into numbered pieces so the model is asked its question about
 * each piece rather than about a wall of characters. That is the whole job.
 *
 *  - IT IS NOT A DETECTOR. It contains no vocabulary, no lexicon, no needle and
 *    no notion of what a claim is. Every rule below is typographic: where a
 *    sentence ends, where a list item starts, where a paragraph breaks. Swap the
 *    subject matter of this product entirely and this file would still be
 *    correct.
 *  - IT IS NOT A SECOND READER. Nothing here produces a verdict, and no caller
 *    can read one out of it. `ClaimGate` never sees a segment; only the wrapped
 *    user message does.
 *  - IT IS NOT A PARSER OF DAYS OR TIMES. `src/agent/claimGate/text.ts` and the
 *    scheduling resolver own that vocabulary and a second reader of it is the
 *    `docs/MISSION_2D_CLAIM_GATE.md` § 20 defect waiting to happen twice.
 *  - IT IS NOT A SECOND PROVIDER CALL. The segments travel inside the SAME one
 *    request the verifier already made. `docs/MISSION_2G_VERIFIER_ROUND.md` § 7
 *    prices the alternative: one round trip per segment would multiply a p95 of
 *    about a second by the number of pieces, on every text a contact ever hears.
 *
 * WHY IT EXISTS - THE LAYOUT PROBLEM, STATED WITHOUT AN EXAMPLE
 * ---------------------------------------------------------------------------
 * A generated reply is not always one clean sentence per line. A label, a
 * heading, a bullet or an opening fragment can sit on its own line with the rest
 * of the statement on the next, so that NO SINGLE LINE reads as an assertion
 * while the two lines together plainly do. A reader that takes a line break for a
 * statement boundary sees two harmless fragments. That is a presentation defect
 * and it is fixed here, by presentation, rather than by teaching a classifier a
 * list of layouts.
 *
 * SO THE CENTRAL RULE IS ONE SENTENCE: **A LINE BREAK IS NOT A STATEMENT
 * BOUNDARY.** Lines are joined until something that really does end a statement
 * is found - a sentence terminator, a blank line, or the start of a new list item
 * or heading. Everything else in this module is the detail of that rule.
 *
 * EVERY SEGMENT IS A CONTIGUOUS SLICE OF THE ORIGINAL TEXT, and that is a
 * property rather than an aspiration: `raw` is `text.slice(start, end)` and
 * `tests/agent/semanticSegmentation.test.ts` asserts it for every segment of
 * every case it builds. Nothing is inserted, reordered, translated, stemmed or
 * dropped. The one difference between `raw` and `display` is that runs of
 * whitespace - including the joined line breaks - are written as single spaces,
 * which is what makes a joined label and its continuation read as one line to the
 * model.
 *
 * THAT ONE DIFFERENCE IS WHY `isGroundedInText` IN `./schema.ts` GAINED A
 * WHITESPACE-TOLERANT THIRD STEP. A model quoting a phrase out of a segment is
 * quoting the `display` form, so a phrase that spans a joined line break would
 * otherwise be rejected as ungrounded - a MALFORMED verdict manufactured by this
 * module's own presentation. The tolerance forgives whitespace and nothing else;
 * a paraphrase still fails.
 *
 * DETERMINISTIC IN THE STRONG SENSE: pure, no clock, no randomness, no I/O, and
 * the same input produces the same segments in every process.
 */

/**
 * The most segments that will ever be presented.
 *
 * NOT A SILENT CAP, and the difference matters: when a text would produce more
 * than this, the last segment is widened to cover ALL the remaining text rather
 * than the remainder being dropped. So every character of the input is inside
 * some segment on every path, which `tests/agent/semanticSegmentation.test.ts`
 * asserts over a pathological input. The bound exists because a prompt is a
 * budget: a reply with hundreds of line breaks would otherwise be presented
 * twice, once whole and once in hundreds of numbered pieces, and the second copy
 * would crowd out the first.
 *
 * FORTY, and the number is argued rather than picked: a customer-facing reply on
 * this product's critical path is one to four sentences, and this milestone's
 * whole evaluation corpus has no text with more than five. Forty is an order of
 * magnitude above the observed shape, which makes tripping it a sign of a
 * malformed generation rather than a normal long reply.
 */
export const MAX_CLASSIFICATION_SEGMENTS = 40;

/** One piece of the text, as presented to the model. */
export interface ClassificationSegment {
  /** 1-based, and it is what the numbered list shows. */
  readonly index: number;
  /** Inclusive offset into the ORIGINAL text. */
  readonly start: number;
  /** Exclusive offset into the ORIGINAL text. */
  readonly end: number;
  /** `text.slice(start, end)`, byte for byte. Never rebuilt. */
  readonly raw: string;
  /** `raw` with runs of whitespace written as single spaces, trimmed. What the model reads. */
  readonly display: string;
}

/**
 * Characters that can end a statement.
 *
 * Deliberately SMALL. A larger set would start splitting inside abbreviations and
 * decimal numbers, and a split in the wrong place hides half a statement from the
 * model - the exact failure this module exists to remove. The colon is NOT here:
 * a colon is what a label ends with, and a label has to stay attached to what
 * follows it.
 */
const SENTENCE_TERMINATORS = new Set(['.', '!', '?', '…', '‼', '⁇', '⁈', '⁉']);

/**
 * Characters allowed to sit between a terminator and the whitespace after it.
 *
 * A statement that ends inside a quotation, a bracket or a run of emphasis marks
 * still ends there, and treating the closer as ordinary text would push the
 * boundary past it and glue two statements together.
 */
const CLOSING_MARKS = new Set([
  '"',
  "'",
  ')',
  ']',
  '}',
  '*',
  '_',
  '`',
  '»',
  '”',
  '’',
  '›',
]);

/** A line that opens a new list item: a bullet glyph, or a number with a dot or bracket. */
const LIST_ITEM_START = /^[ \t]*(?:[-*+•·–—]\s|\d{1,3}[.)]\s)/u;

/** A line that opens a markdown-style heading. */
const HEADING_START = /^[ \t]*#{1,6}\s/u;

/** Does this line, ignoring trailing whitespace, end a statement? */
function endsStatement(line: string): boolean {
  const trimmed = line.replace(/\s+$/u, '');
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    const character = trimmed[i] as string;
    if (CLOSING_MARKS.has(character)) continue;
    return SENTENCE_TERMINATORS.has(character);
  }
  return false;
}

interface Range {
  start: number;
  end: number;
}

/**
 * Group the physical lines into blocks, applying the central rule.
 *
 * A new block starts at a blank line, at a list item, at a heading, and after a
 * line that ended a statement. NOWHERE ELSE - which is to say, a bare line break
 * joins.
 */
function blocksOf(text: string): Range[] {
  const blocks: Range[] = [];
  let current: Range | null = null;
  let previousEndedStatement = false;

  let offset = 0;
  while (offset <= text.length) {
    const newline = text.indexOf('\n', offset);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(offset, lineEnd);

    if (line.trim().length === 0) {
      // A blank line closes the block. The next non-blank line starts a new one,
      // which is the one place a break between lines really is a break between
      // statements.
      current = null;
    } else {
      const opensBlock = LIST_ITEM_START.test(line) || HEADING_START.test(line);
      if (current === null || previousEndedStatement || opensBlock) {
        current = { start: offset, end: lineEnd };
        blocks.push(current);
      } else {
        current.end = lineEnd;
      }
      previousEndedStatement = endsStatement(line);
    }

    if (newline === -1) break;
    offset = newline + 1;
  }

  return blocks;
}

/**
 * Cut one block at its sentence boundaries.
 *
 * A boundary is a terminator, plus any closing marks, followed by whitespace or
 * the end of the block. Requiring the whitespace is what keeps a decimal number
 * and an abbreviation in one piece: the character after the dot is a digit or a
 * letter, so it is not a boundary.
 */
function sentencesOf(text: string, block: Range): Range[] {
  const out: Range[] = [];
  let start = block.start;

  for (let i = block.start; i < block.end; i += 1) {
    if (!SENTENCE_TERMINATORS.has(text[i] as string)) continue;

    let after = i + 1;
    while (after < block.end && CLOSING_MARKS.has(text[after] as string)) after += 1;
    // Repeated terminators - a run of dots, a question mark after an exclamation -
    // are one boundary rather than several empty pieces.
    while (after < block.end && SENTENCE_TERMINATORS.has(text[after] as string)) after += 1;
    while (after < block.end && CLOSING_MARKS.has(text[after] as string)) after += 1;

    const atEnd = after >= block.end;
    const followedBySpace = !atEnd && /\s/u.test(text[after] as string);
    if (!atEnd && !followedBySpace) {
      i = after - 1;
      continue;
    }

    out.push({ start, end: after });
    start = after;
    i = after - 1;
  }

  if (start < block.end) out.push({ start, end: block.end });
  return out;
}

/** Collapse every run of whitespace to one space. The ONLY difference from `raw`. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/** Does this piece carry anything a classifier could read? Any letter or digit, in any script. */
function hasContent(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

/**
 * Cut `text` into the pieces the verifier is shown.
 *
 * Returns an EMPTY list for a text with no letters and no digits in it. That is
 * not a failure: `LlmSemanticClaimVerifier` already answers `EMPTY` for a blank
 * proposal before it calls anything, and a text of pure punctuation is presented
 * whole with no numbered list, which is what the wrapper does when this returns
 * nothing.
 */
export function segmentForClassification(text: string): readonly ClassificationSegment[] {
  const ranges: Range[] = [];
  for (const block of blocksOf(text)) {
    for (const sentence of sentencesOf(text, block)) {
      if (hasContent(text.slice(sentence.start, sentence.end))) ranges.push(sentence);
    }
  }

  if (ranges.length === 0) return [];

  // THE CAP, APPLIED WITHOUT LOSING A CHARACTER. The last segment kept is widened
  // to the end of the last range rather than the tail being discarded.
  const kept = ranges.slice(0, MAX_CLASSIFICATION_SEGMENTS);
  const last = kept[kept.length - 1] as Range;
  const finalRange = ranges[ranges.length - 1] as Range;
  if (ranges.length > MAX_CLASSIFICATION_SEGMENTS) last.end = finalRange.end;

  return kept.map((range, position) => {
    const raw = text.slice(range.start, range.end);
    return {
      index: position + 1,
      start: range.start,
      end: range.end,
      raw,
      display: collapseWhitespace(raw),
    };
  });
}

/** The prefix each numbered segment is shown behind. Named so a test can pin the format. */
export const SEGMENT_MARKER_OPEN = '[';
export const SEGMENT_MARKER_CLOSE = ']';

/**
 * Render the numbered list.
 *
 * One line per segment, always, because a segment that wrapped onto a second line
 * would reintroduce exactly the ambiguity this module exists to remove.
 */
export function renderSegments(segments: readonly ClassificationSegment[]): string {
  return segments
    .map((segment) => `${SEGMENT_MARKER_OPEN}${segment.index}${SEGMENT_MARKER_CLOSE} ${segment.display}`)
    .join('\n');
}
