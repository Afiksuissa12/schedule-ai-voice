/**
 * Cross-FILE isolation, half B. See `isolationPeerA.test.ts` for the rationale.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../helpers/testDb.js';
import { FIXTURE, type TestFixtures } from '../helpers/fixtures.js';

let harness: TestDatabase;
let fixtures: TestFixtures;

beforeAll(async () => {
  harness = await createTestDatabase({ label: 'isolation-peer-b' });
  fixtures = await harness.seedFixtures();
});

afterAll(async () => {
  await harness.cleanup();
});

describe('isolation peer B', () => {
  it('owns exactly one organization', async () => {
    expect(await harness.db.organizations.list()).toHaveLength(1);
  });

  it('owns exactly one user, holding the shared unique email', async () => {
    const users = await harness.db.users.listByOrganization(fixtures.organization.id);
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe(FIXTURE.userEmail);
  });

  it('owns exactly one contact', async () => {
    const contacts = await harness.db.contacts.listByOrganization(fixtures.organization.id);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.primaryPhoneE164).toBe(FIXTURE.contactPhoneE164);
  });

  it('writes its own marker row and never sees peer A\'s', async () => {
    await harness.db.leads.create({
      organizationId: fixtures.organization.id,
      contactId: fixtures.contact.id,
      source: 'marker-from-peer-b',
    });

    const leads = await harness.db.leads.listByOrganization(fixtures.organization.id);
    expect(leads.map((lead) => lead.source)).toEqual(['marker-from-peer-b']);
  });
});
