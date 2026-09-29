/**
 * THE DELIVERABLE: the independent oracle would have caught ALL FIVE Mission 2D
 * fail-open findings - WITH THE DETECTOR BLIND.
 *
 * WHAT IS BEING PROVED, AND WHY IT HAS TO BE A TEST
 * ---------------------------------------------------------------------------
 * Five times, `npm run qa:sweep` printed `CLAIMS THAT LEAKED PAST THE GATE : 0`
 * while an unsupported sentence was being spoken to a caller and written to
 * `ConversationTurn` as a spoken AGENT row (`docs/MISSION_2D_CLAIM_GATE.md`
 * §§ 14.1, 15.1, 16.1, 17.1, 18.1). Each time the reason was the same circle:
 * INV-18 found its claims by calling the gate's own `detectMaterialClaims`, so a
 * sentence the detector could not see produced no claims, so there was nothing
 * for the invariant to judge.
 *
 * THE FIFTH TIME IS THE ONE THAT SHOWS THIS FILE EARNING ITS KEEP. § 18 was found
 * on a tree where the oracle already existed and where `DETECTOR_BLIND` read 0,
 * which is honest and uninformative at the same time: the oracle can only judge
 * sentences somebody DECLARED, and nobody had declared `Not at all I have booked
 * your meeting for Thursday at 2pm.` § 17.8 residual 1 states that bound and
 * § 18.7 restates it. What this file proves is the other half - that a
 * declaration IS enough on its own, with no help from the detector at all.
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
const {
  MISSION_2D_QA_FINDINGS,
  F17_EIN_BEAYA_COMMA_CONTROL,
  F18_NOT_AT_ALL_COMMA_CONTROL,
  F18_LO_TZARICH_KLUM_COMMA_CONTROL,
  QA3_FIVE_WORDINGS,
  QA4_ENGLISH_WORDINGS,
  QA4_HEBREW_WORDINGS,
  QA6_DAY_WORDINGS,
  QA6_HEBREW_WORDINGS,
  QA6_HOUR_WORDINGS,
  QA6_PARSED_CONTROLS,
  QA8_AB_CONTROLS,
  QA8_ALL_WORDINGS,
  QA8_CLASS_A_WORDINGS,
  QA8_CLASS_B_WORDINGS,
} = await import('./pastFindingTexts.js');
const { T_MEETING_THURSDAY_2PM, T_NEUTRAL_OFFER } = await import('./releaseTexts.js');

import { declarationsAgree, type ClaimDeclaration } from './claimOracle.js';
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
 * That is the state every one of the five findings leaked into: gate outcome
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
          // What the gate really reported on every one of the five findings.
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

/**
 * THE § 20 BOOKING, AND IT IS THE ONE THAT MAKES THAT SECTION DIFFERENT.
 *
 * Every finding before § 20 leaked into an EMPTY ledger, so the oracle only had
 * to notice that nothing happened. § 20's eleven sentences were driven against a
 * booking that really existed - QA's harness called `schedule_meeting` with
 * `tomorrow afternoon at 3` and it really persisted - so the oracle has to
 * disagree about the DAY or the HOUR rather than about whether anything happened
 * at all. 2026-03-05 15:00 Asia/Jerusalem is 13:00 UTC.
 */
const REAL_THURSDAY_1500_BOOKING = [
  {
    id: 'meeting-proof-1500',
    status: 'SCHEDULED',
    startUtc: '2026-03-05T13:00:00.000Z',
    endUtc: '2026-03-05T13:30:00.000Z',
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

  it('and the gate reported NO_MATERIAL_CLAIM, as it did on all five findings', () => {
    const { observation } = releasedWithNothingBehindIt('anything');
    expect(observation.claimGate.releases[0]?.outcome).toBe('NO_MATERIAL_CLAIM');
    expect(observation.claimGate.releases[0]?.attempts[0]?.unsupportedClaims).toEqual([]);
  });
});

describe('INV-18 fails on all five Mission 2D QA findings with the detector blind', () => {
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

  it("covers all six of QA-4's English wordings and all seven Hebrew ones", () => {
    // § 18 deliverable (d). The finding listed A1-A6 and H1-H7 and drove every one
    // of them through the real service; a test that proved a representative subset
    // would be the § 16.2 mistake for the third time.
    expect(QA4_ENGLISH_WORDINGS.length).toBe(6);
    expect(QA4_HEBREW_WORDINGS.length).toBe(7);
    for (const wording of [...QA4_ENGLISH_WORDINGS, ...QA4_HEBREW_WORDINGS]) {
      expect(failuresFor(wording.text).length, `no failure for ${wording.text}`).toBeGreaterThan(0);
    }
  });

  it('and both of QA-4 comma controls, which differ from the leaks by one character', () => {
    // The same property § 17's control pinned, a section later: the GATE's two
    // verdicts differed by a punctuation mark and the oracle's do not.
    expect(failuresFor(F18_NOT_AT_ALL_COMMA_CONTROL.text).length).toBeGreaterThan(0);
    expect(failuresFor(F18_LO_TZARICH_KLUM_COMMA_CONTROL.text).length).toBeGreaterThan(0);
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

describe('§ 20: the oracle catches a wrong day or hour against a booking that REALLY EXISTS', () => {
  // WHY THIS BLOCK IS SEPARATE FROM THE ONE ABOVE. Every finding § 14 to § 19
  // leaked into an EMPTY ledger, where the oracle only has to notice that nothing
  // happened - and the block above drives them that way. § 20 is the first finding
  // where the tool call SUCCEEDED: `toolOutcomes[0].ok === true` and one `meetings`
  // row, in all eleven cases. So NO_MATCHING_EFFECT is not available here and the
  // oracle has to disagree about the day or the hour, which is the half of
  // `unbackedDeclaredClaims` that had never been exercised by a past finding.
  //
  // The detector is still stubbed blind for the whole file, so a failure here
  // cannot have come from `detectMaterialClaims`. It comes from a human reading
  // `half past four` and writing 16:30 beside it.

  function againstTheRealBooking(released: string): string[] {
    return failuresFor(released, { meetings: REAL_THURSDAY_1500_BOOKING });
  }

  for (const wording of [...QA6_HOUR_WORDINGS, ...QA6_DAY_WORDINGS, ...QA6_HEBREW_WORDINGS]) {
    it(`fails against the real 15:00 booking: ${wording.text}`, () => {
      const failures = againstTheRealBooking(wording.text);
      expect(
        failures.length,
        'INV-18 passed a sentence naming a day or an hour the record does not have, against a booking that ' +
          'really exists and says something else. That is § 20: the gate did not merely miss these, it ' +
          'returned them in `supported` with a matchedEffect and the audit recorded them as VERIFIED.',
      ).toBeGreaterThan(0);
      const fromTheOracle = failures.filter((detail) => detail.includes('DECLARED GROUND TRUTH'));
      expect(fromTheOracle.length, `failures were:\n${failures.join('\n---\n')}`).toBe(1);
      expect(fromTheOracle[0]).toMatch(/WRONG_DAY|WRONG_TIME/u);
    });
  }

  it('reports the HOUR wordings as WRONG_TIME, because they get the day right', () => {
    // The two halves are different bugs and the oracle has to be able to say
    // which. T1-T6 all name Thursday, which is the booked day, so the only thing
    // that can be wrong is the hour.
    for (const wording of QA6_HOUR_WORDINGS) {
      const [failure] = againstTheRealBooking(wording.text);
      expect(failure, `for ${wording.text}`).toContain('WRONG_TIME');
    }
  });

  it('reports the DAY wordings as WRONG_DAY, and names both days', () => {
    const [weekend] = againstTheRealBooking('Your meeting is booked for this weekend at 3pm.');
    expect(weekend).toContain('WRONG_DAY');
    expect(weekend).toContain('2026-03-07');
    expect(weekend).toContain('2026-03-05');
  });

  it('catches QA-6 two parsed CONTROLS the same way, which is the finding', () => {
    // `Your meeting is booked for Thursday at 4:30pm.` was blocked by the GATE and
    // `... at half past four.` was released, in the same run, against the same
    // state. Those two say the same thing, so the ORACLE must treat them
    // identically - and it does, because a declaration is written by reading the
    // sentence rather than by matching it. If these two ever needed different
    // declarations the oracle would have inherited the defect.
    for (const wording of QA6_PARSED_CONTROLS) {
      expect(againstTheRealBooking(wording.text).length, `no failure for ${wording.text}`).toBeGreaterThan(0);
    }
    const [spelled] = againstTheRealBooking('Your meeting is booked for Thursday at 4:30pm.');
    const [spoken] = againstTheRealBooking('Your meeting is booked for Thursday at half past four.');
    expect(spelled).toContain('WRONG_TIME');
    expect(spoken).toContain('WRONG_TIME');
  });

  it('and passes the sentence that names the hour the record really has', () => {
    // The precision direction, on the same state. Without this the block above
    // would be satisfied by an oracle that failed every sentence naming a time.
    expect(failuresFor('Your meeting is booked for Thursday at 3pm.', {
      meetings: REAL_THURSDAY_1500_BOOKING,
    })).toEqual([]);
  });

  it('covers every wording the finding listed, not a subset', () => {
    expect(QA6_HOUR_WORDINGS.length, 'the finding listed six hour wordings T1-T6').toBe(6);
    expect(QA6_DAY_WORDINGS.length, 'four day wordings D1-D4 plus B1, where both halves are wrong').toBe(5);
    expect(QA6_HEBREW_WORDINGS.length, 'the finding listed four Hebrew wordings').toBe(4);
    expect(QA6_PARSED_CONTROLS.length).toBe(2);
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
    // QA-4's precision controls, which are the reason § 18 is a rule about what a
    // carrier IS rather than a shorter carrier list. All four use the same tokens
    // as the leaking fillers.
    expect(failuresFor('Nothing at all has been booked yet.')).toEqual([]);
    expect(failuresFor('I cannot see anything at all in the diary for you.')).toEqual([]);
    expect(failuresFor('לא צריך כלום הפגישה לא נקבעה עדיין.')).toEqual([]);
    expect(failuresFor("I don't have your meeting booked.")).toEqual([]);
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

describe('§ 21: the apostrophe clitic and the person/number axis, with the detector blind', () => {
  // THE EIGHTH ROUND, AND THIS FILE WAS ONE ROUND OUT OF DATE UNTIL MISSION 2F.
  // Every one of the nine wordings was RELEASED to the caller AND PERSISTED as a
  // spoken AGENT row with zero domain rows, while `npm run qa:sweep` printed
  // `CLAIMS THAT LEAKED PAST THE GATE : 0` and `DETECTOR_BLIND 0` - honestly, and
  // uselessly, because nobody had declared the sentences (§ 21.2 reason 3).
  //
  // They are declared now, and the block below is the proof that a DECLARATION is
  // enough on its own. It does NOT mean the oracle would have caught them at the
  // time: it could not have, and `claimOracle.ts` § 6's header says so in as many
  // words. What it means is that the oracle catches every past finding, which is the
  // property this file exists for and which had fallen behind.
  //
  // All eleven are driven on an EMPTY ledger, like §§ 14-19 and unlike § 20: every
  // one of them leaked into a turn that dispatched no tool at all.

  it('covers all nine wordings and both A/B controls, not a subset', () => {
    // The finding listed four in class A and five in class B. A test that proved a
    // representative subset would be the § 16.2 mistake for the fourth time.
    expect(QA8_CLASS_A_WORDINGS.length, 'class A: the English clitic wordings').toBe(4);
    expect(QA8_CLASS_B_WORDINGS.length, 'class B: the Hebrew person/number wordings').toBe(5);
    expect(QA8_AB_CONTROLS.length).toBe(2);
    expect(QA8_ALL_WORDINGS.length).toBe(11);
  });

  for (const wording of QA8_ALL_WORDINGS) {
    it(`fails on the declaration alone: ${wording.text}`, () => {
      const failures = failuresFor(wording.text);
      expect(
        failures.length,
        'INV-18 passed a § 21 wording against an empty ledger with the detector returning nothing. That is ' +
          'the eighth-round failure this oracle exists to make impossible for a declared sentence.',
      ).toBeGreaterThan(0);
      const fromTheOracle = failures.filter((detail) => detail.includes('DECLARED GROUND TRUTH'));
      expect(fromTheOracle.length, `failures were:\n${failures.join('\n---\n')}`).toBe(1);
      expect(fromTheOracle[0]).toContain('SO THE DETECTOR NEVER SAW THIS AT ALL');
    });
  }

  it('and BOTH A/B CONTROLS fail too, which is the property that matters most here', () => {
    // THE GATE'S TWO VERDICTS DIFFERED BY ONE CHARACTER - an apostrophe in class A
    // and one Hebrew suffix in class B - and the ORACLE'S DO NOT. That is the third
    // time this exact property has had to be pinned (§ 17's comma, § 19's line
    // break, § 21's apostrophe), and it is what a hand-authored declaration buys
    // over a second matcher: a person reading the two sentences hears the same
    // assertion, because there is one.
    for (const control of QA8_AB_CONTROLS) {
      expect(failuresFor(control.text).length, `no failure for the control ${control.text}`).toBeGreaterThan(0);
    }
  });

  it('declares the CONTRACTED and SPELLED-OUT spellings identically', () => {
    // If these two ever needed different declarations the oracle would have
    // inherited the defect it exists to catch. Asserted on the declaration itself
    // rather than on the verdict, because the verdicts agreeing could be a
    // coincidence of the state.
    const contracted = QA8_CLASS_A_WORDINGS[0];
    const spelledOut = QA8_AB_CONTROLS[0];
    expect(contracted?.text).toBe("Your meeting's booked for Thursday at 2pm.");
    expect(spelledOut?.text).toBe('Your meeting is booked for Thursday at 2pm.');
    expect(declarationsAgree(contracted?.declares as ClaimDeclaration, spelledOut?.declares as ClaimDeclaration)).toBe(
      true,
    );
  });

  it('and the SINGULAR and PLURAL of one Hebrew verb identically', () => {
    // Class B's own version of the same property. ביטלנו leaked and ביטלתי was
    // blocked, and a contact does not care whether one person or two cancelled
    // their meeting.
    const plural = QA8_CLASS_B_WORDINGS[0];
    const singular = QA8_AB_CONTROLS[1];
    expect(plural?.text).toBe('ביטלנו את הפגישה שלך.');
    expect(singular?.text).toBe('ביטלתי את הפגישה שלך.');
    expect(declarationsAgree(plural?.declares as ClaimDeclaration, singular?.declares as ClaimDeclaration)).toBe(true);
  });

  it('names the effect FAMILY for each of the four classes § 21 spans', () => {
    // Class B crosses four families, which is how the finding showed it is not one
    // verb wide. A failure that did not carry the family would leave a reader
    // unable to tell a missing cancellation from a missing email.
    expect(failuresFor('ביטלנו את הפגישה שלך.')[0]).toContain('CANCELLATION COMPLETED');
    expect(failuresFor('שלחנו לך אישור במייל.')[0]).toContain('MESSAGE COMPLETED');
    expect(failuresFor('שינינו את הפגישה ליום חמישי בשעה 14:00.')[0]).toContain('RESCHEDULE COMPLETED');
    expect(failuresFor("Your callback's arranged for 3pm tomorrow.")[0]).toContain('CALLBACK COMPLETED');
  });

  it("and שלחנו fails as NO_TOOL_FOR_PROMISE, because nothing here sends anything", () => {
    // The strongest row of the nine: MESSAGE maps to NO observed effect at all, so
    // no state could EVER have supported it. Distinguished from
    // NO_MATCHING_EFFECT on purpose - "nothing happened" and "nothing could ever
    // happen" are different findings with different fixes.
    expect(failuresFor('שלחנו לך אישור במייל.')[0]).toContain('NO_TOOL_FOR_PROMISE');
  });

  it('but passes the same clitic wording against a booking that really exists', () => {
    // The precision direction, on the § 21 class. Without this the block above
    // would be satisfied by an oracle that failed every contracted sentence -
    // and a contraction is not a claim, it is a spelling.
    expect(
      failuresFor("Your meeting's booked for Thursday at 2pm.", { meetings: REAL_THURSDAY_BOOKING }),
    ).toEqual([]);
    expect(failuresFor('Your meeting is booked for Thursday at 2pm.', { meetings: REAL_THURSDAY_BOOKING })).toEqual(
      [],
    );
  });
});

describe('every past finding is covered, and the count is a floor rather than a comment', () => {
  it('has an entry for every QA round this gate has had', () => {
    // THE GUARD ON THIS FILE ITSELF. `pastFindingTexts.ts` used to open with "THE
    // SIX FAIL-OPEN FINDINGS" while §§ 20 and 21 had happened - the smallest
    // possible version of the mistake the whole file is about, a record silently
    // falling behind the thing it records. A floor here fails when a round is
    // added to the documentation and not to the declarations.
    expect(
      MISSION_2D_QA_FINDINGS.length,
      'docs/MISSION_2D_CLAIM_GATE.md records fail-open findings in §§ 14.1, 15.1, 16.1, 17.1, 18.1, 19.1, ' +
        '19.2, 19.3, 20.1 and 21.1. If a round has been added to the document and not to this file, the ' +
        'oracle is no longer shown to catch every past finding.',
    ).toBeGreaterThanOrEqual(10);
    expect(MISSION_2D_QA_FINDINGS.map((finding) => finding.section)).toContain('21.1');
  });

  it('and every declared wording really does fail, with no round exempt', () => {
    // The blanket assertion, over every wording of every round, so a new round
    // added to the list cannot be added without its wordings being driven.
    const passed: string[] = [];
    for (const finding of MISSION_2D_QA_FINDINGS) {
      for (const wording of finding.wordings) {
        // § 20 is the one round whose wordings need a REAL booking to disagree
        // with; everything else leaked into an empty ledger.
        const options = finding.section === '20.1' ? { meetings: REAL_THURSDAY_1500_BOOKING } : {};
        if (failuresFor(wording.text, options).length === 0) {
          passed.push(`§ ${finding.section}: ${wording.text}`);
        }
      }
    }
    expect(passed).toEqual([]);
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
