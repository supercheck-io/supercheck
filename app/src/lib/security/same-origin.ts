import { NextRequest, NextResponse } from "next/server";

function parseOrigin(value: string | null | undefined) {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function configuredRequestOrigins(request: NextRequest) {
  return new Set(
    [
      request.nextUrl.origin,
      parseOrigin(process.env.APP_URL),
      parseOrigin(process.env.NEXT_PUBLIC_APP_URL),
      parseOrigin(process.env.BETTER_AUTH_URL),
    ].filter((origin): origin is string => Boolean(origin))
  );
}

export function requireSameOriginRequest(
  request: NextRequest,
  options: { allowMissing?: boolean; errorMessage?: string } = {}
) {
  const origin = parseOrigin(request.headers.get("origin"));
  const refererOrigin = parseOrigin(request.headers.get("referer"));
  const requestOrigin = origin ?? refererOrigin;

  if (!requestOrigin && options.allowMissing) return null;

  if (requestOrigin && configuredRequestOrigins(request).has(requestOrigin)) {
    return null;
  }

  return NextResponse.json(
    { error: options.errorMessage ?? "Cross-origin request is not allowed" },
    { status: 403 }
  );
}
