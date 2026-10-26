PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS "WorkSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "WorkSchedule_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "WorkScheduleDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT,
    "breakStartTime" TEXT,
    "breakEndTime" TEXT,
    "endTime" TEXT,
    CONSTRAINT "WorkScheduleDay_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AttendanceRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "targetEventId" TEXT,
    "resultEventId" TEXT,
    "targetEventType" TEXT,
    "targetRecordedAt" DATETIME,
    "proposedEventType" TEXT,
    "proposedRecordedAt" DATETIME,
    "targetDate" DATETIME,
    "minutes" INTEGER,
    "reason" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "reviewComment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AttendanceRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AttendanceRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AttendanceRequest_targetEventId_fkey" FOREIGN KEY ("targetEventId") REFERENCES "PunchEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AttendanceRequest_resultEventId_fkey" FOREIGN KEY ("resultEventId") REFERENCES "PunchEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AttendanceRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkSchedule_employeeId_effectiveFrom_key" ON "WorkSchedule"("employeeId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "WorkSchedule_employeeId_effectiveFrom_idx" ON "WorkSchedule"("employeeId", "effectiveFrom");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkScheduleDay_scheduleId_dayOfWeek_key" ON "WorkScheduleDay"("scheduleId", "dayOfWeek");
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceRequest_resultEventId_key" ON "AttendanceRequest"("resultEventId");
CREATE INDEX IF NOT EXISTS "AttendanceRequest_status_createdAt_idx" ON "AttendanceRequest"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "AttendanceRequest_employeeId_targetDate_idx" ON "AttendanceRequest"("employeeId", "targetDate");
CREATE INDEX IF NOT EXISTS "AttendanceRequest_requestedById_createdAt_idx" ON "AttendanceRequest"("requestedById", "createdAt");

INSERT OR IGNORE INTO "WorkSchedule" ("id", "employeeId", "effectiveFrom")
SELECT
    'initial-' || "Employee"."id",
    "Employee"."id",
    substr(COALESCE("Employee"."admissionDate", "Employee"."createdAt"), 1, 10) || 'T00:00:00.000Z'
FROM "Employee";

INSERT OR IGNORE INTO "WorkScheduleDay" (
    "id", "scheduleId", "dayOfWeek", "startTime", "breakStartTime", "breakEndTime", "endTime"
)
SELECT
    'initial-day-' || "Employee"."id" || '-' || "days"."dayOfWeek",
    'initial-' || "Employee"."id",
    "days"."dayOfWeek",
    CASE WHEN "days"."dayOfWeek" BETWEEN 1 AND 5 THEN '08:00' END,
    CASE WHEN "days"."dayOfWeek" BETWEEN 1 AND 5 THEN '12:00' END,
    CASE WHEN "days"."dayOfWeek" BETWEEN 1 AND 5 THEN '13:00' END,
    CASE WHEN "days"."dayOfWeek" BETWEEN 1 AND 5 THEN '17:00' END
FROM "Employee"
CROSS JOIN (
    SELECT 1 AS "dayOfWeek" UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL
    SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7
) AS "days";
