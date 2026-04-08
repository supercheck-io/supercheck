import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getContentType } from '../services/execution.service';
import { MEMORY_LIMITS } from '../../common/constants/memory.constants';

// Utility function to safely get error message
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Utility function to safely get error stack
function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}

/**
 * S3 Bucket Entity Types
 * - 'test': Playwright playground runs -> playwright-test-artifacts
 * - 'job': Playwright scheduled jobs -> playwright-job-artifacts
 * - 'monitor': Monitor health checks -> playwright-monitor-artifacts
 * - 'k6_test': K6 playground runs -> k6-test-artifacts
 * - 'k6_job': K6 scheduled jobs -> k6-job-artifacts
 * - 'status': Status page assets -> status-page-artifacts
 */
export type S3EntityType =
  | 'test'
  | 'job'
  | 'monitor'
  | 'k6_test'
  | 'k6_job'
  | 'status'
  | 'requirements'
  | 'project_data_files';

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);
  private s3Client: S3Client;

  // Playwright buckets
  private readonly testBucketName: string;
  private readonly jobBucketName: string;
  private readonly monitorBucketName: string;

  // K6 buckets
  private readonly k6TestBucketName: string;
  private readonly k6JobBucketName: string;

  // Status page bucket
  private readonly statusBucketName: string;

  // Requirements bucket
  private readonly requirementsBucketName: string;

  // Project data files bucket (file-type variables)
  private readonly projectDataFilesBucketName: string;

  private readonly s3Endpoint: string;
  private readonly maxRetries: number;
  private readonly operationTimeout: number;

  constructor(private configService: ConfigService) {
    // Playwright buckets
    this.testBucketName = this.configService.get<string>(
      'S3_TEST_BUCKET_NAME',
      'playwright-test-artifacts',
    );
    this.jobBucketName = this.configService.get<string>(
      'S3_JOB_BUCKET_NAME',
      'playwright-job-artifacts',
    );
    this.monitorBucketName = this.configService.get<string>(
      'S3_MONITOR_BUCKET_NAME',
      'playwright-monitor-artifacts',
    );

    // K6 buckets
    this.k6TestBucketName = this.configService.get<string>(
      'S3_K6_TEST_BUCKET_NAME',
      'k6-test-artifacts',
    );
    this.k6JobBucketName = this.configService.get<string>(
      'S3_K6_JOB_BUCKET_NAME',
      'k6-job-artifacts',
    );

    // Status page bucket
    this.statusBucketName = this.configService.get<string>(
      'S3_STATUS_BUCKET_NAME',
      'status-page-artifacts',
    );

    // Requirements bucket
    this.requirementsBucketName = this.configService.get<string>(
      'S3_REQUIREMENTS_BUCKET_NAME',
      'test-requirement-artifacts',
    );

    // Project data files bucket
    this.projectDataFilesBucketName = this.configService.get<string>(
      'S3_PROJECT_DATA_FILES_BUCKET_NAME',
      'project-data-files',
    );

    this.s3Endpoint = this.configService.get<string>(
      'S3_ENDPOINT',
      'http://localhost:9000',
    );
    const region = this.configService.get<string>('AWS_REGION', 'us-east-1');
    const accessKeyId = this.configService.get<string>(
      'AWS_ACCESS_KEY_ID',
      'minioadmin',
    );
    const secretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
      'minioadmin',
    );
    this.maxRetries = this.configService.get<number>('S3_MAX_RETRIES', 3);
    this.operationTimeout = this.configService.get<number>(
      'S3_OPERATION_TIMEOUT',
      5000,
    );

    this.logger.debug(
      `S3 initialized with buckets: playwright=[test=${this.testBucketName}, job=${this.jobBucketName}, monitor=${this.monitorBucketName}], k6=[test=${this.k6TestBucketName}, job=${this.k6JobBucketName}], status=${this.statusBucketName}`,
    );

    this.s3Client = new S3Client({
      region,
      endpoint: this.s3Endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: this.maxRetries,
    });
  }

  async onModuleInit() {
    try {
      // Ensure all buckets exist (initialize in parallel for faster startup)
      await Promise.all([
        // Playwright buckets
        this.ensureBucketExists(this.testBucketName),
        this.ensureBucketExists(this.jobBucketName),
        this.ensureBucketExists(this.monitorBucketName),
        // K6 buckets
        this.ensureBucketExists(this.k6TestBucketName),
        this.ensureBucketExists(this.k6JobBucketName),
        // Status page bucket
        this.ensureBucketExists(this.statusBucketName),
        // Requirements bucket
        this.ensureBucketExists(this.requirementsBucketName),
        // Project data files bucket
        this.ensureBucketExists(this.projectDataFilesBucketName),
      ]);

      this.logger.log('S3 buckets initialized successfully');
    } catch (error) {
      this.logger.error(
        `S3 bucket initialization failed: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );
      // Don't throw - let the service continue even if bucket creation fails
    }
  }

  /**
   * Get the appropriate bucket based on entity type
   * @param entityType - The type of entity (test, job, monitor, k6_test, k6_job, status)
   * @returns The bucket name for the given entity type
   */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  getBucketForEntityType(entityType: S3EntityType | string): string {
    switch (entityType) {
      // Playwright buckets
      case 'test':
        return this.testBucketName;
      case 'job':
        return this.jobBucketName;
      case 'monitor':
        return this.monitorBucketName;

      // K6 buckets
      case 'k6_test':
        return this.k6TestBucketName;
      case 'k6_job':
        return this.k6JobBucketName;

      // Status page bucket
      case 'status':
        return this.statusBucketName;

      // Requirements bucket
      case 'requirements':
        return this.requirementsBucketName;

      // Project data files bucket
      case 'project_data_files':
        return this.projectDataFilesBucketName;

      // Default to job bucket for unknown entity types
      default:
        this.logger.warn(
          `Unknown entity type '${entityType}', defaulting to job bucket`,
        );
        return this.jobBucketName;
    }
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string = 'S3 operation',
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error as Error;
        const errorMessage = lastError.message || 'Unknown error';
        this.logger.warn(
          `${operationName} failed (attempt ${attempt + 1}/${this.maxRetries}): ${errorMessage}`,
        );
        if (attempt < this.maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 100;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    this.logger.error(
      `${operationName} failed after ${this.maxRetries} retries.`,
    );
    throw (
      lastError ||
      new Error(`${operationName} failed after ${this.maxRetries} retries`)
    );
  }

  async ensureBucketExists(bucketName: string): Promise<void> {
    try {
      await this.withRetry(
        () =>
          this.s3Client.send(
            new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 1 }),
          ),
        `Check bucket ${bucketName} existence`,
      );
    } catch (error: unknown) {
      const awsError = error as { name?: string; Code?: string };
      if (
        awsError?.name === 'NoSuchBucket' ||
        awsError?.Code === 'NoSuchBucket'
      ) {
        // Only attempt to create bucket in self-hosted mode
        // In cloud mode, buckets should be created via Terraform/Wrangler
        const isSelfHosted =
          this.configService.get<string>('SELF_HOSTED')?.toLowerCase() ===
          'true';

        if (!isSelfHosted) {
          const message = `Bucket '${bucketName}' does not exist. Auto-creation is disabled in Cloud mode (SELF_HOSTED!=true). Please create the bucket manually.`;
          this.logger.error(message);
          throw new Error(message);
        }

        try {
          await this.withRetry(
            () =>
              this.s3Client.send(
                new CreateBucketCommand({ Bucket: bucketName }),
              ),
            `Create bucket ${bucketName}`,
          );
        } catch (createError: unknown) {
          // Handle the case where bucket was created by another process
          const createAwsError = createError as {
            name?: string;
            message?: string;
          };
          if (
            createAwsError?.name === 'BucketAlreadyOwnedByYou' ||
            createAwsError?.message?.includes('already own it') ||
            createAwsError?.message?.includes('already exists') ||
            createAwsError?.message?.includes(
              'The specified bucket does not exist',
            ) ||
            createAwsError?.message?.includes(
              'Your previous request to create the named bucket succeeded',
            )
          ) {
            // Bucket already exists, which is fine
          } else {
            this.logger.error(
              `Failed to create bucket '${bucketName}': ${getErrorMessage(createError)}`,
              getErrorStack(createError),
            );
            // Don't re-throw - let the service continue
          }
        }
      } else {
        this.logger.error(
          `Error checking bucket '${bucketName}' existence: ${getErrorMessage(error)}`,
          getErrorStack(error),
        );
        // Don't re-throw - let the service continue
      }
    }
  }

  async uploadFile(
    localFilePath: string,
    s3Key: string,
    contentType?: string,
    bucket?: string,
  ): Promise<string> {
    const targetBucket = bucket || this.jobBucketName;
    // Removed debug log for individual file uploads
    try {
      const fileBuffer = await fs.readFile(localFilePath);
      const determinedContentType =
        contentType || getContentType(localFilePath);

      await this.withRetry(
        () =>
          this.s3Client.send(
            new PutObjectCommand({
              Bucket: targetBucket,
              Key: s3Key,
              Body: fileBuffer,
              ContentType: determinedContentType,
            }),
          ),
        `Upload file ${s3Key}`,
      );

      // Removed success log for individual file uploads
      return s3Key;
    } catch (error) {
      this.logger.error(
        `Error uploading file ${localFilePath} to S3 key ${s3Key}: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );
      throw error;
    }
  }

  // Format a path for report storage using the entity ID directly without nested folders
  formatReportPath(entityId: string, reportPath: string = 'report'): string {
    return `${entityId}/${reportPath}`;
  }

  /**
   * Download a file from S3 and return its content as a Buffer
   * Used for downloading file-type variables for test execution
   */
  async downloadFileToBuffer(
    s3Key: string,
    bucket: string,
    maxBytes?: number,
  ): Promise<Buffer> {
    try {
      const response = await this.withRetry(
        () =>
          this.s3Client.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: s3Key,
            }),
          ),
        `Download file ${s3Key}`,
      );

      if (!response.Body) {
        throw new Error(`Empty response body for S3 key: ${s3Key}`);
      }

      if (
        typeof maxBytes === 'number' &&
        typeof response.ContentLength === 'number' &&
        response.ContentLength > maxBytes
      ) {
        throw new Error(
          `File ${s3Key} exceeds the remaining ${Math.floor(
            maxBytes / (1024 * 1024),
          )} MB file-variable budget.`,
        );
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const stream = response.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) {
        totalBytes += chunk.byteLength;
        if (typeof maxBytes === 'number' && totalBytes > maxBytes) {
          throw new Error(
            `File ${s3Key} exceeds the remaining ${Math.floor(
              maxBytes / (1024 * 1024),
            )} MB file-variable budget.`,
          );
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(
        `Error downloading file from S3 key ${s3Key}: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Prepare file variables for container execution by downloading from S3.
   * Returns additionalFiles (containerPath -> content) and filePaths (key -> containerPath).
   */
  async prepareFileVariables(
    files: Record<string, { storagePath: string; fileName: string; mimeType: string; fileSize: number | null }>,
  ): Promise<{ additionalFiles: Record<string, string>; filePaths: Record<string, string> }> {
    const additionalFiles: Record<string, string> = {};
    const filePaths: Record<string, string> = {};

    if (!files || Object.keys(files).length === 0) {
      return { additionalFiles, filePaths };
    }

    const totalBytes = Object.values(files).reduce(
      (sum, m) => sum + (typeof m.fileSize === 'number' && m.fileSize > 0 ? m.fileSize : 0),
      0,
    );
    if (totalBytes > MEMORY_LIMITS.MAX_TOTAL_FILE_VARIABLES_BYTES) {
      const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
      const limitMB = (MEMORY_LIMITS.MAX_TOTAL_FILE_VARIABLES_BYTES / (1024 * 1024)).toFixed(0);
      throw new Error(
        `Total file variable size (${totalMB} MB) exceeds the ${limitMB} MB per-run limit. ` +
        `Remove unused file variables or reduce file sizes.`,
      );
    }

    const bucket = this.getBucketForEntityType('project_data_files');
    let downloadedBytes = 0;

    for (const [key, meta] of Object.entries(files)) {
      const remainingBudget =
        MEMORY_LIMITS.MAX_TOTAL_FILE_VARIABLES_BYTES - downloadedBytes;

      if (remainingBudget <= 0) {
        throw new Error('Total file variable size exceeds the per-run limit.');
      }

      if (typeof meta.fileSize === 'number' && meta.fileSize > remainingBudget) {
        const requestedMB = (meta.fileSize / (1024 * 1024)).toFixed(1);
        const remainingMB = (remainingBudget / (1024 * 1024)).toFixed(1);
        throw new Error(
          `File variable '${key}' requires ${requestedMB} MB but only ${remainingMB} MB remains in the per-run budget.`,
        );
      }

      const buffer = await this.downloadFileToBuffer(
        meta.storagePath,
        bucket,
        remainingBudget,
      );
      downloadedBytes += buffer.length;

      if (downloadedBytes > MEMORY_LIMITS.MAX_TOTAL_FILE_VARIABLES_BYTES) {
        const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
        const limitMB = (
          MEMORY_LIMITS.MAX_TOTAL_FILE_VARIABLES_BYTES /
          (1024 * 1024)
        ).toFixed(0);
        throw new Error(
          `Total file variable size (${downloadedMB} MB) exceeds the ${limitMB} MB per-run limit. ` +
            `Remove unused file variables or reduce file sizes.`,
        );
      }

      if (
        typeof meta.fileSize === 'number' &&
        meta.fileSize > 0 &&
        meta.fileSize !== buffer.length
      ) {
        this.logger.warn(
          `File variable '${key}' size metadata (${meta.fileSize}) did not match downloaded size (${buffer.length})`,
        );
      }
      // Sanitize filename to prevent path traversal (e.g. ../../etc/passwd)
      const sanitizedFileName = meta.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const containerFileName = `data/${key}/${sanitizedFileName}`;
      // Preserve original bytes via base64 to avoid UTF-8 re-encoding corruption
      // (e.g. Windows-1252 CSV files). buildShellScript detects the prefix
      // and skips the double-encode.
      additionalFiles[containerFileName] = `base64:${buffer.toString('base64')}`;
      // Store relative path — the runtime helper resolves it against TMPDIR
      // (which buildKubernetesEnv sets to the per-run workspace root).
      filePaths[key] = containerFileName;
    }

    return { additionalFiles, filePaths };
  }

  async uploadDirectory(
    localDirPath: string,
    s3KeyPrefix: string,
    bucket?: string,
    entityId?: string,
    entityType?: string,
  ): Promise<string[]> {
    const targetBucket = bucket || this.jobBucketName;

    // If entityId and entityType are provided, use the direct ID format
    if (entityId && entityType) {
      // Replace any test-results/entity paths with direct ID path
      if (s3KeyPrefix.includes('test-results')) {
        s3KeyPrefix = this.formatReportPath(entityId);
      }
    }

    this.logger.log(
      `[S3 UPLOAD] Starting directory upload from ${localDirPath} to s3://${targetBucket}/${s3KeyPrefix}`,
    );

    // Check if directory exists
    try {
      const stats = await fs.stat(localDirPath);
      if (!stats.isDirectory()) {
        this.logger.error(
          `[S3 UPLOAD] Path ${localDirPath} is not a directory`,
        );
        throw new Error(`Path ${localDirPath} is not a directory`);
      }
    } catch (err) {
      this.logger.error(
        `[S3 UPLOAD] Failed to access directory ${localDirPath}: ${getErrorMessage(err)}`,
      );
      throw err;
    }

    // Check directory contents
    let files: string[] = [];
    try {
      files = await fs.readdir(localDirPath);

      if (files.length === 0) {
        this.logger.warn(
          `[S3 UPLOAD] Warning: Directory ${localDirPath} is empty`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[S3 UPLOAD] Failed to read directory contents: ${getErrorMessage(err)}`,
      );
      throw err;
    }

    // Verify bucket exists before attempting upload
    try {
      await this.withRetry(
        () =>
          this.s3Client.send(
            new ListObjectsV2Command({ Bucket: targetBucket, MaxKeys: 1 }),
          ),
        `Check bucket ${targetBucket} before upload`,
      );
    } catch (error) {
      this.logger.warn(
        `[S3 UPLOAD] Bucket '${targetBucket}' verification failed, attempting to create it: ${getErrorMessage(error)}`,
      );

      // Try to create the bucket as a fallback
      try {
        await this.withRetry(
          () =>
            this.s3Client.send(
              new CreateBucketCommand({ Bucket: targetBucket }),
            ),
          `Create bucket ${targetBucket} as fallback`,
        );
        this.logger.log(
          `[S3 UPLOAD] Successfully created bucket '${targetBucket}' as fallback.`,
        );
      } catch (createError) {
        this.logger.error(
          `[S3 UPLOAD] Failed to create bucket '${targetBucket}' as fallback: ${getErrorMessage(createError)}`,
          getErrorStack(createError),
        );
        throw new Error(
          `S3 bucket verification and creation failed: ${getErrorMessage(error)}`,
        );
      }
    }

    const uploadedKeys: string[] = [];
    const normalizedPrefix = s3KeyPrefix
      .replace(/^\/+/, '')
      .replace(/\/*$/, '');
    let uploadErrors = 0;

    const walk = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        // Removed debug log for directory walking

        for (const entry of entries) {
          const fullLocalPath = path.join(dir, entry.name);
          const relativePath = path.relative(localDirPath, fullLocalPath);
          const s3Key =
            normalizedPrefix + '/' + relativePath.split(path.sep).join('/');

          if (entry.isDirectory()) {
            // Recursively walk into subdirectories
            await walk(fullLocalPath);
          } else if (entry.isFile()) {
            // Upload files directly with garbage collection
            try {
              // Removed debug log for individual file uploads
              const key = await this.uploadFile(
                fullLocalPath,
                s3Key,
                undefined,
                targetBucket,
              );
              uploadedKeys.push(key);
              // Removed success log for individual file uploads

              // Force garbage collection after each upload to manage memory
              if (global.gc) {
                global.gc();
              }
            } catch (fileUploadError) {
              uploadErrors++;
              this.logger.error(
                `[S3 UPLOAD] Failed to upload file ${fullLocalPath} to ${s3Key}: ${getErrorMessage(fileUploadError)}`,
              );
              if (uploadErrors >= 3) {
                this.logger.error(
                  `[S3 UPLOAD] Too many upload errors (${uploadErrors}), stopping directory upload`,
                );
                throw new Error(
                  `Too many upload failures: ${uploadErrors} files failed to upload`,
                );
              }
            }
          }
        }
      } catch (readError) {
        // Log error if reading a directory fails, but continue if possible
        this.logger.error(
          `[S3 UPLOAD] Error reading directory ${dir}: ${getErrorMessage(readError)}`,
        );

        if (getErrorMessage(readError).includes('Too many upload failures')) {
          throw readError; // Re-throw this specific error to stop the process
        }
      }
    };

    try {
      // Start the recursive walk from the root directory
      await walk(localDirPath);

      if (uploadedKeys.length === 0) {
        this.logger.error(
          `[S3 UPLOAD] No files were uploaded from ${localDirPath}. This could indicate an issue.`,
        );
        if (files.length > 0) {
          throw new Error(
            'No files were uploaded despite directory containing files',
          );
        }
      } else {
        this.logger.log(
          `[S3 UPLOAD] Finished upload for ${localDirPath}. Successfully uploaded ${uploadedKeys.length} files to prefix ${normalizedPrefix} in bucket ${targetBucket}`,
        );
      }

      // Final garbage collection after all uploads
      if (global.gc) {
        global.gc();
      }
    } catch (error) {
      this.logger.error(
        `[S3 UPLOAD] Error during directory upload process for ${localDirPath}: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );
      throw error; // Re-throw to let caller handle it
    }

    return uploadedKeys; // Return keys of successfully uploaded files
  }

  // Get the base URL for entity reports
  getBaseUrlForEntity(
    entityType: string,
    entityId: string,
    customPrefix?: string,
  ): string {
    const bucket = this.getBucketForEntityType(entityType);
    const prefix = customPrefix
      ? customPrefix.replace(/^\/+/, '').replace(/\/*$/, '')
      : `${entityId}/report`;

    // Fix: Make sure URL format is correct for MinIO
    return `${this.s3Endpoint}/${bucket}/${prefix}`;
  }
}
