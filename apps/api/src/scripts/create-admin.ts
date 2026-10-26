import { hash } from "bcryptjs";
import { prisma } from "../db.js";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.ADMIN_NAME?.trim();
const password = process.env.ADMIN_PASSWORD;

if (
  !email ||
  !name ||
  !password ||
  password.length < 12 ||
  Buffer.byteLength(password, "utf8") > 72
) {
  console.error("Defina ADMIN_EMAIL, ADMIN_NAME e ADMIN_PASSWORD (12 a 72 bytes) no ambiente.");
  process.exitCode = 1;
} else {
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new Error("Já existe um usuário com esse e-mail.");
    }
    await prisma.user.create({
      data: { email, name, passwordHash: await hash(password, 12), role: "ADMIN" }
    });
    console.log("Administrador criado.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Falha ao criar administrador.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
