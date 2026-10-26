UPDATE "WorkSchedule"
SET "effectiveFrom" = (
    SELECT CAST(
        strftime(
            '%s',
            datetime(
                CAST(COALESCE("Employee"."admissionDate", "Employee"."createdAt") AS INTEGER) / 1000,
                'unixepoch',
                '-3 hours',
                'start of day',
                '+3 hours'
            )
        ) AS INTEGER
    ) * 1000
    FROM "Employee"
    WHERE "Employee"."id" = "WorkSchedule"."employeeId"
)
WHERE "id" = 'initial-' || "employeeId";
