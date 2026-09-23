/**
 * INVARIANT 10, the static half: the vendor SDK stays in exactly one file.
 *
 * `tests/scheduling/providerBoundary.test.ts` (owned by the scheduling task)
 * guards `src/scheduling`, `src/followup`, `src/domain` and `src/providers`.
 * The agent task asked, through the coordination mailbox, for that guard to be
 * extended over `src/agent`, `src/conversation` and `src/app` so the loop is
 * closed. Rather than edit a sibling's file, the extension lives here, in the
 * QA area, and covers the REST of the repository in one statement:
 *
 *     `src/llm/openAiLlmProvider.ts` is the only file in `src/` that may import
 *     a vendor SDK.
 *
 * That is a stronger claim than a directory allowlist, because it needs no
 * maintenance when a new directory is added - a new `src/billing` that imported
 * Twilio would fail this test on the day it was written.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The ONE file permitted to import a vendor SDK.
 *
 * If this list ever needs a second entry, that is an architecture decision and
 * belongs in `docs/DECISIONS.md`, not in a quiet edit to a test fixture.
 */
const VENDOR_ADAPTER_ALLOWLIST = ['src/llm/openAiLlmProvider.ts'];

const FORBIDDEN_PACKAGES = [
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
  // Generic transports count too: they are how a vendor gets in by the back door.
  'axios',
  'node-fetch',
  'got',
  'undici',
  'superagent',
];

const SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

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

describe('the vendor SDK lives in exactly one file', () => {
  it('finds source files, so a passing run is never vacuous', () => {
    expect(sourceFilesUnder('src').length).toBeGreaterThan(40);
  });

  it('no file in src/ imports a vendor SDK except the one adapter', () => {
    const violations: string[] = [];

    for (const file of sourceFilesUnder('src')) {
      const relativePath = relative(REPO_ROOT, file).replace(/\\/g, '/');
      if (VENDOR_ADAPTER_ALLOWLIST.includes(relativePath)) continue;

      for (const specifier of readFileSync(file, 'utf8').matchAll(SPECIFIER_RE)) {
        const packageName = packageNameOf(specifier[1] as string);
        if (packageName && FORBIDDEN_PACKAGES.includes(packageName)) {
          violations.push(`${relativePath} imports "${specifier[1]}"`);
        }
      }
    }

    expect(
      violations,
      'A vendor SDK escaped src/llm/openAiLlmProvider.ts. Put it behind a port in src/ports.',
    ).toEqual([]);
  });

  it('the allowlisted adapter really is the openai adapter (the guard guards)', () => {
    // If the allowlist were pointed at an empty or renamed file, the test above
    // would pass vacuously while the boundary was gone.
    const source = readFileSync(join(REPO_ROOT, VENDOR_ADAPTER_ALLOWLIST[0] as string), 'utf8');
    expect(source).toMatch(/from\s+['"]openai['"]/);
  });

  it('the agent, conversation and app layers reach no network transport directly', () => {
    // The directories the agent task asked to have covered, stated explicitly
    // so the intent survives even if the sweep above is ever narrowed.
    for (const directory of ['src/agent', 'src/conversation', 'src/app']) {
      for (const file of sourceFilesUnder(directory)) {
        const source = readFileSync(file, 'utf8');
        expect(source, `${relative(REPO_ROOT, file)} must not reach the network`).not.toMatch(
          /\bfetch\s*\(|XMLHttpRequest|require\(['"]node:https?['"]\)/,
        );
      }
    }
  });
});
