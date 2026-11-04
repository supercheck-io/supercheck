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
    throw new Error("The MCP endpoint URL is not stored. Rotate the connector credential to save it again.");
  }

  try {
    const encrypted = encryptConnectorCredential(withMcpEndpoint(blob, stored), context);
    await db.transaction(async (tx) => {
      if (credentialRow) {
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
        await tx.insert(externalConnectorCredentials).values({
          connectorId: row.id,
          credentialType: "api_key",
          ...encrypted,
          lastRotatedAt: new Date(),
        });
      }
      await tx
        .update(externalConnectors)
        .set({ config: { ...row.config, endpointUrl: redactEndpointQuery(stored) }, updatedAt: new Date() })
        .where(and(eq(externalConnectors.id, row.id), sql`${externalConnectors.config}->>'endpointUrl' = ${stored}`));
    });
  } catch (error) {
    // The URL still works from config; the move is retried on the next use.
    console.error("Could not encrypt a stored MCP endpoint URL:", error instanceof Error ? error.message : error);
  }
  return stored;
}
