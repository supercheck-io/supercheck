/* ================================
   SHARED TYPES AND CONSTANTS
   -------------------------------
   Common types used across multiple schema files
=================================== */

// Test types
export type TestPriority = 'low' | 'medium' | 'high';
export type TestType =
  | 'browser'
  | 'api'
  | 'database'
  | 'custom'
  | 'performance';

// Requirement types - using same priority as tests for consistency
export type RequirementPriority = 'low' | 'medium' | 'high';
export type RequirementCreatedBy = 'ai' | 'user';
export type RequirementCoverageStatus = 'covered' | 'failing' | 'missing';
export type RequirementDocumentType = 'pdf' | 'docx' | 'md' | 'text';

// K6 Performance Testing types (includes global option for any location)
export type K6Location = 'us-east' | 'eu-central' | 'asia-pacific' | 'global';

// Job types
export type JobType = 'playwright' | 'k6';
export type JobStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error';
export type JobTrigger = 'manual' | 'remote' | 'schedule';
export type JobConfig = {
  environment?: string;
  variables?: Record<string, string>;
  retryStrategy?: {
    maxRetries: number;
    backoffFactor: number;
  };
};

// Test run types
export type TestRunStatus =
  | 'running'
  | 'passed'
  | 'failed'
  | 'error'
  | 'blocked'
  | 'queued';
export type ArtifactPaths = {
  logs?: string;
  video?: string;
  screenshots?: string[];
};

// Report types for execution artifacts tracked in the reports table
// Note: S3EntityType in s3.service.ts includes 'status' for status page assets,
// but those aren't tracked in the reports table (different lifecycle)
export type ReportType = 'test' | 'job' | 'monitor' | 'k6_test' | 'k6_job';

// Monitor types
export type MonitorType =
  | 'http_request'
  | 'website'
  | 'ping_host'
  | 'port_check'
  | 'synthetic_test';

export type MonitorStatus =
  | 'up'
  | 'down'
  | 'paused'
  | 'pending'
  | 'maintenance'
  | 'error';

export type MonitorResultStatus = 'up' | 'down' | 'error' | 'timeout';

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
  };
  [key: string]: unknown;
};

// Monitoring locations
export const MONITORING_LOCATIONS = {
  US_EAST: 'us-east',
  EU_CENTRAL: 'eu-central',
  ASIA_PACIFIC: 'asia-pacific',
} as const;

export type MonitoringLocation =
  (typeof MONITORING_LOCATIONS)[keyof typeof MONITORING_LOCATIONS];

export type LocationMetadata = {
  code: MonitoringLocation;
  name: string;
  region: string;
  coordinates?: { lat: number; lon: number };
  flag?: string;
};

export type LocationConfig = {
  enabled: boolean;
  locations: MonitoringLocation[];
  threshold: number;
  strategy?: 'all' | 'majority' | 'any';
};

export type MonitorConfig = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  headers?: Record<string, string>;
  body?: string;
  expectedStatusCodes?: string;
  keywordInBody?: string;
  keywordInBodyShouldBePresent?: boolean;
  responseBodyJsonPath?: { path: string; expectedValue: unknown };
  auth?: {
    type: 'none' | 'basic' | 'bearer';
    username?: string;
    password?: string;
    token?: string;
  };
  port?: number;
  protocol?: 'tcp' | 'udp';
  enableSslCheck?: boolean;
  sslDaysUntilExpirationWarning?: number;
  sslCheckFrequencyHours?: number;
  sslLastCheckedAt?: string;
  sslCheckOnStatusChange?: boolean;
  checkExpiration?: boolean;
  daysUntilExpirationWarning?: number;
  checkRevocation?: boolean;
  timeoutSeconds?: number;
  regions?: string[];
  locationConfig?: LocationConfig;
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
};

export type AlertType =
  | 'monitor_failure'
  | 'monitor_recovery'
  | 'job_failed'
  | 'job_success'
  | 'job_timeout'
  | 'ssl_expiring';

export type AlertStatus = 'sent' | 'failed' | 'pending';

// Notification types
export type NotificationProviderType =
  | 'email'
  | 'slack'
  | 'webhook'
  | 'telegram'
  | 'discord'
  | 'teams';

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
  url?: string;
  method?: 'GET' | 'POST' | 'PUT';
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

export type NotificationType = 'email' | 'slack' | 'webhook' | 'in-app';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'cancelled';
export type NotificationContent = {
  subject?: string;
  body: string;
  data?: Record<string, unknown>;
};

// Audit types
export type AuditDetails = {
  resource?: string;
  resourceId?: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
  metadata?: Record<string, unknown>;
};

// Status page types
export type StatusPageStatus = 'draft' | 'published' | 'archived';
export type ComponentStatus =
  | 'operational'
  | 'degraded_performance'
  | 'partial_outage'
  | 'major_outage'
  | 'under_maintenance';
export type IncidentStatus =
  | 'investigating'
  | 'identified'
  | 'monitoring'
  | 'resolved'
  | 'scheduled';
export type IncidentImpact = 'none' | 'minor' | 'major' | 'critical';
export type SubscriberMode = 'email' | 'webhook' | 'slack';

// Billing/Subscription types
export type SubscriptionPlan = 'plus' | 'pro' | 'unlimited';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'none';
