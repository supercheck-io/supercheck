/**
 * S3 Cleanup Service for Managing Report Deletions
 *
 * This service handles the deletion of S3 objects and directories
 * associated with runs, jobs, and tests. It provides robust error
 * handling, retry logic, and detailed logging.
 */

import {
  S3Client,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type DeleteObjectsCommandOutput,
} from "@aws-sdk/client-s3";

// Types for configuration and responses
export interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  jobBucketName: string;
  testBucketName: string;
  monitorBucketName: string;
  maxRetries?: number;
  operationTimeout?: number;
}

export interface S3DeletionResult {
  success: boolean;
  deletedObjects: string[];
  failedObjects: Array<{
    key: string;
    error: string;
  }>;
  totalAttempted: number;
}

export interface ReportDeletionInput {
  reportPath?: string;
  s3Url?: string;
  entityId: string;
  entityType: "job" | "test" | "monitor";
}

/**
 * S3 Cleanup Service with retry logic and comprehensive error handling
 */
export class S3CleanupService {
  private s3Client: S3Client;
  private config: Required<S3Config>;

  constructor(config: S3Config) {
    // Set defaults for optional properties
    this.config = {
      ...config,
      maxRetries: config.maxRetries ?? 3,
      operationTimeout: config.operationTimeout ?? 10000,
    };

    this.s3Client = new S3Client({
      region: this.config.region,
      endpoint: this.config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      maxAttempts: this.config.maxRetries,
    });
  }

  /**
   * Get the appropriate bucket name based on entity type
   */
  private getBucketForEntityType(
    entityType: "job" | "test" | "monitor"
  ): string {
    if (entityType === "monitor") {
      return this.config.monitorBucketName;
    }
    return entityType === "test"
      ? this.config.testBucketName
      : this.config.jobBucketName;
  }

  /**
   * Extract S3 key from various input formats
   */
  private extractS3Key(input: ReportDeletionInput): string {
    // If s3Url is provided, extract key from URL
    if (input.s3Url) {
      try {
        const url = new URL(input.s3Url);
        // Remove bucket name from path to get just the key
        const pathParts = url.pathname.split("/").filter(Boolean);
        if (pathParts.length > 1) {
          const key = pathParts.slice(1).join("/"); // Skip bucket name
          console.log(`[S3_CLEANUP] Extracted key from s3Url: ${key}`);
          return key;
        }
      } catch (error) {
        console.warn(
          "[S3_CLEANUP] Failed to parse s3Url, falling back to reportPath:",
          error
        );
      }
    }

    // Fall back to reportPath or generate from entityId
    if (input.reportPath) {
      console.log(`[S3_CLEANUP] Using reportPath: ${input.reportPath}`);
      return input.reportPath;
    }

    // Default format: entityId/report (matches the worker service format)
    const defaultKey = `${input.entityId}/report`;
    console.log(`[S3_CLEANUP] Using default key format: ${defaultKey}`);
    return defaultKey;
  }

  /**
   * Delete a single S3 object with retry logic
   */
  private async deleteObject(
    bucketName: string,
    key: string
  ): Promise<boolean> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        console.log(
          `[S3_CLEANUP] Deleting object: s3://${bucketName}/${key} (attempt ${
            attempt + 1
          })`
        );

        await this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: bucketName,
            Key: key,
          })
        );

        console.log(
          `[S3_CLEANUP] Successfully deleted: s3://${bucketName}/${key}`
        );
        return true;
      } catch (error) {
        lastError = error as Error;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.warn(
          `[S3_CLEANUP] Delete attempt ${
            attempt + 1
          } failed for ${key}: ${errorMessage}`
        );

        // Wait before retrying (exponential backoff)
        if (attempt < this.config.maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 500; // 500ms, 1s, 2s
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    console.error(
      `[S3_CLEANUP] Failed to delete ${key} after ${this.config.maxRetries} attempts:`,
      lastError?.message
    );
    return false;
  }

  /**
   * List all objects with a given prefix
   */
  private async listObjectsWithPrefix(
    bucketName: string,
    prefix: string
  ): Promise<string[]> {
    const objects: string[] = [];
    let continuationToken: string | undefined;

    try {
      do {
        console.log(
          `[S3_CLEANUP] Listing objects in s3://${bucketName} with prefix: ${prefix}`
        );

        const response = await this.s3Client.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );

        if (response.Contents) {
          const keys = response.Contents.map((obj) => obj.Key).filter(
            (key): key is string => key !== undefined
          );
          objects.push(...keys);
          console.log(
            `[S3_CLEANUP] Found ${keys.length} objects in this batch`
          );
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      console.log(
        `[S3_CLEANUP] Total objects found with prefix ${prefix}: ${objects.length}`
      );
      return objects;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[S3_CLEANUP] Failed to list objects with prefix ${prefix}:`,
        errorMessage
      );
      throw new Error(`Failed to list S3 objects: ${errorMessage}`);
    }
  }

  /**
   * Delete multiple objects in batch (more efficient for large numbers)
   */
  private async deleteObjectsBatch(
    bucketName: string,
    keys: string[]
  ): Promise<S3DeletionResult> {
    if (keys.length === 0) {
      return {
        success: true,
        deletedObjects: [],
        failedObjects: [],
        totalAttempted: 0,
      };
    }

    console.log(
      `[S3_CLEANUP] Batch deleting ${keys.length} objects from s3://${bucketName}`
    );

    const result: S3DeletionResult = {
      success: true,
      deletedObjects: [],
      failedObjects: [],
      totalAttempted: keys.length,
    };

    // S3 delete operation supports up to 1000 objects per request
    const batchSize = 1000;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);

      try {
        console.log(
          `[S3_CLEANUP] Deleting batch of ${batch.length} objects (${
            i + 1
          }-${Math.min(i + batchSize, keys.length)} of ${keys.length})`
        );

        const deleteResponse: DeleteObjectsCommandOutput =
          await this.s3Client.send(
            new DeleteObjectsCommand({
              Bucket: bucketName,
              Delete: {
                Objects: batch.map((key) => ({ Key: key })),
                Quiet: false, // Get detailed response
              },
            })
          );

        // Track successful deletions
        if (deleteResponse.Deleted) {
          for (const deleted of deleteResponse.Deleted) {
            if (deleted.Key) {
              result.deletedObjects.push(deleted.Key);
            }
          }
        }

        // Track failed deletions
        if (deleteResponse.Errors) {
          for (const error of deleteResponse.Errors) {
            if (error.Key) {
              result.failedObjects.push({
                key: error.Key,
                error: error.Message || "Unknown error",
              });
              result.success = false;
            }
          }
        }

        console.log(
          `[S3_CLEANUP] Batch completed: ${
            deleteResponse.Deleted?.length || 0
          } deleted, ${deleteResponse.Errors?.length || 0} errors`
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(`[S3_CLEANUP] Batch deletion failed:`, errorMessage);

        // Mark all items in this batch as failed
        for (const key of batch) {
          result.failedObjects.push({
            key,
            error: errorMessage,
          });
        }
        result.success = false;
      }
    }

    console.log(
      `[S3_CLEANUP] Batch deletion summary: ${result.deletedObjects.length} succeeded, ${result.failedObjects.length} failed`
    );
    return result;
  }

  /**
   * Delete a single report and its associated files
   */
  async deleteReport(input: ReportDeletionInput): Promise<S3DeletionResult> {
    const bucketName = this.getBucketForEntityType(input.entityType);
    const s3Key = this.extractS3Key(input);

    // Always treat reports as directories since they contain multiple files (HTML, assets, etc.)
    // Reports are stored as: entityId/report/index.html, entityId/report/assets/...
    const prefix = s3Key.endsWith("/") ? s3Key : `${s3Key}/`;
    console.log(`[S3_CLEANUP] Treating as directory, using prefix: ${prefix}`);

    try {
      const objectKeys = await this.listObjectsWithPrefix(bucketName, prefix);

      if (objectKeys.length === 0) {
        console.log(
          `[S3_CLEANUP] No objects found with prefix ${prefix}, treating as single file`
        );
        // If no objects found with directory prefix, try as single file
        const success = await this.deleteObject(bucketName, s3Key);
        return {
          success,
          deletedObjects: success ? [s3Key] : [],
          failedObjects: success
            ? []
            : [{ key: s3Key, error: "Single object deletion failed" }],
          totalAttempted: 1,
        };
      }

      console.log(
        `[S3_CLEANUP] Found ${objectKeys.length} objects with prefix ${prefix}, deleting as batch`
      );
      return await this.deleteObjectsBatch(bucketName, objectKeys);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[S3_CLEANUP] Error during directory deletion:`,
        errorMessage
      );
      return {
        success: false,
        deletedObjects: [],
        failedObjects: [{ key: s3Key, error: errorMessage }],
        totalAttempted: 1,
      };
    }
  }

  /**
   * Delete all reports for a specific entity (run, job, or test)
   */
  async deleteEntityReports(
    entityId: string,
    entityType: "job" | "test"
  ): Promise<S3DeletionResult> {
    console.log(
      `[S3_CLEANUP] Starting entity reports deletion for ${entityType}:${entityId}`
    );

    const bucketName = this.getBucketForEntityType(entityType);

    // Try multiple prefix patterns to ensure we catch all files
    const prefixesToTry = [
      `${entityId}/`, // All files under entity ID
      `${entityId}/report/`, // Specific report directory
    ];

    const totalDeletedObjects: string[] = [];
    const totalFailedObjects: Array<{ key: string; error: string }> = [];
    let totalAttempted = 0;

    for (const prefix of prefixesToTry) {
      console.log(`[S3_CLEANUP] Trying prefix: ${prefix}`);

      try {
        const objectKeys = await this.listObjectsWithPrefix(bucketName, prefix);

        if (objectKeys.length > 0) {
          console.log(
            `[S3_CLEANUP] Found ${objectKeys.length} objects with prefix ${prefix}`
          );
          totalAttempted += objectKeys.length;

          const batchResult = await this.deleteObjectsBatch(
            bucketName,
            objectKeys
          );
          totalDeletedObjects.push(...batchResult.deletedObjects);
          totalFailedObjects.push(...batchResult.failedObjects);
        } else {
          console.log(`[S3_CLEANUP] No objects found with prefix ${prefix}`);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(
          `[S3_CLEANUP] Error with prefix ${prefix}:`,
          errorMessage
        );
        totalFailedObjects.push({ key: prefix, error: errorMessage });
      }
    }

    if (totalAttempted === 0) {
      console.log(
        `[S3_CLEANUP] No S3 objects found for ${entityType}:${entityId} with any prefix pattern`
      );
    }

    return {
      success: totalFailedObjects.length === 0,
      deletedObjects: totalDeletedObjects,
      failedObjects: totalFailedObjects,
      totalAttempted,
    };
  }

  /**
   * Delete multiple reports in batch (for efficient cleanup)
   */
  async deleteReports(
    inputs: ReportDeletionInput[]
  ): Promise<S3DeletionResult> {
    console.log(
      `[S3_CLEANUP] Starting batch report deletion for ${inputs.length} reports`
    );

    const combinedResult: S3DeletionResult = {
      success: true,
      deletedObjects: [],
      failedObjects: [],
      totalAttempted: 0,
    };

    // Group by bucket to optimize deletion
    const bucketGroups = new Map<string, ReportDeletionInput[]>();
    for (const input of inputs) {
      const bucketName = this.getBucketForEntityType(input.entityType);
      if (!bucketGroups.has(bucketName)) {
        bucketGroups.set(bucketName, []);
      }
      bucketGroups.get(bucketName)!.push(input);
    }

    // Process each bucket group
    for (const [bucketName, bucketInputs] of bucketGroups) {
      console.log(
        `[S3_CLEANUP] Processing ${bucketInputs.length} deletions for bucket: ${bucketName}`
      );

      // Collect all keys to delete from this bucket
      const keysToDelete: string[] = [];

      for (const input of bucketInputs) {
        const s3Key = this.extractS3Key(input);

        // Always try to expand as directory first (reports are directories)
        const prefix = s3Key.endsWith("/") ? s3Key : `${s3Key}/`;
        try {
          console.log(
            `[S3_CLEANUP] Expanding directory for entity ${input.entityId} with prefix: ${prefix}`
          );
          const directoryKeys = await this.listObjectsWithPrefix(
            bucketName,
            prefix
          );

          if (directoryKeys.length > 0) {
            console.log(
              `[S3_CLEANUP] Found ${directoryKeys.length} objects in directory`
            );
            keysToDelete.push(...directoryKeys);
          } else {
            console.log(
              `[S3_CLEANUP] No objects found with prefix, trying alternative patterns for ${input.entityId}`
            );
            // Try alternative prefix patterns
            const alternativePrefixes = [
              `${input.entityId}/report/`,
              input.entityId, // Single file
            ];

            let foundObjects = false;
            for (const altPrefix of alternativePrefixes) {
              try {
                const altKeys = await this.listObjectsWithPrefix(
                  bucketName,
                  altPrefix
                );
                if (altKeys.length > 0) {
                  console.log(
                    `[S3_CLEANUP] Found ${altKeys.length} objects with alternative prefix: ${altPrefix}`
                  );
                  keysToDelete.push(...altKeys);
                  foundObjects = true;
                  break;
                }
              } catch (altError) {
                console.warn(
                  `[S3_CLEANUP] Alternative prefix ${altPrefix} failed:`,
                  altError
                );
              }
            }

            if (!foundObjects) {
              console.warn(
                `[S3_CLEANUP] No objects found for entity ${input.entityId} with any prefix pattern`
              );
            }
          }
        } catch (error) {
          console.error(
            `[S3_CLEANUP] Error expanding directory for ${input.entityId}:`,
            error
          );
          combinedResult.failedObjects.push({
            key: s3Key,
            error: error instanceof Error ? error.message : String(error),
          });
          combinedResult.success = false;
        }
      }

      // Remove duplicates
      const uniqueKeys = [...new Set(keysToDelete)];
      combinedResult.totalAttempted += uniqueKeys.length;

      if (uniqueKeys.length > 0) {
        const bucketResult = await this.deleteObjectsBatch(
          bucketName,
          uniqueKeys
        );

        // Merge results
        combinedResult.deletedObjects.push(...bucketResult.deletedObjects);
        combinedResult.failedObjects.push(...bucketResult.failedObjects);

        if (!bucketResult.success) {
          combinedResult.success = false;
        }
      }
    }

    console.log(
      `[S3_CLEANUP] Batch deletion completed: ${combinedResult.deletedObjects.length}/${combinedResult.totalAttempted} objects deleted`
    );
    return combinedResult;
  }
}

/**
 * Create and configure S3 cleanup service from environment variables
 */
export function createS3CleanupService(): S3CleanupService {
  const config: S3Config = {
    endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
    region: process.env.AWS_REGION || "us-east-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "minioadmin",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "minioadmin",
    jobBucketName: process.env.S3_JOB_BUCKET_NAME || "playwright-job-artifacts",
    testBucketName:
      process.env.S3_TEST_BUCKET_NAME || "playwright-test-artifacts",
    monitorBucketName:
      process.env.S3_MONITOR_BUCKET_NAME || "playwright-monitor-artifacts",
    maxRetries: process.env.S3_MAX_RETRIES
      ? parseInt(process.env.S3_MAX_RETRIES, 10)
      : 3,
    operationTimeout: process.env.S3_OPERATION_TIMEOUT
      ? parseInt(process.env.S3_OPERATION_TIMEOUT, 10)
      : 10000,
  };

  return new S3CleanupService(config);
}
