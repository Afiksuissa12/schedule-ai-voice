/**
 * The deterministic fixture set every test suite in this repository shares.
 *
 * Nothing here is random and nothing here reads the wall clock. Two runs
 * produce identical rows apart from the cuid primary keys, so a failing test is
 * always reproducible.
 *
 * The contact lives in America/New_York ON PURPOSE. A UTC-only fixture would
 * let an entire class of timezone bug pass every test in the suite.
 */
import type { Database } from '../../src/db/database.js';
import type {
  AgentConfiguration,
  AiAgent,
  CalendarConnection,
  Contact,
  Organization,
  User,
} from '../../src/domain/entities.js';
import { weekdayBusinessHours } from '../../src/domain/businessHours.js';
import type { ValidationProvenance } from '../../src/ports/validation.js';
import { stringifyJson } from '../../src/shared/json.js';
import { DEFAULT_TEST_NOW_UTC } from './testDb.js';

/** Fixed values, exported so assertions can reference them by name. */
export const FIXTURE = {
  organizationName: 'Acme Sales Co (test)',
  organizationTimezone: 'America/New_York',
  userEmail: 'owner@acme.test',
  userFullName: 'Dana Owner',
  agentName: 'Scheduling Agent',
  agentConfigVersion: 1,
  systemPromptRef: 'sales-scheduler@v1',
  businessHoursStartLocal: '09:00',
  businessHoursEndLocal: '17:00',
  minLeadTimeMinutes: 30,
  maxSchedulingHorizonDays: 180,
  allowedTools: ['schedule_meeting', 'schedule_follow_up', 'record_call_outcome', 'transfer_to_human'],
  contactFullName: 'Jordan Prospect',
  contactPhoneE164: '+12125550147',
  contactEmail: 'jordan@prospect.test',
  /** NON-UTC on purpose. */
  contactTimezone: 'America/New_York',
  contactIsDecisionMaker: true,
  calendarRef: 'primary-test-calendar',
  agentPhoneE164: '+12125550100',
} as const;

export interface TestFixtures {
  readonly organization: Organization;
  readonly user: User;
  readonly aiAgent: AiAgent;
  readonly agentConfiguration: AgentConfiguration;
  readonly contact: Contact;
  readonly calendarConnection: CalendarConnection;
}

export interface SeedTestFixturesOptions {
  /** Distinguishes fixtures when seeding more than one organization in one database. */
  readonly suffix?: string;
  readonly contactTimezone?: string;
  readonly contactIsDecisionMaker?: boolean;
  readonly minLeadTimeMinutes?: number;
  readonly maxSchedulingHorizonDays?: number;
  readonly businessHoursStartLocal?: string;
  readonly businessHoursEndLocal?: string;
}

/**
 * Seed one coherent world: Organization -> User -> AiAgent ->
 * AgentConfiguration -> Contact -> DETERMINISTIC_TEST CalendarConnection.
 */
export async function seedTestFixtures(
  db: Database,
  options: SeedTestFixturesOptions = {},
): Promise<TestFixtures> {
  const suffix = options.suffix ? `-${options.suffix}` : '';

  const organization = await db.organizations.create({
    name: `${FIXTURE.organizationName}${suffix}`,
    defaultTimezone: FIXTURE.organizationTimezone,
  });

  const user = await db.users.create({
    organizationId: organization.id,
    email: withSuffix(FIXTURE.userEmail, suffix),
    fullName: FIXTURE.userFullName,
    role: 'OWNER',
  });

  const aiAgent = await db.aiAgents.create({
    organizationId: organization.id,
    name: `${FIXTURE.agentName}${suffix}`,
    description: 'Books qualified meetings and plans follow-ups.',
  });

  const agentConfiguration = await db.agentConfigurations.create({
    aiAgentId: aiAgent.id,
    version: FIXTURE.agentConfigVersion,
    systemPromptRef: FIXTURE.systemPromptRef,
    businessHoursJson: stringifyJson(
      weekdayBusinessHours(
        options.businessHoursStartLocal ?? FIXTURE.businessHoursStartLocal,
        options.businessHoursEndLocal ?? FIXTURE.businessHoursEndLocal,
      ),
    ),
    defaultTimezone: FIXTURE.organizationTimezone,
    minLeadTimeMinutes: options.minLeadTimeMinutes ?? FIXTURE.minLeadTimeMinutes,
    maxSchedulingHorizonDays: options.maxSchedulingHorizonDays ?? FIXTURE.maxSchedulingHorizonDays,
    allowedToolsJson: stringifyJson(FIXTURE.allowedTools),
  });

  const contact = await db.contacts.create({
    organizationId: organization.id,
    fullName: FIXTURE.contactFullName,
    primaryPhoneE164: FIXTURE.contactPhoneE164,
    email: withSuffix(FIXTURE.contactEmail, suffix),
    timezone: options.contactTimezone ?? FIXTURE.contactTimezone,
    isDecisionMaker: options.contactIsDecisionMaker ?? FIXTURE.contactIsDecisionMaker,
  });

  const calendarConnection = await db.calendarConnections.create({
    organizationId: organization.id,
    provider: 'DETERMINISTIC_TEST',
    status: 'TEST_DOUBLE',
    calendarRef: `${FIXTURE.calendarRef}${suffix}`,
    // No OAuth token: token storage is deferred pending Founder approval of a
    // secrets mechanism.
    externalAccountRef: null,
  });

  return { organization, user, aiAgent, agentConfiguration, contact, calendarConnection };
}

/**
 * A valid `ValidationProvenance` for tests that need to persist a Meeting or a
 * FutureAction but are not themselves exercising the validator.
 *
 * Deliberately NOT a blank object: the repositories reject a receipt with no
 * checks, and a test fixture that could slip past that gate would undermine the
 * invariant it is meant to protect.
 */
export function testProvenance(overrides: Partial<ValidationProvenance> = {}): ValidationProvenance {
  return {
    validatorVersion: 'test-fixture@1',
    nowUtc: DEFAULT_TEST_NOW_UTC,
    rawProposedValue: 'next Wednesday at 2pm',
    resolvedTimezone: FIXTURE.contactTimezone,
    resolvedStartUtc: '2026-03-11T18:00:00.000Z',
    resolvedEndUtc: '2026-03-11T18:30:00.000Z',
    checks: [
      { name: 'parse_iso', passed: true, detail: 'parsed as 2026-03-11T14:00 America/New_York' },
      { name: 'not_in_the_past', passed: true },
      { name: 'min_lead_time', passed: true, detail: 'lead time 10020 min >= 30 min' },
      { name: 'within_horizon', passed: true, detail: '7 days <= 180 days' },
      { name: 'business_hours', passed: true, detail: 'Wed 14:00 within 09:00-17:00' },
      { name: 'no_busy_conflict', passed: true, detail: '0 overlapping busy intervals' },
    ],
    ...overrides,
  };
}

/** The same receipt, serialized for a `validationProvenanceJson` column. */
export function testProvenanceJson(overrides: Partial<ValidationProvenance> = {}): string {
  return stringifyJson(testProvenance(overrides));
}

function withSuffix(email: string, suffix: string): string {
  if (!suffix) return email;
  const [local, domain] = email.split('@');
  return `${local}${suffix}@${domain}`;
}
