/**
 * THE VERIFIER'S AUTHORITY BOUNDARY, AS AN IMPORT PROPERTY.
 *
 * WHY A STATIC TEST AND NOT A BEHAVIOURAL ONE
 * ---------------------------------------------------------------------------
 * `tests/agent/semanticClaimVerifier.test.ts` proves the verifier in the tree
 * TODAY is offered no tools and can reach nothing. That is a property of one
 * class. This file is the property of the DIRECTORY: nothing under
 * `src/agent/claimGate/semantic/` may import a module through which an effect can
 * be caused, now or later, so a future addition to the semantic layer cannot
 * quietly acquire authority the design denies it.
 *
 * Written in the shape of `tests/invariants/vendorBoundary.test.ts`, deliberately:
 * that file makes the same kind of claim about vendor SDKs, it is the pattern this
 * repository already trusts for a boundary, and a reader who knows one knows both.
 * Like it, this walks the TRANSITIVE import closure rather than only the direct
 * imports - a boundary that only checked line one of each file would be defeated
 * by one re-export.
 *
 * THE FOUR THINGS IT FORBIDS, and each is a way the verifier could have
 * authority it must not have:
 *
 *  1. PERSISTENCE (`src/db`, and Prisma). A verifier that can read rows can be
 *     shown the answer, and a classifier that can see the answer can be argued
 *     into agreeing with it. A verifier that can WRITE rows can create the effect
 *     it was asked about.
 *  2. THE TOOL LAYER (`src/agent/tools`). This is the module tree through which
 *     every model-originated action passes. Nothing that classifies a sentence
 *     needs it, and anything that imports it has the dispatcher in its graph.
 *  3. THE ACTION SERVICES (`src/followup`, `src/scheduling`'s services). These
 *     book, cancel and promise.
 *  4. THE EFFECT-CAUSING PORTS (`src/ports/telephony`, `calendar`,
 *     `availability`) and any vendor SDK or raw transport.
 *
 * WHAT IS DELIBERATELY ALLOWED, with the reason, because an allowance nobody
 * justified is an allowance nobody will review:
 *
 *  - `src/ports/claimVerifier.ts` and `src/ports/llm.ts` - the two ports this
 *    layer is written against. Types plus one capability predicate; neither can
 *    cause an effect, and `LlmProvider` is how the verifier is given a model
 *    instead of building an HTTP client.
 *  - `src/agent/claimGate/detector.ts` and `lexicon/types.ts` - TYPE-ONLY, for
 *    `DetectedClaim`, `ClaimEffectFamily` and `ClaimAssertionMode`. The union has
 *    to produce the shape the existing reconciliation consumes, and importing the
 *    type is how it cannot drift from it.
 *  - `src/scheduling/lexicon/script.ts` - `normalizeScript`, a pure string
 *    function with no clock, no I/O and no state. It is what
 *    `src/agent/claimGate/text.ts` itself uses, and the grounding check's fallback
 *    must agree with the detector rather than invent a second notion of sameness.
 *    It is a LEXICON module, not a scheduling SERVICE, and the forbidden list
 *    below names the services individually so this distinction is explicit rather
 *    than a happy accident of prefix matching.
 *  - `zod` - the schema library this repository already validates every strict
 *    contract with.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The directory under examination. */
const SEMANTIC_DIR = 'src/agent/claimGate/semantic';

/**
 * Repository paths nothing in the closure may reach, each with why.
 *
 * Matched as a PREFIX of the repo-relative path, so `src/db` covers
 * `src/db/repositories/scheduling.ts` without listing it.
 */
const FORBIDDEN_PATHS: readonly { readonly prefix: string; readonly why: string }[] = [
  { prefix: 'src/db/', why: 'persistence - a verifier that can read rows can be shown the answer' },
  { prefix: 'src/agent/tools/', why: 'the tool layer - the path every model-originated action takes' },
  { prefix: 'src/followup/', why: 'the follow-up services - they promise callbacks' },
  { prefix: 'src/ports/telephony', why: 'an effect-causing port - it dials people' },
  { prefix: 'src/ports/calendar', why: 'an effect-causing port - it writes calendars' },
  { prefix: 'src/ports/availability', why: 'an effect-causing port - it consults a real diary' },
  // The scheduling SERVICES, named one by one. `src/scheduling/lexicon/` is
  // deliberately NOT forbidden - see the header - so a blanket `src/scheduling/`
  // prefix would be wrong and a reader should be able to see that it was a choice.
  { prefix: 'src/scheduling/meetingSchedulingService', why: 'a scheduling service - it books meetings' },
  { prefix: 'src/scheduling/schedulingValidator', why: 'a scheduling service - it authorises a slot' },
  { prefix: 'src/scheduling/dateTimeResolver', why: 'the resolver - a second reader of a day is the § 20 defect twice' },
  { prefix: 'src/scheduling/naturalLanguage', why: 'the resolver grammar - same reason' },
  { prefix: 'src/scheduling/pinnedSlot', why: 'a scheduling service' },
  { prefix: 'src/conversation/', why: 'the durable transcript - the verifier sees one text, not a conversation' },
  { prefix: 'src/agent/claimGate/ledger', why: 'THE LEDGER. Authoritative truth is not the verifier’s to see' },
  { prefix: 'src/agent/claimGate/verifier', why: 'the reconciliation - "supported" is not this layer’s vocabulary' },
  { prefix: 'src/agent/claimGate/claimGate', why: 'the gate itself - the dependency points the other way' },
  { prefix: 'src/agent/claimGate/handoff', why: 'the exhaustion outcome - it writes a Task row' },
];

/** Packages nothing in the closure may import. Vendor SDKs and raw transports. */
const FORBIDDEN_PACKAGES = [
  '@prisma/client',
  'prisma',
  'openai',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  'googleapis',
  'google-auth-library',
  '@google-cloud/local-auth',
  '@microsoft/microsoft-graph-client',
  '@azure/identity',
  '@azure/msal-node',
  'twilio',
  'telnyx',
  '@vonage/server-sdk',
  '@vonage/voice',
  'vapi',
  '@vapi-ai/server-sdk',
  'retell-sdk',
  'retell-client-js-sdk',
  // Generic transports count too: they are how a vendor gets in by the back door,
  // and they are also how this layer would stop being "no new HTTP client".
  'axios',
  'node-fetch',
  'got',
  'undici',
  'superagent',
];

/** Packages the closure MAY import, each justified in the header. */
const ALLOWED_PACKAGES = ['zod'];

/**
 * Real import and export statements, and nothing that merely looks like one.
 *
 * `vendorBoundary.test.ts` matches any `from '...'` anywhere in a file, which is
 * right for its question - a vendor SDK name in a comment is worth a second look -
 * and wrong for this one, because this test WALKS what it finds. A `from "..."`
 * inside a sentence in a doc comment would be followed as an import, and this
 * repository's modules are documented at length.
 *
 * So the pattern is anchored to the start of a line (`m` flag) and requires the
 * statement keyword. Group 1 is the literal `type` when the statement is
 * type-only; group 2 is the specifier.
 */
const STATEMENT_RE = /^\s*(?:import|export)\s+(type\s+)?[^;'"]*?from\s*['"]([^'"]+)['"]/gm;

/** A bare side-effect import: `import './register.js'`. */
const SIDE_EFFECT_RE = /^\s*import\s*['"]([^'"]+)['"]/gm;

/** `await import('...')` and `require('...')`, which are value imports wherever they appear. */
const DYNAMIC_RE = /(?:\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

function sourceFilesUnder(directory: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (extname(full) === '.ts') found.push(full);
    }
  };
  walk(join(REPO_ROOT, directory));
  return found;
}

function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null;
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? null);
}

/** `./schema.js` from `src/.../llmSemanticClaimVerifier.ts` -> `src/.../schema.ts`. */
function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const candidate = resolve(dirname(fromFile), specifier).replace(/\.js$/, '.ts');
  // `./index.js` style directory imports are not used in this repository, but a
  // future one should not silently drop out of the walk.
  for (const attempt of [candidate, `${candidate.replace(/\.ts$/, '')}/index.ts`]) {
    try {
      if (statSync(attempt).isFile()) return attempt;
    } catch {
      // Not a file. Fall through and try the next shape.
    }
  }
  return null;
}

interface ClosureEdge {
  readonly from: string;
  readonly specifier: string;
  /** Resolved repo-relative path, for a local import. */
  readonly target: string | null;
  /** Bare package name, for a package import. */
  readonly packageName: string | null;
  /**
   * `import type` / `export type`. Erased at compile time, so it cannot cause an
   * effect at runtime - which is why the walk does not FOLLOW one, and why both
   * kinds are still CHECKED against the forbidden lists.
   *
   * The distinction is what makes the closure a statement about runtime authority.
   * `union.ts` imports `DetectedClaim` from `detector.ts` type-only, deliberately,
   * so the union cannot drift from the shape reconciliation consumes - and
   * following that edge would drag the detector's whole runtime graph (luxon, every
   * lexicon, the scheduling vocabulary) into a closure none of it is actually in.
   */
  readonly typeOnly: boolean;
}

/** Every import and export statement in one file. */
function edgesIn(file: string): { specifier: string; typeOnly: boolean }[] {
  const source = readFileSync(file, 'utf8');
  const found: { specifier: string; typeOnly: boolean }[] = [];
  for (const match of source.matchAll(STATEMENT_RE)) {
    found.push({ specifier: match[2] as string, typeOnly: match[1] !== undefined });
  }
  for (const match of source.matchAll(SIDE_EFFECT_RE)) {
    found.push({ specifier: match[1] as string, typeOnly: false });
  }
  for (const match of source.matchAll(DYNAMIC_RE)) {
    found.push({ specifier: match[1] as string, typeOnly: false });
  }
  return found;
}

/**
 * Every file reachable from the semantic directory AT RUNTIME, and every edge
 * seen along the way - including the type-only ones, which are recorded but not
 * followed.
 *
 * Transitive on purpose: a boundary checked only against direct imports is a
 * boundary one re-export defeats.
 */
function importClosure(): { files: Set<string>; edges: ClosureEdge[] } {
  const files = new Set<string>();
  const edges: ClosureEdge[] = [];
  const queue = sourceFilesUnder(SEMANTIC_DIR);
  for (const seed of queue) files.add(seed);

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const { specifier, typeOnly } of edgesIn(current)) {
      const resolved = resolveRelative(current, specifier);
      edges.push({
        from: relative(REPO_ROOT, current).replace(/\\/g, '/'),
        specifier,
        target: resolved === null ? null : relative(REPO_ROOT, resolved).replace(/\\/g, '/'),
        packageName: packageNameOf(specifier),
        typeOnly,
      });
      if (!typeOnly && resolved !== null && !files.has(resolved)) {
        files.add(resolved);
        queue.push(resolved);
      }
    }
  }

  return { files, edges };
}

describe('the semantic claim verifier cannot reach anything that causes an effect', () => {
  const closure = importClosure();

  it('finds the directory and a real closure, so a passing run is never vacuous', () => {
    // The trap `vendorBoundary.test.ts` sets for itself, set here for the same
    // reason: a walker pointed at nothing passes every assertion below.
    expect(sourceFilesUnder(SEMANTIC_DIR).length).toBeGreaterThanOrEqual(5);
    expect(closure.edges.length).toBeGreaterThan(5);
    // And the closure really is transitive - it reached past the directory itself.
    const outside = [...closure.files].filter((file) => !file.includes('claimGate/semantic'));
    expect(outside.length, 'the closure never left the directory, so it is not transitive').toBeGreaterThan(0);
  });

  it('reaches none of the forbidden repository paths, transitively', () => {
    const violations: string[] = [];
    for (const edge of closure.edges) {
      if (edge.target === null) continue;
      for (const forbidden of FORBIDDEN_PATHS) {
        if (edge.target.startsWith(forbidden.prefix)) {
          violations.push(`${edge.from} -> ${edge.target}  (${forbidden.why})`);
        }
      }
    }
    expect(
      violations,
      'The semantic claim verifier acquired authority it must not have. It classifies one string; it may not ' +
        'read state, cause an effect, or see the answer it is being checked against.',
    ).toEqual([]);
  });

  it('imports no vendor SDK and no raw HTTP transport', () => {
    const violations: string[] = [];
    for (const edge of closure.edges) {
      if (edge.packageName && FORBIDDEN_PACKAGES.includes(edge.packageName)) {
        violations.push(`${edge.from} imports "${edge.specifier}"`);
      }
    }
    expect(
      violations,
      'The verifier is an implementation over an INJECTED LlmProvider, not a new HTTP client. The only file ' +
        'in this repository that may dial Ollama is src/llm/ollama/client.ts.',
    ).toEqual([]);
  });

  it('imports only packages this test justifies, so a new dependency is a decision', () => {
    // Stronger than the blocklist above and the reason both exist: a package
    // nobody thought to forbid is exactly the shape every one of this gate's eight
    // fail-open findings had. An allowlist makes the next one a red test.
    const unexpected = new Set<string>();
    for (const edge of closure.edges) {
      if (edge.packageName && !ALLOWED_PACKAGES.includes(edge.packageName)) unexpected.add(edge.packageName);
    }
    expect(
      [...unexpected].sort(),
      'A new package entered the semantic verifier\'s import closure. If it cannot cause an effect and cannot ' +
        'read state, add it to ALLOWED_PACKAGES with the reason; if it can, it does not belong here.',
    ).toEqual([]);
  });

  it('reaches the network through nothing at all - no fetch, no http, no socket', () => {
    // The behavioural half of the transport claim, over the whole closure rather
    // than over the directory, because a helper one hop away could hold the fetch.
    const violations: string[] = [];
    for (const file of closure.files) {
      if (!file.includes(`${REPO_ROOT}/src/agent/claimGate/semantic`)) {
        // Only files IN the semantic layer are held to this: `src/llm` legitimately
        // contains the one client, and the closure does not reach it today - which
        // the path assertions above are what guarantee.
        continue;
      }
      const source = readFileSync(file, 'utf8');
      if (/\bfetch\s*\(|XMLHttpRequest|net\.connect|require\(['"]node:https?['"]\)/.test(source)) {
        violations.push(relative(REPO_ROOT, file).replace(/\\/g, '/'));
      }
    }
    expect(violations, 'a file in the semantic layer reached the network directly').toEqual([]);
  });

  it('and the guard would actually fire - a positive control on the walker', () => {
    // The trap that makes every assertion above meaningful. If the resolver or the
    // specifier regex were broken, the closure would be empty and everything would
    // pass; this proves the machinery detects a forbidden edge when one exists.
    const synthetic: ClosureEdge[] = [
      {
        from: 'src/agent/claimGate/semantic/fake.ts',
        specifier: '../../../db/database.js',
        target: 'src/db/database.ts',
        packageName: null,
        typeOnly: false,
      },
      {
        from: 'src/agent/claimGate/semantic/fake.ts',
        specifier: '@prisma/client',
        target: null,
        packageName: '@prisma/client',
        typeOnly: false,
      },
    ];
    const pathHits = synthetic.filter((edge) =>
      FORBIDDEN_PATHS.some((forbidden) => edge.target?.startsWith(forbidden.prefix)),
    );
    const packageHits = synthetic.filter(
      (edge) => edge.packageName !== null && FORBIDDEN_PACKAGES.includes(edge.packageName),
    );
    expect(pathHits).toHaveLength(1);
    expect(packageHits).toHaveLength(1);
  });

  it('and the type-only / value split is real, which is what makes the closure a RUNTIME claim', () => {
    // A third positive control, on the distinction the whole walk depends on. If
    // `typeOnly` detection silently stopped working, the closure would either drag
    // in the detector's entire runtime graph (and the allowlist above would fail
    // loudly, which is fine) or - worse, if it inverted - stop following real
    // value imports and go shallow without going empty.
    const union = closure.edges.filter((edge) => edge.from.endsWith('semantic/union.ts'));
    expect(union.some((edge) => edge.typeOnly && edge.specifier.includes('detector')), 'union.ts must import DetectedClaim TYPE-ONLY').toBe(true);
    expect(union.some((edge) => !edge.typeOnly && edge.specifier.includes('schema')), 'union.ts must import ./schema.js as a VALUE').toBe(true);

    // And prose is not mistaken for an import: these modules are documented at
    // length and a doc comment containing `from "..."` must not be followed.
    expect(
      closure.edges.filter((edge) => edge.specifier.includes(' ')),
      'a phrase with a space in it was read as a module specifier, so the statement regex is matching prose',
    ).toEqual([]);
  });

  it('and the relative resolver really resolves, which is what makes the walk transitive', () => {
    // A second positive control, on the one function whose silent failure would
    // make the closure shallow without making it empty.
    const from = join(REPO_ROOT, SEMANTIC_DIR, 'union.ts');
    expect(resolveRelative(from, './schema.js')).toBe(join(REPO_ROOT, SEMANTIC_DIR, 'schema.ts'));
    expect(resolveRelative(from, '../detector.js')).toContain('claimGate/detector.ts');
    expect(resolveRelative(from, 'zod')).toBeNull();
  });
});
