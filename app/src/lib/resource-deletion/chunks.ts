import { sql } from "drizzle-orm";

/** Rows per DELETE / values per IN list: keeps statements short and row locks brief. */
export const DB_CHUNK = 500;

/** Fail fast instead of piling up behind a lock or a runaway statement inside a deletion transaction. */
export const DELETION_TX_LIMITS = sql.raw("'5s'");
export const DELETION_TX_STATEMENT_LIMIT = sql.raw("'30s'");

export function chunk<T>(values: T[], size = DB_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

/** Run an IN-list query per chunk of `values` and merge the rows by id, so no statement carries thousands of values. */
export async function selectInChunks<R extends { id: string }>(
  values: string[],
  query: (chunkOfValues: string[]) => Promise<R[]>,
): Promise<R[]> {
  const rows = new Map<string, R>();
  for (const part of chunk(values)) for (const row of await query(part)) rows.set(row.id, row);
  return [...rows.values()];
}
