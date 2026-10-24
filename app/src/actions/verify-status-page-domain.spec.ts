jest.mock("@/utils/db", () => ({ db: { query: { statusPages: { findFirst: jest.fn() } }, update: jest.fn() } }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn(async () => ({ userId: "user", organizationId: "org", project: { id: "project" } })) }));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn() }));
const checkFeatureAvailability = jest.fn();
jest.mock("@/lib/middleware/plan-enforcement", () => ({ checkFeatureAvailability: (...args: unknown[]) => checkFeatureAvailability(...args) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("node:dns/promises", () => ({ resolve4: jest.fn(async () => ["8.8.8.8"]), resolve6: jest.fn(async () => []), resolveCname: jest.fn(async () => ["cname.example.com"]), resolveTxt: jest.fn() }));
jest.mock("@/lib/status-page-domain", () => ({ getStatusPageCustomDomainConfigError: () => null, getEffectiveStatusPageCnameTarget: () => "cname.example.com", getEffectiveStatusPageDomain: () => "example.com", getStatusPageDomainVerificationTargets: () => ["cname.example.com"], isReservedStatusPageHostname: () => false }));
import { verifyStatusPageDomain } from "./verify-status-page-domain";
import { db } from "@/utils/db";
import { resolveTxt } from "node:dns/promises";
const pageId = "00000000-0000-4000-8000-000000000001";
describe("custom domain ownership proof", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkFeatureAvailability.mockResolvedValue({ available: true });
    jest.mocked(db.query.statusPages.findFirst).mockResolvedValue({ id: pageId, customDomain: "status.customer.test" } as never);
    jest.mocked(db.update).mockReturnValue({ set: () => ({ where: () => ({ returning: async () => [{ id: pageId }] }) }) } as never);
  });
  it.each([{ records: [] }, { records: [["supercheck-domain-verification=deleted-page-id"]] }])("rejects a dangling CNAME without this page's TXT proof", async ({ records }) => {
    jest.mocked(resolveTxt).mockResolvedValue(records);
    expect((await verifyStatusPageDomain(pageId)).success).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });
  it("accepts a matching TXT proof, including DNS chunking", async () => {
    jest.mocked(resolveTxt).mockResolvedValue([["supercheck-domain-", `verification=${pageId}`]]);
    expect((await verifyStatusPageDomain(pageId)).success).toBe(true);
    expect(resolveTxt).toHaveBeenCalledWith("_supercheck-challenge.status.customer.test");
    expect(db.update).toHaveBeenCalledTimes(1);
  });
  it("refuses to verify a custom domain on a plan without the feature, before any DNS lookup", async () => {
    checkFeatureAvailability.mockResolvedValue({ available: false, error: "Custom domains are not available on your free trial." });
    const result = await verifyStatusPageDomain(pageId);
    expect(result).toEqual({ success: false, message: "Custom domains are not available on your free trial." });
    expect(resolveTxt).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});
