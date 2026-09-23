/**
 * The provenance invariant.
 *
 * "Never trust an LLM-generated datetime blindly" is only a slogan until the
 * database refuses to hold a scheduling decision that has no receipt. These
 * tests attack that invariant from every angle available: the type level, the
 * repository gate, and the raw Prisma client that bypasses the repository
 * entirely.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InvariantViolationError } from '../../src/shared/errors.js';
import { parseValidationProvenance } from '../../src/domain/provenance.js';
import { stringifyJson } from '../../src/shared/json.js';
import { createTestDatabase, type TestDatabase } from '../helpers/testDb.js';
import { testProvenance, testProvenanceJson, type TestFixtures } from '../helpers/fixtures.js';

let harness: TestDatabase;
let fixtures: TestFixtures;

beforeAll(async () => {
  harness = await createTestDatabase({ label: 'validation-provenance' });
  fixtures = await harness.seedFixtures();
});

afterAll(async () => {
  await harness.cleanup();
});

function meetingInput(validationProvenanceJson: string) {
  return {
    organizationId: fixtures.organization.id,
    contactId: fixtures.contact.id,
    title: 'Intro call',
    startUtc: '2026-03-11T18:00:00.000Z',
    endUtc: '2026-03-11T18:30:00.000Z',
    timezone: 'America/New_York',
    validationProvenanceJson,
  };
}

function futureActionInput(validationProvenanceJson: string) {
  return {
    organizationId: fixtures.organization.id,
    contactId: fixtures.contact.id,
    type: 'CALL_CONTACT' as const,
    scheduledForUtc: '2026-03-06T14:00:00.000Z',
    timezone: 'America/New_York',
    payloadJson: '{"reason":"call back"}',
    validationProvenanceJson,
  };
}

describe('Meeting cannot exist without validation provenance', () => {
  it('rejects an empty provenance', async () => {
    await expect(harness.db.meetings.create(meetingInput(''))).rejects.toBeInstanceOf(InvariantViolationError);
    await expect(harness.db.meetings.create(meetingInput('   '))).rejects.toThrow(/required/i);
  });

  it('rejects provenance that is not JSON', async () => {
    await expect(harness.db.meetings.create(meetingInput('not json at all'))).rejects.toThrow(
      /serialized ValidationProvenance/,
    );
  });

  it('rejects an empty object pretending to be a receipt', async () => {
    await expect(harness.db.meetings.create(meetingInput('{}'))).rejects.toThrow(
      /serialized ValidationProvenance/,
    );
  });

  it('rejects a receipt that records no checks', async () => {
    const noChecks = stringifyJson({ ...testProvenance(), checks: [] });
    await expect(harness.db.meetings.create(meetingInput(noChecks))).rejects.toThrow(
      /at least one recorded check/,
    );
  });

  it('rejects a receipt with no `nowUtc` - a check against an unknown present proves nothing', async () => {
    const { nowUtc: _dropped, ...withoutNow } = testProvenance();
    await expect(harness.db.meetings.create(meetingInput(stringifyJson(withoutNow)))).rejects.toThrow(
      /serialized ValidationProvenance/,
    );
  });

  it('rejects a receipt whose `nowUtc` is not a real instant', async () => {
    const badNow = stringifyJson({ ...testProvenance(), nowUtc: 'about lunchtime' });
    await expect(harness.db.meetings.create(meetingInput(badNow))).rejects.toThrow(
      /serialized ValidationProvenance/,
    );
  });

  it('rejects a receipt with no `validatorVersion` - an unattributable check', async () => {
    const anonymous = stringifyJson({ ...testProvenance(), validatorVersion: '' });
    await expect(harness.db.meetings.create(meetingInput(anonymous))).rejects.toThrow(
      /serialized ValidationProvenance/,
    );
  });

  it('accepts a complete receipt and stores it verbatim', async () => {
    const provenanceJson = testProvenanceJson();
    const meeting = await harness.db.meetings.create({
      ...meetingInput(provenanceJson),
      idempotencyKey: 'provenance-accepted-1',
    });

    expect(meeting.validationProvenanceJson).toBe(provenanceJson);

    const parsed = parseValidationProvenance(meeting.validationProvenanceJson);
    expect(parsed.rawProposedValue).toBe('next Wednesday at 2pm');
    expect(parsed.checks).toHaveLength(6);
  });

  it('will not let an update quietly replace a good receipt with a bad one', async () => {
    const meeting = await harness.db.meetings.create({
      ...meetingInput(testProvenanceJson()),
      idempotencyKey: 'provenance-update-1',
    });

    await expect(
      harness.db.meetings.update(meeting.id, {
        startUtc: '2026-03-12T18:00:00.000Z',
        endUtc: '2026-03-12T18:30:00.000Z',
        validationProvenanceJson: '{}',
      }),
    ).rejects.toThrow(/serialized ValidationProvenance/);

    const unchanged = await harness.db.meetings.requireById(meeting.id);
    expect(unchanged.startUtc).toBe('2026-03-11T18:00:00.000Z');
  });
});

describe('FutureAction cannot exist without validation provenance', () => {
  it('rejects an empty provenance', async () => {
    await expect(harness.db.futureActions.create(futureActionInput(''))).rejects.toBeInstanceOf(
      InvariantViolationError,
    );
  });

  it('rejects an empty object pretending to be a receipt', async () => {
    await expect(harness.db.futureActions.create(futureActionInput('{}'))).rejects.toThrow(
      /serialized ValidationProvenance/,
    );
  });

  it('rejects a receipt that records no checks', async () => {
    const noChecks = stringifyJson({ ...testProvenance(), checks: [] });
    await expect(harness.db.futureActions.create(futureActionInput(noChecks))).rejects.toThrow(
      /at least one recorded check/,
    );
  });

  it('accepts a complete receipt and stores it verbatim', async () => {
    const provenanceJson = testProvenanceJson({ rawProposedValue: 'call me Friday morning' });
    const action = await harness.db.futureActions.create({
      ...futureActionInput(provenanceJson),
      idempotencyKey: 'provenance-future-1',
    });

    expect(action.validationProvenanceJson).toBe(provenanceJson);
    expect(parseValidationProvenance(action.validationProvenanceJson).rawProposedValue).toBe(
      'call me Friday morning',
    );
  });

  it('also refuses an empty payload', async () => {
    await expect(
      harness.db.futureActions.create({ ...futureActionInput(testProvenanceJson()), payloadJson: '' }),
    ).rejects.toThrow(/payloadJson must not be empty/);
  });
});

describe('the column itself is NOT NULL, not merely guarded by the repository', () => {
  it('rejects a raw Prisma insert that omits the provenance on Meeting', async () => {
    // Bypassing the repository must not be a way around the invariant. The
    // `as never` is the point of the test: TypeScript refuses this too.
    await expect(
      harness.db.prisma.meeting.create({
        data: {
          organizationId: fixtures.organization.id,
          contactId: fixtures.contact.id,
          title: 'Smuggled in',
          startUtc: new Date('2026-03-11T18:00:00.000Z'),
          endUtc: new Date('2026-03-11T18:30:00.000Z'),
          timezone: 'America/New_York',
        } as never,
      }),
    ).rejects.toThrow();
  });

  it('rejects a raw Prisma insert that omits the provenance on FutureAction', async () => {
    await expect(
      harness.db.prisma.futureAction.create({
        data: {
          organizationId: fixtures.organization.id,
          contactId: fixtures.contact.id,
          type: 'CALL_CONTACT',
          scheduledForUtc: new Date('2026-03-06T14:00:00.000Z'),
          timezone: 'America/New_York',
          payloadJson: '{}',
        } as never,
      }),
    ).rejects.toThrow();
  });

  it('surfaces an empty provenance written behind the repository when the row is read back', async () => {
    // Belt and braces: even if something wrote an empty string directly, the
    // mapper refuses to hand it out as a valid Meeting.
    const smuggled = await harness.db.prisma.meeting.create({
      data: {
        organizationId: fixtures.organization.id,
        contactId: fixtures.contact.id,
        title: 'Empty receipt',
        startUtc: new Date('2026-03-13T18:00:00.000Z'),
        endUtc: new Date('2026-03-13T18:30:00.000Z'),
        timezone: 'America/New_York',
        validationProvenanceJson: '',
      },
    });

    await expect(harness.db.meetings.requireById(smuggled.id)).rejects.toThrow(/must not be empty/);
  });
});
