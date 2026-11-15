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
export const MONITOR_TYPE_VALUES = ["http_request", "website", "ping_host", "port_check", "synthetic_test", "heartbeat", "mcp_server"] as const;
export type MonitorType = (typeof MONITOR_TYPE_VALUES)[number];

export const MONITOR_STATUS_VALUES = ["up", "down", "paused", "pending", "maintenance", "error"] as const;
export type MonitorStatus = (typeof MONITOR_STATUS_VALUES)[number];

export type MonitorResultStatus = "up" | "down" | "error" | "timeout";

/** Why an MCP check failed; `undefined` on success. */
export type McpFailure = "connect" | "auth" | "list" | "required_tool" | "call" | "assert" | "timeout" | "secret";
export type McpProtocolMode = "auto" | "2025" | "2026";
export type McpToolFingerprint = { name: string; fingerprint: string };

export type McpResultDetails = {
  failure?: McpFailure;
  /** Negotiated protocol version string, e.g. "2025-06-18" or "2026-07-28". */
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
  auth: { type: "none" | "bearer" | "header"; secretKey?: string; headerName?: string };
  protocol?: McpProtocolMode;
  /** At most 50 names. */
  requiredTools?: string[];
  toolCall?: { name: string; arguments?: Record<string, unknown>; expectText?: string };
  /** Warn when a check takes longer than this for 3 cycles in a row (100-60000). */
  slowMs?: number;
};

export type McpToolChange = {
  at: string;
  added: string[];
  removed: string[];
  changed: { name: string; reasons: Array<"description" | "schema"> }[];
  /** The full-list hash changed but the stored first 500 tools show no difference. */
  beyondStored?: boolean;
};

/** Worker-owned MCP state (`config.mcpState`); clients can never write it. */
export type McpMonitorState = {
  detectedProtocol?: "2025" | "2026";
  lastCycleKey?: string;
  /** ISO time of the newest evaluated cycle; an older cycle is never evaluated after it. */
  lastCycleAt?: string;
  /** Cycle whose complete tool lists were last compared (may lag lastCycleKey on early-closed cycles). */
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
  /** AI endpoint preset timings and usage. */
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
    /** Project secret name supplying the bearer token or basic password; exclusive with inline token/password. */
    secretKey?: string;
  };
  /** AI endpoint preset (OpenAI-compatible streaming check); http_request only. */
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
  /** Heartbeat monitors only: how late a ping may be before the monitor goes down. */
  heartbeat?: { graceMinutes?: number };
  /** Worker-owned; clients cannot write it. */
  aiEndpointState?: {
    lastServedModel?: string;
    lastCycleKey?: string;
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

/**
 * Heartbeat runtime state (monitors.heartbeat_state). The ping route writes the ping keys and the
 * worker sweep writes the bookkeeping keys, each as a jsonb expression on the current row value.
 */
export type HeartbeatState = {
  /** Set on create and on resume: the deadline counts from max(lastPingAt, anchorAt). */
  anchorAt?: string;
  lastPingAt?: string;
  lastPingKind?: "ping" | "fail";
  lastStartAt?: string;
  pingSeq?: number;
  /** Incremented on every /fail, so a fail followed by a ping in one sweep window is not lost. */
  failSeq?: number;
  lastFailAt?: string;
  evaluatedFailSeq?: number;
  lastUserAgent?: string;
  evaluatedSeq?: number;
  leaseUntil?: string;
  lateEpisodeKey?: string;
  lastMissedAt?: string;
  deadlineShiftedFor?: string;
  deadlineShiftMs?: number;
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
  /** Warning-only notifications by kind (see lib/alerts/warning-kinds.ts). Never open an incident. */
  warnings?: Record<string, boolean>;
};

export type AlertType =
  | "monitor_failure"
  | "monitor_recovery"
  | "job_failed"
  | "job_success"
  | "job_timeout"
  | "ssl_expiring"
  | "ssl_renewed"
  | "monitor_warning";

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
    | "jsm_ops"
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
