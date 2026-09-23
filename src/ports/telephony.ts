/**
 * PORT: telephony.
 *
 * CONTRACT: nothing in the core domain may import a Twilio, Telnyx, Vonage,
 * Vapi or Retell type. The vendor lives entirely behind this interface, and the
 * only trace of it in the database is `Call.providerName` / `Call.providerCallId`.
 *
 * MISSION CONSTRAINT: implementations used in this mission must be
 * deterministic test doubles. Do not call real phone numbers. Do not send real
 * messages to real people.
 */

/**
 * Call lifecycle as reported by a provider. Kept structurally identical to the
 * `CallStatus` domain enum (src/domain/enums.ts) so the adapter is a direct
 * mapping with no translation table to drift.
 */
export type TelephonyCallStatus = 'QUEUED' | 'RINGING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'NO_ANSWER';

export interface TelephonyProviderCapabilities {
  readonly canPlaceCalls: boolean;
  readonly canSendSms: boolean;
}

export interface PlaceCallRequest {
  /** Destination number in E.164. */
  readonly toE164: string;
  /** Originating number in E.164. */
  readonly fromE164: string;
  /** Ties the resulting provider activity to this agent turn's audit chain. */
  readonly correlationId: string;
  /** Makes a retried placeCall return the same providerCallId instead of dialling twice. */
  readonly idempotencyKey?: string;
}

export interface PlaceCallResult {
  readonly providerCallId: string;
  readonly status: TelephonyCallStatus;
}

export interface TelephonyProvider {
  /** Stable provider identity, recorded in audit events and on `Call.providerName`. */
  name(): string;

  capabilities(): TelephonyProviderCapabilities;

  placeCall(req: PlaceCallRequest): Promise<PlaceCallResult>;

  endCall(providerCallId: string): Promise<void>;
}
