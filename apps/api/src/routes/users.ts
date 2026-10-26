import { hash } from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, type AuthenticatedRequest } from "../auth.js";
import { prisma } from "../db.js";

const managerInput = z.object({
  name: z.string().trim().min(2).max(160),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(12)
    .max(72)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72),
  employeeIds: z.array(z.string().cuid()).min(1).max(100)
});
const scopeInput = z.object({ employeeIds: z.array(z.string().cuid()).max(100) });

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAdmin);

  app.get("/", async () => {
    const managers = await prisma.user.findMany({
      where: { role: "MANAGER" },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        employeeScopes: {
          include: {
            employee: { select: { id: true, name: true, registration: true } }
          }
        }
      },
      orderBy: { name: "asc" }
    });
    return { items: managers };
  });

  app.post("/", async (request, reply) => {
    const parsed = managerInput.safeParse(request.body);
    if (
      !parsed.success ||
      new Set(parsed.data?.employeeIds ?? []).size !== parsed.data?.employeeIds.length
    ) {
      return reply.code(400).send({ error: "Confira os dados e os funcionários vinculados." });
    }
    const actor = request as AuthenticatedRequest;
    const input = parsed.data;
    const employees = await prisma.employee.findMany({
      where: { id: { in: input.employeeIds }, status: "ACTIVE" },
      select: { id: true }
    });
    if (employees.length !== input.employeeIds.length) {
      return reply
        .code(400)
        .send({ error: "Um ou mais funcionários estão inválidos ou inativos." });
    }
    try {
      const passwordHash = await hash(input.password, 12);
      const manager = await prisma.$transaction(async (transaction) => {
        const created = await transaction.user.create({
          data: {
            name: input.name,
            email: input.email,
            passwordHash,
            role: "MANAGER",
            employeeScopes: {
              create: input.employeeIds.map((employeeId) => ({ employeeId }))
            }
          },
          select: { id: true, name: true, email: true, active: true }
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.user.sub,
            action: "MANAGER_CREATED",
            entityType: "User",
            entityId: created.id,
            detailsJson: JSON.stringify({ employeeIds: input.employeeIds })
          }
        });
        return created;
      });
      return reply.code(201).send(manager);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.code(409).send({ error: "Este e-mail já está cadastrado." });
      }
      throw error;
    }
  });

  app.put("/:userId/scopes", async (request, reply) => {
    const params = z.object({ userId: z.string().cuid() }).safeParse(request.params);
    const parsed = scopeInput.safeParse(request.body);
    if (
      !params.success ||
      !parsed.success ||
      new Set(parsed.data?.employeeIds ?? []).size !== parsed.data?.employeeIds.length
    ) {
      return reply.code(400).send({ error: "Confira os funcionários vinculados." });
    }
    const manager = await prisma.user.findFirst({
      where: { id: params.data.userId, role: "MANAGER" },
      select: { id: true }
    });
    if (!manager) return reply.code(404).send({ error: "Gestor não encontrado." });
    const employees = await prisma.employee.findMany({
      where: { id: { in: parsed.data.employeeIds }, status: "ACTIVE" },
      select: { id: true }
    });
    if (employees.length !== parsed.data.employeeIds.length) {
      return reply
        .code(400)
        .send({ error: "Um ou mais funcionários estão inválidos ou inativos." });
    }
    const actor = request as AuthenticatedRequest;
    await prisma.$transaction(async (transaction) => {
      await transaction.userEmployeeScope.deleteMany({ where: { userId: manager.id } });
      if (parsed.data.employeeIds.length) {
        await transaction.userEmployeeScope.createMany({
          data: parsed.data.employeeIds.map((employeeId) => ({
            userId: manager.id,
            employeeId
          }))
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: actor.user.sub,
          action: "MANAGER_SCOPE_UPDATED",
          entityType: "User",
          entityId: manager.id,
          detailsJson: JSON.stringify({ employeeIds: parsed.data.employeeIds })
        }
      });
    });
    return { status: "UPDATED" };
  });

  app.post("/:userId/deactivate", async (request, reply) => {
    const params = z.object({ userId: z.string().cuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Gestor inválido." });
    const actor = request as AuthenticatedRequest;
    const deactivated = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.updateMany({
        where: { id: params.data.userId, role: "MANAGER", active: true },
        data: { active: false }
      });
      if (updated.count !== 1) return false;
      await transaction.auditLog.create({
        data: {
          actorId: actor.user.sub,
          action: "MANAGER_DEACTIVATED",
          entityType: "User",
          entityId: params.data.userId,
          detailsJson: "{}"
        }
      });
      return true;
    });
    if (!deactivated) return reply.code(404).send({ error: "Gestor ativo não encontrado." });
    return { status: "DEACTIVATED" };
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
