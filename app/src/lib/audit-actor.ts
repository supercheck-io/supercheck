import { headers } from "next/headers";
import { getCachedAuthSession } from "./session-cache";

export async function getAuditActor(userId?: string) {
  if (!userId) return {};
  try {
    if (!(await headers()).get("cookie")) return { actorUserId: userId };
    const current = await getCachedAuthSession();
    if (current?.user.id === userId && current.session.impersonatedBy) {
      return { actorUserId: current.session.impersonatedBy, impersonatedBy: current.session.impersonatedBy };
    }
  } catch {
    // Background events have no request session.
  }
  return { actorUserId: userId };
}
