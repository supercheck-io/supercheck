const redisSet = jest.fn();
const mget = jest.fn();
let redisDown = false;
jest.mock("@/lib/queue", () => ({ getRedisConnection: async () => { if (redisDown) throw new Error("down"); return { set: redisSet, mget }; } }));

import { loadProviderTestHealth, newerHealth, providerHealth, recordProviderTest } from "./health";

const at = new Date("2026-11-14T10:00:00Z");

it("A21: maps the newest delivery to ok, auth_failed, failing or unknown", () => {
  expect(providerHealth({ status: "sent", sentAt: at, responseStatus: 202, terminal: false })).toEqual({ state: "ok", at: at.toISOString() });
  expect(providerHealth({ status: "failed", sentAt: at, responseStatus: 401, terminal: true })).toEqual({ state: "auth_failed", at: at.toISOString() });
  expect(providerHealth({ status: "failed", sentAt: at, responseStatus: 403, terminal: false })).toMatchObject({ state: "auth_failed" });
  expect(providerHealth({ status: "failed", sentAt: at, responseStatus: 503, terminal: false })).toMatchObject({ state: "failing" });
  expect(providerHealth({ status: "failed", sentAt: null, responseStatus: null, terminal: false })).toEqual({ state: "failing", at: null });
  expect(providerHealth({ status: "pending", sentAt: at, responseStatus: null, terminal: false })).toMatchObject({ state: "unknown" });
});

it("records a test outcome for 7 days and reads it back as health", async () => {
  redisDown = false;
  await recordProviderTest("p1", { ok: false, responseStatus: 401 }, at);
  expect(redisSet).toHaveBeenCalledWith("supercheck:notification-test:p1", expect.stringContaining('"responseStatus":401'), "EX", 604800);
  mget.mockResolvedValueOnce([redisSet.mock.calls[0][1], null, "not json"]);
  const health = await loadProviderTestHealth(["p1", "p2", "p3"]);
  expect(health.get("p1")).toEqual({ state: "auth_failed", at: at.toISOString() });
  expect(health.has("p2")).toBe(false);
  expect(health.has("p3")).toBe(false);
});

it("falls back to deliveries without Redis, and picks the newer health", async () => {
  redisDown = true;
  await expect(recordProviderTest("p1", { ok: true })).resolves.toBeUndefined();
  expect((await loadProviderTestHealth(["p1"])).size).toBe(0);
  expect(await loadProviderTestHealth([])).toEqual(new Map());
  const older = { state: "auth_failed" as const, at: "2026-11-14T09:00:00.000Z" };
  const newer = { state: "ok" as const, at: "2026-11-14T10:00:00.000Z" };
  expect(newerHealth(older, newer)).toBe(newer);
  expect(newerHealth(newer, older)).toBe(newer);
  expect(newerHealth(undefined, older)).toBe(older);
  expect(newerHealth(older, undefined)).toBe(older);
});
