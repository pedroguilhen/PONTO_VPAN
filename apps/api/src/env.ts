import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z
    .string()
    .min(32)
    .refine((secret) => !secret.includes("replace-with-a-random-secret"), {
      message: "JWT_SECRET deve ser um segredo aleatório, não o valor de exemplo."
    }),
  QR_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, {
    message: "QR_ENCRYPTION_KEY deve conter 32 bytes aleatórios em hexadecimal."
  }),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(3000)
});

export const env = environmentSchema.parse(process.env);
