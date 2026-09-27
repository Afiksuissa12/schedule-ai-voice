/**
 * Proof that the anti-scripting check is not vacuous.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `npm run check:anti-scripting` passes. That is either because the repository
 * carries no canned dialogue, or because the check cannot detect any. From the
 * outside those two look identical, and only one of them is good news.
 *
 * So the check is pointed at a corpus with the answers written down:
 *
 *   - KNOWN_BAD: samples that MUST produce a specific rule. Every rule id in
 *     `ANTI_SCRIPTING_RULE_IDS` has to appear at least once, so a rule that
 *     stops firing is caught the day it stops rather than the day somebody
 *     relies on it.
 *   - KNOWN_GOOD: samples that MUST produce nothing. These are the shapes this
 *     codebase genuinely contains - guardrail prose, error codes, a validation
 *     message, a summariser instruction - and a check that failed them would be
 *     switched off inside a week, which is a worse outcome than no check.
 *
 * The samples are SOURCE TEXT, run through the same `inspectSource` the
 * directory walk uses. Not a mock of it, and not a reimplementation: the same
 * function, so this cannot drift from what actually runs.
 *
 * The samples below deliberately contain the patterns the rule forbids. That is
 * what makes them samples. They are strings in a test corpus; nothing reads
 * them, renders them, or sends them anywhere.
 */
import { ANTI_SCRIPTING_RULE_IDS, inspectSource, type AntiScriptingRuleId } from './antiScriptingCheck.js';

interface Sample {
  readonly name: string;
  readonly source: string;
}

interface BadSample extends Sample {
  readonly expect: AntiScriptingRuleId;
}

/**
 * Each of these is a real way this mission's rule gets broken.
 *
 * Written the way somebody would actually write them while believing they were
 * being helpful - which is the only kind worth detecting.
 */
export const KNOWN_BAD: readonly BadSample[] = [
  {
    name: 'if-X-then-say-Y, the pattern the directive names',
    expect: 'DIALOGUE_BRANCH',
    source: [
      'function opener(stage) {',
      "  if (stage === 'GREETING') {",
      '    return "Hi there, I\'m calling from Northwind - have you got two minutes?";',
      '  }',
      "  return null;",
      '}',
    ].join('\n'),
  },
  {
    name: 'a switch that picks the sentence',
    expect: 'DIALOGUE_BRANCH',
    source: [
      'function line(band) {',
      '  switch (band) {',
      "    case 'HIGH':",
      '      return "That\'s great to hear - I\'ll get you booked in with an engineer this week.";',
      '    default:',
      "      return '';",
      '  }',
      '}',
    ].join('\n'),
  },
  {
    name: 'an utterance assigned to something that gets spoken',
    expect: 'CANNED_UTTERANCE_ASSIGNMENT',
    source: [
      'const outcome = {',
      '  assistantText: "Thanks for your time - I\'ll give you a ring back tomorrow afternoon.",',
      '};',
    ].join('\n'),
  },
  {
    name: 'a canned reply table keyed by situation',
    expect: 'CANNED_REPLY_TABLE',
    source: [
      'const TABLE = {',
      '  TOO_EXPENSIVE: "I hear you, and I\'d say the same - can I show you what you\'d save?",',
      '  NO_TIME: "Of course, you\'re busy - I\'ll keep this to ninety seconds if that works?",',
      '};',
    ].join('\n'),
  },
  {
    name: 'a fixed discovery sequence',
    expect: 'FIXED_QUESTION_SEQUENCE',
    source: [
      'const DISCOVERY = [',
      '  "How many technicians are you running at the moment?",',
      '  "And how are you handling your scheduling today?",',
      '  "What would you say that costs you in a typical week?",',
      '];',
    ].join('\n'),
  },
  {
    name: 'a lone written-out sentence, wherever it sits',
    expect: 'SPEECH_LITERAL',
    source: 'const FAREWELL = "Brilliant - I\'ll let you get on, and thanks again for your time today.";',
  },
];

/**
 * The allowance sample's LINES, shared by the two KNOWN_GOOD entries that join
 * them with `\n` and with `\r\n`.
 *
 * Declared once rather than written out twice so that the two samples cannot
 * drift apart - the whole point of the pair is that the TEXT is identical and
 * only the line ending differs, which a copy-paste would quietly stop being
 * true of.
 */
const ALLOWED_GUARDRAIL_EXAMPLE = [
  '// anti-scripting:allow SPEECH_LITERAL - a guardrail example contrasting two phrasings, not a line to deliver',
  'const CLAUSE = "Until then, the honest words are \\"let me get that booked\\" - not \\"you are all set\\".";',
] as const;

/**
 * Shapes this codebase really contains, which must stay clean.
 *
 * If a rule ever fires on one of these, the rule is wrong, not the code. That
 * assertion is as important as the one above it: precision is what determines
 * whether a check survives contact with a real team.
 */
export const KNOWN_GOOD: readonly Sample[] = [
  {
    name: 'a guardrail clause addressing the model as "you"',
    source: [
      'const CLAUSE = [',
      "  'You cannot see the diary. Never state that a time is free or busy unless a tool call told you so',",
      "  'in this conversation. If you have not checked, check first.',",
      "].join(' ');",
    ].join('\n'),
  },
  {
    name: 'a branch returning an error code',
    source: [
      'function classify(code) {',
      "  if (code === 'SCHEMA_VIOLATION') return 'UNRECOVERABLE';",
      "  return 'RETRYABLE';",
      '}',
    ].join('\n'),
  },
  {
    name: 'a validation message written for a developer',
    source:
      "const REASON = 'The arguments for schedule_meeting did not match its schema: when - Required.';",
  },
  {
    name: 'a business fact, which is data and not a sentence to deliver',
    source: "const FACT = 'Dispatch Core is $79 per technician per month on annual billing.';",
  },
  {
    name: 'summariser instructions, which no contact ever hears',
    source: [
      'const PROMPT = [',
      "  'Return ONE JSON object and nothing else. No prose before it and no prose after it.',",
      "  'Invent nothing. Every item must trace to something in the transcript.',",
      "].join('\\n');",
    ].join('\n'),
  },
  {
    name: 'an allowed guardrail example, with a reason',
    source: ALLOWED_GUARDRAIL_EXAMPLE.join('\n'),
  },
  {
    // The SAME lines, joined with CRLF, and this pair is not redundant.
    //
    // The LF form above passed for the whole of Mission 2 while the CRLF form
    // did not: the allowance regex captured its reason with `(.*)`, `.` does not
    // match a carriage return, and every file in this checkout is CRLF - so the
    // directive never matched, `collectAllowances` returned nothing, and every
    // justified allowance in the repository was reported as a violation. The
    // check exited 1 on its own declared exemption.
    //
    // Nothing caught that for two missions because this corpus was LF-only,
    // which is to say it tested the one line ending the repository does not use.
    // A non-vacuity corpus that reproduces conditions the code never meets is
    // the same failure it exists to rule out, one level up.
    name: 'the same sample with CRLF endings',
    source: ALLOWED_GUARDRAIL_EXAMPLE.join('\r\n'),
  },
];

export interface SelfTestResult {
  readonly failures: readonly string[];
  readonly rulesExercised: readonly string[];
  readonly badSamplesChecked: number;
  readonly goodSamplesChecked: number;
}

export function runSelfTest(): SelfTestResult {
  const failures: string[] = [];
  const exercised = new Set<string>();

  for (const sample of KNOWN_BAD) {
    const found = inspectSource(sample.source, `<known-bad:${sample.name}>`);
    for (const violation of found) exercised.add(violation.ruleId);
    if (!found.some((violation) => violation.ruleId === sample.expect)) {
      failures.push(
        `KNOWN_BAD "${sample.name}" should have produced ${sample.expect} but produced ` +
          `${found.length === 0 ? 'nothing' : found.map((v) => v.ruleId).join(', ')}.`,
      );
    }
  }

  for (const sample of KNOWN_GOOD) {
    const found = inspectSource(sample.source, `<known-good:${sample.name}>`);
    if (found.length > 0) {
      failures.push(
        `KNOWN_GOOD "${sample.name}" must stay clean but produced ` +
          `${found.map((v) => `${v.ruleId} (${v.excerpt})`).join('; ')}.`,
      );
    }
  }

  // Every rule must have been shown to fire by something. A rule nobody has
  // seen work is a rule nobody should count on.
  for (const ruleId of ANTI_SCRIPTING_RULE_IDS) {
    if (!exercised.has(ruleId)) {
      failures.push(`Rule ${ruleId} was never triggered by the KNOWN_BAD corpus, so nothing proves it works.`);
    }
  }

  return {
    failures,
    rulesExercised: [...exercised].sort(),
    badSamplesChecked: KNOWN_BAD.length,
    goodSamplesChecked: KNOWN_GOOD.length,
  };
}
