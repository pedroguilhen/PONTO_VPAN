import { compare } from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuthenticated, type AuthenticatedRequest } from "../auth.js";
import { prisma } from "../db.js";

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((email) => email.toLowerCase()),
  password: z
    .string()
    .min(1)
    .refine((password) => Buffer.byteLength(password, "utf8") <= 72)
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/me", { preHandler: requireAuthenticated }, async (request) => {
    const actor = request as AuthenticatedRequest;
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: actor.user.sub },
      select: { id: true, email: true, name: true, role: true }
    });
    return { user };
  });

  app.post("/login", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    handler: async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "E-mail ou senha inválidos." });
      }

      const user = await prisma.user.findUnique({
        where: { email: parsed.data.email.toLowerCase() }
      });
      if (!user || !user.active || !(await compare(parsed.data.password, user.passwordHash))) {
        return reply.code(401).send({ error: "E-mail ou senha inválidos." });
      }

      const accessToken = app.jwt.sign(
        { sub: user.id, email: user.email, role: user.role },
        { expiresIn: "15m" }
      );

      return {
        accessToken,
        user: { id: user.id, email: user.email, name: user.name, role: user.role }
      };
    }
  });
}
