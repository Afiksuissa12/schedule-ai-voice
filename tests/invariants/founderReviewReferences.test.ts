/**
 * The Mission 2 Founder Review's LOCATION and its CITATION contract, guarded.
 *
 * Mission 2C moved the review from the repository root to `docs/` and re-pointed
 * every reference to it. Three things can rot silently after a move like that,
 * and all three are invisible to a reader of the diff that causes them:
 *
 *   1. the review reappears at the root, or vanishes from `docs/`;
 *   2. a new file cites it at the OLD root path, so the link 404s while the
 *      prose around it still reads correctly;
 *   3. a transcript excerpt's `Source:` line cites a transcript that is not
 *      there - a quotation with no provenance, which is worse than no quotation.
 *
 * This guard asserts exactly those three and nothing else. It deliberately does
 * NOT assert on the review's prose, its section numbers or its conclusions:
 * those change legitimately on every revision, and a test that pinned them would
 * be a tax on editing the document rather than a guard on its integrity.
 *
 * No network, no model, no subprocess: three `fs` walks over text files.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(THIS_FILE), '..', '..');

const REVIEW_BASENAME = 'FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md';
const REVIEW_PATH = `docs/${REVIEW_BASENAME}`;

/** The evidence directory the review's excerpts are quoted from. */
const EVIDENCE_DIR = 'eval-output-fair-20260927';

/**
 * Directories never walked. Build output, dependencies, scratch space, the
 * agent mailboxes, sibling worktrees, and the two committed READ-ONLY evidence
 * directories - whose own files legitimately contain paths this guard would
 * otherwise read as references.
 */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.tmp',
  '.agent-inbox',
  '.agent-outbox',
  '.worktrees',
  'eval-output',
  EVIDENCE_DIR,
]);

const SCANNED_EXTENSIONS = new Set([
  '.md',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.yaml',
  '.yml',
]);

function scannableFiles(): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      if (SKIP_DIRECTORIES.has(entry)) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (SCANNED_EXTENSIONS.has(extname(full))) found.push(full);
    }
  };
  walk(REPO_ROOT);
  return found;
}

/** Read as text with line endings normalised - the repository uses CRLF. */
function readText(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n');
}

describe('the Founder review lives under docs/, and its citations resolve', () => {
  it('exists at docs/ and no longer exists at the repository root', () => {
    expect(
      existsSync(join(REPO_ROOT, REVIEW_PATH)),
      `${REVIEW_PATH} is missing. Mission 2C moved the review there; it is the ` +
        'path every reference in the repository now names.',
    ).toBe(true);

    expect(
      existsSync(join(REPO_ROOT, REVIEW_BASENAME)),
      `${REVIEW_BASENAME} has reappeared at the repository ROOT. There must be ` +
        `exactly one copy of the review, at ${REVIEW_PATH}. Two copies diverge ` +
        'silently and readers cannot tell which one is current.',
    ).toBe(false);

    // The root-level sibling review is a DIFFERENT document and stays where it is;
    // this guard is about the Mission 2 one only.
    expect(existsSync(join(REPO_ROOT, 'docs', 'FOUNDER_REVIEW.md'))).toBe(true);
  });

  it('is referenced at docs/ everywhere, and at the root path nowhere', () => {
    const offences: string[] = [];

    for (const absolutePath of scannableFiles()) {
      // This guard must be allowed to name the forbidden pattern in order to
      // forbid it.
      if (absolutePath === THIS_FILE) continue;

      const relativePath = relative(REPO_ROOT, absolutePath).split('\\').join('/');
      const lines = readText(absolutePath).split('\n');

      lines.forEach((line, index) => {
        let at = line.indexOf(REVIEW_BASENAME);
        while (at !== -1) {
          // A correct reference is prefixed by `docs/`. Anything else names the
          // stale root-level path.
          if (line.slice(0, at).endsWith('docs/')) {
            at = line.indexOf(REVIEW_BASENAME, at + REVIEW_BASENAME.length);
            continue;
          }
          offences.push(
            `${relativePath}:${index + 1} cites the review at the repository-root ` +
              `path; it must name "${REVIEW_PATH}".\n    ${line.trim()}`,
          );
          at = line.indexOf(REVIEW_BASENAME, at + REVIEW_BASENAME.length);
        }
      });
    }

    expect(
      offences,
      `${offences.length} reference(s) still point at the review's OLD root-level ` +
        `path. The review lives at ${REVIEW_PATH}:\n\n${offences.join('\n')}\n`,
    ).toEqual([]);
  });

  it('cites a transcript that exists for every Source: line in the review', () => {
    const reviewAbsolute = join(REPO_ROOT, REVIEW_PATH);
    const lines = readText(reviewAbsolute).split('\n');

    // The citation contract: a line of exactly this shape, one per excerpt.
    const citation = /^Source: `([^`]+)`$/;

    const citations: { line: number; path: string }[] = [];
    lines.forEach((line, index) => {
      const cited = citation.exec(line)?.[1];
      if (cited) citations.push({ line: index + 1, path: cited });
    });

    expect(
      citations.length,
      `No "Source: \`<path>\`" citation lines found in ${REVIEW_PATH}. Either the ` +
        'review no longer quotes the benchmark transcripts, or the citation ' +
        'contract changed shape - both are worth a human look rather than a ' +
        'silently passing test.',
    ).toBeGreaterThan(0);

    const dangling = citations
      .filter(({ path }) => !existsSync(join(REPO_ROOT, path)))
      .map(
        ({ line, path }) =>
          `${REVIEW_PATH}:${line} cites "${path}", which does not exist on disk.`,
      );

    expect(
      dangling,
      `${dangling.length} of ${citations.length} transcript citation(s) in ` +
        `${REVIEW_PATH} do not resolve. A quoted excerpt whose source is missing ` +
        `has no provenance:\n\n${dangling.join('\n')}\n`,
    ).toEqual([]);

    // Every citation must point into the committed evidence directory; a citation
    // that wandered outside it is not reproducible from this repository.
    const strays = citations
      .filter(({ path }) => !path.startsWith(`${EVIDENCE_DIR}/transcripts/`))
      .map(
        ({ line, path }) =>
          `${REVIEW_PATH}:${line} cites "${path}", which is outside ` +
          `${EVIDENCE_DIR}/transcripts/.`,
      );

    expect(
      strays,
      `Citation(s) point outside the committed evidence:\n\n${strays.join('\n')}\n`,
    ).toEqual([]);
  });
});
