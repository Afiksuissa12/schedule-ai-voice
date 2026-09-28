/**
 * The prompt is a deliverable, so it is tested like one.
 *
 * Two properties matter and neither is about prose quality:
 *
 *  1. THE GUARDRAILS ARE PRESENT. A future edit cannot quietly delete the
 *     never-fabricate discipline, because the build fails if it does.
 *  2. ASSEMBLY IS DETERMINISTIC. Byte-identical output for a given
 *     configuration version, so `promptFingerprint` on an audit event is a
 *     real pin and not a suggestion.
 *
 * Plus one negative that matters more than either: no per-contact PII, and no
 * secrets, in the versioned prompt.
 */
import { describe, expect, it } from 'vitest';

import {
  buildSystemPrompt,
  DEFAULT_SYSTEM_PROMPT_REF,
  promptFingerprint,
  resolvePromptComposition,
  SYSTEM_PROMPT_COMPOSITIONS,
} from '../../src/agent/prompt/systemPrompt.js';
import { PROMPT_CLAUSES, PROMPT_CLAUSE_IDS, REQUIRED_CLAUSE_IDS } from '../../src/agent/prompt/clauses.js';
import { buildTurnContext } from '../../src/agent/prompt/turnContext.js';
import { TOOL_NAMES } from '../../src/agent/tools/definitions.js';
import type { Contact } from '../../src/domain/entities.js';
import { ConfigurationError } from '../../src/shared/errors.js';

const ALL_TOOLS = [...TOOL_NAMES];

function build(allowedToolNames: readonly string[] = ALL_TOOLS) {
  return buildSystemPrompt({ promptRef: DEFAULT_SYSTEM_PROMPT_REF, allowedToolNames });
}

describe('the guardrail clauses', () => {
  it('names an enforcement mechanism for every clause', () => {
    // A clause with nothing enforcing it is decoration, and decoration in a
    // guardrail set is worse than nothing because it reads as protection.
    for (const id of PROMPT_CLAUSE_IDS) {
      const clause = PROMPT_CLAUSES[id];
      expect(clause.enforcedBy.length, `${id} has no enforcedBy`).toBeGreaterThan(0);
      expect(clause.version).toBeGreaterThanOrEqual(1);
      expect(clause.text.length).toBeGreaterThan(40);
    }
  });

  it('keeps every required guardrail in every composition', () => {
    for (const composition of Object.values(SYSTEM_PROMPT_COMPOSITIONS)) {
      for (const required of REQUIRED_CLAUSE_IDS) {
        expect(composition.clauseIds, `${composition.ref} dropped ${required}`).toContain(required);
      }
    }
  });
});

describe('buildSystemPrompt', () => {
  it('contains each required guardrail, in words the model can act on', () => {
    const prompt = build().text;

    // The never-fabricate discipline, clause by clause.
    expect(prompt).toContain('Never invent availability');
    expect(prompt).toContain('Never say a time is free, busy');
    expect(prompt).toContain('Never invent facts about the person');
    expect(prompt).toContain('Nothing is booked until a tool says it is');
    expect(prompt).toContain('Ask when the time is ambiguous');
    expect(prompt).toContain('Say times back in their timezone');
    expect(prompt).toContain('Promise only what your tools can do');

    // The rule that the model proposes but never decides.
    expect(prompt).toContain('You propose times; you never decide them');
    expect(prompt).toContain('Send what they actually said');

    // And the closing statement of who owns what.
    expect(prompt).toContain('The application validates, decides, and saves');
  });

  it('enumerates exactly the tools the configuration permits', () => {
    const narrow = build(['schedule_followup', 'get_contact_context']).text;

    expect(narrow).toContain('- get_contact_context');
    expect(narrow).toContain('- schedule_followup');
    expect(narrow).not.toContain('- schedule_meeting');
    expect(narrow).not.toContain('- transfer_to_human');
  });

  it('tells a tool-less agent that it may not promise anything', () => {
    const prompt = build([]).text;
    expect(prompt).toContain('You have NO tools in this conversation');
    expect(prompt).toContain('may not promise');
  });

  it('is deterministic: identical input produces byte-identical output', () => {
    const first = build();
    const second = build();

    expect(second.text).toBe(first.text);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.clauseIds).toEqual(first.clauseIds);
  });

  it('is a function of the SET of tools, not of their stored order', () => {
    const forwards = build(['check_availability', 'schedule_meeting', 'transfer_to_human']);
    const backwards = build(['transfer_to_human', 'schedule_meeting', 'check_availability']);
    const duplicated = build([
      'schedule_meeting',
      'check_availability',
      'schedule_meeting',
      'transfer_to_human',
    ]);

    // `allowedToolsJson` is a list, but its MEANING is a set. Two
    // configurations permitting the same tools must produce the same prompt,
    // or the fingerprint recorded on an audit event is noise.
    expect(backwards.text).toBe(forwards.text);
    expect(duplicated.text).toBe(forwards.text);
    expect(duplicated.fingerprint).toBe(forwards.fingerprint);
  });

  it('changes its fingerprint when the permitted tools genuinely change', () => {
    expect(build(['schedule_meeting']).fingerprint).not.toBe(build(['schedule_followup']).fingerprint);
    expect(promptFingerprint('a')).not.toBe(promptFingerprint('b'));
    expect(promptFingerprint('a')).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  it('carries no secrets and no per-contact PII', () => {
    const prompt = build().text;

    // Nothing that looks like a credential.
    expect(prompt).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(prompt).not.toMatch(/OPENAI_API_KEY/);
    expect(prompt).not.toMatch(/api[_ ]?key/i);

    // Nothing that looks like a specific person. The prompt is shared by every
    // conversation; per-turn facts live in the turn context message instead.
    expect(prompt).not.toMatch(/\+\d{10,}/);
    expect(prompt).not.toMatch(/[\w.]+@[\w.]+\.\w+/);
    expect(prompt).not.toContain('Jordan Prospect');
  });

  it('refuses an unknown prompt ref rather than defaulting', () => {
    // An agent running on instructions nobody chose is worse than one that
    // will not start.
    expect(() => buildSystemPrompt({ promptRef: 'not-a-real-ref@v9', allowedToolNames: ALL_TOOLS })).toThrow(
      ConfigurationError,
    );
    expect(() => resolvePromptComposition('legacy-prompt')).toThrow(/Unknown systemPromptRef/);
  });

  it('refuses a composition that has lost a required guardrail', () => {
    const registry = SYSTEM_PROMPT_COMPOSITIONS as unknown as Record<string, { ref: string; description: string; clauseIds: string[] }>;
    registry['broken@v1'] = {
      ref: 'broken@v1',
      description: 'A composition with the never-fabricate rule removed.',
      clauseIds: ['ROLE', 'ESCALATE_TO_HUMAN'],
    };

    try {
      expect(() => resolvePromptComposition('broken@v1')).toThrow(/missing required guardrail/);
    } finally {
      delete registry['broken@v1'];
    }
  });
});

describe('buildTurnContext', () => {
  const contact: Contact = {
    id: 'contact_123',
    organizationId: 'org_1',
    fullName: 'Jordan Prospect',
    primaryPhoneE164: '+12125550147',
    email: 'jordan@prospect.test',
    timezone: 'America/New_York',
    isDecisionMaker: true,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('gives the model the id, the name, the zone and the local time - and no more', () => {
    const built = buildTurnContext({ contact, nowUtc: '2026-03-04T15:00:00.000Z' });

    expect(built.text).toContain('Jordan Prospect');
    expect(built.text).toContain('contact_123');
    expect(built.text).toContain('America/New_York');
    // 15:00 UTC is 10:00 in New York, and the model is told so in words.
    // NO YEAR: `day <month name> <year>` is the shape the fabricated-timestamp
    // gate refuses, and disclosing it handed aya a worked example of it.
    // docs/MISSION_2D_AYA_ROOT_CAUSE.md § 9. Asserted both ways so that putting
    // the year back fails here rather than only in a benchmark.
    expect(built.text).toContain('Wednesday 4 March at 10:00');
    expect(built.text).not.toContain('2026');

    // The dialable number and the email address are NOT disclosed: the model
    // never dials and never sends, so it has no use for either.
    expect(built.text).not.toContain('+12125550147');
    expect(built.text).not.toContain('jordan@prospect.test');
  });

  it('records exactly what was disclosed, for the audit event', () => {
    const built = buildTurnContext({ contact, nowUtc: '2026-03-04T15:00:00.000Z' });

    expect(Object.keys(built.disclosed).sort()).toEqual(
      [
        'contactDisplayName',
        'contactId',
        'contactLocalNow',
        'contactTimezone',
        'isDecisionMaker',
        'qualificationBand',
        'qualificationScore',
      ].sort(),
    );
  });

  it('tells the model about the cap when the contact cannot sign', () => {
    const built = buildTurnContext({
      contact: { ...contact, isDecisionMaker: false },
      nowUtc: '2026-03-04T15:00:00.000Z',
    });

    expect(built.text).toContain('NOT the decision maker');
    expect(built.text).toContain('capped');
  });

  it('is deterministic for the same contact and the same now', () => {
    const a = buildTurnContext({ contact, nowUtc: '2026-03-04T15:00:00.000Z' });
    const b = buildTurnContext({ contact, nowUtc: '2026-03-04T15:00:00.000Z' });
    expect(b.text).toBe(a.text);
  });
});
