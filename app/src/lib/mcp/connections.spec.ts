/** @jest-environment node */
import { oauthAccessToken, oauthConsent, oauthRefreshToken } from "@/db/schema";

// A fluent query-builder stand-in: every chained call returns itself and awaiting it yields `result`.
function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit", "for"]) builder[method] = () => builder;
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

let mockRows: unknown[] = [];
let mockConsentRow: unknown[] = [];
const mockDeleted: unknown[] = [];
const mockListProjects = jest.fn();
const mockUpdateWhere = jest.fn();
const mockUpdateSet = jest.fn();

const mockTx = {
  select: () => chain(mockConsentRow),
  delete: (table: unknown) => ({ where: () => { mockDeleted.push(table); return Promise.resolve(); } }),
};
jest.mock("@/utils/db", () => ({
  db: {
    select: () => chain(mockRows),
    update: () => ({ set: (values: unknown) => { mockUpdateSet(values); return { where: (condition: unknown) => mockUpdateWhere(condition) }; } }),
    transaction: async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx),
  },
}));
jest.mock("./connect-project", () => ({ listConnectableProjects: (...a: unknown[]) => mockListProjects(...a) }));

import { PgDialect } from "drizzle-orm/pg-core";
import { McpConnectionNotFoundError, McpConsentScopeRestoreError, listMcpConnections, projectsKeepingBroaderGrant, revokeMcpConnection, verifiedHostForClientId, withMergedConsentScopes } from "./connections";

const row = (over: Record<string, unknown> = {}) => ({
  id: "c1", clientId: "dcr-client", clientName: "My Agent", redirectUris: ["http://127.0.0.1:9000/cb"],
  projectId: "p1", projectName: "Alpha", connectedAt: new Date("2026-10-01T00:00:00Z"),
  lastActiveAt: new Date("2026-10-02T00:00:00Z"), ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRows = [];
  mockConsentRow = [];
  mockDeleted.length = 0;
  mockUpdateWhere.mockResolvedValue(undefined);
  mockListProjects.mockResolvedValue([{ id: "p1" }]);
});

describe("verifiedHostForClientId", () => {
  it.each([
    ["https://agent.example.com/client.json", "agent.example.com"],
    ["https://agent.example.com:8443/c", "agent.example.com:8443"],
    ["xtbgpiwREyXAXdkPuqeMjepuIVFVNuDN", null],
    ["http://agent.example.com/client.json", null],
    ["https://", null],
    ["", null],
  ])("%s -> %p", (clientId, expected) => {
    expect(verifiedHostForClientId(clientId)).toBe(expected);
  });
});

describe("listMcpConnections", () => {
  it("maps a connection with its project, publisher and the hosts it returns to", async () => {
    mockRows = [
      row(),
      row({ id: "c2", clientId: "https://agent.example.com/client.json", clientName: "Agent Co", redirectUris: ["https://agent.example.com/cb", "https://agent.example.com/other", "not a url"] }),
    ];
    const [dcr, cimd] = await listMcpConnections("u1");
    expect(dcr).toEqual({
      id: "c1", clientId: "dcr-client", clientName: "My Agent", verifiedHost: null, redirectHosts: ["127.0.0.1:9000"],
      projectId: "p1", projectName: "Alpha", connectedAt: new Date("2026-10-01T00:00:00Z"), lastActiveAt: new Date("2026-10-02T00:00:00Z"),
    });
    expect(cimd.verifiedHost).toBe("agent.example.com");
    // Hosts are de-duplicated and unparseable entries are dropped.
    expect(cimd.redirectHosts).toEqual(["agent.example.com"]);
  });

  it("cleans a hostile or legacy name, and treats a name that is nothing but invisible characters as unnamed", async () => {
    mockRows = [row({ clientName: "Sup‮ercheck​ Official" }), row({ id: "c2", clientName: "​‮" }), row({ id: "c3", clientName: null })];
    const names = (await listMcpConnections("u1")).map((c) => c.clientName);
    expect(names).toEqual(["Supercheck Official", null, null]);
  });

  it("hides the name of a project the user can no longer see, but still lists the connection", async () => {
    mockRows = [row({ projectId: "p-gone", projectName: "Secret Roadmap" })];
    const [connection] = await listMcpConnections("u1");
    expect(connection.projectId).toBe("p-gone");
    expect(connection.projectName).toBeNull();
  });

  it("has no last-active time for a connection that has never refreshed", async () => {
    mockRows = [row({ lastActiveAt: null })];
    expect((await listMcpConnections("u1"))[0].lastActiveAt).toBeNull();
  });

  it("returns nothing for a user with no connections", async () => {
    await expect(listMcpConnections("u1")).resolves.toEqual([]);
  });
});

describe("projectsKeepingBroaderGrant", () => {
  it("lists only projects whose stored scopes exceed the request", async () => {
    mockRows = [
      { projectId: "p1", scopes: ["mcp:read", "mcp:sre"] },
      { projectId: "p2", scopes: ["mcp:read"] },
      { projectId: null, scopes: ["mcp:sre"] },
    ];
    expect(await projectsKeepingBroaderGrant("u1", "c", ["mcp:read"])).toEqual(["p1"]);
  });
});

describe("revokeMcpConnection", () => {
  it("removes access tokens, then refresh tokens, then the consent, in that order", async () => {
    mockConsentRow = [{ id: "c1", clientId: "dcr-client", referenceId: "p1" }];
    await revokeMcpConnection({ userId: "u1", consentId: "c1" });
    // Access tokens reference their refresh token, so they must go first.
    expect(mockDeleted).toEqual([oauthAccessToken, oauthRefreshToken, oauthConsent]);
  });

  it("also removes a legacy connection that names no project (from before the project was required)", async () => {
    mockConsentRow = [{ id: "c-old", clientId: "dcr-client", referenceId: null }];
    await revokeMcpConnection({ userId: "u1", consentId: "c-old" });
    expect(mockDeleted).toEqual([oauthAccessToken, oauthRefreshToken, oauthConsent]);
  });

  it("refuses a connection that is not the caller's or does not exist, deleting nothing", async () => {
    mockConsentRow = [];
    await expect(revokeMcpConnection({ userId: "u1", consentId: "c-other" })).rejects.toBeInstanceOf(McpConnectionNotFoundError);
    expect(mockDeleted).toEqual([]);
  });

  it("reports a plain, non-leaky error", () => {
    const error = new McpConnectionNotFoundError();
    expect(error.name).toBe("McpConnectionNotFoundError");
    expect(error.message).toBe("Connection not found");
  });
});

describe("withMergedConsentScopes", () => {
  const key = { userId: "u1", clientId: "c", projectId: "p1" };

  it("writes the union of the earlier and approved scopes back onto the row it read", async () => {
    mockRows = [{ id: "consent-1", scopes: ["mcp:read", "mcp:sre"] }];
    const approve = jest.fn().mockResolvedValue({ url: "x" });
    await expect(withMergedConsentScopes(key, ["mcp:read", "mcp:incidents:write"], approve)).resolves.toEqual({ url: "x" });
    // The union is computed in SQL against the live row; the statement carries the earlier and approved scopes.
    const { scopes } = mockUpdateSet.mock.calls[0][0] as { scopes: never };
    const query = new PgDialect().sqlToQuery(scopes);
    expect(query.sql).toContain("unnest");
    expect(query.params).toEqual(["mcp:read", "mcp:sre", "mcp:incidents:write"]);
    expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
  });

  it("leaves a first approval alone, since there is nothing to merge", async () => {
    mockRows = [];
    await expect(withMergedConsentScopes(key, ["mcp:read"], async () => "ok")).resolves.toBe("ok");
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("does not touch the row when the approval itself fails", async () => {
    mockRows = [{ id: "consent-1", scopes: ["mcp:read", "mcp:sre"] }];
    await expect(withMergedConsentScopes(key, ["mcp:read"], async () => { throw new Error("rejected"); })).rejects.toThrow("rejected");
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("reports a failed restore as a distinct error", async () => {
    mockRows = [{ id: "consent-1", scopes: ["mcp:read", "mcp:sre"] }];
    mockUpdateWhere.mockRejectedValue(new Error("db down"));
    const error = await withMergedConsentScopes(key, ["mcp:read"], async () => "ok").catch((e) => e);
    expect(error).toBeInstanceOf(McpConsentScopeRestoreError);
    expect(error.name).toBe("McpConsentScopeRestoreError");
  });
});
