import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { saoPauloDateKey, saoPauloDayStart } from "../attendance-calculations.js";
import { prisma } from "../db.js";
import { hashQrToken } from "../qr-token.js";
import { getPunchChoices, punchEventTypes } from "../punch-sequence.js";
import { getTerminalToken, hashTerminalToken } from "./terminals.js";

declare module "fastify" {
  interface FastifyRequest {
    terminalId?: string;
  }
}

const punchSchema = z.object({
  qrToken: z.string().min(32).max(128),
  idempotencyKey: z.string().uuid(),
  eventType: z.enum(punchEventTypes).optional()
});
const previewSchema = z.object({ qrToken: z.string().min(32).max(128) });

export async function terminalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    await authenticateTerminal(request, reply);
  });

  app.get("/me", async (request) => {
    const terminal = await getAuthenticatedTerminal(request);
    return { id: terminal.id, name: terminal.name };
  });

  app.post(
    "/preview",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = previewSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Não foi possível validar a leitura." });
      }

      const credential = await prisma.qrCredential.findUnique({
        where: { tokenHash: hashQrToken(parsed.data.qrToken) },
        select: {
          employeeId: true,
          status: true,
          employee: { select: { name: true, status: true } }
        }
      });
      if (!credential || credential.status !== "ACTIVE") {
        return reply.code(404).send({ error: "QR Code inválido ou não reconhecido." });
      }
      if (credential.employee.status !== "ACTIVE") {
        return reply.code(409).send({ error: "Funcionário não autorizado a registrar ponto." });
      }

      const latestEvent = await prisma.punchEvent.findFirst({
        where: {
          employeeId: credential.employeeId,
          voidedAt: null,
          recordedAt: { gte: saoPauloDayStart(saoPauloDateKey(new Date())) }
        },
        orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
        select: { eventType: true }
      });
      const choices = getPunchChoices(latestEvent?.eventType ?? null);
      if (choices.length === 0) {
        return reply
          .code(409)
          .send({ error: "Sequência de registro inconsistente; procure o responsável." });
      }
      return { employeeName: credential.employee.name, choices };
    }
  );

  app.post(
    "/punch",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } }
    },
    async (request, reply) => {
      const parsed = punchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Não foi possível validar a leitura." });
      }

      const terminal = await getAuthenticatedTerminal(request);
      const qrHash = hashQrToken(parsed.data.qrToken);
      const existingCredential = await prisma.qrCredential.findUnique({
        where: { tokenHash: qrHash },
        select: {
          id: true,
          employeeId: true,
          status: true,
          employee: { select: { name: true, status: true } }
        }
      });
      if (!existingCredential || existingCredential.status !== "ACTIVE") {
        return reply.code(404).send({ error: "QR Code inválido ou não reconhecido." });
      }
      if (existingCredential.employee.status !== "ACTIVE") {
        return reply.code(409).send({ error: "Funcionário não autorizado a registrar ponto." });
      }

      const duplicate = await prisma.punchEvent.findUnique({
        where: { idempotencyKey: parsed.data.idempotencyKey }
      });
      if (duplicate) {
        if (
          duplicate.terminalId !== terminal.id ||
          duplicate.employeeId !== existingCredential.employeeId
        ) {
          return reply.code(409).send({ error: "Não foi possível confirmar esta leitura." });
        }
        return {
          status: "DUPLICATE",
          employeeName: existingCredential.employee.name,
          eventType: duplicate.eventType,
          recordedAt: duplicate.recordedAt
        };
      }

      const recordedAt = new Date();
      const result = await prisma.$transaction(async (transaction) => {
        const lockedTerminal = await transaction.punchTerminal.updateMany({
          where: { id: terminal.id, active: true },
          data: { lastSeenAt: recordedAt }
        });
        if (lockedTerminal.count !== 1) {
          return { kind: "unauthorized" as const };
        }

        const credential = await transaction.qrCredential.findUnique({
          where: { tokenHash: qrHash },
          select: {
            employeeId: true,
            status: true,
            employee: { select: { name: true, status: true } }
          }
        });
        if (!credential || credential.status !== "ACTIVE") {
          return { kind: "invalid-credential" as const };
        }
        if (credential.employee.status !== "ACTIVE") {
          return { kind: "inactive-employee" as const };
        }

        const retry = await transaction.punchEvent.findUnique({
          where: { idempotencyKey: parsed.data.idempotencyKey }
        });
        if (retry) {
          if (retry.terminalId !== terminal.id || retry.employeeId !== credential.employeeId) {
            return { kind: "idempotency-conflict" as const };
          }
          return {
            kind: "duplicate" as const,
            event: retry,
            employeeName: credential.employee.name
          };
        }

        const repeatedRead = await transaction.punchEvent.findFirst({
          where: {
            employeeId: credential.employeeId,
            terminalId: terminal.id,
            voidedAt: null,
            recordedAt: { gte: new Date(recordedAt.getTime() - 5000) }
          },
          orderBy: { recordedAt: "desc" }
        });
        if (repeatedRead) {
          return {
            kind: "duplicate" as const,
            event: repeatedRead,
            employeeName: credential.employee.name
          };
        }

        const latestEvent = await transaction.punchEvent.findFirst({
          where: {
            employeeId: credential.employeeId,
            voidedAt: null,
            recordedAt: { gte: saoPauloDayStart(saoPauloDateKey(recordedAt)) }
          },
          orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }]
        });
        const choices = getPunchChoices(latestEvent?.eventType ?? null);
        if (choices.length === 0) {
          return { kind: "invalid-sequence" as const };
        }
        if (choices.length > 1 && !parsed.data.eventType) {
          return { kind: "selection-required" as const, choices };
        }
        const eventType = parsed.data.eventType ?? choices[0]!.eventType;
        if (!choices.some((choice) => choice.eventType === eventType)) {
          return { kind: "invalid-selection" as const };
        }

        const event = await transaction.punchEvent.create({
          data: {
            employeeId: credential.employeeId,
            eventType,
            recordedAt,
            source: "QR_TERMINAL",
            terminalId: terminal.id,
            idempotencyKey: parsed.data.idempotencyKey
          }
        });
        await transaction.auditLog.create({
          data: {
            action: "PUNCH_RECORDED",
            entityType: "PunchEvent",
            entityId: event.id,
            detailsJson: JSON.stringify({
              employeeId: credential.employeeId,
              eventType,
              terminalId: terminal.id
            })
          }
        });
        return {
          kind: "created" as const,
          event,
          employeeName: credential.employee.name
        };
      });

      if (result.kind === "unauthorized") {
        return reply.code(401).send({ error: "Terminal não autorizado." });
      }
      if (result.kind === "invalid-credential") {
        return reply.code(404).send({ error: "QR Code inválido ou não reconhecido." });
      }
      if (result.kind === "inactive-employee") {
        return reply.code(409).send({ error: "Funcionário não autorizado a registrar ponto." });
      }
      if (result.kind === "idempotency-conflict") {
        return reply.code(409).send({ error: "Não foi possível confirmar esta leitura." });
      }
      if (result.kind === "invalid-sequence") {
        return reply
          .code(409)
          .send({ error: "Sequência de registro inconsistente; procure o responsável." });
      }
      if (result.kind === "invalid-selection") {
        return reply.code(409).send({ error: "Tipo de registro inválido para a sequência atual." });
      }
      if (result.kind === "selection-required") {
        return reply.code(409).send({ status: "SELECT_EVENT", choices: result.choices });
      }

      return {
        status: result.kind === "duplicate" ? "DUPLICATE" : "RECORDED",
        employeeName: result.employeeName,
        eventType: result.event.eventType,
        recordedAt: result.event.recordedAt
      };
    }
  );
}

async function authenticateTerminal(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = getTerminalToken(request);
  if (!token) {
    await reply.code(401).send({ error: "Terminal não autorizado." });
    return;
  }
  const terminal = await prisma.punchTerminal.findUnique({
    where: { tokenHash: hashTerminalToken(token) },
    select: { id: true, active: true }
  });
  if (!terminal?.active) {
    await reply.code(401).send({ error: "Terminal não autorizado." });
    return;
  }
  request.terminalId = terminal.id;
}

async function getAuthenticatedTerminal(request: FastifyRequest) {
  if (!request.terminalId) throw new Error("Terminal authentication state is missing.");
  return prisma.punchTerminal.findUniqueOrThrow({
    where: { id: request.terminalId },
    select: { id: true, name: true, active: true }
  });
}
