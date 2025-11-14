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
 * Handles report discovery, processing, uploading, and cleanup
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
   * Searches for reports in standard locations and handles upload
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
    let reportFound = false;
    let s3Url: string | null = null;

    // Location 1: Check custom output directory (report-{testId})
    const customOutputDir = path.join(
      runDir,
      `report-${testId.substring(0, 8)}`,
    );

    if (existsSync(customOutputDir)) {
      const result = await this._uploadFromDirectory(
        customOutputDir,
        s3ReportKeyPrefix,
        testBucket,
        executionId,
        entityType,
        testId,
        processReportFiles,
      );

      if (result.success) {
        reportFound = true;
        s3Url =
          this.s3Service.getBaseUrlForEntity(entityType, executionId) +
          '/index.html';
        return { success: true, reportUrl: s3Url };
      }
    }

    // Location 2: Check default Playwright report directory (pw-report)
    if (!reportFound) {
      const playwrightReportDir = path.join(runDir, 'pw-report');

      if (existsSync(playwrightReportDir)) {
        const result = await this._uploadFromDirectory(
          playwrightReportDir,
          s3ReportKeyPrefix,
          testBucket,
          executionId,
          entityType,
          testId,
          processReportFiles,
        );

        if (result.success) {
          reportFound = true;
          s3Url =
            this.s3Service.getBaseUrlForEntity(entityType, executionId) +
            '/index.html';
          return { success: true, reportUrl: s3Url };
        }
      }
    }

    // No report found in any location
    if (!reportFound) {
      const warning = `No HTML report found in any expected location for test ${testId}`;
      this.logger.warn(warning);
      return {
        success: false,
        reportUrl: null,
        error: 'Report not found',
      };
    }

    return { success: true, reportUrl: s3Url };
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

      // Note: Local directory cleanup removed - execution now runs in containers
      // Container cleanup is automatic and handles all temporary files

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

      let htmlContent = await fs.readFile(indexPath, 'utf-8');

      // Fix trace file references to work with S3
      // Replace relative paths with absolute S3 paths
      htmlContent = htmlContent.replace(/href="\.\/data\//g, `href="./data/`);
      htmlContent = htmlContent.replace(/src="\.\/data\//g, `src="./data/`);

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
