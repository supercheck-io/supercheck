/* ================================
   SHARED TYPES AND CONSTANTS
   -------------------------------
   Common types used across multiple schema files
=================================== */

// Test types
import { sql, type SQL } from "drizzle-orm";

/** `col IN (...)` built from the same constant that defines the TypeScript union, so the two cannot drift. */
export const inValues = (column: unknown, values: readonly string[]): SQL =>
  sql`${column} IN (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;

export const TEST_PRIORITY_VALUES = ["low", "medium", "high"] as const;
export type TestPriority = (typeof TEST_PRIORITY_VALUES)[number];
export const TEST_TYPE_VALUES = ["browser", "api", "database", "custom", "performance"] as const;
export type TestType = (typeof TEST_TYPE_VALUES)[number];

// Requirement types - using same priority as tests for consistency
export type RequirementPriority = "low" | "medium" | "high";
export type RequirementCreatedBy = "ai" | "user";
export type RequirementCoverageStatus = "covered" | "failing" | "missing";
export type RequirementDocumentType = "pdf" | "docx" | "md" | "text";

// K6 Performance Testing types — location codes are dynamic strings from the locations table
export type K6Location = string;

// Job types
export type JobType = "playwright" | "k6";
export type JobStatus = "pending" | "running" | "passed" | "failed" | "error";
export type JobTrigger = "manual" | "remote" | "schedule";
export type JobConfig = {
  environment?: string;
  variables?: Record<string, string>;
  retryStrategy?: {
    maxRetries: number;
    backoffFactor: number;
  };
};

// Test run types
export type TestRunStatus = "running" | "passed" | "failed" | "error" | "blocked" | "queued";
export type ArtifactPaths = {
  logs?: string;
  video?: string;
  screenshots?: string[];
};

// Report types for execution artifacts tracked in the reports table
// Note: S3EntityType in worker includes 'status' for status page assets,
// but those aren't tracked in the reports table (different lifecycle)
export type ReportType = "test" | "job" | "monitor" | "k6_test" | "k6_job";

// Monitor types
export const MONITOR_TYPE_VALUES = ["http_request", "website", "ping_host", "port_check", "synthetic_test"] as const;
export type MonitorType = (typeof MONITOR_TYPE_VALUES)[number];

export const MONITOR_STATUS_VALUES = ["up", "down", "paused", "pending", "maintenance", "error"] as const;
export type MonitorStatus = (typeof MONITOR_STATUS_VALUES)[number];

export type MonitorResultStatus = "up" | "down" | "error" | "timeout";

export type MonitorResultDetails = {
  statusCode?: number;
  statusText?: string;
  errorMessage?: string;
  responseHeaders?: Record<string, string>;
  responseBodySnippet?: string;
  ipAddress?: string;
  location?: string;
  sslCertificate?: {
    valid: boolean;
    issuer?: string;
    subject?: string;
    validFrom?: string;
    validTo?: string;
    daysRemaining?: number;
    // Host the certificate was read from; set on the copy stored in monitor config
    host?: string;
  };
  [key: string]: unknown;
};

// Monitoring locations — location codes are dynamic strings from the locations table
export type MonitoringLocation = string;

export type LocationMetadata = {
  code: string;
  name: string;
  region: string;
  coordinates?: { lat: number; lon: number };
  flag?: string;
};

export type LocationConfig = {
  enabled: boolean;
  locations: string[];
  threshold: number;
  strategy?: "all" | "majority" | "any";
};

export type MonitorConfig = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
  headers?: Record<string, string>;
  body?: string;
  expectedStatusCodes?: string;
  keywordInBody?: string;
  keywordInBodyShouldBePresent?: boolean;
  auth?: {
    type: "none" | "basic" | "bearer";
    username?: string;
    password?: string;
    token?: string;
  };
  port?: number;
  protocol?: "tcp" | "udp";
  expectClosed?: boolean; // When true, monitor passes if port is closed (connection refused)
  enableSslCheck?: boolean;
  sslDaysUntilExpirationWarning?: number;
  sslCheckFrequencyHours?: number;
  sslLastCheckedAt?: string;
  /** First failed certificate probe since the last successful read, for this host; worker-owned. */
  sslProbeFailure?: { since: string; host: string | null };
  /** Last certificate the worker read; written by the worker, not by clients. */
  sslCertificate?: MonitorResultDetails["sslCertificate"];
  timeoutSeconds?: number;
  regions?: string[];
  locationConfig?: LocationConfig;
  /** @deprecated Unsupported for monitors; accepted for compatibility and ignored. */
  retryStrategy?: {
    maxRetries: number;
    backoffFactor: number;
  };
  alertChannels?: string[];
  testId?: string;
  testTitle?: string;
  playwrightOptions?: {
    headless?: boolean;
    timeout?: number;
    retries?: number;
  };
  [key: string]: unknown;
};

// Alert types
export type AlertConfig = {
  enabled: boolean;
  notificationProviders: string[];
  alertOnFailure: boolean;
  alertOnRecovery?: boolean;
  alertOnSslExpiration?: boolean;
  alertOnSuccess?: boolean;
  alertOnTimeout?: boolean;
  failureThreshold: number;
  recoveryThreshold: number;
  customMessage?: string;
  /** Open an incident when this alerts. Undefined = true. */
  incidentEnabled?: boolean;
  /** Severity for new incidents. Undefined = derived from the alert. */
  incidentSeverity?: "sev1" | "sev2" | "sev3" | "sev4";
  /** Resolve the incident on recovery if unacknowledged. Undefined = true. */
  autoResolveIncident?: boolean;
};

export type AlertType =
  | "monitor_failure"
  | "monitor_recovery"
  | "job_failed"
  | "job_success"
  | "job_timeout"
  | "ssl_expiring";

export type AlertStatus = "sent" | "failed" | "pending";

export type AlertDeliveryMetadata = {
  version: 1;
  provider: {
    id: string;
    type?: NotificationProviderType;
    preset?: string;
  };
  source: {
    alertType: AlertType;
    targetType: "monitor" | "job";
    targetId: string;
    projectId?: string;
    monitorId?: string;
    jobId?: string;
    runId?: string;
  };
  correlation?: {
    dedupKey?: string;
    eventAction?: string;
    externalIncidentKey?: string;
    externalUrl?: string;
  };
  delivery: {
    status: AlertStatus;
    sentAt: string;
    attempts?: number;
    responseStatus?: number;
    responseHash?: string;
    errorHash?: string;
  };
};

// Notification types
export const NOTIFICATION_PROVIDER_TYPE_VALUES = ["email", "slack", "webhook", "telegram", "discord", "teams"] as const;
export type NotificationProviderType = (typeof NOTIFICATION_PROVIDER_TYPE_VALUES)[number];

type SecretEnvelope = {
  encrypted: true;
  version: 1;
  payload: string;
  context?: string;
};

export type PlainNotificationProviderConfig = {
  name?: string;
  isDefault?: boolean;
  emails?: string;
  webhookUrl?: string;
  channel?: string;
  preset?:
    | "custom"
    | "pagerduty"
    | "opsgenie"
    | "splunk_on_call"
    | "better_stack"
    | "incident_io";
  url?: string;
  method?: "GET" | "POST" | "PUT";
  headers?: Record<string, string>;
  bodyTemplate?: string;
  botToken?: string;
  chatId?: string;
  discordWebhookUrl?: string;
  teamsWebhookUrl?: string;
  [key: string]: unknown;
};

export type EncryptedNotificationProviderConfig = SecretEnvelope;

export type NotificationProviderConfig =
  | (PlainNotificationProviderConfig & { encrypted?: false })
  | EncryptedNotificationProviderConfig;

export type NotificationType = "email" | "slack" | "webhook" | "in-app";
export type NotificationStatus = "pending" | "sent" | "failed" | "cancelled";
export type NotificationContent = {
  subject?: string;
  body: string;
  data?: Record<string, unknown>;
};

// Audit types
export type AuditDetails = {
  actorUserId?: string;
  impersonatedBy?: string;
  deletedUserId?: string;
  resource?: string;
  resourceId?: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
  metadata?: Record<string, unknown>;
};

// Status page types
export type StatusPageStatus = "draft" | "published" | "archived";
export const COMPONENT_STATUS_VALUES = ["operational", "degraded_performance", "partial_outage", "major_outage", "under_maintenance"] as const;
export type ComponentStatus = (typeof COMPONENT_STATUS_VALUES)[number];
export const INCIDENT_STATUS_VALUES = ["investigating", "identified", "monitoring", "resolved", "scheduled"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUS_VALUES)[number];
export const INCIDENT_IMPACT_VALUES = ["none", "minor", "major", "critical"] as const;
export type IncidentImpact = (typeof INCIDENT_IMPACT_VALUES)[number];
export type SubscriberMode = "email" | "webhook" | "slack";

// Billing/Subscription types
export type SubscriptionPlan = "plus" | "pro" | "unlimited";
export type SubscriptionStatus = "active" | "canceled" | "past_due" | "none";
