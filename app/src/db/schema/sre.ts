/* ================================
   SRE SCHEMA
   -------------------------------
   Tables for AI SRE service topology, incidents, evidence, connectors, agents,
   context memory, and chat history.
=================================== */

import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "./auth";
import { organization, projects } from "./organization";
import { incidents as statusPageIncidents } from "./statusPage";

type SreTier = "1" | "2" | "3" | "4";
type SreServiceStatus = "active" | "deprecated" | "merged";
type SreOwnerType = "team" | "user" | "slack";
type SreOwnerRole = "primary" | "on-call" | "secondary" | "reviewer";
type SreResourceType = "monitor" | "job" | "test" | "status_page_component" | "k6_run";
type SreResourceRelationship = "monitors" | "owned" | "depends_on";
type SreDependencySource = "manual" | "native" | "connector_observed" | "ai_suggested";
type SreDependencyStatus = "active" | "stale" | "rejected";
type SreHealth = "healthy" | "degraded" | "failing" | "unknown";
type SreDiscoverySuggestionType = "create_service" | "merge_services" | "add_resource" | "add_dependency";
type SreSuggestionStatus = "pending" | "approved" | "rejected";
type SreDeploymentSource = "github" | "kubernetes" | "ci";
type SreSeverity = "sev1" | "sev2" | "sev3" | "sev4";
type SreAlertStatus = "firing" | "resolved" | "silenced" | "deduplicated";
type SreAlertSourceType = "monitor" | "job" | "k6" | "run" | "webhook" | "connector";
type SreIncidentStatus =
  | "triggered"
  | "investigating"
  | "identified"
  | "recommendations_ready"
  | "user_applying_fix"
  | "verifying"
  | "resolved";
type SreIncidentAlertRole = "trigger" | "related" | "red_herring";
type SreTimelineEventType =
  | "comment"
  | "state_change"
  | "ai_finding"
  | "tool_call"
  | "evidence_added"
  | "recommendation_added"
  | "verification_result"
  | "user_action";
type SreActorType = "user" | "agent" | "system";
type SreVerificationResourceType = "monitor" | "test" | "k6";
type SreVerificationStatus = "pending" | "running" | "passed" | "failed";
type SreEvidenceSourceType =
  | "native"
  | "github"
  | "kubernetes"
  | "prometheus"
  | "grafana"
  | "datadog"
  | "aws_cloudwatch"
  | "sentry"
  | "loki"
  | "elasticsearch"
  | "tempo"
  | "splunk"
  | "slack"
  | "mcp"
  | "webhook";
type SreEvidenceType = "metric" | "log" | "trace" | "artifact" | "deployment" | "event" | "document" | "topology";
type SreAgentType = "triage" | "investigation" | "background" | "sre_ai";
type SreRunStatus = "running" | "completed" | "failed" | "aborted" | "timed_out";
type SreToolCallStatus = "success" | "error" | "timeout" | "aborted";
type SreAiSuggestionType = "status_page_update" | "postmortem_draft" | "incident_brief" | "runbook_draft" | "similar_incident";
type SreRecommendationStatus = "pending" | "applied" | "skipped" | "failed";
type SreRunbookStatus = "active" | "deprecated";
type SreRunbookStepStatus = "pending" | "in_progress" | "done" | "skipped";
type PrivateAgentStatus = "pending" | "connected" | "disconnected" | "unhealthy" | "disabled";
type PrivateAgentMode = "connector_proxy" | "execution_worker" | "hybrid";
type PrivateAgentJobClass = "sre_connector_query" | "http_monitor_check" | "playwright_run" | "k6_run" | "network_check";
type PrivateAgentJobStatus = "queued" | "leased" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
type PrivateAgentArtifactType = "json" | "log" | "screenshot" | "video" | "trace" | "report" | "har";
type ExternalConnectorRiskLevel = "low" | "medium" | "high" | "critical";
type ExternalConnectorPermissionLevel = "read";
type ExternalConnectorSideEffectLevel = "none";
type ExternalConnectorStatus = "configured" | "valid" | "unreachable" | "missing_credentials" | "disabled";
type ExternalConnectorValidationStatus = "valid" | "unreachable" | "invalid_credentials" | "policy_blocked";
type ExternalConnectorCredentialType = "api_key" | "oauth_token" | "bearer_token" | "basic_auth" | "service_account";
type DiagnosticQueryType = "sql" | "promql" | "logql" | "traceql" | "http_get";
type DiagnosticQueryStatus = "active" | "disabled";
type SreContextPlaybookStatus = "active" | "deprecated";
type SreBackgroundAgentType = "post_deploy_check" | "weekly_report" | "regression_detection" | "k6_trend_analysis";
type SreBackgroundRunStatus = "scheduled" | "running" | "completed" | "failed";
type SreChatConversationStatus = "active" | "archived";
type SreChatMessageRole = "user" | "assistant" | "system" | "tool";

type ExternalConnectorType =
  | "github"
  | "kubernetes"
  | "prometheus"
  | "grafana"
  | "datadog"
  | "splunk"
  | "appdynamics"
  | "newrelic"
  | "sentry"
  | "loki"
  | "elasticsearch"
  | "tempo"
  | "jaeger"
  | "opentelemetry"
  | "aws_cloudwatch"
  | "gcp_monitoring"
  | "azure_monitor"
  | "postgresql"
  | "mysql"
  | "mongodb"
  | "redis"
  | "clickhouse"
  | "kafka"
  | "rabbitmq"
  | "gitlab"
  | "confluence"
  | "notion"
  | "slack"
  | "teams"
  | "pagerduty"
  | "opsgenie"
  | "jira"
  | "mcp"
  | "webhook"
  | "supercheck_native";

const uuidPk = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`);

export const sreServices = pgTable(
  "sre_services",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    tier: varchar("tier", { length: 10 }).$type<SreTier>().notNull().default("3"),
    environment: varchar("environment", { length: 50 }),
    ownerTeam: varchar("owner_team", { length: 100 }),
    ownerUserId: uuid("owner_user_id").references(() => user.id, { onDelete: "set null" }),
    runbookId: uuid("runbook_id"),
    repoUrl: varchar("repo_url", { length: 500 }),
    otelServiceName: varchar("otel_service_name", { length: 100 }),
    slackChannel: varchar("slack_channel", { length: 100 }),
    tags: jsonb("tags").$type<string[]>().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    status: varchar("status", { length: 20 }).$type<SreServiceStatus>().notNull().default("active"),
    mergedIntoServiceId: uuid("merged_into_service_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    projectOrgStatusIdx: index("sre_services_project_org_status_idx").on(table.projectId, table.organizationId, table.status),
    activeProjectNameUniqueIdx: uniqueIndex("sre_services_active_project_name_unique_idx")
      .on(table.organizationId, table.projectId, table.name)
      .where(sql`status = 'active'`),
    projectEnvironmentIdx: index("sre_services_project_environment_idx").on(table.projectId, table.environment),
    projectTierIdx: index("sre_services_project_tier_idx").on(table.projectId, table.tier),
  })
);

export const sreServiceOwners = pgTable(
  "sre_service_owners",
  {
    id: uuidPk(),
    serviceId: uuid("service_id").notNull().references(() => sreServices.id, { onDelete: "cascade" }),
    ownerType: varchar("owner_type", { length: 10 }).$type<SreOwnerType>().notNull(),
    ownerRef: varchar("owner_ref", { length: 200 }).notNull(),
    role: varchar("role", { length: 50 }).$type<SreOwnerRole>().notNull().default("primary"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    serviceIdIdx: index("sre_service_owners_service_id_idx").on(table.serviceId),
    ownerRefIdx: index("sre_service_owners_owner_type_ref_idx").on(table.ownerType, table.ownerRef),
  })
);

export const sreServiceResources = pgTable(
  "sre_service_resources",
  {
    id: uuidPk(),
    serviceId: uuid("service_id").notNull().references(() => sreServices.id, { onDelete: "cascade" }),
    resourceType: varchar("resource_type", { length: 30 }).$type<SreResourceType>().notNull(),
    resourceId: uuid("resource_id").notNull(),
    relationship: varchar("relationship", { length: 20 }).$type<SreResourceRelationship>().notNull().default("monitors"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    serviceIdIdx: index("sre_service_resources_service_id_idx").on(table.serviceId),
    resourceIdx: index("sre_service_resources_resource_idx").on(table.resourceType, table.resourceId),
    serviceResourceUniqueIdx: uniqueIndex("sre_service_resources_service_resource_unique_idx").on(table.serviceId, table.resourceType, table.resourceId),
  })
);

export const sreServiceDependencies = pgTable(
  "sre_service_dependencies",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    sourceServiceId: uuid("source_service_id").notNull().references(() => sreServices.id, { onDelete: "cascade" }),
    targetServiceId: uuid("target_service_id").notNull().references(() => sreServices.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 25 }).$type<SreDependencySource>().notNull(),
    sourceRef: varchar("source_ref", { length: 255 }),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    evidenceItemId: uuid("evidence_item_id"),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    status: varchar("status", { length: 15 }).$type<SreDependencyStatus>().notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    activeDependencyUniqueIdx: uniqueIndex("sre_service_dependencies_active_unique_idx")
      .on(table.sourceServiceId, table.targetServiceId)
      .where(sql`status = 'active'`),
    targetServiceIdx: index("sre_service_dependencies_target_service_idx").on(table.targetServiceId),
    projectStatusIdx: index("sre_service_dependencies_project_status_idx").on(table.projectId, table.status),
    lastSeenAtIdx: index("sre_service_dependencies_last_seen_at_idx").on(table.lastSeenAt),
    pendingApprovalIdx: index("sre_service_dependencies_pending_approval_idx").on(table.approvedAt).where(sql`approved_at IS NULL`),
  })
);

export const sreServiceDependencyObservations = pgTable(
  "sre_service_dependency_observations",
  {
    id: uuidPk(),
    dependencyId: uuid("dependency_id").references(() => sreServiceDependencies.id, { onDelete: "cascade" }),
    sourceServiceId: uuid("source_service_id").notNull().references(() => sreServices.id, { onDelete: "cascade" }),
    targetServiceId: uuid("target_service_id").notNull().references(() => sreServices.id, { onDelete: "cascade" }),
    observedBy: varchar("observed_by", { length: 50 }).notNull(),
    observationData: jsonb("observation_data").$type<Record<string, unknown>>(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    observedAt: timestamp("observed_at").defaultNow().notNull(),
  },
  (table) => ({
    dependencyIdIdx: index("sre_service_dependency_observations_dependency_id_idx").on(table.dependencyId),
    edgeIdx: index("sre_service_dependency_observations_edge_idx").on(table.sourceServiceId, table.targetServiceId),
    observedAtIdx: index("sre_service_dependency_observations_observed_at_idx").on(table.observedAt),
  })
);

export const sreServiceHealthSnapshots = pgTable(
  "sre_service_health_snapshots",
  {
    id: uuidPk(),
    serviceId: uuid("service_id").notNull().references(() => sreServices.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    health: varchar("health", { length: 10 }).$type<SreHealth>().notNull(),
    windowStart: timestamp("window_start").notNull(),
    windowEnd: timestamp("window_end").notNull(),
    healthScore: numeric("health_score", { precision: 5, scale: 4 }),
    signals: jsonb("signals").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    serviceWindowIdx: index("sre_service_health_snapshots_service_window_idx").on(table.serviceId, table.windowEnd),
    projectHealthIdx: index("sre_service_health_snapshots_project_health_idx").on(table.projectId, table.health),
    windowEndIdx: index("sre_service_health_snapshots_window_end_idx").on(table.windowEnd),
  })
);

export const sreServiceDiscoverySuggestions = pgTable(
  "sre_service_discovery_suggestions",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    suggestionType: varchar("suggestion_type", { length: 20 }).$type<SreDiscoverySuggestionType>().notNull(),
    suggestionData: jsonb("suggestion_data").$type<Record<string, unknown>>().notNull(),
    source: varchar("source", { length: 50 }).notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    status: varchar("status", { length: 15 }).$type<SreSuggestionStatus>().notNull().default("pending"),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    pendingProjectStatusIdx: index("sre_service_discovery_suggestions_project_pending_idx")
      .on(table.projectId, table.status)
      .where(sql`status = 'pending'`),
    organizationSourceIdx: index("sre_service_discovery_suggestions_org_source_idx").on(table.organizationId, table.source),
  })
);

export const sreServiceDeployments = pgTable(
  "sre_service_deployments",
  {
    id: uuidPk(),
    serviceId: uuid("service_id").notNull().references(() => sreServices.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    deployedAt: timestamp("deployed_at").notNull(),
    deployedBy: varchar("deployed_by", { length: 200 }),
    commitSha: varchar("commit_sha", { length: 40 }),
    commitMessage: text("commit_message"),
    prUrl: varchar("pr_url", { length: 500 }),
    source: varchar("source", { length: 30 }).$type<SreDeploymentSource>().notNull(),
    sourceRef: varchar("source_ref", { length: 255 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    serviceDeployedAtIdx: index("sre_service_deployments_service_deployed_at_idx").on(table.serviceId, table.deployedAt),
    projectDeployedAtIdx: index("sre_service_deployments_project_deployed_at_idx").on(table.projectId, table.deployedAt),
    commitShaIdx: index("sre_service_deployments_commit_sha_idx").on(table.commitSha),
  })
);

export const sreAlertEvents = pgTable(
  "sre_alert_events",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    fingerprintHash: varchar("fingerprint_hash", { length: 64 }).notNull(),
    dedupKey: varchar("dedup_key", { length: 255 }),
    severity: varchar("severity", { length: 10 }).$type<SreSeverity>().notNull().default("sev3"),
    status: varchar("status", { length: 15 }).$type<SreAlertStatus>().notNull().default("firing"),
    sourceType: varchar("source_type", { length: 50 }).$type<SreAlertSourceType>().notNull(),
    sourceId: uuid("source_id"),
    serviceId: uuid("service_id").references(() => sreServices.id, { onDelete: "set null" }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    firedAt: timestamp("fired_at").notNull(),
    resolvedAt: timestamp("resolved_at"),
    silencedAt: timestamp("silenced_at"),
    silenceReason: text("silence_reason"),
    triageInvestigationRunId: uuid("triage_investigation_run_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgFingerprintUniqueIdx: uniqueIndex("sre_alert_events_org_fingerprint_unique_idx").on(table.organizationId, table.fingerprintHash),
    firingProjectStatusIdx: index("sre_alert_events_project_firing_idx").on(table.projectId, table.status).where(sql`status = 'firing'`),
    serviceStatusIdx: index("sre_alert_events_service_status_idx").on(table.serviceId, table.status),
    severityStatusIdx: index("sre_alert_events_severity_status_idx").on(table.severity, table.status),
    firedAtIdx: index("sre_alert_events_fired_at_idx").on(table.firedAt),
  })
);

export const sreIncidents = pgTable(
  "sre_incidents",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    incidentNumber: integer("incident_number").notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    severity: varchar("severity", { length: 10 }).$type<SreSeverity>().notNull().default("sev3"),
    status: varchar("status", { length: 25 }).$type<SreIncidentStatus>().notNull().default("triggered"),
    primaryServiceId: uuid("primary_service_id").references(() => sreServices.id, { onDelete: "set null" }),
    statusPageIncidentId: uuid("status_page_incident_id").references(() => statusPageIncidents.id, { onDelete: "set null" }),
    triageInvestigationRunId: uuid("triage_investigation_run_id"),
    rootCauseSummary: text("root_cause_summary"),
    confidenceScore: numeric("confidence_score", { precision: 5, scale: 4 }),
    resolvedAt: timestamp("resolved_at"),
    verifiedAt: timestamp("verified_at"),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgIncidentNumberUniqueIdx: uniqueIndex("sre_incidents_org_incident_number_unique_idx").on(table.organizationId, table.incidentNumber),
    projectStatusIdx: index("sre_incidents_project_status_idx").on(table.projectId, table.status),
    projectSeverityIdx: index("sre_incidents_project_severity_idx").on(table.projectId, table.severity),
    primaryServiceStatusIdx: index("sre_incidents_primary_service_status_idx").on(table.primaryServiceId, table.status),
    activeStatusIdx: index("sre_incidents_active_status_idx").on(table.status).where(sql`status != 'resolved'`),
  })
);

export const sreIncidentAlerts = pgTable(
  "sre_incident_alerts",
  {
    id: uuidPk(),
    incidentId: uuid("incident_id").notNull().references(() => sreIncidents.id, { onDelete: "cascade" }),
    alertEventId: uuid("alert_event_id").notNull().references(() => sreAlertEvents.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).$type<SreIncidentAlertRole>().notNull().default("trigger"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    incidentIdIdx: index("sre_incident_alerts_incident_id_idx").on(table.incidentId),
    alertEventIdIdx: index("sre_incident_alerts_alert_event_id_idx").on(table.alertEventId),
    incidentAlertUniqueIdx: uniqueIndex("sre_incident_alerts_incident_alert_unique_idx").on(table.incidentId, table.alertEventId),
  })
);

export const sreIncidentVerifications = pgTable(
  "sre_incident_verifications",
  {
    id: uuidPk(),
    incidentId: uuid("incident_id").notNull().references(() => sreIncidents.id, { onDelete: "cascade" }),
    resourceType: varchar("resource_type", { length: 20 }).$type<SreVerificationResourceType>().notNull(),
    resourceId: uuid("resource_id").notNull(),
    runId: uuid("run_id"),
    resultStatus: varchar("result_status", { length: 15 }).$type<SreVerificationStatus>().notNull().default("pending"),
    resultDetail: jsonb("result_detail").$type<Record<string, unknown>>(),
    checkedAt: timestamp("checked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    incidentIdIdx: index("sre_incident_verifications_incident_id_idx").on(table.incidentId),
    activeResultIdx: index("sre_incident_verifications_active_result_idx")
      .on(table.incidentId, table.resultStatus)
      .where(sql`result_status IN ('pending', 'running')`),
  })
);

export const privateAgents = pgTable(
  "private_agents",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    status: varchar("status", { length: 20 }).$type<PrivateAgentStatus>().notNull().default("pending"),
    version: varchar("version", { length: 50 }),
    registrationTokenHash: text("registration_token_hash"),
    agentMode: varchar("agent_mode", { length: 20 }).$type<PrivateAgentMode>().notNull().default("connector_proxy"),
    supportsSreConnectors: boolean("supports_sre_connectors").notNull().default(true),
    supportsHttpMonitoring: boolean("supports_http_monitoring").notNull().default(false),
    supportsPlaywright: boolean("supports_playwright").notNull().default(false),
    supportsK6: boolean("supports_k6").notNull().default(false),
    supportsNetworkChecks: boolean("supports_network_checks").notNull().default(false),
    region: varchar("region", { length: 50 }),
    networkLabel: varchar("network_label", { length: 100 }),
    lastHeartbeatAt: timestamp("last_heartbeat_at"),
    connectedAt: timestamp("connected_at"),
    registeredAt: timestamp("registered_at"),
    disabledAt: timestamp("disabled_at"),
    lastError: text("last_error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    organizationStatusIdx: index("private_agents_org_status_idx").on(table.organizationId, table.status),
    projectStatusIdx: index("private_agents_project_status_idx").on(table.projectId, table.status),
    agentModeStatusIdx: index("private_agents_mode_status_idx").on(table.agentMode, table.status),
    connectedHeartbeatIdx: index("private_agents_connected_heartbeat_idx").on(table.lastHeartbeatAt).where(sql`status = 'connected'`),
  })
);

export const externalConnectors = pgTable(
  "external_connectors",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    privateAgentId: uuid("private_agent_id").references(() => privateAgents.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 100 }).notNull(),
    type: varchar("type", { length: 50 }).$type<ExternalConnectorType>().notNull(),
    riskLevel: varchar("risk_level", { length: 10 }).$type<ExternalConnectorRiskLevel>().notNull().default("low"),
    permissionLevel: varchar("permission_level", { length: 10 }).$type<ExternalConnectorPermissionLevel>().notNull().default("read"),
    sideEffectLevel: varchar("side_effect_level", { length: 10 }).$type<ExternalConnectorSideEffectLevel>().notNull().default("none"),
    status: varchar("status", { length: 20 }).$type<ExternalConnectorStatus>().notNull().default("configured"),
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    defaultTimeWindowMinutes: integer("default_time_window_minutes").notNull().default(60),
    outputLimits: jsonb("output_limits").$type<Record<string, unknown>>(),
    lastValidatedAt: timestamp("last_validated_at"),
    lastValidationStatus: varchar("last_validation_status", { length: 20 }).$type<ExternalConnectorValidationStatus>(),
    lastValidationError: text("last_validation_error"),
    lastValidationLatencyMs: integer("last_validation_latency_ms"),
    validatedByPrivateAgentId: uuid("validated_by_private_agent_id").references(() => privateAgents.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    permissionLevelReadCheck: check(
      "external_connectors_permission_level_read_check",
      sql`${table.permissionLevel} = 'read'`
    ),
    sideEffectLevelNoneCheck: check(
      "external_connectors_side_effect_level_none_check",
      sql`${table.sideEffectLevel} = 'none'`
    ),
    organizationTypeIdx: index("external_connectors_org_type_idx").on(table.organizationId, table.type),
    validOrganizationStatusIdx: index("external_connectors_valid_org_status_idx").on(table.organizationId, table.status).where(sql`status = 'valid'`),
    projectTypeIdx: index("external_connectors_project_type_idx").on(table.projectId, table.type),
    privateAgentIdx: index("external_connectors_private_agent_idx").on(table.privateAgentId).where(sql`private_agent_id IS NOT NULL`),
  })
);

export const privateAgentCredentials = pgTable(
  "private_agent_credentials",
  {
    id: uuidPk(),
    privateAgentId: uuid("private_agent_id").notNull().references(() => privateAgents.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    keyId: varchar("key_id", { length: 100 }).notNull(),
    secretHash: text("secret_hash").notNull(),
    issuedAt: timestamp("issued_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    lastUsedAt: timestamp("last_used_at"),
    rotatedAt: timestamp("rotated_at"),
    revokedAt: timestamp("revoked_at"),
    revokedByUserId: uuid("revoked_by_user_id").references(() => user.id, { onDelete: "set null" }),
    revocationReason: text("revocation_reason"),
  },
  (table) => ({
    privateAgentIdIdx: index("private_agent_credentials_private_agent_id_idx").on(table.privateAgentId),
    keyIdUniqueIdx: uniqueIndex("private_agent_credentials_key_id_unique_idx").on(table.keyId),
    expiresAtIdx: index("private_agent_credentials_expires_at_idx").on(table.expiresAt).where(sql`expires_at IS NOT NULL`),
    revokedAtIdx: index("private_agent_credentials_revoked_at_idx").on(table.revokedAt).where(sql`revoked_at IS NOT NULL`),
  })
);

export const privateAgentHeartbeats = pgTable(
  "private_agent_heartbeats",
  {
    id: uuidPk(),
    privateAgentId: uuid("private_agent_id").notNull().references(() => privateAgents.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).$type<"connected" | "unhealthy" | "disconnected">().notNull(),
    protocolVersion: varchar("protocol_version", { length: 30 }).notNull(),
    agentVersion: varchar("agent_version", { length: 50 }).notNull(),
    activeJobCount: integer("active_job_count").notNull().default(0),
    reportedCapabilities: jsonb("reported_capabilities").$type<Record<string, unknown>>().default({}),
    latencyMs: integer("latency_ms"),
    errorCode: varchar("error_code", { length: 100 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    privateAgentCreatedIdx: index("private_agent_heartbeats_agent_created_idx").on(table.privateAgentId, table.createdAt),
    organizationCreatedIdx: index("private_agent_heartbeats_org_created_idx").on(table.organizationId, table.createdAt),
  })
);

export const externalConnectorServices = pgTable(
  "external_connector_services",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id").notNull().references(() => externalConnectors.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull().references(() => sreServices.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    connectorServiceUniqueIdx: uniqueIndex("external_connector_services_connector_service_unique_idx").on(table.connectorId, table.serviceId),
    projectServiceIdx: index("external_connector_services_project_service_idx").on(table.projectId, table.serviceId),
    organizationConnectorIdx: index("external_connector_services_org_connector_idx").on(table.organizationId, table.connectorId),
  })
);

export const externalConnectorCredentials = pgTable(
  "external_connector_credentials",
  {
    id: uuidPk(),
    connectorId: uuid("connector_id").notNull().references(() => externalConnectors.id, { onDelete: "cascade" }),
    credentialType: varchar("credential_type", { length: 20 }).$type<ExternalConnectorCredentialType>().notNull(),
    encryptedCredential: text("encrypted_credential").notNull(),
    encryptionVersion: integer("encryption_version").notNull().default(1),
    encryptionKeyContext: varchar("encryption_key_context", { length: 255 }),
    expiresAt: timestamp("expires_at"),
    lastRotatedAt: timestamp("last_rotated_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    connectorIdIdx: index("external_connector_credentials_connector_id_idx").on(table.connectorId),
    expiresAtIdx: index("external_connector_credentials_expires_at_idx").on(table.expiresAt).where(sql`expires_at IS NOT NULL`),
  })
);

export const diagnosticQueries = pgTable(
  "diagnostic_queries",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id").notNull().references(() => externalConnectors.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 150 }).notNull(),
    queryType: varchar("query_type", { length: 30 }).$type<DiagnosticQueryType>().notNull(),
    template: text("template").notNull(),
    parameterSchema: jsonb("parameter_schema").$type<Record<string, unknown>>().notNull(),
    allowlist: jsonb("allowlist").$type<Record<string, unknown>>().notNull(),
    maxRows: integer("max_rows").notNull().default(100),
    maxBytes: integer("max_bytes").notNull().default(1048576),
    maxSeconds: integer("max_seconds").notNull().default(10),
    status: varchar("status", { length: 20 }).$type<DiagnosticQueryStatus>().notNull().default("active"),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    projectConnectorIdx: index("diagnostic_queries_project_connector_idx").on(table.projectId, table.connectorId),
    organizationStatusIdx: index("diagnostic_queries_org_status_idx").on(table.organizationId, table.status),
    queryTypeStatusIdx: index("diagnostic_queries_query_type_status_idx").on(table.queryType, table.status),
  })
);

export const privateAgentJobs = pgTable(
  "private_agent_jobs",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    privateAgentId: uuid("private_agent_id").notNull().references(() => privateAgents.id, { onDelete: "restrict" }),
    connectorId: uuid("connector_id").references(() => externalConnectors.id, { onDelete: "set null" }),
    jobClass: varchar("job_class", { length: 30 }).$type<PrivateAgentJobClass>().notNull(),
    status: varchar("status", { length: 20 }).$type<PrivateAgentJobStatus>().notNull().default("queued"),
    authorizedBy: varchar("authorized_by", { length: 30 }).$type<SreActorType>().notNull(),
    authorizedByUserId: uuid("authorized_by_user_id").references(() => user.id, { onDelete: "set null" }),
    policyDecisionHash: varchar("policy_decision_hash", { length: 128 }).notNull(),
    jobSpecHash: varchar("job_spec_hash", { length: 128 }).notNull(),
    jobSpec: jsonb("job_spec").$type<Record<string, unknown>>().notNull().default({}),
    leaseTokenHash: varchar("lease_token_hash", { length: 128 }),
    leaseExpiresAt: timestamp("lease_expires_at"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    cancelRequestedAt: timestamp("cancel_requested_at"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    durationMs: integer("duration_ms"),
    errorCode: varchar("error_code", { length: 100 }),
    resultHash: varchar("result_hash", { length: 128 }),
    resultSummary: jsonb("result_summary").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    privateAgentStatusIdx: index("private_agent_jobs_agent_status_idx").on(table.privateAgentId, table.status),
    projectClassStatusIdx: index("private_agent_jobs_project_class_status_idx").on(table.projectId, table.jobClass, table.status),
    idempotencyKeyUniqueIdx: uniqueIndex("private_agent_jobs_idempotency_key_unique_idx").on(table.idempotencyKey),
    leaseExpiresAtIdx: index("private_agent_jobs_lease_expires_at_idx").on(table.leaseExpiresAt).where(sql`status IN ('leased', 'running')`),
  })
);

export const privateAgentArtifacts = pgTable(
  "private_agent_artifacts",
  {
    id: uuidPk(),
    privateAgentJobId: uuid("private_agent_job_id").notNull().references(() => privateAgentJobs.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    artifactType: varchar("artifact_type", { length: 30 }).$type<PrivateAgentArtifactType>().notNull(),
    s3Path: text("s3_path").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    contentType: varchar("content_type", { length: 100 }),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    privateAgentJobIdIdx: index("private_agent_artifacts_job_id_idx").on(table.privateAgentJobId),
    projectArtifactTypeIdx: index("private_agent_artifacts_project_type_idx").on(table.projectId, table.artifactType),
    createdAtIdx: index("private_agent_artifacts_created_at_idx").on(table.createdAt),
  })
);

export const sreEvidenceItems = pgTable(
  "sre_evidence_items",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").references(() => sreIncidents.id, { onDelete: "set null" }),
    investigationRunId: uuid("investigation_run_id"),
    sourceType: varchar("source_type", { length: 30 }).$type<SreEvidenceSourceType>().notNull(),
    sourceConnectorId: uuid("source_connector_id").references(() => externalConnectors.id, { onDelete: "set null" }),
    sourceUri: varchar("source_uri", { length: 1000 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    summary: text("summary"),
    rawContentS3Path: text("raw_content_s3_path"),
    rawContentExcerpt: text("raw_content_excerpt"),
    evidenceType: varchar("evidence_type", { length: 15 }).$type<SreEvidenceType>().notNull(),
    severity: varchar("severity", { length: 10 }),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    tags: jsonb("tags").$type<Record<string, unknown>>().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    citationQuery: text("citation_query"),
    citationResultHash: varchar("citation_result_hash", { length: 64 }),
    observedAt: timestamp("observed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    incidentIdIdx: index("sre_evidence_items_incident_id_idx").on(table.incidentId),
    investigationRunIdIdx: index("sre_evidence_items_investigation_run_id_idx").on(table.investigationRunId),
    sourceConnectorIdx: index("sre_evidence_items_source_connector_idx").on(table.sourceType, table.sourceConnectorId),
    evidenceTypeIdx: index("sre_evidence_items_evidence_type_idx").on(table.evidenceType),
    observedAtIdx: index("sre_evidence_items_observed_at_idx").on(table.observedAt),
  })
);

export const sreInvestigationRuns = pgTable(
  "sre_investigation_runs",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").references(() => sreIncidents.id, { onDelete: "set null" }),
    alertEventId: uuid("alert_event_id").references(() => sreAlertEvents.id, { onDelete: "set null" }),
    agentType: varchar("agent_type", { length: 25 }).$type<SreAgentType>().notNull(),
    status: varchar("status", { length: 15 }).$type<SreRunStatus>().notNull().default("running"),
    modelId: varchar("model_id", { length: 100 }).notNull(),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    estimatedCostCents: integer("estimated_cost_cents"),
    confidenceScore: numeric("confidence_score", { precision: 5, scale: 4 }),
    rootCauseHypothesis: text("root_cause_hypothesis"),
    agentStateSnapshot: jsonb("agent_state_snapshot").$type<Record<string, unknown>>(),
    promptInput: jsonb("prompt_input").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    durationMs: integer("duration_ms"),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    incidentIdIdx: index("sre_investigation_runs_incident_id_idx").on(table.incidentId),
    projectStatusIdx: index("sre_investigation_runs_project_status_idx").on(table.projectId, table.status),
    agentTypeStatusIdx: index("sre_investigation_runs_agent_type_status_idx").on(table.agentType, table.status),
    modelIdIdx: index("sre_investigation_runs_model_id_idx").on(table.modelId),
    lowConfidenceIdx: index("sre_investigation_runs_low_confidence_idx").on(table.confidenceScore).where(sql`confidence_score < 0.5`),
    createdAtIdx: index("sre_investigation_runs_created_at_idx").on(table.createdAt),
  })
);

export const sreInvestigationToolCalls = pgTable(
  "sre_investigation_tool_calls",
  {
    id: uuidPk(),
    investigationRunId: uuid("investigation_run_id").references(() => sreInvestigationRuns.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id").references(() => externalConnectors.id, { onDelete: "set null" }),
    connectorType: varchar("connector_type", { length: 50 }).notNull(),
    toolName: varchar("tool_name", { length: 100 }).notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    inputSummary: text("input_summary"),
    rawInputS3Path: text("raw_input_s3_path"),
    outputHash: varchar("output_hash", { length: 64 }),
    outputSummary: text("output_summary"),
    rawOutputS3Path: text("raw_output_s3_path"),
    status: varchar("status", { length: 15 }).$type<SreToolCallStatus>().notNull().default("success"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    costEstimateCents: integer("cost_estimate_cents"),
    evidenceItemId: uuid("evidence_item_id").references(() => sreEvidenceItems.id, { onDelete: "set null" }),
    executedAt: timestamp("executed_at").defaultNow().notNull(),
  },
  (table) => ({
    investigationRunIdIdx: index("sre_investigation_tool_calls_run_id_idx")
      .on(table.investigationRunId)
      .where(sql`investigation_run_id IS NOT NULL`),
    connectorTypeIdx: index("sre_investigation_tool_calls_connector_type_idx").on(table.connectorType),
    executedAtIdx: index("sre_investigation_tool_calls_executed_at_idx").on(table.executedAt),
  })
);

export const sreAiSuggestions = pgTable(
  "sre_ai_suggestions",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").references(() => sreIncidents.id, { onDelete: "cascade" }),
    investigationRunId: uuid("investigation_run_id").references(() => sreInvestigationRuns.id, { onDelete: "set null" }),
    suggestionType: varchar("suggestion_type", { length: 30 }).$type<SreAiSuggestionType>().notNull(),
    content: text("content").notNull(),
    modelId: varchar("model_id", { length: 100 }).notNull(),
    confidenceScore: numeric("confidence_score", { precision: 5, scale: 4 }),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    promptInput: jsonb("prompt_input").$type<Record<string, unknown>>(),
    accepted: boolean("accepted"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    incidentIdIdx: index("sre_ai_suggestions_incident_id_idx").on(table.incidentId),
    suggestionTypeIdx: index("sre_ai_suggestions_type_idx").on(table.suggestionType),
    incidentSuggestionTypeIdx: index("sre_ai_suggestions_incident_type_idx").on(table.incidentId, table.suggestionType),
  })
);

export const sreInvestigationRecommendations = pgTable(
  "sre_investigation_recommendations",
  {
    id: uuidPk(),
    incidentId: uuid("incident_id").notNull().references(() => sreIncidents.id, { onDelete: "cascade" }),
    investigationRunId: uuid("investigation_run_id").notNull().references(() => sreInvestigationRuns.id, { onDelete: "cascade" }),
    recommendationText: text("recommendation_text").notNull(),
    stepCount: integer("step_count"),
    confidenceScore: numeric("confidence_score", { precision: 5, scale: 4 }),
    applicationStatus: varchar("application_status", { length: 20 }).$type<SreRecommendationStatus>().notNull().default("pending"),
    appliedAt: timestamp("applied_at"),
    supersededById: uuid("superseded_by_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    incidentIdIdx: index("sre_investigation_recommendations_incident_id_idx").on(table.incidentId),
    pendingIncidentIdx: index("sre_investigation_recommendations_pending_incident_idx")
      .on(table.incidentId, table.applicationStatus)
      .where(sql`application_status = 'pending'`),
  })
);

export const sreIncidentTimelineEvents = pgTable(
  "sre_incident_timeline_events",
  {
    id: uuidPk(),
    incidentId: uuid("incident_id").notNull().references(() => sreIncidents.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 25 }).$type<SreTimelineEventType>().notNull(),
    eventData: jsonb("event_data").$type<Record<string, unknown>>(),
    actorType: varchar("actor_type", { length: 10 }).$type<SreActorType>().notNull().default("user"),
    actorUserId: uuid("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    agentRunId: uuid("agent_run_id").references(() => sreInvestigationRuns.id, { onDelete: "set null" }),
    evidenceItemId: uuid("evidence_item_id").references(() => sreEvidenceItems.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    incidentCreatedIdx: index("sre_incident_timeline_events_incident_created_idx").on(table.incidentId, table.createdAt),
    actorAgentIdx: index("sre_incident_timeline_events_actor_agent_idx").on(table.actorType, table.agentRunId),
    eventTypeIdx: index("sre_incident_timeline_events_event_type_idx").on(table.eventType),
  })
);

export const sreRunbooks = pgTable(
  "sre_runbooks",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => sreServices.id, { onDelete: "set null" }),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    triggerConditions: jsonb("trigger_conditions").$type<Record<string, unknown>>(),
    status: varchar("status", { length: 15 }).$type<SreRunbookStatus>().notNull().default("active"),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    projectServiceIdx: index("sre_runbooks_project_service_idx").on(table.projectId, table.serviceId),
    organizationNameIdx: index("sre_runbooks_org_name_idx").on(table.organizationId, table.name),
  })
);

export const sreRunbookSteps = pgTable(
  "sre_runbook_steps",
  {
    id: uuidPk(),
    runbookId: uuid("runbook_id").notNull().references(() => sreRunbooks.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull(),
    instruction: text("instruction").notNull(),
    agentAssisted: boolean("agent_assisted").notNull().default(false),
    evidenceGatheringAction: varchar("evidence_gathering_action", { length: 100 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    runbookStepOrderIdx: index("sre_runbook_steps_runbook_step_order_idx").on(table.runbookId, table.stepOrder),
  })
);

export const sreIncidentRunbookSteps = pgTable(
  "sre_incident_runbook_steps",
  {
    id: uuidPk(),
    incidentId: uuid("incident_id").notNull().references(() => sreIncidents.id, { onDelete: "cascade" }),
    runbookStepId: uuid("runbook_step_id").references(() => sreRunbookSteps.id, { onDelete: "set null" }),
    runbookId: uuid("runbook_id").references(() => sreRunbooks.id, { onDelete: "set null" }),
    stepOrder: integer("step_order").notNull(),
    instruction: text("instruction").notNull(),
    status: varchar("status", { length: 15 }).$type<SreRunbookStepStatus>().notNull().default("pending"),
    completedBy: uuid("completed_by").references(() => user.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    incidentIdIdx: index("sre_incident_runbook_steps_incident_id_idx").on(table.incidentId),
    activeIncidentStatusIdx: index("sre_incident_runbook_steps_active_status_idx")
      .on(table.incidentId, table.status)
      .where(sql`status IN ('pending', 'in_progress')`),
  })
);

export const sreContextObservations = pgTable(
  "sre_context_observations",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => sreServices.id, { onDelete: "cascade" }),
    observationType: varchar("observation_type", { length: 50 }).notNull(),
    content: text("content").notNull(),
    source: varchar("source", { length: 50 }).notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    serviceIdIdx: index("sre_context_observations_service_id_idx").on(table.serviceId),
    projectObservationTypeIdx: index("sre_context_observations_project_type_idx").on(table.projectId, table.observationType),
  })
);

export const sreContextRecollections = pgTable(
  "sre_context_recollections",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").references(() => sreIncidents.id, { onDelete: "set null" }),
    serviceId: uuid("service_id").references(() => sreServices.id, { onDelete: "set null" }),
    errorFingerprint: varchar("error_fingerprint", { length: 64 }),
    isolatingQuery: text("isolating_query"),
    whatWasTried: jsonb("what_was_tried").$type<Record<string, unknown>[]>(),
    rootCause: text("root_cause"),
    resolution: text("resolution"),
    promotedToPlaybookId: uuid("promoted_to_playbook_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    incidentIdIdx: index("sre_context_recollections_incident_id_idx").on(table.incidentId),
    serviceIdIdx: index("sre_context_recollections_service_id_idx").on(table.serviceId),
    errorFingerprintIdx: index("sre_context_recollections_error_fingerprint_idx").on(table.errorFingerprint),
  })
);

export const sreContextPlaybooks = pgTable(
  "sre_context_playbooks",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    promotedFromRecollectionId: uuid("promoted_from_recollection_id").references(() => sreContextRecollections.id, { onDelete: "set null" }),
    name: varchar("name", { length: 200 }).notNull(),
    alertSignatureHash: varchar("alert_signature_hash", { length: 64 }).notNull(),
    alertSignature: jsonb("alert_signature").$type<Record<string, unknown>>().notNull(),
    playbookContent: text("playbook_content").notNull(),
    matchCount: integer("match_count").notNull().default(0),
    status: varchar("status", { length: 15 }).$type<SreContextPlaybookStatus>().notNull().default("active"),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    organizationAlertSignatureIdx: index("sre_context_playbooks_org_alert_signature_idx").on(table.organizationId, table.alertSignatureHash),
    projectStatusIdx: index("sre_context_playbooks_project_status_idx").on(table.projectId, table.status),
    alertSignatureGinIdx: index("sre_context_playbooks_alert_signature_gin_idx").using("gin", table.alertSignature),
  })
);

export const sreBackgroundAgentRuns = pgTable(
  "sre_background_agent_runs",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    agentType: varchar("agent_type", { length: 50 }).$type<SreBackgroundAgentType>().notNull(),
    status: varchar("status", { length: 15 }).$type<SreBackgroundRunStatus>().notNull().default("scheduled"),
    scheduleId: varchar("schedule_id", { length: 100 }),
    triggerAt: timestamp("trigger_at").notNull(),
    completedAt: timestamp("completed_at"),
    resultSummary: text("result_summary"),
    resultData: jsonb("result_data").$type<Record<string, unknown>>(),
    investigationRunId: uuid("investigation_run_id").references(() => sreInvestigationRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    activeProjectStatusIdx: index("sre_background_agent_runs_active_project_status_idx")
      .on(table.projectId, table.status)
      .where(sql`status IN ('scheduled', 'running')`),
    scheduleCreatedIdx: index("sre_background_agent_runs_schedule_created_idx").on(table.scheduleId, table.createdAt),
  })
);

export const sreChatConversations = pgTable(
  "sre_chat_conversations",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").references(() => sreIncidents.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }),
    scope: jsonb("scope").$type<Record<string, unknown>>(),
    status: varchar("status", { length: 15 }).$type<SreChatConversationStatus>().notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userUpdatedAtIdx: index("sre_chat_conversations_user_updated_at_idx").on(table.userId, table.updatedAt),
    incidentIdIdx: index("sre_chat_conversations_incident_id_idx").on(table.incidentId),
    projectStatusIdx: index("sre_chat_conversations_project_status_idx").on(table.projectId, table.status),
  })
);

export const sreChatMessages = pgTable(
  "sre_chat_messages",
  {
    id: uuidPk(),
    conversationId: uuid("conversation_id").notNull().references(() => sreChatConversations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 15 }).$type<SreChatMessageRole>().notNull(),
    content: text("content"),
    attachments: jsonb("attachments").$type<Record<string, unknown>[]>(),
    toolCallId: uuid("tool_call_id").references(() => sreInvestigationToolCalls.id, { onDelete: "set null" }),
    evidenceItemIds: jsonb("evidence_item_ids").$type<string[]>(),
    investigationRunId: uuid("investigation_run_id").references(() => sreInvestigationRuns.id, { onDelete: "set null" }),
    modelId: varchar("model_id", { length: 100 }),
    tokenCount: integer("token_count"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    conversationCreatedIdx: index("sre_chat_messages_conversation_created_idx").on(table.conversationId, table.createdAt),
    roleIdx: index("sre_chat_messages_role_idx").on(table.role),
  })
);

const sreTables = {
  sreServices,
  sreServiceOwners,
  sreServiceResources,
  sreServiceDependencies,
  sreServiceDependencyObservations,
  sreServiceHealthSnapshots,
  sreServiceDiscoverySuggestions,
  sreServiceDeployments,
  sreAlertEvents,
  sreIncidents,
  sreIncidentAlerts,
  sreIncidentTimelineEvents,
  sreIncidentVerifications,
  sreEvidenceItems,
  sreInvestigationRuns,
  sreInvestigationToolCalls,
  sreAiSuggestions,
  sreInvestigationRecommendations,
  sreRunbooks,
  sreRunbookSteps,
  sreIncidentRunbookSteps,
  privateAgents,
  privateAgentCredentials,
  privateAgentHeartbeats,
  externalConnectors,
  externalConnectorServices,
  externalConnectorCredentials,
  diagnosticQueries,
  privateAgentJobs,
  privateAgentArtifacts,
  sreContextObservations,
  sreContextRecollections,
  sreContextPlaybooks,
  sreBackgroundAgentRuns,
  sreChatConversations,
  sreChatMessages,
};

export const sreInsertSchemas = Object.fromEntries(
  Object.entries(sreTables).map(([name, table]) => [name, createInsertSchema(table)])
);

export const sreSelectSchemas = Object.fromEntries(
  Object.entries(sreTables).map(([name, table]) => [name, createSelectSchema(table)])
);

export type SreService = typeof sreServices.$inferSelect;
export type SreServiceInsert = typeof sreServices.$inferInsert;
export type SreAlertEvent = typeof sreAlertEvents.$inferSelect;
export type SreAlertEventInsert = typeof sreAlertEvents.$inferInsert;
export type SreIncident = typeof sreIncidents.$inferSelect;
export type SreIncidentInsert = typeof sreIncidents.$inferInsert;
export type SreEvidenceItem = typeof sreEvidenceItems.$inferSelect;
export type SreEvidenceItemInsert = typeof sreEvidenceItems.$inferInsert;
export type SreInvestigationRun = typeof sreInvestigationRuns.$inferSelect;
export type SreInvestigationRunInsert = typeof sreInvestigationRuns.$inferInsert;
export type SreInvestigationToolCall = typeof sreInvestigationToolCalls.$inferSelect;
export type SreInvestigationToolCallInsert = typeof sreInvestigationToolCalls.$inferInsert;
export type ExternalConnector = typeof externalConnectors.$inferSelect;
export type ExternalConnectorInsert = typeof externalConnectors.$inferInsert;
export type PrivateAgent = typeof privateAgents.$inferSelect;
export type PrivateAgentInsert = typeof privateAgents.$inferInsert;
export type SreChatConversation = typeof sreChatConversations.$inferSelect;
export type SreChatConversationInsert = typeof sreChatConversations.$inferInsert;
export type SreChatMessage = typeof sreChatMessages.$inferSelect;
export type SreChatMessageInsert = typeof sreChatMessages.$inferInsert;
