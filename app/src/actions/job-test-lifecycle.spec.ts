/** @jest-environment node */
/**
 * Server actions that create jobs and delete tests.
 *
 * These are the two place a tenant boundary is most likely to break: a job
 * references tests by id, and a delete removes a row by id. Both actions must
 * scope every read and write to the caller's active project and organization,
 * and a destructive delete must refuse while dependants still reference it.
 */
jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  requirePermissions: jest.fn(),
  checkPermissionWithContext: jest.fn(),
}));

jest.mock("@/lib/audit-logger", () => ({
  logAuditEvent: jest.fn(),
}));

jest.mock("@/lib/job-scheduler", () => ({
  scheduleJob: jest.fn(),
}));

import { db } from "@/utils/db";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions, checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { scheduleJob } from "@/lib/job-scheduler";
import { revalidatePath } from "next/cache";
import { createJob } from "./create-job";
import { deleteTest } from "./delete-test";

const dialect = new PgDialect();

/**
 * Serialises the predicate handed to `.where()` with Drizzle's own dialect, so a
 * scoping assertion covers the query itself: dropping `projectId` or
 * `organizationId` would still return the same status code while touching
 * another tenant's row.
 */
function predicateFor(predicate: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(predicate as SQL);
}

const mockDb = db as unknown as {
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};
const mockRequireProjectContext = requireProjectContext as jest.Mock;
const mockRequirePermissions = requirePermissions as jest.Mock;
const mockCheckPermission = checkPermissionWithContext as jest.Mock;
const mockLogAuditEvent = logAuditEvent as jest.Mock;
const mockScheduleJob = scheduleJob as jest.Mock;
const mockRevalidatePath = revalidatePath as jest.Mock;

const TEST_ID_1 = "11111111-1111-4111-8111-111111111111";
const TEST_ID_2 = "22222222-2222-4222-8222-222222222222";

/** Resolves at `.where()` — used by scoped selects that have no `.limit()`. */
function whereChain(result: unknown) {
  return { from: jest.fn().mockReturnThis(), where: jest.fn().mockResolvedValue(result) };
}

/** Resolves at `.limit()` — used by the existence lookup in deleteTest. */
function limitChain(result: unknown) {
  return {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(result),
  };
}

function insertChain() {
  return { values: jest.fn().mockResolvedValue(undefined) };
}

function updateChain() {
  return { set: jest.fn().mockReturnThis(), where: jest.fn().mockResolvedValue(undefined) };
}

function deleteChain(result: unknown) {
  return { where: jest.fn().mockReturnThis(), returning: jest.fn().mockResolvedValue(result) };
}

describe("job and test lifecycle actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireProjectContext.mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      project: { id: "project-1", name: "Checkout" },
    });
    mockRequirePermissions.mockResolvedValue(undefined);
    mockCheckPermission.mockReturnValue(true);
    mockLogAuditEvent.mockResolvedValue(undefined);
    mockScheduleJob.mockResolvedValue("scheduler-job-1");
    mockDb.insert.mockImplementation(() => insertChain());
    mockDb.update.mockImplementation(() => updateChain());
  });

  describe("createJob", () => {
    const validJob = {
      name: "Nightly checkout",
      description: "",
      tests: [{ id: TEST_ID_1 }],
      jobType: "playwright" as const,
    };

    it("rejects a job with no tests before touching the database", async () => {
      const result = await createJob({ ...validJob, tests: [] });

      expect(result).toEqual({
        success: false,
        message: "At least one test is required for a job.",
      });
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("rejects duplicate test ids", async () => {
      const result = await createJob({
        ...validJob,
        tests: [{ id: TEST_ID_1 }, { id: TEST_ID_1 }],
      });

      expect(result).toEqual({
        success: false,
        message: "Duplicate test IDs are not allowed in a job.",
      });
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it("refuses a test id that is not visible in the active project and organization", async () => {
      // The scoped query returns nothing for a test that belongs to another tenant.
      mockDb.select.mockReturnValueOnce(whereChain([]));

      const result = await createJob(validJob);

      expect(result).toEqual({
        success: false,
        message: "One or more selected tests are invalid or not accessible",
      });
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("refuses to mix a k6 performance test into a Playwright job", async () => {
      mockDb.select.mockReturnValueOnce(whereChain([{ id: TEST_ID_1, type: "performance" }]));

      const result = await createJob({ ...validJob, jobType: "playwright" });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("cannot be added to a Playwright job"),
      });
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("creates the job, ordered test links and an audit event scoped to the active tenant", async () => {
      mockDb.select.mockReturnValueOnce(
        whereChain([
          { id: TEST_ID_1, type: "browser" },
          { id: TEST_ID_2, type: "api" },
        ]),
      );
      const jobsInsert = insertChain();
      const linksInsert = insertChain();
      mockDb.insert.mockReturnValueOnce(jobsInsert).mockReturnValueOnce(linksInsert);

      const result = await createJob({
        ...validJob,
        description: "runs every night",
        tests: [{ id: TEST_ID_2 }, { id: TEST_ID_1 }],
      });

      expect(result.success).toBe(true);
      expect(jobsInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          projectId: "project-1",
          createdByUserId: "user-1",
          name: "Nightly checkout",
          description: "runs every night",
        }),
      );
      expect(linksInsert.values).toHaveBeenCalledWith([
        { jobId: expect.any(String), testId: TEST_ID_2, orderPosition: 0 },
        { jobId: expect.any(String), testId: TEST_ID_1, orderPosition: 1 },
      ]);
      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "job_created",
          resource: "job",
          metadata: expect.objectContaining({ organizationId: "org-1", projectId: "project-1" }),
        }),
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith("/jobs");
    });

    it("returns a permission error and writes nothing when the caller may not create jobs", async () => {
      mockRequirePermissions.mockRejectedValueOnce(new Error("forbidden"));

      const result = await createJob(validJob);

      expect(result).toEqual({
        success: false,
        message: "Insufficient permissions to create jobs",
      });
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("schedules a cron job and stores the scheduler id", async () => {
      mockDb.select.mockReturnValueOnce(whereChain([{ id: TEST_ID_1, type: "browser" }]));
      const jobsInsert = insertChain();
      const linksInsert = insertChain();
      const jobsUpdate = updateChain();
      mockDb.insert.mockReturnValueOnce(jobsInsert).mockReturnValueOnce(linksInsert);
      mockDb.update.mockReturnValueOnce(jobsUpdate);

      const result = await createJob({ ...validJob, cronSchedule: "0 2 * * *" });

      expect(mockScheduleJob).toHaveBeenCalledWith(
        expect.objectContaining({ cron: "0 2 * * *", retryLimit: 3 }),
      );
      expect(jobsUpdate.set).toHaveBeenCalledWith({ scheduledJobId: "scheduler-job-1" });
      expect(result).toMatchObject({ success: true, job: { scheduledJobId: "scheduler-job-1" } });
    });

    it("keeps the created job when the scheduler is unavailable", async () => {
      mockDb.select.mockReturnValueOnce(whereChain([{ id: TEST_ID_1, type: "browser" }]));
      mockDb.insert.mockReturnValue(insertChain());
      mockScheduleJob.mockRejectedValueOnce(new Error("scheduler down"));
      jest.spyOn(console, "error").mockImplementation(() => undefined);

      const result = await createJob({ ...validJob, cronSchedule: "0 2 * * *" });

      expect(result).toMatchObject({ success: true, job: { scheduledJobId: null } });
      jest.restoreAllMocks();
    });

    it("rejects malformed input with a validation error", async () => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);

      const result = await createJob({ ...validJob, tests: [{ id: "not-a-uuid" }] });

      expect(result).toMatchObject({ success: false, message: "Invalid data provided" });
      expect(mockDb.select).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    });

    it("reports a database failure instead of claiming success", async () => {
      mockDb.select.mockReturnValueOnce(whereChain([{ id: TEST_ID_1, type: "browser" }]));
      mockDb.insert.mockImplementationOnce(() => ({
        values: jest.fn().mockRejectedValue(new Error("connection reset")),
      }));
      jest.spyOn(console, "error").mockImplementation(() => undefined);

      const result = await createJob(validJob);

      expect(result).toMatchObject({ success: false, message: "Failed to create job: connection reset" });
      jest.restoreAllMocks();
    });
  });

  describe("deleteTest", () => {
    it("requires an id", async () => {
      await expect(deleteTest("")).resolves.toEqual({
        success: false,
        error: "Test ID is required",
      });
      expect(mockRequireProjectContext).not.toHaveBeenCalled();
    });

    it("refuses to delete without delete permission", async () => {
      mockCheckPermission.mockReturnValue(false);
      jest.spyOn(console, "warn").mockImplementation(() => undefined);

      const result = await deleteTest(TEST_ID_1);

      expect(result).toEqual({
        success: false,
        error: "Insufficient permissions to delete tests",
      });
      expect(mockDb.delete).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    });

    it("scopes the existence lookup to the active project and organization", async () => {
      mockDb.select.mockReturnValueOnce(limitChain([]));

      const result = await deleteTest(TEST_ID_1);

      expect(result).toEqual({
        success: false,
        error: "Test not found or access denied",
        errorCode: 404,
      });
      const lookupChain = mockDb.select.mock.results[0].value as ReturnType<typeof limitChain>;
      expect(lookupChain.limit).toHaveBeenCalledWith(1);
      const lookup = predicateFor(lookupChain.where.mock.calls[0][0]);
      expect(lookup.sql).toContain('"tests"."id" =');
      expect(lookup.sql).toContain('"tests"."project_id" =');
      expect(lookup.sql).toContain('"tests"."organization_id" =');
      expect(lookup.params).toEqual([TEST_ID_1, "project-1", "org-1"]);
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it("refuses to delete a test that a job still references", async () => {
      mockDb.select
        .mockReturnValueOnce(limitChain([{ id: TEST_ID_1, title: "Checkout", type: "browser", priority: "high" }]))
        .mockReturnValueOnce(whereChain([{ count: 2 }]));

      const result = await deleteTest(TEST_ID_1);

      expect(result).toMatchObject({
        success: false,
        errorCode: 409,
        error: expect.stringContaining("used in one or more jobs"),
      });
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it("refuses to delete a test that a synthetic monitor still references", async () => {
      mockDb.select
        .mockReturnValueOnce(limitChain([{ id: TEST_ID_1, title: "Checkout", type: "browser", priority: "high" }]))
        .mockReturnValueOnce(whereChain([{ count: 0 }]))
        .mockReturnValueOnce(whereChain([{ count: 1 }]));

      const result = await deleteTest(TEST_ID_1);

      expect(result).toMatchObject({
        success: false,
        errorCode: 409,
        error: expect.stringContaining("synthetic monitors"),
      });
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it("deletes an unreferenced test, audits it and revalidates both surfaces", async () => {
      mockDb.select
        .mockReturnValueOnce(
          limitChain([
            { id: TEST_ID_1, title: "Checkout", type: "browser", priority: "high" },
          ]),
        )
        .mockReturnValueOnce(whereChain([{ count: 0 }]))
        .mockReturnValueOnce(whereChain([{ count: 0 }]));
      const deletion = deleteChain([{ id: TEST_ID_1 }]);
      mockDb.delete.mockReturnValueOnce(deletion);

      const result = await deleteTest(TEST_ID_1);

      expect(result).toEqual({ success: true, message: "Test deleted successfully" });
      // The predicate, not just the result: the delete must carry the same
      // project and organization scope as the lookup above.
      const deletePredicate = predicateFor(deletion.where.mock.calls[0][0]);
      expect(deletePredicate.sql).toContain('"tests"."id" =');
      expect(deletePredicate.sql).toContain('"tests"."project_id" =');
      expect(deletePredicate.sql).toContain('"tests"."organization_id" =');
      expect(deletePredicate.params).toEqual([TEST_ID_1, "project-1", "org-1"]);
      expect(deletion.returning).toHaveBeenCalled();
      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "test_deleted",
          resourceId: TEST_ID_1,
          metadata: expect.objectContaining({
            organizationId: "org-1",
            projectId: "project-1",
            testTitle: "Checkout",
          }),
        }),
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith("/tests");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/jobs");
    });

    it("reports a race where the row disappeared between lookup and delete", async () => {
      mockDb.select
        .mockReturnValueOnce(limitChain([{ id: TEST_ID_1, title: "Checkout", type: "browser", priority: "high" }]))
        .mockReturnValueOnce(whereChain([{ count: 0 }]))
        .mockReturnValueOnce(whereChain([{ count: 0 }]));
      mockDb.delete.mockReturnValueOnce(deleteChain([]));

      const result = await deleteTest(TEST_ID_1);

      expect(result).toMatchObject({ success: false, errorCode: 404 });
      expect(mockLogAuditEvent).not.toHaveBeenCalled();
    });

    it("returns a failure instead of throwing when the database errors", async () => {
      mockDb.select.mockImplementationOnce(() => {
        throw new Error("connection reset");
      });
      jest.spyOn(console, "error").mockImplementation(() => undefined);

      const result = await deleteTest(TEST_ID_1);

      expect(result).toEqual({ success: false, error: "connection reset" });
      jest.restoreAllMocks();
    });
  });
});
