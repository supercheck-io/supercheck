/** @jest-environment node */
process.env.SECRET_ENCRYPTION_KEY = "a".repeat(64);

let mockCredentialRows: unknown[] = [];
let mockLockedRows: unknown[] | null = null; // what FOR UPDATE sees inside the transaction; null = same as the read
let mockTxFails: unknown = null;
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
    transaction: async (fn: (tx: unknown) => unknown) => {
      if (mockTxFails) throw mockTxFails;
      return fn({
        select: () => {
          const chain: Record<string, unknown> = {};
          const rows = () => mockLockedRows ?? (mockCredentialRows.length ? mockCredentialRows : [{ id: "c1" }]);
          for (const m of ["from", "where", "limit"]) chain[m] = () => chain;
          chain.for = async () => rows();
          chain.then = (r: (x: unknown) => unknown) => Promise.resolve(mockCredentialRows).then(r);
          return chain;
        },
        update: mockTxUpdate,
        insert: () => ({ values: async (v: Record<string, unknown>) => void mockInserts.push(v) }),
      });
    },
  },
}));

import { McpEndpointMissingError, resolveMcpEndpointUrl } from "./mcp-endpoint-secret";
import { decryptConnectorCredential, encryptConnectorCredential } from "./credential-vault";

const STAMP = new Date("2026-01-01T00:00:00Z");
const context = { organizationId: "o1", projectId: "p1", connectorId: "c1" };
const row = (endpointUrl: unknown) =>
  ({ id: "c1", organizationId: "o1", projectId: "p1", config: { endpointUrl, tools: [] } }) as never;

beforeEach(() => {
  mockCredentialRows = [];
  mockLockedRows = null;
  mockTxFails = null;
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
    mockCredentialRows = [{ id: "cr1", updatedAt: STAMP, ...encrypted }];
    expect(await resolveMcpEndpointUrl(row("https://mcp.example.com/mcp?…"))).toBe("https://mcp.example.com/mcp?apiKey=s3cret");
    expect(mockUpdates).toHaveLength(0);
  });

  it("fails clearly when the URL is redacted and no credential holds it", async () => {
    await expect(resolveMcpEndpointUrl(row("https://mcp.example.com/mcp?…"))).rejects.toBeInstanceOf(McpEndpointMissingError);
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
    mockCredentialRows = [{ id: "cr1", updatedAt: STAMP, ...encrypted }];
    await resolveMcpEndpointUrl(row("https://mcp.example.com/mcp?apiKey=s3cret"));
    expect(mockInserts).toHaveLength(0);
    expect(mockUpdates.map((u) => u.table)).toEqual(["credentials", "connectors"]);
    const written = mockUpdates.find((u) => u.table === "credentials")!.set.encryptedCredential as string;
    expect(decryptConnectorCredential(written, context)).toEqual({
      token: "t",
      endpointUrl: "https://mcp.example.com/mcp?apiKey=s3cret",
    });
  });

  it("skips the rewrite when a rotation changed the credential since it was read", async () => {
    const encrypted = encryptConnectorCredential({ token: "t" }, context);
    mockCredentialRows = [{ id: "cr1", updatedAt: STAMP, ...encrypted }];
    mockLockedRows = [{ id: "cr1", updatedAt: new Date("2026-01-02T00:00:00Z") }];
    expect(await resolveMcpEndpointUrl(row("https://mcp.example.com/mcp?apiKey=s3cret"))).toBe("https://mcp.example.com/mcp?apiKey=s3cret");
    expect(mockUpdates).toHaveLength(0);
    mockLockedRows = [];
    await resolveMcpEndpointUrl(row("https://mcp.example.com/mcp?apiKey=s3cret"));
    expect(mockUpdates).toHaveLength(0);
  });

  it("never logs a database error message, which echoes the plaintext URL", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockTxFails = Object.assign(new Error("update ... params: https://mcp.example.com/mcp?apiKey=s3cret"), { code: "40P01" });
    expect(await resolveMcpEndpointUrl(row("https://mcp.example.com/mcp?apiKey=s3cret"))).toContain("s3cret");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("s3cret");
    expect(JSON.stringify(spy.mock.calls)).toContain("40P01");
    spy.mockRestore();
  });
});
