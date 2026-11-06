/** @jest-environment node */
const ids = {
  user: "018f0000-0000-7000-8000-00000000000c",
  org: "018f0000-0000-7000-8000-00000000000a",
  project: "018f0000-0000-7000-8000-00000000000b",
  incident: "018f0000-0000-7000-8000-0000000000d1",
  page: "018f0000-0000-7000-8000-0000000000e1",
  pageIncident: "018f0000-0000-7000-8000-0000000000e2",
};
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: async () => ({ userId: ids.user, organizationId: ids.org, project: { id: ids.project } }),
}));
const permitted = new Set(["sre_incident", "status_page"]);
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: (resource: string) => permitted.has(resource) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn() }) }));
const addIncidentUpdate = jest.fn();
jest.mock("@/lib/sre/incident-lifecycle", () => ({
  MAX_INCIDENT_UPDATE_LENGTH: 2000,
  MAX_RESOLUTION_SUMMARY_LENGTH: 2000,
  addIncidentUpdate: (...a: unknown[]) => addIncidentUpdate(...a),
}));
jest.mock("@/lib/sre/incident-watchers", () => ({}));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({ checkSreIncidentUpdateRateLimit: async () => ({ allowed: true }) }));
// The status page action writes the update and queues subscriber emails; the spec replaces it so nothing is sent.
const updateIncidentStatus = jest.fn();
jest.mock("@/actions/update-incident-status", () => ({ updateIncidentStatus: (...a: unknown[]) => updateIncidentStatus(...a) }));
let linkedRows: unknown[] = [];
jest.mock("@/utils/db", () => ({
  db: {
    select: () => {
      const node: Record<string, unknown> = {};
      for (const name of ["from", "innerJoin", "where"]) node[name] = () => node;
      node.limit = () => Promise.resolve(linkedRows);
      return node;
    },
  },
}));

import { addSreIncidentUpdate } from "./sre-incident-lifecycle";

const input = { incidentId: ids.incident, text: "We are investigating elevated errors", postToStatusPage: true };

beforeEach(() => {
  jest.clearAllMocks();
  permitted.clear();
  permitted.add("sre_incident");
  permitted.add("status_page");
  linkedRows = [{ id: ids.pageIncident, statusPageId: ids.page, status: "investigating" }];
  addIncidentUpdate.mockResolvedValue({ ok: true, incident: { id: ids.incident } });
  updateIncidentStatus.mockResolvedValue({ success: true });
});

it("posts the note through the status page path, keeping the page incident's status", async () => {
  expect(await addSreIncidentUpdate(input)).toEqual({ success: true, message: "Update added and posted to the status page" });
  expect(updateIncidentStatus).toHaveBeenCalledWith(
    expect.objectContaining({ incidentId: ids.pageIncident, statusPageId: ids.page, status: "investigating", body: input.text, deliverNotifications: true }),
    { expectedStatus: "investigating" },
  );
});

it("only adds the note when the checkbox is not ticked", async () => {
  expect(await addSreIncidentUpdate({ incidentId: ids.incident, text: "internal" })).toEqual({ success: true, message: "Update added" });
  expect(updateIncidentStatus).not.toHaveBeenCalled();
});

it("refuses before writing anything without status page permission", async () => {
  permitted.delete("status_page");
  expect(await addSreIncidentUpdate(input)).toMatchObject({ success: false, error: expect.stringContaining("status page") });
  expect(addIncidentUpdate).not.toHaveBeenCalled();
  expect(updateIncidentStatus).not.toHaveBeenCalled();
});

it.each([
  ["no linked status page incident", []],
  ["a resolved status page incident", [{ id: ids.pageIncident, statusPageId: ids.page, status: "resolved" }]],
  ["scheduled maintenance", [{ id: ids.pageIncident, statusPageId: ids.page, status: "scheduled" }]],
])("refuses before writing anything for %s", async (_name, rows) => {
  linkedRows = rows;
  expect(await addSreIncidentUpdate(input)).toMatchObject({ success: false, error: expect.stringContaining("no open status page incident") });
  expect(addIncidentUpdate).not.toHaveBeenCalled();
});

it("keeps the saved note and warns when the status page post fails", async () => {
  updateIncidentStatus.mockResolvedValue({ success: false, message: "Failed to update incident." });
  expect(await addSreIncidentUpdate(input)).toEqual({
    success: true,
    message: "Update added",
    warning: "The status page post failed: Failed to update incident.",
  });
});
