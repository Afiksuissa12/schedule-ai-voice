/**
 * Seed one coherent world for the vertical slice: an organization, an agent,
 * the configuration that governs it, a contact, and a calendar to book into.
 *
 * WHY THIS IS IN `src/app` AND NOT IN `tests/helpers`
 * ---------------------------------------------------------------------------
 * The runnable demo (`npm run slice:demo`) needs exactly this world, and so do
 * the end-to-end tests. Putting it in the test helpers would make the demo
 * depend on test code; duplicating it would let the two drift, and the first
 * thing to drift would be `allowedToolsJson` - which is policy, not fixture
 * data. One definition, used by both.
 *
 * THE CONFIGURATION IS THE POINT
 * ---------------------------------------------------------------------------
 * `AgentConfiguration` is where this system's authority actually lives:
 * `allowedToolsJson` decides what the model may do, `systemPromptRef` decides
 * what it is told, and `businessHoursJson` / `minLeadTimeMinutes` /
 * `maxSchedulingHorizonDays` decide which times are bookable. The conversation
 * pins a row, so all four are replayable.
 */
import type { Database } from '../db/database.js';
import { weekdayBusinessHours } from '../domain/businessHours.js';
import type {
  AgentConfiguration,
  AiAgent,
  CalendarConnection,
  Contact,
  Organization,
  User,
} from '../domain/entities.js';
import { stringifyJson } from '../shared/json.js';
import { TOOL_NAMES } from '../agent/tools/definitions.js';
import { DEFAULT_SYSTEM_PROMPT_REF } from '../agent/prompt/systemPrompt.js';

export interface SeedSliceWorldOptions {
  /** Distinguishes worlds when more than one is seeded into one database. */
  readonly suffix?: string;
  readonly organizationTimezone?: string;
  readonly contactTimezone?: string;
  readonly contactFullName?: string;
  readonly contactPhoneE164?: string;
  readonly contactIsDecisionMaker?: boolean;
  readonly businessHoursStartLocal?: string;
  readonly businessHoursEndLocal?: string;
  readonly minLeadTimeMinutes?: number;
  readonly maxSchedulingHorizonDays?: number;
  /** Defaults to ALL nine tools. Narrow it to test the policy gate. */
  readonly allowedTools?: readonly string[];
  readonly systemPromptRef?: string;
}

export interface SliceWorld {
  readonly organization: Organization;
  readonly user: User;
  readonly aiAgent: AiAgent;
  readonly agentConfiguration: AgentConfiguration;
  readonly contact: Contact;
  readonly calendarConnection: CalendarConnection;
}

/** The demo's fixed values, exported so assertions can name them. */
export const SLICE_WORLD = {
  organizationName: 'Northwind Systems',
  organizationTimezone: 'America/New_York',
  userEmail: 'dana@northwind.test',
  userFullName: 'Dana Okafor',
  agentName: 'Outbound Scheduling Agent',
  contactFullName: 'Jordan Prospect',
  contactPhoneE164: '+12125550147',
  contactEmail: 'jordan@prospect.test',
  /** NON-UTC on purpose: a UTC-only fixture hides a whole class of bug. */
  contactTimezone: 'America/New_York',
  calendarRef: 'northwind-primary',
  businessHoursStartLocal: '09:00',
  businessHoursEndLocal: '17:00',
  minLeadTimeMinutes: 30,
  maxSchedulingHorizonDays: 180,
} as const;

export async function seedSliceWorld(db: Database, options: SeedSliceWorldOptions = {}): Promise<SliceWorld> {
  const suffix = options.suffix ? `-${options.suffix}` : '';

  const organization = await db.organizations.create({
    name: `${SLICE_WORLD.organizationName}${suffix}`,
    defaultTimezone: options.organizationTimezone ?? SLICE_WORLD.organizationTimezone,
  });

  const user = await db.users.create({
    organizationId: organization.id,
    email: withSuffix(SLICE_WORLD.userEmail, suffix),
    fullName: SLICE_WORLD.userFullName,
    role: 'OWNER',
  });

  const aiAgent = await db.aiAgents.create({
    organizationId: organization.id,
    name: `${SLICE_WORLD.agentName}${suffix}`,
    description: 'Qualifies inbound interest, books meetings, and promises callbacks it can keep.',
  });

  const agentConfiguration = await db.agentConfigurations.create({
    aiAgentId: aiAgent.id,
    version: 1,
    systemPromptRef: options.systemPromptRef ?? DEFAULT_SYSTEM_PROMPT_REF,
    businessHoursJson: stringifyJson(
      weekdayBusinessHours(
        options.businessHoursStartLocal ?? SLICE_WORLD.businessHoursStartLocal,
        options.businessHoursEndLocal ?? SLICE_WORLD.businessHoursEndLocal,
      ),
    ),
    defaultTimezone: options.organizationTimezone ?? SLICE_WORLD.organizationTimezone,
    minLeadTimeMinutes: options.minLeadTimeMinutes ?? SLICE_WORLD.minLeadTimeMinutes,
    maxSchedulingHorizonDays: options.maxSchedulingHorizonDays ?? SLICE_WORLD.maxSchedulingHorizonDays,
    // The full nine by default. Narrowing this is how a deployment says "this
    // agent may book but may not cancel", and the dispatcher enforces it.
    allowedToolsJson: stringifyJson(options.allowedTools ?? [...TOOL_NAMES]),
  });

  const contact = await db.contacts.create({
    organizationId: organization.id,
    fullName: options.contactFullName ?? SLICE_WORLD.contactFullName,
    primaryPhoneE164: options.contactPhoneE164 ?? SLICE_WORLD.contactPhoneE164,
    email: withSuffix(SLICE_WORLD.contactEmail, suffix),
    timezone: options.contactTimezone ?? SLICE_WORLD.contactTimezone,
    isDecisionMaker: options.contactIsDecisionMaker ?? true,
  });

  const calendarConnection = await db.calendarConnections.create({
    organizationId: organization.id,
    provider: 'DETERMINISTIC_TEST',
    status: 'TEST_DOUBLE',
    calendarRef: `${SLICE_WORLD.calendarRef}${suffix}`,
    // No OAuth token: token storage is deferred pending an approved secrets
    // mechanism. `externalAccountRef` is an opaque, non-secret pointer.
    externalAccountRef: null,
  });

  return { organization, user, aiAgent, agentConfiguration, contact, calendarConnection };
}

function withSuffix(email: string, suffix: string): string {
  if (!suffix) return email;
  const [local, domain] = email.split('@');
  return `${local}${suffix}@${domain}`;
}
