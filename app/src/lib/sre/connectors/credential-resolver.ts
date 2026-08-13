import { and, desc, eq } from "drizzle-orm";

import {
  externalConnectorCredentials,
  externalConnectors,
} from "@/db/schema";
import { db } from "@/utils/db";
import {
  decryptConnectorCredential,
  type ConnectorCredentialValue,
} from "./credential-vault";

export type ConnectorCredentialResolution = {
  provider: "encrypted_database";
  value: ConnectorCredentialValue;
  expiresAt: Date | null;
};

export async function resolveConnectorCredential(input: {
  connectorId: string;
  organizationId: string;
  projectId: string;
}): Promise<ConnectorCredentialResolution | null> {
  const [row] = await db
    .select({
      encryptedCredential: externalConnectorCredentials.encryptedCredential,
      expiresAt: externalConnectorCredentials.expiresAt,
    })
    .from(externalConnectorCredentials)
    .innerJoin(
      externalConnectors,
      eq(externalConnectorCredentials.connectorId, externalConnectors.id),
    )
    .where(and(
      eq(externalConnectors.id, input.connectorId),
      eq(externalConnectors.organizationId, input.organizationId),
      eq(externalConnectors.projectId, input.projectId),
    ))
    .orderBy(desc(externalConnectorCredentials.updatedAt))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    throw new Error("Connector credential has expired; rotate it before running an investigation");
  }

  return {
    provider: "encrypted_database",
    value: decryptConnectorCredential(row.encryptedCredential, input),
    expiresAt: row.expiresAt,
  };
}
