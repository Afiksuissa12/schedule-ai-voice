/**
 * The programmatic half of the rubric: everything that can be MEASURED.
 *
 * Nothing in this file asks a model anything. Every function here is a pure
 * function of a real turn - what the model called, what it sent, what the real
 * dispatcher said back - and produces the same answer every time it is run.
 * That is what makes these numbers usable as evidence rather than as opinion.
 *
 * Where a check is genuinely a heuristic (language detection, similarity,
 * concrete-date detection) it says so at the function, and the raw quantity is
 * carried into the results JSON alongside the verdict so a reader can second-
 * guess the threshold without re-running anything.
 */
import { TOOL_DEFINITIONS, findToolDefinition, isToolName } from '../../agent/tools/definitions.js';
import type { ScenarioLanguage, BenchmarkTurn } from '../corpus/schema.js';

// ---------------------------------------------------------------------------
// THE GATE: a manufactured timestamp.
// ---------------------------------------------------------------------------

/**
 * Patterns that mean "this is a resolved instant, not a person's words".
 *
 * Every one of these requires a YEAR or a full ISO shape. That is deliberate:
 * "Thursday at 3" is the contact's language and must pass through untouched,
 * whereas "2026-03-05T15:00:00Z" can only have come from the model doing
 * arithmetic it was explicitly forbidden to do.
 */
const MONTHS =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

export const FABRICATION_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'iso-datetime', re: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/g },
  { name: 'iso-date', re: /\b\d{4}-\d{2}-\d{2}\b/g },
  { name: 'numeric-date-with-year', re: /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g },
  { name: 'month-name-with-year', re: new RegExp(`\\b${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'gi') },
  { name: 'day-month-name-with-year', re: new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS}\\.?,?\\s+\\d{4}\\b`, 'gi') },
  { name: 'epoch-seconds', re: /\b1[6-9]\d{8}\b/g },
];

export interface FabricationFinding {
  readonly pattern: string;
  readonly matched: string;
  readonly toolName: string;
  readonly field: string;
}

/**
 * Did the model manufacture a timestamp in a time-bearing tool argument?
 *
 * EXEMPTION, and it matters: if the matched text also appears in something the
 * contact said, the model passed their words through and that is exactly
 * correct. A contact is perfectly entitled to say "2026-03-05"; the model is
 * not entitled to derive it.
 */
export function detectFabricatedTimestamps(
  toolCalls: ReadonlyArray<{ toolName: string; argumentsJson: string }>,
  contactUtterancesSoFar: readonly string[],
): FabricationFinding[] {
  const spoken = normalizeForMatch(contactUtterancesSoFar.join(' \u0001 '));
  const findings: FabricationFinding[] = [];

  for (const call of toolCalls) {
    const definition = findToolDefinition(call.toolName);
    // Only time-bearing tools can carry an authoritative instant.
    if (!definition?.timeBearing) continue;

    const args = safeParseJson(call.argumentsJson);
    if (!args || typeof args !== 'object') continue;

    for (const [field, value] of Object.entries(args as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      for (const { name, re } of FABRICATION_PATTERNS) {
        for (const match of value.matchAll(new RegExp(re.source, re.flags))) {
          const matched = match[0];
          if (spoken.includes(normalizeForMatch(matched))) continue; // the contact said it
          findings.push({ pattern: name, matched, toolName: call.toolName, field });
        }
      }
    }
  }
  return findings;
}

/**
 * A softer detector, for ASSISTANT TEXT on turns that opt in.
 *
 * Broader than the gate because in prose a model betrays itself with "Thursday
 * the 5th" as readily as with an ISO string - but it is NOT the gate, because
 * prose is fuzzier and a false positive must not be able to fail a model
 * outright.
 */
const TEXT_CONCRETE_DATE_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  ...FABRICATION_PATTERNS,
  {
    name: 'weekday-with-ordinal',
    re: /\b(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\b/gi,
  },
  { name: 'month-name-with-ordinal', re: new RegExp(`\\b${MONTHS}\\s+\\d{1,2}(?:st|nd|rd|th)\\b`, 'gi') },
  { name: 'ordinal-of-month-name', re: new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)\\s+of\\s+${MONTHS}\\b`, 'gi') },
];

export function detectConcreteDateInText(text: string, contactUtterancesSoFar: readonly string[]): string[] {
  const spoken = normalizeForMatch(contactUtterancesSoFar.join(' \u0001 '));
  const hits: string[] = [];
  for (const { re } of TEXT_CONCRETE_DATE_PATTERNS) {
    for (const match of text.matchAll(new RegExp(re.source, re.flags))) {
      if (spoken.includes(normalizeForMatch(match[0]))) continue;
      hits.push(match[0]);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Tool arguments, against the REAL schemas.
// ---------------------------------------------------------------------------

export interface ToolCallCheck {
  readonly toolName: string;
  readonly known: boolean;
  readonly jsonParsed: boolean;
  readonly schemaValid: boolean;
  readonly schemaErrors: string[];
  readonly hallucinatedContactId: boolean;
  readonly hallucinatedMeetingId: boolean;
}

/**
 * Parse and validate one proposed call exactly as the dispatcher would.
 *
 * Using the real `TOOL_DEFINITIONS` schema rather than a copy is the point: a
 * benchmark validating against its own idea of the contract would keep passing
 * after the contract changed.
 */
export function checkToolCall(
  call: { toolName: string; argumentsJson: string },
  context: { realContactId: string; knownMeetingIds: ReadonlySet<string> },
): ToolCallCheck {
  const known = isToolName(call.toolName);
  const parsed = safeParseJson(call.argumentsJson);
  const jsonParsed = parsed !== undefined;

  if (!known || !jsonParsed) {
    return {
      toolName: call.toolName,
      known,
      jsonParsed,
      schemaValid: false,
      schemaErrors: known ? ['arguments were not valid JSON'] : [`unknown tool "${call.toolName}"`],
      hallucinatedContactId: false,
      hallucinatedMeetingId: false,
    };
  }

  const definition = TOOL_DEFINITIONS[call.toolName as keyof typeof TOOL_DEFINITIONS];
  const result = definition.schema.safeParse(parsed);
  const args = (parsed ?? {}) as Record<string, unknown>;

  const contactId = args['contact_id'];
  const meetingId = args['meeting_id'];

  return {
    toolName: call.toolName,
    known: true,
    jsonParsed: true,
    schemaValid: result.success,
    schemaErrors: result.success ? [] : result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    hallucinatedContactId: typeof contactId === 'string' && contactId !== context.realContactId,
    // Only meaningful once the model has been shown at least one meeting id.
    hallucinatedMeetingId: typeof meetingId === 'string' && !context.knownMeetingIds.has(meetingId),
  };
}

// ---------------------------------------------------------------------------
// Tool selection, against the turn's stated expectation.
// ---------------------------------------------------------------------------

export interface ToolSelectionResult {
  readonly applicable: boolean;
  readonly passed: boolean;
  readonly failures: string[];
  readonly unnecessaryCalls: string[];
  /**
   * Sub-assertions checked and passed, so the score can be partial.
   *
   * A turn that satisfies "call one of these" but also touches one forbidden
   * tool is not as wrong as one that does neither, and a binary pass/fail would
   * record them identically.
   */
  readonly assertionsChecked: number;
  readonly assertionsPassed: number;
}

export function checkToolSelection(turn: BenchmarkTurn, calledTools: readonly string[]): ToolSelectionResult {
  const expectation = turn.tools;
  if (!expectation) {
    return {
      applicable: false,
      passed: true,
      failures: [],
      unnecessaryCalls: [],
      assertionsChecked: 0,
      assertionsPassed: 0,
    };
  }

  const failures: string[] = [];
  const called = new Set(calledTools);
  let checked = 0;
  let passed = 0;

  if (expectation.mustCallNone) {
    checked += 1;
    if (calledTools.length > 0) failures.push(`expected no tool call, got ${calledTools.join(', ')}`);
    else passed += 1;
  }

  if (expectation.mustCallOneOf) {
    checked += 1;
    if (expectation.mustCallOneOf.some((name) => called.has(name))) passed += 1;
    else
      failures.push(
        `expected one of [${expectation.mustCallOneOf.join(', ')}], got ${calledTools.length ? calledTools.join(', ') : '(none)'}`,
      );
  }

  for (const forbidden of expectation.mustNotCall ?? []) {
    checked += 1;
    if (called.has(forbidden)) failures.push(`called forbidden tool ${forbidden}`);
    else passed += 1;
  }

  // `allowed` describes what is defensible. `mustCallNone` already says
  // "nothing", so an empty allow-list is implied there rather than restated.
  const allowed = expectation.allowed ?? (expectation.mustCallNone ? [] : undefined);
  const unnecessaryCalls =
    allowed === undefined ? [] : [...called].filter((name) => !allowed.includes(name));

  return {
    applicable: checked > 0,
    passed: failures.length === 0,
    failures,
    unnecessaryCalls,
    assertionsChecked: checked,
    assertionsPassed: passed,
  };
}

// ---------------------------------------------------------------------------
// Passthrough: did the contact's words survive?
// ---------------------------------------------------------------------------

export interface PassthroughResult {
  readonly applicable: boolean;
  readonly passed: boolean;
  readonly detail: string;
}

export function checkPassthrough(
  turn: BenchmarkTurn,
  toolCalls: ReadonlyArray<{ toolName: string; argumentsJson: string }>,
): PassthroughResult {
  const expectation = turn.passthrough;
  if (!expectation) return { applicable: false, passed: true, detail: '' };

  const matching = toolCalls.filter((c) => c.toolName === expectation.tool);
  if (matching.length === 0) {
    // The scenario allows several tools; not reaching this one is a
    // tool-selection question, not a passthrough failure. Scored there.
    return { applicable: false, passed: true, detail: `${expectation.tool} was not called on this turn` };
  }

  for (const call of matching) {
    const args = safeParseJson(call.argumentsJson);
    const value = args && typeof args === 'object' ? (args as Record<string, unknown>)[expectation.field] : undefined;
    if (typeof value !== 'string') continue;
    const haystack = normalizeForMatch(value);
    const hit = expectation.mustContainAnyOf.find((needle) => haystack.includes(normalizeForMatch(needle)));
    if (hit) {
      return { applicable: true, passed: true, detail: `"${value}" carries "${hit}"` };
    }
  }

  const sent = matching
    .map((c) => {
      const args = safeParseJson(c.argumentsJson);
      const v = args && typeof args === 'object' ? (args as Record<string, unknown>)[expectation.field] : undefined;
      return typeof v === 'string' ? `"${v}"` : '(field absent)';
    })
    .join(', ');

  return {
    applicable: true,
    passed: false,
    detail: `${expectation.tool}.${expectation.field} was ${sent}; expected it to carry one of [${expectation.mustContainAnyOf.join(', ')}]`,
  };
}

// ---------------------------------------------------------------------------
// THE SECOND GATE: the resolved instant landed on the wrong calendar day.
// ---------------------------------------------------------------------------

/** One resolved instant, as the real dispatcher reported it back. */
export interface ResolvedInstant {
  readonly toolName: string;
  readonly ok: boolean;
  /** `yyyy-MM-ddTHH:mm` in `resolvedTimezone`. Null when nothing resolved. */
  readonly resolvedStartLocal: string | null;
  readonly resolvedTimezone: string | null;
}

export interface ResolvedDayResult {
  readonly applicable: boolean;
  readonly passed: boolean;
  readonly expectedLocalDate: string | null;
  readonly observedLocalDates: readonly string[];
  readonly detail: string;
}

/**
 * Did the instant the product actually committed to land on the day the contact
 * named?
 *
 * This is deliberately NOT a check on the model. The model's job ended when it
 * passed the contact's words through; everything after that is application code,
 * and this measures application code. It is in the rubric anyway because the
 * harness is the only place in this repository where the whole chain runs end to
 * end, and a wrong-day booking that nothing reports is worse than a refusal that
 * everything reports.
 *
 * NOT APPLICABLE when nothing resolved - a refused `when` produces no instant,
 * and refusing is the safe outcome. Comparison is on the LOCAL date, in the zone
 * the slot resolved in, because "the day the contact named" is a wall-clock fact
 * about their calendar and not about UTC.
 */
export function checkResolvedDay(turn: BenchmarkTurn, outcomes: readonly ResolvedInstant[]): ResolvedDayResult {
  const expectation = turn.resolvedDay;
  if (!expectation) {
    return { applicable: false, passed: true, expectedLocalDate: null, observedLocalDates: [], detail: '' };
  }

  const resolved = outcomes.filter(
    (o): o is ResolvedInstant & { resolvedStartLocal: string } => o.ok && typeof o.resolvedStartLocal === 'string',
  );

  if (resolved.length === 0) {
    return {
      applicable: false,
      passed: true,
      expectedLocalDate: expectation.mustResolveToLocalDate,
      observedLocalDates: [],
      detail:
        'no instant was resolved on this turn (the call was refused, or none was made), so there is no ' +
        'booking to be wrong about',
    };
  }

  const observed = resolved.map((o) => ({
    toolName: o.toolName,
    localDate: o.resolvedStartLocal.slice(0, 10),
    startLocal: o.resolvedStartLocal,
    timezone: o.resolvedTimezone,
  }));
  const wrong = observed.filter((o) => o.localDate !== expectation.mustResolveToLocalDate);

  if (wrong.length === 0) {
    return {
      applicable: true,
      passed: true,
      expectedLocalDate: expectation.mustResolveToLocalDate,
      observedLocalDates: observed.map((o) => o.localDate),
      detail: `resolved to ${expectation.mustResolveToLocalDate}, the day "${expectation.contactSaid}" names`,
    };
  }

  return {
    applicable: true,
    passed: false,
    expectedLocalDate: expectation.mustResolveToLocalDate,
    observedLocalDates: observed.map((o) => o.localDate),
    detail:
      `the contact said "${expectation.contactSaid}" (= ${expectation.mustResolveToLocalDate}), but ` +
      wrong
        .map((o) => `${o.toolName} was accepted for ${o.startLocal}${o.timezone ? ` ${o.timezone}` : ''}`)
        .join('; ') +
      ' - a validated booking on the wrong calendar day',
  };
}

// ---------------------------------------------------------------------------
// Assistant text expectations.
// ---------------------------------------------------------------------------

export interface TextCheckResult {
  readonly applicable: boolean;
  readonly passed: boolean;
  readonly failures: string[];
  readonly lengthChars: number;
  readonly lengthWords: number;
  /** 1 when within budget, degrading linearly to 0 at twice the budget. */
  readonly lengthScore: number | null;
  readonly concreteDatesAsserted: string[];
}

export function checkText(
  turn: BenchmarkTurn,
  text: string | null,
  contactUtterancesSoFar: readonly string[],
): TextCheckResult {
  const value = text ?? '';
  const lengthChars = value.length;
  const lengthWords = value.trim() ? value.trim().split(/\s+/).length : 0;
  const expectation = turn.text;

  if (!expectation) {
    return {
      applicable: false,
      passed: true,
      failures: [],
      lengthChars,
      lengthWords,
      lengthScore: null,
      concreteDatesAsserted: [],
    };
  }

  const failures: string[] = [];
  const lower = value.toLowerCase();

  if (expectation.mustNotBeEmpty && value.trim().length === 0) {
    failures.push('produced no assistant text at all');
  }
  if (expectation.minChars !== undefined && lengthChars < expectation.minChars) {
    failures.push(`reply was ${lengthChars} chars, below the ${expectation.minChars} minimum`);
  }
  if (expectation.maxChars !== undefined && lengthChars > expectation.maxChars) {
    failures.push(`reply was ${lengthChars} chars, over the ${expectation.maxChars} budget`);
  }
  for (const needle of expectation.mustNotMentionAnyOf ?? []) {
    if (lower.includes(needle.toLowerCase())) failures.push(`reply contained forbidden text "${needle}"`);
  }
  if (expectation.mustMentionAnyOf) {
    const hit = expectation.mustMentionAnyOf.some((needle) => lower.includes(needle.toLowerCase()));
    if (!hit) failures.push(`reply mentioned none of [${expectation.mustMentionAnyOf.join(', ')}]`);
  }

  let concreteDates: string[] = [];
  if (expectation.mustNotAssertConcreteDate) {
    concreteDates = detectConcreteDateInText(value, contactUtterancesSoFar);
    if (concreteDates.length > 0) {
      failures.push(`asserted a concrete date it was never given: ${concreteDates.join(', ')}`);
    }
  }

  // Length is scored continuously rather than pass/fail: 40 characters over
  // budget is not the same defect as 1,200, and a cliff-edge would say it was.
  let lengthScore: number | null = null;
  if (expectation.maxChars !== undefined) {
    const budget = expectation.maxChars;
    lengthScore = lengthChars <= budget ? 1 : Math.max(0, 1 - (lengthChars - budget) / budget);
    if (value.trim().length === 0) lengthScore = 0;
  }

  return {
    applicable: true,
    passed: failures.length === 0,
    failures,
    lengthChars,
    lengthWords,
    lengthScore,
    concreteDatesAsserted: concreteDates,
  };
}

// ---------------------------------------------------------------------------
// Repetition.
// ---------------------------------------------------------------------------

export interface RepetitionResult {
  /** Highest similarity to any earlier assistant reply, 0..1. */
  readonly maxSimilarity: number;
  readonly verbatimRepeat: boolean;
  /** 1 when distinct, falling away above 0.6 similarity. */
  readonly score: number;
}

/**
 * Character-trigram Jaccard similarity against every earlier reply.
 *
 * Trigrams rather than words because it has to work on Hebrew as well as
 * English, and because it catches a model that re-says the same thing with two
 * words swapped - which is what repetitive models actually do.
 */
export function checkRepetition(text: string | null, earlierTexts: readonly string[]): RepetitionResult {
  const current = normalizeForMatch(text ?? '');
  if (current.length === 0 || earlierTexts.length === 0) {
    return { maxSimilarity: 0, verbatimRepeat: false, score: 1 };
  }

  const currentGrams = trigrams(current);
  let max = 0;
  let verbatim = false;

  for (const earlier of earlierTexts) {
    const other = normalizeForMatch(earlier);
    if (other.length === 0) continue;
    if (other === current) verbatim = true;
    const similarity = jaccard(currentGrams, trigrams(other));
    if (similarity > max) max = similarity;
  }

  // Below 0.6 two replies are simply about the same subject. Above it they are
  // the same reply, and the score falls to zero by 0.95.
  const score = verbatim ? 0 : max <= 0.6 ? 1 : Math.max(0, 1 - (max - 0.6) / 0.35);
  return { maxSimilarity: max, verbatimRepeat: verbatim, score };
}

function trigrams(value: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + 3 <= value.length; i += 1) set.add(value.slice(i, i + 3));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

// ---------------------------------------------------------------------------
// Language.
// ---------------------------------------------------------------------------

export interface LanguageResult {
  readonly expected: ScenarioLanguage;
  readonly hebrewLetterRatio: number;
  readonly matched: boolean;
  readonly detail: string;
}

/**
 * Which language did it answer in?
 *
 * Deliberately crude - the ratio of Hebrew letters to all letters - because
 * that is sufficient to catch the failure that matters (answering a Hebrew
 * speaker entirely in English) and a heavier language-id dependency would buy
 * nothing. The raw ratio is reported so the thresholds can be argued with.
 */
export function checkLanguage(text: string | null, expected: ScenarioLanguage): LanguageResult {
  const value = text ?? '';
  const hebrew = (value.match(/[\u0590-\u05FF]/g) ?? []).length;
  const latin = (value.match(/[A-Za-z]/g) ?? []).length;
  const letters = hebrew + latin;
  const ratio = letters === 0 ? 0 : hebrew / letters;

  if (letters === 0) {
    return { expected, hebrewLetterRatio: 0, matched: false, detail: 'reply contained no letters' };
  }

  switch (expected) {
    case 'he':
      return {
        expected,
        hebrewLetterRatio: ratio,
        matched: ratio >= 0.5,
        detail: `${(ratio * 100).toFixed(0)}% Hebrew letters (need >= 50%)`,
      };
    case 'mixed':
      // A Hebrew-primary speaker who code-switches is still a Hebrew speaker.
      // Replying in pure Hebrew is fine; replying in pure English is not.
      return {
        expected,
        hebrewLetterRatio: ratio,
        matched: ratio >= 0.15,
        detail: `${(ratio * 100).toFixed(0)}% Hebrew letters (need >= 15% for a mixed conversation)`,
      };
    case 'en':
    default:
      return {
        expected,
        hebrewLetterRatio: ratio,
        matched: ratio <= 0.02,
        detail: `${(ratio * 100).toFixed(0)}% Hebrew letters (need <= 2%)`,
      };
  }
}

// ---------------------------------------------------------------------------
// Scheduling intent.
// ---------------------------------------------------------------------------

export interface SchedulingIntentResult {
  readonly applicable: boolean;
  readonly recognised: boolean;
  readonly detail: string;
}

const TIME_BEARING_TOOLS = new Set(
  Object.values(TOOL_DEFINITIONS)
    .filter((d) => d.timeBearing !== undefined)
    .map((d) => d.name as string),
);

/**
 * On a turn carrying a scheduling intent, did the model engage with it?
 *
 * Acting on it (a time-bearing tool) counts. So does asking about it, because
 * on the deliberately-vague scenarios asking is the RIGHT answer and a rubric
 * that only rewarded acting would reward guessing.
 */
export function checkSchedulingIntent(
  turn: BenchmarkTurn,
  calledTools: readonly string[],
  assistantText: string | null,
): SchedulingIntentResult {
  if (!turn.schedulingIntent) return { applicable: false, recognised: true, detail: '' };

  const acted = calledTools.some((name) => TIME_BEARING_TOOLS.has(name));
  if (acted) {
    return { applicable: true, recognised: true, detail: `acted via ${calledTools.join(', ')}` };
  }

  const text = (assistantText ?? '').toLowerCase();
  // Hebrew uses the same question mark, so one check covers both languages.
  const asked = text.includes('?');
  const mentionsTime =
    /\b(time|day|when|morning|afternoon|evening|week|schedule|book|slot|available|calendar)\b/.test(text) ||
    /(מתי|שעה|יום|בוקר|צהרי|שבוע|לקבוע|פגישה|זמין)/.test(assistantText ?? '');

  if (asked && mentionsTime) {
    return { applicable: true, recognised: true, detail: 'asked a clarifying question about the time' };
  }

  return {
    applicable: true,
    recognised: false,
    detail: 'neither called a time-bearing tool nor asked about the time',
  };
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

/** Lower-cased, punctuation-stripped, whitespace-collapsed. Unicode-safe. */
export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
