import { NextResponse } from "next/server";

function parseOrigin(value: string | null | undefined) {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function configuredRequestOrigins(request: Request) {
  return new Set(
    [
      new URL(request.url).origin,
      parseOrigin(process.env.APP_URL),
      parseOrigin(process.env.NEXT_PUBLIC_APP_URL),
      parseOrigin(process.env.BETTER_AUTH_URL),
    ].filter((origin): origin is string => Boolean(origin))
  );
}

export function requireSameOriginRequest(
  request: Request,
  options: { allowMissing?: boolean; errorMessage?: string } = {}
) {
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  // Only a request with neither header counts as missing: "Origin: null" (sandboxed frames,
  // no-referrer forms) or an unparseable value is a mismatch, and Origin wins over Referer.
  if (!originHeader && !refererHeader && options.allowMissing) return null;
  const requestOrigin = parseOrigin(originHeader ?? refererHeader);

  if (requestOrigin && configuredRequestOrigins(request).has(requestOrigin)) {
    return null;
  }

  return NextResponse.json(
    { error: options.errorMessage ?? "Cross-origin request is not allowed" },
    { status: 403 }
  );
}

/**
 * Cookie-session writes must come from this app's origin. CLI-token callers send no browser
 * Origin and authenticate independently, so they are exempt. A request with neither Origin nor
 * Referer passes: browsers always send Origin on cross-site writes, and server-side clients send none.
 */
export function requireSessionSameOrigin(request: Request, isCliAuth = false) {
  return isCliAuth ? null : requireSameOriginRequest(request, { allowMissing: true });
}
