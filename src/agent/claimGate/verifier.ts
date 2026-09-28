/**
 * THE VERIFIER: does the ledger support what the text asserted?
 *
 * Pure. Text plus a ledger snapshot in, a partition of the detected claims out.
 * No clock (the ledger carries the turn's pinned `nowUtc`), no database (the
 * ledger was already built from one), no provider.
 *
 * THE WAYS A CLAIM FAILS
 * ---------------------------------------------------------------------------
 *  - `NO_MATCHING_EFFECT` - the ledger has no effect of the family asserted.
 *    This is the `qwen2.5:7b-instruct` defect: "I've booked the callback for 3pm"
 *    with no tool call at all.
 *  - `EFFECT_WAS_REFUSED` - the ledger has no such effect AND has a refusal from
 *    the tool that would have produced one. Reported separately because the
 *    correction is different: the model is not missing a tool call, it is
 *    ignoring an answer it already has, and the refusal's own reason is written
 *    to be acted on.
 *  - `WRONG_DAY` / `WRONG_TIME` - an effect of the right family exists, and the
 *    day or the time the text names is not the one that was actually saved. A
 *    booking on the right day described as the wrong day is still a customer
 *    turning up on the wrong day, which is the § 8.3 wrong-day defect arriving
 *    through the sentence instead of through the resolver.
 *  - `INVENTED_IDENTIFIER` - a token shaped like an identifier that is in no
 *    tool result and no row. `CONF123456`.
 *  - `NO_TOOL_FOR_PROMISE` - the effect asserted is one NOTHING in this system
 *    can do. There is no tool that sends an email, so
 *    `aya-expanse:8b`'s promised confirmation email cannot be supported by any
 *    state whatsoever, and saying that plainly is more use to the model than
 *    "no matching effect".
 *  - `UNREADABLE_WHEN` - the text named a day or a time in a phrase the detector
 *    could not read, so there is nothing to compare and the § 20 fail-open is
 *    what would happen if this were allowed to pass. It is reported separately
 *    from `WRONG_DAY` because it is not a contradiction: the record may well
 *    agree with what the model meant, and what the model has to do about it is
 *    different - name the day and the hour plainly rather than pick another one.
 *
 * COMPARISON IS DONE IN THE CONTACT'S OWN TIMEZONE
 * ---------------------------------------------------------------------------
 * Always, and from `LedgerEffect.localTime`, which the ledger computed in
 * `Contact.timezone` off the persisted row. A meeting agreed in another zone is
 * still going to be described to this contact in theirs, which is what the
 * prompt clause `SPEAK_TIMES_IN_CONTACT_TIMEZONE` already asks for.
 *
 * AMBIGUITY RESOLVES TOWARDS UNSUPPORTED, WITH ONE NAMED EXCEPTION
 * ---------------------------------------------------------------------------
 * The exception is the bare 12-hour clock. "at 3" for a 15:00 booking is not a
 * contradiction - it is how a person says 15:00 - and treating it as one would
 * block the wording the prompt asks the model to use. So a bare hour with a day
 * part is resolved through the SAME day-part windows the scheduler used (carried
 * on the ledger), and a bare hour with nothing to pin it is accepted when it
 * agrees modulo 12. Every other uncertainty - an unknown family, an effect with
 * no instant to compare, a day that cannot be reconciled - is unsupported.
 *
 * THAT PARAGRAPH WAS FALSE AS WRITTEN UNTIL § 20, AND THE CORRECTION IS THE
 * SEVENTH FAIL-OPEN FINDING
 * ---------------------------------------------------------------------------
 * It claimed every other uncertainty resolved to unsupported, and one did not.
 * `reconcile` began with
 *
 *     if (day === null && time === null) return { ok: true };
 *
 * and that line could not tell "the sentence named no day or time" from "the
 * sentence named a day or a time I could not read". The detector's readers are a
 * lexicon enumeration, so an unparsed phrase came back as `null`, and `null` was
 * read as NOTHING ASSERTED. `Your meeting is booked for Thursday at half past
 * four.` was therefore certified SUPPORTED - not merely missed, AFFIRMATIVELY
 * CERTIFIED, with a `matchedEffect` named in the audit - against a booking at
 * 15:00. Eleven wordings were driven through the real `AgentTurnService` and real
 * SQLite and every one was released byte-identical and persisted; `4:30pm` and
 * `Saturday`, the same contradictions in parseable wording, were blocked in the
 * same run. `docs/MISSION_2D_CLAIM_GATE.md` § 20 has the table.
 *
 * The distinction is now carried on the claim itself - `DetectedClaim
 * .unreadTemporal`, which is non-empty exactly when the detector saw temporal
 * material it could not resolve - and this module treats it as the uncertainty it
 * is. `UNREADABLE_WHEN` is the reason, one regeneration is the cost, and the
 * sentence that genuinely names nothing (`Your meeting is booked.`) still passes
 * with no regeneration because its `unreadTemporal` is empty.
 *
 * SO THE HEADING IS NOW TRUE, and the § 8.3 harm this gate's `WRONG_DAY` was
 * built for is no longer reachable through a phrase the detector cannot parse.
 */
import { DateTime } from 'luxon';

import type { DayPartWindow } from '../../scheduling/policy.js';
import { detectMaterialClaims, type AssertedDay, type AssertedTime, type DetectClaimsOptions, type DetectedClaim } from './detector.js';
import { issuedIdentifierSet, STATE_CHANGING_EFFECT_KINDS, type ActionLedger, type LedgerEffect, type LedgerEffectKind, type LedgerRefusal } from './ledger.js';
import type { ClaimEffectFamily } from './lexicon/index.js';

export const UNSUPPORTED_CLAIM_REASONS = [
  'NO_MATCHING_EFFECT',
  'EFFECT_WAS_REFUSED',
  'WRONG_DAY',
  'WRONG_TIME',
  'UNREADABLE_WHEN',
  'INVENTED_IDENTIFIER',
  'NO_TOOL_FOR_PROMISE',
] as const;

export type UnsupportedClaimReason = (typeof UNSUPPORTED_CLAIM_REASONS)[number];

export interface SupportedClaim {
  readonly claim: DetectedClaim;
  /** The effect that supports it, when the family names one. */
  readonly matchedEffect: LedgerEffect | null;
}

export interface UnsupportedClaim {
  readonly claim: DetectedClaim;
  readonly reason: UnsupportedClaimReason;
  /**
   * Machine-readable specifics. Flat and small on purpose: it goes into an audit
   * detail, into `AgentTurnResult.claimGate`, and into the regeneration
   * instruction, and it must carry no customer-facing sentence.
   */
  readonly detail: UnsupportedClaimDetail;
}

export interface UnsupportedClaimDetail {
  readonly family: ClaimEffectFamily;
  /** The identifier that is in no tool result and no row. */
  readonly invalidIdentifier?: string;
  /** What the text asserted, and what was actually saved, in the contact's zone. */
  readonly assertedLocal?: string;
  readonly recordedLocal?: string;
  /** The refusal that explains why the effect does not exist. */
  readonly refusal?: { readonly toolName: string; readonly code: string; readonly reason: string };
  /** Effect kinds that WOULD have supported this claim. */
  readonly expectedEffectKinds?: readonly LedgerEffectKind[];
}

export interface ClaimVerification {
  readonly supported: readonly SupportedClaim[];
  readonly unsupported: readonly UnsupportedClaim[];
}

export interface VerifyClaimsInput {
  readonly text: string;
  readonly ledger: ActionLedger;
  readonly detect?: DetectClaimsOptions;
}

/**
 * Which ledger effects satisfy which asserted family.
 *
 * An empty list means "nothing this system can do would satisfy it", which is
 * what produces `NO_TOOL_FOR_PROMISE`. `ANY` is the special case: an assertion
 * that something completed without naming what, satisfied by any STATE-CHANGING
 * effect and deliberately not by an availability check.
 */
const EFFECTS_FOR_FAMILY: Record<ClaimEffectFamily, readonly LedgerEffectKind[]> = {
  MEETING: ['MEETING_SCHEDULED', 'MEETING_RESCHEDULED'],
  RESCHEDULE: ['MEETING_RESCHEDULED', 'MEETING_SCHEDULED'],
  CANCELLATION: ['MEETING_CANCELLED'],
  CALLBACK: ['CALLBACK_SCHEDULED'],
  MESSAGE: [],
  RECORD: ['QUALIFICATION_RECORDED', 'CALL_OUTCOME_RECORDED'],
  HANDOVER: ['HUMAN_HANDOVER_REQUESTED'],
  ANY: STATE_CHANGING_EFFECT_KINDS,
};

/** Which tool would have produced an effect of this family, for refusal matching. */
const TOOLS_FOR_FAMILY: Record<ClaimEffectFamily, readonly string[]> = {
  MEETING: ['schedule_meeting'],
  RESCHEDULE: ['reschedule_meeting', 'schedule_meeting'],
  CANCELLATION: ['cancel_meeting'],
  CALLBACK: ['schedule_followup'],
  MESSAGE: ['schedule_followup'],
  RECORD: ['update_qualification', 'record_call_outcome'],
  HANDOVER: ['transfer_to_human'],
  ANY: [
    'schedule_meeting',
    'reschedule_meeting',
    'cancel_meeting',
    'schedule_followup',
    'update_qualification',
    'record_call_outcome',
    'transfer_to_human',
  ],
};

export function verifyClaims(input: VerifyClaimsInput): ClaimVerification {
  const claims = detectMaterialClaims(input.text, input.detect ?? {});
  const supported: SupportedClaim[] = [];
  const unsupported: UnsupportedClaim[] = [];
  const issued = issuedIdentifierSet(input.ledger);

  for (const claim of claims) {
    // ---- identifiers first, because they are checkable on their own --------
    const invented = claim.identifiers.find((identifier) => !issued.has(identifier.toLowerCase()));
    if (invented !== undefined) {
      unsupported.push({
        claim,
        reason: 'INVENTED_IDENTIFIER',
        detail: { family: claim.family, invalidIdentifier: invented },
      });
      continue;
    }

    if (claim.kind === 'IDENTIFIER_ASSERTED') {
      // A phrase announcing an identifier, with no identifier-shaped token
      // beside it AT ALL. Supported only when the system actually has one to
      // give - anything else is a promise of a reference that does not exist.
      //
      // The narrower reading is deliberate and it is why the check above runs
      // first: a marker phrase with a number-shaped token next to it is decided
      // by whether THAT token was issued, not by whether some unrelated
      // operational identifier exists. The detector collects the looser
      // number-and-code shapes for exactly this claim, so
      // `Your confirmation number is 483921.` reaches the INVENTED_IDENTIFIER
      // branch instead of being satisfied here by a real booking's row id.
      if (claim.identifiers.length > 0 || hasIssuedOperationalIdentifier(input.ledger)) {
        supported.push({ claim, matchedEffect: null });
      } else {
        unsupported.push({
          claim,
          reason: 'NO_MATCHING_EFFECT',
          detail: { family: claim.family, expectedEffectKinds: EFFECTS_FOR_FAMILY.ANY },
        });
      }
      continue;
    }

    // ---- an effect of this family, or nothing that could ever be one -------
    const wanted = EFFECTS_FOR_FAMILY[claim.family];
    if (wanted.length === 0) {
      unsupported.push({
        claim,
        reason: 'NO_TOOL_FOR_PROMISE',
        detail: { family: claim.family, expectedEffectKinds: [] },
      });
      continue;
    }

    const candidates = input.ledger.effects.filter((effect) => wanted.includes(effect.kind));
    if (candidates.length === 0) {
      const refusal = refusalForFamily(input.ledger, claim.family);
      unsupported.push({
        claim,
        reason: refusal ? 'EFFECT_WAS_REFUSED' : 'NO_MATCHING_EFFECT',
        detail: {
          family: claim.family,
          expectedEffectKinds: wanted,
          ...(refusal
            ? { refusal: { toolName: refusal.toolName, code: refusal.code, reason: refusal.reason } }
            : {}),
        },
      });
      continue;
    }

    // ---- the day and the time, against every candidate --------------------
    // One claim against N candidate effects: it is supported if ANY of them
    // agrees. That is what lets "the meeting is confirmed for Thursday" pass
    // when Thursday's meeting was booked last week and today's turn booked a
    // second one for Friday.
    const judged = candidates.map((effect) => ({ effect, verdict: reconcile(claim, effect, input.ledger) }));
    const agreeing = judged.find((entry) => entry.verdict.ok);
    if (agreeing !== undefined) {
      supported.push({ claim, matchedEffect: agreeing.effect });
      continue;
    }

    // Nothing agreed. Report the closest disagreement, preferring a wrong DAY
    // over a wrong TIME: a customer on the wrong day misses the meeting
    // entirely, so that is the more serious of the two and the one the
    // regeneration instruction should lead with.
    const closest = judged.find((entry) => entry.verdict.reason === 'WRONG_DAY') ?? judged[0];
    unsupported.push({
      claim,
      reason: closest?.verdict.reason ?? 'WRONG_DAY',
      detail: {
        family: claim.family,
        expectedEffectKinds: wanted,
        ...(closest?.verdict.assertedLocal ? { assertedLocal: closest.verdict.assertedLocal } : {}),
        ...(closest?.effect.localTime
          ? { recordedLocal: `${closest.effect.localTime.local} ${closest.effect.localTime.timezone}` }
          : {}),
      },
    });
  }

  return { supported, unsupported };
}

// ---------------------------------------------------------------------------

/**
 * Is there an identifier a contact could legitimately be given?
 *
 * The contact's own id does not count. It is an identifier the system issued, so
 * a model repeating it has not INVENTED one - but "here is your confirmation
 * number" backed by nothing except the contact's primary key is not a supported
 * claim, and the prompt forbids reading that value out at all.
 */
function hasIssuedOperationalIdentifier(ledger: ActionLedger): boolean {
  return ledger.identifiers.some((identifier) => identifier.kind !== 'CONTACT');
}

function refusalForFamily(ledger: ActionLedger, family: ClaimEffectFamily): LedgerRefusal | null {
  const tools = TOOLS_FOR_FAMILY[family];
  return ledger.refusals.find((refusal) => tools.includes(refusal.toolName)) ?? ledger.refusals[0] ?? null;
}

interface Reconciliation {
  readonly ok: boolean;
  readonly reason?: UnsupportedClaimReason;
  readonly assertedLocal?: string;
}

/** Does this one effect agree with the day and time the text named? */
function reconcile(claim: DetectedClaim, effect: LedgerEffect, ledger: ActionLedger): Reconciliation {
  const day = claim.assertedDay;
  const time = claim.assertedTime;
  const unread = claim.unreadTemporal;

  // § 20. THE THIRD STATE, AND IT HAS TO BE TESTED BEFORE THE NULL SHORTCUT. A
  // claim whose day and time are both `null` may be either of two things, and
  // only one of them is safe: `Your meeting is booked.` names nothing and must
  // pass with no regeneration, while `Your meeting is booked for the weekend.`
  // names something this gate could not read. `unreadTemporal` is what tells them
  // apart, so the shortcut below is now conditional on it being empty.
  if (day === null && time === null && unread.length === 0) return { ok: true };

  const local = effect.localTime;
  if (local === null) {
    // The text named a day or a time and the effect has no instant at all - a
    // handover, a recorded outcome. Nothing can confirm the day, so this is
    // uncertainty, and uncertainty is unsupported.
    return { ok: false, reason: 'WRONG_DAY', assertedLocal: describeAsserted(day, time) };
  }

  if (day !== null) {
    const verdict = reconcileDay(day, local, ledger);
    if (!verdict) return { ok: false, reason: 'WRONG_DAY', assertedLocal: describeAsserted(day, time) };
  }

  if (time !== null) {
    const verdict = reconcileTime(time, local, ledger);
    if (!verdict) return { ok: false, reason: 'WRONG_TIME', assertedLocal: describeAsserted(day, time) };
  }

  // § 20, AND IT IS TESTED LAST ON PURPOSE. Whatever the text DID name is
  // compared first, so `Your meeting is booked for Saturday at half past four.`
  // against a Thursday booking is reported as WRONG_DAY - a flat contradiction
  // the model can act on - rather than as an unreadable phrase. `UNREADABLE_WHEN`
  // is what is left when everything readable agreed and something in the same
  // temporal phrase did not get read at all.
  if (unread.length > 0) {
    return { ok: false, reason: 'UNREADABLE_WHEN', assertedLocal: describeUnread(unread, day, time) };
  }

  return { ok: true };
}

function reconcileDay(
  day: AssertedDay,
  local: { readonly isoWeekday: number; readonly year: number; readonly month: number; readonly day: number },
  ledger: ActionLedger,
): boolean {
  if (day.isoWeekday !== null && day.isoWeekday !== local.isoWeekday) return false;
  if (day.dayOfMonth !== null && day.dayOfMonth !== local.day) return false;
  if (day.month !== null && day.month !== local.month) return false;
  if (day.year !== null && day.year !== local.year) return false;

  if (day.offsetDays !== null) {
    // `tomorrow` is resolved against the turn's PINNED `now`, in the contact's
    // zone, which is the same instant and the same zone the scheduler resolved
    // the booking against. Anything else and the gate could disagree with the
    // resolver across a local midnight - the exact failure
    // `src/scheduling/pinnedSlot.ts` exists to close.
    const now = DateTime.fromMillis(Date.parse(ledger.nowUtc), { zone: ledger.contactTimezone });
    if (!now.isValid) return false;
    const expected = now.plus({ days: day.offsetDays });
    if (expected.year !== local.year || expected.month !== local.month || expected.day !== local.day) return false;
  }

  return true;
}

function reconcileTime(
  time: AssertedTime,
  local: { readonly hour: number; readonly minute: number },
  ledger: ActionLedger,
): boolean {
  if (time.dayPart !== null) {
    const window = windowFor(time.dayPart, ledger);
    if (window !== null && !withinWindow(local.hour, local.minute, window)) return false;
  }

  if (time.hour === null) return true;

  if (!time.hourIsAmbiguous) {
    if (time.hour !== local.hour) return false;
    if (time.minute !== null && time.minute !== local.minute) return false;
    return true;
  }

  // A bare 12-hour reading. Resolve it the way the scheduler does: prefer the
  // reading that falls inside the named day part, and when no day part was named
  // accept either half of the clock.
  const readings = [time.hour, time.hour === 12 ? 0 : time.hour + 12];
  const window = time.dayPart === null ? null : windowFor(time.dayPart, ledger);
  const allowed =
    window === null
      ? readings
      : readings.filter((hour) => withinWindow(hour, time.minute ?? 0, window));
  const candidates = allowed.length > 0 ? allowed : readings;
  if (!candidates.includes(local.hour)) return false;
  if (time.minute !== null && time.minute !== local.minute) return false;
  return true;
}

function windowFor(dayPart: string, ledger: ActionLedger): DayPartWindow | null {
  const windows = ledger.dayParts as Record<string, DayPartWindow | undefined>;
  return windows[dayPart] ?? null;
}

function withinWindow(hour: number, minute: number, window: DayPartWindow): boolean {
  const minutes = hour * 60 + minute;
  return minutes >= toMinutes(window.startLocal) && minutes < toMinutes(window.endLocal);
}

function toMinutes(hhmm: string): number {
  const [hours, mins] = hhmm.split(':');
  return Number(hours) * 60 + Number(mins ?? '0');
}

/** What the text asserted, for an audit detail. Never a customer sentence. */
function describeAsserted(day: AssertedDay | null, time: AssertedTime | null): string {
  const parts = [...(day?.forms ?? []), ...(time?.forms ?? [])];
  return parts.length > 0 ? parts.join(' ') : '(unspecified)';
}

/**
 * The § 20 detail: which word stopped the read, and what was read around it.
 *
 * Tokens rather than the sentence, for the reason `stateInstruction.ts` gives at
 * length: a string this code puts in front of the model is a script, whoever
 * wrote it. A bare word is a fact about the parse and cannot be read out.
 */
function describeUnread(unread: readonly string[], day: AssertedDay | null, time: AssertedTime | null): string {
  const readable = describeAsserted(day, time);
  const could = `could not read ${unread.map((token) => JSON.stringify(token)).join(', ')}`;
  return day === null && time === null ? could : `${readable}; ${could}`;
}
