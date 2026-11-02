import crypto from "node:crypto";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import { statusPageSubscribers } from "@/db/schema";
import { db } from "@/utils/db";
import { deriveSigningKey } from "@/lib/security/secret-crypto";
import { decryptValue, encryptValue } from "@/lib/encryption";

/**
 * Status page subscriber secrets.
 * - Verification tokens are stored only as a SHA-256 hash (never log a raw token).
 * - Unsubscribe links are signed: `<subscriberId>.<signature>`, nothing is stored. The key derives
 *   from SECRET_ENCRYPTION_KEY, so rotating it invalidates previously sent signed unsubscribe links.
 *   Links issued before this scheme use the legacy `unsubscribe_token` column, which is still read
 *   and can be cleared in a later release.
 * - Webhook signing secrets are encrypted with SECRET_ENCRYPTION_KEY; a missing key throws.
 */

const SIGNING_CONTEXT = "status-page-unsubscribe-v1";
const WEBHOOK_SECRET_CONTEXT = "status-page-webhook-secret-v1";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SIGNED_TOKEN = new RegExp(`^(${UUID})\\.([A-Za-z0-9_-]{43})$`, "i");
const LEGACY_TOKEN = /^[a-f0-9]{64}$/i;

export const hashVerificationToken = (token: string) =>
  crypto.createHash("sha256").update(token, "utf8").digest("hex");

const sign = (subscriberId: string) =>
  crypto
    .createHmac("sha256", deriveSigningKey(SIGNING_CONTEXT))
    .update(`unsubscribe:${subscriberId.toLowerCase()}`)
    .digest("base64url");

export const signUnsubscribeToken = (subscriberId: string) =>
  `${subscriberId}.${sign(subscriberId)}`;

/** Subscriber id when the signed token is authentic, otherwise null. */
export function verifyUnsubscribeToken(token: string): string | null {
  const match = SIGNED_TOKEN.exec(token);
  if (!match) return null;
  const given = Buffer.from(match[2]);
  const expected = Buffer.from(sign(match[1]));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected)
    ? match[1].toLowerCase()
    : null;
}

/** Row condition for a signed or legacy unsubscribe token; null when the token is malformed or forged. */
export function unsubscribeTokenCondition(token: string): SQL | null {
  if (LEGACY_TOKEN.test(token)) return eq(statusPageSubscribers.unsubscribeToken, token);
  const id = verifyUnsubscribeToken(token);
  return id ? eq(statusPageSubscribers.id, id) : null;
}

export const isUnsubscribeTokenShape = (token: string) =>
  LEGACY_TOKEN.test(token) || SIGNED_TOKEN.test(token);

export const encryptWebhookSecret = (secret: string) =>
  encryptValue(secret, WEBHOOK_SECRET_CONTEXT);

/**
 * Plaintext signing secret for a subscriber. A legacy plaintext secret is encrypted and cleared on
 * first use.
 */
export async function resolveWebhookSecret(subscriber: {
  id: string;
  webhookSecret: string | null;
  webhookSecretEncrypted: string | null;
}): Promise<string | null> {
  if (subscriber.webhookSecretEncrypted) {
    return decryptValue(subscriber.webhookSecretEncrypted, WEBHOOK_SECRET_CONTEXT);
  }
  if (!subscriber.webhookSecret) return null;
  // Only migrate the value we read: a rotation that lands in between must win.
  await db
    .update(statusPageSubscribers)
    .set({ webhookSecretEncrypted: encryptWebhookSecret(subscriber.webhookSecret), webhookSecret: null })
    .where(
      and(
        eq(statusPageSubscribers.id, subscriber.id),
        eq(statusPageSubscribers.webhookSecret, subscriber.webhookSecret),
        isNull(statusPageSubscribers.webhookSecretEncrypted),
      ),
    );
  return subscriber.webhookSecret;
}
