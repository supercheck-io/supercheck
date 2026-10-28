import { inArray } from "drizzle-orm";
import { user } from "@/db/schema";
import { db } from "@/utils/db";

export type Creator = { createdByName: string | null; createdByImage: string | null };

/** One query for every row's creator, keyed by user id. Lists call this instead of joining user into their own query. */
export async function loadCreators(userIds: Array<string | null | undefined>): Promise<(userId: string | null | undefined) => Creator> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  const rows = ids.length
    ? await db.select({ id: user.id, name: user.name, image: user.image }).from(user).where(inArray(user.id, ids))
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  return (userId) => {
    const row = userId ? byId.get(userId) : undefined;
    return { createdByName: row?.name ?? null, createdByImage: row?.image ?? null };
  };
}
