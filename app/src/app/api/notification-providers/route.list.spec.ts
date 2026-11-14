/** @jest-environment node */
const PROVIDER = "019a0000-0000-7000-8000-000000000001";
const OTHER = "019a0000-0000-7000-8000-000000000002";
const queue: unknown[][] = [];
const node = (rows: unknown[]) => {
  const n: Record<string, unknown> = {};
  for (const m of ["from", "where", "groupBy", "orderBy"]) n[m] = () => n;
  n.then = (resolve: (v: unknown[]) => unknown) => resolve(rows);
  return n;
};
jest.mock("@/utils/db", () => ({ db: { select: () => node(queue.shift() ?? []), selectDistinctOn: () => node(queue.shift() ?? []) } }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: async () => ({ userId: "u", organizationId: "org-1", orgPendingDeletion: false, project: { id: "proj-1", userRole: "project_viewer" } }),
  isAuthError: () => false,
}));
jest.mock("@/lib/creators", () => ({ loadCreators: async () => () => ({}) }));
jest.mock("@/lib/notification-providers/crypto", () => ({
  decryptNotificationProviderConfig: (config: unknown) => config,
  sanitizeConfigForClient: (_t: unknown, config: unknown) => ({ sanitizedConfig: config, maskedFields: [] }),
}));

import { GET } from "./route";

it("A21: each channel carries its health from the newest delivery; channels without one are unknown", async () => {
  const sentAt = new Date("2026-11-14T10:00:00Z");
  queue.push(
    [{ id: PROVIDER, type: "webhook", config: {}, projectId: "proj-1" }, { id: OTHER, type: "slack", config: {}, projectId: "proj-1" }],
    [],
    [{ provider: PROVIDER, status: "failed", sentAt, responseStatus: 401, terminal: true }],
  );
  const rows = await (await GET()).json();
  expect(rows.find((r: { id: string }) => r.id === PROVIDER).health).toEqual({ state: "auth_failed", at: sentAt.toISOString() });
  expect(rows.find((r: { id: string }) => r.id === OTHER).health).toEqual({ state: "unknown", at: null });
});
