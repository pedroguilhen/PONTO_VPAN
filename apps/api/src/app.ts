import Fastify from "fastify";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { attendanceRequestRoutes } from "./routes/attendance-requests.js";
import { employeeRoutes } from "./routes/employees.js";
import { terminalRoutes } from "./routes/terminal.js";
import { terminalAdminRoutes } from "./routes/terminals.js";
import { userRoutes } from "./routes/users.js";

export async function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 32 * 1024 });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(rateLimit, { global: true, max: 100, timeWindow: "1 minute" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(attendanceRequestRoutes, { prefix: "/api/attendance-requests" });
  await app.register(employeeRoutes, { prefix: "/api/employees" });
  await app.register(userRoutes, { prefix: "/api/users" });
  await app.register(terminalAdminRoutes, { prefix: "/api/terminals" });
  await app.register(terminalRoutes, { prefix: "/api/terminal" });

  app.get("/api/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  });

  app.addHook("onClose", async () => prisma.$disconnect());
  return app;
}
