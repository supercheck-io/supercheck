/** @jest-environment node */
process.env.SECRET_ENCRYPTION_KEY = "a".repeat(64);

const mockInserted: Array<Record<string, unknown>> = [];
let mockSelectRows: unknown[] = [];
const mockConnectorUpdates: Array<Record<string, unknown>> = [];
let mockConnector: unknown;
jest.mock("server-only", () => ({}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({ userId: "u1", organizationId: "o1", project: { id: "p1", userRole: "org_owner" } })),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/utils/db", () => {
  const tx = {
    delete: () => ({ where: async () => undefined }),
    update: () => ({ set: (v: Record<string, unknown>) => (mockConnectorUpdates.push(v), { where: async () => undefined }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        mockInserted.push(v);
        const result = [{ id: "c1", ...v }];
        return { returning: async () => result, then: (r: (x: unknown) => unknown) => Promise.resolve(undefined).then(r) };
      },
    }),
  };
  return {
    db: {
      query: {
        privateAgents: { findFirst: jest.fn(async () => ({ id: "a1", status: "online", supportsSreConnectors: true })) },
        externalConnectors: { findFirst: jest.fn(async () => mockConnector) },
      },
      select: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["from", "leftJoin", "where", "orderBy", "limit"]) chain[m] = () => chain;
        chain.then = (r: (x: unknown) => unknown) => Promise.resolve(mockSelectRows).then(r);
        return chain;
      },
      transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { createSreConnector, rotateSreConnectorCredential } from "./sre-connectors";
import { encryptConnectorCredential } from "@/lib/sre/connectors";
import { decryptConnectorCredential } from "@/lib/sre/connectors";

const base = {
  name: "Hosted MCP",
  type: "mcp" as const,
  serviceIds: [],
  riskLevel: "low" as const,
  privateAgentId: "018f0000-0000-7000-8000-000000000009",
  defaultTimeWindowMinutes: 60,
  outputLimits: { maxRows: 100, maxBytes: 1_048_576, maxSeconds: 10 },
};

beforeEach(() => {
  mockInserted.length = 0;
  mockConnectorUpdates.length = 0;
  mockSelectRows = [];
});

it("keeps a key in an MCP endpoint query only in the encrypted credential", async () => {
  const result = await createSreConnector({ ...base, endpointUrl: "https://mcp.example.com/mcp?apiKey=s3cret" });
  expect(result).toMatchObject({ success: true });

  const connectorRow = mockInserted.find((row) => "config" in row) as { config: { endpointUrl: string } };
  const credentialRow = mockInserted.find((row) => "encryptedCredential" in row) as { encryptedCredential: string };
  expect(connectorRow.config.endpointUrl).toBe("https://mcp.example.com/mcp?…");
  expect(JSON.stringify(mockInserted.filter((row) => row !== credentialRow))).not.toContain("s3cret");
  expect(credentialRow.encryptedCredential).not.toContain("s3cret");
  expect(
    decryptConnectorCredential(credentialRow.encryptedCredential, { organizationId: "o1", projectId: "p1", connectorId: "c1" }),
  ).toEqual({ endpointUrl: "https://mcp.example.com/mcp?apiKey=s3cret" });
});

it("merges the URL into a supplied credential and stores a plain URL as before", async () => {
  await createSreConnector({
    ...base,
    endpointUrl: "https://mcp.example.com/mcp?apiKey=s3cret",
    credential: { credentialType: "bearer_token", value: { token: "t0k" } },
  });
  const credentialRow = mockInserted.find((row) => "encryptedCredential" in row) as { encryptedCredential: string; credentialType: string };
  expect(credentialRow.credentialType).toBe("bearer_token");
  expect(
    decryptConnectorCredential(credentialRow.encryptedCredential, { organizationId: "o1", projectId: "p1", connectorId: "c1" }),
  ).toEqual({ token: "t0k", endpointUrl: "https://mcp.example.com/mcp?apiKey=s3cret" });

  mockInserted.length = 0;
  await createSreConnector({ ...base, endpointUrl: "https://mcp.example.com/mcp" });
  expect(mockInserted.some((row) => "encryptedCredential" in row)).toBe(false);
  expect((mockInserted.find((row) => "config" in row) as { config: unknown }).config).toEqual({ endpointUrl: "https://mcp.example.com/mcp" });
});

it("keeps the encrypted endpoint URL when the credential is rotated", async () => {
  const context = { organizationId: "o1", projectId: "p1", connectorId: "018f0000-0000-7000-8000-0000000000c1" };
  mockConnector = {
    id: context.connectorId, organizationId: "o1", projectId: "p1", type: "mcp", status: "configured",
    config: { endpointUrl: "https://mcp.example.com/mcp?…" },
  };
  mockSelectRows = [{ id: "cr1", ...encryptConnectorCredential({ token: "old", endpointUrl: "https://mcp.example.com/mcp?apiKey=s3cret" }, context) }];

  await rotateSreConnectorCredential({ id: context.connectorId, credentialType: "bearer_token", value: { token: "new" } });

  const credentialRow = mockInserted.find((row) => "encryptedCredential" in row) as { encryptedCredential: string };
  expect(decryptConnectorCredential(credentialRow.encryptedCredential, context)).toEqual({
    token: "new",
    endpointUrl: "https://mcp.example.com/mcp?apiKey=s3cret",
  });
  expect(mockConnectorUpdates.find((u) => "config" in u)).toMatchObject({ config: { endpointUrl: "https://mcp.example.com/mcp?…" } });
});
