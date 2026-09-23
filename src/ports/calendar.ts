/**
 * PORT: calendar writes.
 *
 * CONTRACT: nothing in the core domain may import a Google or Microsoft SDK
 * type. Everything a calendar vendor needs is expressed with primitives here.
 *
 * MISSION CONSTRAINT: implementations used in this mission must be
 * deterministic test doubles. No writes to any real or production calendar.
 */
import type { IsoUtcString } from './clock.js';

export interface CalendarAttendee {
  /** Attendee email address, or an opaque provider reference. */
  readonly email: string;
  readonly displayName?: string;
  /** True when this attendee's presence is required. */
  readonly required?: boolean;
}

export interface CalendarProviderCapabilities {
  /** False for a read-only availability-only connection. */
  readonly canWrite: boolean;
  /** False when the provider cannot deliver invitations to attendees. */
  readonly canInvite: boolean;
}

export interface CreateCalendarEventRequest {
  /** Provider-specific calendar identifier, from `CalendarConnection.calendarRef`. */
  readonly calendarRef: string;
  readonly title: string;
  readonly description?: string;
  readonly startUtc: IsoUtcString;
  readonly endUtc: IsoUtcString;
  /** IANA zone the event was agreed in; providers render invites in it. */
  readonly timezone: string;
  readonly attendees: readonly CalendarAttendee[];
  /**
   * Makes a retried create a no-op that returns the SAME externalEventId.
   * Mirrors `Meeting.idempotencyKey`.
   */
  readonly idempotencyKey: string;
}

export interface UpdateCalendarEventRequest {
  readonly calendarRef: string;
  readonly externalEventId: string;
  readonly title?: string;
  readonly description?: string;
  readonly startUtc?: IsoUtcString;
  readonly endUtc?: IsoUtcString;
  readonly timezone?: string;
  readonly attendees?: readonly CalendarAttendee[];
  readonly idempotencyKey: string;
}

export interface CancelCalendarEventRequest {
  readonly calendarRef: string;
  readonly externalEventId: string;
  readonly reason?: string;
  readonly idempotencyKey: string;
}

export interface CalendarEventRef {
  readonly externalEventId: string;
}

export interface CalendarProvider {
  /** Stable provider identity, recorded in audit events. */
  name(): string;

  capabilities(): CalendarProviderCapabilities;

  createEvent(req: CreateCalendarEventRequest): Promise<CalendarEventRef>;

  updateEvent(req: UpdateCalendarEventRequest): Promise<CalendarEventRef>;

  cancelEvent(req: CancelCalendarEventRequest): Promise<void>;
}
