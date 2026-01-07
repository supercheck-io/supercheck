/**
 * Requirement Coverage Service Tests
 *
 * Test coverage for coverage computation after job runs
 *
 * Test Categories:
 * - Coverage Status Rules (covered, failing, missing)
 * - Input Validation
 * - Error Handling
 * - Edge Cases
 */

import { Test, TestingModule } from '@nestjs/testing';
import { RequirementCoverageService } from './requirement-coverage.service';
import { DbService } from './db.service';

describe('RequirementCoverageService', () => {
  let service: RequirementCoverageService;
  let dbService: jest.Mocked<DbService>;

  const testJobId = 'job-test-123';
  const testOrgId = 'org-test-456';
  const testProjectId = 'project-test-789';
  const testRequirementId = 'req-test-111';

  beforeEach(async () => {
    const mockDbService = {
      getRequirementsByJobTests: jest.fn(),
      getLinkedTestsWithStatus: jest.fn(),
      updateRequirementCoverageSnapshot: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequirementCoverageService,
        {
          provide: DbService,
          useValue: mockDbService,
        },
      ],
    }).compile();

    service = module.get<RequirementCoverageService>(RequirementCoverageService);
    dbService = module.get(DbService);
  });

  // ==========================================================================
  // INPUT VALIDATION TESTS
  // ==========================================================================

  describe('Input Validation', () => {
    it('should handle invalid jobId gracefully', async () => {
      await service.updateCoverageAfterJobRun('', testOrgId, testProjectId);

      expect(dbService.getRequirementsByJobTests).not.toHaveBeenCalled();
    });

    it('should handle invalid organizationId gracefully', async () => {
      await service.updateCoverageAfterJobRun(testJobId, '', testProjectId);

      expect(dbService.getRequirementsByJobTests).not.toHaveBeenCalled();
    });

    it('should handle null/undefined inputs gracefully', async () => {
      await service.updateCoverageAfterJobRun(
        null as unknown as string,
        testOrgId,
        testProjectId,
      );

      expect(dbService.getRequirementsByJobTests).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // COVERAGE STATUS RULES TESTS
  // ==========================================================================

  describe('Coverage Status Rules', () => {
    beforeEach(() => {
      dbService.getRequirementsByJobTests.mockResolvedValue([testRequirementId]);
    });

    it('should set status to "missing" when no tests are linked', async () => {
      dbService.getLinkedTestsWithStatus.mockResolvedValue([]);

      await service.updateCoverageAfterJobRun(testJobId, testOrgId, testProjectId);

      expect(dbService.updateRequirementCoverageSnapshot).toHaveBeenCalledWith(
        testRequirementId,
        testOrgId,
        expect.objectContaining({
          status: 'missing',
          linkedTestCount: 0,
          passedTestCount: 0,
          failedTestCount: 0,
        }),
      );
    });

    it('should set status to "missing" when all linked tests have null status', async () => {
      dbService.getLinkedTestsWithStatus.mockResolvedValue([
        { testId: 'test-1', status: null },
        { testId: 'test-2', status: null },
      ]);

      await service.updateCoverageAfterJobRun(testJobId, testOrgId, testProjectId);

      expect(dbService.updateRequirementCoverageSnapshot).toHaveBeenCalledWith(
        testRequirementId,
        testOrgId,
        expect.objectContaining({
          status: 'missing',
          linkedTestCount: 2,
          passedTestCount: 0,
          failedTestCount: 0,
        }),
      );
    });

    it('should set status to "failing" when any test has failed', async () => {
      dbService.getLinkedTestsWithStatus.mockResolvedValue([
        { testId: 'test-1', status: 'passed' },
        { testId: 'test-2', status: 'failed' },
        { testId: 'test-3', status: 'passed' },
      ]);

      await service.updateCoverageAfterJobRun(testJobId, testOrgId, testProjectId);

      expect(dbService.updateRequirementCoverageSnapshot).toHaveBeenCalledWith(
        testRequirementId,
        testOrgId,
        expect.objectContaining({
          status: 'failing',
          linkedTestCount: 3,
          passedTestCount: 2,
          failedTestCount: 1,
        }),
      );
    });

    it('should set status to "covered" when all tests pass', async () => {
      dbService.getLinkedTestsWithStatus.mockResolvedValue([
        { testId: 'test-1', status: 'passed' },
        { testId: 'test-2', status: 'passed' },
      ]);

      await service.updateCoverageAfterJobRun(testJobId, testOrgId, testProjectId);

      expect(dbService.updateRequirementCoverageSnapshot).toHaveBeenCalledWith(
        testRequirementId,
        testOrgId,
        expect.objectContaining({
          status: 'covered',
          linkedTestCount: 2,
          passedTestCount: 2,
          failedTestCount: 0,
        }),
      );
    });

    it('should set status to "covered" when all run tests pass (some pending)', async () => {
      dbService.getLinkedTestsWithStatus.mockResolvedValue([
        { testId: 'test-1', status: 'passed' },
        { testId: 'test-2', status: null }, // Pending
      ]);

      await service.updateCoverageAfterJobRun(testJobId, testOrgId, testProjectId);

      expect(dbService.updateRequirementCoverageSnapshot).toHaveBeenCalledWith(
        testRequirementId,
        testOrgId,
        expect.objectContaining({
          status: 'covered',
          passedTestCount: 1,
          failedTestCount: 0,
        }),
      );
    });

    it('should track lastFailedTestId when test fails', async () => {
      const failedTestId = 'test-failed';
      dbService.getLinkedTestsWithStatus.mockResolvedValue([
        { testId: 'test-1', status: 'passed' },
        { testId: failedTestId, status: 'failed' },
      ]);

      await service.updateCoverageAfterJobRun(testJobId, testOrgId, testProjectId);

      expect(dbService.updateRequirementCoverageSnapshot).toHaveBeenCalledWith(
        testRequirementId,
        testOrgId,
        expect.objectContaining({
          lastFailedTestId: failedTestId,
          lastFailedAt: expect.any(Date),
        }),
      );
    });
  });

  // ==========================================================================
  // MULTIPLE REQUIREMENTS TESTS
  // ==========================================================================

  describe('Multiple Requirements', () => {
    it('should update coverage for all affected requirements', async () => {
      const reqIds = ['req-1', 'req-2', 'req-3'];
      dbService.getRequirementsByJobTests.mockResolvedValue(reqIds);
      dbService.getLinkedTestsWithStatus.mockResolvedValue([
        { testId: 'test-1', status: 'passed' },
      ]);

      await service.updateCoverageAfterJobRun(testJobId, testOrgId, testProjectId);

      expect(dbService.updateRequirementCoverageSnapshot).toHaveBeenCalledTimes(3);
    });

    it('should skip null requirement IDs', async () => {
      dbService.getRequirementsByJobTests.mockResolvedValue([
        'req-1',
        undefined as unknown as string,
        'req-2',
      ]);
      dbService.getLinkedTestsWithStatus.mockResolvedValue([]);

      await service.updateCoverageAfterJobRun(testJobId, testOrgId, testProjectId);

      // Should only be called for valid IDs
      expect(dbService.getLinkedTestsWithStatus).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // ERROR HANDLING TESTS
  // ==========================================================================

  describe('Error Handling', () => {
    it('should not throw when no requirements are linked to job', async () => {
      dbService.getRequirementsByJobTests.mockResolvedValue([]);

      await expect(
        service.updateCoverageAfterJobRun(testJobId, testOrgId, testProjectId),
      ).resolves.not.toThrow();
    });

    it('should not throw when getRequirementsByJobTests fails', async () => {
      dbService.getRequirementsByJobTests.mockRejectedValue(new Error('DB error'));

      await expect(
        service.updateCoverageAfterJobRun(testJobId, testOrgId, testProjectId),
      ).resolves.not.toThrow();
    });

    it('should continue processing other requirements when one fails', async () => {
      dbService.getRequirementsByJobTests.mockResolvedValue(['req-1', 'req-2']);
      dbService.getLinkedTestsWithStatus
        .mockRejectedValueOnce(new Error('Error for req-1'))
        .mockResolvedValueOnce([{ testId: 'test-1', status: 'passed' }]);

      await service.updateCoverageAfterJobRun(testJobId, testOrgId, testProjectId);

      // Should still try to update req-2
      expect(dbService.getLinkedTestsWithStatus).toHaveBeenCalledTimes(2);
      expect(dbService.updateRequirementCoverageSnapshot).toHaveBeenCalledTimes(1);
    });
  });
});
