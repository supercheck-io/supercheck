/** @jest-environment node */
// A full row, internal columns included: the public output must still carry only the allowlisted fields.
const fullIncident = {
  id: "00000000-0000-4000-8000-000000000002", statusPageId: "00000000-0000-4000-8000-000000000001", name: "Checkout errors",
  status: "investigating", impact: "major", impactOverride: null, body: "Looking", scheduledFor: null, scheduledUntil: null,
  shortlink: null, monitoringAt: null, resolvedAt: null, createdAt: new Date(), updatedAt: new Date(),
  sreIncidentId: "00000000-0000-4000-8000-000000000009", createdByUserId: "u1", deliverNotifications: true, metadata: { internal: true },
  sourceComponentId: "c1", backfilled: false, autoTransitionDeliverNotificationsAtEnd: true,
};
const fullUpdate = { id: "u1", incidentId: fullIncident.id, body: "Looking", status: "investigating", displayAt: new Date(), createdAt: new Date(), createdByUserId: "u1", deliverNotifications: true };
jest.mock("@/utils/db", () => ({
  db: {
    query: {
      statusPages: { findFirst: jest.fn(async () => ({ id: "00000000-0000-4000-8000-000000000001", language: "en" })) },
      incidents: { findFirst: jest.fn(async () => fullIncident), findMany: jest.fn(async () => [{ ...fullIncident, affectedComponents: [{ newStatus: "major_outage", oldStatus: "operational", component: { id: "c1", name: "API", showcase: true } }], updates: [fullUpdate] }]) },
      incidentComponents: { findMany: jest.fn(async () => [{ id: "link", oldStatus: "operational", component: { id: "c1", name: "API", status: "major_outage", showcase: true } }]) },
      incidentUpdates: { findMany: jest.fn(async () => [fullUpdate]) },
    },
  },
}));
jest.mock("@/lib/status-page-incident-intervals", () => ({
  withOpenIntervals: async (rows: object[]) => rows.map((row) => ({ ...row, openIntervals: [] })),
}));
import { getPublicIncidentDetail } from "./get-public-incident-detail";
import { getPublicIncidents } from "./get-public-incidents";

const PUBLIC_INCIDENT_KEYS = ["body", "createdAt", "id", "impact", "impactOverride", "monitoringAt", "name", "resolvedAt", "scheduledFor", "scheduledUntil", "shortlink", "status", "updatedAt"];
const keys = (value: object) => Object.keys(value).sort();

it("returns only the allowlisted fields on the public incident page", async () => {
  const result = await getPublicIncidentDetail(fullIncident.id, fullIncident.statusPageId);
  expect(result.success).toBe(true);
  expect(keys(result.incident!)).toEqual([...PUBLIC_INCIDENT_KEYS, "affectedComponents", "updates"].sort());
  expect(keys(result.incident!.affectedComponents[0])).toEqual(["id", "name", "status"]);
  expect(keys(result.incident!.updates[0])).toEqual(["body", "createdAt", "displayAt", "id", "status"]);
});

it("returns only the allowlisted fields in the public incident list", async () => {
  const result = await getPublicIncidents(fullIncident.statusPageId);
  expect(result.success).toBe(true);
  expect(keys(result.incidents[0])).toEqual([...PUBLIC_INCIDENT_KEYS, "affectedComponents", "affectedComponentsCount", "latestUpdate", "openIntervals"].sort());
  expect(keys(result.incidents[0].affectedComponents[0])).toEqual(["id", "name", "newStatus"]);
  expect(keys(result.incidents[0].latestUpdate!)).toEqual(["body", "createdAt", "displayAt", "id", "status"]);
});
