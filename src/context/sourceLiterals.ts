/**
 * A very small TypeScript lexer, for one job: find the string literals in a
 * source file and say where each one sits.
 *
 * WHY NOT A REAL PARSER
 * ---------------------------------------------------------------------------
 * `typescript` is a devDependency and its compiler API would give a real AST.
 * It is not used here for one reason: `tests/invariants/vendorBoundary.test.ts`
 * asserts that no file under `src/agent`, `src/conversation` or `src/context`
 * imports anything outside a short allowlist, and the point of the check this
 * lexer serves is that it runs on exactly those directories. A checker that had
 * to be exempted from the invariant it polices would be a poor advertisement
 * for it.
 *
 * WHY NOT A PLAIN REGEX
 * ---------------------------------------------------------------------------
 * Because a regex cannot tell a string from a comment that contains a quote,
 * or from a regex literal that contains one, and both appear in this codebase
 * on the same lines as the rules being enforced. A scanner that reported a
 * doc-comment example as a violation would be turned off within a week.
 *
 * WHAT IT GETS RIGHT, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * Right: single quotes, double quotes, template literals, escape sequences,
 * line and block comments, and the common regex-literal positions. Brace and
 * bracket depth, which is what lets a caller tell "two utterances in the same
 * object literal" from "two utterances in two different functions".
 *
 * Not right: `${}` interpolation is treated as part of the template's text
 * rather than as nested code, so a literal inside an interpolation is missed.
 * That is a known, bounded gap and it is written down in
 * `CONVERSATION_CONTEXT.md` rather than left for somebody to discover.
 */

export interface SourceLiteral {
  /** The literal's content, with the quotes removed and escapes left as written. */
  readonly value: string;
  /** Offset of the opening quote. */
  readonly start: number;
  /** Offset just past the closing quote. */
  readonly end: number;
  /** 1-based line of the opening quote. */
  readonly line: number;
  /** `'`, `"` or a backtick. */
  readonly quote: string;
  /** Offset of the `{` that encloses it, or -1 at top level. */
  readonly enclosingBrace: number;
  /** Offset of the `[` that encloses it, or -1 when not inside an array literal. */
  readonly enclosingBracket: number;
}

export interface ScannedSource {
  /** The source with every comment replaced by spaces, offsets preserved. */
  readonly withoutComments: string;
  readonly literals: readonly SourceLiteral[];
  /** 1-based line number for any offset. */
  lineAt(offset: number): number;
}

const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '\n', '+', '*', 'return']);

export function scanSource(source: string): ScannedSource {
  const blanked = source.split('');
  const literals: SourceLiteral[] = [];
  const braces: number[] = [];
  const brackets: number[] = [];

  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? '';
    const next = source[index + 1] ?? '';

    // ---- comments --------------------------------------------------------
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        blanked[index] = ' ';
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] !== '\n') blanked[index] = ' ';
        index += 1;
      }
      blanked[index] = ' ';
      blanked[index + 1] = ' ';
      index += 2;
      continue;
    }

    // ---- regex literals --------------------------------------------------
    if (char === '/' && isRegexPosition(source, index)) {
      index += 1;
      let inClass = false;
      while (index < source.length) {
        const current = source[index];
        if (current === '\\') {
          index += 2;
          continue;
        }
        if (current === '[') inClass = true;
        else if (current === ']') inClass = false;
        else if (current === '/' && !inClass) break;
        else if (current === '\n') break; // not a regex after all; bail safely
        index += 1;
      }
      index += 1;
      continue;
    }

    // ---- strings ---------------------------------------------------------
    if (char === "'" || char === '"' || char === '`') {
      const start = index;
      const quote = char;
      index += 1;
      let value = '';
      while (index < source.length) {
        const current = source[index] ?? '';
        if (current === '\\') {
          value += source[index + 1] ?? '';
          index += 2;
          continue;
        }
        if (current === quote) break;
        // An unterminated single- or double-quoted string cannot span a line.
        if (current === '\n' && quote !== '`') break;
        value += current;
        index += 1;
      }
      index += 1;
      literals.push({
        value,
        start,
        end: index,
        line: lineOf(source, start),
        quote,
        enclosingBrace: braces[braces.length - 1] ?? -1,
        enclosingBracket: brackets[brackets.length - 1] ?? -1,
      });
      continue;
    }

    // ---- structure -------------------------------------------------------
    if (char === '{') braces.push(index);
    else if (char === '}') braces.pop();
    else if (char === '[') brackets.push(index);
    else if (char === ']') brackets.pop();

    index += 1;
  }

  const withoutComments = blanked.join('');
  return {
    withoutComments,
    literals,
    lineAt: (offset: number) => lineOf(source, offset),
  };
}

// ---------------------------------------------------------------------------

function isRegexPosition(source: string, index: number): boolean {
  for (let back = index - 1; back >= 0; back -= 1) {
    const char = source[back] ?? '';
    if (char === ' ' || char === '\t') continue;
    if (char === '\n') return true;
    if (REGEX_PRECEDERS.has(char)) return true;
    // `return /.../` and `case /.../` - look at the preceding word.
    const word = /(\w+)$/.exec(source.slice(Math.max(0, back - 12), back + 1));
    return word ? REGEX_PRECEDERS.has(word[1] ?? '') : false;
  }
  return true;
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === '\n') line += 1;
  }
  return line;
}
