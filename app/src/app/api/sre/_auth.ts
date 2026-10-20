import { NextRequest, NextResponse } from "next/server";

import { isAuthError, requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireSameOriginRequest } from "@/lib/security/same-origin";
import { subscriptionService, SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";

/** Call after authentication and RBAC, before starting billable SRE work. */
export async function requireSreSubscription(organizationId: string): Promise<NextResponse | null> {
  try {
    await subscriptionService.blockUntilSubscribed(organizationId);
    await subscriptionService.requireValidPolarCustomer(organizationId);
    return null;
  } catch (error) {
    if (error instanceof SubscriptionAccessDeniedError) {
      return NextResponse.json({ error: error.message, code: error.reason }, { status: 402 });
    }
    return NextResponse.json(
      { error: "Unable to verify SRE subscription. Please try again shortly." },
      { status: 503 },
    );
  }
}

type SreApiPermission = {
  resource: Parameters<typeof checkPermissionWithContext>[0];
  action: string;
};

type SreApiAuthResult =
  | {
      success: true;
      context: Awaited<ReturnType<typeof requireAuthContext>>;
    }
  | {
      success: false;
      response: NextResponse;
    };

function authErrorResponse(error: unknown) {
  return NextResponse.json(
    { error: isAuthError(error) ? "Authentication required" : "Unable to authorize SRE API request" },
    { status: isAuthError(error) ? 401 : 500 },
  );
}

export function requireSreSameOriginRequest(request: NextRequest) {
  // Non-browser API clients may omit both headers. Browser cross-site POSTs send
  // Origin in modern engines, so reject only explicit mismatches here.
  return requireSameOriginRequest(request, {
    allowMissing: true,
    errorMessage: "Cross-origin SRE API requests are not allowed",
  });
}

export async function requireSreApiPermissions(
  permissions: SreApiPermission[],
): Promise<SreApiAuthResult> {
  let context: Awaited<ReturnType<typeof requireAuthContext>>;
  try {
    context = await requireAuthContext();
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
