import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/utils/db";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  projects,
} from "@/db/schema";

/**
 * Agent connections for the signed-in user: one per (client, project) consent.
 * "Connected apps" lists them and "Disconnect" ends exactly one.
 */
export interface McpConnection {
  id: string;
  clientId: string;
  clientName: string | null;
  /** Host of a Client ID Metadata Document URL; null for dynamically registered clients. */
  verifiedHost: string | null;
  redirectHosts: string[];
  projectId: string;
  projectName: string | null;
  connectedAt: Date;
  lastActiveAt: Date | null;
}

export class McpConnectionNotFoundError extends Error {
  constructor() {
    super("Connection not found");
    this.name = "McpConnectionNotFoundError";
  }
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/**
 * Client IDs that are URLs are Client ID Metadata Documents, fetched from and
 * therefore controlled by that host. Dynamic registration issues random
 * identifiers, so a client cannot claim a host it does not control.
 */
export function verifiedHostForClientId(clientId: string): string | null {
  if (!clientId.startsWith("https://")) return null;
  return hostOf(clientId);
}

export async function listMcpConnections(userId: string): Promise<McpConnection[]> {
  const rows = await db
    .select({
      id: oauthConsent.id,
      clientId: oauthConsent.clientId,
      clientName: oauthClient.name,
      redirectUris: oauthClient.redirectUris,
      projectId: oauthConsent.referenceId,
      projectName: projects.name,
      connectedAt: oauthConsent.createdAt,
      // mapWith decodes the raw aggregate like a timestamp column; a bare sql<Date>
      // arrives as a "timestamp without time zone" string that Date would read as local time.
      lastActiveAt: sql`(
        SELECT max(${oauthRefreshToken.createdAt}) FROM ${oauthRefreshToken}
        WHERE ${oauthRefreshToken.userId} = ${oauthConsent.userId}
          AND ${oauthRefreshToken.clientId} = ${oauthConsent.clientId}
          AND ${oauthRefreshToken.referenceId} = ${oauthConsent.referenceId}
      )`.mapWith(oauthRefreshToken.createdAt),
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .leftJoin(projects, sql`${projects.id}::text = ${oauthConsent.referenceId}`)
    .where(and(eq(oauthConsent.userId, userId), isNotNull(oauthConsent.referenceId)))
    .orderBy(desc(oauthConsent.createdAt));

  return rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    verifiedHost: verifiedHostForClientId(row.clientId),
    redirectHosts: [
      ...new Set(
        (row.redirectUris ?? []).map(hostOf).filter((host): host is string => host !== null),
      ),
    ],
    projectId: row.projectId as string,
    projectName: row.projectName,
    connectedAt: row.connectedAt,
    lastActiveAt: row.lastActiveAt ?? null,
  }));
}

/**
 * Ends one connection: the consent, its refresh tokens and its access-token rows,
 * in one transaction.
 *
 * Better Auth's own delete-consent endpoint removes only the consent row and
 * leaves refresh tokens usable, so disconnecting must go through here.
 *
 * Refresh tokens are deleted, not flagged revoked. Presenting a revoked token
 * outside its reuse window makes Better Auth treat it as theft and delete every
 * refresh token the client holds for this user, which would also disconnect the
 * client's other projects. A deleted token is simply unknown. Access tokens
 * already issued are JWTs; the MCP server re-checks the consent on every call,
 * which ends them at once.
 */
export async function revokeMcpConnection(input: {
  userId: string;
  consentId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [consent] = await tx
      .select({
        id: oauthConsent.id,
        clientId: oauthConsent.clientId,
        referenceId: oauthConsent.referenceId,
      })
      .from(oauthConsent)
      .where(and(eq(oauthConsent.id, input.consentId), eq(oauthConsent.userId, input.userId)))
      .limit(1)
      .for("update");
    if (!consent) throw new McpConnectionNotFoundError();

    const reference = (column: AnyPgColumn) =>
      consent.referenceId === null ? isNull(column) : eq(column, consent.referenceId);

    // Access tokens reference their refresh token, so remove them first.
    await tx
      .delete(oauthAccessToken)
      .where(
        and(
          eq(oauthAccessToken.userId, input.userId),
          eq(oauthAccessToken.clientId, consent.clientId),
          reference(oauthAccessToken.referenceId),
        ),
      );
    await tx
      .delete(oauthRefreshToken)
      .where(
        and(
          eq(oauthRefreshToken.userId, input.userId),
          eq(oauthRefreshToken.clientId, consent.clientId),
          reference(oauthRefreshToken.referenceId),
        ),
      );
    await tx.delete(oauthConsent).where(eq(oauthConsent.id, consent.id));
  });
}
