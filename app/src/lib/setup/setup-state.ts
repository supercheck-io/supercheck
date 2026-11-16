import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { projectSetupState, userPreferences, type ProjectSetupStatus, type UserPersona } from "@/db/schema/project-setup";
import { user } from "@/db/schema/auth";
import { db } from "@/utils/db";
import { liveJob, liveMonitor } from "@/lib/deletion/visibility";
import { checkMonitorLimit, countPlanMonitors } from "@/lib/middleware/plan-enforcement";
import { parseSetupDraft, type SetupDraft } from "./draft-schema";
import type { SetupStepKey } from "./persona";
import type { SetupCounts } from "./checklist";
import type { SetupLockInfo, SetupStateDto, SetupUpdateRequest, UserPreferencesDto } from "./types";

/** A lock not refreshed for this long is treated as released (heartbeat is every 60 s). */
export const SETUP_LOCK_TTL_MINUTES = 15;
const LOCK_TTL_MS = SETUP_LOCK_TTL_MINUTES * 60_000;
const LOCK_EXPIRED = sql`${projectSetupState.lockedAt} < now() - make_interval(mins => ${SETUP_LOCK_TTL_MINUTES})`;

type Row = typeof projectSetupState.$inferSelect;

/** A lock claim can create the row before any save; it carries this epoch updated_at, reported as "no row yet". */
const NEVER_WRITTEN = new Date(0);
const neverWritten = (row: Row): boolean => row.updatedAt.getTime() === 0;

/** SQL: the stored per-tab token equals `token`; a request with no token only matches a lock stored without one. */
const tokenMatches = (token: string | null | undefined) =>
  token ? sql`${projectSetupState.lockToken} = ${token}` : sql`${projectSetupState.lockToken} IS NULL`;

/** SQL: no live lock, or the caller's own tab holds it. */
const holderOrFree = (userId: string, token: string | null | undefined) =>
  sql`(${projectSetupState.lockedByUserId} IS NULL OR ${LOCK_EXPIRED} OR (${projectSetupState.lockedByUserId} = ${userId} AND ${tokenMatches(token)}))`;

/** `token` undefined = a read with no tab identity (GET): any tab of the holder counts as mine. */
function lockOf(row: Row, userName: string | null, me: string, token?: string | null): SetupLockInfo | null {
  if (!row.lockedByUserId || !row.lockedAt) return null;
  if (Date.now() - row.lockedAt.getTime() > LOCK_TTL_MS) return null;
  return {
    userId: row.lockedByUserId,
    userName,
    lockedAt: row.lockedAt.toISOString(),
    mine: row.lockedByUserId === me && (token === undefined || (row.lockToken ?? null) === (token ?? null)),
  };
}

function toDto(row: Row | undefined, userName: string | null, me: string, token?: string | null): SetupStateDto {
  if (!row) {
    return {
      status: "not_started",
      currentStep: null,
      draft: {},
      skipped: [],
      statusPageOptOut: false,
      lock: null,
      lastAiRunAt: null,
      scanResult: null,
      completedAt: null,
      dismissedAt: null,
      updatedAt: null,
    };
  }
  return {
    status: row.status,
    currentStep: row.currentStep as SetupStepKey | null,
    draft: row.draft as SetupDraft,
    skipped: row.skipped as SetupStepKey[],
    statusPageOptOut: row.statusPageOptOut,
    lock: lockOf(row, userName, me, token),
    lastAiRunAt: row.lastAiRunAt?.toISOString() ?? null,
    scanResult: row.scanResult ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    updatedAt: neverWritten(row) ? null : row.updatedAt.toISOString(),
  };
}

async function loadRow(organizationId: string, projectId: string): Promise<{ row?: Row; lockerName: string | null }> {
  const [found] = await db
    .select({ row: projectSetupState, lockerName: user.name })
    .from(projectSetupState)
    .leftJoin(user, eq(user.id, projectSetupState.lockedByUserId))
    .where(and(eq(projectSetupState.organizationId, organizationId), eq(projectSetupState.projectId, projectId)))
    .limit(1);
  return { row: found?.row, lockerName: found?.lockerName ?? null };
}

export async function getSetupState(organizationId: string, projectId: string, userId: string): Promise<SetupStateDto> {
  const { row, lockerName } = await loadRow(organizationId, projectId);
  return toDto(row, lockerName, userId);
}

export type UpdateSetupResult =
  | { kind: "ok"; state: SetupStateDto; previousStatus: ProjectSetupStatus }
  | { kind: "conflict"; state: SetupStateDto }
  | { kind: "locked"; lock: SetupLockInfo }
  | { kind: "invalid"; error: string };

/**
 * Save draft / step / skipped / status. Optimistic on updated_at (null = "no row yet"); refused while another
 * user holds a live lock. One conditional statement, so a race resolves to exactly one writer.
 */
export async function updateSetupState(
  organizationId: string,
  projectId: string,
  userId: string,
  patch: Omit<SetupUpdateRequest, "expectedUpdatedAt">,
  expectedUpdatedAt: string | null | undefined,
  lockToken: string | null = null,
): Promise<UpdateSetupResult> {
  const set: Partial<typeof projectSetupState.$inferInsert> = {};
  if (patch.draft !== undefined) {
    const parsed = parseSetupDraft(patch.draft);
    if (!parsed.success) return { kind: "invalid", error: parsed.error };
    set.draft = parsed.data;
  }
  if (patch.currentStep !== undefined) set.currentStep = patch.currentStep;
  if (patch.skipped !== undefined) set.skipped = patch.skipped;
  if (patch.statusPageOptOut !== undefined) set.statusPageOptOut = patch.statusPageOptOut;
  const { row: existing, lockerName } = await loadRow(organizationId, projectId);
  if (patch.status !== undefined) {
    set.status = patch.status;
    // Re-sending the same status keeps the first timestamp.
    const same = existing?.status === patch.status;
    if (!(same && patch.status === "completed")) set.completedAt = patch.status === "completed" ? new Date() : null;
    if (!(same && patch.status === "dismissed")) set.dismissedAt = patch.status === "dismissed" ? new Date() : null;
  }
  const blockedBy = existing && lockOf(existing, lockerName, userId, lockToken);
  if (blockedBy && !blockedBy.mine) return { kind: "locked", lock: blockedBy };
  const previousStatus = existing?.status ?? "not_started";

  let wrote = false;
  if (!existing) {
    if (expectedUpdatedAt) return { kind: "conflict", state: toDto(undefined, null, userId) };
    const inserted = await db
      .insert(projectSetupState)
      .values({ organizationId, projectId, ...set, updatedAt: sql`clock_timestamp()` })
      .onConflictDoNothing({ target: projectSetupState.projectId })
      .returning({ id: projectSetupState.id });
    wrote = inserted.length > 0;
  }
  // A lock claim can insert the row between our read and insert: fall through to the guarded update.
  if (!wrote) {
    const stale = expectedUpdatedAt
      ? sql`date_trunc('milliseconds', ${projectSetupState.updatedAt}) = ${expectedUpdatedAt}::timestamptz`
      : sql`${projectSetupState.updatedAt} = to_timestamp(0)`;
    const updated = await db
      .update(projectSetupState)
      .set({ ...set, updatedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(projectSetupState.organizationId, organizationId),
          eq(projectSetupState.projectId, projectId),
          stale,
          holderOrFree(userId, lockToken),
        ),
      )
      .returning({ id: projectSetupState.id });
    wrote = updated.length > 0;
  }

  const after = await loadRow(organizationId, projectId);
  if (!wrote) {
    const lock = after.row && lockOf(after.row, after.lockerName, userId, lockToken);
    if (lock && !lock.mine) return { kind: "locked", lock };
    return { kind: "conflict", state: toDto(after.row, after.lockerName, userId) };
  }
  return { kind: "ok", state: toDto(after.row, after.lockerName, userId), previousStatus };
}

export type LockResult = { kind: "ok"; lock: SetupLockInfo } | { kind: "locked"; lock: SetupLockInfo };

/** Take or heartbeat the lock in one atomic upsert. Does not touch updated_at (that is the draft's version). */
export async function claimLock(
  organizationId: string,
  projectId: string,
  userId: string,
  lockToken: string | null,
  takeover = false,
  // A tab opening fresh takes over its own user's older tab lock; heartbeats (no reclaim) keep the per-tab check, so tabs never steal back and forth.
  reclaim = false,
): Promise<LockResult> {
  const now = new Date();
  const claimed = await db
    .insert(projectSetupState)
    .values({ organizationId, projectId, lockedByUserId: userId, lockedAt: now, lockToken, updatedAt: NEVER_WRITTEN })
    .onConflictDoUpdate({
      target: projectSetupState.projectId,
      set: { lockedByUserId: userId, lockedAt: sql`now()`, lockToken },
      setWhere: and(
        eq(projectSetupState.organizationId, organizationId),
        takeover
          ? undefined
          : reclaim
            ? sql`(${projectSetupState.lockedByUserId} IS NULL OR ${LOCK_EXPIRED} OR ${projectSetupState.lockedByUserId} = ${userId})`
            : holderOrFree(userId, lockToken),
      ),
    })
    .returning({ id: projectSetupState.id });

  const { row, lockerName } = await loadRow(organizationId, projectId);
  const lock = row && lockOf(row, lockerName, userId, lockToken);
  if (claimed.length > 0 && lock) return { kind: "ok", lock };
  if (lock) return { kind: "locked", lock };
  // Row vanished or lock expired between the statements: the caller can simply retry.
  return { kind: "locked", lock: { userId: "", userName: null, lockedAt: new Date(0).toISOString(), mine: false } };
}

/** Clears only the lock held by the caller's own tab. */
export async function releaseLock(organizationId: string, projectId: string, userId: string, lockToken: string | null): Promise<void> {
  await db
    .update(projectSetupState)
    .set({ lockedByUserId: null, lockedAt: null, lockToken: null })
    .where(
      and(
        eq(projectSetupState.organizationId, organizationId),
        eq(projectSetupState.projectId, projectId),
        eq(projectSetupState.lockedByUserId, userId),
        tokenMatches(lockToken),
      ),
    );
}

/** One round trip: every ticked item is a scalar COUNT filtered by organization and project where the table has both. */
export async function getChecklistCounts(organizationId: string, projectId: string): Promise<SetupCounts> {
  const o = organizationId;
  const p = projectId;
  const rows = await db.execute<Record<keyof SetupCounts, number>>(sql`
    SELECT
      (SELECT count(*)::int FROM monitors m WHERE m.organization_id = ${o} AND m.project_id = ${p} AND ${liveMonitor("m")}) AS "monitors",
      (SELECT count(*)::int FROM monitors m WHERE m.organization_id = ${o} AND m.project_id = ${p} AND m.type = 'heartbeat' AND ${liveMonitor("m")}) AS "heartbeatMonitors",
      (SELECT count(*)::int FROM notification_providers np WHERE np.organization_id = ${o} AND np.project_id = ${p}) AS "notificationProviders",
      (SELECT count(*)::int FROM status_pages sp WHERE sp.organization_id = ${o} AND sp.project_id = ${p} AND sp.status <> 'archived') AS "statusPages",
      (SELECT count(*)::int FROM requirements r WHERE r.organization_id = ${o} AND r.project_id = ${p}) AS "requirements",
      (SELECT count(*)::int FROM tests t WHERE t.organization_id = ${o} AND t.project_id = ${p}) AS "tests",
      (SELECT count(*)::int FROM jobs j WHERE j.organization_id = ${o} AND j.project_id = ${p} AND ${liveJob("j")}) AS "jobs",
      (
        (SELECT count(*)::int FROM external_connectors c WHERE c.organization_id = ${o} AND c.project_id = ${p} AND c.status IN ('configured', 'valid'))
        + (SELECT count(*)::int FROM private_agents a WHERE a.organization_id = ${o} AND (a.project_id = ${p} OR a.project_id IS NULL) AND a.status <> 'disabled')
      ) AS "connectorsOrAgents",
      (SELECT count(*)::int FROM sre_services s WHERE s.organization_id = ${o} AND s.project_id = ${p} AND s.status <> 'merged') AS "services",
      (
        (SELECT count(*)::int FROM member mb WHERE mb.organization_id = ${o})
        + (SELECT count(*)::int FROM invitation i WHERE i.organization_id = ${o} AND i.status = 'pending' AND i.expires_at > now())
      ) AS "membersAndInvites",
      (SELECT count(*)::int FROM apikey k WHERE k.project_id = ${p} AND k.job_id IS NULL AND COALESCE(k.enabled, true) AND (k.expires_at IS NULL OR k.expires_at > now())) AS "cliTokens",
      0 AS "pushDevices"
  `);
  return rows[0] as SetupCounts;
}

/** Monitors the org can still add: 0 only when the plan limit is reached; null when uncapped (self-hosted) or the plan could not be read. */
export async function monitorsRemaining(organizationId: string): Promise<number | null> {
  const check = await checkMonitorLimit(organizationId, await countPlanMonitors(db, organizationId));
  if (!check.allowed) return "limit" in check ? 0 : null;
  return "remaining" in check && typeof check.remaining === "number" ? check.remaining : null;
}

export async function getUserPreferences(userId: string): Promise<UserPreferencesDto> {
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  return { persona: row?.persona ?? null, seen: !!row };
}

export async function setUserPersona(userId: string, persona: UserPersona | null): Promise<UserPreferencesDto> {
  await db
    .insert(userPreferences)
    .values({ userId, persona })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { persona, updatedAt: sql`now()` } });
  return { persona, seen: true };
}
