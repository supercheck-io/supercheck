import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { USER_PERSONAS } from "@/db/schema/project-setup";
import { checkSetupPersonaRateLimit, checkSetupReadRateLimit } from "@/lib/sre/sre-rate-limiter";
import { rateLimitResponse, readJsonBody, rejectBearer, sessionUserId } from "@/lib/setup/route-guard";
import { getUserPreferences, setUserPersona } from "@/lib/setup/setup-state";
import { requireSessionSameOrigin } from "@/lib/security/same-origin";

const bodySchema = z.object({ persona: z.enum(USER_PERSONAS).nullable() }).strict();

export async function GET(request: NextRequest) {
  try {
    const bearer = rejectBearer(request);
    if (bearer) return bearer;
    const userId = await sessionUserId();
    if (userId instanceof NextResponse) return userId;
    const limited = rateLimitResponse(await checkSetupReadRateLimit(userId));
    if (limited) return limited;
    return NextResponse.json(await getUserPreferences(userId));
  } catch (error) {
    console.error("Error reading user preferences:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Own row only: the user id comes from the session, never from the body. */
export async function PUT(request: NextRequest) {
  try {
    const bearer = rejectBearer(request);
    if (bearer) return bearer;
    const originError = requireSessionSameOrigin(request);
    if (originError) return originError;
    const userId = await sessionUserId();
    if (userId instanceof NextResponse) return userId;
    const limited = rateLimitResponse(await checkSetupPersonaRateLimit(userId));
    if (limited) return limited;
    const raw = await readJsonBody(request);
    if (raw instanceof NextResponse) return raw;
    const parsed = bodySchema.safeParse(raw.body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid persona" }, { status: 400 });
    return NextResponse.json(await setUserPersona(userId, parsed.data.persona));
  } catch (error) {
    console.error("Error saving user preferences:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
