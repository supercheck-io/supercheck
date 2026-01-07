import { Injectable, Logger } from '@nestjs/common';
import { DbService } from './db.service';

/**
 * Service responsible for updating requirement coverage snapshots after job completion.
 * Coverage status rules per REQUIREMENTS_SYSTEM.md spec:
 * - "covered": ALL linked tests have passed in their most recent execution
 * - "failing": ANY linked test has failed in their most recent execution
 * - "missing": No tests are linked to the requirement OR no tests have run status
 */
@Injectable()
export class RequirementCoverageService {
  private readonly logger = new Logger(RequirementCoverageService.name);

  constructor(private readonly dbService: DbService) {}

  /**
   * Update coverage for all requirements affected by a job run.
   * Called after job completion to maintain coverage snapshots.
   *
   * @param jobId - The completed job ID
   * @param organizationId - Organization for RBAC filtering
   * @param projectId - Project for scope (currently unused but may be needed for caching)
   */
  async updateCoverageAfterJobRun(
    jobId: string,
    organizationId: string,
    _projectId: string,
  ): Promise<void> {
    // Input validation
    if (!jobId || typeof jobId !== 'string') {
      this.logger.warn('Invalid jobId provided to updateCoverageAfterJobRun');
      return;
    }
    if (!organizationId || typeof organizationId !== 'string') {
      this.logger.warn(
        'Invalid organizationId provided to updateCoverageAfterJobRun',
      );
      return;
    }

    try {
      // 1. Get all requirements linked to tests in this job
      const requirementIds = await this.dbService.getRequirementsByJobTests(
        jobId,
        organizationId,
      );

      if (!requirementIds || requirementIds.length === 0) {
        this.logger.debug(`No requirements linked to job ${jobId}`);
        return;
      }

      this.logger.log(
        `Updating coverage for ${requirementIds.length} requirements after job ${jobId}`,
      );

      // 2. Update each requirement's coverage snapshot
      // Process sequentially to avoid overwhelming the database
      for (const reqId of requirementIds) {
        if (reqId && typeof reqId === 'string') {
          await this.updateRequirementCoverage(reqId, organizationId);
        }
      }

      this.logger.log(`Coverage update complete for job ${jobId}`);
    } catch (error) {
      // Log but don't throw - coverage update failures shouldn't break job completion
      this.logger.error(
        `Failed to update coverage after job ${jobId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Compute and update coverage for a single requirement.
   * Fetches all linked tests, their statuses, and determines the overall coverage status.
   *
   * Edge cases handled:
   * - No tests linked -> "missing"
   * - Tests linked but none have run yet (all null status) -> "missing"
   * - At least one test has run and failed -> "failing"
   * - All tests that have run passed -> "covered"
   */
  private async updateRequirementCoverage(
    requirementId: string,
    organizationId: string,
  ): Promise<void> {
    try {
      const linkedTests = await this.dbService.getLinkedTestsWithStatus(
        requirementId,
        organizationId,
      );

      const linkedCount = linkedTests?.length ?? 0;

      // No tests linked = "missing" coverage
      if (linkedCount === 0) {
        await this.dbService.updateRequirementCoverageSnapshot(
          requirementId,
          organizationId,
          {
            status: 'missing',
            linkedTestCount: 0,
            passedTestCount: 0,
            failedTestCount: 0,
          },
        );
        return;
      }

      // Count test statuses
      const passedCount = linkedTests.filter((t) => t.status === 'passed').length;
      const failedCount = linkedTests.filter((t) => t.status === 'failed').length;
      const pendingCount = linkedTests.filter((t) => t.status === null).length;
      const failedTest = linkedTests.find((t) => t.status === 'failed');

      // Coverage rules:
      // - If no tests have run yet (all null) -> "missing"
      // - If ANY test has failed -> "failing"
      // - If all tests that have run passed -> "covered"
      let status: 'covered' | 'failing' | 'missing';

      if (passedCount === 0 && failedCount === 0) {
        // No tests have run yet
        status = 'missing';
      } else if (failedCount > 0) {
        // At least one test failed
        status = 'failing';
      } else {
        // All tests that have run passed
        status = 'covered';
      }

      await this.dbService.updateRequirementCoverageSnapshot(
        requirementId,
        organizationId,
        {
          status,
          linkedTestCount: linkedCount,
          passedTestCount: passedCount,
          failedTestCount: failedCount,
          lastFailedTestId: failedTest?.testId,
          lastFailedAt: failedTest ? new Date() : undefined,
        },
      );

      this.logger.debug(
        `Requirement ${requirementId}: ${status} (${passedCount} passed, ${failedCount} failed, ${pendingCount} pending)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update coverage for requirement ${requirementId}: ${(error as Error).message}`,
      );
      // Don't throw - continue with other requirements
    }
  }
}
