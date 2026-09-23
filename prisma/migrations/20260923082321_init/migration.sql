-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "defaultTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'AGENT_OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiAgent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiAgent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentConfiguration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aiAgentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "systemPromptRef" TEXT NOT NULL,
    "businessHoursJson" TEXT NOT NULL,
    "defaultTimezone" TEXT NOT NULL,
    "minLeadTimeMinutes" INTEGER NOT NULL DEFAULT 30,
    "maxSchedulingHorizonDays" INTEGER NOT NULL DEFAULT 180,
    "allowedToolsJson" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentConfiguration_aiAgentId_fkey" FOREIGN KEY ("aiAgentId") REFERENCES "AiAgent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "primaryPhoneE164" TEXT NOT NULL,
    "email" TEXT,
    "timezone" TEXT NOT NULL,
    "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "ownerUserId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Lead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Lead_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QualificationState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "rawScore" INTEGER NOT NULL,
    "cappedScore" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
    "rubricVersion" TEXT NOT NULL,
    "factorsJson" TEXT NOT NULL,
    "updatedByToolCallId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QualificationState_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "aiAgentId" TEXT NOT NULL,
    "agentConfigurationId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'VOICE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_aiAgentId_fkey" FOREIGN KEY ("aiAgentId") REFERENCES "AiAgent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_agentConfigurationId_fkey" FOREIGN KEY ("agentConfigurationId") REFERENCES "AgentConfiguration" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT,
    "toolName" TEXT,
    "toolCallId" TEXT,
    "rawPayloadJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "direction" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerCallId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "durationSeconds" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Call_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Call_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Call_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CallOutcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "callId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "notes" TEXT,
    "recordedByToolCallId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CallOutcome_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalAccountRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'TEST_DOUBLE',
    "calendarRef" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CalendarConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "calendarConnectionId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startUtc" DATETIME NOT NULL,
    "endUtc" DATETIME NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "externalCalendarEventId" TEXT,
    "idempotencyKey" TEXT,
    "validationProvenanceJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Meeting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Meeting_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Meeting_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Meeting_calendarConnectionId_fkey" FOREIGN KEY ("calendarConnectionId") REFERENCES "CalendarConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FutureAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "type" TEXT NOT NULL,
    "scheduledForUtc" DATETIME NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "leaseExpiresAt" DATETIME,
    "leaseOwner" TEXT,
    "lastError" TEXT,
    "payloadJson" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "validationProvenanceJson" TEXT NOT NULL,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FutureAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FutureAction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FutureAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT,
    "conversationId" TEXT,
    "futureActionId" TEXT,
    "assignedToUserId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dueAtUtc" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_futureActionId_fkey" FOREIGN KEY ("futureActionId") REFERENCES "FutureAction" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "conversationId" TEXT,
    "contactId" TEXT,
    "toolCallId" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "summary" TEXT NOT NULL,
    "detailJson" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AuditEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Organization_name_idx" ON "Organization"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "AiAgent_organizationId_idx" ON "AiAgent"("organizationId");

-- CreateIndex
CREATE INDEX "AgentConfiguration_aiAgentId_isActive_idx" ON "AgentConfiguration"("aiAgentId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AgentConfiguration_aiAgentId_version_key" ON "AgentConfiguration"("aiAgentId", "version");

-- CreateIndex
CREATE INDEX "Contact_organizationId_primaryPhoneE164_idx" ON "Contact"("organizationId", "primaryPhoneE164");

-- CreateIndex
CREATE INDEX "Contact_organizationId_idx" ON "Contact"("organizationId");

-- CreateIndex
CREATE INDEX "Lead_organizationId_status_idx" ON "Lead"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Lead_contactId_idx" ON "Lead"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "QualificationState_contactId_key" ON "QualificationState"("contactId");

-- CreateIndex
CREATE INDEX "QualificationState_band_idx" ON "QualificationState"("band");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_status_idx" ON "Conversation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Conversation_contactId_startedAt_idx" ON "Conversation"("contactId", "startedAt");

-- CreateIndex
CREATE INDEX "ConversationTurn_conversationId_createdAt_idx" ON "ConversationTurn"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationTurn_toolCallId_idx" ON "ConversationTurn"("toolCallId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTurn_conversationId_index_key" ON "ConversationTurn"("conversationId", "index");

-- CreateIndex
CREATE INDEX "Call_organizationId_status_idx" ON "Call"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Call_contactId_createdAt_idx" ON "Call"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "Call_providerName_providerCallId_idx" ON "Call"("providerName", "providerCallId");

-- CreateIndex
CREATE UNIQUE INDEX "CallOutcome_callId_key" ON "CallOutcome"("callId");

-- CreateIndex
CREATE INDEX "CallOutcome_outcome_idx" ON "CallOutcome"("outcome");

-- CreateIndex
CREATE INDEX "CalendarConnection_organizationId_status_idx" ON "CalendarConnection"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_idempotencyKey_key" ON "Meeting"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Meeting_organizationId_startUtc_idx" ON "Meeting"("organizationId", "startUtc");

-- CreateIndex
CREATE INDEX "Meeting_contactId_startUtc_idx" ON "Meeting"("contactId", "startUtc");

-- CreateIndex
CREATE INDEX "Meeting_status_startUtc_idx" ON "Meeting"("status", "startUtc");

-- CreateIndex
CREATE UNIQUE INDEX "FutureAction_idempotencyKey_key" ON "FutureAction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FutureAction_status_scheduledForUtc_idx" ON "FutureAction"("status", "scheduledForUtc");

-- CreateIndex
CREATE INDEX "FutureAction_organizationId_status_idx" ON "FutureAction"("organizationId", "status");

-- CreateIndex
CREATE INDEX "FutureAction_contactId_scheduledForUtc_idx" ON "FutureAction"("contactId", "scheduledForUtc");

-- CreateIndex
CREATE INDEX "Task_organizationId_status_idx" ON "Task"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Task_assignedToUserId_status_idx" ON "Task"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "AuditEvent_correlationId_sequence_idx" ON "AuditEvent"("correlationId", "sequence");

-- CreateIndex
CREATE INDEX "AuditEvent_subjectType_subjectId_idx" ON "AuditEvent"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_occurredAt_idx" ON "AuditEvent"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_conversationId_occurredAt_idx" ON "AuditEvent"("conversationId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_type_idx" ON "AuditEvent"("type");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_correlationId_sequence_key" ON "AuditEvent"("correlationId", "sequence");
