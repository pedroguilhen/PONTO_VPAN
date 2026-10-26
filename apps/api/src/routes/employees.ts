import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAdmin, requireAuthenticated, type AuthenticatedRequest } from "../auth.js";
import {
  enumerateDateKeys,
  evaluateAttendanceDay,
  getEffectiveSchedule,
  saoPauloDateKey,
  saoPauloDayStart,
  type AttendanceMark,
  type ScheduleRevision
} from "../attendance-calculations.js";
import { prisma } from "../db.js";
import { punchEventTypes } from "../punch-sequence.js";
import { createQrToken, decryptQrToken, encryptQrToken, hashQrToken } from "../qr-token.js";

const employeeInput = z.object({
  registration: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(160),
  cpf: z.string().trim().max(14).optional().nullable(),
  jobTitle: z.string().trim().max(120).optional().nullable(),
  departmentId: z.string().cuid().optional().nullable(),
  admissionDate: z.coerce.date().optional().nullable()
});
const scheduleDayInput = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  breakStartTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  breakEndTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
});
const scheduleInput = z
  .object({
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    days: z.array(scheduleDayInput).length(7)
  })
  .superRefine((schedule, context) => {
    if (!isValidDateKey(schedule.effectiveFrom)) {
      context.addIssue({ code: "custom", message: "Data de vigência inválida." });
    }
    const indexes = schedule.days.map((day) => day.dayOfWeek);
    if (new Set(indexes).size !== 7) {
      context.addIssue({ code: "custom", message: "Informe um horário para cada dia da semana." });
    }
    for (const day of schedule.days) {
      const values = [day.startTime, day.breakStartTime, day.breakEndTime, day.endTime];
      if (
        values.some((value) => {
          if (!value) return false;
          const [hour, minute] = value.split(":").map(Number);
          return hour! > 23 || minute! > 59;
        })
      ) {
        context.addIssue({ code: "custom", message: "Há um horário inválido na jornada." });
      }
      const hasAnyTime = values.some((value) => value !== null);
      if (!hasAnyTime) continue;
      if (!day.startTime || !day.endTime) {
        context.addIssue({ code: "custom", message: "Dias trabalhados precisam de início e fim." });
        continue;
      }
      if (Boolean(day.breakStartTime) !== Boolean(day.breakEndTime)) {
        context.addIssue({ code: "custom", message: "Informe início e fim do intervalo." });
        continue;
      }
      const minutes = values.map((value) => (value ? timeToMinutes(value) : null));
      const start = minutes[0] ?? null;
      const breakStart = minutes[1] ?? null;
      const breakEnd = minutes[2] ?? null;
      const end = minutes[3] ?? null;
      if (
        (start !== null && end !== null && start >= end) ||
        (breakStart !== null &&
          (breakEnd === null ||
            start === null ||
            end === null ||
            breakStart <= start ||
            breakEnd <= breakStart ||
            breakEnd >= end))
      ) {
        context.addIssue({
          code: "custom",
          message: "Os horários devem estar em ordem e dentro do mesmo dia."
        });
      }
    }
  });
const punchCorrectionInput = z.object({
  eventType: z.enum(punchEventTypes),
  recordedAt: z.coerce.date(),
  reason: z.string().trim().min(10).max(500)
});
const punchVoidInput = z.object({
  reason: z.string().trim().min(10).max(500)
});
type MonthlyEmployee = Awaited<ReturnType<typeof getMonthlyEmployeeData>>[number];

export async function employeeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/scope", { preHandler: requireAuthenticated }, async (request) => {
    const actor = request as AuthenticatedRequest;
    const where =
      actor.user.role === "ADMIN" ? {} : { scopes: { some: { userId: actor.user.sub } } };
    const employees = await prisma.employee.findMany({
      where,
      select: { id: true, name: true, registration: true, status: true },
      orderBy: { name: "asc" }
    });
    return { items: employees };
  });

  app.post("/:employeeId/schedules", { preHandler: requireAdmin }, async (request, reply) => {
    const params = z.object({ employeeId: z.string().cuid() }).safeParse(request.params);
    const parsed = scheduleInput.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.code(400).send({ error: "Confira a vigência e os horários informados." });
    }
    if (parsed.data.effectiveFrom < saoPauloDateKey(new Date())) {
      return reply
        .code(400)
        .send({ error: "A jornada só pode vigorar hoje ou em uma data futura." });
    }
    const actor = request as AuthenticatedRequest;
    const employee = await prisma.employee.findUnique({
      where: { id: params.data.employeeId },
      select: { id: true }
    });
    if (!employee) return reply.code(404).send({ error: "Funcionário não encontrado." });

    try {
      const schedule = await prisma.$transaction(async (transaction) => {
        const created = await transaction.workSchedule.create({
          data: {
            employeeId: employee.id,
            effectiveFrom: new Date(`${parsed.data.effectiveFrom}T00:00:00.000Z`),
            createdById: actor.user.sub,
            days: { create: parsed.data.days }
          },
          include: { days: { orderBy: { dayOfWeek: "asc" } } }
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.user.sub,
            action: "WORK_SCHEDULE_CREATED",
            entityType: "WorkSchedule",
            entityId: created.id,
            detailsJson: JSON.stringify({
              employeeId: employee.id,
              effectiveFrom: parsed.data.effectiveFrom,
              days: parsed.data.days
            })
          }
        });
        return created;
      });
      return reply.code(201).send(schedule);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.code(409).send({ error: "Já existe uma jornada para essa data de vigência." });
      }
      throw error;
    }
  });

  app.patch(
    "/:employeeId/punches/:punchId",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = z
        .object({ employeeId: z.string().cuid(), punchId: z.string().cuid() })
        .safeParse(request.params);
      const parsed = punchCorrectionInput.safeParse(request.body);
      if (!params.success || !parsed.success) {
        return reply
          .code(400)
          .send({ error: "Informe a marcação, o horário e o motivo da correção." });
      }
      const actor = request as AuthenticatedRequest;
      const result = await prisma.$transaction(async (transaction) => {
        const target = await transaction.punchEvent.findFirst({
          where: {
            id: params.data.punchId,
            employeeId: params.data.employeeId,
            voidedAt: null
          }
        });
        if (!target) return { kind: "not-found" as const };

        const updated = await transaction.punchEvent.update({
          where: { id: target.id },
          data: {
            eventType: parsed.data.eventType,
            recordedAt: parsed.data.recordedAt,
            source: "ADMIN_CORRECTION"
          }
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.user.sub,
            action: "ADMIN_PUNCH_CORRECTED",
            entityType: "PunchEvent",
            entityId: target.id,
            detailsJson: JSON.stringify({
              employeeId: target.employeeId,
              reason: parsed.data.reason,
              oldEventType: target.eventType,
              oldRecordedAt: target.recordedAt,
              newEventType: parsed.data.eventType,
              newRecordedAt: parsed.data.recordedAt
            })
          }
        });
        return { kind: "updated" as const, punch: updated };
      });

      if (result.kind === "not-found") {
        return reply.code(404).send({ error: "Marcação não encontrada." });
      }
      return { item: result.punch };
    }
  );

  app.delete(
    "/:employeeId/punches/:punchId",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = z
        .object({ employeeId: z.string().cuid(), punchId: z.string().cuid() })
        .safeParse(request.params);
      const parsed = punchVoidInput.safeParse(request.body);
      if (!params.success || !parsed.success) {
        return reply.code(400).send({ error: "Informe uma justificativa para anular o ponto." });
      }

      const actor = request as AuthenticatedRequest;
      const result = await prisma.$transaction(async (transaction) => {
        const target = await transaction.punchEvent.findFirst({
          where: {
            id: params.data.punchId,
            employeeId: params.data.employeeId,
            voidedAt: null
          }
        });
        if (!target) return { kind: "not-found" as const };

        const voidedAt = new Date();
        const updated = await transaction.punchEvent.update({
          where: { id: target.id },
          data: {
            voidedAt,
            voidedById: actor.user.sub,
            voidReason: parsed.data.reason
          }
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.user.sub,
            action: "ADMIN_PUNCH_VOIDED",
            entityType: "PunchEvent",
            entityId: target.id,
            detailsJson: JSON.stringify({
              employeeId: target.employeeId,
              eventType: target.eventType,
              recordedAt: target.recordedAt,
              reason: parsed.data.reason
            })
          }
        });
        return { kind: "voided" as const, punch: updated };
      });

      if (result.kind === "not-found") {
        return reply.code(404).send({ error: "Marcação não encontrada ou já anulada." });
      }
      return { item: result.punch };
    }
  );

  app.get("/overview", { preHandler: requireAdmin }, async () => {
    const now = new Date();
    const today = saoPauloDateKey(now);
    const monthStart = `${today.slice(0, 7)}-01`;
    const todayStart = startOfDate(today);
    const tomorrowStart = startOfDate(nextDateKey(today));
    const [employees, todayPunches, eventTotals, latestEvents] = await Promise.all([
      getMonthlyEmployeeData(monthStart, today),
      prisma.punchEvent.count({
        where: { voidedAt: null, recordedAt: { gte: todayStart, lt: tomorrowStart } }
      }),
      prisma.punchEvent.groupBy({
        by: ["eventType"],
        where: { voidedAt: null, recordedAt: { gte: todayStart, lt: tomorrowStart } },
        _count: { _all: true }
      }),
      prisma.punchEvent.findMany({
        where: { voidedAt: null, recordedAt: { gte: todayStart, lt: tomorrowStart } },
        orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
        take: 8,
        include: { employee: { select: { id: true, name: true, registration: true } } }
      })
    ]);
    const dateKeys = enumerateDateKeys(monthStart, today);
    const employeeAttendance = employees
      .map((employee) => {
        const days = calculateEmployeeDays(employee, dateKeys, now);
        return {
          employeeId: employee.id,
          name: employee.name,
          missingMinutes: days.reduce((sum, day) => sum + day.missingMinutes, 0),
          overtimeMinutes: days.reduce((sum, day) => sum + day.overtimeMinutes, 0),
          warningDays: days.filter((day) => day.warning).length,
          todayMissingMinutes: days.find((day) => day.date === today)?.missingMinutes ?? 0,
          todayOvertimeMinutes: days.find((day) => day.date === today)?.overtimeMinutes ?? 0
        };
      })
      .sort(
        (left, right) =>
          right.missingMinutes - left.missingMinutes || right.overtimeMinutes - left.overtimeMinutes
      );
    const pendingRequests = await prisma.attendanceRequest.count({ where: { status: "PENDING" } });
    const todayPunchRows = employees.flatMap((employee) =>
      employee.punches.filter((punch) => saoPauloDateKey(punch.recordedAt) === today)
    );
    const latestTodayByEmployee = new Map<string, (typeof todayPunchRows)[number]>();
    for (const punch of todayPunchRows) {
      const current = latestTodayByEmployee.get(punch.employeeId);
      if (!current || punch.recordedAt > current.recordedAt) {
        latestTodayByEmployee.set(punch.employeeId, punch);
      }
    }

    return {
      activeEmployees: employees.length,
      employeesWithoutExit: [...latestTodayByEmployee.values()].filter(
        (punch) => punch.eventType !== "EXIT"
      ).length,
      todayPunches,
      eventTotals: Object.fromEntries(
        eventTotals.map((item) => [item.eventType, item._count._all])
      ),
      missingMinutes: employeeAttendance.reduce((sum, item) => sum + item.missingMinutes, 0),
      overtimeMinutes: employeeAttendance.reduce((sum, item) => sum + item.overtimeMinutes, 0),
      todayMissingMinutes: employeeAttendance.reduce(
        (sum, item) => sum + item.todayMissingMinutes,
        0
      ),
      todayOvertimeMinutes: employeeAttendance.reduce(
        (sum, item) => sum + item.todayOvertimeMinutes,
        0
      ),
      warningDays: employeeAttendance.reduce((sum, item) => sum + item.warningDays, 0),
      pendingRequests,
      employeeAttendance,
      latestEvents: latestEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        recordedAt: event.recordedAt,
        employee: event.employee
      }))
    };
  });

  app.get("/:employeeId/punches", { preHandler: requireEmployeeAccess }, async (request, reply) => {
    const params = z.object({ employeeId: z.string().cuid() }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Funcionário inválido." });
    }
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
      .safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "Os filtros informados são inválidos." });
    }
    const today = saoPauloDateKey(new Date());
    const monthStart = `${today.slice(0, 7)}-01`;
    const [employee, monthlyData] = await Promise.all([
      prisma.employee.findUnique({
        where: { id: params.data.employeeId },
        include: {
          department: { select: { name: true } },
          workSchedules: { include: { days: true }, orderBy: { effectiveFrom: "desc" } },
          punches: {
            orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
            take: query.data.limit,
            include: {
              terminal: { select: { name: true } },
              targetRequests: {
                select: { id: true, type: true, status: true, reason: true }
              },
              resultRequests: {
                select: { id: true, type: true, status: true, reason: true }
              }
            }
          }
        }
      }),
      getMonthlyEmployeeData(monthStart, today, params.data.employeeId)
    ]);
    if (!employee) {
      return reply.code(404).send({ error: "Funcionário não encontrado." });
    }
    const attendanceDays = monthlyData[0]
      ? calculateEmployeeDays(monthlyData[0], enumerateDateKeys(monthStart, today), new Date())
      : [];
    return {
      employee: {
        id: employee.id,
        name: employee.name,
        registration: employee.registration,
        status: employee.status,
        jobTitle: employee.jobTitle,
        department: employee.department,
        schedules: employee.workSchedules
      },
      items: employee.punches,
      attendanceDays
    };
  });

  app.get("/:employeeId/qr", { preHandler: requireAdmin }, async (request, reply) => {
    const params = z.object({ employeeId: z.string().cuid() }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Funcionário inválido." });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: params.data.employeeId },
      include: {
        qrCredentials: {
          orderBy: { issuedAt: "desc" },
          take: 1
        }
      }
    });
    if (!employee) return reply.code(404).send({ error: "Funcionário não encontrado." });

    const credential = employee.qrCredentials[0];
    if (!credential) return { status: "NOT_ISSUED" };
    if (credential.status !== "ACTIVE") return { status: "REVOKED" };

    const actor = request as AuthenticatedRequest;
    const token = decryptQrToken(credential.encryptedToken);
    await prisma.auditLog.create({
      data: {
        actorId: actor.user.sub,
        action: "QR_CREDENTIAL_VIEWED",
        entityType: "QrCredential",
        entityId: credential.id,
        detailsJson: JSON.stringify({ employeeId: employee.id })
      }
    });
    return { status: "ACTIVE", token };
  });

  app.post("/:employeeId/qr", { preHandler: requireAdmin }, async (request, reply) => {
    const params = z.object({ employeeId: z.string().cuid() }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Funcionário inválido." });
    }

    const actor = request as AuthenticatedRequest;
    const employee = await prisma.employee.findUnique({
      where: { id: params.data.employeeId },
      select: { id: true, status: true }
    });
    if (!employee) return reply.code(404).send({ error: "Funcionário não encontrado." });
    if (employee.status !== "ACTIVE") {
      return reply
        .code(409)
        .send({ error: "Credenciais só podem ser emitidas para funcionários ativos." });
    }

    const token = createQrToken();
    try {
      await prisma.$transaction(async (transaction) => {
        const credential = await transaction.qrCredential.create({
          data: {
            employeeId: employee.id,
            activeEmployeeId: employee.id,
            tokenHash: hashQrToken(token),
            encryptedToken: encryptQrToken(token),
            issuedById: actor.user.sub
          }
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.user.sub,
            action: "QR_CREDENTIAL_ISSUED",
            entityType: "QrCredential",
            entityId: credential.id,
            detailsJson: JSON.stringify({ employeeId: employee.id })
          }
        });
      });
      return reply.code(201).send({ status: "ACTIVE", token });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply
          .code(409)
          .send({ error: "Este funcionário já possui uma credencial QR ativa." });
      }
      throw error;
    }
  });

  app.post("/:employeeId/qr/revoke", { preHandler: requireAdmin }, async (request, reply) => {
    const params = z.object({ employeeId: z.string().cuid() }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Funcionário inválido." });
    }

    const actor = request as AuthenticatedRequest;
    const credential = await prisma.qrCredential.findUnique({
      where: { activeEmployeeId: params.data.employeeId }
    });
    if (!credential) {
      return reply.code(404).send({ error: "Não há credencial QR ativa para revogar." });
    }

    const revoked = await prisma.$transaction(async (transaction) => {
      const result = await transaction.qrCredential.updateMany({
        where: {
          id: credential.id,
          activeEmployeeId: params.data.employeeId,
          status: "ACTIVE"
        },
        data: {
          status: "REVOKED",
          activeEmployeeId: null,
          revokedAt: new Date(),
          revokedById: actor.user.sub
        }
      });
      if (result.count !== 1) return false;
      await transaction.auditLog.create({
        data: {
          actorId: actor.user.sub,
          action: "QR_CREDENTIAL_REVOKED",
          entityType: "QrCredential",
          entityId: credential.id,
          detailsJson: JSON.stringify({ employeeId: credential.employeeId })
        }
      });
      return true;
    });
    if (!revoked) return reply.code(409).send({ error: "A credencial já foi revogada." });
    return { status: "REVOKED" };
  });

  app.get("/", { preHandler: requireAdmin }, async (request, reply) => {
    const querySchema = z.object({
      search: z.string().trim().max(120).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20)
    });
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Os filtros informados são inválidos." });
    }
    const query = parsed.data;
    const where = query.search
      ? {
          OR: [{ name: { contains: query.search } }, { registration: { contains: query.search } }]
        }
      : {};

    const [items, total] = await prisma.$transaction([
      prisma.employee.findMany({
        where,
        include: { department: { select: { id: true, name: true } } },
        orderBy: { name: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      prisma.employee.count({ where })
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  });

  app.post("/", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = employeeInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Confira os dados informados." });
    }

    const actor = request as AuthenticatedRequest;
    const data: Prisma.EmployeeUncheckedCreateInput = {
      registration: parsed.data.registration,
      name: parsed.data.name,
      cpf: parsed.data.cpf?.replace(/\D/g, "") || null,
      jobTitle: parsed.data.jobTitle || null,
      departmentId: parsed.data.departmentId || null,
      admissionDate: parsed.data.admissionDate || null
    };

    try {
      const employee = await prisma.$transaction(async (transaction) => {
        const created = await transaction.employee.create({ data });
        const effectiveFrom = parsed.data.admissionDate
          ? saoPauloDateKey(parsed.data.admissionDate)
          : saoPauloDateKey(new Date());
        await transaction.workSchedule.create({
          data: {
            employeeId: created.id,
            effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
            createdById: actor.user.sub,
            days: { create: defaultScheduleDays() }
          }
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.user.sub,
            action: "EMPLOYEE_CREATED",
            entityType: "Employee",
            entityId: created.id,
            detailsJson: JSON.stringify({ registration: created.registration })
          }
        });
        return created;
      });
      return reply.code(201).send(employee);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.code(409).send({ error: "Matrícula ou CPF já cadastrado." });
      }
      throw error;
    }
  });
}

async function getMonthlyEmployeeData(start: string, end: string, employeeId?: string) {
  const afterEnd = nextDateKey(end);
  return prisma.employee.findMany({
    where: employeeId ? { id: employeeId } : { status: "ACTIVE" },
    include: {
      workSchedules: { include: { days: true }, orderBy: { effectiveFrom: "asc" } },
      punches: {
        where: {
          voidedAt: null,
          recordedAt: { gte: startOfDate(start), lt: startOfDate(afterEnd) }
        },
        orderBy: [{ recordedAt: "asc" }, { createdAt: "asc" }]
      },
      attendanceRequests: {
        where: {
          status: { in: ["PENDING", "APPROVED"] },
          targetDate: { gte: startOfDate(start), lt: startOfDate(afterEnd) }
        },
        select: { id: true, type: true, status: true, targetDate: true, minutes: true }
      }
    }
  });
}

function calculateEmployeeDays(
  employee: MonthlyEmployee,
  dates: string[],
  now: Date
): (ReturnType<typeof evaluateAttendanceDay> & { pendingRequest: boolean })[] {
  const schedules: ScheduleRevision[] = employee.workSchedules;
  const marksByDate = new Map<string, AttendanceMark[]>();
  for (const punch of employee.punches) {
    const date = saoPauloDateKey(punch.recordedAt);
    const marks = marksByDate.get(date) ?? [];
    marks.push({ eventType: punch.eventType, recordedAt: punch.recordedAt });
    marksByDate.set(date, marks);
  }
  const waiversByDate = new Map<string, number>();
  const pendingDates = new Set<string>();
  for (const request of employee.attendanceRequests) {
    if (!request.targetDate) continue;
    const date = saoPauloDateKey(request.targetDate);
    if (request.type === "HOUR_WAIVER" && request.status === "APPROVED") {
      waiversByDate.set(date, (waiversByDate.get(date) ?? 0) + (request.minutes ?? 0));
    }
    if (request.status === "PENDING") pendingDates.add(date);
  }
  return dates.map((date) => {
    const base = evaluateAttendanceDay({
      date,
      schedule: getEffectiveSchedule(schedules, date),
      marks: marksByDate.get(date) ?? [],
      waivedMinutes: waiversByDate.get(date) ?? 0,
      now
    });
    const pendingRequest = pendingDates.has(date);
    return { ...base, pendingRequest, warning: base.warning || pendingRequest };
  });
}

async function requireEmployeeAccess(
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply
): Promise<void> {
  await requireAuthenticated(request, reply);
  if (reply.sent) return;
  const actor = request as AuthenticatedRequest;
  if (actor.user.role === "ADMIN") return;
  if (actor.user.role !== "MANAGER") {
    await reply.code(403).send({ error: "Acesso não autorizado." });
    return;
  }
  const params = z.object({ employeeId: z.string().cuid() }).safeParse(request.params);
  if (!params.success) {
    await reply.code(400).send({ error: "Funcionário inválido." });
    return;
  }
  const scope = await prisma.userEmployeeScope.findUnique({
    where: { userId_employeeId: { userId: actor.user.sub, employeeId: params.data.employeeId } },
    select: { employeeId: true }
  });
  if (!scope) await reply.code(403).send({ error: "Você não tem acesso a este funcionário." });
}

function defaultScheduleDays() {
  return Array.from({ length: 7 }, (_, index) => {
    const dayOfWeek = index + 1;
    const worksWeekday = dayOfWeek <= 5;
    return {
      dayOfWeek,
      startTime: worksWeekday ? "08:00" : null,
      breakStartTime: worksWeekday ? "12:00" : null,
      breakEndTime: worksWeekday ? "13:00" : null,
      endTime: worksWeekday ? "17:00" : null
    };
  });
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour! * 60 + minute!;
}

function startOfDate(date: string): Date {
  return saoPauloDayStart(date);
}

function nextDateKey(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + 1));
  return next.toISOString().slice(0, 10);
}

function isValidDateKey(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
