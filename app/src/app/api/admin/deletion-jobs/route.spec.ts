/** @jest-environment node */
import { NextRequest } from "next/server";

class Denied extends Error {}
const mockRequireAdmin = jest.fn();
const mockRetry = jest.fn();
const mockTrigger = jest.fn();
const mockRows = jest.fn();
jest.mock("@/lib/admin", () => ({ requireAdmin: (...a: unknown[]) => mockRequireAdmin(...a) }));
jest.mock("@/lib/admin-errors", () => ({ adminDeniedResponse: (e: unknown) => (e instanceof Denied ? new Response(null, { status: 403 }) : null) }));
jest.mock("@/lib/session", () => ({ getCurrentUser: async () => ({ id: "admin-1" }) }));
jest.mock("@/lib/audit-logger", () => ({ logAdminEvent: jest.fn() }));
jest.mock("@/lib/deletion/jobs", () => ({ retryFailedDeletion: (...a: unknown[]) => mockRetry(...a) }));
jest.mock("@/lib/deletion/queue", () => ({ triggerDeletion: (...a: unknown[]) => mockTrigger(...a) }));
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => mockRows() }) }) }) }), transaction: async (cb: (tx: object) => unknown) => cb({}) } }));
import { GET, POST } from "./route";

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/admin/deletion-jobs", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => { jest.clearAllMocks(); mockRequireAdmin.mockResolvedValue(undefined); mockRows.mockResolvedValue([]); });

it("denies non-admins on list and retry", async () => {
  mockRequireAdmin.mockRejectedValue(new Denied());
  expect((await GET()).status).toBe(403);
  expect((await post({ id: "00000000-0000-4000-8000-000000000001" })).status).toBe(403);
  expect(mockRetry).not.toHaveBeenCalled();
});

it("lists unfinished purges for a super admin", async () => {
  mockRows.mockResolvedValue([{ id: "x" }]);
  expect(await (await GET()).json()).toEqual({ data: [{ id: "x" }] });
});

it("rejects a malformed id, and a job that is not failed", async () => {
  expect((await post({ id: "nope" })).status).toBe(400);
  mockRetry.mockResolvedValue(false);
  expect((await post({ id: "00000000-0000-4000-8000-000000000001" })).status).toBe(409);
  expect(mockTrigger).not.toHaveBeenCalled();
});

it("retries a failed purge and triggers it", async () => {
  mockRetry.mockResolvedValue(true);
  expect((await post({ id: "00000000-0000-4000-8000-000000000001" })).status).toBe(200);
  expect(mockTrigger).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
});
