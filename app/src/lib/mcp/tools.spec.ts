/** @jest-environment node */
const queue: unknown[] = [];
const calls: unknown[] = [];
function chain(): unknown {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "orderBy", "limit"]) c[m] = (...a: unknown[]) => (calls.push([m, a]), c);
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
    const next = queue.shift();
    return (next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? [])).then(res, rej);
  };
  return c;
}
jest.mock("@/utils/db", () => ({ db: { select: () => chain() } }));
const logAuditEvent = jest.fn();
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: (...a: unknown[]) => logAuditEvent(...a) }));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMcpTools } from "./tools";
import type { McpCallContext } from "./context";

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; structuredContent: Record<string, unknown> }>;
const handlers = new Map<string, Handler>();
const ctx: McpCallContext = { userId: "u", clientId: "c", organizationId: "o", projectId: "p", role: "project_viewer" };

beforeAll(() => {
  const server = { registerTool: (n: string, _c: unknown, h: Handler) => handlers.set(n, h) } as unknown as McpServer;
  registerMcpTools(server, ctx);
});
beforeEach(() => {
  queue.length = 0;
  logAuditEvent.mockClear();
});

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;

describe("MCP tools", () => {
  it("registers the read-only tool set", () => {
    expect([...handlers.keys()].sort()).toEqual(
      ["get_context", "get_incident", "get_run", "get_test", "list_incidents", "list_jobs", "list_monitors", "list_runs", "list_tests", "prepare_local_authoring"].sort(),
    );
  });

  it("paginates with nextCursor and strips the extra row", async () => {
    queue.push([{ id: id(3), title: "c", type: "browser", priority: "low", updatedAt: null }, { id: id(2), title: "b", type: "browser", priority: "low", updatedAt: null }]);
    const res = await handlers.get("list_tests")!({ limit: 1 });
    expect((res.structuredContent.tests as unknown[]).length).toBe(1);
    expect(res.structuredContent.nextCursor).toBe(id(3));
  });

  it("maps a missing record to not_found", async () => {
    queue.push([]);
    const res = await handlers.get("get_test")!({ id: id(1) });
    expect(res).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
  });

  it("redacts run errors and never returns raw database errors", async () => {
    queue.push([{ id: id(1), jobId: null, status: "failed", trigger: "manual", location: null, durationMs: 1, startedAt: null, completedAt: null, errorDetails: "boom postgres://a:b@db/x" }]);
    const run = await handlers.get("get_run")!({ id: id(1) });
    expect(JSON.stringify(run)).not.toContain("a:b@");

    queue.push(new Error("Failed query: select secret_table params: x"));
    const res = await handlers.get("list_jobs")!({ limit: 5 });
    expect(res).toMatchObject({ isError: true, structuredContent: { code: "internal_error" } });
    expect(JSON.stringify(res)).not.toContain("secret_table");
  });

  it("strips credentials, path and query from monitor targets", async () => {
    queue.push([{ id: id(1), name: "m", type: "http_request", target: "https://u:pw@example.com/hook/SECRET?t=1", status: "up", lastCheckAt: null }]);
    const res = await handlers.get("list_monitors")!({ limit: 5 });
    expect(JSON.stringify(res)).not.toMatch(/SECRET|pw|t=1/);
  });

  it("audits ids and timing only, not arguments", async () => {
    queue.push([]);
    await handlers.get("get_test")!({ id: id(9) });
    const event = logAuditEvent.mock.calls[0][0];
    expect(event).toMatchObject({ action: "mcp_tool_call", resource: "get_test", success: false });
    expect(JSON.stringify(event)).not.toContain(id(9));
  });
});
