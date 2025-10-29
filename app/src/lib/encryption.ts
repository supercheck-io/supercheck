import { decryptSecret, encryptSecret, type SecretEnvelope } from "@/lib/security/secret-crypto";
import crypto from "node:crypto";

const ENCRYPTED_PREFIX = "enc:v1:";

function encodeEnvelope(envelope: SecretEnvelope): string {
  const payload = Buffer.from(JSON.stringify(envelope), "utf8").toString(
    "base64"
  );
  return `${ENCRYPTED_PREFIX}${payload}`;
}

function decodeEnvelope(serialized: string): SecretEnvelope {
  const payload = serialized.slice(ENCRYPTED_PREFIX.length);
  const json = Buffer.from(payload, "base64").toString("utf8");
  return JSON.parse(json) as SecretEnvelope;
}

export function encryptValue(value: string, projectId: string): string {
  const envelope = encryptSecret(value, { context: projectId });
  return encodeEnvelope(envelope);
}

export function decryptValue(encryptedValue: string, projectId: string): string {
  if (!encryptedValue.startsWith(ENCRYPTED_PREFIX)) {
    throw new Error("Unsupported encrypted value format");
  }

  const envelope = decodeEnvelope(encryptedValue);
  return decryptSecret(envelope, { context: projectId });
}

export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function validateEncryptionKey(key: string): boolean {
  return typeof key === "string" && key.length >= 32;
}
