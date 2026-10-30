import { APIError, getSessionFromCtx } from "better-auth/api";
import { avatarVersionOf } from "@/lib/user-avatar-path";
import { isAvatarPreset } from "@/lib/avatar-presets";
import type { AuthHookContext } from "./login-lockout-hooks";

/**
 * Server-side rules for Better Auth's /update-user and /sign-up/email, which browsers call directly:
 * no profile edits while impersonating, and `image` may only be cleared, kept, or set
 * to a preset or the user's own uploaded avatar (any other URL would be loaded by every viewer).
 */
export async function guardProfileUpdate(ctx: AuthHookContext) {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  // Sign-up has no uploaded avatar yet, so an email sign-up may not set one at all.
  if (ctx.path === "/sign-up/email") {
    if (body.image !== undefined && body.image !== null) {
      throw new APIError("BAD_REQUEST", { message: "Upload a photo from your account settings" });
    }
    return;
  }
  if (ctx.path !== "/update-user") return;
  const changesName = body.name !== undefined;
  const changesImage = body.image !== undefined;
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
      isAvatarPreset(image) ||
      (typeof image === "string" && avatarVersionOf(session.user.id, image) !== null);
    if (!allowed) {
      throw new APIError("BAD_REQUEST", { message: "Upload a photo from your account settings" });
    }
  }
}
