import { decryptConnectorCredential, encryptConnectorCredential, maskConnectorCredential } from "./credential-vault";

const originalKey = process.env.SECRET_ENCRYPTION_KEY;

describe("connector credential vault", () => {
  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  });

  afterAll(() => {
    process.env.SECRET_ENCRYPTION_KEY = originalKey;
  });

  it("encrypts and decrypts connector credentials with connector context", () => {
    const context = { organizationId: "org_1", projectId: "project_1", connectorId: "connector_1" };
    const encrypted = encryptConnectorCredential({ token: "github-token", nested: { password: "secret" } }, context);

    expect(encrypted.encryptedCredential).not.toContain("github-token");
    expect(encrypted.encryptionKeyContext).toBe("sre_connector:org_1:project_1:connector_1");
    expect(decryptConnectorCredential(encrypted.encryptedCredential, context)).toEqual({
      token: "github-token",
      nested: { password: "secret" },
    });
  });

  it("masks connector credentials for display", () => {
    expect(maskConnectorCredential({ token: "github-token", nested: { password: "secret" } })).toEqual({
      token: "gi********en",
      nested: { password: "se***et" },
    });
  });
});
