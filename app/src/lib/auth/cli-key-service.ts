import crypto from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { apikey } from "@/db/schema";
import {
  generateCliToken,
  getApiKeyPrefix,
  hashApiKey,
} from "@/lib/security/api-key-hash";

export const MAX_CLI_TOKENS_PER_PROJECT = 20;

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface IssueCliKeyInput {
  userId: string;
  organizationId: string;
  projectId: string;
  name: string;
  /** Seconds until expiry; omit/0 for a non-expiring key (dashboard default). */
  expiresInSeconds?: number | null;
}

export type IssueCliKeyResult =
  | {
      ok: true;
      key: {
        id: string;
        name: string;
        start: string;
        /** Plaintext. Return once; only the hash is persisted. */
        plaintext: string;
        expiresAt: Date | null;
        createdAt: Date;
      };
    }
  | { ok: false; reason: "limit_reached" | "name_conflict" };

/**
 * Serialises CLI-key issuance per project for the rest of the transaction.
 * Dashboard and device-flow issuance both go through here so the count and
 * name checks plus the insert cannot interleave across requests.
 */
async function lockProjectForKeyIssuance(
  tx: DbTransaction,
  projectId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`cli-key:${projectId}`}, 0))`,
  );
}

/**
 * Issues a project-scoped `sck_live_*` CLI key. Must run inside the caller's
 * transaction so related state (e.g. consuming a device grant) commits or rolls
 * back together with the key.
 */
export async function issueCliApiKey(
  tx: DbTransaction,
  input: IssueCliKeyInput,
): Promise<IssueCliKeyResult> {
  await lockProjectForKeyIssuance(tx, input.projectId);

  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(apikey)
    .where(and(eq(apikey.projectId, input.projectId), isNull(apikey.jobId)));
  if (count >= MAX_CLI_TOKENS_PER_PROJECT) {
    return { ok: false, reason: "limit_reached" };
  }

  const [existing] = await tx
    .select({ id: apikey.id })
    .from(apikey)
    .where(
      and(
        eq(apikey.projectId, input.projectId),
        isNull(apikey.jobId),
        eq(apikey.name, input.name),
      ),
    )
    .limit(1);
  if (existing) return { ok: false, reason: "name_conflict" };

  const plaintext = generateCliToken(false); // sck_live_*
  const start = getApiKeyPrefix(plaintext);
  const now = new Date();
  const expiresAt =
    input.expiresInSeconds && input.expiresInSeconds > 0
      ? new Date(now.getTime() + input.expiresInSeconds * 1000)
      : null;
  const id = crypto.randomUUID();

  await tx.insert(apikey).values({
    id,
    configId: "default",
    name: input.name,
    start,
    prefix: "cli",
    key: hashApiKey(plaintext),
    referenceId: input.userId,
    projectId: input.projectId,
    jobId: null, // CLI tokens are not job-scoped
    enabled: true,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    permissions: ["cli:full"],
    metadata: {
      tokenType: "cli_live",
      organizationId: input.organizationId,
    },
  });

  return {
    ok: true,
    key: { id, name: input.name, start, plaintext, expiresAt, createdAt: now },
  };
}

/** Convenience wrapper for callers that have no surrounding transaction. */
export function issueCliApiKeyAtomically(
  input: IssueCliKeyInput,
): Promise<IssueCliKeyResult> {
  return db.transaction((tx) => issueCliApiKey(tx, input));
}
