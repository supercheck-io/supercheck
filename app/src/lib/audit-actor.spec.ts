/** @jest-environment node */
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers({ cookie: "session=test" })) }));
jest.mock("./session-cache", () => ({ getCachedAuthSession: jest.fn() }));
import { getAuditActor } from "./audit-actor";
import { getCachedAuthSession } from "./session-cache";
it("attributes impersonated actions to the administrator without changing background actors", async () => {
  jest.mocked(getCachedAuthSession).mockResolvedValue({ user: { id: "target" }, session: { impersonatedBy: "admin" } } as never);
  expect(await getAuditActor("target")).toEqual({ actorUserId: "admin", impersonatedBy: "admin" });
  expect(await getAuditActor("other")).toEqual({ actorUserId: "other" });
});
it("keeps events when request context is unavailable", async () => {
  jest.mocked(getCachedAuthSession).mockRejectedValue(new Error("No request"));
  expect(await getAuditActor("worker")).toEqual({ actorUserId: "worker" });
});
