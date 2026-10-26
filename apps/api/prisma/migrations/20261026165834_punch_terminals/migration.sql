-- CreateTable
CREATE TABLE "PunchTerminal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "lastSeenAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "PunchTerminal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PunchEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "terminalId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PunchEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PunchEvent_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "PunchTerminal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PunchEvent" ("createdAt", "employeeId", "eventType", "id", "idempotencyKey", "recordedAt", "source", "terminalId") SELECT "createdAt", "employeeId", "eventType", "id", "idempotencyKey", "recordedAt", "source", "terminalId" FROM "PunchEvent";
DROP TABLE "PunchEvent";
ALTER TABLE "new_PunchEvent" RENAME TO "PunchEvent";
CREATE UNIQUE INDEX "PunchEvent_idempotencyKey_key" ON "PunchEvent"("idempotencyKey");
CREATE INDEX "PunchEvent_employeeId_recordedAt_idx" ON "PunchEvent"("employeeId", "recordedAt");
CREATE INDEX "PunchEvent_employeeId_terminalId_recordedAt_idx" ON "PunchEvent"("employeeId", "terminalId", "recordedAt");
CREATE INDEX "PunchEvent_recordedAt_idx" ON "PunchEvent"("recordedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PunchTerminal_tokenHash_key" ON "PunchTerminal"("tokenHash");

-- CreateIndex
CREATE INDEX "PunchTerminal_active_createdAt_idx" ON "PunchTerminal"("active", "createdAt");
