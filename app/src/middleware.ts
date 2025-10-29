import { NextRequest, NextResponse } from "next/server";

/**
 * Lightweight middleware for status page subdomain and custom domain routing
 *
 * Responsibility: ONLY domain detection and URL rewriting
 * - Detects UUID subdomains (e.g., f134b5f9f2b048069deaf7cfb924a0b3.supercheck.io)
 * - Detects custom domains (e.g., status.acmecorp.com)
 * - Rewrites to /status/[subdomain] for status page routes
 * - All authentication is handled by layout/route handlers
 *
 * Why this approach?
 * - Middleware stays fast and focused (one job: subdomain/custom domain routing)
 * - Auth logic in layout follows Next.js best practices
 * - Avoids middleware-induced redirect loops
 * - Database lookup for custom domains happens in route handler (not middleware)
 */

// Extract subdomain from hostname (production only: uuid.supercheck.io)
function extractSubdomain(hostname: string): string | null {
  if (!hostname || typeof hostname !== "string") {
    return null;
  }

  // Remove port from hostname
  const cleanHostname = hostname.split(":")[0];

  // Get status page domain from runtime env (NOT NEXT_PUBLIC_ - those are build-time only)
  // Use regular env var which is available at runtime in middleware
  const statusPageDomain = process.env.STATUS_PAGE_DOMAIN || "";

  if (!statusPageDomain || !cleanHostname.endsWith(statusPageDomain)) {
    return null;
  }

  // Extract subdomain by removing the status page domain
  // e.g., "f134b5f9f2b048069deaf7cfb924a0b3.supercheck.io" → "f134b5f9f2b048069deaf7cfb924a0b3"
  const subdomain = cleanHostname.replace(
    new RegExp(`\\.${statusPageDomain}$`),
    ""
  );

  // Valid subdomain: alphanumeric and hyphens only, 1-63 chars
  return /^[a-zA-Z0-9-]{1,63}$/.test(subdomain) ? subdomain : null;
}

// Check if hostname is a custom domain (not the main app domain)
function isCustomDomain(hostname: string, appHostname: string): boolean {
  if (!hostname || !appHostname) {
    return false;
  }

  // Remove port
  const cleanHostname = hostname.split(":")[0];

  // Not custom if it matches main app or is localhost
  if (
    cleanHostname === appHostname ||
    cleanHostname.startsWith("localhost") ||
    cleanHostname === "127.0.0.1"
  ) {
    return false;
  }

  // Custom domains are valid if they don't end with the status page domain
  const statusPageDomain = process.env.STATUS_PAGE_DOMAIN || "";
  return !cleanHostname.endsWith(`.${statusPageDomain}`) &&
         !cleanHostname.endsWith(statusPageDomain);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API routes and internal Next.js routes should never be rewritten
  // These are shared functionality accessed from any domain
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Get hostname from headers (prefer X-Forwarded-Host for proxied requests)
  const hostname =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "";

  // Get main app hostname from runtime env (NOT NEXT_PUBLIC_ - those are build-time only)
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  let mainAppHostname: string | null = null;
  try {
    const url = new URL(appUrl);
    mainAppHostname = url.hostname;
  } catch {
    // Invalid URL, skip check
    mainAppHostname = null;
  }

  // Check if this is the main app domain
  const isMainApp =
    mainAppHostname &&
    (hostname === mainAppHostname || hostname.startsWith("localhost"));

  if (isMainApp) {
    // Main app domain, pass through to normal app routing
    return NextResponse.next();
  }

  // Try UUID subdomain routing first
  const subdomain = extractSubdomain(hostname);
  if (subdomain) {
    const url = request.nextUrl.clone();

    if (pathname === "/") {
      url.pathname = `/status/${subdomain}`;
      const response = NextResponse.rewrite(url);
      addSecurityHeaders(response);
      return response;
    }

    if (pathname.startsWith(`/status/${subdomain}`)) {
      const response = NextResponse.next();
      addSecurityHeaders(response);
      return response;
    }

    url.pathname = `/status/${subdomain}${pathname}`;
    const response = NextResponse.rewrite(url);
    addSecurityHeaders(response);
    return response;
  }

  // Try custom domain routing
  // Custom domains will be validated against database in the route handler
  if (mainAppHostname && isCustomDomain(hostname, mainAppHostname)) {
    const url = request.nextUrl.clone();
    if (pathname === "/") {
      url.pathname = `/status/_custom/${hostname}`;
      const response = NextResponse.rewrite(url);
      addSecurityHeaders(response);
      return response;
    }

    if (pathname.startsWith(`/status/_custom/${hostname}`)) {
      const response = NextResponse.next();
      addSecurityHeaders(response);
      return response;
    }

    url.pathname = `/status/_custom/${hostname}${pathname}`;
    const response = NextResponse.rewrite(url);
    addSecurityHeaders(response);
    return response;
  }

  // Pass through all other requests - auth is handled by layout/route handlers
  return NextResponse.next();
}

/**
 * Add security headers for status pages
 */
function addSecurityHeaders(response: NextResponse): void {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set(
    "Referrer-Policy",
    "strict-origin-when-cross-origin"
  );
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
