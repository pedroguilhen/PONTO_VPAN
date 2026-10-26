import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireAuthenticated, type AuthenticatedRequest } from "../auth.js";
import { saoPauloDateKey, saoPauloDayStart } from "../attendance-calculations.js";
import { prisma } from "../db.js";
import { punchEventTypes } from "../punch-sequence.js";

const requestInput = z
  .object({
    employeeId: z.string().cuid(),
    type: z.enum(["CORRECT_PUNCH", "ADD_PUNCH", "HOUR_WAIVER", "VOID_PUNCH"]),
    targetEventId: z.string().cuid().optional(),
    eventType: z.enum(punchEventTypes).optional(),
    recordedAt: z.coerce.date().optional(),
    targetDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    minutes: z.number().int().min(1).max(1_440).optional(),
    reason: z.string().trim().min(10).max(500)
  })
  .superRefine((input, context) => {
    if (input.type === "VOID_PUNCH" && !input.targetEventId) {
      context.addIssue({ code: "custom", message: "Selecione a marcação a descartar." });
    }
    if (
      input.type === "CORRECT_PUNCH" &&
      (!input.targetEventId || !input.eventType || !input.recordedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Informe o ponto original, o novo tipo e o novo horário."
      });
    }
    if (input.type === "ADD_PUNCH" && (!input.eventType || !input.recordedAt)) {
      context.addIssue({
        code: "custom",
        message: "Informe o tipo e o horário do ponto esquecido."
      });
    }
    if (input.type === "HOUR_WAIVER" && (!input.targetDate || !input.minutes)) {
      context.addIssue({
        code: "custom",
        message: "Informe o dia e a quantidade de horas para abono."
      });
    }
    if (input.targetDate && !isValidDateKey(input.targetDate)) {
      context.addIssue({ code: "custom", message: "A data da solicitação é inválida." });
    }
  });

const decisionInput = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reviewComment: z.string().trim().max(500).optional()
});

export async function attendanceRequestRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requireAuthenticated }, async (request, reply) => {
    const actor = request as AuthenticatedRequest;
    const query = z
      .object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional() })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Filtro de solicitações inválido." });
    const items = await prisma.attendanceRequest.findMany({
      where: {
        ...(actor.user.role === "ADMIN" ? {} : { requestedById: actor.user.sub }),
        ...(query.data.status ? { status: query.data.status } : {})
      },
      include: {
        employee: { select: { id: true, name: true, registration: true } },
        requestedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        targetEvent: { select: { id: true, eventType: true, recordedAt: true } },
        resultEvent: { select: { id: true, eventType: true, recordedAt: true } }
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200
    });
    return { items };
  });

  app.post("/", { preHandler: requireAuthenticated }, async (request, reply) => {
    const actor = request as AuthenticatedRequest;
    if (actor.user.role !== "MANAGER") {
      return reply.code(403).send({ error: "Somente gestores podem enviar solicitações." });
    }
    const parsed = requestInput.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Confira os dados da solicitação e informe um motivo." });
    }
    const input = parsed.data;
    const scope = await prisma.userEmployeeScope.findUnique({
      where: {
        userId_employeeId: { userId: actor.user.sub, employeeId: input.employeeId }
      },
      select: { employeeId: true }
    });
    if (!scope) return reply.code(403).send({ error: "Você não tem acesso a este funcionário." });
    const employee = await prisma.employee.findUnique({
      where: { id: input.employeeId },
      select: { id: true, status: true }
    });
    if (!employee) return reply.code(404).send({ error: "Funcionário não encontrado." });
    if (employee.status !== "ACTIVE") {
      return reply
        .code(409)
        .send({ error: "Não é possível solicitar alterações para funcionário inativo." });
    }

    let targetEvent: { id: string; eventType: string; recordedAt: Date } | null = null;
    if (input.type === "CORRECT_PUNCH" || input.type === "VOID_PUNCH") {
      targetEvent = await prisma.punchEvent.findFirst({
        where: { id: input.targetEventId!, employeeId: input.employeeId, voidedAt: null },
        select: { id: true, eventType: true, recordedAt: true }
      });
      if (!targetEvent) return reply.code(404).send({ error: "Marcação original não encontrada." });
      const pending = await prisma.attendanceRequest.findFirst({
        where: { targetEventId: targetEvent.id, status: "PENDING" }
      });
      if (pending)
        return reply
          .code(409)
          .send({ error: "Já existe uma solicitação pendente para este ponto." });
    }
    if (input.recordedAt && input.recordedAt > new Date()) {
      return reply.code(400).send({ error: "A nova marcação não pode estar no futuro." });
    }

    const targetDateKey =
      input.type === "VOID_PUNCH" && targetEvent
        ? saoPauloDateKey(targetEvent.recordedAt)
        : (input.targetDate ?? (input.recordedAt ? saoPauloDateKey(input.recordedAt) : null));
    if (!targetDateKey) {
      return reply.code(400).send({ error: "Informe a data correspondente à solicitação." });
    }
    if (input.type !== "VOID_PUNCH" && targetDateKey > saoPauloDateKey(new Date())) {
      return reply
        .code(400)
        .send({ error: "A solicitação não pode ser feita para uma data futura." });
    }

    const created = await prisma.$transaction(async (transaction) => {
      const attendanceRequest = await transaction.attendanceRequest.create({
        data: {
          employeeId: employee.id,
          requestedById: String(actor.user.sub),
          type: input.type,
          targetEventId: targetEvent?.id ?? null,
          targetEventType: targetEvent?.eventType ?? null,
          targetRecordedAt: targetEvent?.recordedAt ?? null,
          proposedEventType: input.eventType ?? null,
          proposedRecordedAt: input.recordedAt ?? null,
          targetDate: saoPauloDayStart(targetDateKey),
          minutes: input.minutes ?? null,
          reason: input.reason
        }
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.user.sub,
          action: "ATTENDANCE_REQUEST_SUBMITTED",
          entityType: "AttendanceRequest",
          entityId: attendanceRequest.id,
          detailsJson: JSON.stringify({
            employeeId: employee.id,
            type: input.type,
            targetDate: targetDateKey,
            targetEventId: targetEvent?.id,
            proposedEventType: input.eventType,
            proposedRecordedAt: input.recordedAt,
            minutes: input.minutes
          })
        }
      });
      return attendanceRequest;
    });
    return reply.code(201).send(created);
  });

  app.post("/:requestId/decision", { preHandler: requireAdmin }, async (request, reply) => {
    const params = z.object({ requestId: z.string().cuid() }).safeParse(request.params);
    const parsed = decisionInput.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.code(400).send({ error: "Decisão de solicitação inválida." });
    }
    if (!parsed.data.reviewComment?.trim()) {
      return reply.code(400).send({ error: "Informe o motivo da aprovação ou rejeição." });
    }
    const actor = request as AuthenticatedRequest;
    const existing = await prisma.attendanceRequest.findUnique({
      where: { id: params.data.requestId },
      include: { targetEvent: true }
    });
    if (!existing) return reply.code(404).send({ error: "Solicitação não encontrada." });
    if (existing.status !== "PENDING") {
      return reply.code(409).send({ error: "Esta solicitação já foi analisada." });
    }

    try {
      const updated = await prisma.$transaction(async (transaction) => {
        let resultEventId: string | undefined;
        if (parsed.data.decision === "APPROVE" && existing.type !== "HOUR_WAIVER") {
          if (
            existing.type !== "VOID_PUNCH" &&
            (!existing.proposedEventType || !existing.proposedRecordedAt)
          ) {
            return { kind: "invalid-request" as const };
          }
          if (existing.type === "CORRECT_PUNCH" || existing.type === "VOID_PUNCH") {
            const target = existing.targetEventId
              ? await transaction.punchEvent.findFirst({
                  where: {
                    id: existing.targetEventId,
                    employeeId: existing.employeeId,
                    voidedAt: null
                  }
                })
              : null;
            if (
              !target ||
              target.eventType !== existing.targetEventType ||
              target.recordedAt.getTime() !== existing.targetRecordedAt?.getTime()
            ) {
              return { kind: "stale-event" as const };
            }
            await transaction.punchEvent.update({
              where: { id: target.id },
              data:
                existing.type === "VOID_PUNCH"
                  ? {
                      voidedAt: new Date(),
                      voidedById: actor.user.sub,
                      voidReason: existing.reason
                    }
                  : {
                      eventType: existing.proposedEventType!,
                      recordedAt: existing.proposedRecordedAt!,
                      source: "APPROVED_CORRECTION"
                    }
            });
          } else {
            const createdEvent = await transaction.punchEvent.create({
              data: {
                employeeId: existing.employeeId,
                eventType: existing.proposedEventType!,
                recordedAt: existing.proposedRecordedAt!,
                source: "APPROVED_MISSING_PUNCH",
                idempotencyKey: crypto.randomUUID()
              }
            });
            resultEventId = createdEvent.id;
          }
        }

        const claim = await transaction.attendanceRequest.updateMany({
          where: { id: existing.id, status: "PENDING" },
          data: {
            status: parsed.data.decision === "APPROVE" ? "APPROVED" : "REJECTED",
            reviewedById: String(actor.user.sub),
            reviewedAt: new Date(),
            reviewComment: parsed.data.reviewComment || null,
            resultEventId: resultEventId ?? null
          }
        });
        if (claim.count !== 1) throw new RequestDecisionConflict();
        await transaction.auditLog.create({
          data: {
            actorId: actor.user.sub,
            action: `ATTENDANCE_REQUEST_${parsed.data.decision}D`,
            entityType: "AttendanceRequest",
            entityId: existing.id,
            detailsJson: JSON.stringify({
              employeeId: existing.employeeId,
              type: existing.type,
              targetEventId: existing.targetEventId,
              oldEventType: existing.targetEventType,
              oldRecordedAt: existing.targetRecordedAt,
              newEventType: existing.proposedEventType,
              newRecordedAt: existing.proposedRecordedAt,
              minutes: existing.minutes,
              reviewComment: parsed.data.reviewComment || null
            })
          }
        });
        return { kind: "updated" as const };
      });
      if (updated.kind === "invalid-request") {
        return reply
          .code(409)
          .send({ error: "A solicitação está incompleta e não pode ser aprovada." });
      }
      if (updated.kind === "stale-event") {
        return reply
          .code(409)
          .send({ error: "A marcação original mudou desde o pedido. Reavalie a solicitação." });
      }
    } catch (error) {
      if (error instanceof RequestDecisionConflict) {
        return reply.code(409).send({ error: "Esta solicitação já foi analisada." });
      }
      if (isUniqueConstraintError(error)) {
        return reply.code(409).send({ error: "Esta solicitação já foi processada." });
      }
      throw error;
    }

    return {
      status: parsed.data.decision === "APPROVE" ? "APPROVED" : "REJECTED"
    };
  });
}

class RequestDecisionConflict extends Error {}

function isValidDateKey(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
