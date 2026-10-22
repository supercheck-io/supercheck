import { and, eq, inArray, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { oauthAccessToken, oauthClient, oauthClientAssertion, oauthConsent, oauthRefreshToken, verification } from "@/db/schema";
import { isMcpServerEnabled } from "./config";

const BATCH_SIZE = 500;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function cleanupMcpOAuthRows(): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  await db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext('mcp-oauth-cleanup')) AS locked`);
    if (!lock.locked) return;

    const access = tx.select({ id: oauthAccessToken.id }).from(oauthAccessToken)
      .where(or(lt(oauthAccessToken.expiresAt, now), lt(oauthAccessToken.revoked, cutoff))).limit(BATCH_SIZE);
    await tx.delete(oauthAccessToken).where(inArray(oauthAccessToken.id, access));

    // Retain rotated-token evidence until the replay window and its safety period have passed.
    const refresh = tx.select({ id: oauthRefreshToken.id }).from(oauthRefreshToken).where(and(
      or(lt(oauthRefreshToken.expiresAt, now), lt(oauthRefreshToken.revoked, cutoff), lt(oauthRefreshToken.rotatedAt, cutoff)),
      or(isNull(oauthRefreshToken.rotationReplayExpiresAt), lt(oauthRefreshToken.rotationReplayExpiresAt, now)),
    )).limit(BATCH_SIZE);
    await tx.delete(oauthRefreshToken).where(inArray(oauthRefreshToken.id, refresh));

    const codes = tx.select({ id: verification.id }).from(verification).where(lt(verification.expiresAt, now)).limit(BATCH_SIZE);
    await tx.delete(verification).where(inArray(verification.id, codes));
    const assertions = tx.select({ id: oauthClientAssertion.id }).from(oauthClientAssertion)
      .where(lt(oauthClientAssertion.expiresAt, now)).limit(BATCH_SIZE);
    await tx.delete(oauthClientAssertion).where(inArray(oauthClientAssertion.id, assertions));

    const unusedClient = and(
      notExists(tx.select({ id: oauthConsent.id }).from(oauthConsent).where(eq(oauthConsent.clientId, oauthClient.clientId))),
      notExists(tx.select({ id: oauthRefreshToken.id }).from(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, oauthClient.clientId))),
      notExists(tx.select({ id: oauthAccessToken.id }).from(oauthAccessToken).where(eq(oauthAccessToken.clientId, oauthClient.clientId))),
    );
    // Lock registrations before checking references so a concurrent consent cannot be deleted.
    const clients = await tx.select({ id: oauthClient.id }).from(oauthClient)
      .where(and(isNull(oauthClient.userId), lt(oauthClient.createdAt, cutoff), unusedClient))
      .orderBy(oauthClient.createdAt, oauthClient.id).limit(BATCH_SIZE).for("update", { skipLocked: true });
    if (clients.length) {
      await tx.delete(oauthClient).where(and(
        inArray(oauthClient.id, clients.map((client) => client.id)),
        unusedClient,
      ));
    }
  });
}

let timer: ReturnType<typeof setInterval> | undefined;

export function initializeMcpOAuthCleanup(): void {
  if (!isMcpServerEnabled() || timer) return;
  const run = () => cleanupMcpOAuthRows().catch((error: unknown) => {
    console.error("[MCP] OAuth cleanup failed", error);
  });
  timer = setInterval(run, 5 * 60 * 1000);
  timer.unref();
  void run();
}
