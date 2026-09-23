/**
 * Test-database isolation.
 *
 * Sibling tasks build their entire suites on `createTestDatabase()`, so this
 * property is load-bearing: two harnesses must be two genuinely separate
 * databases, not two handles on one.
 *
 * The cross-FILE half of this proof lives in `isolationPeerA.test.ts` and
 * `isolationPeerB.test.ts`: both seed the SAME fixture set, including the same
 * globally-unique user email. If they shared a database one of them would fail
 * on the unique constraint, whichever order vitest happened to run them in.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../helpers/testDb.js';
import { FIXTURE, testProvenanceJson } from '../helpers/fixtures.js';

let first: TestDatabase;
let second: TestDatabase;

beforeAll(async () => {
  first = await createTestDatabase({ label: 'isolation-first' });
  second = await createTestDatabase({ label: 'isolation-second' });
});

afterAll(async () => {
  await first.cleanup();
  await second.cleanup();
});

describe('two harnesses are two databases', () => {
  it('use different files', () => {
    expect(first.filePath).not.toBe(second.filePath);
    expect(first.databaseUrl).not.toBe(second.databaseUrl);
    expect(first.filePath).toContain('isolation-first');
    expect(second.filePath).toContain('isolation-second');
  });

  it('start empty, regardless of what any other suite has written', async () => {
    expect(await first.db.organizations.list()).toHaveLength(0);
    expect(await second.db.organizations.list()).toHaveLength(0);
  });

  it('cannot see each other\'s rows', async () => {
    const firstFixtures = await first.seedFixtures();
    const secondFixtures = await second.seedFixtures();

    expect(await first.db.organizations.list()).toHaveLength(1);
    expect(await second.db.organizations.list()).toHaveLength(1);

    expect(await first.db.contacts.findById(secondFixtures.contact.id)).toBeNull();
    expect(await second.db.contacts.findById(firstFixtures.contact.id)).toBeNull();
  });

  it('can each hold a row that a globally-unique constraint would otherwise reject', async () => {
    // Both databases now contain a User with the identical, @unique email.
    // That is only possible because they are separate databases.
    const firstUser = await first.db.users.findByEmail(FIXTURE.userEmail);
    const secondUser = await second.db.users.findByEmail(FIXTURE.userEmail);

    expect(firstUser).not.toBeNull();
    expect(secondUser).not.toBeNull();
    expect(firstUser?.id).not.toBe(secondUser?.id);
  });

  it('keeps writes local: a meeting in one is invisible in the other', async () => {
    const firstOrg = (await first.db.organizations.list())[0]!;
    const firstContact = (await first.db.contacts.listByOrganization(firstOrg.id))[0]!;

    const meeting = await first.db.meetings.create({
      organizationId: firstOrg.id,
      contactId: firstContact.id,
      title: 'Only in the first database',
      startUtc: '2026-03-11T18:00:00.000Z',
      endUtc: '2026-03-11T18:30:00.000Z',
      timezone: 'America/New_York',
      idempotencyKey: 'isolation-shared-key',
      validationProvenanceJson: testProvenanceJson(),
    });

    expect(await second.db.meetings.findById(meeting.id)).toBeNull();

    // The same idempotency key is free in the second database - further proof
    // the unique index is not shared.
    const secondOrg = (await second.db.organizations.list())[0]!;
    const secondContact = (await second.db.contacts.listByOrganization(secondOrg.id))[0]!;
    const twin = await second.db.meetings.create({
      organizationId: secondOrg.id,
      contactId: secondContact.id,
      title: 'Only in the second database',
      startUtc: '2026-03-11T18:00:00.000Z',
      endUtc: '2026-03-11T18:30:00.000Z',
      timezone: 'America/New_York',
      idempotencyKey: 'isolation-shared-key',
      validationProvenanceJson: testProvenanceJson(),
    });

    expect(twin.id).not.toBe(meeting.id);
  });
});

describe('cleanup', () => {
  it('removes the database file it created', async () => {
    const throwaway = await createTestDatabase({ label: 'isolation-throwaway' });
    const { filePath } = throwaway;

    const { existsSync } = await import('node:fs');
    expect(existsSync(filePath)).toBe(true);

    await throwaway.cleanup();
    expect(existsSync(filePath)).toBe(false);
  });

  it('needs no network access and no environment secret', async () => {
    // The harness must work with DATABASE_URL and OPENAI_API_KEY absent
    // entirely: it injects its own datasource URL and never touches an LLM.
    const savedDatabaseUrl = process.env['DATABASE_URL'];
    const savedApiKey = process.env['OPENAI_API_KEY'];
    delete process.env['DATABASE_URL'];
    delete process.env['OPENAI_API_KEY'];

    try {
      const bare = await createTestDatabase({ label: 'isolation-no-env', seed: true });
      try {
        expect(await bare.db.organizations.list()).toHaveLength(1);
      } finally {
        await bare.cleanup();
      }
    } finally {
      if (savedDatabaseUrl !== undefined) process.env['DATABASE_URL'] = savedDatabaseUrl;
      if (savedApiKey !== undefined) process.env['OPENAI_API_KEY'] = savedApiKey;
    }
  });
});
