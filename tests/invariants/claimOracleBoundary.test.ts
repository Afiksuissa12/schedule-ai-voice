/**
 * THE ORACLE'S INDEPENDENCE, ASSERTED STRUCTURALLY RATHER THAN IN PROSE.
 *
 * `docs/MISSION_2D_CLAIM_GATE.md` has claimed independence for INV-18's support
 * half since it was written, and that claim was true. The DETECTION half was not
 * independent, it was documented as not independent, and it still certified four
 * live fail-open defects as zero leaks (§§ 14, 15, 16, 17). A statement in a
 * document is not a guarantee; it is a note about what somebody believed on the
 * day they wrote it.
 *
 * So the independence of the § 17.5 oracle is a test, in the spirit of
 * `vendorBoundary.test.ts`: walk the TRANSITIVE import closure of the oracle and
 * of the file that declares its ground truth, and fail if anything in either
 * closure reaches `src/agent/claimGate/**`.
 *
 * WHY TRANSITIVE AND NOT JUST DIRECT
 * ---------------------------------------------------------------------------
 * The brief's requirement is that the oracle must not consult the claim gate
 * "directly or transitively", and the transitive route is the plausible one: a
 * helper in `tests/helpers/` that happened to import the detector for an
 * unrelated reason would make the whole oracle circular again without anybody
 * writing the import. The walk below follows relative specifiers from the two
 * roots until the closure stops growing.
 *
 * THE POSITIVE CONTROL MATTERS AS MUCH AS THE CHECK
 * ---------------------------------------------------------------------------
 * A walker with a bug in it passes this file silently and proves nothing - which
 * is the exact failure mode of the thing it is guarding. So the last two tests
 * point the identical walker at `invariants.ts`, which DOES import the detector
 * deliberately, and require it to find the import.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DECLARED_FAMILY_SUPPORT_TABLE } from './claimOracle.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

/**
 * The two roots whose closure must be clean.
 *
 * `claimOracle.ts` is the judgement. `releaseTexts.ts` is the ground truth it
 * judges against, and a declaration derived from the detector would be exactly as
 * circular as an oracle that called it - so both are roots rather than one.
 */
const ORACLE_ROOTS = [
  'tests/invariants/claimOracle.ts',
  'tests/invariants/releaseTexts.ts',
  'tests/invariants/pastFindingTexts.ts',
];

/** The module the oracle must not reach, directly or through anything else. */
const FORBIDDEN_PREFIX = 'src/agent/claimGate/';

const SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

/** Every relative import in one file, as repo-relative paths. */
function relativeImportsOf(fileAbsolute: string): { readonly specifier: string; readonly target: string | null }[] {
  const source = readFileSync(fileAbsolute, 'utf8');
  const out: { specifier: string; target: string | null }[] = [];
  for (const match of source.matchAll(SPECIFIER_RE)) {
    const specifier = match[1] as string;
    if (!specifier.startsWith('.')) continue;
    // This repository writes ESM specifiers with a `.js` extension over `.ts`
    // sources, so the resolution is one substitution and a file check.
    const raw = resolve(dirname(fileAbsolute), specifier);
    const candidates = [raw.replace(/\.js$/, '.ts'), raw.replace(/\.js$/, '.tsx'), raw, `${raw}.ts`, `${raw}/index.ts`];
    const found = candidates.find((candidate) => existsSync(candidate) && !candidate.endsWith('/'));
    out.push({ specifier, target: found ? relative(REPO_ROOT, found).replace(/\\/g, '/') : null });
  }
  return out;
}

/** Every file reachable from `roots` by following relative imports. */
function transitiveClosure(roots: readonly string[]): {
  readonly files: readonly string[];
  readonly unresolved: readonly string[];
} {
  const seen = new Set<string>();
  const unresolved: string[] = [];
  const queue = [...roots];

  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    const absolute = join(REPO_ROOT, current);
    if (!existsSync(absolute)) {
      unresolved.push(current);
      continue;
    }
    for (const edge of relativeImportsOf(absolute)) {
      if (edge.target === null) unresolved.push(`${current} -> ${edge.specifier}`);
      else queue.push(edge.target);
    }
  }

  return { files: [...seen].sort(), unresolved };
}

describe('the independent oracle does not consult the claim gate', () => {
  const closure = transitiveClosure(ORACLE_ROOTS);

  it('resolves every relative import it finds, so the walk is not silently short', () => {
    // A walker that fails to resolve an import reports a smaller closure than the
    // real one and passes the check below for the wrong reason. This is the
    // vacuity guard for the guard.
    expect(closure.unresolved, 'unresolvable relative imports in the oracle closure').toEqual([]);
  });

  it('has a closure containing both roots and nothing under src/agent/claimGate', () => {
    for (const root of ORACLE_ROOTS) expect(closure.files).toContain(root);

    const offenders = closure.files.filter((file) => file.startsWith(FORBIDDEN_PREFIX));
    expect(
      offenders,
      'The independent oracle reaches the claim gate. Ground truth that is derived from the code under test ' +
        'is the circularity docs/MISSION_2D_CLAIM_GATE.md § 17.5 exists to remove, and it certified four ' +
        'live fail-open defects as zero leaks before it was removed.',
    ).toEqual([]);
  });

  it('names no claim-gate module in an import specifier either', () => {
    // Belt and braces: the closure walk resolves paths, and this reads the raw
    // text. A type-only import that a future `verbatimModuleSyntax` change made
    // invisible to one of the two would still be caught by the other.
    // Read the SPECIFIERS, not the whole source: both files discuss
    // `src/agent/claimGate/**` at length in their headers, which is the right
    // place to explain a boundary and the wrong thing to fail on.
    for (const file of closure.files) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      const specifiers = [...source.matchAll(SPECIFIER_RE)].map((match) => match[1] as string);
      expect(
        specifiers.filter((specifier) => specifier.includes('claimGate')),
        `${file} names the claim gate in an import specifier`,
      ).toEqual([]);
    }
  });

  it('is genuinely small, which is what makes the claim checkable by a reader', () => {
    // `claimOracle.ts` imports nothing at all and `releaseTexts.ts` imports only
    // it. If that ever grows, the independence argument stops being something a
    // reviewer can verify by eye and starts depending on this test being right.
    expect(closure.files.length).toBeLessThanOrEqual(4);
  });

  it('imports nothing from node_modules in the oracle itself', () => {
    // Not even Luxon. Every quantity the oracle compares is an absolute value a
    // person wrote down against an absolute value the runner measured, so there
    // is no arithmetic to get wrong and no dependency to smuggle the gate in
    // through. Stated as an assertion because it is load-bearing for the claim
    // above rather than a style preference.
    const source = readFileSync(join(REPO_ROOT, 'tests/invariants/claimOracle.ts'), 'utf8');
    const specifiers = [...source.matchAll(SPECIFIER_RE)].map((match) => match[1] as string);
    expect(specifiers, 'claimOracle.ts imports something').toEqual([]);
  });
});

describe('the boundary walker actually works (positive control)', () => {
  it('finds the detector import in invariants.ts, which has one on purpose', () => {
    // INV-18 still keeps the detector as a SECOND witness - that is required, not
    // an oversight (docs/MISSION_2D_CLAIM_GATE.md § 17.5). So `invariants.ts` is
    // the perfect control: the same walker, pointed at a file that really does
    // reach the claim gate, must report it. If this ever passes an empty list,
    // the check above is vacuous.
    const closure = transitiveClosure(['tests/invariants/invariants.ts']);
    const offenders = closure.files.filter((file) => file.startsWith(FORBIDDEN_PREFIX));
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders).toContain('src/agent/claimGate/detector.ts');
  });

  it('finds a TRANSITIVE reach, not just a direct one', () => {
    // `runner.ts` does not import the detector; it imports `composition.ts`,
    // which builds the gate. A walker that only looked at direct imports would
    // call that clean, and a helper reaching the gate two hops away is precisely
    // how the oracle's independence would be lost without anybody writing the
    // import.
    const closure = transitiveClosure(['tests/invariants/runner.ts']);
    const runnerSource = readFileSync(join(REPO_ROOT, 'tests/invariants/runner.ts'), 'utf8');
    expect(runnerSource, 'runner.ts imports the gate directly, so this is no longer a transitive test').not.toMatch(
      /claimGate\/(detector|verifier|ledger|claimGate)/,
    );
    expect(closure.files.filter((file) => file.startsWith(FORBIDDEN_PREFIX)).length).toBeGreaterThan(0);
  });
});

describe('the oracle repeats the family rule rather than importing it', () => {
  it('states a support table of its own', () => {
    // The point of a third copy is that it can DISAGREE. This asserts the table
    // is present and populated rather than that it matches the gate's, because
    // asserting a match would be the coupling an independent oracle is avoiding.
    expect(Object.keys(DECLARED_FAMILY_SUPPORT_TABLE).sort()).toEqual([
      'ANY',
      'CALLBACK',
      'CANCELLATION',
      'HANDOVER',
      'MEETING',
      'MESSAGE',
      'RECORD',
      'RESCHEDULE',
    ]);
  });

  it('maps MESSAGE to nothing, which is the entry that has to be right', () => {
    // No tool in this system sends anything, so a promise to send one is
    // unsupportable by construction rather than by an empty diary. If a future
    // change gave the system an email tool, this is the line that has to move
    // and it should move deliberately.
    expect(DECLARED_FAMILY_SUPPORT_TABLE.MESSAGE).toEqual([]);
  });
});
