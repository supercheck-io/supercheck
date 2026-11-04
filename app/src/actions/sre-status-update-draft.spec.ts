/** @jest-environment node */
const ids = {
  user: "018f0000-0000-7000-8000-00000000000c",
  org: "018f0000-0000-7000-8000-00000000000a",
  project: "018f0000-0000-7000-8000-00000000000b",
  incident: "018f0000-0000-7000-8000-0000000000d1",
};
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: async () => ({ userId: ids.user, organizationId: ids.org, project: { id: ids.project } }),
}));
const allowed = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: (...a: unknown[]) => allowed(...a) }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn() }) }));
const gate = jest.fn();
jest.mock("@/app/api/sre/_auth", () => ({ requireSreSubscription: (...a: unknown[]) => gate(...a) }));
const rateLimit = jest.fn();
jest.mock("@/lib/sre/sre-rate-limiter", () => ({ checkSreStatusDraftRateLimit: (...a: unknown[]) => rateLimit(...a) }));
const generate = jest.fn();
jest.mock("@/lib/sre/status-update-draft", () => ({ generateStatusUpdateDraft: (...a: unknown[]) => generate(...a) }));
const queue: unknown[][] = [];
jest.mock("@/utils/db", () => ({
  db: {
    select: () => {
      const rows = queue.shift() ?? [];
      const node: Record<string, unknown> = {};
      for (const name of ["from", "leftJoin", "where", "orderBy"]) node[name] = () => node;
      node.limit = () => Promise.resolve(rows);
      return node;
    },
  },
}));

import { draftSreStatusUpdate } from "./sre-status-update-draft";

const incident = { id: ids.incident, incidentNumber: 4, title: "Checkout down", severity: "sev2", status: "investigating", acknowledgedAt: null, serviceName: "checkout" };

beforeEach(() => {
  jest.clearAllMocks();
  queue.length = 0;
  allowed.mockReturnValue(true);
  gate.mockResolvedValue(null);
  rateLimit.mockResolvedValue({ allowed: true });
  generate.mockResolvedValue("We are investigating an issue with checkout.");
});

it("drafts from the incident, its notes and the recovery signal, through the billing gate", async () => {
  queue.push([incident], [
    { type: "comment", data: { text: "db pool exhausted on host-7" } },
    { type: "state_change", data: { state: "recovered" } },
  ]);
  expect(await draftSreStatusUpdate({ incidentId: ids.incident })).toEqual({ success: true, text: "We are investigating an issue with checkout." });
  expect(gate).toHaveBeenCalledWith(ids.org, { allowTrial: false });
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ title: "Checkout down", statusLabel: "Investigating", recovered: true, notes: ["db pool exhausted on host-7"] }), ids.org);
});

it("makes no model call without permission, a paid plan or rate-limit headroom", async () => {
  allowed.mockReturnValue(false);
  expect(await draftSreStatusUpdate({ incidentId: ids.incident })).toMatchObject({ success: false });
  allowed.mockReturnValue(true);
  queue.push([incident]);
  gate.mockResolvedValue({ json: async () => ({ error: "Subscribe to use AI" }) });
  expect(await draftSreStatusUpdate({ incidentId: ids.incident })).toEqual({ success: false, error: "Subscribe to use AI" });
  gate.mockResolvedValue(null);
  queue.push([incident]);
  rateLimit.mockResolvedValue({ allowed: false });
  expect(await draftSreStatusUpdate({ incidentId: ids.incident })).toMatchObject({ success: false, error: expect.stringContaining("Too many") });
  expect(generate).not.toHaveBeenCalled();
});

it("reports a missing incident without calling the model", async () => {
  queue.push([]);
  expect(await draftSreStatusUpdate({ incidentId: ids.incident })).toEqual({ success: false, error: "Incident not found or access denied" });
  expect(generate).not.toHaveBeenCalled();
});
