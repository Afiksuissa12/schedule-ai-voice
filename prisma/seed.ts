/**
 * Deterministic development seed.
 *
 * Creates the minimum coherent world the vertical slice needs:
 *   - one Organization
 *   - one User
 *   - one AiAgent with an AgentConfiguration
 *       (business hours Mon-Fri 09:00-17:00 local,
 *        minLeadTimeMinutes 30, maxSchedulingHorizonDays 180)
 *   - one Contact in a NON-UTC timezone (America/New_York, deliberately - a
 *     UTC-only fixture would let a timezone bug pass unnoticed)
 *   - one DETERMINISTIC_TEST CalendarConnection
 *
 * Idempotent: safe to run repeatedly against the same database.
 *
 * Run with `npm run db:seed`.
 */
import { weekdayBusinessHours } from '../src/domain/businessHours.js';
import { createDatabase } from '../src/db/database.js';
import { stringifyJson } from '../src/shared/json.js';

export const SEED = {
  organizationName: 'Acme Sales Co',
  organizationTimezone: 'America/New_York',
  userEmail: 'owner@acme.example',
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
  contactEmail: 'jordan@prospect.example',
  /** NON-UTC on purpose. */
  contactTimezone: 'America/New_York',
  calendarRef: 'primary-test-calendar',
} as const;

export async function seed(databaseUrl?: string): Promise<void> {
  const db = createDatabase(databaseUrl ? { datasourceUrl: databaseUrl } : {});

  try {
    const organization =
      (await db.organizations.findByName(SEED.organizationName)) ??
      (await db.organizations.create({
        name: SEED.organizationName,
        defaultTimezone: SEED.organizationTimezone,
      }));

    const user =
      (await db.users.findByEmail(SEED.userEmail)) ??
      (await db.users.create({
        organizationId: organization.id,
        email: SEED.userEmail,
        fullName: SEED.userFullName,
        role: 'OWNER',
      }));

    const existingAgents = await db.aiAgents.listByOrganization(organization.id);
    const aiAgent =
      existingAgents.find((candidate) => candidate.name === SEED.agentName) ??
      (await db.aiAgents.create({
        organizationId: organization.id,
        name: SEED.agentName,
        description: 'Books qualified meetings and plans follow-ups.',
      }));

    const agentConfiguration =
      (await db.agentConfigurations.findByAgentIdAndVersion(aiAgent.id, SEED.agentConfigVersion)) ??
      (await db.agentConfigurations.create({
        aiAgentId: aiAgent.id,
        version: SEED.agentConfigVersion,
        systemPromptRef: SEED.systemPromptRef,
        businessHoursJson: stringifyJson(
          weekdayBusinessHours(SEED.businessHoursStartLocal, SEED.businessHoursEndLocal),
        ),
        defaultTimezone: SEED.organizationTimezone,
        minLeadTimeMinutes: SEED.minLeadTimeMinutes,
        maxSchedulingHorizonDays: SEED.maxSchedulingHorizonDays,
        allowedToolsJson: stringifyJson(SEED.allowedTools),
      }));

    const contact =
      (await db.contacts.findByPhone(organization.id, SEED.contactPhoneE164)) ??
      (await db.contacts.create({
        organizationId: organization.id,
        fullName: SEED.contactFullName,
        primaryPhoneE164: SEED.contactPhoneE164,
        email: SEED.contactEmail,
        timezone: SEED.contactTimezone,
        isDecisionMaker: true,
      }));

    const existingConnections = await db.calendarConnections.listByOrganization(organization.id, {
      provider: 'DETERMINISTIC_TEST',
    });
    const calendarConnection =
      existingConnections[0] ??
      (await db.calendarConnections.create({
        organizationId: organization.id,
        provider: 'DETERMINISTIC_TEST',
        status: 'TEST_DOUBLE',
        calendarRef: SEED.calendarRef,
        // No OAuth token: token storage is deferred pending Founder approval
        // of a secrets mechanism.
        externalAccountRef: null,
      }));

    console.log('Seed complete:');
    console.log(`  Organization       ${organization.id}  ${organization.name}`);
    console.log(`  User               ${user.id}  ${user.email}`);
    console.log(`  AiAgent            ${aiAgent.id}  ${aiAgent.name}`);
    console.log(`  AgentConfiguration ${agentConfiguration.id}  v${agentConfiguration.version}`);
    console.log(`  Contact            ${contact.id}  ${contact.fullName} (${contact.timezone})`);
    console.log(`  CalendarConnection ${calendarConnection.id}  ${calendarConnection.provider}`);
  } finally {
    await db.disconnect();
  }
}

// Only run when executed directly, so tests can import `SEED` without side effects.
const invokedDirectly = process.argv[1] !== undefined && /seed\.(ts|js|mts|mjs)$/.test(process.argv[1]);
if (invokedDirectly) {
  seed().catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  });
}
