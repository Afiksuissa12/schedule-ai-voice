/**
 * Configuration and the shared primitives everything else is built on.
 */
import { describe, expect, it } from 'vitest';

import { loadConfig, requireOpenAiApiKey } from '../../src/config/env.js';
import { BusinessHoursPolicySchema, weekdayBusinessHours } from '../../src/domain/businessHours.js';
import { E164Schema, IanaTimezoneSchema } from '../../src/domain/enums.js';
import { ConfigurationError, InvariantViolationError } from '../../src/shared/errors.js';
import { deriveIdempotencyKey } from '../../src/shared/ids.js';
import { parseJsonWith, stringifyJson, stringifyJsonStable } from '../../src/shared/json.js';
import {
  fromIsoUtc,
  isIsoUtcString,
  isValidIanaTimezone,
  normalizeIsoUtc,
  toIsoUtc,
} from '../../src/shared/time.js';

describe('loadConfig', () => {
  it('reads a complete environment', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./dev.db',
      OPENAI_API_KEY: 'sk-not-a-real-key',
      APP_TIMEZONE_DEFAULT: 'America/New_York',
    });

    expect(config.nodeEnv).toBe('test');
    expect(config.databaseUrl).toBe('file:./dev.db');
    expect(config.openAiApiKey).toBe('sk-not-a-real-key');
    expect(config.appTimezoneDefault).toBe('America/New_York');
  });

  it('treats an empty OPENAI_API_KEY as absent, which is a supported state', () => {
    // .env.example ships the key EMPTY, and the whole test suite must run
    // without one. An empty string must not become a bogus credential.
    const config = loadConfig({ DATABASE_URL: 'file:./dev.db', OPENAI_API_KEY: '' });
    expect(config.openAiApiKey).toBeNull();
    expect(() => requireOpenAiApiKey(config)).toThrow(/OPENAI_API_KEY is not set/);
  });

  it('rejects a missing DATABASE_URL loudly', () => {
    expect(() => loadConfig({})).toThrow(ConfigurationError);
    expect(() => loadConfig({})).toThrow(/databaseUrl/);
  });

  it('rejects an APP_TIMEZONE_DEFAULT that is not a real IANA zone', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'file:./dev.db', APP_TIMEZONE_DEFAULT: 'Pacific/Atlantis' }),
    ).toThrow(/IANA timezone/);
  });

  it('defaults the timezone rather than guessing from the host', () => {
    expect(loadConfig({ DATABASE_URL: 'file:./dev.db' }).appTimezoneDefault).toBe('UTC');
  });
});

describe('time conversion', () => {
  it('round-trips a Date through an ISO UTC string', () => {
    const iso = '2026-03-11T18:00:00.000Z';
    expect(toIsoUtc(fromIsoUtc(iso))).toBe(iso);
  });

  it('normalizes an offset instant to canonical UTC', () => {
    expect(normalizeIsoUtc('2026-03-11T14:00:00-04:00')).toBe('2026-03-11T18:00:00.000Z');
  });

  it('refuses a bare local datetime, which is not an instant at all', () => {
    expect(() => fromIsoUtc('2026-03-11T14:00')).toThrow(/missing a UTC offset/);
    expect(isIsoUtcString('2026-03-11T14:00')).toBe(false);
  });

  it('refuses an unparseable value rather than producing an Invalid Date', () => {
    expect(() => fromIsoUtc('next Wednesday')).toThrow(/valid ISO-8601/);
  });

  it('accepts real IANA zone names and rejects offsets posing as zones', () => {
    expect(isValidIanaTimezone('America/New_York')).toBe(true);
    expect(isValidIanaTimezone('UTC')).toBe(true);
    expect(isValidIanaTimezone('Europe/Berlin')).toBe(true);
    // An offset carries no DST rule, so a meeting agreed in it drifts.
    expect(isValidIanaTimezone('-05:00')).toBe(false);
    expect(isValidIanaTimezone('+02:00')).toBe(false);
    expect(isValidIanaTimezone('UTC+2')).toBe(false);
    expect(isValidIanaTimezone('Pacific/Atlantis')).toBe(false);
    expect(isValidIanaTimezone('')).toBe(false);
  });
});

describe('value-object schemas', () => {
  it('accepts E.164 and rejects everything else', () => {
    expect(E164Schema.safeParse('+12125550147').success).toBe(true);
    expect(E164Schema.safeParse('+442071838750').success).toBe(true);
    expect(E164Schema.safeParse('2125550147').success).toBe(false);
    expect(E164Schema.safeParse('(212) 555-0147').success).toBe(false);
    expect(E164Schema.safeParse('+0125550147').success).toBe(false);
  });

  it('accepts only real IANA zones', () => {
    expect(IanaTimezoneSchema.safeParse('America/New_York').success).toBe(true);
    expect(IanaTimezoneSchema.safeParse('-05:00').success).toBe(false);
  });
});

describe('business hours policy', () => {
  it('builds the Mon-Fri 09:00-17:00 default and round-trips it through JSON', () => {
    const policy = weekdayBusinessHours();
    const restored = parseJsonWith(stringifyJson(policy), BusinessHoursPolicySchema, 'businessHoursJson');

    expect(restored.windows).toHaveLength(5);
    expect(restored.windows.map((window) => window.isoWeekday)).toEqual([1, 2, 3, 4, 5]);
    expect(restored.windows.every((window) => window.startLocal === '09:00')).toBe(true);
    expect(restored.holidayDatesLocal).toEqual([]);
  });

  it('rejects a window that ends before it starts', () => {
    expect(
      BusinessHoursPolicySchema.safeParse({
        version: 1,
        windows: [{ isoWeekday: 1, startLocal: '17:00', endLocal: '09:00' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed local time', () => {
    expect(
      BusinessHoursPolicySchema.safeParse({
        version: 1,
        windows: [{ isoWeekday: 1, startLocal: '9am', endLocal: '17:00' }],
      }).success,
    ).toBe(false);
  });
});

describe('json helpers', () => {
  it('produces a stable serialization regardless of key order', () => {
    expect(stringifyJsonStable({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stringifyJsonStable({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it('turns unserializable input into a loud error', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => stringifyJson(circular)).toThrow(InvariantViolationError);
  });

  it('attributes malformed stored JSON to its column', () => {
    expect(() => parseJsonWith('{oops', BusinessHoursPolicySchema, 'businessHoursJson')).toThrow(
      /Stored businessHoursJson is not valid JSON/,
    );
  });

  it('derives the same idempotency key for the same semantic action', () => {
    const first = deriveIdempotencyKey('meeting', {
      contactId: 'c1',
      startUtc: '2026-03-11T18:00:00.000Z',
    });
    const second = deriveIdempotencyKey('meeting', {
      startUtc: '2026-03-11T18:00:00.000Z',
      contactId: 'c1',
    });
    expect(first).toBe(second);
  });
});
