import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { jobs, monitors, oauthConsent, organization, projects, reports, statusPages, tests, member, user } from "@/db/schema";
import { createS3CleanupService } from "@/lib/s3-cleanup";
import { logAdminEvent, logAuditEvent } from "@/lib/audit-logger";
import { TEARDOWN_ACTION } from "@/lib/organization-teardown-action";
import { assertNoUnsettledUsage, flushFinalUsage, hasCancellableSubscription, revokeRemainingSubscription } from "./billing";
import type { DeletionRow } from "./jobs";
import { quiesceOrganization } from "./organization";
import { invalidateOrgState, invalidateProjectState, type DeletionMeta, metaPatch } from "./org-state";
import { sendCompletionNotice } from "./notices";
import { PURGE_BATCH, asInput, deleteStorage, limits, purgeJobStep, purgeMonitorStep, purgeRunBatch, reportColumns, type StepResult } from "./purge";

/**
 * Project and organization purges. Both are phased and resumable: the whole position lives in the deletion row's cursor
 * (`sub`, and the child job or monitor being purged with its own phase and cursor). A child is purged by calling the
 * job and monitor step functions on a synthetic row, so the proven batching, storage-first and straggler logic is reused.
 * Every step is idempotent and does bounded work; no network call happens inside a transaction.
 */

type Child = { kind: "job" | "monitor"; id: string; phase?: string | null; cursor?: Record<string, unknown> };
type ProjectState = { sub?: "jobs" | "monitors" | "runs" | "tests" | "storage" | "final"; child?: Child; counts?: Record<string, number> };
type OrgState = ProjectState & { stage?: "begin" | "quiesce" | "usage" | "projects" | "reports" | "billing" | "final"; projectId?: string; project?: ProjectState };
type Pass = { done: true } | { done: false; state: ProjectState; delayMs?: number };

const count = (state: ProjectState, key: string, add: number) => ({ ...state.counts, [key]: (state.counts?.[key] ?? 0) + add });

/** Run one child job/monitor purge step and fold its position back into the state. */
async function stepChild(row: DeletionRow, state: ProjectState, child: Child): Promise<Pass> {
  // The drain wait is bounded from when this purge began (not from the request, days earlier).
  const synthetic = { ...row, createdAt: row.startedAt ?? new Date(), scope: child.kind, targetId: child.id, phase: child.phase ?? (child.kind === "job" ? "drain" : "results"), cursor: child.cursor ?? {} } as DeletionRow;
  const result: StepResult = await (child.kind === "job" ? purgeJobStep : purgeMonitorStep)(synthetic);
  if (result.done) return { done: false, state: { ...state, child: undefined, counts: count(state, `${child.kind}s`, 1) } };
  return { done: false, state: { ...state, child: { ...child, phase: result.phase, cursor: result.progress ?? child.cursor } }, delayMs: result.delayMs };
}

/** Purge the content of one project (not its row). Returns done when nothing is left to remove. */
async function purgeProjectContent(row: DeletionRow, projectId: string, state: ProjectState): Promise<Pass> {
  const sub = state.sub ?? "jobs";
  if (state.child) return stepChild(row, state, state.child);
  if (sub === "jobs" || sub === "monitors") {
    const table = sub === "jobs" ? jobs : monitors;
    const [next] = await db.select({ id: table.id }).from(table).where(eq(table.projectId, projectId)).orderBy(asc(table.id)).limit(1);
    if (!next) return { done: false, state: { ...state, sub: sub === "jobs" ? "monitors" : "runs" } };
    return { done: false, state: { ...state, child: { kind: sub === "jobs" ? "job" : "monitor", id: next.id } } };
  }
  if (sub === "runs") {
    // Runs without a job (playground and saved-test executions) and anything a late tick created.
    const purged = await purgeRunBatch("projectId", projectId);
    return { done: false, state: purged === 0 ? { ...state, sub: "tests" } : { ...state, counts: count(state, "runs", purged) } };
  }
  if (sub === "tests") {
    const batch = await db.select({ id: tests.id }).from(tests).where(eq(tests.projectId, projectId)).orderBy(asc(tests.id)).limit(PURGE_BATCH);
    if (batch.length === 0) return { done: false, state: { ...state, sub: "storage" } };
    const ids = batch.map((t) => t.id);
    const s3 = createS3CleanupService();
    try {
      for (let i = 0; i < ids.length; i += 16) {
        const results = await Promise.all(ids.slice(i, i + 16).flatMap((id) => [
          s3.deletePrefix(s3.bucket("testBucketName"), `${id}/`), s3.deletePrefix(s3.bucket("k6TestBucketName"), `${id}/`),
        ]));
        if (results.some((r) => !r.success)) throw new Error("Could not delete test report storage; will retry");
      }
    } finally { s3.destroy(); }
    const own = await db.select({ ...reportColumns, entityType: reports.entityType }).from(reports).where(and(inArray(reports.entityType, ["test", "k6_test"]), inArray(reports.entityId, ids)));
    await deleteStorage(own.map((r) => asInput(r, r.entityType)), "test");
    await db.transaction(async (tx) => {
      await limits(tx);
      if (own.length) await tx.delete(reports).where(inArray(reports.id, own.map((r) => r.id)));
      await tx.delete(tests).where(and(eq(tests.projectId, projectId), inArray(tests.id, ids)));
    });
    return { done: false, state: { ...state, counts: count(state, "tests", ids.length) } };
  }
  if (sub === "storage") {
    // Files that only exist in S3 (no report row), keyed by project or status page.
    const pages = await db.select({ id: statusPages.id }).from(statusPages).where(eq(statusPages.projectId, projectId));
    const s3 = createS3CleanupService();
    try {
      const results = await Promise.all([
        s3.deletePrefix(s3.bucket("requirementsBucketName"), `projects/${projectId}/`),
        s3.deletePrefix(s3.bucket("projectDataFilesBucketName"), `projects/${projectId}/`),
        ...pages.map((page) => s3.deletePrefix(s3.bucket("statusBucketName"), `status-pages/${page.id}/`)),
      ]);
      if (results.some((r) => !r.success)) throw new Error("Could not delete project files; will retry");
    } finally { s3.destroy(); }
    return { done: false, state: { ...state, sub: "final" } };
  }
  return { done: true };
}

/** Delete the project row (cascades the rest) once content is gone. Returns false when something reappeared. */
async function deleteProjectRow(projectId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await limits(tx);
    const [locked] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("update");
    if (!locked) return true;
    const [straggler] = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.projectId, projectId)).limit(1);
    const [monitorStraggler] = await tx.select({ id: monitors.id }).from(monitors).where(eq(monitors.projectId, projectId)).limit(1);
    if (straggler || monitorStraggler) return false;
    // MCP consents reference projects by id without a foreign key.
    await tx.delete(oauthConsent).where(eq(oauthConsent.referenceId, projectId));
    await tx.delete(projects).where(eq(projects.id, projectId));
    return true;
  });
}

const done = (): StepResult => ({ done: true });

/** Project purge: verify under the row lock that it is still deleted and past its restore window, then purge. */
export async function purgeProjectStep(row: DeletionRow): Promise<StepResult> {
  const projectId = row.targetId;
  const state = (row.cursor as ProjectState & { begun?: boolean; archivedPages?: unknown }) ?? {};
  if (!state.begun) {
    const proceed = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
      const [project] = await tx.select({ status: projects.status, due: sql<boolean>`${projects.purgeAfter} <= now()` }).from(projects).where(eq(projects.id, projectId)).for("update");
      if (!project) return "gone" as const;
      if (project.status !== "deleted") return "restored" as const;
      return project.due ? ("go" as const) : ("wait" as const);
    });
    if (proceed === "gone" || proceed === "restored") return done();
    if (proceed === "wait") return { done: false, phase: "waiting", delayMs: 60_000 };
    return { done: false, phase: "jobs", progress: { ...state, begun: true } };
  }
  const pass = await purgeProjectContent(row, projectId, state);
  if (!pass.done) return { done: false, phase: pass.state.child ? `${pass.state.sub ?? "jobs"}:child` : (pass.state.sub ?? "jobs"), progress: { ...state, ...pass.state, begun: true }, delayMs: pass.delayMs };
  if (!(await deleteProjectRow(projectId))) return { done: false, phase: "jobs", progress: { ...state, sub: "jobs", child: undefined, begun: true } };
  invalidateProjectState(projectId);
  await logAuditEvent({ userId: row.requestedByUserId ?? undefined, organizationId: row.organizationId ?? undefined, action: "project_purged", resource: "project", resourceId: projectId, metadata: { counts: state.counts }, success: true });
  return done();
}

/** Organization purge. The first step re-verifies, under the org row lock, that the org is still pending and due, and stamps the start so a late cancel is refused. */
export async function purgeOrganizationStep(row: DeletionRow): Promise<StepResult> {
  const organizationId = row.targetId;
  const state = (row.cursor as OrgState) ?? {};
  const stage = state.stage ?? "begin";
  const next = (patch: Partial<OrgState>, phase = patch.stage ?? stage): StepResult => ({ done: false, phase, progress: { ...state, ...patch } });

  if (stage === "begin") {
    const verdict = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
      const [org] = await tx.select({ pending: organization.deletionRequestedAt, due: sql<boolean>`${organization.deletionPurgeAfter} <= now()` }).from(organization).where(eq(organization.id, organizationId)).for("update");
      if (!org) return "gone" as const;
      if (!org.pending) return "cancelled" as const;
      if (!org.due) return "wait" as const;
      await tx.update(organization).set({ deletionMeta: metaPatch(organization.deletionMeta, { purgeStartedAt: new Date().toISOString() }) }).where(eq(organization.id, organizationId));
      return "go" as const;
    });
    if (verdict === "gone" || verdict === "cancelled") return done();
    if (verdict === "wait") return { done: false, phase: "waiting", delayMs: 60_000 };
    invalidateOrgState(organizationId);
    return next({ stage: "quiesce" });
  }
  if (stage === "quiesce") {
    // Finish stopping activity (cancel runs, unschedule). Not "done" yet: wait and retry rather than purge under live schedules.
    if (!(await quiesceOrganization(organizationId, { budgetMs: 60_000, force: true }))) return { done: false, phase: "quiesce", delayMs: 5_000 };
    return next({ stage: "usage" });
  }
  const [org] = await db.select({ id: organization.id, name: organization.name, subscriptionId: organization.subscriptionId, polarCustomerId: organization.polarCustomerId }).from(organization).where(eq(organization.id, organizationId));
  if (!org) return done();
  if (stage === "usage") {
    // Unsent usage would never be billed once the organization is gone: wait (retry with backoff) until it is settled.
    if (hasCancellableSubscription(org) && org.polarCustomerId) {
      await flushFinalUsage(organizationId, { strict: true });
      await assertNoUnsettledUsage(db, organizationId);
    }
    return next({ stage: "projects" });
  }
  if (stage === "projects") {
    let projectId = state.projectId;
    if (!projectId) {
      const [first] = await db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, organizationId)).orderBy(asc(projects.id)).limit(1);
      if (!first) return next({ stage: "reports" });
      projectId = first.id;
    }
    const projectState = state.project ?? {};
    const pass = await purgeProjectContent(row, projectId, projectState);
    if (!pass.done) return { done: false, phase: "projects", progress: { ...state, projectId, project: pass.state }, delayMs: pass.delayMs };
    if (!(await deleteProjectRow(projectId))) return next({ projectId, project: { counts: projectState.counts } }, "projects");
    return next({ projectId: undefined, project: undefined, counts: count(state, "projects", 1) }, "projects");
  }
  if (stage === "reports") {
    // Report rows owned by the organization that no project purge reached.
    const batch = await db.select({ ...reportColumns, entityType: reports.entityType }).from(reports).where(eq(reports.organizationId, organizationId)).limit(PURGE_BATCH);
    if (batch.length === 0) return next({ stage: "billing" });
    await deleteStorage(batch.map((r) => asInput(r, r.entityType)), "organization");
    await db.delete(reports).where(inArray(reports.id, batch.map((r) => r.id)));
    return next({ counts: count(state, "reports", batch.length) }, "reports");
  }
  if (stage === "billing") {
    if (hasCancellableSubscription(org) || org.polarCustomerId) {
      // The billing webhooks recognise the follow-up events of this revoke by this marker.
      await logAdminEvent(row.requestedByUserId ?? "", "organization_teardown_started", organizationId, "organization", organizationId, { organizationId, subscriptionId: org.subscriptionId ?? undefined }).catch(() => undefined);
      await revokeRemainingSubscription(org);
    }
    return next({ stage: "final" });
  }
  // final
  const owners = await db.select({ email: user.email }).from(member).innerJoin(user, eq(user.id, member.userId)).where(and(eq(member.organizationId, organizationId), eq(member.role, "org_owner")));
  const finished = await db.transaction(async (tx) => {
    await limits(tx);
    const [locked] = await tx.select({ id: organization.id }).from(organization).where(eq(organization.id, organizationId)).for("update");
    if (!locked) return true;
    const [left] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, organizationId)).limit(1);
    if (left) return false; // a project appeared after the projects stage
    await tx.delete(organization).where(eq(organization.id, organizationId));
    return true;
  });
  if (!finished) return next({ stage: "projects", projectId: undefined, project: undefined });
  invalidateOrgState(organizationId);
  await logAuditEvent({ userId: row.requestedByUserId ?? undefined, organizationId, action: "organization_purged", resource: "organization", resourceId: organizationId, metadata: { counts: state.counts, subscriptionId: org.subscriptionId ?? undefined }, success: true });
  await sendCompletionNotice(org.name, owners.map((owner) => owner.email)).catch(() => undefined);
  return done();
}

export type { DeletionMeta };
