const { encryptLegacyWebhookSecrets } = require("./legacy-webhook-secrets.js");

describe("encryptLegacyWebhookSecrets", () => {
  const prev = process.env.SECRET_ENCRYPTION_KEY;
  afterEach(() => {
    if (prev === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
    else process.env.SECRET_ENCRYPTION_KEY = prev;
  });

  // The tagged-template client: first call checks the column, second lists rows, the rest update.
  const fakeClient = (rows, columnPresent = true) => {
    const calls = [];
    const client = jest.fn(async (strings, ...values) => {
      const sql = strings.join("?");
      calls.push({ sql, values });
      if (sql.includes("information_schema")) return [{ present: columnPresent }];
      if (sql.includes("SELECT id")) return rows;
      return [];
    });
    client.calls = calls;
    return client;
  };

  it("is a no-op when the plaintext column is already gone", async () => {
    const client = fakeClient([], false);
    await expect(encryptLegacyWebhookSecrets(client)).resolves.toBe(0);
    expect(client).toHaveBeenCalledTimes(1);
  });

  it("does not need a key when there is nothing to encrypt", async () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    await expect(encryptLegacyWebhookSecrets(fakeClient([]))).resolves.toBe(0);
  });

  it("fails with an actionable message when rows need encrypting and the key is missing", async () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    await expect(encryptLegacyWebhookSecrets(fakeClient([{ id: "a", webhook_secret: "s" }]))).rejects.toThrow(
      /SECRET_ENCRYPTION_KEY.*openssl rand -hex 32/s
    );
  });

  it("writes one ciphertext per row", async () => {
    process.env.SECRET_ENCRYPTION_KEY = "k".repeat(40);
    const client = fakeClient([{ id: "a", webhook_secret: "s1" }, { id: "b", webhook_secret: "s2" }]);
    await expect(encryptLegacyWebhookSecrets(client)).resolves.toBe(2);
    const updates = client.calls.filter((c) => c.sql.includes("UPDATE"));
    expect(updates).toHaveLength(2);
    expect(updates[0].values[0]).toMatch(/^enc:v1:/);
    expect(updates[0].values[1]).toBe("a");
  });

  it("only overwrites rows that still have no ciphertext, so a concurrent rotation is kept", async () => {
    process.env.SECRET_ENCRYPTION_KEY = "k".repeat(40);
    const client = fakeClient([{ id: "a", webhook_secret: "s1" }]);
    await encryptLegacyWebhookSecrets(client);
    expect(client.calls.find((c) => c.sql.includes("UPDATE")).sql).toMatch(/AND webhook_secret_encrypted IS NULL/);
  });

  describe("placeholder keys", () => {
    const env = { NODE_ENV: process.env.NODE_ENV, SELF_HOSTED: process.env.SELF_HOSTED };
    afterEach(() => {
      for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
    const rows = () => fakeClient([{ id: "a", webhook_secret: "s" }]);

    it("rejects a placeholder key in cloud production so the upgrade rolls back", async () => {
      process.env.SECRET_ENCRYPTION_KEY = "change_this_to_a_real_key_0123456789";
      process.env.NODE_ENV = "production";
      delete process.env.SELF_HOSTED;
      await expect(encryptLegacyWebhookSecrets(rows())).rejects.toThrow(/placeholder/);
    });

    it("accepts it for self-hosted installs, matching the app", async () => {
      process.env.SECRET_ENCRYPTION_KEY = "change-this-to-a-real-key-0123456789";
      process.env.NODE_ENV = "production";
      process.env.SELF_HOSTED = "true";
      await expect(encryptLegacyWebhookSecrets(rows())).resolves.toBe(1);
    });
  });
});
