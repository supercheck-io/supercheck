/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), update: jest.fn(), delete: jest.fn(), transaction: jest.fn() } }));
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: jest.fn(async () => ({ userId: "user", organizationId: "org", project: { id: "48926de9-3ee7-59f7-9383-481fc00e98ed" } })), requireUserAuthContext: jest.fn(async () => ({ userId: "user" })), isAuthError: jest.fn(() => false), authErrorStatus: jest.fn(() => 401) }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true), resolveProjectPermissionContext: jest.fn(async () => ({ organizationId: "org", project: { id: "48926de9-3ee7-59f7-9383-481fc00e98ed" } })) }));
jest.mock("@/lib/encryption", () => ({ encryptValue: jest.fn(() => "ciphertext"), decryptValue: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/monitor-secret-usage", () => ({ ...jest.requireActual("@/lib/monitor-secret-usage"), secretInUseMessage: jest.fn(async () => "Secret OLD_KEY is used by monitor Chat. Update those monitors before you change it.") }));
jest.mock("@/lib/s3-proxy", () => ({ getS3Client: jest.fn() }));
import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { secretInUseMessage } from "@/lib/monitor-secret-usage";
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


describe.each(["cli", "project"])("%s variable routes: secret used by a live monitor", (route) => {
  beforeEach(() => {
    if (route === "cli") limit.mockResolvedValueOnce([existing]);
  });

  it("refuses to delete with 409 and the message", async () => {
    const res = await call(route, "DELETE");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("used by monitor Chat");
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("refuses a rename with 409", async () => {
    const res = await call(route, "PUT", { key: "NEW_KEY" });
    expect(res.status).toBe(409);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses making it non-secret, even with a replacement value", async () => {
    const res = await call(route, "PUT", { isSecret: false, value: "plain" });
    expect(res.status).toBe(409);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("still allows rotating the value", async () => {
    const res = await call(route, "PUT", { value: "new-secret" });
    expect(res.status).toBe(200);
    expect(secretInUseMessage).not.toHaveBeenCalled();
  });
});
