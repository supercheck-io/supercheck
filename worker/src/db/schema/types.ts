/* ================================
   SHARED TYPES AND CONSTANTS
   -------------------------------
   Common types used across multiple schema files
=================================== */

// Test types
export type TestPriority = 'low' | 'medium' | 'high';
export type TestType =
  'browser' | 'api' | 'database' | 'custom' | 'performance' | 'agent';

// Requirement types - using same priority as tests for consistency
export type RequirementPriority = 'low' | 'medium' | 'high';
export type RequirementCreatedBy = 'ai' | 'user';
export type RequirementCoverageStatus = 'covered' | 'failing' | 'missing';
export type RequirementDocumentType = 'pdf' | 'docx' | 'md' | 'text';

// K6 Performance Testing types — location codes are dynamic strings from the locations table
export type K6Location = string;

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
  'running' | 'passed' | 'failed' | 'error' | 'blocked' | 'queued';
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
  | 'synthetic_test'
  | 'heartbeat'
  | 'mcp_server';

export type MonitorStatus =
  'up' | 'down' | 'paused' | 'pending' | 'maintenance' | 'error';

export type MonitorResultStatus = 'up' | 'down' | 'error' | 'timeout';

/** Why an MCP check failed; `undefined` on success. */
export type McpFailure =
  | 'connect'
  | 'auth'
  | 'list'
  | 'required_tool'
  | 'call'
  | 'assert'
  | 'timeout'
  | 'secret';
export type McpProtocolMode = 'auto' | '2025' | '2026';
export type McpToolFingerprint = { name: string; fingerprint: string };

export type McpResultDetails = {
  failure?: McpFailure;
  /** Negotiated protocol version string, e.g. '2025-06-18' or '2026-07-28'. */
  protocol?: string;
  serverName?: string;
  serverVersion?: string;
  toolCount?: number;
  toolsHash?: string;
  /** Hash of the target and login the check ran with; a result from before a settings change is ignored. */
  endpointKey?: string;
  /** At most 500 entries; names clipped to 128 chars. Descriptions and schemas are hashed, never stored. */
  tools?: McpToolFingerprint[];
  connectMs?: number;
  listMs?: number;
  callMs?: number;
};

/** User-editable MCP Monitor settings (`config.mcp`). */
export type McpMonitorConfig = {
  auth: {
    type: 'none' | 'bearer' | 'header';
    secretKey?: string;
    headerName?: string;
  };
  protocol?: McpProtocolMode;
  /** At most 50 names. */
  requiredTools?: string[];
  toolCall?: {
    name: string;
    arguments?: Record<string, unknown>;
    expectText?: string;
  };
  /** Warn when a check takes longer than this for 3 cycles in a row (100-60000). */
  slowMs?: number;
};

export type McpToolChange = {
  at: string;
  added: string[];
  removed: string[];
  changed: { name: string; reasons: Array<'description' | 'schema'> }[];
  /** The list hash changed but the stored (first 500) names did not: the change is past the stored subset. */
  beyondStored?: boolean;
};

/** Worker-owned MCP state (`config.mcpState`); clients can never write it. */
export type McpMonitorState = {
  detectedProtocol?: '2025' | '2026';
  lastCycleKey?: string;
  /** ISO time of the newest evaluated cycle; an older cycle redelivered later is ignored. */
  lastCycleAt?: string;
  /** Tool-list part of the evaluation, tracked apart: it needs every expected location to have reported. */
  toolsCycleKey?: string;
  toolsCycleAt?: string;
  baseline?: { hash: string; takenAt: string; tools: McpToolFingerprint[] };
  /** Newest last; at most 10 kept. */
  changes?: McpToolChange[];
  slowStreak?: number;
  slowEpisodeKey?: string | null;
};

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
  /** MCP Monitor check result. Tool names come from the customer's server: render as text only. */
  mcp?: McpResultDetails;
  ai?: {
    firstTokenMs?: number;
    totalMs: number;
    servedModel?: string;
    systemFingerprint?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cost?: number;
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
    /** Project secret NAME supplying the bearer token or basic password. */
    secretKey?: string;
  };
  /** AI endpoint preset: a streamed chat-completions call judged by status, first token and reply. */
  aiEndpoint?: {
    secretKey?: string;
    keyHeader?: string;
    model: string;
    prompt?: string;
    maxTokens?: number;
    expectText?: string;
    firstTokenTimeoutMs?: number;
    /** Warn when the first token is slower than this for 3 cycles (warning only). */
    warnFirstTokenMs?: number;
    /** Warn when one call uses more tokens than this (warning only). */
    warnTotalTokens?: number;
  };
  /** Worker-owned. */
  aiEndpointState?: {
    lastServedModel?: string;
    lastCycleKey?: string;
    /** ISO time of the newest evaluated cycle; an older cycle redelivered later is ignored. */
    lastCycleAt?: string;
    slowFirstTokenStreak?: number;
    slowFirstTokenEpisodeKey?: string | null;
    tokensHighEpisodeKey?: string | null;
    /** The served-model part has its own guard: a cycle closed early finishes it when the last region reports. */
    modelCycleKey?: string;
    modelCycleAt?: string;
  };
  /** MCP Monitor settings; mcp_server only. */
  mcp?: McpMonitorConfig;
  /** Worker-owned; clients cannot write it. */
  mcpState?: McpMonitorState;
  /** Heartbeat monitors only: how late a ping may be before the monitor goes down. */
  heartbeat?: { graceMinutes?: number };
  port?: number;
  protocol?: 'tcp' | 'udp';
  expectClosed?: boolean; // When true, monitor passes if port is closed (connection refused)
  enableSslCheck?: boolean;
  sslDaysUntilExpirationWarning?: number;
  sslCheckFrequencyHours?: number;
  sslLastCheckedAt?: string;
  /** First failed certificate probe since the last successful read, for this host; worker-owned. */
  sslProbeFailure?: { since: string; host: string | null };
  /**
   * An SSL warning was delivered for this host and the certificate has not been seen healthy since; worker-owned.
   * `id` keys the one "renewed" notice owed for it; `validTo` is the warned certificate's expiry, when one was read.
   */
  sslAlertState?: {
    id: string;
    host: string | null;
    validTo?: string;
    warnedAt: string;
  };
  sslCertificate?: MonitorResultDetails['sslCertificate'];
  sslCheckOnStatusChange?: boolean;
  checkExpiration?: boolean;
  daysUntilExpirationWarning?: number;
  checkRevocation?: boolean;
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

/**
 * Heartbeat runtime state (monitors.heartbeat_state). The ping route writes the ping keys and the
 * worker sweep writes the bookkeeping keys, each as a jsonb expression on the current row value.
 */
export type HeartbeatState = {
  /** Set on create and on resume: the deadline counts from max(lastPingAt, anchorAt). */
  anchorAt?: string;
  lastPingAt?: string;
  lastPingKind?: 'ping' | 'fail';
  lastStartAt?: string;
  pingSeq?: number;
  /** +1 per /fail, with its time: a /fail overtaken by a ping in one sweep window is still recorded. */
  failSeq?: number;
  lastFailAt?: string;
  lastUserAgent?: string;
  evaluatedSeq?: number;
  evaluatedFailSeq?: number;
  leaseUntil?: string;
  lateEpisodeKey?: string;
  lastMissedAt?: string;
  deadlineShiftedFor?: string;
  deadlineShiftMs?: number;
  /** The last missed row's alert was held by maintenance; the end of the window re-checks at once. */
  missHeld?: boolean;
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
  incidentSeverity?: 'sev1' | 'sev2' | 'sev3' | 'sev4';
  /** Resolve the incident on recovery if unacknowledged. Undefined = true. */
  autoResolveIncident?: boolean;
  /** Warning-only notifications by kind (see monitor/warning-kinds.ts). Never open an incident. */
  warnings?: Record<string, boolean>;
};

export type AlertType =
  | 'monitor_failure'
  | 'monitor_recovery'
  | 'job_failed'
  | 'job_success'
  | 'job_timeout'
  | 'ssl_expiring'
  | 'ssl_renewed'
  | 'monitor_warning';

export type AlertStatus = 'sent' | 'failed' | 'pending';

export type AlertDeliveryMetadata = {
  version: 1;
  provider: {
    id: string;
    type?: NotificationProviderType;
    preset?: string;
  };
  source: {
    alertType: AlertType;
    targetType: 'monitor' | 'job';
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
    /** 401/403 from the receiver: never retried, shown as a channel error. */
    terminal?: boolean;
    /** Each HTTP attempt (max 4): status, or a redacted error when no response arrived. */
    attemptLog?: AlertDeliveryAttempt[];
  };
  /** Set on `monitor_warning` rows. */
  warning?: { kind: string };
};

export type AlertDeliveryAttempt = {
  n: number;
  status?: number;
  error?: string;
  ms: number;
};

// Notification types
export type NotificationProviderType =
  'email' | 'slack' | 'webhook' | 'telegram' | 'discord' | 'teams';

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
    | 'custom'
    | 'pagerduty'
    | 'opsgenie'
    | 'jsm_ops'
    | 'splunk_on_call'
    | 'better_stack'
    | 'incident_io';
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
  'investigating' | 'identified' | 'monitoring' | 'resolved' | 'scheduled';
export type IncidentImpact = 'none' | 'minor' | 'major' | 'critical';
export type SubscriberMode = 'email' | 'webhook' | 'slack';

// Billing/Subscription types
export type SubscriptionPlan = 'plus' | 'pro' | 'unlimited';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'none';
