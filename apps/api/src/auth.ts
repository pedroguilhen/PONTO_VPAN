import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";

export type AuthenticatedRequest = FastifyRequest & {
  user: {
    sub: string;
    email: string;
    role: string;
  };
};

export async function requireAuthenticated(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    await reply.code(401).send({ error: "Autenticação necessária." });
    return;
  }

  const authenticated = request as AuthenticatedRequest;
  const user = await prisma.user.findUnique({
    where: { id: authenticated.user.sub },
    select: { active: true, role: true }
  });
  if (!user?.active) {
    await reply.code(401).send({ error: "Autenticação necessária." });
    return;
  }
  if (authenticated.user.role !== user.role) {
    await reply.code(401).send({ error: "Autenticação necessária." });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuthenticated(request, reply);
  if (reply.sent) return;
  const authenticated = request as AuthenticatedRequest;
  if (authenticated.user.role !== "ADMIN") {
    await reply.code(403).send({ error: "Acesso não autorizado." });
  }
}
