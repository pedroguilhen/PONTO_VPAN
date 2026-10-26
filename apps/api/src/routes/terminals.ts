import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAdmin, type AuthenticatedRequest } from "../auth.js";
import { prisma } from "../db.js";

const createTerminalSchema = z.object({
  name: z.string().trim().min(2).max(80)
});

export async function terminalAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAdmin);

  app.get("/", async () =>
    prisma.punchTerminal.findMany({
      select: {
        id: true,
        name: true,
        active: true,
        createdAt: true,
        lastSeenAt: true,
        revokedAt: true
      },
      orderBy: { createdAt: "desc" }
    })
  );

  app.post("/", async (request, reply) => {
    const parsed = createTerminalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Informe um nome válido para o terminal." });
    }

    const actor = request as AuthenticatedRequest;
    const token = randomBytes(32).toString("base64url");
    const terminal = await prisma.$transaction(async (transaction) => {
      const created = await transaction.punchTerminal.create({
        data: {
          name: parsed.data.name,
          tokenHash: hashTerminalToken(token),
          createdById: actor.user.sub
        },
        select: {
          id: true,
          name: true,
          active: true,
          createdAt: true
        }
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.user.sub,
          action: "TERMINAL_PROVISIONED",
          entityType: "PunchTerminal",
          entityId: created.id,
          detailsJson: JSON.stringify({ name: created.name })
        }
      });
      return created;
    });

    return reply.code(201).send({ ...terminal, token });
  });

  app.post("/:terminalId/revoke", async (request, reply) => {
    const params = z.object({ terminalId: z.string().cuid() }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Terminal inválido." });
    }

    const actor = request as AuthenticatedRequest;
    const revoked = await prisma.$transaction(async (transaction) => {
      const result = await transaction.punchTerminal.updateMany({
        where: { id: params.data.terminalId, active: true },
        data: { active: false, revokedAt: new Date() }
      });
      if (result.count !== 1) return false;
      await transaction.auditLog.create({
        data: {
          actorId: actor.user.sub,
          action: "TERMINAL_REVOKED",
          entityType: "PunchTerminal",
          entityId: params.data.terminalId,
          detailsJson: JSON.stringify({})
        }
      });
      return true;
    });

    if (!revoked) return reply.code(404).send({ error: "Terminal ativo não encontrado." });
    return { status: "REVOKED" };
  });
}

export function hashTerminalToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function getTerminalToken(request: FastifyRequest): string | null {
  const token = request.headers["x-terminal-key"];
  return typeof token === "string" && token.length <= 128 ? token : null;
}
