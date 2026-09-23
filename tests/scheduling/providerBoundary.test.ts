/**
 * THE BOUNDARY GUARD.
 *
 * The port architecture only means something if the core cannot quietly reach
 * around it. Comments and code review are not enough - the first time someone
 * needs a Twilio type "just for this one field", the boundary is gone and
 * nothing fails. So this test fails the build instead.
 *
 * It reads the source of `src/scheduling`, `src/followup`, `src/domain` and
 * `src/providers` and asserts that none of them import a vendor SDK. Note that
 * `openai` IS a real dependency of this repository, used by the agent layer in
 * `src/llm` - which is exactly why scanning by hand would not be reliable.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Directories that must stay vendor-free.
 *
 * The mission names the first three. `src/providers` is included as well: the
 * deterministic doubles exist precisely BECAUSE no vendor SDK is authorized,
 * and a double that reached the network would be worse than no double at all.
 * A future real adapter would live in its own file and this list would name the
 * directories that may not import it.
 */
const GUARDED_DIRECTORIES = ['src/scheduling', 'src/followup', 'src/domain', 'src/providers'];

/**
 * Package names that mean a vendor SDK, plus the generic HTTP clients that
 * would let one in by the back door.
 */
const FORBIDDEN_PACKAGES = [
  // LLM vendors
  'openai',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  // Calendar vendors
  'googleapis',
  'google-auth-library',
  '@google-cloud/local-auth',
  '@microsoft/microsoft-graph-client',
  '@azure/identity',
  '@azure/msal-node',
  // Telephony vendors
  'twilio',
  'telnyx',
  '@vonage/server-sdk',
  '@vonage/voice',
  'vapi',
  '@vapi-ai/server-sdk',
  'retell-sdk',
  'retell-client-js-sdk',
  // Generic transports: no direct network access from the core, either.
  'axios',
  'node-fetch',
  'got',
  'undici',
  'superagent',
];

/** `import ... from 'x'`, `import('x')`, `require('x')`, `export ... from 'x'`. */
const SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

function sourceFilesUnder(directory: string): string[] {
  const absolute = join(REPO_ROOT, directory);
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (extname(full) === '.ts') {
        found.push(full);
      }
    }
  };
  walk(absolute);
  return found;
}

function importsIn(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  for (const match of source.matchAll(SPECIFIER_RE)) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

/** `@scope/pkg/sub` -> `@scope/pkg`; `pkg/sub` -> `pkg`. Relative paths -> null. */
function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return null;
  }
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? null);
}

describe('the vendor-SDK boundary', () => {
  it('finds source files to check (so a passing run is never vacuous)', () => {
    for (const directory of GUARDED_DIRECTORIES) {
      expect(sourceFilesUnder(directory).length, `${directory} has no .ts files`).toBeGreaterThan(0);
    }
  });

  it.each(GUARDED_DIRECTORIES)('%s imports no vendor SDK', (directory) => {
    const violations: string[] = [];

    for (const file of sourceFilesUnder(directory)) {
      for (const specifier of importsIn(file)) {
        const packageName = packageNameOf(specifier);
        if (packageName && FORBIDDEN_PACKAGES.includes(packageName)) {
          violations.push(`${relative(REPO_ROOT, file)} imports "${specifier}"`);
        }
      }
    }

    expect(violations, `Vendor SDK imported inside ${directory}. Put it behind a port in src/providers.`).toEqual(
      [],
    );
  });

  it('detects a violation when one is really there (the guard guards)', () => {
    // Proves the matcher works, so a green run above means something.
    expect(packageNameOf('twilio')).toBe('twilio');
    expect(packageNameOf('@vonage/server-sdk/lib/x.js')).toBe('@vonage/server-sdk');
    expect(packageNameOf('openai')).toBe('openai');
    expect(FORBIDDEN_PACKAGES).toContain(packageNameOf('googleapis/build/src/index.js'));
    expect(packageNameOf('./local.js')).toBeNull();
    expect(packageNameOf('node:crypto')).toBeNull();
  });

  it('keeps the telephony and calendar doubles free of any network transport', () => {
    // Stated separately from the package list: these two files are the ones a
    // "just make it actually dial" change would touch first.
    for (const file of [
      'src/providers/deterministicTelephonyProvider.ts',
      'src/providers/deterministicCalendarProvider.ts',
    ]) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      expect(source, `${file} must not reach the network`).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|node:https?\b/);
    }
  });
});
