/* ================================
   SRE SCHEMA
   -------------------------------
   Tables for AI SRE service topology, incidents, evidence, connectors, agents,
   context memory, and chat history.
=================================== */

import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  smallint,
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
import { notificationProviders } from "./notification";
import { organization, projects } from "./organization";
import { incidents as statusPageIncidents } from "./statusPage";
import { inValues } from "./types";

export const SRE_TIER_VALUES = ["1", "2", "3", "4"] as const;
type SreTier = (typeof SRE_TIER_VALUES)[number];
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
  | "user_action"
  /** Reminder, escalation or failed page (eventData.kind). */
  | "notification";
export type SrePostmortemSection = "summary" | "impact" | "timeline" | "root_cause" | "contributing_factors" | "follow_ups";
export type SrePostmortem = {
  sections: Partial<Record<SrePostmortemSection, string>>;
  generatedAt?: string;
  updatedAt?: string;
};
type SreInvestigationFeedbackVerdict = "right" | "wrong";
type SreActorType = "user" | "agent" | "system";
type SreVerificationResourceType = "monitor" | "test" | "k6";
type SreVerificationStatus = "pending" | "running" | "passed" | "failed";
type SreEvidenceSourceType =
  | "native"
  | "github"
  | "gitlab"
  | "kubernetes"
  | "prometheus"
  | "grafana"
  | "datadog"
  | "aws_cloudwatch"
  | "sentry"
  | "loki"
  | "elasticsearch"
  | "tempo"
  | "pagerduty"
  | "opsgenie"
  | "jira"
  | "confluence"
  | "notion"
  | "jaeger"
  | "newrelic"
  | "gcp_monitoring"
  | "azure_monitor"
  | "splunk"
  | "mcp";
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
type DiagnosticQueryType = "promql" | "logql" | "traceql" | "http_get";
type DiagnosticQueryStatus = "active" | "disabled";
type SreContextPlaybookStatus = "active" | "deprecated";
type SreBackgroundAgentType = "post_deploy_check" | "weekly_report" | "regression_detection" | "k6_trend_analysis";
type SreBackgroundRunStatus = "scheduled" | "running" | "completed" | "failed";
type SreChatConversationStatus = "active" | "archived";
type SreChatMessageRole = "user" | "assistant" | "system" | "tool";
type SreInvestigationReportStatus = "active" | "superseded";
type SreInvestigationReportFeedbackAccuracy = "accurate" | "partially_accurate" | "incorrect" | "needs_more_evidence";
type SreEvidenceGraphFocusedViewStatus = "active" | "archived";
type SreEvidenceGraphFocusedViewVisibility = "project";
type SreIntegrationKey =
  | "pagerduty"
  | "opsgenie"
  | "jsm_ops"
  | "splunk_on_call"
  | "better_stack"
  | "incident_io"
  | "slack"
  | "teams"
  | "generic_webhook";
type SreIntegrationCorrelationStrategy =
  | "dedup_key"
  | "alias"
  | "entity_id"
  | "incident_url"
  | "thread"
  | "custom";

type ExternalConnectorType =
  | "github"
  | "kubernetes"
  | "prometheus"
  | "grafana"
  | "datadog"
  | "splunk"
  | "newrelic"
  | "sentry"
  | "loki"
  | "elasticsearch"
  | "tempo"
  | "jaeger"
  | "aws_cloudwatch"
  | "gcp_monitoring"
  | "azure_monitor"
  | "gitlab"
  | "confluence"
  | "notion"
  | "pagerduty"
  | "opsgenie"
  | "jira"
  | "mcp"
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
    runbookId: uuid("runbook_id").references((): AnyPgColumn => sreRunbooks.id, { onDelete: "set null" }),
    repoUrl: varchar("repo_url", { length: 500 }),
    otelServiceName: varchar("otel_service_name", { length: 100 }),
    slackChannel: varchar("slack_channel", { length: 100 }),
    tags: jsonb("tags").$type<string[]>().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    status: varchar("status", { length: 20 }).$type<SreServiceStatus>().notNull().default("active"),
    mergedIntoServiceId: uuid("merged_into_service_id").references((): AnyPgColumn => sreServices.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectOrgStatusIdx: index("sre_services_project_org_status_idx").on(table.projectId, table.organizationId, table.status),
    activeProjectNameUniqueIdx: uniqueIndex("sre_services_active_project_name_unique_idx")
      .on(table.organizationId, table.projectId, table.name)
      .where(sql`status = 'active'`),
    projectEnvironmentIdx: index("sre_services_project_environment_idx").on(table.projectId, table.environment),
    projectTierIdx: index("sre_services_project_tier_idx").on(table.projectId, table.tier),
    sreServicesOrganizationIdIdx: index("sre_services_organization_id_idx").on(table.organizationId),
    sreServicesOwnerUserIdIdx: index("sre_services_owner_user_id_idx").on(table.ownerUserId),
    sreServicesRunbookIdIdx: index("sre_services_runbook_id_idx").on(table.runbookId),
    sreServicesMergedIntoServiceIdIdx: index("sre_services_merged_into_service_id_idx").on(table.mergedIntoServiceId),
    sreServicesStatusCheck: check("sre_services_status_check", sql`${table.status} IN ('active', 'deprecated', 'merged')`),
    sreServicesTierCheck: check("sre_services_tier_check", inValues(table.tier, SRE_TIER_VALUES)),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    ownerUniqueIdx: uniqueIndex("sre_service_owners_unique_idx").on(table.serviceId, table.ownerType, table.ownerRef, table.role),
    ownerRefIdx: index("sre_service_owners_owner_type_ref_idx").on(table.ownerType, table.ownerRef),
    sreServiceOwnersOwnerTypeCheck: check("sre_service_owners_owner_type_check", sql`${table.ownerType} IN ('team', 'user', 'slack')`),
    sreServiceOwnersRoleCheck: check("sre_service_owners_role_check", sql`${table.role} IN ('primary', 'on-call', 'secondary', 'reviewer')`),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    resourceIdx: index("sre_service_resources_resource_idx").on(table.resourceType, table.resourceId),
    serviceResourceUniqueIdx: uniqueIndex("sre_service_resources_service_resource_unique_idx").on(table.serviceId, table.resourceType, table.resourceId),
    sreServiceResourcesResourceTypeCheck: check("sre_service_resources_resource_type_check", sql`${table.resourceType} IN ('monitor', 'job', 'test', 'status_page_component', 'k6_run')`),
    sreServiceResourcesRelationshipCheck: check("sre_service_resources_relationship_check", sql`${table.relationship} IN ('monitors', 'owned', 'depends_on')`),
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
    evidenceItemId: uuid("evidence_item_id").references((): AnyPgColumn => sreEvidenceItems.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    status: varchar("status", { length: 15 }).$type<SreDependencyStatus>().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    activeDependencyUniqueIdx: uniqueIndex("sre_service_dependencies_active_unique_idx")
      .on(table.sourceServiceId, table.targetServiceId)
      .where(sql`status = 'active'`),
    targetServiceIdx: index("sre_service_dependencies_target_service_idx").on(table.targetServiceId),
    projectStatusIdx: index("sre_service_dependencies_project_status_idx").on(table.projectId, table.status),
    lastSeenAtIdx: index("sre_service_dependencies_last_seen_at_idx").on(table.lastSeenAt),
    pendingApprovalIdx: index("sre_service_dependencies_pending_approval_idx").on(table.approvedAt).where(sql`approved_at IS NULL`),
    sreServiceDependenciesApprovedByIdx: index("sre_service_dependencies_approved_by_idx").on(table.approvedBy),
    sreServiceDependenciesOrganizationIdIdx: index("sre_service_dependencies_organization_id_idx").on(table.organizationId),
    sreServiceDependenciesSourceServiceIdIdx: index("sre_service_dependencies_source_service_id_idx").on(table.sourceServiceId),
    sreServiceDependenciesEvidenceItemIdIdx: index("sre_service_dependencies_evidence_item_id_idx").on(table.evidenceItemId),
    sreServiceDependenciesStatusCheck: check("sre_service_dependencies_status_check", sql`${table.status} IN ('active', 'stale', 'rejected')`),
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
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    dependencyIdIdx: index("sre_service_dependency_observations_dependency_id_idx").on(table.dependencyId),
    edgeIdx: index("sre_service_dependency_observations_edge_idx").on(table.sourceServiceId, table.targetServiceId),
    observedAtIdx: index("sre_service_dependency_observations_observed_at_idx").on(table.observedAt),
    sreServiceDependencyObservationsTargetServiceIdIdx: index("sre_service_dependency_observations_target_service_id_idx").on(table.targetServiceId),
  })
);

export const sreServiceHealthSnapshots = pgTable(
  "sre_service_health_snapshots",
  {
    id: uuidPk(),
    serviceId: uuid("service_id").notNull().references(() => sreServices.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    health: varchar("health", { length: 10 }).$type<SreHealth>().notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    healthScore: numeric("health_score", { precision: 5, scale: 4 }),
    signals: jsonb("signals").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pendingProjectStatusIdx: index("sre_service_discovery_suggestions_project_pending_idx")
      .on(table.projectId, table.status)
      .where(sql`status = 'pending'`),
    organizationSourceIdx: index("sre_service_discovery_suggestions_org_source_idx").on(table.organizationId, table.source),
    sreServiceDiscoverySuggestionsApprovedByIdx: index("sre_service_discovery_suggestions_approved_by_idx").on(table.approvedBy),
    sreServiceDiscoverySuggestionsProjectIdIdx: index("sre_service_discovery_suggestions_project_id_idx").on(table.projectId),
  })
);

export const sreServiceDeployments = pgTable(
  "sre_service_deployments",
  {
    id: uuidPk(),
    serviceId: uuid("service_id").notNull().references(() => sreServices.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    deployedAt: timestamp("deployed_at", { withTimezone: true }).notNull(),
    deployedBy: varchar("deployed_by", { length: 200 }),
    commitSha: varchar("commit_sha", { length: 40 }),
    commitMessage: text("commit_message"),
    prUrl: varchar("pr_url", { length: 500 }),
    source: varchar("source", { length: 30 }).$type<SreDeploymentSource>().notNull(),
    sourceRef: varchar("source_ref", { length: 255 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    silencedAt: timestamp("silenced_at", { withTimezone: true }),
    silenceReason: text("silence_reason"),
    triageInvestigationRunId: uuid("triage_investigation_run_id").references((): AnyPgColumn => sreInvestigationRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgFingerprintUniqueIdx: uniqueIndex("sre_alert_events_org_fingerprint_unique_idx").on(table.organizationId, table.fingerprintHash),
    firingProjectStatusIdx: index("sre_alert_events_project_firing_idx").on(table.projectId, table.status).where(sql`status = 'firing'`),
    serviceStatusIdx: index("sre_alert_events_service_status_idx").on(table.serviceId, table.status),
    severityStatusIdx: index("sre_alert_events_severity_status_idx").on(table.severity, table.status),
    firedAtIdx: index("sre_alert_events_fired_at_idx").on(table.firedAt),
    sreAlertEventsProjectIdIdx: index("sre_alert_events_project_id_idx").on(table.projectId),
    sreAlertEventsTriageInvestigationRunIdIdx: index("sre_alert_events_triage_investigation_run_id_idx").on(table.triageInvestigationRunId),
    sreAlertEventsSeverityCheck: check("sre_alert_events_severity_check", sql`${table.severity} IN ('sev1', 'sev2', 'sev3', 'sev4')`),
    sreAlertEventsStatusCheck: check("sre_alert_events_status_check", sql`${table.status} IN ('firing', 'resolved', 'silenced', 'deduplicated')`),
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
    triageInvestigationRunId: uuid("triage_investigation_run_id").references((): AnyPgColumn => sreInvestigationRuns.id, { onDelete: "set null" }),
    rootCauseSummary: text("root_cause_summary"),
    confidenceScore: numeric("confidence_score", { precision: 5, scale: 4 }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    assigneeUserId: uuid("assignee_user_id").references(() => user.id, { onDelete: "set null" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedByUserId: uuid("acknowledged_by_user_id").references(() => user.id, { onDelete: "set null" }),
    commanderUserId: uuid("commander_user_id").references(() => user.id, { onDelete: "set null" }),
    /** First move into verifying, or resolve time when the incident was never verified. */
    mitigatedAt: timestamp("mitigated_at", { withTimezone: true }),
    resolutionSummary: text("resolution_summary"),
    postmortem: jsonb("postmortem").$type<SrePostmortem>(),
    /** When the latest unacknowledged reminder was sent (claimed). Cleared on reopen. */
    renotifiedAt: timestamp("renotified_at", { withTimezone: true }),
    /** Reminders sent in this open period (the claim counts them). Reset on reopen. */
    renotifyCount: smallint("renotify_count").notNull().default(0),
    /** Set when a person lowers the severity: no more reminders this open period. */
    renotifyStoppedAt: timestamp("renotify_stopped_at", { withTimezone: true }),
    /** Set once when the escalation step fires (or its target was gone). Reset on reopen. */
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    /** Failed reminder sends in a row, and when the next attempt may be claimed (backoff). Reset on success and reopen. */
    renotifyFailures: smallint("renotify_failures").notNull().default(0),
    renotifyRetryAt: timestamp("renotify_retry_at", { withTimezone: true }),
    /** Same for the escalation step. */
    escalateFailures: smallint("escalate_failures").notNull().default(0),
    escalateRetryAt: timestamp("escalate_retry_at", { withTimezone: true }),
    /** Alerts folded into this incident: 1 at open, +1 for each repeat alert while it stays open. */
    alertCount: integer("alert_count").notNull().default(1),
    /** When the latest alert (the opening one or a repeat) fired. */
    lastAlertAt: timestamp("last_alert_at", { withTimezone: true }),
    /** Last automatic reopen; the un-acknowledged reminder counts from here instead of from creation. */
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIncidentNumberUniqueIdx: uniqueIndex("sre_incidents_org_incident_number_unique_idx").on(table.organizationId, table.incidentNumber),
    projectStatusIdx: index("sre_incidents_project_status_idx").on(table.projectId, table.status),
    projectSeverityIdx: index("sre_incidents_project_severity_idx").on(table.projectId, table.severity),
    primaryServiceStatusIdx: index("sre_incidents_primary_service_status_idx").on(table.primaryServiceId, table.status),
    activeStatusIdx: index("sre_incidents_active_status_idx").on(table.status).where(sql`status != 'resolved'`),
    projectAssigneeActiveIdx: index("sre_incidents_project_assignee_active_idx")
      .on(table.projectId, table.assigneeUserId)
      .where(sql`status <> 'resolved'`),
    resolutionSummaryLengthCheck: check("sre_incidents_resolution_summary_length_check", sql`${table.resolutionSummary} IS NULL OR char_length(${table.resolutionSummary}) <= 4000`),
    sreIncidentsAcknowledgedByUserIdIdx: index("sre_incidents_acknowledged_by_user_id_idx").on(table.acknowledgedByUserId),
    sreIncidentsAssigneeUserIdIdx: index("sre_incidents_assignee_user_id_idx").on(table.assigneeUserId),
    sreIncidentsCommanderUserIdIdx: index("sre_incidents_commander_user_id_idx").on(table.commanderUserId),
    sreIncidentsCreatedByUserIdIdx: index("sre_incidents_created_by_user_id_idx").on(table.createdByUserId),
    sreIncidentsStatusPageIncidentIdIdx: index("sre_incidents_status_page_incident_id_idx").on(table.statusPageIncidentId),
    sreIncidentsTriageInvestigationRunIdIdx: index("sre_incidents_triage_investigation_run_id_idx").on(table.triageInvestigationRunId),
    sreIncidentsSeverityCheck: check("sre_incidents_severity_check", sql`${table.severity} IN ('sev1', 'sev2', 'sev3', 'sev4')`),
    sreIncidentsStatusCheck: check("sre_incidents_status_check", sql`${table.status} IN ('triggered', 'investigating', 'identified', 'recommendations_ready', 'user_applying_fix', 'verifying', 'resolved')`),
  })
);

export const sreIncidentAlerts = pgTable(
  "sre_incident_alerts",
  {
    id: uuidPk(),
    incidentId: uuid("incident_id").notNull().references(() => sreIncidents.id, { onDelete: "cascade" }),
    alertEventId: uuid("alert_event_id").notNull().references(() => sreAlertEvents.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).$type<SreIncidentAlertRole>().notNull().default("trigger"),
    // The alert as it was when linked; the shared alert event row moves on with later failures.
    alertTitle: text("alert_title"),
    alertDescription: text("alert_description"),
    alertSeverity: varchar("alert_severity", { length: 10 }).$type<SreSeverity>(),
    alertFiredAt: timestamp("alert_fired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    alertEventIdIdx: index("sre_incident_alerts_alert_event_id_idx").on(table.alertEventId),
    incidentAlertUniqueIdx: uniqueIndex("sre_incident_alerts_incident_alert_unique_idx").on(table.incidentId, table.alertEventId),
    sreIncidentAlertsRoleCheck: check("sre_incident_alerts_role_check", sql`${table.role} IN ('trigger', 'related', 'red_herring')`),
  })
);

/** People who get an email when the incident changes; unwatching is the per-user opt-out. */
export const sreIncidentWatchers = pgTable(
  "sre_incident_watchers",
  {
    id: uuidPk(),
    incidentId: uuid("incident_id").notNull().references(() => sreIncidents.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    incidentUserUniqueIdx: uniqueIndex("sre_incident_watchers_incident_user_unique_idx").on(table.incidentId, table.userId),
    userIdIdx: index("sre_incident_watchers_user_id_idx").on(table.userId),
  })
);

/** The project's one Default incident policy. No row means defaults: no channels, every option off. */
export const notificationPolicies = pgTable(
  "notification_policies",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    channelIds: jsonb("channel_ids").$type<string[]>().notNull().default([]),
    emailServiceOwnersOnSev12: boolean("email_service_owners_on_sev12").notNull().default(false),
    /** Minutes an incident may stay unacknowledged before the first reminder. Null turns reminders off. */
    renotifyUnackedMinutes: integer("renotify_unacked_minutes"),
    /** Minutes between later reminders. Null = remind once. */
    renotifyRepeatMinutes: integer("renotify_repeat_minutes"),
    /** Total reminders per open period, counting the first. */
    renotifyMax: smallint("renotify_max").notNull().default(3),
    /** Minutes unacknowledged before the one escalation step. Null = no escalation. */
    escalateAfterMinutes: integer("escalate_after_minutes"),
    escalateChannelId: uuid("escalate_channel_id").references(() => notificationProviders.id, { onDelete: "set null" }),
    escalateUserId: uuid("escalate_user_id").references(() => user.id, { onDelete: "set null" }),
    /** Run AI investigation (SEV1-2) or triage (SEV3-4) when an incident opens. Spends AI credits. */
    autoInvestigateOnOpen: boolean("auto_investigate_on_open").notNull().default(false),
    /** When auto-investigate was last switched on; incidents opened before it are never auto-run. */
    autoInvestigateEnabledAt: timestamp("auto_investigate_enabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectUniqueIdx: uniqueIndex("notification_policies_project_unique_idx").on(table.projectId),
    organizationIdIdx: index("notification_policies_organization_id_idx").on(table.organizationId),
    // Channel and user deletes set these to null.
    escalateChannelIdIdx: index("notification_policies_escalate_channel_id_idx").on(table.escalateChannelId),
    escalateUserIdIdx: index("notification_policies_escalate_user_id_idx").on(table.escalateUserId),
    renotifyRangeCheck: check("notification_policies_renotify_range_check", sql`${table.renotifyUnackedMinutes} IS NULL OR (${table.renotifyUnackedMinutes} BETWEEN 5 AND 1440)`),
    renotifyRepeatRangeCheck: check("notification_policies_renotify_repeat_range_check", sql`${table.renotifyRepeatMinutes} IS NULL OR (${table.renotifyRepeatMinutes} BETWEEN 5 AND 1440)`),
    renotifyMaxRangeCheck: check("notification_policies_renotify_max_range_check", sql`${table.renotifyMax} BETWEEN 1 AND 10`),
    escalateRangeCheck: check("notification_policies_escalate_range_check", sql`${table.escalateAfterMinutes} IS NULL OR (${table.escalateAfterMinutes} BETWEEN 5 AND 1440)`),
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
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    lastError: text("last_error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    organizationStatusIdx: index("private_agents_org_status_idx").on(table.organizationId, table.status),
    projectStatusIdx: index("private_agents_project_status_idx").on(table.projectId, table.status),
    agentModeStatusIdx: index("private_agents_mode_status_idx").on(table.agentMode, table.status),
    connectedHeartbeatIdx: index("private_agents_connected_heartbeat_idx").on(table.lastHeartbeatAt).where(sql`status = 'connected'`),
    privateAgentsCreatedByUserIdIdx: index("private_agents_created_by_user_id_idx").on(table.createdByUserId),
    privateAgentsStatusCheck: check("private_agents_status_check", sql`${table.status} IN ('pending', 'connected', 'disconnected', 'unhealthy', 'disabled')`),
    privateAgentsAgentModeCheck: check("private_agents_agent_mode_check", sql`${table.agentMode} IN ('connector_proxy', 'execution_worker', 'hybrid')`),
  })
);

export const externalConnectors = pgTable(
  "external_connectors",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    // NO ACTION (not RESTRICT): still blocks deleting an agent that has rows, but is checked at statement end so an organization cascade can remove agent and rows in any order.
    privateAgentId: uuid("private_agent_id").references(() => privateAgents.id, { onDelete: "no action" }),
    name: varchar("name", { length: 100 }).notNull(),
    type: varchar("type", { length: 50 }).$type<ExternalConnectorType>().notNull(),
    riskLevel: varchar("risk_level", { length: 10 }).$type<ExternalConnectorRiskLevel>().notNull().default("low"),
    permissionLevel: varchar("permission_level", { length: 10 }).$type<ExternalConnectorPermissionLevel>().notNull().default("read"),
    sideEffectLevel: varchar("side_effect_level", { length: 10 }).$type<ExternalConnectorSideEffectLevel>().notNull().default("none"),
    status: varchar("status", { length: 20 }).$type<ExternalConnectorStatus>().notNull().default("configured"),
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    defaultTimeWindowMinutes: integer("default_time_window_minutes").notNull().default(60),
    outputLimits: jsonb("output_limits").$type<Record<string, unknown>>(),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    lastValidationStatus: varchar("last_validation_status", { length: 20 }).$type<ExternalConnectorValidationStatus>(),
    lastValidationError: text("last_validation_error"),
    lastValidationLatencyMs: integer("last_validation_latency_ms"),
    validatedByPrivateAgentId: uuid("validated_by_private_agent_id").references(() => privateAgents.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
    externalConnectorsCreatedByUserIdIdx: index("external_connectors_created_by_user_id_idx").on(table.createdByUserId),
    externalConnectorsValidatedByPrivateAgentIdIdx: index("external_connectors_validated_by_private_agent_id_idx").on(table.validatedByPrivateAgentId),
    externalConnectorsStatusCheck: check("external_connectors_status_check", sql`${table.status} IN ('configured', 'valid', 'unreachable', 'missing_credentials', 'disabled')`),
    externalConnectorsRiskLevelCheck: check("external_connectors_risk_level_check", sql`${table.riskLevel} IN ('low', 'medium', 'high', 'critical')`),
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
    issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => user.id, { onDelete: "set null" }),
    revocationReason: text("revocation_reason"),
  },
  (table) => ({
    privateAgentIdIdx: index("private_agent_credentials_private_agent_id_idx").on(table.privateAgentId),
    keyIdUniqueIdx: uniqueIndex("private_agent_credentials_key_id_unique_idx").on(table.keyId),
    expiresAtIdx: index("private_agent_credentials_expires_at_idx").on(table.expiresAt).where(sql`expires_at IS NOT NULL`),
    revokedAtIdx: index("private_agent_credentials_revoked_at_idx").on(table.revokedAt).where(sql`revoked_at IS NOT NULL`),
    privateAgentCredentialsOrganizationIdIdx: index("private_agent_credentials_organization_id_idx").on(table.organizationId),
    privateAgentCredentialsProjectIdIdx: index("private_agent_credentials_project_id_idx").on(table.projectId),
    privateAgentCredentialsRevokedByUserIdIdx: index("private_agent_credentials_revoked_by_user_id_idx").on(table.revokedByUserId),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    privateAgentCreatedIdx: index("private_agent_heartbeats_agent_created_idx").on(table.privateAgentId, table.createdAt),
    organizationCreatedIdx: index("private_agent_heartbeats_org_created_idx").on(table.organizationId, table.createdAt),
    createdAtIdx: index("private_agent_heartbeats_created_at_idx").on(table.createdAt),
    privateAgentHeartbeatsProjectIdIdx: index("private_agent_heartbeats_project_id_idx").on(table.projectId),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    connectorServiceUniqueIdx: uniqueIndex("external_connector_services_connector_service_unique_idx").on(table.connectorId, table.serviceId),
    projectServiceIdx: index("external_connector_services_project_service_idx").on(table.projectId, table.serviceId),
    organizationConnectorIdx: index("external_connector_services_org_connector_idx").on(table.organizationId, table.connectorId),
    externalConnectorServicesServiceIdIdx: index("external_connector_services_service_id_idx").on(table.serviceId),
  })
);

export const sreIntegrationBindings = pgTable(
  "sre_integration_bindings",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    integrationKey: varchar("integration_key", { length: 50 }).$type<SreIntegrationKey>().notNull(),
    notificationProviderId: uuid("notification_provider_id").notNull().references(() => notificationProviders.id, { onDelete: "cascade" }),
    externalConnectorId: uuid("external_connector_id").notNull().references(() => externalConnectors.id, { onDelete: "cascade" }),
    correlationStrategy: varchar("correlation_strategy", { length: 30 }).$type<SreIntegrationCorrelationStrategy>().notNull().default("dedup_key"),
    enabled: boolean("enabled").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectIntegrationIdx: index("sre_integration_bindings_project_integration_idx").on(table.projectId, table.integrationKey),
    notificationProviderIdx: index("sre_integration_bindings_notification_provider_idx").on(table.notificationProviderId),
    externalConnectorIdx: index("sre_integration_bindings_external_connector_idx").on(table.externalConnectorId),
    activeBindingUniqueIdx: uniqueIndex("sre_integration_bindings_active_unique_idx")
      .on(table.projectId, table.integrationKey, table.notificationProviderId, table.externalConnectorId)
      .where(sql`enabled = true`),
    sreIntegrationBindingsCreatedByUserIdIdx: index("sre_integration_bindings_created_by_user_id_idx").on(table.createdByUserId),
    sreIntegrationBindingsOrganizationIdIdx: index("sre_integration_bindings_organization_id_idx").on(table.organizationId),
  })
);

export const sreIntegrationBindingServices = pgTable(
  "sre_integration_binding_services",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    bindingId: uuid("binding_id").notNull().references(() => sreIntegrationBindings.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull().references(() => sreServices.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    bindingServiceUniqueIdx: uniqueIndex("sre_integration_binding_services_binding_service_unique_idx").on(table.bindingId, table.serviceId),
    serviceIdx: index("sre_integration_binding_services_service_idx").on(table.projectId, table.serviceId),
    organizationBindingIdx: index("sre_integration_binding_services_org_binding_idx").on(table.organizationId, table.bindingId),
    sreIntegrationBindingServicesServiceIdIdx: index("sre_integration_binding_services_service_id_idx").on(table.serviceId),
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
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectConnectorIdx: index("diagnostic_queries_project_connector_idx").on(table.projectId, table.connectorId),
    organizationStatusIdx: index("diagnostic_queries_org_status_idx").on(table.organizationId, table.status),
    queryTypeStatusIdx: index("diagnostic_queries_query_type_status_idx").on(table.queryType, table.status),
    diagnosticQueriesApprovedByUserIdIdx: index("diagnostic_queries_approved_by_user_id_idx").on(table.approvedByUserId),
    diagnosticQueriesConnectorIdIdx: index("diagnostic_queries_connector_id_idx").on(table.connectorId),
    diagnosticQueriesCreatedByUserIdIdx: index("diagnostic_queries_created_by_user_id_idx").on(table.createdByUserId),
  })
);

export const privateAgentJobs = pgTable(
  "private_agent_jobs",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    // NO ACTION (not RESTRICT): still blocks deleting an agent that has rows, but is checked at statement end so an organization cascade can remove agent and rows in any order.
    privateAgentId: uuid("private_agent_id").notNull().references(() => privateAgents.id, { onDelete: "no action" }),
    connectorId: uuid("connector_id").references(() => externalConnectors.id, { onDelete: "set null" }),
    jobClass: varchar("job_class", { length: 30 }).$type<PrivateAgentJobClass>().notNull(),
    status: varchar("status", { length: 20 }).$type<PrivateAgentJobStatus>().notNull().default("queued"),
    authorizedBy: varchar("authorized_by", { length: 30 }).$type<SreActorType>().notNull(),
    authorizedByUserId: uuid("authorized_by_user_id").references(() => user.id, { onDelete: "set null" }),
    policyDecisionHash: varchar("policy_decision_hash", { length: 128 }).notNull(),
    jobSpecHash: varchar("job_spec_hash", { length: 128 }).notNull(),
    jobSpec: jsonb("job_spec").$type<Record<string, unknown>>().notNull().default({}),
    leaseTokenHash: varchar("lease_token_hash", { length: 128 }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    // Callers waiting on this (possibly shared) job; an abandoned job is cancelled only by the last one.
    waiters: integer("waiters").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    errorCode: varchar("error_code", { length: 100 }),
    resultHash: varchar("result_hash", { length: 128 }),
    resultSummary: jsonb("result_summary").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    privateAgentStatusIdx: index("private_agent_jobs_agent_status_idx").on(table.privateAgentId, table.status),
    projectClassStatusIdx: index("private_agent_jobs_project_class_status_idx").on(table.projectId, table.jobClass, table.status),
    idempotencyKeyUniqueIdx: uniqueIndex("private_agent_jobs_idempotency_key_unique_idx").on(table.idempotencyKey),
    leaseExpiresAtIdx: index("private_agent_jobs_lease_expires_at_idx").on(table.leaseExpiresAt).where(sql`status IN ('leased', 'running')`),
    privateAgentJobsAuthorizedByUserIdIdx: index("private_agent_jobs_authorized_by_user_id_idx").on(table.authorizedByUserId),
    privateAgentJobsConnectorIdIdx: index("private_agent_jobs_connector_id_idx").on(table.connectorId),
    privateAgentJobsCreatedAtIdx: index("private_agent_jobs_created_at_idx").on(table.createdAt, table.id),
    privateAgentJobsOrganizationIdIdx: index("private_agent_jobs_organization_id_idx").on(table.organizationId),
    privateAgentJobsStatusCheck: check("private_agent_jobs_status_check", sql`${table.status} IN ('queued', 'leased', 'running', 'completed', 'failed', 'cancelled', 'timed_out')`),
    privateAgentJobsJobClassCheck: check("private_agent_jobs_job_class_check", sql`${table.jobClass} IN ('sre_connector_query', 'http_monitor_check', 'playwright_run', 'k6_run', 'network_check')`),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    privateAgentJobIdIdx: index("private_agent_artifacts_job_id_idx").on(table.privateAgentJobId),
    projectArtifactTypeIdx: index("private_agent_artifacts_project_type_idx").on(table.projectId, table.artifactType),
    createdAtIdx: index("private_agent_artifacts_created_at_idx").on(table.createdAt),
    privateAgentArtifactsOrganizationIdIdx: index("private_agent_artifacts_organization_id_idx").on(table.organizationId),
  })
);

export const sreEvidenceItems = pgTable(
  "sre_evidence_items",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").references(() => sreIncidents.id, { onDelete: "set null" }),
    investigationRunId: uuid("investigation_run_id").references((): AnyPgColumn => sreInvestigationRuns.id, { onDelete: "set null" }),
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
    observedAt: timestamp("observed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    incidentIdIdx: index("sre_evidence_items_incident_id_idx").on(table.incidentId),
    investigationRunIdIdx: index("sre_evidence_items_investigation_run_id_idx").on(table.investigationRunId),
    sourceConnectorIdx: index("sre_evidence_items_source_connector_idx").on(table.sourceType, table.sourceConnectorId),
    evidenceTypeIdx: index("sre_evidence_items_evidence_type_idx").on(table.evidenceType),
    observedAtIdx: index("sre_evidence_items_observed_at_idx").on(table.observedAt),
    sreEvidenceItemsProjectCreatedIdx: index("sre_evidence_items_project_created_idx").on(table.projectId, table.createdAt.desc().nullsFirst()),
    sreEvidenceItemsOrganizationIdIdx: index("sre_evidence_items_organization_id_idx").on(table.organizationId),
    sreEvidenceItemsSourceConnectorIdIdx: index("sre_evidence_items_source_connector_id_idx").on(table.sourceConnectorId),
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
    /** Bounded step/tool trace of the run; populated by the investigation runner. */
    steps: jsonb("steps").$type<Array<Record<string, unknown>>>(),
    /** Hypotheses with states (validated, ruled_out, inconclusive); populated by the investigation runner. */
    hypotheses: jsonb("hypotheses").$type<Array<Record<string, unknown>>>(),
    promptInput: jsonb("prompt_input").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    /** The tier the run was admitted under; a trial run is never billed, even after the organization subscribes. */
    billingTier: varchar("billing_tier", { length: 8 }).$type<"paid" | "trial">().notNull().default("paid"),
    /** "auto" for a run started by the auto-investigate-on-open policy; everything else is "manual". */
    origin: varchar("origin", { length: 8 }).$type<"auto" | "manual">().notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    incidentIdIdx: index("sre_investigation_runs_incident_id_idx").on(table.incidentId),
    projectStatusIdx: index("sre_investigation_runs_project_status_idx").on(table.projectId, table.status),
    agentTypeStatusIdx: index("sre_investigation_runs_agent_type_status_idx").on(table.agentType, table.status),
    activeIncidentRunUnique: uniqueIndex("sre_investigation_runs_active_incident_unique")
      .on(table.organizationId, table.projectId, table.incidentId, table.agentType)
      .where(sql`${table.status} = 'running' AND ${table.incidentId} IS NOT NULL`),
    // At most one live-or-finished automatic run per incident and agent type, so two racing triggers cannot both bill.
    autoIncidentRunUnique: uniqueIndex("sre_investigation_runs_auto_incident_unique")
      .on(table.organizationId, table.projectId, table.incidentId, table.agentType)
      .where(sql`${table.origin} = 'auto' AND ${table.status} IN ('running', 'completed') AND ${table.incidentId} IS NOT NULL`),
    originCheck: check("sre_investigation_runs_origin_check", sql`${table.origin} IN ('auto', 'manual')`),
    modelIdIdx: index("sre_investigation_runs_model_id_idx").on(table.modelId),
    lowConfidenceIdx: index("sre_investigation_runs_low_confidence_idx").on(table.confidenceScore).where(sql`confidence_score < 0.5`),
    createdAtIdx: index("sre_investigation_runs_created_at_idx").on(table.createdAt),
    billingTierCheck: check("sre_investigation_runs_billing_tier_check", sql`${table.billingTier} IN ('paid', 'trial')`),
    sreInvestigationRunsAlertEventIdIdx: index("sre_investigation_runs_alert_event_id_idx").on(table.alertEventId),
    sreInvestigationRunsCreatedByUserIdIdx: index("sre_investigation_runs_created_by_user_id_idx").on(table.createdByUserId),
    sreInvestigationRunsOrganizationIdIdx: index("sre_investigation_runs_organization_id_idx").on(table.organizationId),
    sreInvestigationRunsStatusCheck: check("sre_investigation_runs_status_check", sql`${table.status} IN ('running', 'completed', 'failed', 'aborted', 'timed_out')`),
  })
);

export const sreInvestigationFeedback = pgTable(
  "sre_investigation_feedback",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").notNull().references(() => sreIncidents.id, { onDelete: "cascade" }),
    investigationRunId: uuid("investigation_run_id").notNull().references(() => sreInvestigationRuns.id, { onDelete: "cascade" }),
    hypothesisKey: varchar("hypothesis_key", { length: 100 }),
    userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    verdict: varchar("verdict", { length: 10 }).$type<SreInvestigationFeedbackVerdict>().notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    incidentCreatedIdx: index("sre_investigation_feedback_incident_created_idx").on(table.incidentId, table.createdAt),
    runIdx: index("sre_investigation_feedback_run_idx").on(table.investigationRunId),
    projectCreatedIdx: index("sre_investigation_feedback_project_created_idx").on(table.projectId, table.createdAt),
    verdictCheck: check("sre_investigation_feedback_verdict_check", sql`${table.verdict} IN ('right', 'wrong')`),
    noteLengthCheck: check("sre_investigation_feedback_note_length_check", sql`${table.note} IS NULL OR char_length(${table.note}) <= 500`),
    sreInvestigationFeedbackOrganizationIdIdx: index("sre_investigation_feedback_organization_id_idx").on(table.organizationId),
    sreInvestigationFeedbackUserIdIdx: index("sre_investigation_feedback_user_id_idx").on(table.userId),
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
    executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    investigationRunIdIdx: index("sre_investigation_tool_calls_run_id_idx")
      .on(table.investigationRunId)
      .where(sql`investigation_run_id IS NOT NULL`),
    connectorTypeIdx: index("sre_investigation_tool_calls_connector_type_idx").on(table.connectorType),
    executedAtIdx: index("sre_investigation_tool_calls_executed_at_idx").on(table.executedAt),
    sreInvestigationToolCallsConnectorIdIdx: index("sre_investigation_tool_calls_connector_id_idx").on(table.connectorId),
    sreInvestigationToolCallsEvidenceItemIdIdx: index("sre_investigation_tool_calls_evidence_item_id_idx").on(table.evidenceItemId),
    sreInvestigationToolCallsStatusCheck: check("sre_investigation_tool_calls_status_check", sql`${table.status} IN ('success', 'error', 'timeout', 'aborted')`),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    suggestionTypeIdx: index("sre_ai_suggestions_type_idx").on(table.suggestionType),
    incidentSuggestionTypeIdx: index("sre_ai_suggestions_incident_type_idx").on(table.incidentId, table.suggestionType),
    sreAiSuggestionsInvestigationRunIdIdx: index("sre_ai_suggestions_investigation_run_id_idx").on(table.investigationRunId),
    sreAiSuggestionsOrganizationIdIdx: index("sre_ai_suggestions_organization_id_idx").on(table.organizationId),
    sreAiSuggestionsProjectIdIdx: index("sre_ai_suggestions_project_id_idx").on(table.projectId),
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
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    supersededById: uuid("superseded_by_id").references((): AnyPgColumn => sreInvestigationRecommendations.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    incidentIdIdx: index("sre_investigation_recommendations_incident_id_idx").on(table.incidentId),
    pendingIncidentIdx: index("sre_investigation_recommendations_pending_incident_idx")
      .on(table.incidentId, table.applicationStatus)
      .where(sql`application_status = 'pending'`),
    sreInvestigationRecommendationsInvestigationRunIdIdx: index("sre_investigation_recommendations_investigation_run_id_idx").on(table.investigationRunId),
    sreInvestigationRecommendationsSupersededByIdIdx: index("sre_investigation_recommendations_superseded_by_id_idx").on(table.supersededById),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    incidentCreatedIdx: index("sre_incident_timeline_events_incident_created_idx").on(table.incidentId, table.createdAt),
    actorAgentIdx: index("sre_incident_timeline_events_actor_agent_idx").on(table.actorType, table.agentRunId),
    eventTypeIdx: index("sre_incident_timeline_events_event_type_idx").on(table.eventType),
    sreIncidentTimelineEventsAgentRunIdIdx: index("sre_incident_timeline_events_agent_run_id_idx").on(table.agentRunId),
    sreIncidentTimelineEventsEvidenceItemIdIdx: index("sre_incident_timeline_events_evidence_item_id_idx").on(table.evidenceItemId),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectServiceIdx: index("sre_runbooks_project_service_idx").on(table.projectId, table.serviceId),
    organizationNameIdx: index("sre_runbooks_org_name_idx").on(table.organizationId, table.name),
    sreRunbooksCreatedByUserIdIdx: index("sre_runbooks_created_by_user_id_idx").on(table.createdByUserId),
    sreRunbooksServiceIdIdx: index("sre_runbooks_service_id_idx").on(table.serviceId),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    incidentIdIdx: index("sre_incident_runbook_steps_incident_id_idx").on(table.incidentId),
    activeIncidentStatusIdx: index("sre_incident_runbook_steps_active_status_idx")
      .on(table.incidentId, table.status)
      .where(sql`status IN ('pending', 'in_progress')`),
    sreIncidentRunbookStepsCompletedByIdx: index("sre_incident_runbook_steps_completed_by_idx").on(table.completedBy),
    sreIncidentRunbookStepsRunbookIdIdx: index("sre_incident_runbook_steps_runbook_id_idx").on(table.runbookId),
    sreIncidentRunbookStepsRunbookStepIdIdx: index("sre_incident_runbook_steps_runbook_step_id_idx").on(table.runbookStepId),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    serviceIdIdx: index("sre_context_observations_service_id_idx").on(table.serviceId),
    projectObservationTypeIdx: index("sre_context_observations_project_type_idx").on(table.projectId, table.observationType),
    sreContextObservationsOrganizationIdIdx: index("sre_context_observations_organization_id_idx").on(table.organizationId),
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
    promotedToPlaybookId: uuid("promoted_to_playbook_id").references((): AnyPgColumn => sreContextPlaybooks.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    incidentIdIdx: index("sre_context_recollections_incident_id_idx").on(table.incidentId),
    serviceIdIdx: index("sre_context_recollections_service_id_idx").on(table.serviceId),
    errorFingerprintIdx: index("sre_context_recollections_error_fingerprint_idx").on(table.errorFingerprint),
    sreContextRecollectionsOrganizationIdIdx: index("sre_context_recollections_organization_id_idx").on(table.organizationId),
    sreContextRecollectionsProjectIdIdx: index("sre_context_recollections_project_id_idx").on(table.projectId),
    sreContextRecollectionsPromotedToPlaybookIdIdx: index("sre_context_recollections_promoted_to_playbook_id_idx").on(table.promotedToPlaybookId),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    organizationAlertSignatureIdx: index("sre_context_playbooks_org_alert_signature_idx").on(table.organizationId, table.alertSignatureHash),
    projectStatusIdx: index("sre_context_playbooks_project_status_idx").on(table.projectId, table.status),
    alertSignatureGinIdx: index("sre_context_playbooks_alert_signature_gin_idx").using("gin", table.alertSignature),
    sreContextPlaybooksCreatedByUserIdIdx: index("sre_context_playbooks_created_by_user_id_idx").on(table.createdByUserId),
    sreContextPlaybooksPromotedFromRecollectionIdIdx: index("sre_context_playbooks_promoted_from_recollection_id_idx").on(table.promotedFromRecollectionId),
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
    triggerAt: timestamp("trigger_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    resultSummary: text("result_summary"),
    resultData: jsonb("result_data").$type<Record<string, unknown>>(),
    investigationRunId: uuid("investigation_run_id").references(() => sreInvestigationRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    activeProjectStatusIdx: index("sre_background_agent_runs_active_project_status_idx")
      .on(table.projectId, table.status)
      .where(sql`status IN ('scheduled', 'running')`),
    scheduleCreatedIdx: index("sre_background_agent_runs_schedule_created_idx").on(table.scheduleId, table.createdAt),
    sreBackgroundAgentRunsInvestigationRunIdIdx: index("sre_background_agent_runs_investigation_run_id_idx").on(table.investigationRunId),
    sreBackgroundAgentRunsOrganizationIdIdx: index("sre_background_agent_runs_organization_id_idx").on(table.organizationId),
    sreBackgroundAgentRunsProjectIdIdx: index("sre_background_agent_runs_project_id_idx").on(table.projectId),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userUpdatedAtIdx: index("sre_chat_conversations_user_updated_at_idx").on(table.userId, table.updatedAt),
    incidentIdIdx: index("sre_chat_conversations_incident_id_idx").on(table.incidentId),
    projectStatusIdx: index("sre_chat_conversations_project_status_idx").on(table.projectId, table.status),
    sreChatConversationsOrganizationIdIdx: index("sre_chat_conversations_organization_id_idx").on(table.organizationId),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    conversationCreatedIdx: index("sre_chat_messages_conversation_created_idx").on(table.conversationId, table.createdAt),
    roleIdx: index("sre_chat_messages_role_idx").on(table.role),
    sreChatMessagesInvestigationRunIdIdx: index("sre_chat_messages_investigation_run_id_idx").on(table.investigationRunId),
    sreChatMessagesToolCallIdIdx: index("sre_chat_messages_tool_call_id_idx").on(table.toolCallId),
  })
);

export const sreInvestigationReports = pgTable(
  "sre_investigation_reports",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").references(() => sreIncidents.id, { onDelete: "set null" }),
    investigationRunId: uuid("investigation_run_id").notNull().references(() => sreInvestigationRuns.id, { onDelete: "cascade" }),
    reportVersion: varchar("report_version", { length: 40 }).notNull().default("sre-investigation-report.v1"),
    title: varchar("title", { length: 300 }),
    summary: text("summary"),
    reportData: jsonb("report_data").$type<Record<string, unknown>>().notNull(),
    reportHash: varchar("report_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 }).$type<SreInvestigationReportStatus>().notNull().default("active"),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runCreatedAtIdx: index("sre_investigation_reports_run_created_at_idx").on(table.investigationRunId, table.createdAt),
    projectCreatedAtIdx: index("sre_investigation_reports_project_created_at_idx").on(table.projectId, table.createdAt),
    incidentCreatedAtIdx: index("sre_investigation_reports_incident_created_at_idx").on(table.incidentId, table.createdAt),
    activeRunIdx: index("sre_investigation_reports_active_run_idx").on(table.investigationRunId, table.status),
    runHashUniqueIdx: uniqueIndex("sre_investigation_reports_run_hash_unique_idx").on(table.investigationRunId, table.reportHash),
    sreInvestigationReportsCreatedByUserIdIdx: index("sre_investigation_reports_created_by_user_id_idx").on(table.createdByUserId),
    sreInvestigationReportsOrganizationIdIdx: index("sre_investigation_reports_organization_id_idx").on(table.organizationId),
  })
);

export const sreInvestigationReportFeedback = pgTable(
  "sre_investigation_report_feedback",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").notNull().references(() => sreInvestigationReports.id, { onDelete: "cascade" }),
    investigationRunId: uuid("investigation_run_id").notNull().references(() => sreInvestigationRuns.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").references(() => sreIncidents.id, { onDelete: "set null" }),
    accuracy: varchar("accuracy", { length: 30 }).$type<SreInvestigationReportFeedbackAccuracy>().notNull(),
    rejectedHypotheses: jsonb("rejected_hypotheses").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    reportUserUniqueIdx: uniqueIndex("sre_investigation_report_feedback_report_user_unique_idx").on(table.reportId, table.createdByUserId),
    projectUpdatedAtIdx: index("sre_investigation_report_feedback_project_updated_idx").on(table.projectId, table.updatedAt),
    runUpdatedAtIdx: index("sre_investigation_report_feedback_run_updated_idx").on(table.investigationRunId, table.updatedAt),
    accuracyIdx: index("sre_investigation_report_feedback_accuracy_idx").on(table.accuracy),
    sreInvestigationReportFeedbackCreatedByUserIdIdx: index("sre_investigation_report_feedback_created_by_user_id_idx").on(table.createdByUserId),
    sreInvestigationReportFeedbackIncidentIdIdx: index("sre_investigation_report_feedback_incident_id_idx").on(table.incidentId),
    sreInvestigationReportFeedbackOrganizationIdIdx: index("sre_investigation_report_feedback_organization_id_idx").on(table.organizationId),
  })
);

export const sreEvidenceGraphFocusedViews = pgTable(
  "sre_evidence_graph_focused_views",
  {
    id: uuidPk(),
    organizationId: uuid("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    query: varchar("query", { length: 200 }).notNull().default(""),
    nodeType: varchar("node_type", { length: 30 }).notNull().default("all"),
    incidentNodeId: varchar("incident_node_id", { length: 80 }).notNull().default("all"),
    visibility: varchar("visibility", { length: 20 }).$type<SreEvidenceGraphFocusedViewVisibility>().notNull().default("project"),
    status: varchar("status", { length: 20 }).$type<SreEvidenceGraphFocusedViewStatus>().notNull().default("active"),
    viewData: jsonb("view_data").$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectStatusUpdatedIdx: index("sre_evidence_graph_focused_views_project_status_updated_idx").on(table.projectId, table.status, table.updatedAt),
    createdByIdx: index("sre_evidence_graph_focused_views_created_by_idx").on(table.createdByUserId, table.updatedAt),
    sreEvidenceGraphFocusedViewsOrganizationIdIdx: index("sre_evidence_graph_focused_views_organization_id_idx").on(table.organizationId),
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
  sreIncidentWatchers,
  notificationPolicies,
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
  sreInvestigationReports,
  sreInvestigationReportFeedback,
  sreInvestigationFeedback,
  sreEvidenceGraphFocusedViews,
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
export type SreInvestigationReport = typeof sreInvestigationReports.$inferSelect;
export type SreInvestigationReportInsert = typeof sreInvestigationReports.$inferInsert;
export type SreInvestigationReportFeedback = typeof sreInvestigationReportFeedback.$inferSelect;
export type SreInvestigationReportFeedbackInsert = typeof sreInvestigationReportFeedback.$inferInsert;
export type SreInvestigationFeedback = typeof sreInvestigationFeedback.$inferSelect;
export type SreInvestigationFeedbackInsert = typeof sreInvestigationFeedback.$inferInsert;
export type SreEvidenceGraphFocusedView = typeof sreEvidenceGraphFocusedViews.$inferSelect;
export type SreEvidenceGraphFocusedViewInsert = typeof sreEvidenceGraphFocusedViews.$inferInsert;
