/**
 * No absolute date this system SPEAKS INTO the context window is a worked
 * example of the format the fabricated-timestamp gate refuses.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `docs/MISSION_2D_AYA_ROOT_CAUSE.md` § 9 is the root cause of the aya-expanse
 * failure: three separate sites rendered `day <month name> <year>` into the
 * model's own context, and that is byte-for-byte the shape
 * `FABRICATION_PATTERNS` calls `day-month-name-with-year` and the
 * fabricated-timestamp gate refuses in a time-bearing tool argument. The window
 * forbade a format twice and then demonstrated it, and a 7-8B model imitated the
 * demonstration. § 9 dropped the year at all three sites.
 *
 * Only ONE of the three arrived with a test. `tests/agent/prompt.test.ts` pins
 * `buildTurnContext`; nothing pinned the other two, and they are the two § 9
 * argues matter more:
 *
 *  - `handlers.ts:describeLocal` is what § 9.1a calls "THE WORST OFFENDER OF THE
 *    THREE", because a tool RESULT is an exemplar the model sees stamped OK, and
 *    § 9.1a traces aya copying it verbatim inside a single turn.
 *  - `contextAssembler.ts:describeLocal` is what § 9.1b calls "THE SITE THAT THE
 *    aya EVIDENCE ACTUALLY RAN ON", because a present `background` REPLACES the
 *    legacy disclosure rather than prefixing it, and the benchmark runs with the
 *    background on.
 *
 * So reverting either of those two one-line format changes passed the entire
 * suite, and the site the evidence ran on was the least guarded of the three.
 * That is the gap this file closes. `CONVERSATION_CONTEXT.md` had already gone
 * stale through it - its rendered example still showed
 * `Wednesday 4 March 2026 at 10:00` after the code stopped producing it, in a
 * block whose own generator says a hand-typed worked example "is wrong by the
 * second commit".
 *
 * HOW IT ASSERTS, AND WHY NOT WITH GOLDEN STRINGS
 * ---------------------------------------------------------------------------
 * Against `FABRICATION_PATTERNS` itself - the same list the gate uses - rather
 * than against the literal `Wednesday 4 March at 10:00`. A golden string pins
 * today's wording; this pins the PROPERTY § 9 actually claims, which is that
 * nothing we speak matches a shape we refuse. It also cannot drift away from the
 * gate: widening `FABRICATION_PATTERNS` tightens this test in the same commit.
 *
 * The first test is a POSITIVE CONTROL over the pre-§ 9 wording of all three
 * sites, so none of the checks below can pass by matching nothing.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { buildTurnContext } from '../../src/agent/prompt/turnContext.js';
import { toModelPayload } from '../../src/agent/tools/results.js';
import { describeLocal } from '../../src/conversation/contextAssembler.js';
import type { Contact } from '../../src/domain/entities.js';
import { FABRICATION_PATTERNS } from '../../src/eval/rubric/programmatic.js';
import { scriptedArgs } from '../../src/llm/scriptedLlmProvider.js';
import { createSliceHarness, type SliceHarness } from '../e2e/support.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Every fabrication pattern the text matches, named.
 *
 * `re` is rebuilt per call because the shared literals carry `g` and a `g`
 * regex used through `matchAll` is fine but `lastIndex` on a module-level
 * object is exactly the kind of state that makes a suite order-dependent.
 */
function fabricationHits(text: string): string[] {
  const hits: string[] = [];
  for (const { name, re } of FABRICATION_PATTERNS) {
    for (const match of text.matchAll(new RegExp(re.source, re.flags))) {
      hits.push(`${name}: ${match[0]}`);
    }
  }
  return hits;
}

const harnesses: SliceHarness[] = [];

afterEach(async () => {
  while (harnesses.length > 0) await harnesses.pop()?.cleanup();
});

describe('nothing this system speaks into the context window demonstrates a forbidden date shape', () => {
  it('CONTROL: the pre-§ 9 wording of all three sites IS caught, so nothing below passes vacuously', () => {
    // Verbatim the strings the three sites produced before Mission 2D-R. If the
    // patterns ever stop catching these, every assertion in this file becomes
    // meaningless and this test is what says so.
    expect(fabricationHits('Their local clock right now reads Wednesday 4 March 2026 at 10:00.')).toEqual([
      'day-month-name-with-year: 4 March 2026',
    ]);
    expect(fabricationHits('Thursday 5 March 2026 at 15:00 (America/New_York)')).toEqual([
      'day-month-name-with-year: 5 March 2026',
    ]);
    expect(fabricationHits('Meeting "Intro call" is booked for Thursday 5 March 2026 at 14:00 (Asia/Jerusalem).')).toEqual(
      ['day-month-name-with-year: 5 March 2026'],
    );
  });

  it('not the turn-context disclosure (§ 9)', () => {
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

    const built = buildTurnContext({ contact, nowUtc: '2026-03-04T15:00:00.000Z' });
    expect(fabricationHits(built.text)).toEqual([]);
    // The disclosure still DOES its job - the model is told the day and the
    // time. Dropping the year removed the exemplar, not the information.
    expect(built.text).toContain('Wednesday 4 March at 10:00');
  });

  it('not the assembled background, which is the site the aya evidence ran on (§ 9.1b)', () => {
    // Crossed over zones and instants rather than asserted once: the year is
    // rendered by a Luxon format string, and a format string is the kind of
    // thing that gets restored for one call site and not the others.
    const instants = ['2026-03-04T15:00:00.000Z', '2026-02-11T15:10:00.000Z', '2026-12-31T23:30:00.000Z'];
    const zones = ['America/New_York', 'Asia/Jerusalem', 'Australia/Sydney', 'UTC'];

    for (const instant of instants) {
      for (const zone of zones) {
        const spoken = describeLocal(instant, zone);
        expect(fabricationHits(spoken), `${instant} in ${zone} -> ${spoken}`).toEqual([]);
      }
    }

    // New Year's Eve in Sydney is 1 January in local terms, which is the one
    // case where dropping the year loses something real. § 9.1b accepts that
    // trade explicitly; it is asserted here so the trade stays deliberate.
    expect(describeLocal('2026-12-31T23:30:00.000Z', 'Australia/Sydney')).toBe('Friday 1 January at 10:30');
  });

  it('and not a tool result, which is the exemplar a model sees stamped OK (§ 9.1a)', async () => {
    const harness = await createSliceHarness({ label: 'spoken-date-format' });
    harnesses.push(harness);
    const conversation = await harness.startConversation();

    // A booking and a callback: between them they cover `schedule_meeting`'s
    // summary and `spoken`, and `schedule_followup`'s "Callback promised for
    // ..." sentence, which is a separate `describeLocal` call site.
    harness.llm.setScript([
      {
        assistantText: 'Let me get that in the diary.',
        toolCalls: [
          {
            toolName: 'schedule_meeting',
            argumentsJson: scriptedArgs({
              contact_id: harness.world.contact.id,
              when: 'tomorrow afternoon at 3',
              title: 'Intro call',
            }),
          },
        ],
      },
      {
        assistantText: 'And I will give you a ring as well.',
        toolCalls: [
          {
            toolName: 'schedule_followup',
            argumentsJson: scriptedArgs({
              contact_id: harness.world.contact.id,
              when: 'tomorrow afternoon at 3',
              reason: 'Confirm the intro call.',
            }),
          },
        ],
      },
      { assistantText: 'That is all set.' },
    ]);

    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Book me in for tomorrow afternoon at 3 and give me a ring about it.',
    });

    // Non-vacuity: a turn that made no tool call would satisfy the loop below
    // trivially, and a scripted harness is exactly where that happens silently.
    const succeeded = turn.toolOutcomes.filter((outcome) => outcome.ok);
    expect(succeeded.map((outcome) => outcome.toolName)).toEqual(['schedule_meeting', 'schedule_followup']);

    for (const outcome of succeeded) {
      const asRead = toModelPayload(outcome);

      // THE PROSE. `summary` is the sentence and `spoken` is the phrase the
      // model is meant to say back; between them they are every `describeLocal`
      // value in the payload, and they are what § 9.1a found aya copying.
      const prose = [asRead['summary'], asRead['spoken']].filter((value) => typeof value === 'string').join(' ');
      expect(prose.length, `${outcome.toolName} exposed no prose to check`).toBeGreaterThan(0);
      expect(fabricationHits(prose), `${outcome.toolName} prose -> ${prose}`).toEqual([]);
    }

    // And the sentence really is still there, spoken and zoned. A result that
    // had stopped naming the day at all would also have zero hits.
    const summaries = succeeded.map((outcome) => outcome.summary).join(' | ');
    expect(summaries).toContain('Thursday 5 March at 15:00 (America/New_York)');
  });

  /**
   * THE BOUND ON ALL OF THE ABOVE, MEASURED RATHER THAN ASSUMED.
   *
   * `docs/MISSION_2D_AYA_ROOT_CAUSE.md` § 9 said of itself that "there is no
   * longer a year anywhere in the window to copy". That is true of the PROSE and
   * false of the payload: the same `schedule_meeting` result that now says
   * `Thursday 5 March at 15:00` still carries `start_local: "2026-03-05T15:00"`,
   * which is `iso-datetime` - the FIRST fabrication pattern, and the shape § 7's
   * six newly-visible ISO failures actually take. So the window still holds an
   * OK-stamped exemplar with a four-digit year in it.
   *
   * IT IS NOT REMOVED, AND THE REASON IS NOT COSMETIC. `start_local` is
   * load-bearing for the claim gate itself: `claimGate/ledger.ts`'s
   * `readStartUtcFromOutcome` reconstructs the exact instant a time-bearing tool
   * committed to from `start_local` plus `timezone`, and
   * `eval/runner/runScenario.ts` reads the same pair. A year-less local time is
   * not a resolvable instant, so dropping it would trade an imitation risk for a
   * gate that could no longer tell which day it had booked - and the claim gate
   * is the thing Mission 2D exists to make trustworthy.
   *
   * This test exists so the gap is a RECORDED bound rather than an implied
   * guarantee, in the shape `docs/MISSION_2D_CLAIM_GATE.md` § 8 limit 1 argues
   * for: a limit list that overstates a guarantee is worse than a documented gap.
   * If somebody does find a way to give the ledger its instant without spelling a
   * year at the model, this test goes red and says so - which is the right
   * direction for it to fail in.
   */
  it('BOUND: the machine fields beside that prose DO still carry an ISO year, deliberately', async () => {
    const harness = await createSliceHarness({ label: 'spoken-date-format-bound' });
    harnesses.push(harness);
    const conversation = await harness.startConversation();

    harness.llm.setScript([
      {
        assistantText: 'Let me get that in the diary.',
        toolCalls: [
          {
            toolName: 'schedule_meeting',
            argumentsJson: scriptedArgs({
              contact_id: harness.world.contact.id,
              when: 'tomorrow afternoon at 3',
              title: 'Intro call',
            }),
          },
        ],
      },
      { assistantText: 'That is all set.' },
    ]);

    const turn = await harness.runtime.agent.handleTurn({
      conversationId: conversation.id,
      utterance: 'Book me in for tomorrow afternoon at 3.',
    });

    const booked = turn.toolOutcomes.find((outcome) => outcome.ok && outcome.toolName === 'schedule_meeting');
    expect(booked?.ok).toBe(true);
    const asRead = toModelPayload(booked!);

    expect(asRead['start_local']).toBe('2026-03-05T15:00');
    expect(fabricationHits(String(asRead['start_local']))).toEqual(['iso-datetime: 2026-03-05T15:00']);

    // And it is load-bearing, not incidental: this is the pair the gate's ledger
    // reconstructs the committed instant from.
    expect(asRead['timezone']).toBe('America/New_York');
  });

  it("and not CONVERSATION_CONTEXT.md's rendered example, which is generated and had already gone stale", () => {
    // `src/cli/contextRender.ts`: "`CONVERSATION_CONTEXT.md` quotes this output
    // verbatim. A worked example in documentation that was typed by hand is a
    // worked example that is wrong by the second commit." It went stale anyway,
    // because nothing checked it. This is the check.
    //
    // It deliberately does NOT assert byte equality with `npm run context:render`:
    // that command seeds a throwaway database, so the contact id in the block is
    // a fresh cuid on every run and equality would fail for a reason that is not
    // a defect. The fabrication property is what the block is allowed to promise.
    const doc = readFileSync(join(REPO_ROOT, 'CONVERSATION_CONTEXT.md'), 'utf8').replace(/\r\n/g, '\n');
    const [, afterBegin] = doc.split('<!-- BEGIN RENDERED EXAMPLE');
    expect(afterBegin, 'the BEGIN RENDERED EXAMPLE marker has moved').toBeDefined();
    const [block] = (afterBegin ?? '').split('<!-- END RENDERED EXAMPLE');
    expect(block, 'the END RENDERED EXAMPLE marker has moved').toBeDefined();

    // Guard the guard: if the extraction ever yields a fragment, the check below
    // passes on nothing.
    expect((block ?? '').length, 'the extracted rendered block is implausibly short').toBeGreaterThan(5_000);
    expect(block ?? '').toContain('Their local clock right now reads');

    expect(fabricationHits(block ?? '')).toEqual([]);
  });
});
