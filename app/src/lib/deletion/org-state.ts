import { NextResponse } from "next/server";
import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/utils/db";
import { organization, projects } from "@/db/schema";
import { isSelfHosted } from "@/lib/feature-flags";

/**
 * Pending-deletion state of organizations and soft-deleted projects.
 *
 * The hot paths never call these: they read `deletion_requested_at` from a row they already load (the unified auth
 * join, the CLI token join). These helpers are for places that only hold an id. The small in-process cache is for
 * deny and UX checks only. Anything that admits work, unschedules or deletes must read the database (`fresh: true`),
 * so a pod that missed an invalidation can never undo a cancellation on another pod.
 */

export const PENDING_ORG_CODE = "ORG_PENDING_DELETION";
export const DEFAULT_ORG_GRACE_DAYS = 14;
export const PROJECT_RESTORE_DAYS = 7;
const CACHE_TTL_MS = 5_000;
const CACHE_MAX = 5_000;

export class OrgPendingDeletionError extends Error {
  readonly code = PENDING_ORG_CODE;
  constructor(message = "This organization is scheduled for deletion and is read-only. The owner can cancel the deletion.") { super(message); }
}

type Entry = { value: boolean; at: number };
const orgCache = new Map<string, Entry>();
const projectCache = new Map<string, Entry>();

function remember(cache: Map<string, Entry>, key: string, value: boolean) {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, { value, at: Date.now() });
}

/** Local invalidation after a request or cancel on this pod; other pods converge within the TTL. */
export function invalidateOrgState(organizationId: string): void { orgCache.delete(organizationId); }
export function invalidateProjectState(projectId: string): void { projectCache.delete(projectId); }
export function clearDeletionStateCache(): void { orgCache.clear(); projectCache.clear(); }

export async function isOrgPendingDeletion(organizationId: string | null | undefined, options: { fresh?: boolean } = {}): Promise<boolean> {
  if (!organizationId) return false;
  const hit = options.fresh ? undefined : orgCache.get(organizationId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const [row] = await db.select({ at: organization.deletionRequestedAt }).from(organization).where(eq(organization.id, organizationId)).limit(1);
  const pending = !!row?.at;
  remember(orgCache, organizationId, pending);
  return pending;
}

/** Pending state read on the caller's own transaction (no second connection), optionally locking the organization row. */
export async function readOrgPendingOn(tx: Pick<typeof db, "select">, organizationId: string, lock: "share" | "update"): Promise<boolean | null> {
  const [row] = await tx.select({ at: organization.deletionRequestedAt }).from(organization).where(eq(organization.id, organizationId)).for(lock);
  return row ? !!row.at : null;
}

export async function isProjectDeleted(projectId: string | null | undefined, options: { fresh?: boolean } = {}): Promise<boolean> {
  if (!projectId) return false;
  const hit = options.fresh ? undefined : projectCache.get(projectId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const [row] = await db.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId)).limit(1);
  const deleted = row?.status === "deleted";
  remember(projectCache, projectId, deleted);
  return deleted;
}

/** The organization behind a project is pending deletion (one join, for routes that only hold a project id). */
export async function isProjectOrgPending(projectId: string): Promise<boolean> {
  const [row] = await db.select({ at: organization.deletionRequestedAt }).from(projects)
    .innerJoin(organization, eq(organization.id, projects.organizationId)).where(eq(projects.id, projectId)).limit(1);
  return !!row?.at;
}

/** Throws OrgPendingDeletionError; for server actions and routes that mutate organization-owned data. */
export async function assertOrgWritable(organizationId: string | null | undefined, options: { fresh?: boolean } = {}): Promise<void> {
  if (await isOrgPendingDeletion(organizationId, options)) throw new OrgPendingDeletionError();
}

export function isOrgPendingDeletionError(error: unknown): error is OrgPendingDeletionError {
  return error instanceof OrgPendingDeletionError || (typeof error === "object" && error !== null && (error as { code?: unknown }).code === PENDING_ORG_CODE);
}

export function pendingDeletionResponse(): NextResponse {
  return NextResponse.json({ error: new OrgPendingDeletionError().message, code: PENDING_ORG_CODE }, { status: 403 });
}


/** Grace window for a new organization deletion. Zero (immediate purge) only for self-hosted; cloud ignores 0 and invalid values. */
export function organizationGraceDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ORG_DELETION_GRACE_DAYS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_ORG_GRACE_DAYS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) return DEFAULT_ORG_GRACE_DAYS;
  if (parsed === 0 && !isSelfHosted()) return DEFAULT_ORG_GRACE_DAYS;
  return parsed;
}

/** Progress markers kept in organization.deletion_meta. */
export type DeletionMeta = {
  quiesced?: boolean;
  quiesceAfter?: { job?: string; monitor?: string };
  /** We (not a webhook) asked the billing provider to cancel at period end, so cancelling the deletion must undo it. */
  billingCancelRequested?: boolean;
  /** Saved before the provider call, so a crash between the call and its record cannot lose the reinstate. */
  billingCancelAttempted?: boolean;
  billingCancelSettled?: boolean;
  /** A cancelled deletion could not restore renewal; the billing sweep retries it while the organization is not pending. */
  billingReinstatePending?: boolean;
  /** Owners the notice already reached, so a retry after a partial failure only sends to the rest. */
  noticeRequestedTo?: string[];
  notice7dTo?: string[];
  notice1dTo?: string[];
  purgeStartedAt?: string;
  forcedByUserId?: string;
  noticeRequested?: string;
  notice7d?: string;
  notice1d?: string;
  noticeCompleted?: string;
};

export const metaPatch = (column: unknown, patch: DeletionMeta): SQL => sql`${column} || ${JSON.stringify(patch)}::jsonb`;
