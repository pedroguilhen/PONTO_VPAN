UPDATE "WorkSchedule"
SET "effectiveFrom" = (
    SELECT CAST(COALESCE("Employee"."admissionDate", "Employee"."createdAt") AS INTEGER)
    FROM "Employee"
    WHERE "Employee"."id" = "WorkSchedule"."employeeId"
)
WHERE "id" = 'initial-' || "employeeId"
  AND typeof("effectiveFrom") = 'text';
