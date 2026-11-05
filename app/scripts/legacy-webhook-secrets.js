const crypto = require("node:crypto");

/**
 * Encrypts legacy plaintext status_page_subscribers.webhook_secret values into webhook_secret_encrypted
 * before migration 0056 drops the plaintext column. Runs inside the migration transaction.
 *
 * The cipher is a port of src/lib/security/secret-crypto.ts + src/lib/encryption.ts (AES-128-GCM, HKDF
 * key per context, `enc:v1:` envelope). Those are TypeScript and cannot be required from this script;
 * legacy-webhook-secrets.spec.js proves the output decrypts with the app's decryptValue.
 */
const WEBHOOK_SECRET_CONTEXT = "status-page-webhook-secret-v1"; // keep equal to subscriber-tokens.ts

function baseKey() {
  const key = process.env.SECRET_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY is missing or shorter than 32 characters. Status page webhook subscribers still " +
        "hold plaintext signing secrets from an earlier release; set the same SECRET_ENCRYPTION_KEY the app " +
        "uses (openssl rand -hex 32 for a new one) and run the migration again."
    );
  }
  const buf = /^[0-9a-fA-F]+$/.test(key) && key.length >= 64 ? Buffer.from(key.slice(0, 64), "hex") : Buffer.from(key, "utf8");
  return buf.subarray(0, 32);
}

function encryptValue(value, context, key = baseKey()) {
  const salt = crypto.createHash("sha256").update(context).digest();
  const derived = Buffer.from(crypto.hkdfSync("sha256", key, salt, Buffer.from("supercheck:secret:v1"), 16));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-128-gcm", derived, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const raw = { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
  const payload = Buffer.from(JSON.stringify(raw), "utf8").toString("base64");
  const envelope = { encrypted: true, version: 1, payload, context };
  return `enc:v1:${Buffer.from(JSON.stringify(envelope), "utf8").toString("base64")}`;
}

/** Returns the number of secrets encrypted. A missing key only fails when there is something to encrypt. */
async function encryptLegacyWebhookSecrets(client, log = () => undefined) {
  const [{ present }] = await client`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'status_page_subscribers' AND column_name = 'webhook_secret'
    ) AS present`;
  if (!present) return 0;
  const rows = await client`
    SELECT id, webhook_secret FROM status_page_subscribers
    WHERE webhook_secret IS NOT NULL AND webhook_secret_encrypted IS NULL`;
  if (rows.length === 0) return 0;
  const key = baseKey();
  for (const { id, webhook_secret: secret } of rows) {
    await client`
      UPDATE status_page_subscribers SET webhook_secret_encrypted = ${encryptValue(secret, WEBHOOK_SECRET_CONTEXT, key)}
      WHERE id = ${id}`;
  }
  log(`Encrypted ${rows.length} legacy status page webhook secret(s)`);
  return rows.length;
}

module.exports = { encryptLegacyWebhookSecrets, encryptValue, WEBHOOK_SECRET_CONTEXT };
