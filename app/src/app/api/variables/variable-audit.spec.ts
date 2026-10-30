/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), update: jest.fn(), delete: jest.fn(), transaction: jest.fn() } }));
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: jest.fn(async () => ({ userId: "user", organizationId: "org", project: { id: "48926de9-3ee7-59f7-9383-481fc00e98ed" } })), requireUserAuthContext: jest.fn(async () => ({ userId: "user" })), isAuthError: jest.fn(() => false), authErrorStatus: jest.fn(() => 401) }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true), resolveProjectPermissionContext: jest.fn(async () => ({ organizationId: "org", project: { id: "48926de9-3ee7-59f7-9383-481fc00e98ed" } })) }));
jest.mock("@/lib/encryption", () => ({ encryptValue: jest.fn(() => "ciphertext"), decryptValue: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/s3-proxy", () => ({ getS3Client: jest.fn() }));
import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { logAuditEvent } from "@/lib/audit-logger";
import { PUT as cliUpdate, DELETE as cliDelete } from "./[id]/route";
import { PUT as projectUpdate, DELETE as projectDelete } from "../projects/[id]/variables/[variableId]/route";

const PID = "48926de9-3ee7-59f7-9383-481fc00e98ed";
const VID = "c7b6588d-e2cd-51ff-a46f-7d74c0ecb83a";
const existing = { id: VID, projectId: PID, key: "OLD_KEY", value: "[ENCRYPTED]", encryptedValue: "c", isSecret: true, type: "secret" };
const set = jest.fn();
const req = (method: string, body?: unknown) => new NextRequest("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const call = (route: string, kind: "PUT" | "DELETE", body?: unknown) => {
  if (route === "cli") {
    return kind === "PUT" ? cliUpdate(req("PUT", body), { params: Promise.resolve({ id: VID }) }) : cliDelete(req("DELETE"), { params: Promise.resolve({ id: VID }) });
  }
  const params = { params: Promise.resolve({ id: PID, variableId: VID }) };
  return kind === "PUT" ? projectUpdate(req("PUT", body), params) : projectDelete(req("DELETE"), params);
};
let limit: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  // CLI route loads the row via limit(1); the project route awaits the query directly.
  limit = jest.fn().mockResolvedValue([]);
  const select = { from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: limit, then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([existing]).then(resolve) };
  jest.mocked(db.select).mockReturnValue(select as never);
  set.mockImplementation((values) => ({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{ ...existing, ...values }]) }) }));
  jest.mocked(db.update).mockReturnValue({ set } as never);
  jest.mocked(db.transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(db)) as never);
  jest.mocked(db.delete).mockReturnValue({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{ id: VID }]) }) } as never);
});

describe.each(["cli", "project"])("%s variable routes", (route) => {
  beforeEach(() => {
    if (route === "cli") limit.mockResolvedValueOnce([existing]);
  });

  it("audits a rename without recording values", async () => {
    const res = await call(route, "PUT", { key: "NEW_KEY", value: "super-secret-value" });
    expect(res.status).toBe(200);
    const event = jest.mocked(logAuditEvent).mock.calls[0][0];
    expect(event).toMatchObject({ action: "variable_updated", resource: "project_variable", resourceId: VID, metadata: { projectId: PID, key: "NEW_KEY", isSecret: true, previousKey: "OLD_KEY" } });
    expect(JSON.stringify(event)).not.toContain("super-secret-value");
  });

  it("audits delete", async () => {
    const res = await call(route, "DELETE");
    expect(res.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "variable_deleted", metadata: { projectId: PID, key: "OLD_KEY", isSecret: true } }), db, { strict: true });
  });

  it("returns 404 and no audit when the delete removes no row", async () => {
    jest.mocked(db.delete).mockReturnValue({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([]) }) } as never);
    const res = await call(route, "DELETE");
    expect(res.status).toBe(404);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("passes the transaction and strict mode to the audit write", async () => {
    await call(route, "PUT", { key: "NEW_KEY" });
    expect(jest.mocked(logAuditEvent).mock.calls[0][1]).toBe(db);
    expect(jest.mocked(logAuditEvent).mock.calls[0][2]).toEqual({ strict: true });
  });

  it("maps a wrapped unique violation (error.cause) to 400/409", async () => {
    set.mockImplementation(() => ({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockRejectedValue({ cause: { code: "23505" } }) }) }));
    const res = await call(route, "PUT", { key: "NEW_KEY" });
    expect(res.status).toBe(route === "cli" ? 409 : 400);
  });

  it("maps a unique violation on update to 400", async () => {
    set.mockImplementation(() => ({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockRejectedValue({ code: "23505" }) }) }));
    const res = await call(route, "PUT", { key: "NEW_KEY" });
    expect(res.status).toBe(route === "cli" ? 409 : 400);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
