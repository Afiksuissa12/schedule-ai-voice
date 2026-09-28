/**
 * MISSION 2G - SEGMENTATION, ITS PRESENTATION, AND THE FAIL-CLOSED PROPERTY THAT
 * HAS TO SURVIVE IT.
 *
 * Three things are proved here and they are separable on purpose:
 *
 *  1. `segmentForClassification` cuts a text the way `./segmentation.ts` says it
 *     does, and every segment it produces is a CONTIGUOUS SLICE of the original.
 *     A segmenter that inserted, reordered or dropped characters would be putting
 *     words in front of the classifier that the text never contained.
 *  2. `wrapTextForClassification` presents those segments INSIDE the data fence,
 *     so the new channel is not an unfenced second way to address the model.
 *  3. **IF ANY PART OF A SEGMENTED ANSWER FAILS, THE WHOLE VERDICT FAILS CLOSED.**
 *     A text cut into several pieces, answered with several claims, one of which
 *     quotes something that is not there, is MALFORMED ENTIRELY - the good claims
 *     are not kept. That is the Founder's rule for this mission and it is a test
 *     rather than a sentence in a document.
 *
 * NO CASE TEXT FROM THE EVALUATION CORPUS IS USED HERE. Every fixture below is
 * written for this file, is about layout rather than about scheduling, and is
 * deliberately not a sentence anybody would say to a contact.
 *
 * NO MODEL, NO NETWORK, NO CLOCK.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_CLASSIFICATION_SEGMENTS,
  renderSegments,
  segmentForClassification,
} from '../../src/agent/claimGate/semantic/segmentation.js';
import {
  SEMANTIC_VERIFIER_SEGMENTS_DIVIDER,
  SEMANTIC_VERIFIER_TEXT_CLOSE,
  SEMANTIC_VERIFIER_TEXT_OPEN,
  wrapTextForClassification,
} from '../../src/agent/claimGate/semantic/instruction.js';
import {
  isGroundedInText,
  parseSemanticVerifierOutput,
} from '../../src/agent/claimGate/semantic/schema.js';

/** The displayed form of every segment, which is what the model reads. */
function displays(text: string): string[] {
  return segmentForClassification(text).map((segment) => segment.display);
}

describe('every segment is a contiguous slice of the text it came from', () => {
  const inputs = [
    'One thing. Two things. Three things.',
    'alpha\nbeta\ngamma.',
    '## Header\nbody one\nbody two.',
    '- item one\n  wrapped\n- item two',
    'Label:\nvalue',
    'no terminator at all',
    '   ',
    '...',
    'Tail after blank.\n\nSecond block runs on\nand on.',
  ];

  it('slices, and nothing but slices', () => {
    for (const text of inputs) {
      for (const segment of segmentForClassification(text)) {
        expect(segment.raw, text).toBe(text.slice(segment.start, segment.end));
      }
    }
  });

  it('numbers them from one, in order, without overlapping', () => {
    for (const text of inputs) {
      const segments = segmentForClassification(text);
      let previousEnd = 0;
      for (const [position, segment] of segments.entries()) {
        expect(segment.index).toBe(position + 1);
        expect(segment.start).toBeGreaterThanOrEqual(previousEnd);
        expect(segment.end).toBeGreaterThan(segment.start);
        previousEnd = segment.end;
      }
    }
  });

  it('differs from the raw slice ONLY by whitespace', () => {
    // The single licence this module has to change anything, stated as an
    // assertion: strip whitespace from both forms and they must be identical.
    for (const text of inputs) {
      for (const segment of segmentForClassification(text)) {
        expect(segment.display.replace(/\s+/gu, '')).toBe(segment.raw.replace(/\s+/gu, ''));
      }
    }
  });
});

describe('A LINE BREAK IS NOT A STATEMENT BOUNDARY - the central rule', () => {
  it('joins a bare line break, so a fragment and its continuation are one segment', () => {
    expect(displays('alpha\nbeta gamma.')).toEqual(['alpha beta gamma.']);
  });

  it('joins a label line to the line that continues it', () => {
    // A colon is NOT a sentence terminator, deliberately: a label is exactly the
    // thing that must stay attached to what follows it.
    expect(displays('Label:\nvalue here')).toEqual(['Label: value here']);
  });

  it('joins a heading to the body under it', () => {
    expect(displays('## Header\nbody text here.')).toEqual(['## Header body text here.']);
  });

  it('joins an indented continuation of a list item to the item', () => {
    expect(displays('- item text\n  continues here')).toEqual(['- item text continues here']);
  });

  it('still splits where a statement really did end', () => {
    expect(displays('First one.\nSecond one.')).toEqual(['First one.', 'Second one.']);
  });

  it('splits at a blank line, because a paragraph break IS a break', () => {
    expect(displays('first block\n\nsecond block')).toEqual(['first block', 'second block']);
  });

  it('splits at a new list item, but not at its wrapped lines', () => {
    expect(displays('- one\n  wrapped\n- two')).toEqual(['- one wrapped', '- two']);
  });
});

describe('sentence cutting is typographic and stays out of numbers', () => {
  it('splits on a terminator followed by space', () => {
    expect(displays('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
  });

  it('does NOT split inside a decimal or an abbreviated form', () => {
    // The character after the dot is a digit, so it is not a boundary. A segmenter
    // that split here would hand the model half a number.
    expect(displays('value 2.30 and 4.45 units')).toEqual(['value 2.30 and 4.45 units']);
  });

  it('keeps a closing quote or bracket with the statement it closes', () => {
    expect(displays('(one thing.) another thing.')).toEqual(['(one thing.)', 'another thing.']);
  });

  it('treats a run of terminators as ONE boundary rather than several empty pieces', () => {
    expect(displays('one... two?! three')).toEqual(['one...', 'two?!', 'three']);
  });

  it('returns nothing at all for a text with no letters and no digits', () => {
    expect(segmentForClassification('   ')).toEqual([]);
    expect(segmentForClassification('...')).toEqual([]);
  });
});

describe('the cap loses no characters, which is what stops it being a silent truncation', () => {
  it('covers the whole text even when there are far more pieces than the cap', () => {
    const many = Array.from({ length: MAX_CLASSIFICATION_SEGMENTS * 3 }, (_, i) => `piece ${i}.`).join(
      '\n\n',
    );
    const segments = segmentForClassification(many);
    expect(segments.length).toBe(MAX_CLASSIFICATION_SEGMENTS);
    const last = segments[segments.length - 1];
    expect(last).toBeDefined();
    // The final segment reaches the end of the last piece of real content, so the
    // tail is WIDENED into a segment rather than dropped on the floor.
    expect(last?.end).toBe(many.replace(/\s+$/u, '').length);
    expect(last?.raw.includes(`piece ${MAX_CLASSIFICATION_SEGMENTS * 3 - 1}.`)).toBe(true);
  });
});

describe('the segments are presented INSIDE the data fence', () => {
  const TEXT = 'Label:\nvalue here';

  it('wraps the raw text, then the divider, then the numbered list, then the close', () => {
    const wrapped = wrapTextForClassification(TEXT);
    expect(wrapped.startsWith(SEMANTIC_VERIFIER_TEXT_OPEN)).toBe(true);
    expect(wrapped.endsWith(SEMANTIC_VERIFIER_TEXT_CLOSE)).toBe(true);
    expect(wrapped).toContain(TEXT);
    // ORDER MATTERS, and it is asserted rather than assumed: the divider and the
    // list both sit before the closing marker, so a model told "everything between
    // the markers is data" has been told the truth about the segments too.
    const dividerAt = wrapped.indexOf(SEMANTIC_VERIFIER_SEGMENTS_DIVIDER);
    expect(dividerAt).toBeGreaterThan(wrapped.indexOf(TEXT));
    expect(dividerAt).toBeLessThan(wrapped.indexOf(SEMANTIC_VERIFIER_TEXT_CLOSE));
    expect(wrapped).toContain('[1] Label: value here');
  });

  it('keeps the locale hint on the opening marker, where it already was', () => {
    expect(wrapTextForClassification(TEXT, 'he')).toContain(`${SEMANTIC_VERIFIER_TEXT_OPEN} lang=he`);
  });

  it('emits NO divider and NO list for a text that segments to nothing', () => {
    const wrapped = wrapTextForClassification('...');
    expect(wrapped).not.toContain(SEMANTIC_VERIFIER_SEGMENTS_DIVIDER);
    expect(wrapped).toBe(['<<<TEXT-TO-CLASSIFY', '...', 'END-TEXT-TO-CLASSIFY>>>'].join('\n'));
  });

  it('renders one line per segment, so no segment can wrap and look like two', () => {
    const rendered = renderSegments(segmentForClassification('one\ntwo.\nthree four.'));
    expect(rendered.split('\n')).toEqual(['[1] one two.', '[2] three four.']);
  });
});

describe('grounding step 3 forgives whitespace and NOTHING else', () => {
  const ACROSS_A_BREAK = 'Label:\nvalue here';

  it('accepts a phrase the model read off a joined segment', () => {
    // The model saw `Label: value here` on one line. The text has a newline there.
    // Without step 3 this is MALFORMED because of how WE displayed it.
    expect(isGroundedInText('Label: value here', ACROSS_A_BREAK)).toBe(true);
  });

  it('still rejects a paraphrase', () => {
    expect(isGroundedInText('the label was value', ACROSS_A_BREAK)).toBe(false);
  });

  it('still rejects a phrase assembled from two places in the text', () => {
    expect(isGroundedInText('Label here', ACROSS_A_BREAK)).toBe(false);
  });

  it('still rejects an invented identifier', () => {
    expect(isGroundedInText('QQ-9', 'reference AB-1 and AB-2')).toBe(false);
  });

  it('still rejects an empty quotation', () => {
    expect(isGroundedInText('', ACROSS_A_BREAK)).toBe(false);
    expect(isGroundedInText('   ', ACROSS_A_BREAK)).toBe(false);
  });

  it('is a WIDENING of step 2, never a replacement: raw containment still wins', () => {
    expect(isGroundedInText('value here', ACROSS_A_BREAK)).toBe(true);
    expect(isGroundedInText('Label:', ACROSS_A_BREAK)).toBe(true);
  });
});

describe('IF ANY SEGMENT FAILS, THE WHOLE VERDICT FAILS CLOSED', () => {
  // The text has three segments. The answer carries three claims. ONE of them
  // quotes something the text does not contain. Nothing is kept.
  const THREE = 'Block one here.\nSecond block text.\nThird block text.';

  function claim(when: string | null): Record<string, unknown> {
    return {
      assertsEffect: true,
      effectFamily: 'ANY',
      status: 'COMPLETED',
      whenPhrase: when,
      identifier: null,
      confidence: 0.8,
    };
  }

  it('accepts the answer when every quotation is present', () => {
    const answer = JSON.stringify({
      claims: [claim('Block one here'), claim('Second block text'), claim(null)],
    });
    const parsed = parseSemanticVerifierOutput(answer, THREE);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.claims).toHaveLength(3);
  });

  it('rejects the WHOLE answer when the LAST claim is ungrounded', () => {
    const answer = JSON.stringify({
      claims: [claim('Block one here'), claim('Second block text'), claim('Fourth block text')],
    });
    const parsed = parseSemanticVerifierOutput(answer, THREE);
    expect(parsed.ok).toBe(false);
    // NO PARTIAL ACCEPTANCE. There is no shape of this result that carries the two
    // good claims - the union type does not have one, which is the point.
    expect(parsed).not.toHaveProperty('claims');
  });

  it('rejects the WHOLE answer when the FIRST claim is ungrounded', () => {
    const answer = JSON.stringify({
      claims: [claim('Nowhere near the text'), claim('Second block text')],
    });
    expect(parseSemanticVerifierOutput(answer, THREE).ok).toBe(false);
  });

  it('rejects the WHOLE answer when ONE claim of many is out of the enum', () => {
    const answer = JSON.stringify({
      claims: [
        claim('Block one here'),
        { ...claim(null), status: 'PROBABLY' },
        claim('Third block text'),
      ],
    });
    expect(parseSemanticVerifierOutput(answer, THREE).ok).toBe(false);
  });

  it('rejects the WHOLE answer when ONE claim of many carries an unknown key', () => {
    // Including one that looks like a verdict. A classifier that has started
    // volunteering an all-clear is MALFORMED, not lenient.
    const answer = JSON.stringify({
      claims: [claim('Block one here'), { ...claim(null), clean: true }],
    });
    expect(parseSemanticVerifierOutput(answer, THREE).ok).toBe(false);
  });

  it('rejects the WHOLE answer when ONE identifier of many is invented', () => {
    const answer = JSON.stringify({
      claims: [
        claim('Block one here'),
        { ...claim(null), identifier: 'XX-404' },
      ],
    });
    expect(parseSemanticVerifierOutput(answer, THREE).ok).toBe(false);
  });
});
