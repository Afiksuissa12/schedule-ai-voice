/**
 * Did the agent's words come out of a model, or out of this repository?
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `docs/BASELINE_V1.md` § 4 is a Founder directive: production and demo
 * customer-facing conversation must be dynamically generated, never selected
 * from prewritten wording. `npm run check:anti-scripting` enforces the STATIC
 * half of that - it proves the source tree contains no canned reply table, no
 * dialogue branch that returns an utterance, no fixed question sequence.
 *
 * This is the other half, and it needs real model output to run at all: given
 * what a live model actually said to a contact, did any of it come from a
 * sentence already written down here? The static check proves the shapes are
 * absent. This proves the specific words a customer heard were not recited.
 *
 * THE METHOD
 * ---------------------------------------------------------------------------
 * Every string literal under `src/` is collected with the same lexer the
 * anti-scripting check uses, and split in two by the same `isUtteranceShaped`
 * predicate:
 *
 *  - PRESCRIBED SPEECH - literals that read like something said to a person.
 *    An overlap with one of these is a violation. This is the thing the
 *    directive forbids.
 *  - EVERYTHING ELSE - guardrail prose, business facts, error messages, field
 *    names. An overlap here is expected and is NOT a violation: the business
 *    profile exists precisely so the model can state a price correctly, and a
 *    model that quotes "$119 per technician per month" is doing its job. Those
 *    overlaps are reported rather than hidden, so a reader can see what was
 *    quoted and judge it.
 *
 * Overlap is measured in consecutive words rather than whole strings, because a
 * model that lifted a prewritten sentence and changed its last three words has
 * still recited it.
 *
 * WHAT THIS CANNOT PROVE - read before quoting it as a guarantee
 * ---------------------------------------------------------------------------
 *  1. It cannot prove the words are GOOD, only that they are not ours. Judging
 *     quality is the evaluation harness's job.
 *  2. It only sees `src/`. Wording loaded from the database, fetched at runtime,
 *     or assembled from `${}` interpolation is invisible to it - the same
 *     bounded gap `CONVERSATION_CONTEXT.md` § 7 records for the static check,
 *     for the same reason (the lexer does not descend into interpolation).
 *  3. A model reproducing a prewritten sentence *from its own training data*
 *     would pass. Nothing in this repository can detect that.
 *  4. Passing on one conversation says nothing about the next one. It is
 *     evidence from a run, not a proof about all runs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isUtteranceShaped } from '../context/antiScriptingCheck.js';
import { scanSource } from '../context/sourceLiterals.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

/**
 * Consecutive words that must coincide before an overlap is called a recital.
 *
 * Seven, and the number is a judgement rather than a measurement. Lower and
 * ordinary English collides by itself ("I can get that booked in for you" is
 * six words of nothing in particular). Higher and a model could lift a whole
 * short line unnoticed. The matched run is always printed, so a reader can
 * disagree with the threshold on the evidence rather than on trust.
 */
export const RECITAL_WORD_RUN = 7;

export interface LiteralOverlap {
  /** The consecutive words that appeared in both. */
  readonly matched: string;
  readonly words: number;
  /** Repo-relative path of the file whose literal it matched. */
  readonly file: string;
  readonly line: number;
  /** The literal, trimmed for display. */
  readonly literal: string;
}

export interface UtteranceVerdict {
  readonly utterance: string;
  /** Overlaps with literals that read as prescribed speech. Any is a violation. */
  readonly recitals: readonly LiteralOverlap[];
  /**
   * The longest overlap with a literal that is NOT utterance-shaped.
   *
   * Expected and legitimate - this is how a business fact reaches a customer.
   * Reported so it is visible, never counted as a violation.
   */
  readonly longestFactualEcho: LiteralOverlap | null;
}

export interface GeneratedLanguageReport {
  readonly verdicts: readonly UtteranceVerdict[];
  /** True when nothing the agent said overlaps prescribed speech. */
  readonly ok: boolean;
  readonly filesScanned: number;
  readonly literalsScanned: number;
  readonly utteranceShapedLiterals: number;
  readonly wordRun: number;
  /**
   * A known-recital control, run every time.
   *
   * Without it a green result is indistinguishable from a checker that cannot
   * fire - the same non-vacuity discipline `tests/invariants/` applies by hand.
   * The control is the demo's own scripted Baseline V1 line, which IS in the
   * source tree and therefore MUST be caught.
   */
  readonly controlCaught: boolean;
  readonly controlUtterance: string;
}

interface CollectedLiteral {
  readonly normalized: string;
  readonly raw: string;
  readonly file: string;
  readonly line: number;
  readonly utteranceShaped: boolean;
}

/**
 * Check real assistant utterances against this repository's own string literals.
 *
 * `control` is an utterance that is known to be present in the source; it is
 * checked alongside the real ones and must be caught. Callers pass a line they
 * can point at - `src/llm/scriptedLlmProvider.ts` is full of them.
 */
export function checkGeneratedLanguage(
  utterances: readonly string[],
  control: string,
  repoRoot: string = REPO_ROOT,
): GeneratedLanguageReport {
  const files = listTypeScriptFiles(join(repoRoot, 'src'));
  const literals: CollectedLiteral[] = [];

  for (const file of files) {
    const relativePath = relative(repoRoot, file).replace(/\\/g, '/');
    const scanned = scanSource(readFileSync(file, 'utf8'));
    for (const literal of scanned.literals) {
      const normalized = normalize(literal.value);
      if (wordsOf(normalized).length < RECITAL_WORD_RUN) continue;
      literals.push({
        normalized,
        raw: literal.value.trim(),
        file: relativePath,
        line: literal.line,
        utteranceShaped: isUtteranceShaped(literal.value),
      });
    }
  }

  const speech = literals.filter((literal) => literal.utteranceShaped);
  const other = literals.filter((literal) => !literal.utteranceShaped);

  const verdicts = utterances.map((utterance) => ({
    utterance,
    recitals: overlaps(utterance, speech),
    longestFactualEcho: overlaps(utterance, other)[0] ?? null,
  }));

  // The control must match something. It is checked against EVERY literal, not
  // just the utterance-shaped ones, so the control's own classification cannot
  // make the non-vacuity guard vacuous in turn.
  const controlCaught = overlaps(control, literals).length > 0;

  return {
    verdicts,
    ok: verdicts.every((verdict) => verdict.recitals.length === 0),
    filesScanned: files.length,
    literalsScanned: literals.length,
    utteranceShapedLiterals: speech.length,
    wordRun: RECITAL_WORD_RUN,
    controlCaught,
    controlUtterance: control,
  };
}

// ---------------------------------------------------------------------------

/**
 * Every `RECITAL_WORD_RUN`-word run of `utterance` that appears in some literal,
 * longest match first.
 *
 * Adjacent runs from the same literal are merged into the longest one, so a
 * lifted sentence is reported once at its real length rather than as a dozen
 * overlapping seven-word findings.
 */
function overlaps(utterance: string, literals: readonly CollectedLiteral[]): LiteralOverlap[] {
  const words = wordsOf(normalize(utterance));
  if (words.length < RECITAL_WORD_RUN) return [];

  /** file:line -> the longest run matched in that literal. */
  const best = new Map<string, LiteralOverlap>();

  for (let start = 0; start + RECITAL_WORD_RUN <= words.length; start += 1) {
    for (const literal of literals) {
      // Extend as far as this literal will allow, from this starting word.
      let end = start + RECITAL_WORD_RUN;
      if (!literal.normalized.includes(words.slice(start, end).join(' '))) continue;
      while (end < words.length && literal.normalized.includes(words.slice(start, end + 1).join(' '))) {
        end += 1;
      }

      const key = `${literal.file}:${literal.line}`;
      const candidate: LiteralOverlap = {
        matched: words.slice(start, end).join(' '),
        words: end - start,
        file: literal.file,
        line: literal.line,
        literal: literal.raw.length <= 160 ? literal.raw : `${literal.raw.slice(0, 159)}…`,
      };
      const existing = best.get(key);
      if (!existing || existing.words < candidate.words) best.set(key, candidate);
    }
  }

  return [...best.values()].sort((left, right) => right.words - left.words);
}

/**
 * Lowercase, strip punctuation, collapse whitespace.
 *
 * Punctuation goes because "you're all set." and "You're all set!" are the same
 * recital, and a model that re-punctuated a lifted line has not written it.
 */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'$%]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function wordsOf(normalized: string): string[] {
  return normalized.length === 0 ? [] : normalized.split(' ');
}

function listTypeScriptFiles(directory: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts')) found.push(full);
    }
  };
  walk(directory);
  return found;
}
