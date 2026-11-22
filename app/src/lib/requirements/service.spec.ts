/** @jest-environment node */
const mockSelectQueue: unknown[][] = [];
const mockUpdateSet = jest.fn();
const mockUpdateRows: unknown[][] = [];
jest.mock("@/utils/db", () => {
  const select = jest.fn(() => {
    const node: Record<string, unknown> = {};
    node.from = () => node;
    node.innerJoin = () => node;
    node.leftJoin = () => node;
    node.where = () => {
      let cached: Promise<unknown[]> | undefined;
      const rows = () => (cached ??= Promise.resolve(mockSelectQueue.shift() ?? []));
      return { limit: rows, orderBy: rows, then: (r: (v: unknown[]) => unknown, j?: (e: unknown) => unknown) => rows().then(r, j) };
    };
    return node;
  });
  const writeChain = () => ({
    values: () => ({
      onConflictDoNothing: () => Object.assign(Promise.resolve(), { returning: () => Promise.resolve([{ id: "x" }]) }),
    }),
  });
  const db: Record<string, unknown> = {
    select,
    insert: jest.fn(writeChain),
    delete: jest.fn(() => ({ where: () => Promise.resolve() })),
    update: jest.fn(() => ({
      set: (values: unknown) => {
        mockUpdateSet(values);
        return { where: () => ({ returning: () => Promise.resolve(mockUpdateRows.shift() ?? [{ id: "x" }]) }) };
      },
    })),
    // The transaction handle is a distinct object so specs can assert writes went through it.
    transaction: jest.fn(async (run: (tx: unknown) => unknown): Promise<unknown> => run(mockTx)),
  };
  const mockTx = { ...db, isTx: true };
  return { db };
});
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/requirements-internal", () => ({
  syncRequirementTags: jest.fn(),
  syncRequirementTagsByName: jest.fn(),
  updateCoverageSnapshot: jest.fn(),
}));

import { db } from "@/utils/db";
import { logAuditEvent } from "@/lib/audit-logger";
import { PlanLimitBusyError } from "@/lib/middleware/plan-limit-lock";
import {
  syncRequirementTagsByName,
  updateCoverageSnapshot,
} from "@/lib/requirements-internal";
import {
  createRequirementRecord,
  createRequirementWithRelations,
  escapeCSV,
  linkTestsRecord,
  restCreateRequirementSchema,
  restTestIdsSchema,
  restUpdateRequirementSchema,
  updateRequirementWithRelations,
  syncRequirementTestsRecord,
  unlinkTestsRecord,
} from "./service";

const ctx = { userId: "u", organizationId: "o", projectId: "p", projectName: "Proj" };
const R = "44444444-4444-4444-8444-444444444444";
const T1 = "66666666-6666-4666-8666-666666666666";
const T2 = "77777777-7777-4777-8777-777777777777";

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectQueue.length = 0;
  mockUpdateRows.length = 0;
});

describe("requirements service", () => {
  it("create syncs tag names, writes the snapshot and audits", async () => {
    const result = await createRequirementWithRelations(ctx, {
      title: "Login works",
      tags: ["Auth", "auth", "Smoke"],
    });
    expect(result.success).toBe(true);
    expect(syncRequirementTagsByName).toHaveBeenCalledWith(
      result.id,
      ["Auth", "Smoke"], // case-insensitive dedupe keeps the first spelling
      "o",
      "p",
      "u",
      expect.objectContaining({ isTx: true }),
      false // REST names are strict: a new tag that breaks the rules is a 400
    );
    // requirement row + coverage snapshot, both inside the transaction
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "requirement_created", resource: "requirement", resourceId: result.id })
    );
  });

  it("create rejects testIds outside the project before writing anything", async () => {
    mockSelectQueue.push([{ id: T1 }]); // only 1 of 2 tests found in scope
    const result = await createRequirementWithRelations(ctx, { title: "x", testIds: [T1, T2] });
    expect(result.success).toBe(false);
    expect(result.code).toBe("invalid");
    expect(db.insert).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("create links tests and refreshes coverage when testIds are in scope", async () => {
    mockSelectQueue.push([{ id: T1 }], [{ id: "req" }], [{ id: T1 }]); // areTestsInScope, link: requirement, tests
    const result = await createRequirementWithRelations(ctx, { title: "x", testIds: [T1] });
    expect(result.success).toBe(true);
    // Linked inside the create transaction, not afterwards on the shared pool.
    expect(updateCoverageSnapshot).toHaveBeenCalledWith(result.id, expect.objectContaining({ isTx: true }));
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "requirement_tests_linked" }));
  });

  it("create rolls back (rejects, no audit) when linking tests fails", async () => {
    mockSelectQueue.push([{ id: T1 }]); // areTestsInScope
    // requirement row + snapshot succeed, the test-link insert fails
    const ok = () => ({
      values: () => ({
        onConflictDoNothing: () => Object.assign(Promise.resolve(), { returning: () => Promise.resolve([{ id: "x" }]) }),
        then: (r: (v: unknown) => unknown) => Promise.resolve().then(r),
      }),
    });
    (db.insert as jest.Mock)
      .mockImplementationOnce(ok)
      .mockImplementationOnce(ok)
      .mockImplementationOnce(() => {
        throw new Error("link failed");
      });
    await expect(createRequirementWithRelations(ctx, { title: "x", testIds: [T1] })).rejects.toThrow("link failed");
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("update writes only the provided columns, inside one transaction with tags and tests", async () => {
    mockSelectQueue.push([{ id: T1 }]); // areTestsInScope
    const result = await updateRequirementWithRelations(ctx, R, {
      description: null,
      tags: ["Smoke", "smoke"],
      testIds: [T1],
    });
    expect(result.success).toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    const set = mockUpdateSet.mock.calls[0][0];
    expect(Object.keys(set).sort()).toEqual(["description", "updatedAt"]);
    expect(set.description).toBeNull();
    expect(syncRequirementTagsByName).toHaveBeenCalledWith(R, ["Smoke"], "o", "p", "u", expect.objectContaining({ isTx: true }));
    expect(updateCoverageSnapshot).toHaveBeenCalledWith(R, expect.objectContaining({ isTx: true }));
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "requirement_updated" }));
  });

  it("update clears externalId/externalUrl with null and sets priority when given", async () => {
    await updateRequirementWithRelations(ctx, R, { externalId: null, externalUrl: null, priority: "high" });
    const set = mockUpdateSet.mock.calls[0][0];
    expect(set).toMatchObject({ externalId: null, externalUrl: null, priority: "high" });
    expect(set).not.toHaveProperty("title");
    expect(set).not.toHaveProperty("description");
  });

  it("update clears priority with null", async () => {
    expect(restUpdateRequirementSchema.safeParse({ priority: null }).success).toBe(true);
    await updateRequirementWithRelations(ctx, R, { priority: null });
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ priority: null });
  });

  it("maps the tag cap to an invalid result instead of throwing", async () => {
    (syncRequirementTagsByName as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error("Maximum of 10 tags allowed per requirement"), { name: "TagLimitError" })
    );
    const created = await createRequirementWithRelations(ctx, { title: "x", tags: ["a"] });
    expect(created).toMatchObject({ success: false, code: "invalid" });
    (syncRequirementTagsByName as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error("Maximum of 10 tags allowed per requirement"), { name: "TagLimitError" })
    );
    const updated = await updateRequirementWithRelations(ctx, R, { tags: ["a"] });
    expect(updated).toMatchObject({ success: false, code: "invalid" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("maps a tag rule or project-limit failure to an invalid result, rolling back the create", async () => {
    const ruleError = Object.assign(new Error('Invalid tag "ab": Tag name must be between 3 and 20 characters'), {
      name: "TagRuleError",
    });
    (syncRequirementTagsByName as jest.Mock).mockRejectedValueOnce(ruleError);
    const created = await createRequirementWithRelations(ctx, { title: "x", tags: ["ab"] });
    expect(created).toEqual({ id: "", success: false, error: ruleError.message, code: "invalid" });
    (syncRequirementTagsByName as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error("Maximum of 50 tags allowed per project"), { name: "TagRuleError" })
    );
    const updated = await updateRequirementWithRelations(ctx, R, { tags: ["smoke"] });
    expect(updated).toEqual({ success: false, error: "Maximum of 50 tags allowed per project", code: "invalid" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("maps a project-tag lock timeout to a busy result the routes answer with 503", async () => {
    (syncRequirementTagsByName as jest.Mock).mockRejectedValueOnce(new PlanLimitBusyError());
    const created = await createRequirementWithRelations(ctx, { title: "x", tags: ["smoke"] });
    expect(created).toMatchObject({ id: "", success: false, code: "busy" });
    (syncRequirementTagsByName as jest.Mock).mockRejectedValueOnce(new PlanLimitBusyError());
    const updated = await updateRequirementWithRelations(ctx, R, { tags: ["smoke"] });
    expect(updated).toMatchObject({ success: false, code: "busy" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("maps a tag-name unique violation from a racing writer to a busy result, not a 500", async () => {
    const race = () =>
      Object.assign(new Error("Failed query"), {
        cause: { code: "23505", constraint_name: "tags_project_lower_name_idx" },
      });
    (syncRequirementTagsByName as jest.Mock).mockRejectedValueOnce(race());
    const created = await createRequirementWithRelations(ctx, { title: "x", tags: ["smoke"] });
    expect(created).toMatchObject({ id: "", success: false, code: "busy" });
    (syncRequirementTagsByName as jest.Mock).mockRejectedValueOnce(race());
    const updated = await updateRequirementWithRelations(ctx, R, { tags: ["smoke"] });
    expect(updated).toMatchObject({ success: false, code: "busy" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("still throws a unique violation that is not on a tag-name index", async () => {
    (syncRequirementTagsByName as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error("dup"), { code: "23505", constraint_name: "requirement_tags_pkey" })
    );
    await expect(createRequirementWithRelations(ctx, { title: "x", tags: ["smoke"] })).rejects.toThrow("dup");
  });

  it("update syncs REST tag names strictly (default mode)", async () => {
    await updateRequirementWithRelations(ctx, R, { tags: ["smoke"] });
    const call = (syncRequirementTagsByName as jest.Mock).mock.calls[0];
    expect(call).toHaveLength(6);
    expect(call[1]).toEqual(["smoke"]);
  });

  it("create with the comma-separated form lowercases names and syncs them leniently", async () => {
    await createRequirementRecord(ctx, { title: "x", tags: "AI, Login Flow" } as never);
    expect(syncRequirementTagsByName).toHaveBeenCalledWith(
      expect.any(String),
      ["ai", "login flow"],
      "o",
      "p",
      "u",
      expect.objectContaining({ isTx: true }),
      true
    );
  });

  it("update reports not_found when no row matched and does not sync or audit", async () => {
    mockUpdateRows.push([]);
    const result = await updateRequirementWithRelations(ctx, R, { title: "x", tags: ["a"] });
    expect(result).toMatchObject({ success: false, code: "not_found" });
    expect(syncRequirementTagsByName).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("link refuses cross-project tests and does not touch coverage", async () => {
    mockSelectQueue.push([{ id: R }], []); // requirement ok, tests not in scope
    const result = await linkTestsRecord(ctx, R, [T1]);
    expect(result.success).toBe(false);
    expect(result.code).toBe("not_found");
    expect(db.insert).not.toHaveBeenCalled();
    expect(updateCoverageSnapshot).not.toHaveBeenCalled();
  });

  it("link refreshes coverage and audits identically to the action", async () => {
    mockSelectQueue.push([{ id: R }], [{ id: T1 }]);
    const result = await linkTestsRecord(ctx, R, [T1]);
    expect(result.success).toBe(true);
    expect(updateCoverageSnapshot).toHaveBeenCalledWith(R, expect.objectContaining({ isTx: true }));
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "requirement_tests_linked",
        metadata: { organizationId: "o", testIds: [T1], projectId: "p", projectName: "Proj" },
      })
    );
  });

  it("sync replaces links in a transaction and refreshes coverage once", async () => {
    mockSelectQueue.push([{ id: R }], [{ id: T1 }, { id: T2 }]);
    const result = await syncRequirementTestsRecord(ctx, R, [T1, T2, T1]);
    expect(result.success).toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(updateCoverageSnapshot).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "requirement_tests_synced", metadata: expect.objectContaining({ testCount: 2 }) })
    );
  });

  it("sync rejects tests outside the project", async () => {
    mockSelectQueue.push([{ id: R }], [{ id: T1 }]);
    const result = await syncRequirementTestsRecord(ctx, R, [T1, T2]);
    expect(result.success).toBe(false);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("unlink audits a single id as testId and refreshes coverage", async () => {
    mockSelectQueue.push([{ id: R }], [{ id: T1 }]);
    const result = await unlinkTestsRecord(ctx, R, [T1]);
    expect(result.success).toBe(true);
    expect(updateCoverageSnapshot).toHaveBeenCalledWith(R);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "requirement_test_unlinked",
        metadata: { organizationId: "o", testId: T1, projectId: "p", projectName: "Proj" },
      })
    );
  });

  it("unlink rejects an unknown requirement", async () => {
    mockSelectQueue.push([]);
    const result = await unlinkTestsRecord(ctx, R, [T1]);
    expect(result).toEqual(expect.objectContaining({ success: false, code: "not_found" }));
    expect(db.delete).not.toHaveBeenCalled();
  });
});

describe("REST requirement schemas", () => {
  it("are strict: unknown keys are rejected", () => {
    expect(restCreateRequirementSchema.safeParse({ title: "x", bogus: 1 }).success).toBe(false);
    expect(restUpdateRequirementSchema.safeParse({ bogus: 1 }).success).toBe(false);
    expect(restTestIdsSchema.safeParse({ testIds: [T1], extra: 1 }).success).toBe(false);
  });

  it("trims the title and rejects a blank one", () => {
    expect(restCreateRequirementSchema.parse({ title: "  hi  " }).title).toBe("hi");
    expect(restCreateRequirementSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("allows only http(s) external URLs, with a length cap", () => {
    expect(restCreateRequirementSchema.safeParse({ title: "x", externalUrl: "https://a.test/p" }).success).toBe(true);
    expect(restCreateRequirementSchema.safeParse({ title: "x", externalUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(restCreateRequirementSchema.safeParse({ title: "x", externalUrl: "ftp://a.test/p" }).success).toBe(false);
    expect(restCreateRequirementSchema.safeParse({ title: "x", externalUrl: `https://a.test/${"p".repeat(2048)}` }).success).toBe(false);
  });

  it("enforces field length limits", () => {
    expect(restCreateRequirementSchema.safeParse({ title: "x", description: "d".repeat(10001) }).success).toBe(false);
    expect(restCreateRequirementSchema.safeParse({ title: "x", externalId: "i".repeat(256) }).success).toBe(false);
  });
});

describe("escapeCSV", () => {
  it.each(["=SUM(A1)", "+1", "-1", "@cmd", "\tx", "\rx"])("neutralises formula prefix %j", (value) => {
    const out = escapeCSV(value);
    expect(out.replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("quotes commas, quotes, newlines and carriage returns", () => {
    expect(escapeCSV("a,b")).toBe('"a,b"');
    expect(escapeCSV('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCSV("a\nb")).toBe('"a\nb"');
    expect(escapeCSV("a\rb")).toBe('"a\rb"');
  });

  it("leaves plain values alone and maps null to empty", () => {
    expect(escapeCSV("plain")).toBe("plain");
    expect(escapeCSV(null)).toBe("");
    expect(escapeCSV(undefined)).toBe("");
  });
});
