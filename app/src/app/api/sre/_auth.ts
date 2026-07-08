import { NextRequest, NextResponse } from "next/server";

import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";

type SreApiPermission = {
  resource: Parameters<typeof checkPermissionWithContext>[0];
  action: string;
};

type SreApiAuthResult =
  | {
      success: true;
      context: Awaited<ReturnType<typeof requireProjectContext>>;
    }
  | {
      success: false;
      response: NextResponse;
    };

function authErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Authentication required";
  return NextResponse.json({ error: message }, { status: 401 });
}

function parseOrigin(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function configuredSreRequestOrigins(request: NextRequest) {
  return new Set(
    [
      request.nextUrl.origin,
      parseOrigin(process.env.APP_URL),
      parseOrigin(process.env.NEXT_PUBLIC_APP_URL),
      parseOrigin(process.env.BETTER_AUTH_URL),
    ].filter((origin): origin is string => Boolean(origin))
  );
}

export function requireSreSameOriginRequest(request: NextRequest) {
  const origin = parseOrigin(request.headers.get("origin"));
  const refererOrigin = parseOrigin(request.headers.get("referer"));
  const requestOrigin = origin ?? refererOrigin;

  // Non-browser API clients may omit both headers. Browser cross-site POSTs send
  // Origin in modern engines, so reject only explicit mismatches here.
  if (!requestOrigin) {
    return null;
  }

  if (configuredSreRequestOrigins(request).has(requestOrigin)) {
    return null;
  }

  return NextResponse.json(
    { error: "Cross-origin SRE API requests are not allowed" },
    { status: 403 }
  );
}

export async function requireSreApiPermissions(
  permissions: SreApiPermission[],
): Promise<SreApiAuthResult> {
  let context: Awaited<ReturnType<typeof requireProjectContext>>;
  try {
    context = await requireProjectContext();
  } catch (error) {
    return { success: false, response: authErrorResponse(error) };
  }

  const deniedPermission = permissions.find(
    (permission) =>
      !checkPermissionWithContext(permission.resource, permission.action, {
        userId: context.userId,
        organizationId: context.organizationId,
        project: context.project,
      }),
  );

  if (deniedPermission) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Insufficient permissions for SRE API request" },
        { status: 403 },
      ),
    };
  }

  return { success: true, context };
}
