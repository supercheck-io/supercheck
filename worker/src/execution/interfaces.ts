// Interfaces migrated from the original project and processor definitions
import {
  JobTrigger,
  TestRunStatus,
  ReportType,
  MonitorType,
  MonitoringLocation,
} from '../db/schema';

// Result of a single test execution
export interface TestResult {
  success: boolean;
  error: string | null;
  reportUrl: string | null; // This might become an S3 URL/key
  testId: string;
  stdout: string;
  stderr: string;
  executionTimeMs?: number; // Actual test execution time in milliseconds (for synthetic monitors)
}

// Represents a test script to be executed as part of a job
export interface TestScript {
  id: string;
  script: string;
  name?: string;
}

// Result of executing multiple tests (a job)
export interface TestExecutionResult {
  jobId: string;
  success: boolean;
  error?: string | null;
  reportUrl: string | null; // This might become an S3 URL/key
  results: Array<{
    testId: string;
    success: boolean;
    error: string | null;
    // Individual report URLs might not be relevant if there's one job report
    reportUrl?: string | null; // Use job report URL
  }>;
  timestamp: string;
  duration?: string;
  stdout?: string;
  stderr?: string;
  // Additional properties for notifications
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
}

// Task data for the test execution queue
export interface TestExecutionTask {
  testId: string;
  // Consider passing the code directly instead of a path
  // as the worker service doesn't share the filesystem
  code: string;
  // testPath: string; // Original field - needs adaptation
}

// Task data for the job execution queue
export interface JobExecutionTask {
  jobId: string;
  testScripts: TestScript[];
  runId: string; // Required run ID to distinguish parallel executions of the same job
  originalJobId?: string; // The original job ID from the 'jobs' table that should be updated
  trigger: JobTrigger; // Add trigger property
  organizationId: string; // Required for RBAC filtering
  projectId: string; // Required for RBAC filtering
  variables?: Record<string, string>; // Resolved variables for job execution
  secrets?: Record<string, string>; // Resolved secrets for job execution
}

// Optional: Interface for database report metadata storage
export interface ReportMetadata {
  entityId: string;
  entityType: ReportType;
  reportPath: string; // This might be the S3 key/path
  status: TestRunStatus;
  s3Url?: string; // Explicitly store the final S3 URL
  createdAt?: Date;
  updatedAt?: Date;
}

// Interface for Monitor Job Data (mirroring DTO in runner)
export interface MonitorJobData {
  monitorId: string;
  type: MonitorType;
  target: string;
  config?: any;
  frequencyMinutes?: number;
  jobData?: any;
  retryLimit?: number;
  executionLocation?: MonitoringLocation;
  expectedLocations?: MonitoringLocation[];
  executionGroupId?: string;
}
