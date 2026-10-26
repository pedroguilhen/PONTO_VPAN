/*
  Warnings:

  - Added the required column `encryptedToken` to the `QrCredential` table without a default value. This is not possible if the table is not empty.
  - Added the required column `issuedById` to the `QrCredential` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_QrCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "activeEmployeeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "revokedAt" DATETIME,
    "revokedById" TEXT,
    CONSTRAINT "QrCredential_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QrCredential_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QrCredential_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_QrCredential" ("employeeId", "id", "issuedAt", "revokedAt", "revokedById", "status", "tokenHash") SELECT "employeeId", "id", "issuedAt", "revokedAt", "revokedById", "status", "tokenHash" FROM "QrCredential";
DROP TABLE "QrCredential";
ALTER TABLE "new_QrCredential" RENAME TO "QrCredential";
CREATE UNIQUE INDEX "QrCredential_tokenHash_key" ON "QrCredential"("tokenHash");
CREATE UNIQUE INDEX "QrCredential_activeEmployeeId_key" ON "QrCredential"("activeEmployeeId");
CREATE INDEX "QrCredential_employeeId_issuedAt_idx" ON "QrCredential"("employeeId", "issuedAt");
CREATE INDEX "QrCredential_status_idx" ON "QrCredential"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
