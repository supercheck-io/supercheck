import { providerHealth } from "./health";

const at = new Date("2026-11-14T10:00:00Z");

it("A21: maps the newest delivery to ok, auth_failed, failing or unknown", () => {
  expect(providerHealth({ status: "sent", sentAt: at, responseStatus: 202, terminal: false })).toEqual({ state: "ok", at: at.toISOString() });
  expect(providerHealth({ status: "failed", sentAt: at, responseStatus: 401, terminal: true })).toEqual({ state: "auth_failed", at: at.toISOString() });
  expect(providerHealth({ status: "failed", sentAt: at, responseStatus: 403, terminal: false })).toMatchObject({ state: "auth_failed" });
  expect(providerHealth({ status: "failed", sentAt: at, responseStatus: 503, terminal: false })).toMatchObject({ state: "failing" });
  expect(providerHealth({ status: "failed", sentAt: null, responseStatus: null, terminal: false })).toEqual({ state: "failing", at: null });
  expect(providerHealth({ status: "pending", sentAt: at, responseStatus: null, terminal: false })).toMatchObject({ state: "unknown" });
});
