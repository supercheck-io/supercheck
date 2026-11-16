import "server-only";

import { and, eq, isNull, like, or, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db } from "@/utils/db";
import { notificationProviders } from "@/db/schema/notification";
import { externalConnectorCredentials, externalConnectors, privateAgents } from "@/db/schema/sre";
import { decryptNotificationProviderConfig, encryptNotificationProviderConfig } from "@/lib/notification-providers/crypto";
import { normalizeProviderConfig, validateProviderConfig } from "@/lib/notification-providers/validation";
import type { NotificationProviderType, PlainNotificationProviderConfig } from "@/db/schema";
import {
  assertEndpointAllowedForExecution,
  connectorCredentialRequirementError,
  connectorRequiresCredentials,
  isPrivateAgentConnectorType,
  type SreConnectorType,
} from "@/lib/sre/connectors";
import { decryptConnectorCredential, encryptConnectorCredential, type ConnectorCredentialValue } from "@/lib/sre/connectors/credential-vault";
import { providerEndpointRequirementError } from "@/lib/sre/connectors/providers/provider-credentials";

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

/**
 * Serializes concurrent copies into one target project: neither table has a unique key on name. The key leaves the name
 * out so copies of "X" and "X (copied)" cannot both pick the same suffixed name. Transaction-scoped.
 */
const lockAdoptionKey = (tx: Pick<typeof db, "execute">, kind: string, scope: CopyScope, source: { type: string }) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify([kind, scope.organizationId, scope.targetProjectId, source.type])}))`);

/** Column widths: connectors varchar(100), providers varchar(255). */
const CONNECTOR_NAME_MAX = 100;
const PROVIDER_NAME_MAX = 255;
/** Room for " (copied 9999999999)" when searching for suffixed names of a truncated base. */
const SUFFIX_ROOM = 20;

/** Key-order independent text of a value, for comparing two decrypted configs. Never logged or returned. */
const canon = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  );

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/**
 * Picks where a copy goes in the target: a target item with the same name is adopted only when `same` says it holds
 * the same settings. Otherwise the copy takes the first free "<name> (copied)", "<name> (copied 2)", ... name.
 */
async function resolveTarget<Row extends { name: string }>(
  rows: Row[],
  baseName: string,
  maxLength: number,
  same: (row: Row) => Promise<boolean>,
): Promise<{ adopt: Row } | { name: string }> {
  for (let i = 0; ; i++) {
    const suffix = i === 0 ? "" : i === 1 ? " (copied)" : ` (copied ${i})`;
    const name = baseName.slice(0, maxLength - suffix.length) + suffix;
    const row = rows.find((r) => r.name === name);
    if (!row) return { name };
    if (await same(row)) return { adopt: row };
  }
}

// The base is cut to fit the column, so match on its leading part; resolveTarget compares exact names.
const sameNameFilter = (column: typeof notificationProviders.name | typeof externalConnectors.name, name: string, maxLength: number) =>
  or(eq(column, name), like(column, `${escapeLike(name.slice(0, maxLength - SUFFIX_ROOM))}%(copied%`));

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
          const plain = decryptNotificationProviderConfig(source.config, sourceProjectId);
          const candidates = await tx
            .select()
            .from(notificationProviders)
            .where(
              and(
                eq(notificationProviders.organizationId, organizationId),
                eq(notificationProviders.projectId, targetProjectId),
                eq(notificationProviders.type, source.type),
                sameNameFilter(notificationProviders.name, source.name, PROVIDER_NAME_MAX),
              ),
            );
          // Compared in the form it is written in, so an un-normalized source adopts its earlier copy.
          let written: unknown = plain;
          try {
            written = normalizeProviderConfig(source.type as NotificationProviderType, plain as Record<string, unknown>);
          } catch {
            // An invalid config is rejected below if nothing matches.
          }
          const target = await resolveTarget(candidates, source.name, PROVIDER_NAME_MAX, async (row) => {
            // A disabled channel never sends, so an enabled source is not "already there" when the match is disabled.
            if (source.isEnabled && !row.isEnabled) return false;
            try {
              return canon(decryptNotificationProviderConfig(row.config, targetProjectId)) === canon(written);
            } catch {
              return false;
            }
          });
          if ("adopt" in target) return { id: target.adopt.id, status: "adopted" as const, name: target.adopt.name, type: source.type };
          // The same checks as creating a channel by hand (the message may echo input, so only a fixed reason is returned).
          try {
            validateProviderConfig(source.type as NotificationProviderType, plain as Record<string, unknown>);
          } catch {
            throw new CopyItemError("This channel's settings no longer pass validation");
          }
          const config = encryptNotificationProviderConfig(
            written as PlainNotificationProviderConfig,
            targetProjectId,
          );
          const [created] = await tx
            .insert(notificationProviders)
            .values({
              name: target.name,
              type: source.type,
              config,
              isEnabled: source.isEnabled,
              organizationId,
              projectId: targetProjectId,
              createdByUserId: userId,
            })
            .returning({ id: notificationProviders.id });
          return { id: created.id, status: "copied" as const, name: target.name, type: source.type };
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
          const [credential] = await tx
            .select()
            .from(externalConnectorCredentials)
            .where(eq(externalConnectorCredentials.connectorId, source.id))
            .limit(1);
          const plain = credential
            ? decryptConnectorCredential(credential.encryptedCredential, { organizationId, projectId: sourceProjectId, connectorId: source.id })
            : null;
          const candidates = await tx
            .select()
            .from(externalConnectors)
            .where(
              and(
                eq(externalConnectors.organizationId, organizationId),
                eq(externalConnectors.projectId, targetProjectId),
                eq(externalConnectors.type, source.type),
                sameNameFilter(externalConnectors.name, source.name, CONNECTOR_NAME_MAX),
              ),
            );
          const target = await resolveTarget(candidates, source.name, CONNECTOR_NAME_MAX, async (row) => {
            // A disabled connector is never queried, and a copy is never created disabled.
            if (row.status === "disabled") return false;
            if (canon(row.config) !== canon(source.config) || row.privateAgentId !== source.privateAgentId) return false;
            const [rowCredential] = await tx.select().from(externalConnectorCredentials).where(eq(externalConnectorCredentials.connectorId, row.id)).limit(1);
            if (!rowCredential || !plain) return !rowCredential && !plain;
            try {
              const rowPlain = decryptConnectorCredential(rowCredential.encryptedCredential, { organizationId, projectId: targetProjectId, connectorId: row.id });
              return rowCredential.credentialType === credential?.credentialType && canon(rowPlain) === canon(plain);
            } catch {
              return false;
            }
          });
          if ("adopt" in target) return { id: target.adopt.id, status: "adopted" as const, name: target.adopt.name, type: source.type };

          // The same checks as creating a connector by hand (createSreConnector).
          const endpointUrl = (source.config as { endpointUrl?: unknown } | null)?.endpointUrl;
          const endpoint = typeof endpointUrl === "string" ? endpointUrl : null;
          if (source.privateAgentId && !isPrivateAgentConnectorType(source.type as SreConnectorType)) {
            throw new CopyItemError("This connector type does not support a Private Agent");
          }
          if (providerEndpointRequirementError(source.type, endpoint) || connectorCredentialRequirementError(source.type, plain as ConnectorCredentialValue | null)) {
            throw new CopyItemError("This connector's settings no longer pass validation");
          }
          try {
            await assertEndpointAllowedForExecution(endpoint, Boolean(source.privateAgentId));
          } catch {
            throw new CopyItemError("This connector's endpoint is not allowed in the target project");
          }
          if (source.privateAgentId) {
            const [agent] = await tx
              .select({ id: privateAgents.id, status: privateAgents.status, supportsSreConnectors: privateAgents.supportsSreConnectors })
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
            if (agent.status === "disabled" || !agent.supportsSreConnectors) throw new CopyItemError("The connector's private agent is unavailable for connectors");
          }

          const newId = uuidv7();
          await tx.insert(externalConnectors).values({
            id: newId,
            organizationId,
            projectId: targetProjectId,
            privateAgentId: source.privateAgentId,
            name: target.name,
            type: source.type,
            config: source.config,
            riskLevel: source.riskLevel,
            permissionLevel: "read",
            sideEffectLevel: "none",
            // Same rule as a newly created connector (not carried over from the source's validated status).
            status: credential || !connectorRequiresCredentials(source.type as SreConnectorType) ? "configured" : "missing_credentials",
            defaultTimeWindowMinutes: source.defaultTimeWindowMinutes,
            outputLimits: source.outputLimits,
            createdByUserId: userId,
          });
          if (credential && plain) {
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
          return { id: newId, status: "copied" as const, name: target.name, type: source.type };
        }),
      ),
    );
    return results;
  }, Promise.resolve([]));
}
