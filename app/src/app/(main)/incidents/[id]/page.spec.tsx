import { generateMetadata } from "./page";

const requireSreApiPermissions = jest.fn();
const limit = jest.fn();
const where = jest.fn(() => ({ limit }));
jest.mock("@/app/api/sre/_auth", () => ({ requireSreApiPermissions: (...args: unknown[]) => requireSreApiPermissions(...args) }));
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where }) }) } }));
jest.mock("@/components/sre/incidents/sre-incident-detail-page-client", () => ({ SreIncidentDetailPageClient: () => null }));
jest.mock("@/components/page-breadcrumbs", () => ({ PageBreadcrumbs: () => null }));

const ID = "4f8a2c1e-9b3d-4e5f-8a7b-1c2d3e4f5a6b";
const meta = (id = ID) => generateMetadata({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  requireSreApiPermissions.mockResolvedValue({ success: true, context: { organizationId: "org", project: { id: "proj" } } });
});

it("uses the incident title", async () => {
  limit.mockResolvedValue([{ title: "Checkout API down" }]);
  await expect(meta()).resolves.toEqual({ title: "Checkout API down | Supercheck" });
  expect(requireSreApiPermissions).toHaveBeenCalledWith([{ resource: "sre_incident", action: "view" }]);
});

it("falls back without revealing the title when access is denied", async () => {
  requireSreApiPermissions.mockResolvedValue({ success: false, response: {} });
  await expect(meta()).resolves.toEqual({ title: "Incident | Supercheck" });
  expect(where).not.toHaveBeenCalled();
});

it("falls back for an incident outside the current project, a bad id or a failed query", async () => {
  limit.mockResolvedValue([]);
  await expect(meta()).resolves.toEqual({ title: "Incident | Supercheck" });
  await expect(meta("not-a-uuid")).resolves.toEqual({ title: "Incident | Supercheck" });
  limit.mockRejectedValue(new Error("db down"));
  await expect(meta()).resolves.toEqual({ title: "Incident | Supercheck" });
});
