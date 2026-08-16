-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "deactivatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ConnectedAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" DATETIME,
    "scopes" TEXT NOT NULL,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ConnectedAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "cursor" TEXT,
    "lastSyncedAt" DATETIME,
    "lastFullSyncAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncState_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ConnectedAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "threadExternalId" TEXT,
    "subject" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "toEmails" TEXT NOT NULL DEFAULT '[]',
    "sentAt" DATETIME NOT NULL,
    "snippet" TEXT,
    "bodyText" TEXT NOT NULL,
    "isBulk" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" DATETIME,
    "contentHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SourceItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ConnectedAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OpenLoop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "dueAt" DATETIME,
    "dueAtBasis" TEXT NOT NULL DEFAULT 'none',
    "dueAtEvidence" TEXT,
    "counterpartyName" TEXT,
    "counterpartyEmail" TEXT,
    "amountMinor" INTEGER,
    "amountCurrency" TEXT,
    "confidence" REAL NOT NULL,
    "consequence" TEXT NOT NULL,
    "inferenceNotes" TEXT,
    "priorityScore" INTEGER NOT NULL DEFAULT 0,
    "priorityBucket" TEXT NOT NULL DEFAULT 'later',
    "dedupeKey" TEXT NOT NULL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "snoozedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OpenLoop_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OpenLoopEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loopId" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "supports" TEXT NOT NULL DEFAULT 'claim',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpenLoopEvidence_loopId_fkey" FOREIGN KEY ("loopId") REFERENCES "OpenLoop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OpenLoopEvidence_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "SourceItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "loopId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "summary" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "proposedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    "rejectedAt" DATETIME,
    "executedAt" DATETIME,
    "failedAt" DATETIME,
    "result" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Action_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Action_loopId_fkey" FOREIGN KEY ("loopId") REFERENCES "OpenLoop" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "loopId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "scheduledFor" DATETIME,
    "sentAt" DATETIME,
    "readAt" DATETIME,
    "failedAt" DATETIME,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "suppressedReason" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_loopId_fkey" FOREIGN KEY ("loopId") REFERENCES "OpenLoop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputSourceItemIds" TEXT NOT NULL DEFAULT '[]',
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "rawOutput" TEXT,
    "error" TEXT,
    "candidatesProposed" INTEGER NOT NULL DEFAULT 0,
    "candidatesAccepted" INTEGER NOT NULL DEFAULT 0,
    "candidatesRejected" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_deactivatedAt_idx" ON "User"("deactivatedAt");

-- CreateIndex
CREATE INDEX "ConnectedAccount_userId_idx" ON "ConnectedAccount"("userId");

-- CreateIndex
CREATE INDEX "ConnectedAccount_userId_revokedAt_idx" ON "ConnectedAccount"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAccount_userId_provider_providerAccountId_key" ON "ConnectedAccount"("userId", "provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncState_accountId_key" ON "SyncState"("accountId");

-- CreateIndex
CREATE INDEX "SourceItem_userId_sentAt_idx" ON "SourceItem"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "SourceItem_userId_processedAt_idx" ON "SourceItem"("userId", "processedAt");

-- CreateIndex
CREATE INDEX "SourceItem_userId_isBulk_processedAt_idx" ON "SourceItem"("userId", "isBulk", "processedAt");

-- CreateIndex
CREATE INDEX "SourceItem_threadExternalId_idx" ON "SourceItem"("threadExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceItem_accountId_externalId_key" ON "SourceItem"("accountId", "externalId");

-- CreateIndex
CREATE INDEX "OpenLoop_userId_status_priorityScore_idx" ON "OpenLoop"("userId", "status", "priorityScore");

-- CreateIndex
CREATE INDEX "OpenLoop_userId_dueAt_idx" ON "OpenLoop"("userId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpenLoop_userId_dedupeKey_key" ON "OpenLoop"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "OpenLoopEvidence_sourceItemId_idx" ON "OpenLoopEvidence"("sourceItemId");

-- CreateIndex
CREATE UNIQUE INDEX "OpenLoopEvidence_loopId_sourceItemId_quote_key" ON "OpenLoopEvidence"("loopId", "sourceItemId", "quote");

-- CreateIndex
CREATE UNIQUE INDEX "Action_idempotencyKey_key" ON "Action"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Action_userId_status_idx" ON "Action"("userId", "status");

-- CreateIndex
CREATE INDEX "Action_loopId_idx" ON "Action"("loopId");

-- CreateIndex
CREATE INDEX "Notification_userId_status_scheduledFor_idx" ON "Notification"("userId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Notification_loopId_idx" ON "Notification"("loopId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "AiRun_userId_createdAt_idx" ON "AiRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRun_userId_stage_createdAt_idx" ON "AiRun"("userId", "stage", "createdAt");
