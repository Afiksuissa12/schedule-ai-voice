/**
 * The Hebrew digit-clock-time case, end to end, through the real dispatcher.
 *
 * WHAT THIS FILE USED TO BE, AND WHY IT CHANGED
 * ---------------------------------------------------------------------------
 * This file was written to RECORD a defect. `src/scheduling/naturalLanguage.ts`
 * was English-only, and a Hebrew or mixed `when` carrying a clock time in
 * DIGITS - `מחר ב-15:00`, "tomorrow at 15:00" - was not refused. The grammar
 * read the digits, silently DROPPED the Hebrew day word it did not know, and
 * fell through to its `implicit_today` branch: a validated, persisted,
 * audit-trailed booking one calendar day early, with every check passing and no
 * warning anywhere. The assertions here pinned that wrong instant on purpose,
 * and said in their own failure messages what to change when it was fixed.
 *
 * IT HAS BEEN FIXED, so they have been changed, exactly as instructed:
 *
 *  - `expect(...).toBe(THE_DAY_THE_RESOLVER_PICKS)` and the constant behind it
 *    are gone. The booking is asserted to land on the day the contact NAMED.
 *  - The scoring test now proves the mirror image: the same real run is scored
 *    as a PASS by the wrong-day rubric gate.
 *
 * WHERE THE GATE'S TEETH ARE NOW PROVED
 * ---------------------------------------------------------------------------
 * A gate nobody can trip is not a gate. Now that no real run produces a wrong
 * day, the proof that `wrongDayResolution` still FIRES lives where it can be
 * exercised without a defect to feed it: `tests/eval/wrongDayGate.test.ts`,
 * against synthetic recorded runs. That file was deliberately left sharp.
 *
 * The full finding, its two reproductions and the fix are
 * `FOUNDER_REVIEW_MISSION_2_LOCAL_BRAIN.md` § 8.3 and `docs/DECISIONS.md` § 9.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { checkResolvedDay, type ResolvedInstant } from '../../src/eval/rubric/programmatic.js';
import type { BenchmarkTurn } from '../../src/eval/corpus/schema.js';
import { createSliceHarness, type SliceHarness } from './support.js';

/** Wednesday 2026-03-04, 10:00 Asia/Jerusalem. The Hebrew corpus's pinned now. */
const NOW_UTC = '2026-03-04T08:00:00.000Z';

/** What "מחר" ("tomorrow") means from `NOW_UTC`, in the contact's own calendar. */
const THE_DAY_THE_CONTACT_NAMED = '2026-03-05';

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
 * contact's own words, so this is the behaviour the architecture ASKS for. It
 * used to be the behaviour that got the customer's appointment wrong - the
 * compliant model booked the wrong day while a model that broke the rule and
 * translated into English booked the right one. That incentive lived in the
 * resolver, and this file is where its removal is observed.
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
  it('is accepted AND lands on the calendar day the contact named', async () => {
    const outcomes = await bookWith('hebrew-digits', 'מחר ב-15:00');

    const booking = outcomes.find((o) => o.toolName === 'schedule_meeting');
    expect(booking, 'schedule_meeting should have produced an outcome').toBeDefined();
    expect(booking?.ok).toBe(true);
    expect(booking?.resolvedTimezone).toBe('Asia/Jerusalem');

    // THE FIX. `מחר` means 2026-03-05 and the booking now says so. This
    // assertion replaces the one that pinned 2026-03-04.
    expect(booking?.resolvedStartLocal?.slice(0, 10)).toBe(THE_DAY_THE_CONTACT_NAMED);
    expect(booking?.resolvedStartLocal).toBe(`${THE_DAY_THE_CONTACT_NAMED}T15:00`);
  });

  it('is scored as a PASS by the wrong-day rubric gate, on the real run', async () => {
    const outcomes = await bookWith('hebrew-digits-scored', 'מחר ב-15:00');

    const verdict = checkResolvedDay(turnExpecting(THE_DAY_THE_CONTACT_NAMED, 'מחר ב-15:00'), outcomes);

    expect(verdict.applicable).toBe(true);
    expect(verdict.passed).toBe(true);
    expect(verdict.expectedLocalDate).toBe(THE_DAY_THE_CONTACT_NAMED);
    expect(verdict.observedLocalDates).toEqual([THE_DAY_THE_CONTACT_NAMED]);
    // The gate itself is unchanged and still fires on a wrong day. That is
    // proved against synthetic runs in tests/eval/wrongDayGate.test.ts, which
    // is the only place it can now be proved at all.
  });

  it('holds for the code-switched shape as well, where the day word is the only Hebrew', async () => {
    const outcomes = await bookWith('mixed-digits', 'call me back מחר ב-16:00');

    const booking = outcomes.find((o) => o.toolName === 'schedule_meeting');
    expect(booking?.ok).toBe(true);
    expect(booking?.resolvedStartLocal).toBe(`${THE_DAY_THE_CONTACT_NAMED}T16:00`);
  });

  it('CONTROL: the same request in English lands on the same instant, as it always did', async () => {
    const outcomes = await bookWith('english-digits', 'tomorrow at 15:00');

    const booking = outcomes.find((o) => o.toolName === 'schedule_meeting');
    expect(booking?.ok).toBe(true);
    expect(booking?.resolvedStartLocal).toBe(`${THE_DAY_THE_CONTACT_NAMED}T15:00`);

    const verdict = checkResolvedDay(turnExpecting(THE_DAY_THE_CONTACT_NAMED, 'tomorrow at 15:00'), outcomes);
    expect(verdict.applicable).toBe(true);
    expect(verdict.passed).toBe(true);
  });

  it('CONTROL: a Hebrew time spelled out in WORDS is still refused, and still is not a wrong day', async () => {
    // This is the input class the original Hebrew scenarios used, and the
    // reason the corpus never caught the digit case.
    //
    // It is STILL refused, and the reason it is refused has improved rather
    // than changed direction. `מחר` and `אחרי הצהריים` are now understood; what
    // stops it is `בשתיים` ("at two"), an hour spelled out in words, which this
    // grammar does not cover. Guessing that שתיים means 14:00 rather than 02:00
    // is precisely the guess the fail-closed rule exists to prevent - so the
    // refusal now NAMES the word it could not read instead of shrugging at the
    // whole phrase.
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
