import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const VERSION = "aes-256-gcm-v1";

function encryptionKey(value) {
  if (typeof value !== "string" || value.length < 32) {
    throw new Error("API_KEY_ENCRYPTION_KEY must contain at least 32 characters.");
  }
  return createHash("sha256").update(value, "utf8").digest();
}

export function createAesSecretProtector(value) {
  const key = encryptionKey(value);
  return Object.freeze({
    name: VERSION,
    encrypt(secret) {
      if (typeof secret !== "string" || !secret) throw new Error("Secret must be a non-empty string.");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
    },
    decrypt(payload) {
      const [version, ivValue, tagValue, ciphertextValue, extra] = String(payload ?? "").split(".");
      if (version !== VERSION || !ivValue || !tagValue || !ciphertextValue || extra !== undefined) {
        throw new Error("Encrypted API key payload is invalid.");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextValue, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
  });
}

export function secretProtectorFromEnvironment(env = process.env) {
  const value = env.API_KEY_ENCRYPTION_KEY;
  return typeof value === "string" && value ? createAesSecretProtector(value) : null;
}
