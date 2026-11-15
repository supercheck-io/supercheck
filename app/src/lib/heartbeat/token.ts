import crypto from "crypto";
import { hashApiKey } from "@/lib/security/api-key-hash";
import { encryptValue, decryptValue } from "@/lib/encryption";
import { getJobTriggerBaseUrl } from "@/lib/deprecated-env";

/** Heartbeat ping token: `hb_` + 128 random bits as hex. The token is the only secret in the ping URL. */
export const HEARTBEAT_TOKEN_PATTERN = /^hb_[0-9a-f]{32}$/;

export function generateHeartbeatToken(): string {
  return `hb_${crypto.randomBytes(16).toString("hex")}`;
}

export function isHeartbeatTokenFormat(token: string): boolean {
  return HEARTBEAT_TOKEN_PATTERN.test(token);
}

/** SHA-256 hex, same scheme as job trigger keys; unique-indexed for lookup. */
export function hashHeartbeatToken(token: string): string {
  return hashApiKey(token);
}

/** New token plus the two column values that store it (hash for lookup, ciphertext for reveal). */
export function createHeartbeatTokenColumns(projectId: string): {
  token: string;
  heartbeatTokenHash: string;
  heartbeatTokenEncrypted: string;
} {
  const token = generateHeartbeatToken();
  return {
    token,
    heartbeatTokenHash: hashHeartbeatToken(token),
    heartbeatTokenEncrypted: encryptValue(token, projectId),
  };
}

export function decryptHeartbeatToken(encrypted: string, projectId: string): string {
  return decryptValue(encrypted, projectId);
}

/** Public ping URL. Uses the configured public app URL, falling back to the request origin. */
export function buildHeartbeatPingUrl(
  token: string,
  requestOrigin = "",
  env: Record<string, string | undefined> = process.env,
): string {
  return `${getJobTriggerBaseUrl(requestOrigin, env)}/api/heartbeat/${token}`;
}
