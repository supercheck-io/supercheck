import { encryptLegacyWebhookSecrets } from "../../scripts/legacy-webhook-secrets.js";
import { resolveWebhookSecret } from "./subscriber-tokens";

// The migration script ports the app cipher; this proves its output decrypts with the app's own code,
// for both a hex key and a free-form key (the two key paths in secret-crypto getBaseKey).
describe("migration script cipher matches the app", () => {
  const prev = process.env.SECRET_ENCRYPTION_KEY;
  afterEach(() => { process.env.SECRET_ENCRYPTION_KEY = prev; });

  it.each(["a1".repeat(32), "plain-text-secret-encryption-key-0123456789"])("round-trips with key %s", async (key) => {
    process.env.SECRET_ENCRYPTION_KEY = key;
    const written: string[] = [];
    const client: any = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("information_schema")) return [{ present: true }];
      if (sql.includes("SELECT id")) return [{ id: "a", webhook_secret: "whsec_original" }];
      written.push(values[0] as string);
      return [];
    };
    await encryptLegacyWebhookSecrets(client);
    expect(resolveWebhookSecret({ webhookSecretEncrypted: written[0] })).toBe("whsec_original");
  });
});
