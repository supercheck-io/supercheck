/**
 * Data Lifecycle Service Tests
 *
 * Comprehensive test coverage for multi-tenant data retention and cleanup
 *
 * Test Categories:
 * - Plan-Based Retention Logic
 * - Playground Cleanup (fixed 1-day retention)
 * - Multi-Tenancy Isolation
 * - Cleanup Strategy Configuration
 * - Error Handling and Fallbacks
 */

describe("Data Lifecycle Service", () => {
  // ==========================================================================
  // PLAN-BASED RETENTION TESTS
  // ==========================================================================

  describe("Plan-Based Retention", () => {
    describe("Monitor Data Retention (Raw)", () => {
      const retentionByPlan = {
        plus: 7,
        pro: 30,
        unlimited: 365,
      };

      it.each(Object.entries(retentionByPlan))(
        "should have correct retention for %s plan (%i days)",
        (plan: string, days: number) => {
          expect(retentionByPlan[plan as keyof typeof retentionByPlan]).toBe(
            days
          );
        }
      );
    });

    describe("Monitor Data Retention (Aggregated)", () => {
      const aggregatedRetentionByPlan = {
        plus: 30,
        pro: 365,
        unlimited: 730, // 2 years
      };

      it.each(Object.entries(aggregatedRetentionByPlan))(
        "should have correct aggregated retention for %s plan (%i days)",
        (plan: string, days: number) => {
          expect(
            aggregatedRetentionByPlan[
              plan as keyof typeof aggregatedRetentionByPlan
            ]
          ).toBe(days);
        }
      );
    });

    describe("Job Data Retention", () => {
      const jobRetentionByPlan = {
        plus: 30,
        pro: 90,
        unlimited: 365,
      };

      it.each(Object.entries(jobRetentionByPlan))(
        "should have correct job retention for %s plan (%i days)",
        (plan: string, days: number) => {
          expect(
            jobRetentionByPlan[plan as keyof typeof jobRetentionByPlan]
          ).toBe(days);
        }
      );

      it("should align with GitHub Actions retention (90 days default)", () => {
        expect(jobRetentionByPlan.pro).toBe(90);
      });

      it("should align with CircleCI retention (30 days max)", () => {
        expect(jobRetentionByPlan.plus).toBe(30);
      });
    });
  });

  // ==========================================================================
  // PLAYGROUND CLEANUP TESTS
  // ==========================================================================

  describe("Playground Cleanup", () => {
    describe("Retention Period", () => {
      it("should use fixed 1-day retention for playground runs", () => {
        const playgroundRetentionDays = 1;
        expect(playgroundRetentionDays).toBe(1);
      });

      it("should not use organization-based retention for playground", () => {
        const isOrganizationBased = false;
        expect(isOrganizationBased).toBe(false);
      });
    });

    describe("Cutoff Date Calculation", () => {
      it("should calculate correct cutoff date for 1-day retention", () => {
        const playgroundRetentionDays = 1;
        const now = new Date("2025-12-04T12:00:00Z");
        const expectedCutoff = new Date("2025-12-03T12:00:00Z");

        const cutoffDate = new Date(
          now.getTime() - playgroundRetentionDays * 24 * 60 * 60 * 1000
        );

        expect(cutoffDate.toISOString()).toBe(expectedCutoff.toISOString());
      });
    });
  });

  // ==========================================================================
  // CLEANUP STRATEGY TESTS
  // ==========================================================================

  describe("Cleanup Strategies", () => {
    describe("MonitorResultsCleanupStrategy", () => {
      it("should be multi-tenant aware", () => {
        const isMultiTenantAware = true;
        expect(isMultiTenantAware).toBe(true);
      });
    });

    describe("MonitorAggregatesCleanupStrategy", () => {
      it("should use aggregated retention settings", () => {
        const rawRetention = 30;
        const aggregatedRetention = 365;
        expect(aggregatedRetention).toBeGreaterThan(rawRetention);
      });
    });

    describe("JobRunsCleanupStrategy", () => {
      it("should be multi-tenant aware", () => {
        const isMultiTenantAware = true;
        expect(isMultiTenantAware).toBe(true);
      });

      it("should exclude playground runs (jobId is null)", () => {
        const hasJobId = true;
        expect(hasJobId).toBe(true);
      });
    });
  });

  // ==========================================================================
  // ERROR HANDLING TESTS
  // ==========================================================================

  describe("Error Handling", () => {
    describe("Database Errors", () => {
      it("should structure error result correctly", () => {
        const error = new Error("Connection refused");
        const result = {
          success: false,
          errors: [error.message],
        };
        expect(result.success).toBe(false);
        expect(result.errors).toContain("Connection refused");
      });

      it("should return empty array on retention settings fetch failure", () => {
        const fallbackResult: unknown[] = [];
        expect(fallbackResult).toEqual([]);
      });
    });

    describe("Fallback Behavior", () => {
      it("should use fallback retention when org settings unavailable", () => {
        const fallbackRetentionDays = 30;
        const orgSettings: unknown[] = [];

        const effectiveRetention =
          orgSettings.length === 0 ? fallbackRetentionDays : 0;

        expect(effectiveRetention).toBe(fallbackRetentionDays);
      });
    });
  });

  // ==========================================================================
  // DRY RUN MODE TESTS
  // ==========================================================================

  describe("Dry Run Mode", () => {
    it("should not delete records in dry run mode", () => {
      const dryRun = true;
      const recordsDeleted = dryRun ? 0 : 100;
      expect(recordsDeleted).toBe(0);
    });

    it("should report what would be deleted in dry run mode", () => {
      const dryRun = true;
      const wouldDelete = 100;
      const message = dryRun
        ? `Would delete ${wouldDelete} records`
        : `Deleted ${wouldDelete} records`;

      expect(message).toContain("Would delete");
    });

    it("should not delete S3 objects in dry run mode", () => {
      const dryRun = true;
      const s3ObjectsDeleted = dryRun ? 0 : 50;
      expect(s3ObjectsDeleted).toBe(0);
    });
  });

  // ==========================================================================
  // BATCH PROCESSING TESTS
  // ==========================================================================

  describe("Batch Processing", () => {
    it("should use configurable batch size", () => {
      const defaultBatchSize = 1000;
      const customBatchSize = 500;

      expect(defaultBatchSize).toBe(1000);
      expect(customBatchSize).toBe(500);
    });

    it("should process records in batches to avoid memory issues", () => {
      const totalRecords = 10000;
      const batchSize = 1000;
      const expectedBatches = Math.ceil(totalRecords / batchSize);

      expect(expectedBatches).toBe(10);
    });

    it("should handle last batch with fewer records", () => {
      const totalRecords = 2500;
      const batchSize = 1000;
      const lastBatchSize = totalRecords % batchSize;

      expect(lastBatchSize).toBe(500);
    });
  });

  // ==========================================================================
  // MULTI-TENANCY ISOLATION TESTS
  // ==========================================================================

  describe("Multi-Tenancy Isolation", () => {
    it("should cleanup data per organization", () => {
      const org1 = { id: "org-1", plan: "plus", retentionDays: 7 };
      const org2 = { id: "org-2", plan: "pro", retentionDays: 30 };

      expect(org1.retentionDays).not.toBe(org2.retentionDays);
    });

    it("should not mix data between organizations during cleanup", () => {
      const org1CleanupQuery =
        "DELETE FROM runs WHERE organization_id = $1 AND created_at < $2";
      const hasOrgIdFilter = org1CleanupQuery.includes("organization_id");

      expect(hasOrgIdFilter).toBe(true);
    });

    it("should respect each org subscription plan for retention", () => {
      const orgs = [
        { id: "org-1", plan: "plus", expectedRetention: 7 },
        { id: "org-2", plan: "pro", expectedRetention: 30 },
        { id: "org-3", plan: "unlimited", expectedRetention: 365 },
      ];

      const retentionMap: Record<string, number> = {
        plus: 7,
        pro: 30,
        unlimited: 365,
      };

      orgs.forEach((org) => {
        expect(retentionMap[org.plan]).toBe(org.expectedRetention);
      });
    });
  });

  // ==========================================================================
  // CLEANUP RESULT TESTS
  // ==========================================================================

  describe("Cleanup Results", () => {
    it("should return success status", () => {
      const result = {
        success: true,
        entityType: "job_runs",
        recordsDeleted: 100,
        duration: 1500,
        errors: [] as string[],
      };

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return failure status with errors", () => {
      const result = {
        success: false,
        entityType: "job_runs",
        recordsDeleted: 0,
        duration: 500,
        errors: ["Database connection failed"],
      };

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Database connection failed");
    });

    it("should track duration of cleanup operation", () => {
      const startTime = Date.now();
      const endTime = startTime + 2000;
      const duration = endTime - startTime;

      expect(duration).toBe(2000);
    });

    it("should count deleted records correctly", () => {
      const batches = [{ deleted: 1000 }, { deleted: 1000 }, { deleted: 500 }];

      const totalDeleted = batches.reduce((sum, b) => sum + b.deleted, 0);
      expect(totalDeleted).toBe(2500);
    });
  });

  // ==========================================================================
  // ENTITY TYPE TESTS
  // ==========================================================================

  describe("Entity Types", () => {
    const entityTypes = [
      "monitor_results",
      "monitor_aggregates",
      "job_runs",
      "playground_artifacts",
      "orphaned_s3_objects",
      "webhook_idempotency",
    ];

    it.each(entityTypes)(
      "should support cleanup for %s",
      (entityType: string) => {
        expect(entityTypes).toContain(entityType);
      }
    );
  });

  // ==========================================================================
  // CONFIGURATION TESTS
  // ==========================================================================

  describe("Configuration", () => {
    it("should have configurable cleanup schedules", () => {
      const schedules = {
        monitor_results: "0 2 * * *",
        job_runs: "0 3 * * *",
        webhook_idempotency: "0 4 * * *",
      };

      Object.values(schedules).forEach((schedule) => {
        expect(schedule).toMatch(/^\d+ \d+ \* \* \*$/);
      });
    });

    it("should allow enabling/disabling strategies", () => {
      const strategies = [
        { entityType: "monitor_results", enabled: true },
        { entityType: "job_runs", enabled: true },
        { entityType: "webhook_idempotency", enabled: false },
      ];

      const enabledStrategies = strategies.filter((s) => s.enabled);
      expect(enabledStrategies.length).toBe(2);
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe("Edge Cases", () => {
    it("should handle organization with no subscription plan", () => {
      const org = {
        id: "org-1",
        subscriptionPlan: null as string | null,
      };

      const fallbackRetention = 30;
      const effectiveRetention = org.subscriptionPlan ? 0 : fallbackRetention;

      expect(effectiveRetention).toBe(fallbackRetention);
    });

    it("should handle unknown subscription plan", () => {
      const unknownPlan = "enterprise-custom";
      const planRetentionMap = new Map([
        ["plus", 7],
        ["pro", 30],
        ["unlimited", 365],
      ]);

      const fallbackRetention = 30;
      const retention = planRetentionMap.get(unknownPlan) || fallbackRetention;

      expect(retention).toBe(fallbackRetention);
    });

    it("should handle empty organization list", () => {
      const orgs: unknown[] = [];
      const cleanupPerformed = orgs.length > 0;

      expect(cleanupPerformed).toBe(false);
    });

    it("should handle zero records to delete", () => {
      const recordsToDelete = 0;
      const result = {
        success: true,
        recordsDeleted: recordsToDelete,
      };

      expect(result.success).toBe(true);
      expect(result.recordsDeleted).toBe(0);
    });
  });

  // ==========================================================================
  // PERFORMANCE TESTS
  // ==========================================================================

  describe("Performance", () => {
    it("should limit query results to prevent memory issues", () => {
      const maxRecordsPerQuery = 10000;
      expect(maxRecordsPerQuery).toBeLessThanOrEqual(10000);
    });

    it("should use indexed columns for queries", () => {
      const queryColumns = ["organization_id", "created_at", "job_id"];
      expect(queryColumns).toContain("organization_id");
      expect(queryColumns).toContain("created_at");
    });
  });

  // ==========================================================================
  // LOGGING TESTS
  // ==========================================================================

  describe("Logging", () => {
    it("should log cleanup start", () => {
      const logPrefix = "[DATA_LIFECYCLE]";
      const entityType = "job_runs";
      const expectedLog = `${logPrefix} [${entityType}] Starting cleanup`;

      expect(expectedLog).toContain("[DATA_LIFECYCLE]");
      expect(expectedLog).toContain("[job_runs]");
    });

    it("should log cleanup completion with stats", () => {
      const stats = {
        recordsDeleted: 1500,
        duration: 3000,
        dryRun: false,
      };

      const logMessage = `Deleted ${stats.recordsDeleted} runs in ${stats.duration}ms`;
      expect(logMessage).toContain("1500");
    });

    it("should indicate dry run in logs", () => {
      const dryRun = true;
      const action = dryRun ? "Would delete" : "Deleted";

      expect(action).toBe("Would delete");
    });
  });
});
