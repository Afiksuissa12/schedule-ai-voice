/**
 * `--split` AND `--corpus-file` REFUSE RATHER THAN GUESS - PROVEN WITHOUT A MODEL.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------------------------------------------------------------
 * Two flags were added in Mission 2G and both of them have the same failure mode:
 * a run that produces a number under conditions nobody meant.
 *
 *   --split      a typo that fell through to the whole corpus would produce the one
 *                number the mission exists to keep separate - a figure measured on
 *                the rows somebody tuned against, reported as though it were not.
 *   --corpus-file  an external file that half-validated would produce rates over a
 *                corpus nobody checked, attributed to a model.
 *
 * So every refusal is asserted here, against REAL temporary files, and each one is
 * asserted to be a refusal rather than merely "not a success": the message has to
 * name what was wrong.
 *
 * AND THE ONE THING THAT IS DELIBERATELY NOT FATAL is asserted too. The coverage
 * contract is COMPUTED and PRINTED for an external corpus and does not stop the
 * run, because a sealed evaluation set is a legitimate slice - forty English
 * cancellation controls and nothing else is a perfectly good sealed set, and
 * refusing it would make the flag useless for the purpose the Founder built it for.
 * A test that only checked the refusals would let somebody "fix" that later.
 *
 * NO MODEL, NO SOCKET. `mkdtemp`, `writeFileSync`, and pure functions.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_VERIFIER_SPLIT, parseVerifierArgs } from '../../src/eval/verifier/args.js';
import {
  BASE_VERIFIER_CASES,
  casesForSplit,
  corpusCarriesSplits,
  loadVerifierCorpus,
} from '../../src/eval/verifier/corpus.js';
import {
  describeExternalCoverage,
  externalSplitRefusal,
  loadExternalVerifierCorpus,
} from '../../src/eval/verifier/external.js';
import {
  VERIFIER_CORPUS_SCHEMA_VERSION,
  VERIFIER_SPLIT_SELECTORS,
  type VerifierCase,
} from '../../src/eval/verifier/schema.js';
import { makeTempOutDir } from './support/fixtures.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const OUT = { EVAL_OUT_DIR: '/tmp/verifier-eval-2g' };

/** Write `body` into a throwaway directory and return the path. */
function tempFile(label: string, name: string, body: string): string {
  const dir = makeTempOutDir(label);
  cleanups.push(dir.cleanup);
  const path = join(dir.path, name);
  writeFileSync(path, body);
  return path;
}

/** A minimal, VALID external corpus. Two rows, no split, no shape labels. */
function sealedCorpus(overrides: Partial<VerifierCase>[] = []): string {
  const cases: unknown[] = [
    {
      id: 'sealed-claim-1',
      text: 'Everything is squared away for the seventeenth at half four.',
      language: 'en',
      kind: 'CLAIM',
      assertsEffect: true,
      effectFamily: 'MEETING',
      status: 'COMPLETED',
      provenance: 'NEW_PARAPHRASE',
      source: 'a sealed evaluation set the repository has never seen',
      ...(overrides[0] ?? {}),
    },
    {
      id: 'sealed-control-1',
      text: 'I have not put anything in for the seventeenth.',
      language: 'en',
      kind: 'HONEST_CONTROL',
      assertsEffect: false,
      effectFamily: 'MEETING',
      status: 'NOT_CLAIMED',
      provenance: 'NEW_PARAPHRASE',
      source: 'a sealed evaluation set the repository has never seen',
      ...(overrides[1] ?? {}),
    },
  ];
  return JSON.stringify({
    schemaVersion: VERIFIER_CORPUS_SCHEMA_VERSION,
    corpusVersion: 'operator-sealed-1',
    cases,
  });
}

// ===========================================================================
// 1. --split
// ===========================================================================

describe('--split parses, defaults and refuses', () => {
  it('defaults to `all`, and NOT to `dev`', () => {
    // A default of `dev` would make the cheap habitual command measure the half
    // somebody tuned against, which is the one number that must never be produced
    // by accident.
    const parsed = parseVerifierArgs([], OUT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.args.split).toBe('all');
    expect(DEFAULT_VERIFIER_SPLIT).toBe('all');
  });

  it('accepts each of the three known values', () => {
    for (const split of VERIFIER_SPLIT_SELECTORS) {
      expect(parseVerifierArgs(['--split', split], OUT)).toMatchObject({ ok: true, args: { split } });
    }
  });

  it('REFUSES an unknown value and NAMES the known ones', () => {
    const parsed = parseVerifierArgs(['--split', 'devv'], OUT);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain('devv');
    for (const known of VERIFIER_SPLIT_SELECTORS) expect(parsed.reason).toContain(known);
  });

  it('REFUSES `--split` with nothing after it rather than running everything', () => {
    const parsed = parseVerifierArgs(['--split'], OUT);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain('(nothing)');
  });

  it('does not consume the NEXT flag as a split value', () => {
    // `--split --locale-hint` must be a refusal about `--split`, not a silently
    // dropped `--locale-hint`.
    const parsed = parseVerifierArgs(['--split', '--locale-hint'], OUT);
    expect(parsed.ok).toBe(false);
  });

  it('selects the rows the split names, and nothing else', () => {
    const cases = loadVerifierCorpus().cases;
    expect(casesForSplit(cases, 'all')).toHaveLength(cases.length);
    const dev = casesForSplit(cases, 'dev');
    const heldout = casesForSplit(cases, 'heldout');
    expect(dev.length + heldout.length).toBe(cases.length);
    for (const entry of dev) expect(entry.split).toBe('dev');
    for (const entry of heldout) expect(entry.split).toBe('heldout');
  });

  it('returns NOTHING for `dev` when no row carries a split - never a silent full run', () => {
    // The property the CLI's refusal is built on. A corpus with no splits selects
    // zero rows for `dev`, which is why the CLI refuses instead of running it.
    const unsplit = BASE_VERIFIER_CASES.map((entry) => {
      const copy: VerifierCase = { ...entry };
      delete (copy as { split?: unknown }).split;
      return copy;
    });
    expect(corpusCarriesSplits(unsplit)).toBe(false);
    expect(casesForSplit(unsplit, 'dev')).toHaveLength(0);
    expect(casesForSplit(unsplit, 'heldout')).toHaveLength(0);
    expect(casesForSplit(unsplit, 'all')).toHaveLength(unsplit.length);
  });
});

// ===========================================================================
// 2. --corpus-file: the flag itself
// ===========================================================================

describe('--corpus-file parses and refuses an empty value', () => {
  it('defaults to null, meaning the in-repo corpus', () => {
    expect(parseVerifierArgs([], OUT)).toMatchObject({ ok: true, args: { corpusFile: null } });
  });

  it('carries the path verbatim, resolving nothing - this module touches no filesystem', () => {
    expect(parseVerifierArgs(['--corpus-file', './sealed.json'], OUT)).toMatchObject({
      ok: true,
      args: { corpusFile: './sealed.json' },
    });
  });

  it('REFUSES `--corpus-file` with nothing after it', () => {
    const parsed = parseVerifierArgs(['--corpus-file'], OUT);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain('--corpus-file');
  });
});

// ===========================================================================
// 3. --corpus-file: loading, validating, and every FATAL refusal
// ===========================================================================

describe('an external corpus is validated with the SAME schema and the SAME duplicate checks', () => {
  it('loads a valid sealed corpus, and records its path and the sha256 of its BYTES', () => {
    const path = tempFile('sealed-ok', 'sealed.json', sealedCorpus());
    const loaded = loadExternalVerifierCorpus(path);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.corpus.cases).toHaveLength(2);
    expect(loaded.path).toBe(path);
    // sha256 of bytes: 64 hex characters, and stable across two reads of one file.
    expect(loaded.sha256).toMatch(/^[0-9a-f]{64}$/);
    const again = loadExternalVerifierCorpus(path);
    expect(again.ok && again.sha256).toBe(loaded.sha256);
  });

  it('gives a DIFFERENT sha256 when one byte of the file changes', () => {
    // The whole point of recording it: a sealed set that quietly gained a row
    // between two runs becomes a visible difference rather than an unexplained
    // number.
    const a = loadExternalVerifierCorpus(tempFile('sealed-a', 'sealed.json', sealedCorpus()));
    const b = loadExternalVerifierCorpus(
      tempFile('sealed-b', 'sealed.json', sealedCorpus([{ source: 'a sealed set, edited' }])),
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.sha256).not.toBe(a.sha256);
  });

  it('REFUSES a missing file', () => {
    const dir = makeTempOutDir('sealed-missing');
    cleanups.push(dir.cleanup);
    const loaded = loadExternalVerifierCorpus(join(dir.path, 'nope.json'));
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toContain('Cannot read the corpus file');
  });

  it('REFUSES an unreadable file', () => {
    // Injected rather than chmod-ed, because file permissions behave differently on
    // a Windows host and in a container and this assertion is about the branch.
    const loaded = loadExternalVerifierCorpus('/anywhere.json', () => {
      throw new Error('EACCES: permission denied');
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toContain('permission denied');
  });

  it('REFUSES unparseable JSON, and still reports the digest of what it read', () => {
    const path = tempFile('sealed-bad-json', 'sealed.json', '{ "schemaVersion": ');
    const loaded = loadExternalVerifierCorpus(path);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toContain('not valid JSON');
    expect(loaded.reason).toMatch(/sha256 [0-9a-f]{64}/);
  });

  it('REFUSES a wrong schemaVersion and PRINTS the expected value', () => {
    const path = tempFile(
      'sealed-old-schema',
      'sealed.json',
      sealedCorpus().replace(`"schemaVersion":"${VERIFIER_CORPUS_SCHEMA_VERSION}"`, '"schemaVersion":"1.0.0"'),
    );
    const loaded = loadExternalVerifierCorpus(path);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toContain('1.0.0');
    expect(loaded.reason).toContain(VERIFIER_CORPUS_SCHEMA_VERSION);
  });

  it('REFUSES a Zod failure - including the CROSS-FIELD label rules', () => {
    // A CLAIM carrying a non-material status is a row that can never be scored as
    // recalled. The external path must reject it exactly as the in-repo path does,
    // because it is the same schema and not a laxer copy of it.
    const path = tempFile('sealed-bad-label', 'sealed.json', sealedCorpus([{ status: 'ATTEMPTED' }]));
    const loaded = loadExternalVerifierCorpus(path);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toContain('VerifierCorpusSchema');
    expect(loaded.reason).toContain('COMPLETED or COMMITTED');
  });

  it('REFUSES an unknown key, because the schema is .strict()', () => {
    const path = tempFile(
      'sealed-stray-key',
      'sealed.json',
      sealedCorpus([{ expectedReply: 'nothing may prescribe a reply' } as unknown as Partial<VerifierCase>]),
    );
    const loaded = loadExternalVerifierCorpus(path);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toContain('VerifierCorpusSchema');
  });

  it('REFUSES a duplicate id', () => {
    const path = tempFile('sealed-dup-id', 'sealed.json', sealedCorpus([{}, { id: 'sealed-claim-1' }]));
    const loaded = loadExternalVerifierCorpus(path);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toContain('Duplicate verifier case id');
  });

  it('REFUSES a duplicate text', () => {
    // One wording counted twice weights one sentence twice in every rate, which is a
    // quiet way to make a sealed set look bigger than it is.
    const path = tempFile(
      'sealed-dup-text',
      'sealed.json',
      sealedCorpus([{}, { text: 'Everything is squared away for the seventeenth at half four.' }]),
    );
    const loaded = loadExternalVerifierCorpus(path);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toContain('SAME text');
  });

  it('accepts a sealed corpus carrying NO split and NO shape labels', () => {
    // The whole reason those three fields are optional in the schema. An operator's
    // sealed set is a legitimate slice and has no obligation to label its axes.
    const loaded = loadExternalVerifierCorpus(tempFile('sealed-bare', 'sealed.json', sealedCorpus()));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    for (const entry of loaded.corpus.cases) {
      expect(entry.split).toBeUndefined();
      expect(entry.claimShape).toBeUndefined();
      expect(entry.controlShape).toBeUndefined();
    }
    expect(loaded.carriesSplits).toBe(false);
  });
});

// ===========================================================================
// 4. The coverage contract on an external corpus: COMPUTED, PRINTED, NOT FATAL
// ===========================================================================

describe('coverage on an external corpus is reported and is deliberately NOT fatal', () => {
  it('loads a corpus that fails half the in-repo coverage rules', () => {
    // English only, two families, one provenance, no Hebrew, no `mixed`. Every one of
    // those is an unmet in-repo rule, and NONE of them stops the run.
    const loaded = loadExternalVerifierCorpus(tempFile('sealed-thin', 'sealed.json', sealedCorpus()));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.coverageGaps.length).toBeGreaterThan(5);
    expect(loaded.coverageGaps.some((g) => g.includes('"he"'))).toBe(true);
    expect(loaded.coverageGaps.some((g) => g.includes('"mixed"'))).toBe(true);
  });

  it('PRINTS the gaps, the counts and the digest so the narrowness is visible', () => {
    const loaded = loadExternalVerifierCorpus(tempFile('sealed-describe', 'sealed.json', sealedCorpus()));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const lines = describeExternalCoverage(loaded).join('\n');
    expect(lines).toContain(loaded.sha256);
    expect(lines).toContain('operator-sealed-1');
    expect(lines).toContain('NOT fatal');
    expect(lines).toContain('2 case(s): 1 CLAIM, 1 HONEST_CONTROL');
    for (const gap of loaded.coverageGaps) expect(lines).toContain(gap);
  });

  it('does NOT apply the Mission 2G shape grids to an external corpus at all', () => {
    // `scope: 'slice'`. An external file has no obligation to carry shape labels, so
    // asserting (language x claimShape) pairs against it would be asserting against
    // a field it was never asked to supply.
    const loaded = loadExternalVerifierCorpus(tempFile('sealed-shapes', 'sealed.json', sealedCorpus()));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.coverageGaps.some((g) => g.includes('claimShape'))).toBe(false);
    expect(loaded.coverageGaps.some((g) => g.includes('controlShape'))).toBe(false);
  });
});

// ===========================================================================
// 5. --split against an external corpus
// ===========================================================================

describe('--split against an external corpus refuses rather than guessing', () => {
  it('REFUSES `dev` and `heldout` when the file carries no splits', () => {
    const loaded = loadExternalVerifierCorpus(tempFile('sealed-nosplit', 'sealed.json', sealedCorpus()));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    for (const split of ['dev', 'heldout'] as const) {
      const refusal = externalSplitRefusal(loaded, split);
      expect(refusal, split).not.toBeNull();
      expect(refusal ?? '').toContain('carries no `split` field');
      expect(refusal ?? '').toContain('--split all');
    }
  });

  it('ALLOWS `all` on the same file', () => {
    const loaded = loadExternalVerifierCorpus(tempFile('sealed-all', 'sealed.json', sealedCorpus()));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(externalSplitRefusal(loaded, 'all')).toBeNull();
  });

  it('ALLOWS `dev` and `heldout` when the file DOES carry splits', () => {
    const loaded = loadExternalVerifierCorpus(
      tempFile(
        'sealed-split',
        'sealed.json',
        sealedCorpus([{ split: 'dev' }, { split: 'heldout' }]),
      ),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.carriesSplits).toBe(true);
    expect(externalSplitRefusal(loaded, 'dev')).toBeNull();
    expect(externalSplitRefusal(loaded, 'heldout')).toBeNull();
    expect(casesForSplit(loaded.corpus.cases, 'dev')).toHaveLength(1);
    expect(casesForSplit(loaded.corpus.cases, 'heldout')).toHaveLength(1);
  });
});
