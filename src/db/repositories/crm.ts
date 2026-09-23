/**
 * Repositories for the CRM models: Contact, Lead, QualificationState.
 *
 * The CRM abstraction the legacy prototype did not have at all. Contacts are
 * validated on the write path - an E.164 phone number and a real IANA timezone
 * are preconditions for everything downstream, so they are checked here rather
 * than hoped for.
 */
import type { Contact, Lead, QualificationState } from '../../domain/entities.js';
import type { LeadStatus, QualificationBand } from '../../domain/enums.js';
import { E164Schema, IanaTimezoneSchema } from '../../domain/enums.js';
import { InvariantViolationError, NotFoundError } from '../../shared/errors.js';
import { toContact, toLead, toQualificationState } from '../mappers.js';
import { translatePrismaError } from '../prismaErrors.js';
import type { DbExecutor, PageOptions } from '../types.js';

function requireE164(value: string): string {
  const result = E164Schema.safeParse(value);
  if (!result.success) {
    throw new InvariantViolationError(
      `Contact.primaryPhoneE164 must be an E.164 number (e.g. +12125550123), got: ${value}`,
      { details: { value } },
    );
  }
  return result.data;
}

function requireTimezone(value: string, field: string): string {
  const result = IanaTimezoneSchema.safeParse(value);
  if (!result.success) {
    throw new InvariantViolationError(`${field} must be a valid IANA timezone name, got: ${value}`, {
      details: { field, value },
    });
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export interface CreateContactInput {
  readonly organizationId: string;
  readonly fullName: string;
  /** E.164, validated. */
  readonly primaryPhoneE164: string;
  readonly email?: string | null;
  /** IANA zone, validated. Required: proposed times are interpreted here. */
  readonly timezone: string;
  readonly isDecisionMaker?: boolean;
  readonly notes?: string | null;
}

export interface UpdateContactInput {
  readonly fullName?: string;
  readonly primaryPhoneE164?: string;
  readonly email?: string | null;
  readonly timezone?: string;
  readonly isDecisionMaker?: boolean;
  readonly notes?: string | null;
}

export interface ContactRepository {
  create(input: CreateContactInput): Promise<Contact>;
  findById(id: string): Promise<Contact | null>;
  requireById(id: string): Promise<Contact>;
  /** Scoped to an organization, because a phone number is only unique within a tenant. */
  findByPhone(organizationId: string, primaryPhoneE164: string): Promise<Contact | null>;
  listByOrganization(organizationId: string, page?: PageOptions): Promise<Contact[]>;
  update(id: string, patch: UpdateContactInput): Promise<Contact>;
}

export function createContactRepository(db: DbExecutor): ContactRepository {
  return {
    async create(input) {
      const data = {
        organizationId: input.organizationId,
        fullName: input.fullName,
        primaryPhoneE164: requireE164(input.primaryPhoneE164),
        email: input.email ?? null,
        timezone: requireTimezone(input.timezone, 'Contact.timezone'),
        isDecisionMaker: input.isDecisionMaker ?? false,
        notes: input.notes ?? null,
      };
      try {
        return toContact(await db.contact.create({ data }));
      } catch (error) {
        translatePrismaError(error, { entity: 'Contact', operation: 'create' });
      }
    },

    async findById(id) {
      const row = await db.contact.findUnique({ where: { id } });
      return row ? toContact(row) : null;
    },

    async requireById(id) {
      const found = await this.findById(id);
      if (!found) throw new NotFoundError('Contact', id);
      return found;
    },

    async findByPhone(organizationId, primaryPhoneE164) {
      const row = await db.contact.findFirst({
        where: { organizationId, primaryPhoneE164 },
        orderBy: { createdAt: 'asc' },
      });
      return row ? toContact(row) : null;
    },

    async listByOrganization(organizationId, page) {
      const rows = await db.contact.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toContact);
    },

    async update(id, patch) {
      try {
        const row = await db.contact.update({
          where: { id },
          data: {
            fullName: patch.fullName,
            primaryPhoneE164: patch.primaryPhoneE164 === undefined ? undefined : requireE164(patch.primaryPhoneE164),
            email: patch.email,
            timezone: patch.timezone === undefined ? undefined : requireTimezone(patch.timezone, 'Contact.timezone'),
            isDecisionMaker: patch.isDecisionMaker,
            notes: patch.notes,
          },
        });
        return toContact(row);
      } catch (error) {
        if (error instanceof InvariantViolationError) throw error;
        translatePrismaError(error, { entity: 'Contact', operation: 'update' });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------

export interface CreateLeadInput {
  readonly organizationId: string;
  readonly contactId: string;
  readonly source: string;
  readonly status?: LeadStatus;
  readonly ownerUserId?: string | null;
  readonly notes?: string | null;
}

export interface UpdateLeadInput {
  readonly status?: LeadStatus;
  readonly ownerUserId?: string | null;
  readonly notes?: string | null;
}

export interface LeadRepository {
  create(input: CreateLeadInput): Promise<Lead>;
  findById(id: string): Promise<Lead | null>;
  requireById(id: string): Promise<Lead>;
  listByContact(contactId: string, page?: PageOptions): Promise<Lead[]>;
  listByOrganization(organizationId: string, options?: PageOptions & { status?: LeadStatus }): Promise<Lead[]>;
  update(id: string, patch: UpdateLeadInput): Promise<Lead>;
}

export function createLeadRepository(db: DbExecutor): LeadRepository {
  return {
    async create(input) {
      try {
        const row = await db.lead.create({
          data: {
            organizationId: input.organizationId,
            contactId: input.contactId,
            source: input.source,
            status: input.status ?? 'NEW',
            ownerUserId: input.ownerUserId ?? null,
            notes: input.notes ?? null,
          },
        });
        return toLead(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'Lead', operation: 'create' });
      }
    },

    async findById(id) {
      const row = await db.lead.findUnique({ where: { id } });
      return row ? toLead(row) : null;
    },

    async requireById(id) {
      const found = await this.findById(id);
      if (!found) throw new NotFoundError('Lead', id);
      return found;
    },

    async listByContact(contactId, page) {
      const rows = await db.lead.findMany({
        where: { contactId },
        orderBy: { createdAt: 'asc' },
        take: page?.take,
        skip: page?.skip,
      });
      return rows.map(toLead);
    },

    async listByOrganization(organizationId, options) {
      const rows = await db.lead.findMany({
        where: { organizationId, ...(options?.status ? { status: options.status } : {}) },
        orderBy: { createdAt: 'asc' },
        take: options?.take,
        skip: options?.skip,
      });
      return rows.map(toLead);
    },

    async update(id, patch) {
      try {
        const row = await db.lead.update({
          where: { id },
          data: { status: patch.status, ownerUserId: patch.ownerUserId, notes: patch.notes },
        });
        return toLead(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'Lead', operation: 'update' });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// QualificationState
// ---------------------------------------------------------------------------

export interface UpsertQualificationStateInput {
  readonly contactId: string;
  /** Effective score used downstream. Defaults to `cappedScore`. */
  readonly score?: number;
  /** Rubric output BEFORE the non-decision-maker cap. */
  readonly rawScore: number;
  /** Rubric output AFTER the non-decision-maker cap. */
  readonly cappedScore: number;
  readonly band: QualificationBand;
  readonly isDecisionMaker: boolean;
  readonly rubricVersion: string;
  /** Serialized array of scoring factors. */
  readonly factorsJson: string;
  readonly updatedByToolCallId?: string | null;
}

export interface QualificationStateRepository {
  /** One row per contact, so writing is always an upsert. */
  upsertForContact(input: UpsertQualificationStateInput): Promise<QualificationState>;
  findByContactId(contactId: string): Promise<QualificationState | null>;
  requireByContactId(contactId: string): Promise<QualificationState>;
}

export function createQualificationStateRepository(db: DbExecutor): QualificationStateRepository {
  return {
    async upsertForContact(input) {
      // The cap is a policy decision made upstream; the repository only refuses
      // to store a self-contradictory record of it.
      if (input.cappedScore > input.rawScore) {
        throw new InvariantViolationError(
          'QualificationState.cappedScore must not exceed rawScore - a cap can only lower a score',
          { details: { rawScore: input.rawScore, cappedScore: input.cappedScore } },
        );
      }
      if (input.factorsJson.trim().length === 0) {
        throw new InvariantViolationError('QualificationState.factorsJson must not be empty');
      }

      const effectiveScore = input.score ?? input.cappedScore;
      const payload = {
        score: effectiveScore,
        rawScore: input.rawScore,
        cappedScore: input.cappedScore,
        band: input.band,
        isDecisionMaker: input.isDecisionMaker,
        rubricVersion: input.rubricVersion,
        factorsJson: input.factorsJson,
        updatedByToolCallId: input.updatedByToolCallId ?? null,
      };

      try {
        const row = await db.qualificationState.upsert({
          where: { contactId: input.contactId },
          create: { contactId: input.contactId, ...payload },
          update: payload,
        });
        return toQualificationState(row);
      } catch (error) {
        translatePrismaError(error, { entity: 'QualificationState', operation: 'upsertForContact' });
      }
    },

    async findByContactId(contactId) {
      const row = await db.qualificationState.findUnique({ where: { contactId } });
      return row ? toQualificationState(row) : null;
    },

    async requireByContactId(contactId) {
      const found = await this.findByContactId(contactId);
      if (!found) throw new NotFoundError('QualificationState for Contact', contactId);
      return found;
    },
  };
}
