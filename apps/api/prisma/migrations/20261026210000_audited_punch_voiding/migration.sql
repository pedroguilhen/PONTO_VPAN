ALTER TABLE "PunchEvent" ADD COLUMN "voidedAt" DATETIME;
ALTER TABLE "PunchEvent" ADD COLUMN "voidReason" TEXT;
ALTER TABLE "PunchEvent" ADD COLUMN "voidedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PunchEvent_employeeId_voidedAt_recordedAt_idx"
ON "PunchEvent"("employeeId", "voidedAt", "recordedAt");
