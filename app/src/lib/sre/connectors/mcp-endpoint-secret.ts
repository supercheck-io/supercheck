import { and, desc, eq, sql } from "drizzle-orm";

import { externalConnectorCredentials, externalConnectors } from "@/db/schema";
import { db } from "@/utils/db";
import {
  decryptConnectorCredential,
  encryptConnectorCredential,
  type ConnectorCredentialValue,
} from "./credential-vault";
import { redactEndpointQuery } from "./endpoint-policy";

type ConnectorRow = typeof externalConnectors.$inferSelect;

/**
 * An MCP endpoint URL may carry its key in the query string. The full URL lives only in the encrypted
 * credential blob under this field; config.endpointUrl keeps the redacted form for display and host checks.
 */
export const MCP_ENDPOINT_FIELD = "endpointUrl";

/** The stored MCP endpoint is redacted and no credential holds the full URL: the admin must enter it again. */
export class McpEndpointMissingError extends Error {
  constructor() {
    super("The MCP endpoint URL (including its key) is not stored. Enter the full endpoint URL to continue.");
    this.name = "McpEndpointMissingError";
  }
}

export function urlHasQuery(url: string): boolean {
  try {
    return new URL(url).search !== "";
  } catch {
    return false;
  }
}

export function withMcpEndpoint(value: ConnectorCredentialValue | undefined, endpointUrl: string): ConnectorCredentialValue {
  return { ...(value ?? {}), [MCP_ENDPOINT_FIELD]: endpointUrl };
}

/**
 * The full endpoint URL a rotation must carry over, read through the caller's transaction (which already
 * holds the connector row lock) so it cannot deadlock with the lazy migration in resolveMcpEndpointUrl.
 */
export async function readCarriedMcpEndpoint(
  tx: Pick<typeof db, "select">,
  row: ConnectorRow,
): Promise<string> {
  const stored = row.config?.endpointUrl as string;
  const [credentialRow] = await tx
    .select()
    .from(externalConnectorCredentials)
    .where(eq(externalConnectorCredentials.connectorId, row.id))
    .orderBy(desc(externalConnectorCredentials.updatedAt))
    .limit(1);
  const blob = credentialRow
    ? decryptConnectorCredential(credentialRow.encryptedCredential, {
        organizationId: row.organizationId,
        projectId: row.projectId,
        connectorId: row.id,
      })
    : undefined;
  const secret = blob?.[MCP_ENDPOINT_FIELD];
  if (typeof secret === "string") return secret;
  if (stored === redactEndpointQuery(stored)) throw new McpEndpointMissingError();
  return stored;
}

/**
 * The URL to dial. Rows saved before the URL was encrypted still hold it in config; they keep working and
 * are moved into the credential blob (and redacted in config) the first time they are used.
 */
export async function resolveMcpEndpointUrl(row: ConnectorRow): Promise<string | null> {
  const stored = typeof row.config?.endpointUrl === "string" ? row.config.endpointUrl : null;
  if (!stored || !urlHasQuery(stored)) return stored;

  const context = { organizationId: row.organizationId, projectId: row.projectId, connectorId: row.id };
  const [credentialRow] = await db
    .select()
    .from(externalConnectorCredentials)
    .where(eq(externalConnectorCredentials.connectorId, row.id))
    .orderBy(desc(externalConnectorCredentials.updatedAt))
    .limit(1);
  const blob = credentialRow ? decryptConnectorCredential(credentialRow.encryptedCredential, context) : undefined;
  const secret = blob?.[MCP_ENDPOINT_FIELD];
  if (typeof secret === "string") return secret;

  if (stored === redactEndpointQuery(stored)) {
    throw new McpEndpointMissingError();
  }

  let configChanged = false;
  try {
    const encrypted = encryptConnectorCredential(withMcpEndpoint(blob, stored), context);
    await db.transaction(async (tx) => {
      // Lock the connector row first, then the credential row: the order credential rotation uses.
      const [lockedConnector] = await tx
        .select({ id: externalConnectors.id, config: externalConnectors.config })
        .from(externalConnectors)
        .where(and(eq(externalConnectors.id, row.id), sql`${externalConnectors.config}->>'endpointUrl' = ${stored}`))
        .for("update");
      if (!lockedConnector) {
        configChanged = true;
        return;
      }
      if (credentialRow) {
        // A rotate that committed since the read replaced or removed the row, so this stale rewrite is skipped.
        const [current] = await tx
          .select({ id: externalConnectorCredentials.id, updatedAt: externalConnectorCredentials.updatedAt })
          .from(externalConnectorCredentials)
          .where(eq(externalConnectorCredentials.id, credentialRow.id))
          .for("update");
        if (!current || current.updatedAt.getTime() !== credentialRow.updatedAt.getTime()) return;
        await tx
          .update(externalConnectorCredentials)
          .set({
            encryptedCredential: encrypted.encryptedCredential,
            encryptionVersion: encrypted.encryptionVersion,
            encryptionKeyContext: encrypted.encryptionKeyContext,
            updatedAt: new Date(),
          })
          .where(eq(externalConnectorCredentials.id, credentialRow.id));
      } else {
        const [existing] = await tx
          .select({ id: externalConnectorCredentials.id })
          .from(externalConnectorCredentials)
          .where(eq(externalConnectorCredentials.connectorId, row.id))
          .limit(1);
        if (existing) return;
        await tx.insert(externalConnectorCredentials).values({
          connectorId: row.id,
          credentialType: "api_key",
          ...encrypted,
          lastRotatedAt: new Date(),
        });
      }
      await tx
        .update(externalConnectors)
        .set({ config: { ...lockedConnector.config, endpointUrl: redactEndpointQuery(stored) }, updatedAt: new Date() })
        .where(and(eq(externalConnectors.id, row.id), sql`${externalConnectors.config}->>'endpointUrl' = ${stored}`));
    });
  } catch (error) {
    // Never log the message: database errors echo bound parameters, which hold the plaintext URL.
    const code = (error as { code?: unknown } | null)?.code;
    console.error("Could not encrypt a stored MCP endpoint URL", {
      name: error instanceof Error ? error.name : typeof error,
      code: typeof code === "string" ? code : undefined,
    });
  }
  if (configChanged) {
    // The endpoint changed since the read (e.g. a rotation moved it into the credential): `stored` is stale.
    const [fresh] = await db.select().from(externalConnectors).where(eq(externalConnectors.id, row.id)).limit(1);
    if (!fresh) throw new McpEndpointMissingError();
    return resolveMcpEndpointUrl(fresh);
  }
  return stored;
}
