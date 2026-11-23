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
  requireProjectContext: async () => ({ userId: ids.user, organizationId: ids.org, orgPendingDeletion: false, project: { id: ids.project, userRole: "org_owner" } }),
}));
const permitted = new Set(["sre_incident", "status_page"]);
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: (resource: string) => permitted.has(resource) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn() }) }));
const addIncidentUpdate = jest.fn();
const resolveIncident = jest.fn();
jest.mock("@/lib/sre/incident-lifecycle", () => ({
  MAX_INCIDENT_UPDATE_LENGTH: 2000,
  MAX_RESOLUTION_SUMMARY_LENGTH: 2000,
  addIncidentUpdate: (...a: unknown[]) => addIncidentUpdate(...a),
  resolveIncident: (...a: unknown[]) => resolveIncident(...a),
}));
jest.mock("@/lib/sre/incident-watchers", () => ({}));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({ checkSreIncidentUpdateRateLimit: async () => ({ allowed: true }) }));
// The status page core writes the update and queues subscriber emails; the spec replaces it so nothing is sent.
const updateStatusPageIncident = jest.fn();
const listOpenLinkedStatusPageIncidents = jest.fn();
const publishSreResolutionToStatusPages = jest.fn();
jest.mock("@/lib/status-page-incident-core", () => ({
  ...jest.requireActual("@/lib/status-page-incident-core"),
  updateStatusPageIncident: (...a: unknown[]) => updateStatusPageIncident(...a),
  listOpenLinkedStatusPageIncidents: (...a: unknown[]) => listOpenLinkedStatusPageIncidents(...a),
  publishSreResolutionToStatusPages: (...a: unknown[]) => publishSreResolutionToStatusPages(...a),
}));
jest.mock("@/utils/db", () => ({ db: {} }));

import { addSreIncidentUpdate, resolveSreIncident } from "./sre-incident-lifecycle";

const input = { incidentId: ids.incident, text: "We are investigating elevated errors", postToStatusPage: true };
const page = (n: number, extra: object = {}) => ({ id: `${ids.pageIncident.slice(0, -1)}${n}`, statusPageId: `${ids.page.slice(0, -1)}${n}`, statusPageName: `Page ${n}`, status: "investigating", deliverNotifications: true, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  permitted.clear();
  permitted.add("sre_incident");
  permitted.add("status_page");
  listOpenLinkedStatusPageIncidents.mockResolvedValue([page(1)]);
  addIncidentUpdate.mockResolvedValue({ ok: true, incident: { id: ids.incident } });
  updateStatusPageIncident.mockResolvedValue({ success: true });
});

it("posts the note through the status page path, keeping the page incident's status", async () => {
  expect(await addSreIncidentUpdate(input)).toEqual({ success: true, message: "Update added and posted to the status page" });
  expect(listOpenLinkedStatusPageIncidents).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ids.org, projectId: ids.project }), ids.incident);
  expect(updateStatusPageIncident).toHaveBeenCalledWith(
    expect.objectContaining({ userId: ids.user, organizationId: ids.org }),
    expect.objectContaining({ incidentId: page(1).id, statusPageId: page(1).statusPageId, status: "investigating", body: input.text, deliverNotifications: true }),
    { expectedStatus: "investigating" },
  );
});

it("posts to every open linked page, each with its own notify setting", async () => {
  listOpenLinkedStatusPageIncidents.mockResolvedValue([page(1), page(2, { status: "identified", deliverNotifications: false })]);
  expect(await addSreIncidentUpdate(input)).toEqual({ success: true, message: "Update added and posted to 2 status pages" });
  expect(updateStatusPageIncident).toHaveBeenCalledTimes(2);
  expect(updateStatusPageIncident).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ status: "identified", deliverNotifications: false }), { expectedStatus: "identified" });
});

it("moves every post to the chosen public status, restoring components when it resolves", async () => {
  listOpenLinkedStatusPageIncidents.mockResolvedValue([page(1), page(2, { status: "monitoring" })]);
  await addSreIncidentUpdate({ ...input, statusPageStatus: "resolved" });
  for (const [n, from] of [[1, "investigating"], [2, "monitoring"]] as const) {
    expect(updateStatusPageIncident).toHaveBeenNthCalledWith(n, expect.anything(), expect.objectContaining({ status: "resolved", restoreComponentStatus: true }), { expectedStatus: from });
  }
});

it("only adds the note when the checkbox is not ticked", async () => {
  expect(await addSreIncidentUpdate({ incidentId: ids.incident, text: "internal" })).toEqual({ success: true, message: "Update added" });
  expect(updateStatusPageIncident).not.toHaveBeenCalled();
});

it("refuses before writing anything without status page permission", async () => {
  permitted.delete("status_page");
  expect(await addSreIncidentUpdate(input)).toMatchObject({ success: false, error: expect.stringContaining("status page") });
  expect(addIncidentUpdate).not.toHaveBeenCalled();
  expect(updateStatusPageIncident).not.toHaveBeenCalled();
});

it("refuses before writing anything when no linked public incident is open", async () => {
  listOpenLinkedStatusPageIncidents.mockResolvedValue([]);
  expect(await addSreIncidentUpdate(input)).toMatchObject({ success: false, error: expect.stringContaining("no open status page incident") });
  expect(addIncidentUpdate).not.toHaveBeenCalled();
});

it("keeps the saved note and warns when a status page post fails", async () => {
  updateStatusPageIncident.mockResolvedValue({ success: false, message: "Failed to update incident." });
  expect(await addSreIncidentUpdate(input)).toEqual({
    success: true,
    message: "Update added",
    warning: "The status page post failed. Page 1: Failed to update incident.",
  });
  listOpenLinkedStatusPageIncidents.mockResolvedValue([page(1), page(2)]);
  updateStatusPageIncident.mockReset().mockResolvedValueOnce({ success: true }).mockRejectedValueOnce(new Error("db"));
  expect(await addSreIncidentUpdate(input)).toEqual({
    success: true,
    message: "Update added and posted to the status page",
    warning: "Some status page posts failed. Page 2: try again from the status page",
  });
});

describe("resolveSreIncident", () => {
  const resolved = { ok: true, changed: true, incident: { id: ids.incident, incidentNumber: 7, title: "Errors" } };

  it("publishes the resolution only when asked and only when this call resolved the incident", async () => {
    resolveIncident.mockResolvedValue(resolved);
    publishSreResolutionToStatusPages.mockResolvedValue({ published: ["Page 1", "Page 2"], failed: [], forbidden: false });
    expect(await resolveSreIncident({ incidentId: ids.incident, summary: "Rolled back" })).toEqual({ success: true, message: "Incident #7 resolved" });
    expect(publishSreResolutionToStatusPages).not.toHaveBeenCalled();
    expect(await resolveSreIncident({ incidentId: ids.incident, summary: "Rolled back", publishToStatusPages: true })).toEqual({
      success: true,
      message: "Incident #7 resolved. Resolution posted to Page 1, Page 2",
    });
    expect(publishSreResolutionToStatusPages).toHaveBeenCalledWith(expect.objectContaining({ userId: ids.user }), ids.incident, "Rolled back");
    publishSreResolutionToStatusPages.mockClear();
    resolveIncident.mockResolvedValue({ ...resolved, changed: false });
    await resolveSreIncident({ incidentId: ids.incident, summary: "Rolled back", publishToStatusPages: true });
    expect(publishSreResolutionToStatusPages).not.toHaveBeenCalled();
  });

  it("keeps the resolve and warns when nothing could be published", async () => {
    resolveIncident.mockResolvedValue(resolved);
    publishSreResolutionToStatusPages.mockResolvedValue({ published: [], failed: [], forbidden: true });
    expect(await resolveSreIncident({ incidentId: ids.incident, summary: "x", publishToStatusPages: true })).toEqual({
      success: true,
      message: "Incident #7 resolved",
      warning: "You cannot post to status pages, so nothing was published.",
    });
    publishSreResolutionToStatusPages.mockResolvedValue({ published: ["Page 1"], failed: ["Page 2"], forbidden: false });
    expect(await resolveSreIncident({ incidentId: ids.incident, summary: "x", publishToStatusPages: true })).toMatchObject({
      success: true,
      warning: "The resolution could not be posted to Page 2. Post it from the status page.",
    });
  });
});
