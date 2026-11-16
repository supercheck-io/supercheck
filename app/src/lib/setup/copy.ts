import "server-only";

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db } from "@/utils/db";
import { notificationProviders } from "@/db/schema/notification";
import { externalConnectorCredentials, externalConnectors, privateAgents } from "@/db/schema/sre";
import { decryptNotificationProviderConfig, encryptNotificationProviderConfig } from "@/lib/notification-providers/crypto";
import { decryptConnectorCredential, encryptConnectorCredential } from "@/lib/sre/connectors/credential-vault";

export type CopyStatus = "copied" | "adopted" | "failed";
export type CopyItemResult = { sourceId: string; id?: string; status: CopyStatus; error?: string; name?: string; type?: string };

export type CopyScope = { organizationId: string; sourceProjectId: string; targetProjectId: string; userId: string };

/** Never carries plaintext or a driver message: only a fixed reason reaches the response. */
class CopyItemError extends Error {}

async function runItem(sourceId: string, work: () => Promise<Omit<CopyItemResult, "sourceId">>): Promise<CopyItemResult> {
  try {
    return { sourceId, ...(await work()) };
  } catch (error) {
    console.error("[Setup copy] item failed:", error instanceof CopyItemError ? error.message : "unexpected error");
    return { sourceId, status: "failed", error: error instanceof CopyItemError ? error.message : "Could not copy this item" };
  }
}

/** Ids of every provider / connector in the source project, oldest first, capped like an explicit list. */
export async function listProviderIds(scope: CopyScope): Promise<string[]> {
  const rows = await db
    .select({ id: notificationProviders.id })
    .from(notificationProviders)
    .where(and(eq(notificationProviders.organizationId, scope.organizationId), eq(notificationProviders.projectId, scope.sourceProjectId)))
    .orderBy(notificationProviders.createdAt)
    .limit(10);
  return rows.map((row) => row.id);
}

export async function listConnectorIds(scope: CopyScope): Promise<string[]> {
  const rows = await db
    .select({ id: externalConnectors.id })
    .from(externalConnectors)
    .where(and(eq(externalConnectors.organizationId, scope.organizationId), eq(externalConnectors.projectId, scope.sourceProjectId)))
    .orderBy(externalConnectors.createdAt)
    .limit(10);
  return rows.map((row) => row.id);
}

/** Serializes concurrent copies of the same item into one target project: neither table has a unique key on it. */
const lockAdoptionKey = (tx: Pick<typeof db, "execute">, kind: string, scope: CopyScope, source: { type: string; name: string }) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify([kind, scope.organizationId, scope.targetProjectId, source.type, source.name])}))`);

export function copyProviders(scope: CopyScope, ids: string[]): Promise<CopyItemResult[]> {
  const { organizationId, sourceProjectId, targetProjectId, userId } = scope;
  // Sequential on purpose: each item is its own transaction and the response keeps request order.
  return ids.reduce<Promise<CopyItemResult[]>>(async (acc, sourceId) => {
    const results = await acc;
    results.push(
      await runItem(sourceId, () =>
        db.transaction(async (tx) => {
          const [source] = await tx
            .select()
            .from(notificationProviders)
            .where(
              and(
                eq(notificationProviders.id, sourceId),
                eq(notificationProviders.organizationId, organizationId),
                eq(notificationProviders.projectId, sourceProjectId),
              ),
            )
            .limit(1);
          if (!source) throw new CopyItemError("Provider not found in the source project");
          await lockAdoptionKey(tx, "provider", scope, source);
          const [existing] = await tx
            .select({ id: notificationProviders.id })
            .from(notificationProviders)
            .where(
              and(
                eq(notificationProviders.organizationId, organizationId),
                eq(notificationProviders.projectId, targetProjectId),
                eq(notificationProviders.type, source.type),
                eq(notificationProviders.name, source.name),
              ),
            )
            .limit(1);
          if (existing) return { id: existing.id, status: "adopted" as const, name: source.name, type: source.type };
          const config = encryptNotificationProviderConfig(
            decryptNotificationProviderConfig(source.config, sourceProjectId),
            targetProjectId,
          );
          const [created] = await tx
            .insert(notificationProviders)
            .values({
              name: source.name,
              type: source.type,
              config,
              isEnabled: source.isEnabled,
              organizationId,
              projectId: targetProjectId,
              createdByUserId: userId,
            })
            .returning({ id: notificationProviders.id });
          return { id: created.id, status: "copied" as const, name: source.name, type: source.type };
        }),
      ),
    );
    return results;
  }, Promise.resolve([]));
}

export function copyConnectors(scope: CopyScope, ids: string[]): Promise<CopyItemResult[]> {
  const { organizationId, sourceProjectId, targetProjectId, userId } = scope;
  return ids.reduce<Promise<CopyItemResult[]>>(async (acc, sourceId) => {
    const results = await acc;
    results.push(
      await runItem(sourceId, () =>
        db.transaction(async (tx) => {
          const [source] = await tx
            .select()
            .from(externalConnectors)
            .where(
              and(
                eq(externalConnectors.id, sourceId),
                eq(externalConnectors.organizationId, organizationId),
                eq(externalConnectors.projectId, sourceProjectId),
              ),
            )
            .limit(1);
          if (!source) throw new CopyItemError("Connector not found in the source project");
          await lockAdoptionKey(tx, "connector", scope, source);
          const [existing] = await tx
            .select({ id: externalConnectors.id })
            .from(externalConnectors)
            .where(
              and(
                eq(externalConnectors.organizationId, organizationId),
                eq(externalConnectors.projectId, targetProjectId),
                eq(externalConnectors.type, source.type),
                eq(externalConnectors.name, source.name),
              ),
            )
            .limit(1);
          if (existing) return { id: existing.id, status: "adopted" as const, name: source.name, type: source.type };

          if (source.privateAgentId) {
            const [agent] = await tx
              .select({ id: privateAgents.id })
              .from(privateAgents)
              .where(
                and(
                  eq(privateAgents.id, source.privateAgentId),
                  eq(privateAgents.organizationId, organizationId),
                  or(eq(privateAgents.projectId, targetProjectId), isNull(privateAgents.projectId)),
                ),
              )
              .limit(1);
            if (!agent) throw new CopyItemError("The connector's private agent is not available in the target project");
          }

          const [credential] = await tx
            .select()
            .from(externalConnectorCredentials)
            .where(eq(externalConnectorCredentials.connectorId, source.id))
            .limit(1);
          const newId = uuidv7();
          await tx.insert(externalConnectors).values({
            id: newId,
            organizationId,
            projectId: targetProjectId,
            privateAgentId: source.privateAgentId,
            name: source.name,
            type: source.type,
            config: source.config,
            riskLevel: source.riskLevel,
            permissionLevel: "read",
            sideEffectLevel: "none",
            status: credential ? "configured" : source.status === "missing_credentials" ? "missing_credentials" : "configured",
            defaultTimeWindowMinutes: source.defaultTimeWindowMinutes,
            outputLimits: source.outputLimits,
            createdByUserId: userId,
          });
          if (credential) {
            const plain = decryptConnectorCredential(credential.encryptedCredential, {
              organizationId,
              projectId: sourceProjectId,
              connectorId: source.id,
            });
            const encrypted = encryptConnectorCredential(plain, { organizationId, projectId: targetProjectId, connectorId: newId });
            await tx.insert(externalConnectorCredentials).values({
              connectorId: newId,
              credentialType: credential.credentialType,
              encryptedCredential: encrypted.encryptedCredential,
              encryptionVersion: encrypted.encryptionVersion,
              encryptionKeyContext: encrypted.encryptionKeyContext,
              expiresAt: credential.expiresAt,
              lastRotatedAt: new Date(),
            });
          }
          return { id: newId, status: "copied" as const, name: source.name, type: source.type };
        }),
      ),
    );
    return results;
  }, Promise.resolve([]));
}
