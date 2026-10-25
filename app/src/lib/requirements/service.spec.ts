/** @jest-environment node */
const mockSelectQueue: unknown[][] = [];
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
    update: jest.fn(),
    transaction: jest.fn(async (run: (tx: unknown) => unknown): Promise<unknown> => run(db)),
  };
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
import {
  syncRequirementTagsByName,
  updateCoverageSnapshot,
} from "@/lib/requirements-internal";
import {
  createRequirementWithRelations,
  linkTestsRecord,
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
      ["auth", "smoke"],
      "o",
      "p",
      "u",
      expect.anything()
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
    expect(updateCoverageSnapshot).toHaveBeenCalledWith(result.id);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "requirement_tests_linked" }));
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
    expect(updateCoverageSnapshot).toHaveBeenCalledWith(R);
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
