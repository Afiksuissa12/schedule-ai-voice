/**
 * NDJSON line assembly for a streaming `/api/chat` body.
 *
 * WHY THIS IS NOT `body.split('\n')`
 * ---------------------------------------------------------------------------
 * A network read boundary has nothing to do with a line boundary. A 41-line
 * response arrives in however many TCP segments the kernel felt like, and the
 * last line of a read is routinely half a JSON object. Splitting each read
 * independently produces intermittent parse failures that look exactly like a
 * flaky model, at a rate that depends on message length - the worst class of
 * bug to find later.
 *
 * So this holds a remainder across reads and only ever emits complete lines.
 * It is a pure class with no I/O, which lets the mapping self-check feed it
 * deliberately nasty splits of a REAL recorded response and prove that where
 * the boundaries fall changes nothing.
 */

export class NdjsonLineAssembler {
  private remainder = '';

  /** Complete lines contained in this read. Blank lines are skipped. */
  push(text: string): string[] {
    this.remainder += text;
    const parts = this.remainder.split('\n');
    // The tail is whatever came after the last newline: possibly a partial line.
    this.remainder = parts.pop() ?? '';
    return parts.map((line) => line.trim()).filter((line) => line.length > 0);
  }

  /**
   * Whatever is left once the body ends.
   *
   * Ollama terminates its final line with a newline, so this is normally empty
   * - but a server that does not is a difference in framing, not a difference
   * in content, and dropping the last chunk would silently lose every metric
   * on the turn.
   */
  flush(): string[] {
    const tail = this.remainder.trim();
    this.remainder = '';
    return tail.length > 0 ? [tail] : [];
  }
}
