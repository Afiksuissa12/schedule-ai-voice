/**
 * Repositories for the tenancy models: Organization, User, AiAgent,
 * AgentConfiguration.
 */
import type { AgentConfiguration, AiAgent, Organization, User } from '../../domain/entities.js';
import type { AiAgentStatus, UserRole } from '../../domain/enums.js';
import { IanaTimezoneSchema } from '../../domain/enums.js';
import { InvariantViolationError, NotFoundError } from '../../shared/errors.js';
import { toAgentConfiguration, toAiAgent, toOrganization, toUser } from '../mappers.js';
import { translatePrismaError } from '../prismaErrors.js';
import type { DbExecutor, PageOptions } from '../types.js';

function requireIanaTimezone(value: string, field: string): string {
  const result = IanaTimezoneSchema.safeParse(value);
  if (!result.success) {
    throw new InvariantViolationError(`${field} must be a valid IANA timezone name, got: ${value}`, {
      details: { field, value },
    });
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export interface CreateOrganizationInput {
  readonly name: string;
  readonly defaultTimezone?: string;
}

export interface OrganizationRepository {
  create(input: CreateOrganizationInput): Promise<Organization>;
  findById(id: string): Promise<Organization | null>;
  requireById(id: string): Promise<Organization>;
  findByName(name: string): Promise<Organization | null>;
  list(page?: PageOptions): Promise<Organization[]>;
}

export function createOrganizationRepository(db: DbExecutor): OrganizationRepository {
  return {
    async create(input) {
      try {
        const row = await db.organization.create({
          data: {
            name: input.name,
            defaultTimezone: requireIanaTimezone(input.defaultTimezone ?? 'UTC', 'Organization.defaultTimezone'),
          },
        });
        return toOrganization(row);
      } catch (error) {
        if (error instanceof InvariantViolationError) throw error;
        translatePrismaError(error, { entity: 'Organization', operation: 'create' });
      }
    },

    async findById(id) {
      const row = await db.organization.findUnique({ where: { id } });
      return row ? toOrganization(row) : null;
    },

    async requireById(id) {
      const found = await this.findById(id);
      if (!found) throw new NotFoundError('Organization', id);
      return found;
    },

    async findByName(name) {
      const row = await db.organization.findFirst({ where: { name } });
      return row ? toOrganization(row) : null;
    },

    async list(page) {
      const rows = await db.organization.findMany({
        orderBy: { createdAt: 'asc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toOrganization);
    },
  };
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export interface CreateUserInput {
  readonly organizationId: string;
  readonly email: string;
  readonly fullName: string;
  readonly role?: UserRole;
  readonly isActive?: boolean;
}

export interface UpdateUserInput {
  readonly fullName?: string;
  readonly role?: UserRole;
  readonly isActive?: boolean;
}

export interface UserRepository {
  create(input: CreateUserInput): Promise<User>;
  findById(id: string): Promise<User | null>;
  requireById(id: string): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  listByOrganization(organizationId: string, page?: PageOptions): Promise<User[]>;
  update(id: string, patch: UpdateUserInput): Promise<User>;
}

export function createUserRepository(db: DbExecutor): UserRepository {
  return {
    async create(input) {
      try {
        const row = await db.user.create({
          data: {
            organizationId: input.organizationId,
            email: input.email,
            fullName: input.fullName,
            role: input.role ?? 'AGENT_OPERATOR',
            isActive: input.isActive ?? true,
          },
        });
        return toUser(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'User', operation: 'create' });
      }
    },

    async findById(id) {
      const row = await db.user.findUnique({ where: { id } });
      return row ? toUser(row) : null;
    },

    async requireById(id) {
      const found = await this.findById(id);
      if (!found) throw new NotFoundError('User', id);
      return found;
    },

    async findByEmail(email) {
      const row = await db.user.findUnique({ where: { email } });
      return row ? toUser(row) : null;
    },

    async listByOrganization(organizationId, page) {
      const rows = await db.user.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toUser);
    },

    async update(id, patch) {
      try {
        const row = await db.user.update({
          where: { id },
          data: { fullName: patch.fullName, role: patch.role, isActive: patch.isActive },
        });
        return toUser(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'User', operation: 'update' });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// AiAgent
// ---------------------------------------------------------------------------

export interface CreateAiAgentInput {
  readonly organizationId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly status?: AiAgentStatus;
}

export interface AiAgentRepository {
  create(input: CreateAiAgentInput): Promise<AiAgent>;
  findById(id: string): Promise<AiAgent | null>;
  requireById(id: string): Promise<AiAgent>;
  listByOrganization(organizationId: string, page?: PageOptions): Promise<AiAgent[]>;
  updateStatus(id: string, status: AiAgentStatus): Promise<AiAgent>;
}

export function createAiAgentRepository(db: DbExecutor): AiAgentRepository {
  return {
    async create(input) {
      try {
        const row = await db.aiAgent.create({
          data: {
            organizationId: input.organizationId,
            name: input.name,
            description: input.description ?? null,
            status: input.status ?? 'ACTIVE',
          },
        });
        return toAiAgent(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'AiAgent', operation: 'create' });
      }
    },

    async findById(id) {
      const row = await db.aiAgent.findUnique({ where: { id } });
      return row ? toAiAgent(row) : null;
    },

    async requireById(id) {
      const found = await this.findById(id);
      if (!found) throw new NotFoundError('AiAgent', id);
      return found;
    },

    async listByOrganization(organizationId, page) {
      const rows = await db.aiAgent.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toAiAgent);
    },

    async updateStatus(id, status) {
      try {
        const row = await db.aiAgent.update({ where: { id }, data: { status } });
        return toAiAgent(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'AiAgent', operation: 'updateStatus' });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// AgentConfiguration
// ---------------------------------------------------------------------------

export interface CreateAgentConfigurationInput {
  readonly aiAgentId: string;
  readonly version: number;
  readonly systemPromptRef: string;
  /** Serialized `BusinessHoursPolicy`. */
  readonly businessHoursJson: string;
  readonly defaultTimezone: string;
  readonly minLeadTimeMinutes: number;
  readonly maxSchedulingHorizonDays: number;
  /** Serialized `string[]` of permitted tool names. */
  readonly allowedToolsJson: string;
  readonly isActive?: boolean;
}

export interface AgentConfigurationRepository {
  create(input: CreateAgentConfigurationInput): Promise<AgentConfiguration>;
  findById(id: string): Promise<AgentConfiguration | null>;
  requireById(id: string): Promise<AgentConfiguration>;
  /** The newest active configuration for an agent - the policy currently in force. */
  findActiveByAgentId(aiAgentId: string): Promise<AgentConfiguration | null>;
  requireActiveByAgentId(aiAgentId: string): Promise<AgentConfiguration>;
  findByAgentIdAndVersion(aiAgentId: string, version: number): Promise<AgentConfiguration | null>;
  listByAgentId(aiAgentId: string, page?: PageOptions): Promise<AgentConfiguration[]>;
  setActive(id: string, isActive: boolean): Promise<AgentConfiguration>;
}

export function createAgentConfigurationRepository(db: DbExecutor): AgentConfigurationRepository {
  return {
    async create(input) {
      if (input.minLeadTimeMinutes < 0) {
        throw new InvariantViolationError('AgentConfiguration.minLeadTimeMinutes must not be negative', {
          details: { minLeadTimeMinutes: input.minLeadTimeMinutes },
        });
      }
      if (input.maxSchedulingHorizonDays <= 0) {
        throw new InvariantViolationError('AgentConfiguration.maxSchedulingHorizonDays must be positive', {
          details: { maxSchedulingHorizonDays: input.maxSchedulingHorizonDays },
        });
      }
      try {
        const row = await db.agentConfiguration.create({
          data: {
            aiAgentId: input.aiAgentId,
            version: input.version,
            systemPromptRef: input.systemPromptRef,
            businessHoursJson: input.businessHoursJson,
            defaultTimezone: requireIanaTimezone(input.defaultTimezone, 'AgentConfiguration.defaultTimezone'),
            minLeadTimeMinutes: input.minLeadTimeMinutes,
            maxSchedulingHorizonDays: input.maxSchedulingHorizonDays,
            allowedToolsJson: input.allowedToolsJson,
            isActive: input.isActive ?? true,
          },
        });
        return toAgentConfiguration(row);
      } catch (error) {
        if (error instanceof InvariantViolationError) throw error;
        translatePrismaError(error, { entity: 'AgentConfiguration', operation: 'create' });
      }
    },

    async findById(id) {
      const row = await db.agentConfiguration.findUnique({ where: { id } });
      return row ? toAgentConfiguration(row) : null;
    },

    async requireById(id) {
      const found = await this.findById(id);
      if (!found) throw new NotFoundError('AgentConfiguration', id);
      return found;
    },

    async findActiveByAgentId(aiAgentId) {
      const row = await db.agentConfiguration.findFirst({
        where: { aiAgentId, isActive: true },
        orderBy: { version: 'desc' },
      });
      return row ? toAgentConfiguration(row) : null;
    },

    async requireActiveByAgentId(aiAgentId) {
      const found = await this.findActiveByAgentId(aiAgentId);
      if (!found) throw new NotFoundError('AgentConfiguration (active)', aiAgentId);
      return found;
    },

    async findByAgentIdAndVersion(aiAgentId, version) {
      const row = await db.agentConfiguration.findUnique({
        where: { aiAgentId_version: { aiAgentId, version } },
      });
      return row ? toAgentConfiguration(row) : null;
    },

    async listByAgentId(aiAgentId, page) {
      const rows = await db.agentConfiguration.findMany({
        where: { aiAgentId },
        orderBy: { version: 'desc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toAgentConfiguration);
    },

    async setActive(id, isActive) {
      try {
        const row = await db.agentConfiguration.update({ where: { id }, data: { isActive } });
        return toAgentConfiguration(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'AgentConfiguration', operation: 'setActive' });
      }
    },
  };
}
