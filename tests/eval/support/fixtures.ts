/**
 * Fixture builders for the eval-layer tests.
 *
 * FIXTURES ONLY. Nothing here calls a model, samples the host, opens a database
 * or touches `eval-output/`. Every test that uses this file is a pure function of
 * committed data plus a temporary directory, which is what lets these run inside
 * `npm test` alongside Layer A.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ScenarioRun, TurnChecks, TurnRecord } from '../../../src/eval/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The committed environment fixtures. */
export const ENVIRONMENT_FIXTURE_DIR = join(HERE, '..', 'fixtures', 'environment');

export function environmentFixture(name: string): string {
  return join(ENVIRONMENT_FIXTURE_DIR, name);
}

/**
 * A throwaway directory, OUTSIDE the repository.
 *
 * Deliberately under the OS temp directory rather than `.tmp/`: a test that
 * writes report artefacts must have no way of landing on the committed
 * `eval-output/` tree, which is the preliminary evidence a fresh run has to be
 * comparable against.
 */
export function makeTempOutDir(label: string): { readonly path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), `eval-${label}-`));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

/**
 * Copy a committed environment fixture in under the slug the report will look up.
 *
 * The slug is passed explicitly rather than derived, so a test can deliberately
 * file a record under the WRONG model and prove the mismatch is caught.
 */
export function installEnvironmentFixture(outDir: string, fixtureName: string, slug: string): void {
  const destination = join(outDir, 'environment', `${slug}.json`);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(environmentFixture(fixtureName), destination, { force: true });
}

// ---------------------------------------------------------------------------
// Recorded-run fixtures. Only the fields the scorer and the report read are set,
// mirroring `tests/eval/wrongDayGate.test.ts` so the two stay recognisable as
// the same kind of fixture.
// ---------------------------------------------------------------------------

export function fixtureChecks(overrides: Partial<TurnChecks> = {}): TurnChecks {
  return {
    fabricatedTimestamps: [],
    toolSelection: { applicable: true, passed: true, failures: [], assertionsChecked: 1, assertionsPassed: 1 },
    unnecessaryCalls: [],
    toolCalls: [
      {
        toolName: 'schedule_meeting',
        known: true,
        jsonParsed: true,
        schemaValid: true,
        schemaErrors: [],
        hallucinatedContactId: false,
        hallucinatedMeetingId: false,
      },
    ],
    passthrough: { applicable: true, passed: true, detail: '' },
    text: {
      applicable: false,
      passed: true,
      failures: [],
      lengthChars: 42,
      lengthWords: 8,
      lengthScore: 1,
      concreteDatesAsserted: [],
    },
    repetition: { maxSimilarity: 0, verbatimRepeat: false, score: 1 },
    language: { expected: 'en', hebrewLetterRatio: 0, matched: true, detail: '' },
    schedulingIntent: { applicable: true, recognised: true, detail: '' },
    toolFailure: { expected: false, occurred: false, codes: [] },
    ...overrides,
  };
}

export function fixtureTurn(index: number): TurnRecord {
  return {
    index,
    utterance: 'tomorrow afternoon should work',
    note: 'fixture',
    assistantMessages: ['Booked.'],
    assistantText: 'Booked.',
    toolCalls: [{ toolCallId: `c${index}`, toolName: 'schedule_meeting', argumentsJson: '{}' }],
    toolOutcomes: [],
    iterations: 1,
    stopReason: 'MODEL_FINISHED',
    metrics: null,
    turnLatencyMs: 1,
    providerCalls: 1,
    checks: fixtureChecks(),
    error: null,
  };
}

export function fixtureRun(modelId: string, scenarioId = 'intro-interested-lead'): ScenarioRun {
  return {
    harnessVersion: '1.1.0',
    corpusVersion: '1.1.0',
    rubricVersion: '1.1.0',
    judgePromptVersion: '1.0.0',
    modelId,
    providerName: 'fixture',
    contextMode: 'assembled',
    systemPromptRef: 'sales-scheduler-local@v2',
    scenarioId,
    title: 'fixture',
    objective: 'fixture',
    language: 'en',
    coverage: ['interested-lead'],
    status: 'OK',
    error: null,
    contactId: 'contact-1',
    conversationId: 'conversation-1',
    nowUtc: '2026-03-04T08:00:00.000Z',
    priorConversation: [],
    turns: [fixtureTurn(0)],
    judges: {},
    startedAtIso: '2026-03-04T08:00:00.000Z',
    durationMs: 1,
    providerStats: null,
  };
}
