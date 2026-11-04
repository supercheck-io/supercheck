/** @jest-environment node */
process.env.SECRET_ENCRYPTION_KEY = "a".repeat(64);

let mockCredentialRows: unknown[] = [];
const mockUpdates: Array<{ table: string; set: Record<string, unknown> }> = [];
const mockInserts: Array<Record<string, unknown>> = [];
const mockTxUpdate = (table: { name?: string }) => ({
  set: (set: Record<string, unknown>) => {
    mockUpdates.push({ table: table.name ?? "?", set });
    return { where: async () => undefined };
  },
});
jest.mock("@/db/schema", () => ({
  externalConnectorCredentials: { name: "credentials", connectorId: "c", updatedAt: "u", id: "i" },
  externalConnectors: { name: "connectors", id: "i", config: "cfg" },
}));
jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => mockCredentialRows }) }) }) }),
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        update: mockTxUpdate,
        insert: () => ({ values: async (v: Record<string, unknown>) => void mockInserts.push(v) }),
      }),
  },
}));

import { resolveMcpEndpointUrl } from "./mcp-endpoint-secret";
import { encryptConnectorCredential } from "./credential-vault";

const context = { organizationId: "o1", projectId: "p1", connectorId: "c1" };
const row = (endpointUrl: unknown) =>
  ({ id: "c1", organizationId: "o1", projectId: "p1", config: { endpointUrl, tools: [] } }) as never;

beforeEach(() => {
  mockCredentialRows = [];
  mockUpdates.length = 0;
  mockInserts.length = 0;
});

describe("resolveMcpEndpointUrl", () => {
  it("returns a URL without a query as stored, without touching the database", async () => {
    expect(await resolveMcpEndpointUrl(row("https://mcp.internal/mcp"))).toBe("https://mcp.internal/mcp");
    expect(await resolveMcpEndpointUrl(row(undefined))).toBeNull();
    expect(mockUpdates).toHaveLength(0);
  });

  it("returns the full URL from the encrypted credential when config holds the redacted one", async () => {
    const encrypted = encryptConnectorCredential({ token: "t", endpointUrl: "https://mcp.example.com/mcp?apiKey=s3cret" }, context);
    mockCredentialRows = [{ id: "cr1", ...encrypted }];
    expect(await resolveMcpEndpointUrl(row("https://mcp.example.com/mcp?…"))).toBe("https://mcp.example.com/mcp?apiKey=s3cret");
    expect(mockUpdates).toHaveLength(0);
  });

  it("fails clearly when the URL is redacted and no credential holds it", async () => {
    await expect(resolveMcpEndpointUrl(row("https://mcp.example.com/mcp?…"))).rejects.toThrow(/not stored/);
  });

  it("keeps a legacy row working and moves its URL into the credential and out of config", async () => {
    const legacy = "https://mcp.example.com/mcp?apiKey=s3cret";
    expect(await resolveMcpEndpointUrl(row(legacy))).toBe(legacy);
    expect(mockInserts).toHaveLength(1);
    expect(String(mockInserts[0].encryptedCredential)).not.toContain("s3cret");
    expect(mockUpdates).toEqual([
      { table: "connectors", set: expect.objectContaining({ config: { endpointUrl: "https://mcp.example.com/mcp?…", tools: [] } }) },
    ]);
  });

  it("re-encrypts an existing credential blob with the URL for a legacy row", async () => {
    const encrypted = encryptConnectorCredential({ token: "t" }, context);
    mockCredentialRows = [{ id: "cr1", ...encrypted }];
    await resolveMcpEndpointUrl(row("https://mcp.example.com/mcp?apiKey=s3cret"));
    expect(mockInserts).toHaveLength(0);
    expect(mockUpdates.map((u) => u.table)).toEqual(["credentials", "connectors"]);
  });
});
