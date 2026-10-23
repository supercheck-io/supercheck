/**
 * S3 Cleanup Service for Managing Report Deletions
 *
 * This service handles the deletion of S3 objects and directories
 * associated with runs, jobs, and tests. It provides robust error
 * handling, retry logic, and detailed logging.
 */

import {
  S3Client,
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
  k6TestBucketName: string;
  k6JobBucketName: string;
  statusBucketName: string;
  requirementsBucketName: string;
  projectDataFilesBucketName: string;
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
  entityType: "job" | "test" | "monitor" | "k6_test" | "k6_job" | "status";
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
      requestHandler: { connectionTimeout: this.config.operationTimeout, requestTimeout: this.config.operationTimeout, socketTimeout: this.config.operationTimeout, throwOnRequestTimeout: true },
    });
  }

  getRunArtifactInputs(run: {
    id: string;
    reportS3Url?: string | null;
    logsS3Url?: string | null;
    metadata?: { testId?: string } | null;
  }): ReportDeletionInput[] {
    const inputs: ReportDeletionInput[] = [];
    for (const s3Url of new Set([run.reportS3Url, run.logsS3Url].filter((url): url is string => !!url))) {
      const url = new URL(s3Url);
      const endpointPath = new URL(this.config.endpoint).pathname.replace(/\/$/, "");
      const objectPath = endpointPath && url.pathname.startsWith(`${endpointPath}/`)
        ? url.pathname.slice(endpointPath.length) : url.pathname;
      const parts = objectPath.split("/").filter(Boolean);
      const types = ["job", "k6_job", "test", "k6_test"] as const;
      const entityType = types.find(type => {
        const bucket = this.getBucketForEntityType(type);
        return (parts[0] === bucket && parts[1] === run.id)
          || (url.hostname.startsWith(`${bucket}.`) && parts[0] === run.id);
      });
      if (!entityType) {
        const bucket = this.getBucketForEntityType("test");
        const testId = run.metadata?.testId;
        // Saved browser tests share a latest-report directory owned by the test.
        if (testId && ((parts[0] === bucket && parts[1] === testId)
          || (url.hostname.startsWith(`${bucket}.`) && parts[0] === testId))) continue;
        throw new Error("Artifact URL does not match its execution directory; pointers retained. Ask an administrator to verify the configured S3 endpoint, bucket and run prefix before repairing this URL.");
      }
      inputs.push({ entityId: run.id, reportPath: run.id, s3Url, entityType });
    }
    return inputs;
  }

  /**
   * Get the appropriate bucket name based on entity type
   */
  getBucketForEntityType(
    entityType: "job" | "test" | "monitor" | "k6_test" | "k6_job" | "status"
  ): string {
    switch (entityType) {
      case "test":
        return this.config.testBucketName;
      case "job":
        return this.config.jobBucketName;
      case "monitor":
        return this.config.monitorBucketName;
      case "k6_test":
        return this.config.k6TestBucketName;
      case "k6_job":
        return this.config.k6JobBucketName;
      case "status":
        return this.config.statusBucketName;
      default:
        return this.config.jobBucketName; // fallback
    }
  }

  /**
   * Extract S3 key from various input formats
   */
  private extractS3Key(input: ReportDeletionInput): string {
    let key = input.entityType === "monitor" && input.s3Url ? undefined : input.reportPath;
    if (!key && input.s3Url) {
      const url = new URL(input.s3Url);
      const bucket = this.getBucketForEntityType(input.entityType);
      const endpointPath = new URL(this.config.endpoint).pathname.replace(/\/$/, "");
      const objectPath = endpointPath && url.pathname.startsWith(`${endpointPath}/`)
        ? url.pathname.slice(endpointPath.length) : url.pathname;
      const parts = objectPath.split("/").filter(Boolean);
      if (parts[0] === bucket) {
        key = parts.slice(1).join("/");
      } else if (url.hostname.startsWith(`${bucket}.`)) {
        key = parts.join("/");
      } else {
        throw new Error(`Report URL does not match bucket ${bucket}`);
      }
    }
    // Reports own an execution directory; k6 also stores metrics beside /report.
    const executionId = (key ?? input.entityId).split("/")[0];
    if (!executionId || executionId === "." || executionId === "..") {
      throw new Error("Report cleanup requires a non-empty execution directory");
    }
    return executionId;
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
  async deleteObjectsBatch(
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
    return this.deleteReports([input]);
  }

  getFailedReportEntityIds(inputs: ReportDeletionInput[], result: S3DeletionResult): Set<string> {
    if (result.success) return new Set();
    const allIds = new Set(inputs.map(input => input.entityId));
    if (result.failedObjects.length === 0) return allIds;
    const prefixes = inputs.map(input => {
      try { return { input, prefix: `${this.extractS3Key(input)}/` }; }
      catch { return { input, prefix: undefined }; }
    });
    const failedIds = new Set<string>();
    for (const { key } of result.failedObjects) {
      const matches = prefixes.filter(({ input, prefix }) =>
        key === input.reportPath || key === input.s3Url || key === input.entityId ||
        (prefix && key.startsWith(prefix))
      );
      // An unknown failure must never discard a pointer that may still need retry.
      if (matches.length === 0) return allIds;
      for (const { input } of matches) failedIds.add(input.entityId);
    }
    return failedIds;
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
  async deleteRunArtifacts(bucket: string, runId: string): Promise<S3DeletionResult> {
    const keys = await this.listObjectsWithPrefix(bucket, `${runId}/`);
    return this.deleteObjectsBatch(bucket, keys);
  }

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

      const processedPrefixes = new Set<string>();
      for (const input of bucketInputs) {
        try {
          const prefix = `${this.extractS3Key(input)}/`;
          if (processedPrefixes.has(prefix)) continue;
          processedPrefixes.add(prefix);
          keysToDelete.push(...await this.listObjectsWithPrefix(bucketName, prefix));
        } catch (error) {
          combinedResult.failedObjects.push({
            key: input.reportPath || input.s3Url || input.entityId,
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
    // Playwright buckets
    jobBucketName: process.env.S3_JOB_BUCKET_NAME || "playwright-job-artifacts",
    testBucketName:
      process.env.S3_TEST_BUCKET_NAME || "playwright-test-artifacts",
    monitorBucketName:
      process.env.S3_MONITOR_BUCKET_NAME || "playwright-monitor-artifacts",
    // K6 buckets
    k6TestBucketName:
      process.env.S3_K6_TEST_BUCKET_NAME || "k6-test-artifacts",
    k6JobBucketName:
      process.env.S3_K6_JOB_BUCKET_NAME || "k6-job-artifacts",
    // Status page bucket
    statusBucketName:
      process.env.S3_STATUS_BUCKET_NAME || "status-page-artifacts",
    // Requirements bucket
    requirementsBucketName:
      process.env.S3_REQUIREMENTS_BUCKET_NAME || "test-requirement-artifacts",
    // Project data files bucket (file-type variables)
    projectDataFilesBucketName:
      process.env.S3_PROJECT_DATA_FILES_BUCKET_NAME || "project-data-files",
    maxRetries: process.env.S3_MAX_RETRIES
      ? parseInt(process.env.S3_MAX_RETRIES, 10)
      : 3,
    operationTimeout: process.env.S3_OPERATION_TIMEOUT
      ? parseInt(process.env.S3_OPERATION_TIMEOUT, 10)
      : 10000,
  };

  return new S3CleanupService(config);
}
