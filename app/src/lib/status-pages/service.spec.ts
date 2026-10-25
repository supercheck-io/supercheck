/** @jest-environment node */

const chainResult = { value: [] as unknown };
const makeChain = (): Record<string, unknown> => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "set", "values", "returning", "innerJoin", "limit"]) {
    chain[m] = jest.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(chainResult.value).then(resolve, reject);
  return chain;
};

const pageFindFirst = jest.fn();
const componentFindFirst = jest.fn();
const componentFindMany = jest.fn();
const serviceFindFirst = jest.fn();
const select = jest.fn((..._a: unknown[]) => makeChain());
const insert = jest.fn(() => makeChain());
const update = jest.fn(() => makeChain());
const del = jest.fn(() => makeChain());
const transaction = jest.fn(async (run: (tx: unknown) => unknown) =>
  run({ update: (...a: unknown[]) => (update as jest.Mock)(...a), insert: (...a: unknown[]) => (insert as jest.Mock)(...a), delete: (...a: unknown[]) => (del as jest.Mock)(...a) })
);

jest.mock("@/utils/db", () => ({
  db: {
    query: {
      statusPages: { findFirst: (...a: unknown[]) => pageFindFirst(...a) },
      statusPageComponents: {
        findFirst: (...a: unknown[]) => componentFindFirst(...a),
        findMany: (...a: unknown[]) => componentFindMany(...a),
      },
      sreServices: { findFirst: (...a: unknown[]) => serviceFindFirst(...a) },
    },
    select: (...a: unknown[]) => (select as jest.Mock)(...a),
    insert: (...a: unknown[]) => (insert as jest.Mock)(...a),
    update: (...a: unknown[]) => (update as jest.Mock)(...a),
    delete: (...a: unknown[]) => (del as jest.Mock)(...a),
    transaction: (...a: unknown[]) => (transaction as jest.Mock)(...a),
  },
}));
const logAuditEvent = jest.fn();
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: (...a: unknown[]) => logAuditEvent(...a) }));
const insertWithinPlanLimit = jest.fn();
jest.mock("@/lib/middleware/plan-limit-lock", () => ({
  insertWithinPlanLimit: (...a: unknown[]) => insertWithinPlanLimit(...a),
}));
const checkFeatureAvailability = jest.fn();
jest.mock("@/lib/middleware/plan-enforcement", () => ({
  checkStatusPageLimit: jest.fn(),
  checkFeatureAvailability: (...a: unknown[]) => checkFeatureAvailability(...a),
}));
const updateComponentStatus = jest.fn();
jest.mock("@/lib/status-aggregation.service", () => ({
  statusAggregationService: { updateComponentStatus: (...a: unknown[]) => updateComponentStatus(...a) },
}));
const configError = jest.fn();
jest.mock("@/lib/status-page-domain", () => ({
  getStatusPageCustomDomainConfigError: () => configError(),
  getEffectiveStatusPageCnameTarget: () => "cname.example.test",
  getEffectiveStatusPageDomain: () => "status.example.test",
  isReservedStatusPageHostname: (host: string, base: string) => host === base || host.endsWith(`.${base}`),
}));
const blockUntilSubscribed = jest.fn();
jest.mock("@/lib/services/subscription-service", () => {
  class SubscriptionAccessDeniedError extends Error {
    constructor(message: string, readonly reason?: string) {
      super(message);
    }
  }
  return {
    SubscriptionAccessDeniedError,
    subscriptionService: {
      blockUntilSubscribed: (...a: unknown[]) => blockUntilSubscribed(...a),
      requireValidPolarCustomer: jest.fn(),
    },
  };
});
jest.mock("@/lib/asset-proxy", () => ({ generateProxyUrl: (v: string | null) => v }));

import {
  checkPublishPreconditions,
  createComponent,
  createStatusPage,
  deleteComponent,
  findServerManagedKeyError,
  listComponents,
  setStatusPagePublished,
  toComponentDto,
  updateComponent,
  updateStatusPageSettings,
} from "./service";
import { SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";

const ctx = { userId: "user-1", organizationId: "org-1", projectId: "project-1", projectName: "P" };
const pageId = "00000000-0000-4000-8000-000000000001";
const compId = "00000000-0000-4000-8000-000000000002";
const monitorA = "00000000-0000-4000-8000-0000000000a1";

describe("status page service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chainResult.value = [];
    checkFeatureAvailability.mockResolvedValue({ available: true });
    configError.mockReturnValue(null);
    blockUntilSubscribed.mockResolvedValue(undefined);
  });

  describe("findServerManagedKeyError", () => {
    it("flags subdomain and customDomainVerified", () => {
      expect(findServerManagedKeyError({ subdomain: "x" })).toContain("subdomain");
      expect(findServerManagedKeyError({ customDomainVerified: true })).toContain("customDomainVerified");
      expect(findServerManagedKeyError({ name: "ok" })).toBeNull();
    });
  });

  describe("createStatusPage", () => {
    it("rejects an empty name", async () => {
      const result = await createStatusPage(ctx, { name: "" });
      expect(result).toMatchObject({ ok: false, code: "validation" });
      expect(insertWithinPlanLimit).not.toHaveBeenCalled();
    });

    it("maps a plan-limit rejection to forbidden with the original message", async () => {
      insertWithinPlanLimit.mockResolvedValue({ ok: false, busy: false, check: { error: "Limit reached" } });
      const result = await createStatusPage(ctx, { name: "Acme" });
      expect(result).toEqual({ ok: false, code: "forbidden", message: "Limit reached" });
    });

    it("rejects a whitespace-only name and an over-long description", async () => {
      expect(await createStatusPage(ctx, { name: "   " })).toMatchObject({ ok: false, code: "validation" });
      expect(await createStatusPage(ctx, { name: "ok", pageDescription: "x".repeat(2001) })).toMatchObject({
        ok: false,
        code: "validation",
      });
      expect(insertWithinPlanLimit).not.toHaveBeenCalled();
    });

    it("returns a generic message and never the raw database error", async () => {
      const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
      insertWithinPlanLimit.mockRejectedValue(new Error('duplicate key value violates unique constraint "status_pages_subdomain_key"'));
      const result = await createStatusPage(ctx, { name: "Acme" });
      expect(result).toEqual({ ok: false, code: "internal", message: "Failed to create status page. Please try again." });
      expect(JSON.stringify(result)).not.toContain("duplicate key");
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("maps a busy lock to busy", async () => {
      insertWithinPlanLimit.mockResolvedValue({ ok: false, busy: true });
      expect(await createStatusPage(ctx, { name: "Acme" })).toMatchObject({ ok: false, code: "busy" });
    });

    it("generates the subdomain on the server and audits", async () => {
      let inserted: Record<string, unknown> | undefined;
      insertWithinPlanLimit.mockImplementation(async (opts: { insert: (e: unknown) => Promise<unknown> }) => {
        const executor = {
          insert: () => ({
            values: (v: Record<string, unknown>) => {
              inserted = v;
              return { returning: async () => [{ id: pageId, subdomain: v.subdomain, name: v.name }] };
            },
          }),
        };
        return { ok: true, row: await opts.insert(executor) };
      });
      const result = await createStatusPage(ctx, { name: "Acme", subdomain: "evil" } as never);
      expect(result.ok).toBe(true);
      expect(inserted?.subdomain).toMatch(/^[0-9a-f]{32}$/);
      expect(inserted).toMatchObject({ projectId: "project-1", organizationId: "org-1", status: "draft" });
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "status_page_created" }));
    });
  });

  describe("updateStatusPageSettings", () => {
    it("returns not_found for a page outside the project", async () => {
      pageFindFirst.mockResolvedValue(undefined);
      expect(await updateStatusPageSettings(ctx, pageId, { name: "x" })).toMatchObject({ ok: false, code: "not_found" });
      expect(update).not.toHaveBeenCalled();
    });

    it("rejects an invalid hex colour", async () => {
      expect(await updateStatusPageSettings(ctx, pageId, { cssFontColor: "red" })).toMatchObject({
        ok: false,
        code: "validation",
      });
    });

    it("rejects a reserved custom domain host", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId, customDomain: null });
      const result = await updateStatusPageSettings(ctx, pageId, { customDomain: "foo.status.example.test" });
      expect(result).toMatchObject({ ok: false, code: "validation" });
      expect(update).not.toHaveBeenCalled();
    });

    it("maps an unavailable custom-domain feature to forbidden", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId, customDomain: null });
      checkFeatureAvailability.mockResolvedValue({ available: false, error: "Not on your plan" });
      expect(await updateStatusPageSettings(ctx, pageId, { customDomain: "status.acme.com" })).toEqual({
        ok: false,
        code: "forbidden",
        message: "Not on your plan",
      });
    });

    it("maps a domain already used by another page to conflict", async () => {
      pageFindFirst.mockResolvedValueOnce({ id: pageId, customDomain: null }).mockResolvedValueOnce({ id: "other" });
      expect(await updateStatusPageSettings(ctx, pageId, { customDomain: "status.acme.com" })).toMatchObject({
        ok: false,
        code: "conflict",
      });
    });

    it("maps a unique-violation to conflict", async () => {
      pageFindFirst.mockResolvedValueOnce({ id: pageId, customDomain: null }).mockResolvedValueOnce(undefined);
      update.mockImplementationOnce(() => {
        throw Object.assign(new Error("dup"), { code: "23505" });
      });
      expect(await updateStatusPageSettings(ctx, pageId, { customDomain: "status.acme.com" })).toMatchObject({
        ok: false,
        code: "conflict",
      });
    });

    it("resets verification when the domain changes and nulls an empty domain", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId, customDomain: "old.acme.com" });
      const chain = makeChain();
      update.mockReturnValueOnce(chain);
      const result = await updateStatusPageSettings(ctx, pageId, { customDomain: "" });
      expect(result.ok).toBe(true);
      expect(chain.set).toHaveBeenCalledWith(
        expect.objectContaining({ customDomain: null, customDomainVerified: false, customDomainFailureCount: 0 })
      );
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "status_page_settings_updated" }));
    });
  });

  describe("setStatusPagePublished", () => {
    it("blocks publishing without subscription access", async () => {
      blockUntilSubscribed.mockRejectedValue(new SubscriptionAccessDeniedError("Trial ended", "subscription_required"));
      expect(await setStatusPagePublished(ctx, pageId, "published")).toEqual({
        ok: false,
        code: "forbidden",
        message: "Trial ended",
      });
    });

    it("requires a public component to publish", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId });
      componentFindFirst.mockResolvedValue(undefined);
      expect(await setStatusPagePublished(ctx, pageId, "published")).toMatchObject({ ok: false, code: "validation" });
    });

    it("archives via the unpublish path and audits as archived", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId });
      chainResult.value = [{ id: pageId, name: "n", subdomain: "s", status: "archived" }];
      const chain = makeChain();
      update.mockReturnValueOnce(chain);
      const result = await setStatusPagePublished(ctx, pageId, "archived");
      expect(result.ok).toBe(true);
      expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
      expect(blockUntilSubscribed).not.toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "status_page_archived" }));
    });
  });

  describe("checkPublishPreconditions", () => {
    it("fails without a public component and performs no write", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId });
      componentFindFirst.mockResolvedValue(undefined);
      expect(await checkPublishPreconditions(ctx, pageId)).toMatchObject({ ok: false, code: "validation" });
      expect(update).not.toHaveBeenCalled();
    });

    it("passes with ownership, subscription and a visible component", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId });
      componentFindFirst.mockResolvedValue({ id: compId });
      expect(await checkPublishPreconditions(ctx, pageId)).toMatchObject({ ok: true });
    });

    it("blocks without subscription access", async () => {
      blockUntilSubscribed.mockRejectedValue(new SubscriptionAccessDeniedError("Trial ended", "subscription_required"));
      expect(await checkPublishPreconditions(ctx, pageId)).toEqual({ ok: false, code: "forbidden", message: "Trial ended" });
    });
  });

  describe("components", () => {
    it("lists components with monitorIds", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId });
      componentFindMany.mockResolvedValue([
        { id: compId, name: "API", description: null, position: 1, monitors: [{ monitorId: monitorA }], status: "operational", aggregationMethod: "worst_case", failureThreshold: 1, autoCreateIncidents: false, serviceId: null },
      ]);
      const result = await listComponents(ctx, pageId);
      expect(result).toMatchObject({ ok: true, data: { components: [{ id: compId, monitorIds: [monitorA], position: 1 }] } });
    });

    it("404s a component create on another project's page", async () => {
      pageFindFirst.mockResolvedValue(undefined);
      expect(await createComponent(ctx, pageId, { name: "API" })).toMatchObject({ ok: false, code: "not_found" });
      expect(insert).not.toHaveBeenCalled();
    });

    it("rejects monitorIds that do not all belong to the project", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId });
      chainResult.value = []; // monitor lookup returns nothing
      const result = await createComponent(ctx, pageId, { name: "API", monitorIds: [monitorA] });
      expect(result).toEqual({
        ok: false,
        code: "validation",
        message: "One or more monitors not found or access denied",
      });
      expect(insert).not.toHaveBeenCalled();
    });

    it("creates a component, links monitors and aggregates status", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId });
      const compRow = { id: compId, name: "API", statusPageId: pageId };
      chainResult.value = [{ id: monitorA }];
      insert.mockImplementation(() => {
        const c = makeChain();
        (c.returning as jest.Mock).mockImplementation(() => Promise.resolve([compRow]));
        return c;
      });
      componentFindFirst.mockResolvedValue(compRow);
      const result = await createComponent(ctx, pageId, { name: "API", monitorIds: [monitorA] });
      expect(result).toMatchObject({ ok: true, data: { monitorIds: [monitorA] } });
      expect(insert).toHaveBeenCalledTimes(2);
      expect(updateComponentStatus).toHaveBeenCalledWith(compId);
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "component_created" }));
    });

    it("collapses duplicate monitorIds before the ownership check", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId });
      chainResult.value = [{ id: monitorA }]; // one distinct monitor exists
      insert.mockImplementation(() => {
        const c = makeChain();
        (c.returning as jest.Mock).mockImplementation(() => Promise.resolve([{ id: compId, name: "API" }]));
        return c;
      });
      componentFindFirst.mockResolvedValue({ id: compId, name: "API" });
      const result = await createComponent(ctx, pageId, { name: "API", monitorIds: [monitorA, monitorA] });
      expect(result).toMatchObject({ ok: true, data: { monitorIds: [monitorA] } });
    });

    it("rejects more than 100 monitorIds", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId });
      const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
      expect(await createComponent(ctx, pageId, { name: "API", monitorIds: many })).toMatchObject({
        ok: false,
        code: "validation",
      });
    });

    it("replaces monitor links inside a transaction on update", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId });
      componentFindFirst.mockResolvedValue({ id: compId, name: "API" });
      chainResult.value = [{ id: monitorA }];
      const result = await updateComponent(ctx, pageId, compId, { monitorIds: [monitorA], status: "operational" });
      expect(result.ok).toBe(true);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledTimes(1); // row update is inside the same transaction
      expect(del).toHaveBeenCalledTimes(1);
    });

    it("rejects a whitespace-only component name", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId });
      expect(await createComponent(ctx, pageId, { name: "   " })).toMatchObject({ ok: false, code: "validation" });
      expect(await updateComponent(ctx, pageId, compId, { name: " " })).toMatchObject({ ok: false, code: "validation" });
    });

    it("404s update of a component not on the page", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId });
      componentFindFirst.mockResolvedValue(undefined);
      expect(await updateComponent(ctx, pageId, compId, { name: "x" })).toMatchObject({ ok: false, code: "not_found" });
    });

    it("404s delete of a component on another page", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId });
      componentFindFirst.mockResolvedValue(undefined);
      expect(await deleteComponent(ctx, pageId, compId)).toMatchObject({ ok: false, code: "not_found" });
      expect(del).not.toHaveBeenCalled();
    });

    it("deletes a component and audits", async () => {
      pageFindFirst.mockResolvedValue({ id: pageId });
      componentFindFirst.mockResolvedValue({ id: compId, name: "API" });
      expect(await deleteComponent(ctx, pageId, compId)).toEqual({ ok: true, data: null });
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "component_deleted" }));
    });

    it("toComponentDto defaults nullable fields", () => {
      const dto = toComponentDto({ id: compId, name: "A", description: null, position: null } as never, []);
      expect(dto).toMatchObject({ id: compId, description: null, position: 0, monitorIds: [] });
    });
  });
});
