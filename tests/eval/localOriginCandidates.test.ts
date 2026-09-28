/**
 * MISSION 2D-R: the operator-created local model tag, and the two evidence
 * requests docs/MISSION_2D_AYA_ROOT_CAUSE.md § 10 left for the eval side.
 *
 * WHAT THIS FILE IS FOR. A locally-created Ollama tag is not a registry model,
 * and three commands used to assume it was: `eval:pull` would have tried to
 * download it, and `eval:run` and `eval:models` would have told the operator to
 * run `eval:pull` - advice that can never succeed, because there is nothing to
 * pull. These tests pin the distinction, and they pin the thing that matters
 * most about it: THE DEFAULT RUN IS UNCHANGED. A host that never created the
 * tag must behave exactly as it did before this existed.
 *
 * NO MODEL IS CALLED, PULLED OR CREATED HERE, and none can be: every assertion
 * below reads committed bytes - the candidate set, the Modelfile, and a
 * hand-built `ScenarioRun` - and there is no Ollama client in this file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CANDIDATES,
  defaultBenchmarkTags,
  findCandidate,
  isLocalOrigin,
} from '../../src/eval/models/candidates.js';
import { modelSlug } from '../../src/eval/runner/store.js';
import { renderTranscript } from '../../src/eval/runner/transcript.js';
import type { ScenarioRun, TurnChecks, TurnRecord } from '../../src/eval/types.js';
import type { LlmTurnMetrics } from '../../src/ports/llm.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

/** The tag this mission added, and the stock tag it must never disturb. */
const LOCAL_TAG = 'm2b/aya-expanse-schema-tools:v1';
const STOCK_AYA = 'aya-expanse:8b';

// ---------------------------------------------------------------------------
// The candidate set
// ---------------------------------------------------------------------------

describe('a locally-created tag is distinguishable from a registry model', () => {
  it('knows the new tag, and marks it local', () => {
    const candidate = findCandidate(LOCAL_TAG);
    expect(candidate, `${LOCAL_TAG} must be in CANDIDATES for eval:report to keep its row`).toBeDefined();
    expect(isLocalOrigin(candidate!)).toBe(true);
  });

  it('treats every published model as registry-origin, so nothing else changed meaning', () => {
    for (const candidate of CANDIDATES) {
      if (candidate.tag === LOCAL_TAG) continue;
      expect(isLocalOrigin(candidate), `${candidate.tag} must stay a registry model`).toBe(false);
      expect(candidate.localProvenance).toBeUndefined();
    }
  });

  it('EXCLUDES the local tag from the default model list, so a host without it is unaffected', () => {
    // THE LOAD-BEARING ASSERTION OF THIS FILE. `eval:run` with no `--model`
    // resolves `defaultBenchmarkTags()`, and then REFUSES TO START if any tag is
    // absent. If a local tag joined that list, every operator who had not run
    // `ollama create` would find the benchmark broken by a model they never
    // asked for.
    const tags = defaultBenchmarkTags();
    expect(tags).not.toContain(LOCAL_TAG);
    expect(tags).toEqual(CANDIDATES.filter((c) => !isLocalOrigin(c)).map((c) => c.tag));
  });

  it('keeps the default list exactly the five published Mission 2 candidates, in order', () => {
    // Spelled out rather than derived, so that adding a sixth registry model is
    // a deliberate edit here and not a silent change to what `eval:run` does.
    expect(defaultBenchmarkTags()).toEqual([
      'qwen2.5:7b-instruct',
      'mistral:7b-instruct',
      'llama3.1:8b-instruct-q4_K_M',
      STOCK_AYA,
      'hermes3:8b',
    ]);
  });

  it('keeps qwen2.5:7b-instruct first and the local tag last', () => {
    // `generateReportArtefacts` orders tables by candidate order; appending is
    // the only position that reorders no existing row.
    expect(CANDIDATES[0]?.tag).toBe('qwen2.5:7b-instruct');
    expect(CANDIDATES[CANDIDATES.length - 1]?.tag).toBe(LOCAL_TAG);
  });

  it('still carries STOCK aya as its own candidate, because the comparison needs all three', () => {
    // The whole point of the local tag is a three-way run. If the corrected tag
    // had REPLACED stock aya, there would be no control to compare it against.
    expect(defaultBenchmarkTags()).toContain(STOCK_AYA);
    expect(findCandidate(STOCK_AYA)?.localProvenance).toBeUndefined();
  });

  it('gives the tag a project-owned namespace that cannot collide with a registry name', () => {
    expect(LOCAL_TAG.startsWith('m2b/')).toBe(true);
    expect(LOCAL_TAG).not.toBe(STOCK_AYA);
    // An explicit version, so a second corrected template is a new tag rather
    // than a silent redefinition of this one.
    expect(LOCAL_TAG).toMatch(/:v\d+$/);
  });

  it('slugs to its own output directory, so it cannot overwrite stock aya', () => {
    // EVAL_HARNESS.md § 9.8.3 tells the operator to expect this exact slug for
    // `environment/<slug>.json`, and the three-way run depends on all three
    // being distinct - a collision would silently overwrite a control.
    expect(modelSlug(LOCAL_TAG)).toBe('m2b_aya-expanse-schema-tools_v1');
    const slugs = ['qwen2.5:7b-instruct', STOCK_AYA, LOCAL_TAG].map(modelSlug);
    expect(new Set(slugs).size).toBe(3);
    for (const slug of slugs) expect(slug).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('records provenance naming the Modelfile and the unmodified base tag', () => {
    const provenance = findCandidate(LOCAL_TAG)?.localProvenance;
    expect(provenance).toBeDefined();
    expect(provenance?.baseTag).toBe(STOCK_AYA);
    expect(provenance?.modelfile).toBe('src/eval/models/modelfiles/aya-expanse-8b-schema-tools.Modelfile');
    expect(provenance?.deviation.length ?? 0).toBeGreaterThan(40);
  });
});

// ---------------------------------------------------------------------------
// The Modelfile itself
// ---------------------------------------------------------------------------

describe('the committed Modelfile is the one the provenance points at', () => {
  const modelfile = (): string => {
    const provenance = findCandidate(LOCAL_TAG)?.localProvenance;
    return readFileSync(join(REPO_ROOT, provenance!.modelfile), 'utf8');
  };

  /**
   * The ACTIVE template, split from the documentation above it.
   *
   * Anchored on the `TEMPLATE """` DIRECTIVE at the start of a line, not on the
   * word `TEMPLATE`: the header comment uses that word in prose, and anchoring
   * on it put the quoted stock stub inside the "active" slice and made the
   * assertions below meaningless.
   */
  const activeTemplate = (): string => {
    const text = modelfile();
    const at = text.indexOf('\nTEMPLATE """');
    expect(at, 'the Modelfile must carry a TEMPLATE directive at the start of a line').toBeGreaterThan(0);
    return text.slice(at);
  };

  const header = (): string => {
    const text = modelfile();
    return text.slice(0, text.indexOf('\nTEMPLATE """'));
  };

  it('exists at the recorded path and builds FROM the stock tag', () => {
    // `FROM` reads the stock manifest; `ollama create` writes a new one under a
    // new name. This is what makes "the stock tag is never modified" true.
    expect(modelfile()).toContain(`FROM ${STOCK_AYA}`);
  });

  it('names the tag it is meant to be created as, so the two cannot drift', () => {
    expect(modelfile()).toContain(LOCAL_TAG);
  });

  it('RENDERS THE FULL FUNCTION JSON, which is the entire reason it exists', () => {
    // `{{ .Function }}` is what the stock qwen2.5 template uses, and Ollama
    // marshals a ToolFunction to JSON when a template prints it - so this emits
    // the complete parameters JSON Schema: enums, required, nested properties.
    expect(activeTemplate()).toContain('{"type": "function", "function": {{ .Function }}}');
  });

  it('does NOT reintroduce the lossy Python stub that drops every enum', () => {
    // The stock template's `def name(arg: type, ...)` form reads only name, type
    // and description off each property. If any of it survived into the ACTIVE
    // template, the fix would be cosmetic.
    //
    // Scoped to the body after the `TEMPLATE` directive on purpose: the header
    // comment QUOTES the stock stub in order to document what it drops, and a
    // whole-file assertion would fire on that documentation. Asserted both ways
    // so the test cannot pass by the slice being empty.
    const templateBody = activeTemplate();
    expect(templateBody.length).toBeGreaterThan(500);
    expect(templateBody).not.toContain('-> List[Dict]');
    expect(templateBody).not.toContain('$property.Type');
    expect(templateBody).not.toContain('$property.Description');
    // And the stub really is quoted in the header, which is where it belongs.
    expect(header()).toContain('-> List[Dict]');
  });

  it('keeps Cohere\'s trained protocol: the turn tokens and the Action: instruction', () => {
    // The model is trained on this protocol. Replacing the schema rendering is
    // the change; rewriting the protocol would trade a known defect for an
    // unknown one.
    const text = modelfile();
    for (const token of ['<|START_OF_TURN_TOKEN|>', '<|SYSTEM_TOKEN|>', '<|USER_TOKEN|>', '<|CHATBOT_TOKEN|>']) {
      expect(text, `${token} is part of the trained protocol`).toContain(token);
    }
    expect(text).toContain("Write 'Action:' followed by a json-formatted list of actions");
    expect(text).toContain('"tool_name"');
  });

  it('stops instructing the model to call `directly-answer`, which is not one of the nine tools', () => {
    // All six of aya's recorded malformed calls were this sentinel (§ 8.1), and
    // the stock template is what asked for it.
    expect(modelfile()).not.toContain('`directly-answer` tool');
  });

  it('sets no PARAMETER and no SYSTEM, so the benchmark stays the only source of both', () => {
    // A baked-in num_ctx or temperature would make the recorded run conditions a
    // lie; a baked-in system prompt would compete with the versioned one.
    const text = modelfile();
    const directives = text
      .split('\n')
      .filter((line) => /^(PARAMETER|SYSTEM|ADAPTER|LICENSE)\b/.test(line));
    expect(directives).toEqual([]);
  });

  it('says in the file that nothing in this repository creates, pulls or runs it', () => {
    // The file IS the operator instruction. If that disclaimer were lost, a
    // reader could reasonably assume some npm script does it for them.
    expect(modelfile()).toContain('NOTHING IN THIS REPOSITORY CREATES, PULLS OR RUNS THIS MODEL.');
    expect(modelfile()).toContain('ollama create');
  });
});

// ---------------------------------------------------------------------------
// § 10's two requests, rendered
// ---------------------------------------------------------------------------

/** A real, empty `TurnChecks` - spelled out rather than cast, so the renderer
 *  is exercised through the same shape a recorded run produces. */
const NO_CHECKS: TurnChecks = {
  fabricatedTimestamps: [],
  toolSelection: { applicable: false, passed: true, failures: [], assertionsChecked: 0, assertionsPassed: 0 },
  unnecessaryCalls: [],
  toolCalls: [],
  passthrough: { applicable: false, passed: true, detail: '' },
  text: {
    applicable: false,
    passed: true,
    failures: [],
    lengthChars: 7,
    lengthWords: 1,
    lengthScore: null,
    concreteDatesAsserted: [],
  },
  repetition: { maxSimilarity: 0, verbatimRepeat: false, score: 1 },
  language: { expected: 'en', hebrewLetterRatio: 0, matched: true, detail: '' },
  schedulingIntent: { applicable: false, recognised: true, detail: '' },
  toolFailure: { expected: false, occurred: false, codes: [] },
};

const BASE_TURN: TurnRecord = {
  index: 0,
  utterance: 'Could we push it to Friday morning instead?',
  note: 'a turn built by hand for the renderer',
  assistantMessages: ['Action:'],
  assistantText: 'Action:',
  toolCalls: [],
  toolOutcomes: [],
  iterations: 1,
  stopReason: 'stop',
  metrics: null,
  turnLatencyMs: 10,
  providerCalls: 1,
  checks: NO_CHECKS,
  error: null,
};

function runWith(turn: TurnRecord): ScenarioRun {
  return {
    harnessVersion: '1.1.0',
    corpusVersion: '1.1.0',
    rubricVersion: '1.1.0',
    judgePromptVersion: '1.0.0',
    modelId: LOCAL_TAG,
    providerName: 'local',
    contextMode: 'assembled',
    systemPromptRef: 'sales-scheduler-local@v2',
    scenarioId: 'hand-built',
    title: 'Hand-built',
    objective: 'Exercise the renderer',
    language: 'en',
    coverage: [],
    status: 'OK',
    error: null,
    contactId: 'contact_1',
    conversationId: 'conversation_1',
    nowUtc: '2026-03-04T15:00:00.000Z',
    priorConversation: [],
    turns: [turn],
    judges: {},
    startedAtIso: '2026-03-04T15:00:00.000Z',
    durationMs: 10,
    providerStats: null,
  };
}

describe('§ 10 request 1: the provider\'s refusals are rendered per turn', () => {
  it('shows each refusal reason, which used to survive only as a count', () => {
    // § 8.2 removes a refused action list from the assistant text, so before
    // this the only trace of six refusals was the number six.
    const rendered = renderTranscript(
      runWith({
        ...BASE_TURN,
        metrics: {
          modelId: LOCAL_TAG,
          streamed: true,
          timeToFirstTokenMs: 100,
          totalLatencyMs: 200,
          promptTokens: 10,
          generatedTokens: 5,
          tokensPerSecond: 25,
          contextUtilization: 0.1,
          toolCallHealth: {
            native: 0,
            recoveredFromText: 0,
            malformed: 2,
            refusalReasons: ['directly-answer was not offered', 'span did not parse as JSON'],
          },
        } satisfies LlmTurnMetrics,
      }),
    );

    expect(rendered).toContain('provider refused 2 tool-call-shaped span(s) before dispatch');
    expect(rendered).toContain('directly-answer was not offered');
    expect(rendered).toContain('span did not parse as JSON');
  });

  it('adds nothing at all to a turn that refused nothing', () => {
    // The committed evidence must not gain a line it did not have.
    expect(renderTranscript(runWith(BASE_TURN))).not.toContain('provider refused');
  });
});

describe('§ 10 request 2: an argument object is no longer cut off at 400 characters', () => {
  const longArguments = JSON.stringify({
    contact_id: 'contact_1',
    reason: 'x'.repeat(600),
    urgency: 'ROUTINE',
  });

  it('renders the whole object, so a value past 400 chars is still readable', () => {
    // § 5.1: two `transfer_to_human` calls lost their `urgency` to the old limit,
    // and two of forty-four rows in § 5 are INDETERMINATE because of it. The
    // value now survives - which is what makes the operator's next run able to
    // answer them.
    expect(longArguments.length).toBeGreaterThan(400);
    const rendered = renderTranscript(
      runWith({
        ...BASE_TURN,
        toolCalls: [{ toolCallId: 'call_1', toolName: 'transfer_to_human', argumentsJson: longArguments }],
      }),
    );

    expect(rendered).toContain(longArguments);
    expect(rendered).toContain('"urgency":"ROUTINE"');
    expect(rendered).not.toContain('…');
  });

  it('still bounds a pathological generation rather than removing the limit', () => {
    // 4,000 was chosen against the widest legal arguments object in
    // TOOL_DEFINITIONS, not picked for looking round. A model that emits 200 kB
    // of JSON must still not put 200 kB on one line of committed evidence.
    const huge = JSON.stringify({ contact_id: 'c', reason: 'y'.repeat(20_000) });
    const rendered = renderTranscript(
      runWith({
        ...BASE_TURN,
        toolCalls: [{ toolCallId: 'call_1', toolName: 'transfer_to_human', argumentsJson: huge }],
      }),
    );

    expect(rendered).toContain('…');
    expect(rendered).not.toContain(huge);
  });
});
