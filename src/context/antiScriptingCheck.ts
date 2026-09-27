/**
 * `npm run check:anti-scripting` - the mission's hardest rule, made checkable.
 *
 * THE RULE
 * ---------------------------------------------------------------------------
 * Production and demo customer-facing dialogue must never be canned responses,
 * scripted conversation trees, predefined question sequences, hardcoded sales
 * scripts, if-X-then-say-Y conversational logic, or fixed response templates.
 *
 * A rule that lives only in a review checklist is a rule that survives exactly
 * as long as the reviewer's attention. This file is the attempt to make it
 * mechanical, and the attempt is honest about where it stops.
 *
 * TWO SURFACES, TWO KINDS OF RULE
 * ---------------------------------------------------------------------------
 * The rule can be broken in data or in code, and the two need different tools.
 *
 *  DATA - `src/context/profiles/*.json`. Checked LEXICALLY, by loading each
 *  profile through `BusinessProfileSchema`, whose every free-text field runs
 *  `findDialogueShape`. A profile carrying a line to read out, or an
 *  if-they-object-then-say-this entry, does not load - not here and not in
 *  production either, which is the point: this check re-runs the production
 *  code path rather than approximating it.
 *
 *  CODE - `src/agent/**`, `src/conversation/**`, `src/context/**`. Checked
 *  STRUCTURALLY, for the shapes a canned conversation actually takes: a branch
 *  that returns an utterance, a table of replies, a list of questions, an
 *  utterance assigned to something that gets spoken.
 *
 * WHY CODE IS NOT CHECKED LEXICALLY TOO
 * ---------------------------------------------------------------------------
 * Because the customer-facing path is full of text that is SUPPOSED to be
 * there. `src/agent/prompt/clauses.ts` is guardrails - instructions to the
 * model about how to conduct itself - and instructions about speech necessarily
 * talk about speech. Running the lexical rules over it would produce a wall of
 * findings on the single most carefully reviewed file in the repository, and a
 * check that cries wolf on its best file gets switched off.
 *
 * So code is judged on what the text DOES, not on what it says. An utterance
 * that a branch selects and returns is a script whatever its wording; a
 * paragraph telling the model never to invent a price is not, however much it
 * uses the word "say".
 *
 * WHAT THIS CANNOT CATCH - READ THIS BEFORE TRUSTING IT
 * ---------------------------------------------------------------------------
 *  1. A declarative sentence intended to be read out verbatim. "Our onboarding
 *     takes two weeks" is a legitimate fact AND a usable sentence, and nothing
 *     can tell the author's intent apart. The defence is the rendering frame
 *     (facts arrive under an explicit "not sentences to say" heading) and
 *     review.
 *  2. An utterance assembled at runtime from fragments - `greeting + name +
 *     '. ' + opener` - where no single literal looks like speech.
 *  3. An utterance loaded from a file this check does not scan, or from the
 *     database.
 *  4. A template literal whose speech lives inside `${}` interpolation, which
 *     `scanSource` deliberately does not descend into.
 *  5. Anything outside the three scanned directories.
 *
 * Numbers 1 and 2 are the realistic ways this rule gets broken by somebody who
 * is not trying to break it. Neither is caught. That is stated here, in
 * `CONVERSATION_CONTEXT.md`, and in the CLI's own output, because a check whose
 * limits are undocumented reads as a guarantee it cannot give.
 *
 * THE ALLOWLIST
 * ---------------------------------------------------------------------------
 * A line-scoped comment of the form `anti-scripting:allow <RULE_ID> - <reason>`
 * (written after `//`, with the angle brackets replaced by the real rule id and
 * a real reason - spelled with placeholders here so that this paragraph is not
 * itself parsed as an allowance),
 *
 * on the offending line or the line above it. The justification is REQUIRED -
 * an allowance with nothing after the rule id is itself a violation. Every
 * allowance is printed in the report with its reason, so the set can only grow
 * in public.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBusinessProfile } from './businessProfile.js';
import { scanSource, type SourceLiteral } from './sourceLiterals.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

/** The customer-facing path. Everything a contact's words can reach. */
export const SCANNED_DIRECTORIES = ['src/agent', 'src/conversation', 'src/context'] as const;

/** Profiles are loaded through the production schema, which is the lexical check. */
export const SCANNED_PROFILE_DIRECTORY = 'src/context/profiles';

/**
 * Whole files the scan skips, each with the reason it has to.
 *
 * There is exactly one, and it is the corpus of things this check must catch.
 * A file whose job is to contain canned dialogue cannot also be free of it, and
 * pretending otherwise would mean either fifteen line-level allowances or a
 * self-test written in a language the checker does not read.
 *
 * The exemption is narrow in a way that matters: the file is skipped by the
 * REPOSITORY WALK, and its contents are still run through `inspectSource` -
 * that is the entire point of it - so nothing in it escapes the rules. It
 * escapes only the assertion that the rules find nothing.
 *
 * Every exemption is printed by the CLI on every run.
 */
export const FILE_EXEMPTIONS: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'src/context/antiScriptingSelfTest.ts',
    why:
      'The known-bad corpus. Its samples exist to be detected, and they are: every one is fed through the ' +
      'same inspectSource the walk uses, and the non-vacuity self-test - which runs on every invocation - fails ' +
      'if any one of them stops being caught.',
  },
];

/**
 * Identifiers whose value ends up as something a person hears.
 *
 * Kept deliberately short. A long list catches more and means less: `message`
 * and `text` name a hundred things in this codebase that nobody speaks, and a
 * rule that fires on all of them teaches people to ignore it.
 */
const SPOKEN_IDENTIFIERS = [
  'assistantText',
  'agentText',
  'agentSays',
  'utterance',
  'reply',
  'replies',
  'response',
  'responses',
  'greeting',
  'greetings',
  'spoken',
  'says',
  'script',
  'scripts',
  'openingLine',
  'closingLine',
  'rebuttal',
  'rebuttals',
  'cannedResponse',
  'responseTemplate',
  'talkTrack',
];

export interface AntiScriptingViolation {
  readonly ruleId: string;
  readonly file: string;
  readonly line: number;
  readonly detail: string;
  readonly excerpt: string;
}

export interface AntiScriptingAllowance {
  readonly ruleId: string;
  readonly file: string;
  readonly line: number;
  readonly justification: string;
}

export interface AntiScriptingReport {
  readonly filesScanned: number;
  readonly literalsExamined: number;
  readonly profilesValidated: readonly string[];
  readonly violations: readonly AntiScriptingViolation[];
  readonly allowances: readonly AntiScriptingAllowance[];
  /** Allowances written without a reason. Treated as violations. */
  readonly unjustifiedAllowances: readonly AntiScriptingAllowance[];
}

/** Every rule this check can report, so the self-test can demand each one fires. */
export const ANTI_SCRIPTING_RULE_IDS = [
  'DIALOGUE_BRANCH',
  'CANNED_UTTERANCE_ASSIGNMENT',
  'CANNED_REPLY_TABLE',
  'FIXED_QUESTION_SEQUENCE',
  'SPEECH_LITERAL',
] as const;

export type AntiScriptingRuleId = (typeof ANTI_SCRIPTING_RULE_IDS)[number];

/**
 * Run every code rule over a source string.
 *
 * Exported so the same detectors that police the repository can be pointed at
 * known-bad and known-good samples by the non-vacuity self-test. A corpus of conditional
 * checks that has never been shown to fire is indistinguishable from a corpus
 * that cannot fire, which is the exact failure mode `tests/invariants/` calls
 * vacuity and guards against by hand.
 */
export function inspectSource(source: string, file = '<memory>'): AntiScriptingViolation[] {
  const scanned = scanSource(source);
  const allowed = collectAllowances(source, file).covering;
  return [
    ...findDialogueBranches(scanned, file),
    ...findSpokenAssignments(scanned, file),
    ...findReplyTables(scanned, file),
    ...findQuestionSequences(scanned, file),
    ...findSpeechLiterals(scanned, file),
  ].filter((violation) => !isAllowed(allowed, violation));
}

// ---------------------------------------------------------------------------
// Is this literal a thing a person would hear?
// ---------------------------------------------------------------------------

/** A speaker referring to themselves: the hallmark of an utterance. */
const SPEAKER_MARKER =
  /\b(?:I'(?:ll|ve|m|d)|we'(?:ll|ve|re)|let me|let's|I can help|I'd be happy|I will call|I have booked)\b/i;

/** Direct address, or the social furniture of a phone call. */
const ADDRESS_MARKER =
  /\b(?:you're|you'll|you've|your|thanks|thank you|sorry|of course|no problem|happy to|absolutely|certainly|apologi[sz]|all set|great news|sounds good)\b/i;

/**
 * True when a literal reads like something spoken to a contact.
 *
 * Two independent signals are required, not one. "you" alone appears in every
 * guardrail clause in the repository because guardrails address the model as
 * "you"; a first-person speaker marker alone appears in comments. Together they
 * are the shape of a sentence somebody says out loud to somebody else.
 */
export function isUtteranceShaped(value: string): boolean {
  const text = value.trim();
  if (text.length < 12) return false;
  const speaker = SPEAKER_MARKER.test(text);
  if (!speaker) return false;
  return ADDRESS_MARKER.test(text) || /[?!]\s*$/.test(text) || /^[A-Z][^.!?]*[.!?]/.test(text);
}

/** A question put to a person, for the fixed-question-sequence rule. */
function isQuestionUtterance(value: string): boolean {
  const text = value.trim();
  return text.length >= 12 && text.endsWith('?') && /\b(?:you|your|you're|we|I)\b/i.test(text);
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

export function runAntiScriptingCheck(repoRoot: string = REPO_ROOT): AntiScriptingReport {
  const violations: AntiScriptingViolation[] = [];
  const allowances: AntiScriptingAllowance[] = [];
  const unjustifiedAllowances: AntiScriptingAllowance[] = [];

  // ---- 1. DATA: every profile must load through the production schema ----
  const profilesValidated: string[] = [];
  const profileDirectory = join(repoRoot, SCANNED_PROFILE_DIRECTORY);
  for (const file of listFiles(profileDirectory, '.json')) {
    const relativePath = relative(repoRoot, file).replace(/\\/g, '/');
    try {
      loadBusinessProfile({ profilePath: file });
      profilesValidated.push(relativePath);
    } catch (error) {
      violations.push({
        ruleId: 'PROFILE_REJECTED',
        file: relativePath,
        line: 1,
        detail:
          'This profile does not load through BusinessProfileSchema. Every free-text field is checked for ' +
          `dialogue shape, so a scripted line fails here exactly as it would in production. ${
            error instanceof Error ? error.message : String(error)
          }`,
        excerpt: '',
      });
    }
  }

  // ---- 2. CODE: structural rules over the customer-facing path -----------
  let filesScanned = 0;
  let literalsExamined = 0;

  for (const directory of SCANNED_DIRECTORIES) {
    for (const file of listFiles(join(repoRoot, directory), '.ts')) {
      const relativePath = relative(repoRoot, file).replace(/\\/g, '/');
      if (FILE_EXEMPTIONS.some((exemption) => exemption.file === relativePath)) continue;
      const source = readFileSync(file, 'utf8');
      const scanned = scanSource(source);
      const allowed = collectAllowances(source, relativePath);

      for (const entry of allowed.declared) {
        (entry.justification ? allowances : unjustifiedAllowances).push(entry);
      }

      filesScanned += 1;
      literalsExamined += scanned.literals.length;

      const found = [
        ...findDialogueBranches(scanned, relativePath),
        ...findSpokenAssignments(scanned, relativePath),
        ...findReplyTables(scanned, relativePath),
        ...findQuestionSequences(scanned, relativePath),
        ...findSpeechLiterals(scanned, relativePath),
      ];

      for (const violation of found) {
        if (isAllowed(allowed.covering, violation)) continue;
        violations.push(violation);
      }
    }
  }

  return {
    filesScanned,
    literalsExamined,
    profilesValidated,
    violations,
    allowances,
    unjustifiedAllowances,
  };
}

// ---------------------------------------------------------------------------
// Rule 1: a branch that selects an utterance
// ---------------------------------------------------------------------------

/**
 * `if (state === X) return "..."`, `case READY: return "..."`,
 * `x ? "..." : "..."` - the Founder directive's if-X-then-say-Y, in any of the
 * spellings JavaScript offers.
 *
 * Detected by looking BACKWARDS from an utterance-shaped literal: is it the
 * thing a `return`, an arrow body or a ternary arm produces, and is there a
 * conditional immediately above it? Both halves are needed. A `return` of a
 * constant is fine; a branch returning a computed string is fine; a branch
 * returning a sentence somebody wrote is the violation.
 */
function findDialogueBranches(
  scanned: ReturnType<typeof scanSource>,
  file: string,
): AntiScriptingViolation[] {
  const out: AntiScriptingViolation[] = [];
  const source = scanned.withoutComments;

  for (const literal of scanned.literals) {
    if (!isUtteranceShaped(literal.value)) continue;

    const before = source.slice(Math.max(0, literal.start - 240), literal.start);
    const producesValue = /(?:\breturn\b|=>|\?|:)\s*$/.test(before);
    if (!producesValue) continue;

    const hasConditional = /\b(?:if|case|switch|else)\b|===|!==|\?\?/.test(before);
    if (!hasConditional) continue;

    out.push({
      ruleId: 'DIALOGUE_BRANCH',
      file,
      line: literal.line,
      detail:
        'A conditional branch produces a sentence that reads like something spoken to a contact. ' +
        'Deciding WHAT to say from application state is the scripted-conversation pattern this mission ' +
        'forbids. Supply the fact or the goal instead, and let the model write the sentence.',
      excerpt: excerpt(literal),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule 2: an utterance assigned to something that gets spoken
// ---------------------------------------------------------------------------

function findSpokenAssignments(
  scanned: ReturnType<typeof scanSource>,
  file: string,
): AntiScriptingViolation[] {
  const out: AntiScriptingViolation[] = [];
  const source = scanned.withoutComments;
  const namePattern = new RegExp(`\\b(${SPOKEN_IDENTIFIERS.join('|')})\\s*[:=]\\s*$`);

  for (const literal of scanned.literals) {
    if (!isUtteranceShaped(literal.value)) continue;
    const before = source.slice(Math.max(0, literal.start - 80), literal.start);
    const match = namePattern.exec(before);
    if (!match) continue;

    out.push({
      ruleId: 'CANNED_UTTERANCE_ASSIGNMENT',
      file,
      line: literal.line,
      detail:
        `A written-out sentence is assigned to "${match[1]}", which is a name for something a contact hears. ` +
        'Whatever is spoken must come from the model.',
      excerpt: excerpt(literal),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule 3: a table of replies
// ---------------------------------------------------------------------------

/**
 * Two or more utterances as values in one object literal.
 *
 * This is the canned-response table: keys are situations, values are what to
 * say. Grouping by the enclosing `{` is what makes it a table rather than two
 * unrelated strings that happen to be near each other.
 */
function findReplyTables(scanned: ReturnType<typeof scanSource>, file: string): AntiScriptingViolation[] {
  const source = scanned.withoutComments;
  const byBrace = new Map<number, SourceLiteral[]>();

  for (const literal of scanned.literals) {
    if (literal.enclosingBrace < 0) continue;
    if (!isUtteranceShaped(literal.value)) continue;
    // Only a value position counts. A key that happens to be a sentence is odd
    // but harmless; a value is the thing that gets used.
    const before = source.slice(Math.max(0, literal.start - 60), literal.start);
    if (!/[:=]\s*$/.test(before)) continue;
    const group = byBrace.get(literal.enclosingBrace) ?? [];
    group.push(literal);
    byBrace.set(literal.enclosingBrace, group);
  }

  const out: AntiScriptingViolation[] = [];
  for (const group of byBrace.values()) {
    if (group.length < 2) continue;
    const first = group[0];
    if (!first) continue;
    out.push({
      ruleId: 'CANNED_REPLY_TABLE',
      file,
      line: first.line,
      detail:
        `${group.length} written-out sentences sit as values in one object literal, keyed by situation. ` +
        'That is a canned-response table however it is named. The model composes the reply; data supplies facts.',
      excerpt: group.map((entry) => excerpt(entry)).join(' | '),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule 4: a fixed sequence of questions
// ---------------------------------------------------------------------------

function findQuestionSequences(
  scanned: ReturnType<typeof scanSource>,
  file: string,
): AntiScriptingViolation[] {
  const byBracket = new Map<number, SourceLiteral[]>();

  for (const literal of scanned.literals) {
    if (literal.enclosingBracket < 0) continue;
    if (!isQuestionUtterance(literal.value)) continue;
    const group = byBracket.get(literal.enclosingBracket) ?? [];
    group.push(literal);
    byBracket.set(literal.enclosingBracket, group);
  }

  const out: AntiScriptingViolation[] = [];
  for (const group of byBracket.values()) {
    if (group.length < 2) continue;
    const first = group[0];
    if (!first) continue;
    out.push({
      ruleId: 'FIXED_QUESTION_SEQUENCE',
      file,
      line: first.line,
      detail:
        `${group.length} written-out questions sit in one array. An ordered list of questions is a discovery ` +
        'script. Record what is still unknown as facts; the model decides whether, when and how to ask.',
      excerpt: group.map((entry) => excerpt(entry)).join(' | '),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule 5: a long utterance anywhere on the path
// ---------------------------------------------------------------------------

/**
 * The backstop. A substantial sentence that reads as speech, wherever it sits.
 *
 * This is the rule most likely to need an allowance, because a guardrail clause
 * sometimes has to QUOTE an utterance to contrast a good one with a bad one.
 * That is a legitimate use and the allowlist exists for it - with a reason, in
 * the open, visible in every run's report.
 */
function findSpeechLiterals(scanned: ReturnType<typeof scanSource>, file: string): AntiScriptingViolation[] {
  const out: AntiScriptingViolation[] = [];
  for (const literal of scanned.literals) {
    if (literal.value.trim().length < 40) continue;
    if (!isUtteranceShaped(literal.value)) continue;
    out.push({
      ruleId: 'SPEECH_LITERAL',
      file,
      line: literal.line,
      detail:
        'A long written-out sentence that reads as speech to a contact. If it is genuinely a guardrail ' +
        'example or persona text rather than something that reaches a caller, allow it on this line with a ' +
        'reason.',
      excerpt: excerpt(literal),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Allowances
// ---------------------------------------------------------------------------

/**
 * The reason group is `[^\n]*` rather than `(.*)` ON PURPOSE.
 *
 * `.` does not match a carriage return. The committed blobs here are LF, but
 * `core.autocrlf=true` and no `.gitattributes` means a working tree on this
 * repository's own configuration is CRLF - so with `(.*)$` the regex could not
 * consume the `\r` a CRLF line leaves on the end of each `split('\n')` element,
 * the whole match failed, and a directive WITH a reason was silently ignored:
 * the one shape the allowlist exists to honour. (A directive with no reason
 * still matched, because `\s*` eats the `\r`; it is rejected later for having no
 * justification. So the bug suppressed exactly the valid allowances and none of
 * the invalid ones.)
 *
 * Which means the check's VERDICT depended on how the reader had cloned: green
 * on an LF checkout, `exit 1` on a CRLF one, same commit. Do not "fix" that by
 * normalising line endings in `.gitattributes` - a source-hygiene check must not
 * be defeasible by a line ending under any configuration.
 *
 * `[^\n]*` consumes the `\r` into the captured reason, where the `.trim()` in
 * `collectAllowances` removes it. `KNOWN_GOOD` carries a CRLF sample so the
 * non-vacuity self-test fails if this regresses.
 */
const ALLOW_RE = /\/\/\s*anti-scripting:allow\s+([A-Z_]+)\s*(?:[-–—:]\s*([^\n]*))?$/;

interface CollectedAllowances {
  /** Keyed `RULE@line` for every line a directive covers. */
  readonly covering: Map<string, AntiScriptingAllowance>;
  /** One entry per directive as written, for the report. */
  readonly declared: readonly AntiScriptingAllowance[];
}

function collectAllowances(source: string, file: string): CollectedAllowances {
  const covering = new Map<string, AntiScriptingAllowance>();
  const declared: AntiScriptingAllowance[] = [];
  const lines = source.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const match = ALLOW_RE.exec(lines[index] ?? '');
    if (!match) continue;
    const ruleId = match[1] ?? '';
    const justification = (match[2] ?? '').trim();
    const line = index + 1;
    declared.push({ ruleId, file, line, justification });
    // A directive covers its own line and the line after it, so it can sit
    // above the code it exempts as well as beside it.
    for (const covered of [line, line + 1]) {
      covering.set(`${ruleId}@${covered}`, { ruleId, file, line: covered, justification });
    }
  }
  return { covering, declared };
}

function isAllowed(allowed: Map<string, AntiScriptingAllowance>, violation: AntiScriptingViolation): boolean {
  const entry = allowed.get(`${violation.ruleId}@${violation.line}`);
  return entry !== undefined && entry.justification.length > 0;
}

// ---------------------------------------------------------------------------

function listFiles(directory: string, extension: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }

  const out: string[] = [];
  for (const entry of entries.sort()) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full, extension));
    } else if (extname(full) === extension) {
      out.push(full);
    }
  }
  return out;
}

function excerpt(literal: SourceLiteral): string {
  const value = literal.value.trim().replace(/\s+/g, ' ');
  return value.length <= 90 ? value : `${value.slice(0, 89)}…`;
}
