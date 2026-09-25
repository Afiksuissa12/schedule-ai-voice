/**
 * The Hebrew digit-clock-time defect, pinned down end to end.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------------------------------------------------------------
 * `src/scheduling/naturalLanguage.ts` is English-only, and the Founder Review
 * used to describe the consequence as a clean application-layer REFUSAL. For one
 * realistic and common input class it is not a refusal at all. A Hebrew or mixed
 * `when` carrying a clock time in DIGITS - `מחר ב-15:00`, "tomorrow at 15:00" -
 * is ACCEPTED: the grammar reads the digits, silently drops the Hebrew day word
 * it does not know, and falls through to its `implicit_today` branch. The result
 * is a validated, persisted, audit-trailed booking one day early with no warning
 * anywhere.
 *
 * These tests do two separate jobs, and the distinction matters:
 *
 *  1. They RECORD the defect as it currently behaves, against the real
 *     dispatcher and the real validator, so nobody has to take § 8.3's word for
 *     it. They are written to keep passing while the defect exists.
 *  2. They prove the BENCHMARK now catches it - that `checkResolvedDay` marks
 *     the turn a wrong-day failure rather than the "expected failure DID NOT
 *     OCCUR" non-event `expectsToolFailure` would have produced.
 *
 * WHEN THE RESOLVER IS FIXED, the assertion marked THE DEFECT will fail. That is
 * intended and the failure message says so: change it to expect 2026-03-05 and
 * delete the wrong-day branch. Nothing in this file changes scheduling
 * behaviour, and nothing in it should be read as blessing the behaviour it
 * records.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { checkResolvedDay, type ResolvedInstant } from '../../src/eval/rubric/programmatic.js';
import type { BenchmarkTurn } from '../../src/eval/corpus/schema.js';
import { createSliceHarness, type SliceHarness } from './support.js';

/** Wednesday 2026-03-04, 10:00 Asia/Jerusalem. The Hebrew corpus's pinned now. */
const NOW_UTC = '2026-03-04T08:00:00.000Z';

/** What "מחר" ("tomorrow") means from `NOW_UTC`, in the contact's own calendar. */
const THE_DAY_THE_CONTACT_NAMED = '2026-03-05';
/** What the English-only resolver actually lands on. */
const THE_DAY_THE_RESOLVER_PICKS = '2026-03-04';

const JERUSALEM_WORLD = {
  contactFullName: 'יונתן לוי',
  contactTimezone: 'Asia/Jerusalem',
  organizationTimezone: 'Asia/Jerusalem',
  businessHoursStartLocal: '09:00',
  businessHoursEndLocal: '17:00',
  minLeadTimeMinutes: 30,
  maxSchedulingHorizonDays: 180,
} as const;

const harnesses: SliceHarness[] = [];

afterAll(async () => {
  for (const harness of harnesses) await harness.cleanup();
});

/**
 * One turn through the REAL runtime with the model proposing `when` verbatim.
 *
 * Verbatim is the point: the passthrough rule says the model hands over the
 * contact's own words, so this is the behaviour the architecture ASKS for, not a
 * misbehaving model being caught out.
 */
async function bookWith(label: string, when: string): Promise<readonly ResolvedInstant[]> {
  const harness = await createSliceHarness({
    label,
    nowUtc: NOW_UTC,
    world: { ...JERUSALEM_WORLD },
  });
  harnesses.push(harness);

  const conversation = await harness.startConversation();
  harness.llm.setScript([
    {
      assistantText: null,
      toolCalls: [
        {
          toolName: 'schedule_meeting',
          argumentsJson: JSON.stringify({
            contact_id: harness.world.contact.id,
            when,
            title: 'שיחת היכרות',
            duration_minutes: 30,
          }),
        },
      ],
    },
    { assistantText: 'סגרנו.' },
  ]);

  const result = await harness.runtime.agent.handleTurn({
    conversationId: conversation.id,
    utterance: `תתקשר אליי ${when}`,
  });

  return result.toolOutcomes.map((outcome) => {
    const data = outcome.ok ? (outcome.data as Record<string, unknown> | undefined) : undefined;
    const startLocal = data?.['start_local'];
    const timezone = data?.['timezone'];
    return {
      toolName: outcome.toolName,
      ok: outcome.ok,
      resolvedStartLocal: typeof startLocal === 'string' ? startLocal : null,
      resolvedTimezone: typeof timezone === 'string' ? timezone : null,
    };
  });
}

/** A corpus turn carrying only the expectation under test. */
function turnExpecting(date: string, contactSaid: string): BenchmarkTurn {
  return {
    utterance: `תתקשר אליי ${contactSaid}`,
    note: 'fixture',
    resolvedDay: { mustResolveToLocalDate: date, contactSaid },
  };
}

describe('a Hebrew `when` with the clock time in digits', () => {
  it('is ACCEPTED rather than refused, and books the wrong calendar day', async () => {
    const outcomes = await bookWith('hebrew-digits', 'מחר ב-15:00');

    const booking = outcomes.find((o) => o.toolName === 'schedule_meeting');
    expect(booking, 'schedule_meeting should have produced an outcome').toBeDefined();

    // Not refused. This is the whole finding: § 8.3 used to say it was.
    expect(booking?.ok, 'the Hebrew `when` was refused - if the resolver has been fixed, update this file').toBe(
      true,
    );
    expect(booking?.resolvedTimezone).toBe('Asia/Jerusalem');

    // THE DEFECT. `מחר` means 2026-03-05; the resolver drops it and uses today.
    expect(
      booking?.resolvedStartLocal?.slice(0, 10),
      'the resolver now understands Hebrew day words - expect 2026-03-05 here and delete the wrong-day branch',
    ).toBe(THE_DAY_THE_RESOLVER_PICKS);
    expect(booking?.resolvedStartLocal).toBe(`${THE_DAY_THE_RESOLVER_PICKS}T15:00`);
  });

  it('is scored as a wrong-day FAILURE by the benchmark, not as an unmet expectation', async () => {
    const outcomes = await bookWith('hebrew-digits-scored', 'מחר ב-15:00');

    const verdict = checkResolvedDay(turnExpecting(THE_DAY_THE_CONTACT_NAMED, 'מחר ב-15:00'), outcomes);

    expect(verdict.applicable).toBe(true);
    expect(verdict.passed).toBe(false);
    expect(verdict.expectedLocalDate).toBe(THE_DAY_THE_CONTACT_NAMED);
    expect(verdict.observedLocalDates).toContain(THE_DAY_THE_RESOLVER_PICKS);
    expect(verdict.detail).toContain('wrong calendar day');
  });

  it('CONTROL: the same request in English lands on the day the contact named, and passes', async () => {
    const outcomes = await bookWith('english-digits', 'tomorrow at 15:00');

    const booking = outcomes.find((o) => o.toolName === 'schedule_meeting');
    expect(booking?.ok).toBe(true);
    expect(booking?.resolvedStartLocal).toBe(`${THE_DAY_THE_CONTACT_NAMED}T15:00`);

    const verdict = checkResolvedDay(turnExpecting(THE_DAY_THE_CONTACT_NAMED, 'tomorrow at 15:00'), outcomes);
    expect(verdict.applicable).toBe(true);
    expect(verdict.passed).toBe(true);
  });

  it('CONTROL: a Hebrew time spelled out in WORDS really is refused, and is not scored as a wrong day', async () => {
    // This is the input class the original Hebrew scenarios used, and the reason
    // the corpus never caught the digit case.
    const outcomes = await bookWith('hebrew-words', 'מחר אחרי הצהריים, בשתיים');

    const booking = outcomes.find((o) => o.toolName === 'schedule_meeting');
    expect(booking?.ok).toBe(false);
    expect(booking?.resolvedStartLocal).toBeNull();

    const verdict = checkResolvedDay(
      turnExpecting(THE_DAY_THE_CONTACT_NAMED, 'מחר אחרי הצהריים, בשתיים'),
      outcomes,
    );
    // A refusal books nothing, so there is no day to be wrong about. Scoring it
    // as a failure would punish the product for the SAFE outcome.
    expect(verdict.applicable).toBe(false);
    expect(verdict.passed).toBe(true);
  });
});
