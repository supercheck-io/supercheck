/** @jest-environment node */
const findFirst = jest.fn();
jest.mock("@/utils/db", () => ({ db: { query: { statusPages: { findFirst: (...args: unknown[]) => findFirst(...args) } } } }));
const checkFeatureAvailability = jest.fn();
jest.mock("@/lib/middleware/plan-enforcement", () => ({
  checkFeatureAvailability: (...args: unknown[]) => checkFeatureAvailability(...args),
}));
jest.mock("@/lib/asset-proxy", () => ({ generateProxyUrl: (value: string | null) => value }));
import { getPublicStatusPageByCustomDomain } from "./get-public-status-page-by-custom-domain";

beforeEach(() => {
  findFirst.mockResolvedValue({ id: "p1", name: "Acme", organizationId: "org-1", faviconLogo: null, transactionalLogo: null, heroCover: null });
  checkFeatureAvailability.mockReset();
});

it("serves a verified domain while the plan includes custom domains, without exposing the organization", async () => {
  checkFeatureAvailability.mockResolvedValue({ available: true });
  const result = await getPublicStatusPageByCustomDomain("Status.Example.com");
  expect(result.success).toBe(true);
  expect(checkFeatureAvailability).toHaveBeenCalledWith("org-1", "customDomains");
  expect(result.statusPage).not.toHaveProperty("organizationId");
});

it("stops serving the domain once the plan no longer includes custom domains", async () => {
  checkFeatureAvailability.mockResolvedValue({ available: false, error: "Upgrade" });
  const result = await getPublicStatusPageByCustomDomain("status.example.com");
  expect(result.success).toBe(false);
  expect(result).not.toHaveProperty("statusPage");
});

it("keeps the page up when the plan lookup fails unexpectedly", async () => {
  checkFeatureAvailability.mockRejectedValue(new Error("connection reset"));
  jest.spyOn(console, "error").mockImplementation(() => {});
  const result = await getPublicStatusPageByCustomDomain("status.example.com");
  expect(result.success).toBe(true);
});
