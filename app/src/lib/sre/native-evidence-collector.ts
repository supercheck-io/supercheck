import { createHash } from "crypto";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";

import {
  jobs,
  k6PerformanceRuns,
  monitorResults,
  monitors,
  runs,
  sreAlertEvents,
  sreIncidentAlerts,
  sreIncidents,
} from "@/db/schema";
import { db } from "@/utils/db";

const DEFAULT_LOOKBACK_MINUTES = 120;
const DEFAULT_FORWARD_BUFFER_MINUTES = 10;
const MAX_EXCERPT_LENGTH = 1800;

type EvidenceType = "metric" | "log" | "artifact" | "event";

export type NativeEvidenceCandidate = {
  sourceUri: string;
  title: string;
  summary: string;
  rawContentExcerpt: string;
  evidenceType: EvidenceType;
  severity: string | null;
  confidence: number;
  observedAt: Date;
  citationQuery: string;
  citationResultHash: string;
  tags: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type NativeEvidenceWindow = {
  since: Date;
  until: Date;
  source: "alert.firedAt" | "incident.createdAt" | "default";
  confidence: number;
};

export type NativeEvidenceCollection = {
  incident: {
    id: string;
    title: string;
    severity: string;
    status: string;
    primaryServiceId: string | null;
    createdAt: Date;
  };
  window: NativeEvidenceWindow;
  evidence: NativeEvidenceCandidate[];
};

function hash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function redact(value: string) {
  return value
    .replace(/(authorization|api[_-]?key|token|password|secret)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/Basic\s+[A-Za-z0-9+/]+=*/gi, "Basic [REDACTED]");
}

function excerpt(value: unknown) {
  const text = redact(typeof value === "string" ? value : safeJson(value));
  return text.length > MAX_EXCERPT_LENGTH ? `${text.slice(0, MAX_EXCERPT_LENGTH - 3)}...` : text;
}

function addEvidence(
  target: NativeEvidenceCandidate[],
  input: Omit<NativeEvidenceCandidate, "citationResultHash">
) {
  const citationResultHash = hash(
    JSON.stringify({
      sourceUri: input.sourceUri,
      title: input.title,
      summary: input.summary,
      rawContentExcerpt: input.rawContentExcerpt,
      observedAt: input.observedAt.toISOString(),
    })
  );

  if (target.some((item) => item.citationResultHash === citationResultHash)) {
    return;
  }

  target.push({ ...input, citationResultHash });
}

function hasNonEmptyText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveWindow(anchor: Date | null, fallback: Date): NativeEvidenceWindow {
  const untilAnchor = anchor ?? fallback ?? new Date();
  const until = new Date(untilAnchor.getTime() + DEFAULT_FORWARD_BUFFER_MINUTES * 60_000);
  const since = new Date(untilAnchor.getTime() - DEFAULT_LOOKBACK_MINUTES * 60_000);

  return {
    since,
    until,
    source: anchor ? "alert.firedAt" : fallback ? "incident.createdAt" : "default",
    confidence: anchor ? 1 : 0.5,
  };
}

export async function collectNativeEvidence(input: {
  organizationId: string;
  projectId: string;
  incidentId: string;
}): Promise<NativeEvidenceCollection | null> {
  const [incident] = await db
    .select({
      id: sreIncidents.id,
      title: sreIncidents.title,
      severity: sreIncidents.severity,
      status: sreIncidents.status,
      primaryServiceId: sreIncidents.primaryServiceId,
      createdAt: sreIncidents.createdAt,
    })
    .from(sreIncidents)
    .where(
      and(
        eq(sreIncidents.id, input.incidentId),
        eq(sreIncidents.organizationId, input.organizationId),
        eq(sreIncidents.projectId, input.projectId)
      )
    )
    .limit(1);

  if (!incident) {
    return null;
  }

  const linkedAlerts = await db
    .select({
      id: sreAlertEvents.id,
      fingerprintHash: sreAlertEvents.fingerprintHash,
      dedupKey: sreAlertEvents.dedupKey,
      severity: sreAlertEvents.severity,
      status: sreAlertEvents.status,
      sourceType: sreAlertEvents.sourceType,
      sourceId: sreAlertEvents.sourceId,
      title: sreAlertEvents.title,
      description: sreAlertEvents.description,
      firedAt: sreAlertEvents.firedAt,
      resolvedAt: sreAlertEvents.resolvedAt,
    })
    .from(sreIncidentAlerts)
    .innerJoin(sreAlertEvents, eq(sreIncidentAlerts.alertEventId, sreAlertEvents.id))
    .where(eq(sreIncidentAlerts.incidentId, input.incidentId))
    .orderBy(desc(sreAlertEvents.firedAt));

  const primaryAlert = linkedAlerts[0];
  const window = resolveWindow(primaryAlert?.firedAt ?? null, incident.createdAt);
  const evidence: NativeEvidenceCandidate[] = [];
  const monitorIds = Array.from(
    new Set(linkedAlerts.flatMap((alert) => alert.sourceType === "monitor" && alert.sourceId ? [alert.sourceId] : []))
  );
  const jobIds = Array.from(
    new Set(linkedAlerts.flatMap((alert) => alert.sourceType === "job" && alert.sourceId ? [alert.sourceId] : []))
  );

  const [
    monitorRows,
    monitorResultRows,
    jobRows,
    runRows,
    k6RunRows,
  ] = await Promise.all([
    monitorIds.length > 0
      ? db
          .select()
          .from(monitors)
          .where(
            and(
              eq(monitors.organizationId, input.organizationId),
              eq(monitors.projectId, input.projectId),
              inArray(monitors.id, monitorIds)
            )
          )
      : Promise.resolve([]),
    monitorIds.length > 0
      ? db
          .select()
          .from(monitorResults)
          .where(
            and(
              inArray(monitorResults.monitorId, monitorIds),
              gte(monitorResults.checkedAt, window.since),
              lte(monitorResults.checkedAt, window.until)
            )
          )
          .orderBy(desc(monitorResults.checkedAt))
      : Promise.resolve([]),
    jobIds.length > 0
      ? db
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.organizationId, input.organizationId),
              eq(jobs.projectId, input.projectId),
              inArray(jobs.id, jobIds)
            )
          )
      : Promise.resolve([]),
    jobIds.length > 0
      ? db
          .select()
          .from(runs)
          .where(and(eq(runs.projectId, input.projectId), inArray(runs.jobId, jobIds)))
          .orderBy(desc(runs.createdAt))
      : Promise.resolve([]),
    jobIds.length > 0
      ? db
          .select()
          .from(k6PerformanceRuns)
          .where(and(eq(k6PerformanceRuns.projectId, input.projectId), inArray(k6PerformanceRuns.jobId, jobIds)))
          .orderBy(desc(k6PerformanceRuns.startedAt))
      : Promise.resolve([]),
  ]);

  const monitorsById = new Map(monitorRows.map((monitor) => [monitor.id, monitor]));
  const jobsById = new Map(jobRows.map((job) => [job.id, job]));
  const monitorResultsByMonitorId = new Map<string, typeof monitorResults.$inferSelect[]>();
  for (const result of monitorResultRows) {
    const results = monitorResultsByMonitorId.get(result.monitorId) ?? [];
    if (results.length < 10) {
      results.push(result);
      monitorResultsByMonitorId.set(result.monitorId, results);
    }
  }
  const runsByJobId = new Map<string, typeof runs.$inferSelect[]>();
  for (const run of runRows) {
    if (!run.jobId) continue;
    const jobRuns = runsByJobId.get(run.jobId) ?? [];
    if (jobRuns.length < 8) {
      jobRuns.push(run);
      runsByJobId.set(run.jobId, jobRuns);
    }
  }
  const k6RunsByJobId = new Map<string, typeof k6PerformanceRuns.$inferSelect[]>();
  for (const k6Run of k6RunRows) {
    if (!k6Run.jobId) continue;
    const jobK6Runs = k6RunsByJobId.get(k6Run.jobId) ?? [];
    if (jobK6Runs.length < 5) {
      jobK6Runs.push(k6Run);
      k6RunsByJobId.set(k6Run.jobId, jobK6Runs);
    }
  }

  for (const alert of linkedAlerts) {
    addEvidence(evidence, {
      sourceUri: `/alerts?tab=sre-alerts&fingerprint=${encodeURIComponent(alert.fingerprintHash)}`,
      title: `Alert event: ${alert.title}`,
      summary: alert.description ?? `SRE alert ${alert.status} with severity ${alert.severity}`,
      rawContentExcerpt: excerpt(alert),
      evidenceType: "event",
      severity: alert.severity,
      confidence: 0.9,
      observedAt: alert.firedAt,
      citationQuery: `sre_alert_events.id = ${alert.id}`,
      tags: { source: "supercheck_native", alertStatus: alert.status },
      metadata: {
        alertEventId: alert.id,
        dedupKey: alert.dedupKey,
        sourceType: alert.sourceType,
        sourceId: alert.sourceId,
        resolvedAt: alert.resolvedAt?.toISOString() ?? null,
      },
    });

    if (alert.sourceType === "monitor" && alert.sourceId) {
      const monitor = monitorsById.get(alert.sourceId);

      if (monitor) {
        addEvidence(evidence, {
          sourceUri: `/monitors/${monitor.id}`,
          title: `Monitor configuration: ${monitor.name}`,
          summary: `${monitor.type} monitor targeting ${monitor.target} is currently ${monitor.status}.`,
          rawContentExcerpt: excerpt({
            name: monitor.name,
            type: monitor.type,
            target: monitor.target,
            status: monitor.status,
            alertConfig: monitor.alertConfig,
            config: monitor.config,
          }),
          evidenceType: "event",
          severity: monitor.status === "down" || monitor.status === "error" ? "sev2" : alert.severity,
          confidence: 0.85,
          observedAt: monitor.lastCheckAt ?? alert.firedAt,
          citationQuery: `monitors.id = ${monitor.id}`,
          tags: { source: "supercheck_native", resourceType: "monitor" },
          metadata: { monitorId: monitor.id, monitorType: monitor.type, monitorStatus: monitor.status },
        });
      }

      const results = monitorResultsByMonitorId.get(alert.sourceId) ?? [];

      for (const result of results) {
        addEvidence(evidence, {
          sourceUri: `/monitors/${alert.sourceId}?result=${result.id}`,
          title: `Monitor result: ${result.status} at ${result.location}`,
          summary: `Monitor check was ${result.status}; response time ${result.responseTimeMs ?? "unknown"}ms; consecutive failures ${result.consecutiveFailureCount}.`,
          rawContentExcerpt: excerpt({
            status: result.status,
            isUp: result.isUp,
            responseTimeMs: result.responseTimeMs,
            details: result.details,
            consecutiveFailureCount: result.consecutiveFailureCount,
            consecutiveSuccessCount: result.consecutiveSuccessCount,
            testExecutionId: result.testExecutionId,
            testReportS3Url: result.testReportS3Url,
          }),
          evidenceType: result.testReportS3Url ? "artifact" : "metric",
          severity: result.isUp ? "sev4" : alert.severity,
          confidence: result.isStatusChange ? 0.9 : 0.75,
          observedAt: result.checkedAt,
          citationQuery: `monitor_results.id = ${result.id}`,
          tags: { source: "supercheck_native", resourceType: "monitor_result", location: result.location },
          metadata: {
            monitorResultId: result.id,
            monitorId: alert.sourceId,
            testExecutionId: result.testExecutionId,
            testReportS3Url: result.testReportS3Url,
          },
        });
      }
    }

    if (alert.sourceType === "job" && alert.sourceId) {
      const job = jobsById.get(alert.sourceId);

      if (job) {
        addEvidence(evidence, {
          sourceUri: `/jobs/${job.id}`,
          title: `Job configuration: ${job.name}`,
          summary: `${job.jobType} job is currently ${job.status}.`,
          rawContentExcerpt: excerpt({ name: job.name, jobType: job.jobType, status: job.status, alertConfig: job.alertConfig }),
          evidenceType: "event",
          severity: job.status === "failed" || job.status === "error" ? "sev2" : alert.severity,
          confidence: 0.8,
          observedAt: job.lastRunAt ?? alert.firedAt,
          citationQuery: `jobs.id = ${job.id}`,
          tags: { source: "supercheck_native", resourceType: "job" },
          metadata: { jobId: job.id, jobType: job.jobType, jobStatus: job.status },
        });
      }

      const recentRuns = runsByJobId.get(alert.sourceId) ?? [];

      for (const run of recentRuns) {
        addEvidence(evidence, {
          sourceUri: `/runs/${run.id}`,
          title: `Job run: ${run.status}`,
          summary: `Run ${run.status}; duration ${run.durationMs ?? "unknown"}ms; trigger ${run.trigger}.`,
          rawContentExcerpt: excerpt({
            status: run.status,
            durationMs: run.durationMs,
            errorDetails: run.errorDetails,
            logs: run.logs,
            reportS3Url: run.reportS3Url,
            logsS3Url: run.logsS3Url,
            videoS3Url: run.videoS3Url,
            screenshotsS3Path: run.screenshotsS3Path,
            artifactPaths: run.artifactPaths,
          }),
          evidenceType: hasNonEmptyText(run.logs) || hasNonEmptyText(run.errorDetails) ? "log" : "artifact",
          severity: run.status === "failed" || run.status === "error" ? alert.severity : "sev4",
          confidence: run.status === "failed" || run.status === "error" ? 0.85 : 0.65,
          observedAt: run.completedAt ?? run.startedAt ?? run.createdAt ?? alert.firedAt,
          citationQuery: `runs.id = ${run.id}`,
          tags: { source: "supercheck_native", resourceType: "run", runStatus: run.status },
          metadata: {
            runId: run.id,
            jobId: alert.sourceId,
            reportS3Url: run.reportS3Url,
            logsS3Url: run.logsS3Url,
            videoS3Url: run.videoS3Url,
            screenshotsS3Path: run.screenshotsS3Path,
          },
        });
      }

      const k6Runs = k6RunsByJobId.get(alert.sourceId) ?? [];

      for (const k6Run of k6Runs) {
        addEvidence(evidence, {
          sourceUri: `/runs/${k6Run.runId}`,
          title: `k6 performance run: ${k6Run.status}`,
          summary: `k6 thresholds ${k6Run.thresholdsPassed ? "passed" : "failed"}; p95 ${k6Run.p95ResponseTimeMs ?? "unknown"}ms; failed requests ${k6Run.failedRequests ?? "unknown"}.`,
          rawContentExcerpt: excerpt({
            status: k6Run.status,
            thresholdsPassed: k6Run.thresholdsPassed,
            totalRequests: k6Run.totalRequests,
            failedRequests: k6Run.failedRequests,
            avgResponseTimeMs: k6Run.avgResponseTimeMs,
            p95ResponseTimeMs: k6Run.p95ResponseTimeMs,
            p99ResponseTimeMs: k6Run.p99ResponseTimeMs,
            errorDetails: k6Run.errorDetails,
            consoleOutput: k6Run.consoleOutput,
            reportS3Url: k6Run.reportS3Url,
            summaryS3Url: k6Run.summaryS3Url,
          }),
          evidenceType: "metric",
          severity: k6Run.thresholdsPassed === false ? alert.severity : "sev4",
          confidence: 0.8,
          observedAt: k6Run.completedAt ?? k6Run.startedAt ?? k6Run.createdAt ?? alert.firedAt,
          citationQuery: `k6_performance_runs.id = ${k6Run.id}`,
          tags: { source: "supercheck_native", resourceType: "k6_run", location: k6Run.location },
          metadata: { k6RunId: k6Run.id, runId: k6Run.runId, jobId: alert.sourceId },
        });
      }
    }
  }

  return { incident, window, evidence };
}
