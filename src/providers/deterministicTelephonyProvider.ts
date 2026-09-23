/**
 * `DeterministicTelephonyProvider` - places calls that go nowhere.
 *
 * MISSION CONSTRAINT, ENFORCED BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 * Do not call real phone numbers. This file imports node's crypto, the port
 * types and the shared errors - nothing else. There is no HTTP client, no
 * socket, and no vendor SDK anywhere in the module graph, so it CANNOT reach
 * the network however it is configured. `tests/scheduling/providerBoundary.test.ts`
 * fails the build if that ever stops being true.
 *
 * SCRIPTED OUTCOMES
 * ---------------------------------------------------------------------------
 * The follow-up engine's retry logic only means something if a test can make a
 * call fail on demand, so the double takes a script:
 *
 * ```ts
 * new DeterministicTelephonyProvider({
 *   script: [{ status: 'NO_ANSWER' }, { status: 'FAILED' }, { status: 'COMPLETED' }],
 * });
 * ```
 *
 * Steps are consumed in order by each DISTINCT call; once exhausted,
 * `defaultStatus` repeats forever. A repeated `idempotencyKey` replays the
 * previous result instead of consuming a step - a retry of the same call is not
 * a new call.
 */
import { createHash } from 'node:crypto';

import type {
  PlaceCallRequest,
  PlaceCallResult,
  TelephonyCallStatus,
  TelephonyProvider,
  TelephonyProviderCapabilities,
} from '../ports/telephony.js';
import { InvariantViolationError } from '../shared/errors.js';

/** One scripted outcome: either a reported status, or a thrown transport error. */
export type TelephonyScriptStep = { readonly status: TelephonyCallStatus } | { readonly error: string };

export interface DeterministicTelephonyProviderOptions {
  readonly name?: string;
  /** Consumed in order, one step per distinct call. */
  readonly script?: readonly TelephonyScriptStep[];
  /** Used once the script is exhausted. Defaults to `COMPLETED`. */
  readonly defaultStatus?: TelephonyCallStatus;
  readonly canSendSms?: boolean;
}

export interface RecordedCall {
  readonly request: PlaceCallRequest;
  readonly providerCallId: string;
  /** The status returned, or `null` when the step threw. */
  readonly status: TelephonyCallStatus | null;
  readonly error: string | null;
  /** 1-based index among distinct calls. */
  readonly attemptIndex: number;
}

export class DeterministicTelephonyProvider implements TelephonyProvider {
  private readonly providerName: string;
  private readonly script: readonly TelephonyScriptStep[];
  private readonly defaultStatus: TelephonyCallStatus;
  private readonly capability: TelephonyProviderCapabilities;

  private stepCursor = 0;
  private readonly resultsByKey = new Map<string, PlaceCallResult>();

  /** Every placeCall that was actually dispatched, in order. */
  readonly placedCalls: RecordedCall[] = [];
  /** Every providerCallId passed to `endCall`, in order. */
  readonly endedCalls: string[] = [];

  constructor(options: DeterministicTelephonyProviderOptions = {}) {
    this.providerName = options.name ?? 'deterministic-test';
    this.script = options.script ?? [];
    this.defaultStatus = options.defaultStatus ?? 'COMPLETED';
    this.capability = { canPlaceCalls: true, canSendSms: options.canSendSms ?? false };
  }

  name(): string {
    return this.providerName;
  }

  capabilities(): TelephonyProviderCapabilities {
    return this.capability;
  }

  async placeCall(req: PlaceCallRequest): Promise<PlaceCallResult> {
    if (!req.correlationId) {
      throw new InvariantViolationError('placeCall requires a correlationId so the call joins the audit chain', {
        details: { toE164: req.toE164 },
      });
    }

    const key = req.idempotencyKey ?? req.correlationId;
    const replayed = this.resultsByKey.get(key);
    if (replayed) {
      return replayed;
    }

    const providerCallId = deterministicId('det-call', key);
    const step = this.script[this.stepCursor];
    this.stepCursor += 1;
    const attemptIndex = this.placedCalls.length + 1;

    if (step !== undefined && 'error' in step) {
      this.placedCalls.push({
        request: req,
        providerCallId,
        status: null,
        error: step.error,
        attemptIndex,
      });
      throw new TelephonyDispatchError(step.error, { providerName: this.providerName, providerCallId });
    }

    const status = step?.status ?? this.defaultStatus;
    const result: PlaceCallResult = { providerCallId, status };
    this.resultsByKey.set(key, result);
    this.placedCalls.push({ request: req, providerCallId, status, error: null, attemptIndex });

    return result;
  }

  async endCall(providerCallId: string): Promise<void> {
    this.endedCalls.push(providerCallId);
  }

  /** Calls placed to one number, for readable assertions. */
  callsTo(toE164: string): RecordedCall[] {
    return this.placedCalls.filter((call) => call.request.toE164 === toE164);
  }
}

/**
 * A transport failure from a telephony vendor.
 *
 * Its own type so the follow-up runner can tell "the vendor could not be
 * reached" apart from "the vendor reported the call was not answered" - the
 * first is our problem, the second is information about the contact.
 */
export class TelephonyDispatchError extends InvariantViolationError {
  constructor(message: string, details: Record<string, unknown>) {
    super(`Telephony dispatch failed: ${message}`, { details });
  }
}

function deterministicId(prefix: string, material: string): string {
  return `${prefix}-${createHash('sha256').update(material).digest('hex').slice(0, 24)}`;
}
