import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import {
  deviceAuthorizations,
  organization,
  projects,
  user,
} from "@/db/schema";
import {
  checkPermissionWithContext,
  resolveProjectPermissionContext,
} from "@/lib/rbac/middleware";
import { issueCliApiKey } from "@/lib/auth/cli-key-service";
import { isCredentialOwnerActive } from "@/lib/security/credential-owner";

export const DEVICE_CLIENT_ID = "supercheck-cli";
export const DEVICE_GRANT_TTL_SECONDS = 15 * 60;
export const DEVICE_POLL_INTERVAL_SECONDS = 5;
export const DEVICE_SLOW_DOWN_STEP_SECONDS = 5;
export const DEVICE_MAX_VERIFICATION_ATTEMPTS = 5;
export const DEVICE_KEY_TTL_SECONDS = 90 * 24 * 60 * 60;
export const DEVICE_GRANT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Unambiguous: no vowels (no accidental words), 0/O/1/I/L/5/S/U excluded. */
export const USER_CODE_ALPHABET = "BCDFGHJKMNPQRTVWXYZ2346789";
const USER_CODE_LENGTH = 8;

export function isDeviceAuthEnabled(): boolean {
  return process.env.DEVICE_AUTH_ENABLED === "true";
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

export function generateDeviceCode(): string {
  return randomBytes(32).toString("base64url"); // 256 bits
}

export function generateUserCode(): string {
  let code = "";
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return code;
}

export function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Returns the canonical 8-char code or null if the input cannot be one. */
export function normalizeUserCode(input: string): string | null {
  if (typeof input !== "string" || input.length > 32) return null;
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== USER_CODE_LENGTH) return null;
  for (const ch of code) {
    if (!USER_CODE_ALPHABET.includes(ch)) return null;
  }
  return code;
}

export function hashDeviceCode(deviceCode: string): string {
  return createHash("sha256").update(deviceCode).digest("hex");
}

function userCodeSecret(): string {
  const secret =
    process.env.DEVICE_AUTH_CODE_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("DEVICE_AUTH_CODE_SECRET or BETTER_AUTH_SECRET must be set");
  }
  return secret;
}

export function hashUserCode(normalizedCode: string): string {
  return createHmac("sha256", userCodeSecret())
    .update(`device-user-code:${normalizedCode}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Untrusted display metadata
// ---------------------------------------------------------------------------

const METADATA_LIMITS = {
  clientName: 64,
  cliVersion: 32,
  hostname: 64,
} as const;

const CONTROL_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\u061c\ufeff]/g;

export function sanitizeClientMetadata(
  raw: unknown,
  requestIp?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const [key, max] of Object.entries(METADATA_LIMITS)) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === "string") {
        const clean = value.replace(CONTROL_CHARS, "").trim().slice(0, max);
        if (clean) out[key] = clean;
      }
    }
  }
  if (requestIp && requestIp !== "unknown") out.requestIp = requestIp;
  return out;
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export interface IssuedDeviceGrant {
  deviceCode: string;
  userCode: string; // formatted XXXX-XXXX
  expiresIn: number;
  interval: number;
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function createDeviceGrant(input: {
  clientId: string;
  metadata: Record<string, string>;
  now?: Date;
}): Promise<IssuedDeviceGrant> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + DEVICE_GRANT_TTL_SECONDS * 1000);

  // Opportunistic retention cleanup keeps the table bounded without a new job.
  await db
    .delete(deviceAuthorizations)
    .where(
      lt(
        deviceAuthorizations.expiresAt,
        new Date(now.getTime() - DEVICE_GRANT_RETENTION_MS),
      ),
    );

  for (let attempt = 0; attempt < 5; attempt++) {
    const deviceCode = generateDeviceCode();
    const userCode = generateUserCode();
    try {
      await db.insert(deviceAuthorizations).values({
        deviceCodeHash: hashDeviceCode(deviceCode),
        userCodeHash: hashUserCode(userCode),
        clientId: input.clientId,
        status: "pending",
        expiresAt,
        pollIntervalSeconds: DEVICE_POLL_INTERVAL_SECONDS,
        clientMetadata: input.metadata,
        createdAt: now,
        updatedAt: now,
      });
      return {
        deviceCode,
        userCode: formatUserCode(userCode),
        expiresIn: DEVICE_GRANT_TTL_SECONDS,
        interval: DEVICE_POLL_INTERVAL_SECONDS,
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // user-code collision: retry with fresh codes
    }
  }
  throw new Error("Could not allocate a unique device code");
}

// ---------------------------------------------------------------------------
// Browser side: lookup / approve / deny
// ---------------------------------------------------------------------------

export interface PendingGrantView {
  clientName: string | null;
  cliVersion: string | null;
  hostname: string | null;
  requestIp: string | null;
  expiresAt: Date;
}

export async function lookupPendingGrant(
  rawUserCode: string,
  now = new Date(),
): Promise<PendingGrantView | null> {
  const code = normalizeUserCode(rawUserCode);
  if (!code) return null;
  const [grant] = await db
    .select()
    .from(deviceAuthorizations)
    .where(eq(deviceAuthorizations.userCodeHash, hashUserCode(code)))
    .limit(1);
  if (!grant || grant.status !== "pending" || grant.expiresAt <= now) {
    return null;
  }
  const meta = grant.clientMetadata ?? {};
  return {
    clientName: meta.clientName ?? null,
    cliVersion: meta.cliVersion ?? null,
    hostname: meta.hostname ?? null,
    requestIp: meta.requestIp ?? null,
    expiresAt: grant.expiresAt,
  };
}

export type DecisionResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "invalid_code"
        | "not_pending"
        | "expired"
        | "too_many_attempts"
        | "forbidden";
    };

async function lockGrantByUserCode(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  rawUserCode: string,
) {
  const code = normalizeUserCode(rawUserCode);
  if (!code) return null;
  const [grant] = await tx
    .select()
    .from(deviceAuthorizations)
    .where(eq(deviceAuthorizations.userCodeHash, hashUserCode(code)))
    .for("update")
    .limit(1);
  return grant ?? null;
}

export async function approveDeviceGrant(input: {
  userCode: string;
  userId: string;
  projectId: string;
  now?: Date;
}): Promise<DecisionResult> {
  const now = input.now ?? new Date();
  // Resolved before the transaction: it issues several queries on the shared pool,
  // and doing that while holding a pooled connection + row lock can exhaust the pool.
  const permissionContext = await resolveProjectPermissionContext(
    input.userId,
    input.projectId,
  );
  const allowed =
    !!permissionContext &&
    checkPermissionWithContext("apiKey", "create", permissionContext);

  return db.transaction(async (tx): Promise<DecisionResult> => {
    const grant = await lockGrantByUserCode(tx, input.userCode);
    if (!grant) return { ok: false, reason: "invalid_code" };
    if (grant.status !== "pending") return { ok: false, reason: "not_pending" };
    if (grant.expiresAt <= now) return { ok: false, reason: "expired" };
    if (grant.verificationAttempts >= DEVICE_MAX_VERIFICATION_ATTEMPTS) {
      return { ok: false, reason: "too_many_attempts" };
    }

    if (!allowed) {
      const attempts = grant.verificationAttempts + 1;
      await tx
        .update(deviceAuthorizations)
        .set({
          verificationAttempts: attempts,
          // Probing projects burns the grant for good.
          status:
            attempts >= DEVICE_MAX_VERIFICATION_ATTEMPTS ? "denied" : "pending",
          updatedAt: now,
        })
        .where(eq(deviceAuthorizations.id, grant.id));
      return { ok: false, reason: "forbidden" };
    }

    await tx
      .update(deviceAuthorizations)
      .set({
        status: "approved",
        approvedUserId: input.userId,
        approvedProjectId: input.projectId,
        approvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(deviceAuthorizations.id, grant.id),
          eq(deviceAuthorizations.status, "pending"),
        ),
      );
    return { ok: true };
  });
}

export async function denyDeviceGrant(input: {
  userCode: string;
  now?: Date;
}): Promise<DecisionResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx): Promise<DecisionResult> => {
    const grant = await lockGrantByUserCode(tx, input.userCode);
    if (!grant) return { ok: false, reason: "invalid_code" };
    // An approval can still be revoked until the CLI exchanges it.
    if (grant.status !== "pending" && grant.status !== "approved") {
      return { ok: false, reason: "not_pending" };
    }
    if (grant.expiresAt <= now) return { ok: false, reason: "expired" };
    await tx
      .update(deviceAuthorizations)
      .set({ status: "denied", updatedAt: now })
      .where(eq(deviceAuthorizations.id, grant.id));
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// CLI side: token exchange
// ---------------------------------------------------------------------------

export type DeviceTokenErrorCode =
  | "authorization_pending"
  | "slow_down"
  | "access_denied"
  | "expired_token"
  | "invalid_grant"
  | "invalid_client"
  | "token_limit_reached";

export const DEVICE_TOKEN_ERROR_STATUS: Record<DeviceTokenErrorCode, number> = {
  authorization_pending: 400,
  slow_down: 400,
  access_denied: 400,
  expired_token: 400,
  invalid_grant: 400,
  invalid_client: 401,
  token_limit_reached: 409,
};

export type DeviceTokenResult =
  | {
      ok: true;
      accessToken: string;
      apiKeyId: string;
      keyName: string;
      expiresIn: number;
      context: {
        user: { id: string; name: string | null; email: string };
        organization: { id: string; name: string; slug: string | null };
        project: { id: string; name: string; slug: string | null };
      };
    }
  | { ok: false; error: DeviceTokenErrorCode; interval?: number };

function safeHostLabel(hostname: string | undefined): string {
  return (hostname ?? "device").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 32) || "device";
}

export async function exchangeDeviceCode(input: {
  deviceCode: string;
  clientId: string;
  now?: Date;
}): Promise<DeviceTokenResult> {
  const now = input.now ?? new Date();
  if (input.clientId !== DEVICE_CLIENT_ID) {
    return { ok: false, error: "invalid_client" };
  }

  // Permission lookups use the shared pool, so they run before the transaction
  // (never while holding a pooled connection + row lock). The transaction below
  // re-checks that the grant is still approved for the same user and project.
  const deviceCodeHash = hashDeviceCode(input.deviceCode);
  const [peek] = await db
    .select({
      status: deviceAuthorizations.status,
      userId: deviceAuthorizations.approvedUserId,
      projectId: deviceAuthorizations.approvedProjectId,
    })
    .from(deviceAuthorizations)
    .where(eq(deviceAuthorizations.deviceCodeHash, deviceCodeHash))
    .limit(1);
  const peekedPermission =
    peek?.status === "approved" && peek.userId && peek.projectId
      ? await resolveProjectPermissionContext(peek.userId, peek.projectId)
      : undefined;

  return db.transaction(async (tx): Promise<DeviceTokenResult> => {
    const [grant] = await tx
      .select()
      .from(deviceAuthorizations)
      .where(eq(deviceAuthorizations.deviceCodeHash, deviceCodeHash))
      .for("update")
      .limit(1);

    if (!grant || grant.clientId !== input.clientId) {
      return { ok: false, error: "invalid_grant" };
    }
    if (grant.status === "consumed") return { ok: false, error: "invalid_grant" };
    if (grant.status === "denied") return { ok: false, error: "access_denied" };
    if (grant.expiresAt <= now) return { ok: false, error: "expired_token" };

    // Enforce the polling interval; callers that poll early are told to back off.
    if (
      grant.lastPolledAt &&
      now.getTime() - grant.lastPolledAt.getTime() <
        grant.pollIntervalSeconds * 1000
    ) {
      const interval = grant.pollIntervalSeconds + DEVICE_SLOW_DOWN_STEP_SECONDS;
      await tx
        .update(deviceAuthorizations)
        .set({ lastPolledAt: now, pollIntervalSeconds: interval, updatedAt: now })
        .where(eq(deviceAuthorizations.id, grant.id));
      return { ok: false, error: "slow_down", interval };
    }

    if (grant.status === "pending") {
      await tx
        .update(deviceAuthorizations)
        .set({ lastPolledAt: now, updatedAt: now })
        .where(eq(deviceAuthorizations.id, grant.id));
      return {
        ok: false,
        error: "authorization_pending",
        interval: grant.pollIntervalSeconds,
      };
    }

    // status === "approved": revalidate consent, then mint + consume atomically.
    if (!grant.approvedUserId || !grant.approvedProjectId) {
      return { ok: false, error: "invalid_grant" };
    }
    if (
      peek?.status !== "approved" ||
      peek.userId !== grant.approvedUserId ||
      peek.projectId !== grant.approvedProjectId
    ) {
      // Approved between our peek and the lock: ask the client to poll again.
      return {
        ok: false,
        error: "authorization_pending",
        interval: grant.pollIntervalSeconds,
      };
    }
    const permissionContext = peekedPermission;
    // A grant approved before a suspension must not mint a key during it: the key would
    // outlive a temporary ban.
    const [approver] = await tx
      .select({ banned: user.banned, banExpires: user.banExpires })
      .from(user)
      .where(eq(user.id, grant.approvedUserId))
      .limit(1);
    if (
      !isCredentialOwnerActive(approver) ||
      !permissionContext ||
      !checkPermissionWithContext("apiKey", "create", permissionContext)
    ) {
      await tx
        .update(deviceAuthorizations)
        .set({ status: "denied", updatedAt: now })
        .where(eq(deviceAuthorizations.id, grant.id));
      return { ok: false, error: "access_denied" };
    }

    const label = safeHostLabel(grant.clientMetadata?.hostname);
    const stamp = now.toISOString().slice(0, 10);
    let issued = await issueCliApiKey(tx, {
      userId: grant.approvedUserId,
      organizationId: permissionContext.organizationId,
      projectId: grant.approvedProjectId,
      name: `CLI login ${label} ${stamp}`,
      expiresInSeconds: DEVICE_KEY_TTL_SECONDS,
    });
    if (!issued.ok && issued.reason === "name_conflict") {
      issued = await issueCliApiKey(tx, {
        userId: grant.approvedUserId,
        organizationId: permissionContext.organizationId,
        projectId: grant.approvedProjectId,
        name: `CLI login ${label} ${stamp} ${randomBytes(3).toString("hex")}`,
        expiresInSeconds: DEVICE_KEY_TTL_SECONDS,
      });
    }
    if (!issued.ok) {
      return {
        ok: false,
        error: issued.reason === "limit_reached" ? "token_limit_reached" : "invalid_grant",
      };
    }

    const consumed = await tx
      .update(deviceAuthorizations)
      .set({
        status: "consumed",
        apiKeyId: issued.key.id,
        consumedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(deviceAuthorizations.id, grant.id),
          eq(deviceAuthorizations.status, "approved"),
        ),
      )
      .returning({ id: deviceAuthorizations.id });
    if (consumed.length !== 1) {
      // Defensive: row lock makes this unreachable; abort so the key rolls back.
      throw new Error("Device grant changed during exchange");
    }

    const [[owner], [org], [project]] = await Promise.all([
      tx
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, grant.approvedUserId))
        .limit(1),
      tx
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
        })
        .from(organization)
        .where(eq(organization.id, permissionContext.organizationId))
        .limit(1),
      tx
        .select({ id: projects.id, name: projects.name, slug: projects.slug })
        .from(projects)
        .where(eq(projects.id, grant.approvedProjectId))
        .limit(1),
    ]);

    return {
      ok: true,
      accessToken: issued.key.plaintext,
      apiKeyId: issued.key.id,
      keyName: issued.key.name,
      expiresIn: issued.key.expiresAt
        ? Math.max(0, Math.floor((issued.key.expiresAt.getTime() - now.getTime()) / 1000))
        : DEVICE_KEY_TTL_SECONDS,
      context: { user: owner, organization: org, project },
    };
  });
}

/** Test/maintenance helper: count rows in the grant table. */
export async function countDeviceGrants(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(deviceAuthorizations);
  return row.count;
}
