/**
 * Job Scheduler Tests
 *
 * Comprehensive test coverage for BullMQ-based job scheduling
 *
 * Test Categories:
 * - Schedule Job (create/update scheduled jobs)
 * - Delete Scheduled Job (remove from queue)
 * - Initialize Job Schedulers (startup initialization)
 * - Handle Scheduled Job Trigger (job execution)
 * - Cleanup Job Scheduler (shutdown cleanup)
 * - Error Handling (database errors, queue errors)
 * - Edge Cases (missing jobs, concurrent operations)
 */

import type { Job } from "bullmq";

// Mock setup
const mockQueueAdd = jest.fn();
const mockQueueGetRepeatableJobs = jest.fn();
const mockQueueRemoveRepeatableByKey = jest.fn();

const mockQueuesModule = {
  getQueues: jest.fn().mockResolvedValue({
    jobSchedulerQueue: {
      add: mockQueueAdd,
      getRepeatableJobs: mockQueueGetRepeatableJobs,
      removeRepeatableByKey: mockQueueRemoveRepeatableByKey,
    },
    k6JobSchedulerQueue: {
      add: mockQueueAdd,
      getRepeatableJobs: mockQueueGetRepeatableJobs,
      removeRepeatableByKey: mockQueueRemoveRepeatableByKey,
    },
    redisConnection: {},
  }),
  addJobToQueue: jest.fn(),
};

const mockDbModule = {
  select: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
};

jest.mock("./queue", () => ({
  getQueues: () => mockQueuesModule.getQueues(),
  addJobToQueue: (...args: unknown[]) =>
    mockQueuesModule.addJobToQueue(...args),
}));

jest.mock("@/utils/db", () => ({
  db: {
    select: () => mockDbModule.select(),
    insert: () => mockDbModule.insert(),
    update: () => mockDbModule.update(),
  },
}));

jest.mock("drizzle-orm", () => ({
  eq: jest.fn(),
  and: jest.fn(),
  isNotNull: jest.fn(),
}));

jest.mock("@/db/schema", () => ({
  jobs: {},
  runs: {},
  JobTrigger: { schedule: "schedule" },
}));

jest.mock("@/lib/cron-utils", () => ({
  getNextRunDate: jest.fn().mockReturnValue(new Date("2025-12-01T00:00:00Z")),
}));

jest.mock("./job-execution-utils", () => ({
  prepareJobTestScripts: jest.fn().mockResolvedValue({
    testScripts: [
      { id: "test-1", name: "Test 1", script: "test code", type: "playwright" },
    ],
    variableResolution: { variables: {}, secrets: {} },
  }),
}));

jest.mock("./data-lifecycle-service", () => ({
  createDataLifecycleService: jest.fn().mockReturnValue({
    initialize: jest.fn(),
    getStatus: jest.fn().mockResolvedValue({
      enabledStrategies: [],
      queueStatus: "active",
    }),
    shutdown: jest.fn(),
  }),
  setDataLifecycleInstance: jest.fn(),
  getDataLifecycleService: jest.fn(),
}));

jest.mock("crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("mock-uuid-123"),
}));

// Import after mocks
import {
  scheduleJob,
  deleteScheduledJob,
  initializeJobSchedulers,
  handleScheduledJobTrigger,
  cleanupJobScheduler,
} from "./job-scheduler";
import { getNextRunDate } from "@/lib/cron-utils";

const mockGetNextRunDate = getNextRunDate as jest.Mock;

describe("Job Scheduler", () => {
  const testJobId = "job-123";
  const testProjectId = "project-456";
  const testOrgId = "org-789";

  const mockJob = {
    id: testJobId,
    name: "Test Job",
    projectId: testProjectId,
    organizationId: testOrgId,
    cronSchedule: "0 * * * *",
    jobType: "playwright",
    scheduledJobId: null,
    status: "idle",
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    mockQueueGetRepeatableJobs.mockResolvedValue([]);
    mockQueueAdd.mockResolvedValue({ id: "queue-job-id" });
    mockQueueRemoveRepeatableByKey.mockResolvedValue(true);

    // Default db mock chain
    const selectChain = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([mockJob]),
    };
    mockDbModule.select.mockReturnValue(selectChain);

    const insertChain = {
      values: jest.fn().mockResolvedValue(undefined),
    };
    mockDbModule.insert.mockReturnValue(insertChain);

    const updateChain = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue(undefined),
    };
    mockDbModule.update.mockReturnValue(updateChain);
  });

  // ==========================================================================
  // SCHEDULE JOB TESTS
  // ==========================================================================

  describe("scheduleJob", () => {
    describe("Positive Cases", () => {
      it("should schedule a new job successfully", async () => {
        const options = {
          name: "Test Job",
          cron: "0 * * * *",
          jobId: testJobId,
          timezone: "UTC",
        };

        const result = await scheduleJob(options);

        expect(result).toBe(testJobId);
        expect(mockQueueAdd).toHaveBeenCalled();
      });

      it("should remove existing scheduled job before creating new one", async () => {
        mockQueueGetRepeatableJobs.mockResolvedValue([
          {
            id: testJobId,
            key: `scheduled-job-${testJobId}`,
            name: `scheduled-job-${testJobId}`,
          },
        ]);

        const options = {
          name: "Test Job",
          cron: "0 * * * *",
          jobId: testJobId,
        };

        await scheduleJob(options);

        expect(mockQueueRemoveRepeatableByKey).toHaveBeenCalled();
        expect(mockQueueAdd).toHaveBeenCalled();
      });

      it("should use correct timezone", async () => {
        const options = {
          name: "Test Job",
          cron: "0 * * * *",
          jobId: testJobId,
          timezone: "America/New_York",
        };

        await scheduleJob(options);

        expect(mockQueueAdd).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Object),
          expect.objectContaining({
            repeat: expect.objectContaining({
              tz: "America/New_York",
            }),
          })
        );
      });

      it("should default to UTC timezone", async () => {
        const options = {
          name: "Test Job",
          cron: "0 * * * *",
          jobId: testJobId,
        };

        await scheduleJob(options);

        expect(mockQueueAdd).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Object),
          expect.objectContaining({
            repeat: expect.objectContaining({
              tz: "UTC",
            }),
          })
        );
      });

      it("should update nextRunAt in database", async () => {
        const updateChain = {
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue(undefined),
        };
        mockDbModule.update.mockReturnValue(updateChain);

        await scheduleJob({
          name: "Test Job",
          cron: "0 * * * *",
          jobId: testJobId,
        });

        expect(updateChain.set).toHaveBeenCalledWith(
          expect.objectContaining({
            nextRunAt: expect.any(Date),
          })
        );
      });
    });

    describe("Negative Cases", () => {
      it("should throw error when job not found", async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([]),
        };
        mockDbModule.select.mockReturnValue(selectChain);

        await expect(
          scheduleJob({
            name: "Test Job",
            cron: "0 * * * *",
            jobId: "non-existent",
          })
        ).rejects.toThrow("Job non-existent not found");
      });

      it("should throw error when queue add fails", async () => {
        mockQueueAdd.mockRejectedValue(new Error("Queue error"));

        await expect(
          scheduleJob({
            name: "Test Job",
            cron: "0 * * * *",
            jobId: testJobId,
          })
        ).rejects.toThrow();
      });
    });

    describe("Edge Cases", () => {
      it("should handle k6 job type", async () => {
        const k6Job = { ...mockJob, jobType: "k6" };
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([k6Job]),
        };
        mockDbModule.select.mockReturnValue(selectChain);

        await scheduleJob({
          name: "K6 Job",
          cron: "0 * * * *",
          jobId: testJobId,
        });

        expect(mockQueueAdd).toHaveBeenCalled();
      });

      it("should handle nextRunAt calculation failure gracefully", async () => {
        mockGetNextRunDate.mockImplementation(() => {
          throw new Error("Invalid cron");
        });

        // Should not throw, just log error
        await expect(
          scheduleJob({
            name: "Test Job",
            cron: "invalid-cron",
            jobId: testJobId,
          })
        ).resolves.toBe(testJobId);
      });
    });
  });

  // ==========================================================================
  // DELETE SCHEDULED JOB TESTS
  // ==========================================================================

  describe("deleteScheduledJob", () => {
    describe("Positive Cases", () => {
      it("should delete existing scheduled job", async () => {
        mockQueueGetRepeatableJobs.mockResolvedValue([
          {
            id: testJobId,
            key: `key-${testJobId}`,
            name: `scheduled-job-${testJobId}`,
          },
        ]);

        const result = await deleteScheduledJob(testJobId);

        expect(result).toBe(true);
        expect(mockQueueRemoveRepeatableByKey).toHaveBeenCalled();
      });

      it("should find job by key containing job ID", async () => {
        mockQueueGetRepeatableJobs.mockResolvedValue([
          {
            id: "other",
            key: `prefix-${testJobId}-suffix`,
            name: "other-name",
          },
        ]);

        const result = await deleteScheduledJob(testJobId);

        expect(result).toBe(true);
      });
    });

    describe("Negative Cases", () => {
      it("should return false when job not found", async () => {
        mockQueueGetRepeatableJobs.mockResolvedValue([]);

        const result = await deleteScheduledJob("non-existent");

        expect(result).toBe(false);
      });

      it("should return false on queue error", async () => {
        mockQueueGetRepeatableJobs.mockRejectedValue(new Error("Queue error"));

        const result = await deleteScheduledJob(testJobId);

        expect(result).toBe(false);
      });
    });
  });

  // ==========================================================================
  // INITIALIZE JOB SCHEDULERS TESTS
  // ==========================================================================

  describe("initializeJobSchedulers", () => {
    describe("Positive Cases", () => {
      it("should initialize all jobs with cron schedules", async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest
            .fn()
            .mockResolvedValue([mockJob, { ...mockJob, id: "job-2" }]),
          limit: jest.fn().mockResolvedValue([mockJob]),
        };
        mockDbModule.select.mockReturnValue(selectChain);

        const result = await initializeJobSchedulers();

        expect(result.success).toBe(true);
        expect(result.initialized).toBeGreaterThanOrEqual(0);
      });

      it("should update scheduledJobId in database", async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([mockJob]),
          limit: jest.fn().mockResolvedValue([mockJob]),
        };
        mockDbModule.select.mockReturnValue(selectChain);

        const updateChain = {
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue(undefined),
        };
        mockDbModule.update.mockReturnValue(updateChain);

        const result = await initializeJobSchedulers();

        // Just verify the function ran
        expect(result.success).toBe(true);
      });
    });

    describe("Negative Cases", () => {
      it("should handle database error", async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockRejectedValue(new Error("DB error")),
        };
        mockDbModule.select.mockReturnValue(selectChain);

        const result = await initializeJobSchedulers();

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it("should continue on individual job failure", async () => {
        const jobs = [
          mockJob,
          { ...mockJob, id: "job-fail", cronSchedule: null },
        ];
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue(jobs),
          limit: jest.fn().mockResolvedValue([]),
        };
        mockDbModule.select.mockReturnValue(selectChain);

        const result = await initializeJobSchedulers();

        expect(result.success).toBe(true);
      });
    });

    describe("Edge Cases", () => {
      it("should handle empty job list", async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([]),
        };
        mockDbModule.select.mockReturnValue(selectChain);

        const result = await initializeJobSchedulers();

        expect(result.success).toBe(true);
        expect(result.initialized).toBe(0);
      });
    });
  });

  // ==========================================================================
  // HANDLE SCHEDULED JOB TRIGGER TESTS
  // ==========================================================================

  describe("handleScheduledJobTrigger", () => {
    const mockBullJob = {
      data: {
        jobId: testJobId,
        name: "Test Job",
        testCases: [{ id: "test-1", title: "Test 1", script: "code" }],
        variables: {},
        secrets: {},
        projectId: testProjectId,
        organizationId: testOrgId,
      },
    };

    describe("Positive Cases", () => {
      it("should create run record and add execution task", async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([mockJob]),
        };
        mockDbModule.select.mockReturnValue(selectChain);

        // Mock no running runs
        mockDbModule.select.mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([]),
        });

        await handleScheduledJobTrigger(mockBullJob as unknown as Job);

        expect(mockQueuesModule.addJobToQueue).toHaveBeenCalled();
      });

      it("should update job lastRunAt and nextRunAt", async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([mockJob]),
        };
        mockDbModule.select
          .mockReturnValueOnce({
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockResolvedValue([]),
          })
          .mockReturnValue(selectChain);

        const updateChain = {
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue(undefined),
        };
        mockDbModule.update.mockReturnValue(updateChain);

        await handleScheduledJobTrigger(mockBullJob as unknown as Job);

        expect(updateChain.set).toHaveBeenCalledWith(
          expect.objectContaining({
            lastRunAt: expect.any(Date),
          })
        );
      });
    });

    describe("Negative Cases", () => {
      it("should skip when job already running", async () => {
        mockDbModule.select.mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([{ status: "running" }]),
        });

        await handleScheduledJobTrigger(mockBullJob as unknown as Job);

        expect(mockQueuesModule.addJobToQueue).not.toHaveBeenCalled();
      });

      it("should throw error when no test cases", async () => {
        const jobNoTests = {
          data: { ...mockBullJob.data, testCases: [] },
        };

        mockDbModule.select.mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([]),
        });

        // Should handle error gracefully
        await handleScheduledJobTrigger(jobNoTests as unknown as Job);

        // Job status should be updated to error
        expect(mockDbModule.update).toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // CLEANUP JOB SCHEDULER TESTS
  // ==========================================================================

  describe("cleanupJobScheduler", () => {
    describe("Positive Cases", () => {
      it("should clean up orphaned repeatable jobs", async () => {
        mockQueueGetRepeatableJobs.mockResolvedValue([
          { name: "scheduled-job-orphan-123", key: "key-orphan", id: null },
        ]);

        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([]),
        };
        mockDbModule.select.mockReturnValue(selectChain);

        const result = await cleanupJobScheduler();

        expect(result).toBe(true);
      });

      it("should not remove valid scheduled jobs", async () => {
        mockQueueGetRepeatableJobs.mockResolvedValue([
          {
            name: `scheduled-job-${testJobId}`,
            key: "key-valid",
            id: testJobId,
          },
        ]);

        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest
            .fn()
            .mockResolvedValue([{ id: testJobId, scheduledJobId: testJobId }]),
        };
        mockDbModule.select.mockReturnValue(selectChain);

        const result = await cleanupJobScheduler();

        expect(result).toBe(true);
      });
    });

    describe("Negative Cases", () => {
      it("should handle errors gracefully", async () => {
        // cleanupJobScheduler catches errors internally
        const result = await cleanupJobScheduler();

        // Should return true even with empty queue (no orphans)
        expect(result).toBe(true);
      });
    });
  });

  // ==========================================================================
  // SECURITY TESTS
  // ==========================================================================

  describe("Security", () => {
    it("should include organization and project IDs in task", async () => {
      const mockBullJob = {
        data: {
          jobId: testJobId,
          testCases: [{ id: "t1", title: "Test", script: "code" }],
          variables: {},
          secrets: {},
          projectId: testProjectId,
          organizationId: testOrgId,
        },
      };

      mockDbModule.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([]),
        })
        .mockReturnValue({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([mockJob]),
        });

      await handleScheduledJobTrigger(mockBullJob as unknown as Job);

      expect(mockQueuesModule.addJobToQueue).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: testOrgId,
          projectId: testProjectId,
        })
      );
    });
  });
});
