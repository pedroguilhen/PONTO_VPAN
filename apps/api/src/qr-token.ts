import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env.js";

const encryptionKey = Buffer.from(env.QR_ENCRYPTION_KEY, "hex");

export function createQrToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashQrToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function encryptQrToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

export function decryptQrToken(encryptedToken: string): string {
  const [version, encodedIv, encodedTag, encodedText] = encryptedToken.split(".");
  if (!version || !encodedIv || !encodedTag || !encodedText || version !== "v1") {
    throw new Error("Credencial QR armazenada em formato inválido.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    Buffer.from(encodedIv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}
