import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { executionTargetDomains, organization } from "@/db/schema";
import { normalizeTargetHostname, verifyTargetDns, TargetDnsUnavailableError } from "./target-domain";

export class TargetDomainError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 503) { super(message); }
}

export async function registerTargetDomain(organizationId: string, value: string) {
  let hostname: string;
  try { hostname = normalizeTargetHostname(value); }
  catch { throw new TargetDomainError("An exact public DNS hostname is required", 400); }
  return db.transaction(async tx => {
    const [owner] = await tx.select({ id: organization.id }).from(organization)
      .where(eq(organization.id, organizationId)).for("update");
    if (!owner) throw new TargetDomainError("Organization not found", 404);
    const existing = await tx.query.executionTargetDomains.findFirst({ where: and(
      eq(executionTargetDomains.organizationId, organizationId), eq(executionTargetDomains.hostname, hostname),
    ) });
    if (existing) return existing;
    const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(executionTargetDomains)
      .where(eq(executionTargetDomains.organizationId, organizationId));
    if (count.value >= 20) throw new TargetDomainError("An organization may register at most 20 execution targets", 409);
    const [row] = await tx.insert(executionTargetDomains).values({ organizationId, hostname, verificationToken: randomBytes(24).toString("hex") }).returning();
    return row;
  });
}

export async function requireVerifiedTarget(organizationId: string, value: string) {
  const hostname = normalizeTargetHostname(value);
  const row = await db.query.executionTargetDomains.findFirst({ where: and(
    eq(executionTargetDomains.organizationId, organizationId), eq(executionTargetDomains.hostname, hostname),
  ) });
  if (!row?.verifiedAt) throw new TargetDomainError("An organization-verified execution target is required", 400);
  return verifyRegisteredTarget(organizationId, row.id);
}

export async function verifyRegisteredTarget(organizationId: string, id: string) {
  const row = await db.query.executionTargetDomains.findFirst({ where: and(
    eq(executionTargetDomains.id, id), eq(executionTargetDomains.organizationId, organizationId),
  ) });
  if (!row) throw new TargetDomainError("Execution target not found", 404);
  const ownedRow = and(eq(executionTargetDomains.id, row.id), eq(executionTargetDomains.organizationId, organizationId), eq(executionTargetDomains.verificationToken, row.verificationToken));
  try {
    await verifyTargetDns(row.hostname, row.verificationToken);
  } catch (error) {
    // A resolver timeout says nothing about ownership; keep the stored state.
    if (error instanceof TargetDnsUnavailableError) throw new TargetDomainError("DNS verification is temporarily unavailable; retry shortly", 503);
    await db.update(executionTargetDomains).set({ verifiedAt: null, verifiedUntil: null }).where(ownedRow);
    throw new TargetDomainError("DNS ownership or public address verification failed", 400);
  }
  const now = new Date();
  const [verified] = await db.update(executionTargetDomains)
    .set({ verifiedAt: now, verifiedUntil: new Date(now.getTime() + 86400000) })
    .where(ownedRow).returning();
  if (!verified) throw new TargetDomainError("Execution target changed during verification; retry", 409);
  return verified;
}
