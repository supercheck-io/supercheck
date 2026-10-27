import { APIError, getSessionFromCtx } from "better-auth/api";
import { avatarVersionOf } from "@/lib/user-avatar";
import type { AuthHookContext } from "./login-lockout-hooks";

/**
 * Server-side rules for Better Auth's /update-user, which browsers can call directly:
 * no profile edits while impersonating, and `image` may only be cleared, kept, or set
 * to the user's own uploaded avatar (any other URL would be loaded by every viewer).
 */
export async function guardProfileUpdate(ctx: AuthHookContext) {
  if (ctx.path !== "/update-user") return;
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const changesName = "name" in body;
  const changesImage = "image" in body;
  if (!changesName && !changesImage) return;

  const session = await getSessionFromCtx(ctx);
  if (!session) return; // The endpoint itself answers 401.

  if (session.session.impersonatedBy) {
    throw new APIError("FORBIDDEN", { message: "Not allowed while impersonating" });
  }
  if (changesImage) {
    const image = body.image;
    const allowed =
      image === null ||
      image === session.user.image ||
      (typeof image === "string" && avatarVersionOf(session.user.id, image) !== null);
    if (!allowed) {
      throw new APIError("BAD_REQUEST", { message: "Upload a photo from your account settings" });
    }
  }
}
