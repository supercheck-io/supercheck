/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), update: jest.fn() } }));
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: jest.fn(async () => ({ userId: "user", organizationId: "org", project: { id: "48926de9-3ee7-59f7-9383-481fc00e98ed" } })), requireUserAuthContext: jest.fn(async () => ({ userId: "user" })), isAuthError: jest.fn(() => false) }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true), resolveProjectPermissionContext: jest.fn(async () => ({ organizationId: "org", project: { id: "48926de9-3ee7-59f7-9383-481fc00e98ed" } })) }));
jest.mock("@/lib/encryption", () => ({ encryptValue: jest.fn(), decryptValue: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { PUT as cliUpdate } from "./[id]/route";
import { PUT as projectUpdate } from "../projects/[id]/variables/[variableId]/route";
const existing = { id: "c7b6588d-e2cd-51ff-a46f-7d74c0ecb83a", projectId: "48926de9-3ee7-59f7-9383-481fc00e98ed", key: "SECRET", value: "[ENCRYPTED]", encryptedValue: "ciphertext", isSecret: true, type: "secret" };
const set = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  const rows = [existing];
  const select = { from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue(rows), then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  jest.mocked(db.select).mockReturnValue(select as never);
  set.mockImplementation((values) => ({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{ ...existing, ...values }]) }) }));
  jest.mocked(db.update).mockReturnValue({ set } as never);
});
it.each(["cli", "project"])("requires replacement for %s secret-to-plaintext conversion", async (route) => {
  const request = new NextRequest("http://localhost/api/variables/variable", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ isSecret: false }) });
  const response = route === "cli" ? await cliUpdate(request, { params: Promise.resolve({ id: "c7b6588d-e2cd-51ff-a46f-7d74c0ecb83a" }) }) : await projectUpdate(request, { params: Promise.resolve({ id: "48926de9-3ee7-59f7-9383-481fc00e98ed", variableId: "c7b6588d-e2cd-51ff-a46f-7d74c0ecb83a" }) });
  expect(response.status).toBe(400);
  expect(set).not.toHaveBeenCalled();
});
it.each(["cli", "project"])("keeps explicit replacement supported for %s callers", async (route) => {
  const request = new NextRequest("http://localhost/api/variables/variable", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ isSecret: false, value: "new-public-value" }) });
  const response = route === "cli" ? await cliUpdate(request, { params: Promise.resolve({ id: "c7b6588d-e2cd-51ff-a46f-7d74c0ecb83a" }) }) : await projectUpdate(request, { params: Promise.resolve({ id: "48926de9-3ee7-59f7-9383-481fc00e98ed", variableId: "c7b6588d-e2cd-51ff-a46f-7d74c0ecb83a" }) });
  expect(response.status).toBe(200);
  expect(set).toHaveBeenCalledWith(expect.objectContaining({ value: "new-public-value", encryptedValue: null, isSecret: false }));
});
