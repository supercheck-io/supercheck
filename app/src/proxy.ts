import { NextRequest, NextResponse } from "next/server";

/**
 * Lightweight proxy for status page subdomain and custom domain routing
 * (Renamed from middleware to proxy in Next.js 16)
 *
 * Responsibility: ONLY domain detection and URL rewriting
 * - Detects UUID subdomains (e.g., f134b5f9f2b048069deaf7cfb924a0b3.supercheck.io)
 * - Detects custom domains (e.g., status.acmecorp.com)
 * - Rewrites to /status/[subdomain] for status page routes
 * - All authentication is handled by layout/route handlers
 *
 * Why this approach?
 * - Proxy stays fast and focused (one job: subdomain/custom domain routing)
 * - Auth logic in layout follows Next.js best practices
 * - Avoids proxy-induced redirect loops
 * - Database lookup for custom domains happens in route handler (not proxy)
 *
 * Performance considerations:
 * - Avoid database calls in proxy (blocks every request)
 * - Use simple string operations over regex where possible
 * - Cache expensive computations
 *
 * Security considerations:
 * - Validate all user inputs (hostname, pathname)
 * - Add security headers to responses
 * - Rate limiting should be handled at infrastructure level (Cloudflare, ALB, etc.)
 */

// Pre-compile regex patterns for performance
const VALID_SUBDOMAIN_PATTERN = /^[a-zA-Z0-9-]{1,63}$/;
const PORT_PATTERN = /:\d+$/;

// Cache for hostname parsing (simple LRU-style with max size)
const hostnameCache = new Map<string, string>();
const HOSTNAME_CACHE_MAX_SIZE = 100;

/**
 * Parse and sanitize hostname from request headers
 * Handles X-Forwarded-Host, Host header, and port stripping
 */
function getCleanHostname(request: NextRequest): string {
  const rawHostname =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "";

  // Check cache first
  if (hostnameCache.has(rawHostname)) {
    return hostnameCache.get(rawHostname)!;
  }

  // Remove port if present
  const cleanHostname = rawHostname.replace(PORT_PATTERN, "").toLowerCase();

  // Cache with eviction
  if (hostnameCache.size >= HOSTNAME_CACHE_MAX_SIZE) {
    const firstKey = hostnameCache.keys().next().value;
    if (firstKey) hostnameCache.delete(firstKey);
  }
  hostnameCache.set(rawHostname, cleanHostname);

  return cleanHostname;
}

// Extract subdomain from hostname (production only: uuid.supercheck.io)
function extractSubdomain(cleanHostname: string): string | null {
  if (!cleanHostname) {
    return null;
  }

  // Get status page domain from runtime env (NOT NEXT_PUBLIC_ - those are build-time only)
  // Use regular env var which is available at runtime in middleware
  const statusPageDomain = process.env.STATUS_PAGE_DOMAIN || "";

  if (!statusPageDomain || !cleanHostname.endsWith(statusPageDomain)) {
    return null;
  }

  // Extract subdomain by removing the status page domain
  // e.g., "f134b5f9f2b048069deaf7cfb924a0b3.supercheck.io" → "f134b5f9f2b048069deaf7cfb924a0b3"
  const domainSuffix = `.${statusPageDomain}`;
  if (!cleanHostname.endsWith(domainSuffix)) {
    return null;
  }

  const subdomain = cleanHostname.slice(0, -domainSuffix.length);

  // Valid subdomain: alphanumeric and hyphens only, 1-63 chars
  // Using pre-compiled regex for performance
  return VALID_SUBDOMAIN_PATTERN.test(subdomain) ? subdomain : null;
}

// Check if hostname is a custom domain (not the main app domain)
function isCustomDomain(cleanHostname: string, appHostname: string): boolean {
  if (!cleanHostname || !appHostname) {
    return false;
  }

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
  return (
    !cleanHostname.endsWith(`.${statusPageDomain}`) &&
    !cleanHostname.endsWith(statusPageDomain)
  );
}

/**
 * Get the main app hostname from APP_URL env variable
 * Cached for the duration of the process
 */
let cachedMainAppHostname: string | null | undefined = undefined;
function getMainAppHostname(): string | null {
  if (cachedMainAppHostname !== undefined) {
    return cachedMainAppHostname;
  }

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  try {
    const url = new URL(appUrl);
    cachedMainAppHostname = url.hostname;
  } catch {
    cachedMainAppHostname = null;
  }

  return cachedMainAppHostname;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Fast path: Skip proxy for static assets and API routes
  // API routes and internal Next.js routes should never be rewritten
  // These are shared functionality accessed from any domain
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  // Get clean hostname efficiently
  const hostname = getCleanHostname(request);

  // Get main app hostname (cached)
  const mainAppHostname = getMainAppHostname();

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
    // Sanitize hostname for URL path (remove any unsafe characters)
    const safeHostname = hostname.replace(/[^a-zA-Z0-9.-]/g, "");

    if (pathname === "/") {
      url.pathname = `/status/_custom/${safeHostname}`;
      const response = NextResponse.rewrite(url);
      addSecurityHeaders(response);
      return response;
    }

    if (pathname.startsWith(`/status/_custom/${safeHostname}`)) {
      const response = NextResponse.next();
      addSecurityHeaders(response);
      return response;
    }

    url.pathname = `/status/_custom/${safeHostname}${pathname}`;
    const response = NextResponse.rewrite(url);
    addSecurityHeaders(response);
    return response;
  }

  // Pass through all other requests - auth is handled by layout/route handlers
  return NextResponse.next();
}

/**
 * Add security headers for status pages
 * These complement the headers set in next.config.ts
 */
function addSecurityHeaders(response: NextResponse): void {
  // Prevent MIME type sniffing
  response.headers.set("X-Content-Type-Options", "nosniff");
  // Prevent clickjacking (status pages should not be embedded)
  response.headers.set("X-Frame-Options", "DENY");
  // XSS protection (legacy, CSP is primary)
  response.headers.set("X-XSS-Protection", "1; mode=block");
  // Control referrer information
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Prevent caching of status pages (they show live data)
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     * - Public folder files with common extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|eot)$).*)",
  ],
};
