/**
 * Report Upload Service
 * Handles the uploading of Playwright test reports to S3
 * Eliminates code duplication across execution and monitor services
 */

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { S3Service } from '../../execution/services/s3.service';
import { pathExists } from '../utils/file-search';

export interface ReportUploadResult {
  success: boolean;
  reportUrl: string | null;
  error?: string;
}

export interface ReportUploadOptions {
  runDir: string;
  testId: string;
  executionId: string;
  s3ReportKeyPrefix: string;
  entityType: 'test' | 'job' | 'monitor';
  processReportFiles?: boolean;
}

/**
 * Service responsible for uploading Playwright HTML reports to S3
 * Handles generated report processing, uploading, and cleanup
 */
@Injectable()
export class ReportUploadService {
  private readonly logger = new Logger(ReportUploadService.name);

  constructor(
    @Inject(forwardRef(() => S3Service))
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Upload a Playwright report to S3
   * Uploads the configured reporter's extracted HTML directory
   *
   * @param options Report upload configuration
   * @returns Upload result with S3 URL or error
   */
  async uploadReport(
    options: ReportUploadOptions,
  ): Promise<ReportUploadResult> {
    const {
      runDir,
      testId,
      executionId,
      s3ReportKeyPrefix,
      entityType,
      processReportFiles = true,
    } = options;
    const testBucket = this.s3Service.getBucketForEntityType(entityType);
    // Only trust the configured reporter output; other extracted HTML may be test-authored.
    const reportDir = path.join(runDir, 'html');
    if (!(await pathExists(reportDir))) {
      this.logger.warn(`No generated HTML report found for test ${testId}`);
      return { success: false, reportUrl: null, error: 'Report not found' };
    }

    const result = await this._uploadFromDirectory(
      reportDir,
      s3ReportKeyPrefix,
      testBucket,
      executionId,
      entityType,
      testId,
      processReportFiles,
    );
    if (result.success) {
      return {
        success: true,
        reportUrl:
          this.s3Service.getBaseUrlForEntity(entityType, executionId) +
          '/index.html',
      };
    }

    const error =
      result.error === 'No index.html found'
        ? 'Report not found'
        : result.error || 'Report upload failed';
    this.logger.warn(`HTML report upload failed for test ${testId}: ${error}`);
    return { success: false, reportUrl: null, error };
  }

  /**
   * Upload report from a specific directory
   * @private
   */
  private async _uploadFromDirectory(
    dirPath: string,
    s3ReportKeyPrefix: string,
    testBucket: string,
    executionId: string,
    entityType: string,
    testId: string,
    processReportFiles: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const reportFiles = await fs.readdir(dirPath);

      // Verify index.html exists
      if (!reportFiles.includes('index.html')) {
        return { success: false, error: 'No index.html found' };
      }

      // Process report files if needed (fix trace URLs for S3)
      if (processReportFiles) {
        await this._processReportFilesForS3(dirPath, executionId);
      }

      // Upload to S3
      await this.s3Service.uploadDirectory(
        dirPath,
        s3ReportKeyPrefix,
        testBucket,
        executionId,
        entityType,
      );

      // Note: Local directory cleanup is now handled by the execution service's finally block
      // after report upload completes, preventing disk space exhaustion

      return { success: true };
    } catch (error) {
      this.logger.error(
        `Report upload failed from ${dirPath} for test ${testId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Process report files to fix trace URLs for S3 compatibility
   * @private
   */
  private async _processReportFilesForS3(
    reportDir: string,
    executionId: string,
  ): Promise<void> {
    try {
      const indexPath = path.join(reportDir, 'index.html');

      if (!existsSync(indexPath)) {
        return;
      }

      const htmlContent = await fs.readFile(indexPath, 'utf-8');

      // NOTE: Previously had no-op replacements here (replacing ./data/ with ./data/)
      // The report files are already using relative paths which work correctly with S3
      // If S3 path fixing is needed in the future, implement actual path transformation

      await fs.writeFile(indexPath, htmlContent, 'utf-8');
    } catch (error) {
      this.logger.warn(
        `Failed to process report files for execution ${executionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Non-critical error, continue with upload
    }
  }

  /**
   * Get the expected report S3 URL for an entity
   *
   * @param entityType Type of entity (test, job, monitor)
   * @param executionId Execution ID
   * @returns Expected S3 URL for the report
   */
  getExpectedReportUrl(
    entityType: 'test' | 'job' | 'monitor',
    executionId: string,
  ): string {
    return (
      this.s3Service.getBaseUrlForEntity(entityType, executionId) +
      '/index.html'
    );
  }
}
