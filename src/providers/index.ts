/**
 * The provider registry: the one place that decides WHICH implementation of
 * each port the application runs against.
 *
 * WHY A REGISTRY AT ALL
 * ---------------------------------------------------------------------------
 * So that "which calendar are we writing to?" is a configuration question with
 * exactly one answer site, rather than a `new GoogleCalendarProvider()` buried
 * in a service. Services take the PORT; only this file names an implementation.
 *
 * WHAT IS WIRED IN THIS MISSION
 * ---------------------------------------------------------------------------
 * `DETERMINISTIC_TEST` and nothing else, for every port. That is a Founder
 * constraint, not an oversight: no real phone numbers, no real calendars, and
 * no paid external service without explicit approval. Asking for any other kind
 * throws a `ConfigurationError` that says so, rather than silently falling back
 * to a double (which would let a "production" configuration pass tests while
 * doing nothing).
 */
import type { CalendarProviderKind } from '../domain/enums.js';
import type { AvailabilityProvider } from '../ports/availability.js';
import type { CalendarProvider } from '../ports/calendar.js';
import type { TelephonyProvider } from '../ports/telephony.js';
import { ConfigurationError } from '../shared/errors.js';
import {
  DeterministicAvailabilityProvider,
  type DeterministicAvailabilityProviderOptions,
} from './deterministicAvailabilityProvider.js';
import {
  DeterministicCalendarProvider,
  type DeterministicCalendarProviderOptions,
} from './deterministicCalendarProvider.js';
import {
  DeterministicTelephonyProvider,
  type DeterministicTelephonyProviderOptions,
} from './deterministicTelephonyProvider.js';

export * from './deterministicAvailabilityProvider.js';
export * from './deterministicCalendarProvider.js';
export * from './deterministicTelephonyProvider.js';

// ---------------------------------------------------------------------------
// EXTENSION POINTS
//
// Everything below is a NAME, not a dependency. No vendor SDK is installed, and
// adding one is a Founder decision, not an implementation detail.
//
// AvailabilityProvider / CalendarProvider - future targets:
//   GOOGLE          -> Google Calendar API (freebusy.query, events.insert).
//                      Needs OAuth; `CalendarConnection` deliberately stores no
//                      tokens yet, pending an approved secrets mechanism.
//   MICROSOFT_GRAPH -> Microsoft Graph (/me/calendar/getSchedule, /events).
//                      Same token-storage precondition.
//
// TelephonyProvider - future targets:
//   TWILIO   -> Programmable Voice
//   TELNYX   -> Call Control
//   VONAGE   -> Voice API
//   VAPI     -> hosted voice agent
//   RETELL   -> hosted voice agent
//
// To add one: implement the port in `src/providers/<vendor>...Provider.ts`,
// add its kind to the union below, and wire it in the matching factory. NOTHING
// in src/scheduling, src/followup or src/domain changes - that is the whole
// point of the port, and `tests/scheduling/providerBoundary.test.ts` keeps it
// true.
// ---------------------------------------------------------------------------

/**
 * Availability and calendar both select with the DOMAIN's
 * `CalendarProviderKind` (`GOOGLE | MICROSOFT_GRAPH | DETERMINISTIC_TEST`)
 * rather than a parallel union, so the value stored on
 * `CalendarConnection.provider` is the same value that picks the code.
 */
export type AvailabilityProviderKind = CalendarProviderKind;

export const TELEPHONY_PROVIDER_KINDS = [
  'DETERMINISTIC_TEST',
  'TWILIO',
  'TELNYX',
  'VONAGE',
  'VAPI',
  'RETELL',
] as const;
export type TelephonyProviderKind = (typeof TELEPHONY_PROVIDER_KINDS)[number];

/** The kinds this mission is authorized to construct. */
const AUTHORIZED_KIND = 'DETERMINISTIC_TEST';

export interface ProviderRegistryConfig {
  readonly availability?: {
    readonly kind?: AvailabilityProviderKind;
    readonly options?: DeterministicAvailabilityProviderOptions;
  };
  readonly calendar?: {
    readonly kind?: CalendarProviderKind;
    readonly options?: DeterministicCalendarProviderOptions;
  };
  readonly telephony?: {
    readonly kind?: TelephonyProviderKind;
    readonly options?: DeterministicTelephonyProviderOptions;
  };
}

export interface ProviderRegistry {
  readonly availability: AvailabilityProvider;
  readonly calendar: CalendarProvider;
  readonly telephony: TelephonyProvider;
  /** Which kind each port resolved to. Worth recording in an audit event. */
  readonly kinds: {
    readonly availability: AvailabilityProviderKind;
    readonly calendar: CalendarProviderKind;
    readonly telephony: TelephonyProviderKind;
  };
}

export function createProviderRegistry(config: ProviderRegistryConfig = {}): ProviderRegistry {
  const availabilityKind = config.availability?.kind ?? AUTHORIZED_KIND;
  const calendarKind = config.calendar?.kind ?? AUTHORIZED_KIND;
  const telephonyKind = config.telephony?.kind ?? AUTHORIZED_KIND;

  return {
    availability: createAvailabilityProvider(availabilityKind, config.availability?.options),
    calendar: createCalendarProvider(calendarKind, config.calendar?.options),
    telephony: createTelephonyProvider(telephonyKind, config.telephony?.options),
    kinds: { availability: availabilityKind, calendar: calendarKind, telephony: telephonyKind },
  };
}

export function createAvailabilityProvider(
  kind: AvailabilityProviderKind,
  options?: DeterministicAvailabilityProviderOptions,
): AvailabilityProvider {
  if (kind !== AUTHORIZED_KIND) {
    throw unauthorized('AvailabilityProvider', kind);
  }
  return new DeterministicAvailabilityProvider(options ?? {});
}

export function createCalendarProvider(
  kind: CalendarProviderKind,
  options?: DeterministicCalendarProviderOptions,
): CalendarProvider {
  if (kind !== AUTHORIZED_KIND) {
    throw unauthorized('CalendarProvider', kind);
  }
  return new DeterministicCalendarProvider(options ?? {});
}

export function createTelephonyProvider(
  kind: TelephonyProviderKind,
  options?: DeterministicTelephonyProviderOptions,
): TelephonyProvider {
  if (kind !== AUTHORIZED_KIND) {
    throw unauthorized('TelephonyProvider', kind);
  }
  return new DeterministicTelephonyProvider(options ?? {});
}

function unauthorized(port: string, kind: string): ConfigurationError {
  return new ConfigurationError(
    `${port} kind "${kind}" is a declared extension point but is NOT implemented or authorized in this ` +
      'mission. Only DETERMINISTIC_TEST providers may be constructed: no real calls, no real calendars, ' +
      'and no paid external service without explicit Founder approval.',
    { details: { port, kind, authorized: [AUTHORIZED_KIND] } },
  );
}
