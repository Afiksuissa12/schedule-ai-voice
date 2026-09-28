/**
 * THE DELIVERABLE: the independent oracle would have caught ALL FOUR Mission 2D
 * fail-open findings - WITH THE DETECTOR BLIND.
 *
 * WHAT IS BEING PROVED, AND WHY IT HAS TO BE A TEST
 * ---------------------------------------------------------------------------
 * Four times, `npm run qa:sweep` printed `CLAIMS THAT LEAKED PAST THE GATE : 0`
 * while an unsupported sentence was being spoken to a caller and written to
 * `ConversationTurn` as a spoken AGENT row (`docs/MISSION_2D_CLAIM_GATE.md`
 * §§ 14.1, 15.1, 16.1, 17.1). Each time the reason was the same circle: INV-18
 * found its claims by calling the gate's own `detectMaterialClaims`, so a
 * sentence the detector could not see produced no claims, so there was nothing
 * for the invariant to judge.
 *
 * Each time, the answer written down was "add the missing wordings". This file is
 * the different answer: **the invariant must be able to fail for a reason the
 * detector did not supply.** So every test below runs the REAL INV-18 `check`
 * with `detectMaterialClaims` MOCKED TO RETURN AN EMPTY ARRAY - the worst case, a
 * detector that is blind to everything - and requires the invariant to fail
 * anyway, on the hand-authored declaration and the scenario's own observed state.
 *
 * WHY THE SPECS ARE DECLARED `EITHER`
 * ---------------------------------------------------------------------------
 * This is the sharpest available form of the demonstration. § 15.4 already made
 * `ReleaseSpec.forbidden` name its strings by hand, so a `NOT_RELEASED` spec can
 * catch an escape without the detector. That fix is real and it is not what is
 * being tested here - if these scenarios were `NOT_RELEASED`, the escape check
 * would fail them and the oracle's contribution would be invisible.
 *
 * `EITHER` makes `declaredReleaseExpectationHolds` return nothing at all. With
 * the detector stubbed, `unbackedClaimsIn` also returns nothing and the gate
 * itself reported `NO_MATERIAL_CLAIM`. So EVERY OTHER WITNESS IN INV-18 IS
 * SILENT, and any failure that remains came from the declaration.
 *
 * NO MODEL IS CALLED HERE AND NO DATABASE IS OPENED. The observation is
 * synthesised, because the quantity under test is the invariant's reasoning and
 * not the runtime's behaviour - `tests/e2e/claimGate.test.ts` is where the same
 * wordings are driven through the real service, the real dispatcher and real
 * SQLite.
 */
import { describe, expect, it, vi } from 'vitest';

// THE STUB. This is the entire point of the file: the detector is made blind,
// and the invariant must still fail. `importOriginal` keeps every other export
// real so nothing else in `invariants.ts` changes behaviour.
vi.mock('../../src/agent/claimGate/detector.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agent/claimGate/detector.js')>();
  return { ...actual, detectMaterialClaims: () => [] };
});

const { detectMaterialClaims } = await import('../../src/agent/claimGate/detector.js');
const { INVARIANTS } = await import('./invariants.js');
const { MISSION_2D_QA_FINDINGS, F17_EIN_BEAYA_COMMA_CONTROL, QA3_FIVE_WORDINGS } = await import(
  './pastFindingTexts.js'
);
const { T_MEETING_THURSDAY_2PM, T_NEUTRAL_OFFER } = await import('./releaseTexts.js');

import type { ClaimDeclaration } from './claimOracle.js';
import type { ReleaseSpec } from './dimensions.js';
import type { ScenarioObservation } from './runner.js';
import type { Scenario } from './scenarios.js';

const INV_18 = INVARIANTS.find((invariant) => invariant.id === 'INV-18-released-text-asserts-no-absent-effect');

const NOW_UTC = '2026-03-04T15:00:00.000Z';
const ZONE = 'Asia/Jerusalem';
const CONTACT_ID = 'contact-oracle-proof';

/**
 * A scenario and an observation in which ONE sentence was released and NOTHING
 * happened.
 *
 * That is the state every one of the four findings leaked into: gate outcome
 * `NO_MATERIAL_CLAIM`, no tool call, `meetings` 0, `futureActions` 0. The
 * observation is built field by field rather than copied from a fixture so a
 * reader can see that the only things the oracle has to work with are the
 * released text and the empty row sets.
 */
function releasedWithNothingBehindIt(
  released: string,
  options: { readonly meetings?: readonly unknown[]; readonly futureActions?: readonly unknown[] } = {},
): { scenario: Scenario; observation: ScenarioObservation } {
  const spec: ReleaseSpec = {
    key: 'proof-either',
    withToolCall: T_NEUTRAL_OFFER,
    // `EITHER`, so `declaredReleaseExpectationHolds` contributes nothing and any
    // failure has to have come from the oracle.
    afterToolResult: [],
    expect: 'EITHER',
    tool: 'schedule_meeting',
    language: 'en',
    rationale: 'A synthetic spec used only to prove the oracle fails on its own evidence.',
  };

  const scenario = {
    id: 'proof-scenario',
    family: 'M-claim-release',
    nowUtc: NOW_UTC,
    release: spec,
  } as unknown as Scenario;

  const observation = {
    scenarioId: 'proof-scenario',
    family: 'M-claim-release',
    outcome: 'NO_TOOL_CALL',
    errorCode: null,
    correlationId: 'corr-proof',
    conversationId: 'conv-proof',
    contactId: CONTACT_ID,
    organizationId: 'org-proof',
    calendarRef: 'cal-proof',
    auditTypes: [],
    auditEvents: [],
    rowsBefore: {},
    rowsAfter: {},
    meetings: options.meetings ?? [],
    futureActions: options.futureActions ?? [],
    qualificationStates: [],
    tasks: [],
    toolOutcomes: [],
    claimGate: {
      enabled: true,
      releases: [
        {
          iteration: 1,
          // What the gate really reported on every one of the four findings.
          outcome: 'NO_MATERIAL_CLAIM',
          releasedText: released,
          attempts: [{ text: released, supportedClaimCount: 0, unsupportedClaims: [] }],
        },
      ],
    },
    assistantMessages: [released],
    contact: { id: CONTACT_ID, timezone: ZONE },
    businessHoursJson: '{}',
    rawProposedValue: null,
    busyOverMeetings: [],
    replayRowsAfter: null,
    stopReason: 'COMPLETED',
    error: null,
  } as unknown as ScenarioObservation;

  return { scenario, observation };
}

/** A real Thursday 14:00 booking, in the contact's own zone. */
const REAL_THURSDAY_BOOKING = [
  {
    id: 'meeting-proof',
    status: 'SCHEDULED',
    // 2026-03-05 14:00 Asia/Jerusalem is 12:00 UTC.
    startUtc: '2026-03-05T12:00:00.000Z',
    endUtc: '2026-03-05T12:30:00.000Z',
    externalCalendarEventId: null,
  },
];

function failuresFor(released: string, options: Parameters<typeof releasedWithNothingBehindIt>[1] = {}): string[] {
  const { scenario, observation } = releasedWithNothingBehindIt(released, options);
  if (INV_18 === undefined) throw new Error('INV-18 is not in INVARIANTS');
  return INV_18.check(observation, scenario)
    .filter((result) => result.applicable && !result.passed)
    .map((result) => result.detail);
}

// ---------------------------------------------------------------------------

describe('the detector really is blind in this file', () => {
  it('returns no claims for a sentence it certainly detects in production', () => {
    // The vacuity guard for the whole file. If the mock silently stopped
    // applying, every test below would pass through the ordinary detector path
    // and prove nothing about the oracle.
    expect(detectMaterialClaims('Your meeting is booked for Thursday at 2pm.')).toEqual([]);
    expect(detectMaterialClaims('הפגישה נקבעה למחר בשעה 14:00.')).toEqual([]);
  });

  it('and the gate reported NO_MATERIAL_CLAIM, as it did on all four findings', () => {
    const { observation } = releasedWithNothingBehindIt('anything');
    expect(observation.claimGate.releases[0]?.outcome).toBe('NO_MATERIAL_CLAIM');
    expect(observation.claimGate.releases[0]?.attempts[0]?.unsupportedClaims).toEqual([]);
  });
});

describe('INV-18 fails on all four Mission 2D QA findings with the detector blind', () => {
  for (const finding of MISSION_2D_QA_FINDINGS) {
    describe(`§ ${finding.section} - ${finding.headline}`, () => {
      for (const wording of finding.wordings) {
        it(`fails on the declaration alone: ${wording.text}`, () => {
          const failures = failuresFor(wording.text);

          expect(
            failures.length,
            `INV-18 passed a sentence declared to assert ${describe1(wording.declares)} against an empty ` +
              'ledger, with the detector returning nothing. That is the fourth-time failure this oracle ' +
              'exists to remove.',
          ).toBeGreaterThan(0);

          // The failure must be the ORACLE's, and it must say so - not the
          // detector's, which said nothing, and not the escape check, which is
          // dormant on an `EITHER` spec.
          const fromTheOracle = failures.filter((detail) => detail.includes('DECLARED GROUND TRUTH'));
          expect(fromTheOracle.length, `failures were:\n${failures.join('\n---\n')}`).toBe(1);

          // And it must NAME the detector's blindness, so whoever reads the
          // failure knows to fix a detector rule rather than the gate.
          expect(fromTheOracle[0]).toContain('SO THE DETECTOR NEVER SAW THIS AT ALL');
          expect(fromTheOracle[0]).toContain('detectMaterialClaims found 0 claim(s)');
        });
      }
    });
  }

  it('covers all five QA-3 wordings the finding listed, not a subset', () => {
    // The finding listed five and the deliverable asks for five. A test that
    // proved three of them would be the § 16.2 mistake one level up.
    expect(QA3_FIVE_WORDINGS.length).toBe(5);
    for (const wording of QA3_FIVE_WORDINGS) {
      expect(failuresFor(wording.text).length).toBeGreaterThan(0);
    }
  });

  it("fails on QA-3's comma CONTROL too, because a person hears the same sentence", () => {
    // The control was BLOCKED by the gate while the no-comma spelling leaked, so
    // the gate's two verdicts differed by a punctuation mark. The oracle's do
    // not, and that is the property worth pinning: if these two ever needed
    // different declarations, the oracle would have inherited the defect.
    expect(failuresFor(F17_EIN_BEAYA_COMMA_CONTROL.text).length).toBeGreaterThan(0);
  });

  it('names the effect FAMILY in the failure, not just "something is wrong"', () => {
    // Deliverable (a) asks the declaration to say of WHICH KIND. A failure that
    // did not carry the family would leave a reader unable to tell a missing
    // meeting from a missing callback, which are different bugs.
    const [meetingFailure] = failuresFor('אין בעיה הפגישה נקבעה למחר בשעה 14:00.');
    expect(meetingFailure).toContain('MEETING COMPLETED');
    const [callbackFailure] = failuresFor('אין בעיה אתקשר אליך מחר בשעה 15:00.');
    expect(callbackFailure).toContain('CALLBACK COMMITTED');
    const [cancellationFailure] = failuresFor('אין בעיה הפגישה בוטלה.');
    expect(cancellationFailure).toContain('CANCELLATION COMPLETED');
  });
});

describe('the oracle judges against observed state, not against the wording', () => {
  it('passes the SAME sentence when the ledger really does support it', () => {
    // The other direction, and the one that stops this being a machine for
    // failing every release. Deliverable (d): a declared claim the ledger
    // genuinely supports is not a failure. Without this, the tests above would
    // be satisfied by an oracle that rejected everything.
    const failures = failuresFor('Your meeting is booked for Thursday at 2pm.', {
      meetings: REAL_THURSDAY_BOOKING,
    });
    expect(failures).toEqual([]);
  });

  it('fails a CANCELLATION claim on the very state that supports a MEETING claim', () => {
    // The family is load-bearing rather than decorative. The same observed row
    // supports one sentence and not the other.
    expect(failuresFor('אין בעיה הפגישה בוטלה.', { meetings: REAL_THURSDAY_BOOKING }).length).toBeGreaterThan(0);
  });

  it('fails a WRONG-DAY claim against a real booking, naming both days', () => {
    const [failure] = failuresFor('Your meeting is booked for Friday at 2pm.', {
      meetings: REAL_THURSDAY_BOOKING,
    });
    expect(failure).toContain('WRONG_DAY');
    expect(failure).toContain('2026-03-06');
    expect(failure).toContain('2026-03-05');
  });

  it('fails a WRONG-TIME claim against the same real booking', () => {
    const [failure] = failuresFor('Your meeting is booked for Thursday at 4pm.', {
      meetings: REAL_THURSDAY_BOOKING,
    });
    expect(failure).toContain('WRONG_TIME');
  });

  it('releases the sentences declared to assert nothing, with nothing on record', () => {
    // The precision direction. An oracle that flagged honest wording would be
    // the failure mode `lexicon/en.ts` warns about - a gate somebody switches
    // off - arriving in the assurance layer instead of in the gate.
    expect(failuresFor('Let me take care of that for you.')).toEqual([]);
    expect(failuresFor('אין בעיה הפגישה לא נקבעה עדיין.')).toEqual([]);
    expect(failuresFor("Don't worry nothing is booked yet.")).toEqual([]);
    expect(failuresFor('I can have that booked for you in a moment.')).toEqual([]);
  });
});

describe('a released sentence nobody declared is a violation', () => {
  it('fails rather than defaulting to "asserts nothing"', () => {
    // The mandatory half of the rule, and the one that stops the whole mechanism
    // degrading back into silence. A sentence with no declaration is exactly the
    // position INV-18 was in for every sentence before § 17.5.
    const failures = failuresFor('A sentence no declaration in this repository covers.');
    expect(failures.length).toBe(1);
    expect(failures[0]).toContain('NO declaration covers');
  });

  it('and the message says where to put the declaration', () => {
    const [failure] = failuresFor('Another undeclared sentence.');
    expect(failure).toContain('tests/invariants/releaseTexts.ts');
  });
});

describe('the sweep sentences are declared consistently with the finding wordings', () => {
  it('the index accepted both files, which means no sentence has two answers', () => {
    // `buildDeclarationIndex` throws on a conflict, and `invariants.ts` builds it
    // at module load - so this test existing and running at all is the
    // assertion. Stated explicitly so the guarantee is not invisible.
    expect(INV_18).toBeDefined();
    expect(T_MEETING_THURSDAY_2PM.declares.assertions[0]?.family).toBe('MEETING');
  });
});

/** `MEETING COMPLETED` etc., for a failure message in this file. */
function describe1(declaration: ClaimDeclaration): string {
  return declaration.assertions.map((assertion) => `${assertion.family} ${assertion.mode}`).join(' + ') || 'a reference';
}
