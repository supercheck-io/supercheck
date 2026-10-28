import { NextRequest, NextResponse } from "next/server";
import { getAllowedCorsOriginPatterns, isCorsOriginAllowed } from "@/lib/cors";
import { getMcpAllowedOrigins, getMcpResourceUrl, MCP_RESOURCE_PATH } from "@/lib/mcp/config";
import { getEffectiveStatusPageDomain } from "@/lib/status-page-domain";

/**
 * Unified proxy for Next.js 16+
 * 
 * Handles both:
 * 1. CORS for API routes (migrated from middleware.ts)
 * 2. Status page subdomain and custom domain routing
 *
 * CORS Handling:
 * - Allows OpenAPI documentation playground to make requests from different origins
 * - Only applied to /api/* routes for allowed origins
 *
 * Status Page Routing:
 * - Detects UUID subdomains (e.g., f134b5f9f2b048069deaf7cfb924a0b3.supercheck.io)
 * - Detects custom domains (e.g., status.acmecorp.com)
 * - Rewrites to /status/[subdomain] for status page routes
 * - All authentication is handled by layout/route handlers
 *
 * Why this approach?
 * - Next.js 16+ requires single proxy file (no separate middleware.ts)
 * - Proxy stays fast and focused
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

// ============================================================================
// CORS Configuration (migrated from middleware.ts)
// ============================================================================

/**
 * Handle CORS for API routes
 * Returns a response if CORS handling is complete, null if request should continue
 */
/**
 * The MCP endpoint answers only its own origin plus MCP_ALLOWED_ORIGINS, not the general CORS allow-list, so the
 * preflight advertises exactly what the route itself will accept.
 */
function isMcpOriginAllowed(origin: string): boolean {
  try {
    return origin === new URL(getMcpResourceUrl()).origin || getMcpAllowedOrigins().includes(origin);
  } catch {
    // MCP is not configured (no BETTER_AUTH_URL), so there is no resource origin to allow.
    return getMcpAllowedOrigins().includes(origin);
  }
}

function handleCors(request: NextRequest): NextResponse | null {
  const origin = request.headers.get('origin');
  const pathname = request.nextUrl.pathname;
  
  // Only apply CORS to API routes
  if (!pathname.startsWith('/api/')) {
    return null;
  }
  
  const allowed = !origin
    ? false
    : pathname === MCP_RESOURCE_PATH
      ? isMcpOriginAllowed(origin)
      : isCorsOriginAllowed(origin, getAllowedCorsOriginPatterns());
  
  // Handle preflight requests (OPTIONS)
  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 });
    
    if (allowed && origin) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    }
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    response.headers.set(
      'Access-Control-Allow-Headers',
      pathname === MCP_RESOURCE_PATH
        ? 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id'
        : 'Authorization, Content-Type, Accept'
    );
    response.headers.set('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
    response.headers.set(
      'Vary',
      'Origin, Access-Control-Request-Method, Access-Control-Request-Headers'
    );
    
    return response;
  }
  
  // For actual API requests, add CORS headers and pass through
  const response = NextResponse.next();
  
  if (allowed && origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  response.headers.set('Vary', 'Origin');
  if (pathname === MCP_RESOURCE_PATH) {
    response.headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
  }
  
  return response;
}

// ============================================================================
// Status Page Routing Configuration
// ============================================================================

// Pre-compile regex patterns for performance
const VALID_SUBDOMAIN_PATTERN = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const PORT_PATTERN = /:\d+$/;
const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

// Cache for hostname parsing (simple LRU-style with max size)
const hostnameCache = new Map<string, string>();
const HOSTNAME_CACHE_MAX_SIZE = 100;
let cachedStatusPageDomain: string | null | undefined = undefined;

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

function getStatusPageDomainForRouting(): string | null {
  if (cachedStatusPageDomain !== undefined) {
    return cachedStatusPageDomain;
  }

  const domain = getEffectiveStatusPageDomain();
  cachedStatusPageDomain = domain ? domain.toLowerCase() : null;
  return cachedStatusPageDomain;
}

// Extract subdomain from hostname (production only: uuid.supercheck.io)
function extractSubdomain(cleanHostname: string): string | null {
  if (!cleanHostname) {
    return null;
  }

  const statusPageDomain = getStatusPageDomainForRouting();

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

  // Status pages use generated UUID labels; reserve ordinary service hostnames.
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

  // Ignore hosts that are not plausible public DNS hostnames.
  // This prevents requests addressed to raw IPs or single-label hostnames from
  // being treated as custom-domain traffic.
  if (
    IPV4_PATTERN.test(cleanHostname) ||
    cleanHostname.includes(":") ||
    !cleanHostname.includes(".")
  ) {
    return false;
  }

  // Custom domains are valid if they don't match or belong to the status page domain namespace
  const statusPageDomain = getStatusPageDomainForRouting();
  if (!statusPageDomain) {
    return true;
  }

  // Use exact match + dot-prefix matching to avoid false negatives.
  // Without the dot prefix, "myexample.com".endsWith("example.com") would
  // incorrectly reject a valid custom domain.
  return (
    cleanHostname !== statusPageDomain &&
    !cleanHostname.endsWith(`.${statusPageDomain}`)
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

/** True when REPORTS_ORIGIN is set and this request arrived on that host. */
function isReportsOriginRequest(request: NextRequest): boolean {
  const raw = process.env.REPORTS_ORIGIN?.trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const reportsHost = parsed.host.toLowerCase();
    // Mirrors getReportsOrigin(): a value equal to the app host is ignored, never a lockout.
    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl && new URL(appUrl).host.toLowerCase() === reportsHost) return false;
    // Fail closed: Host or X-Forwarded-Host naming the reports host is enough.
    return [request.headers.get('x-forwarded-host'), request.headers.get('host')]
      .flatMap((h) => (h ? h.split(',') : []))
      .some((h) => h.trim().toLowerCase() === reportsHost);
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The reports origin serves report assets only; nothing else of the app is reachable there.
  if (isReportsOriginRequest(request) && !pathname.startsWith('/api/test-results/')) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Fast path: Skip proxy for internal Next.js routes
  if (pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  // Handle CORS for API routes first
  // This was migrated from middleware.ts as Next.js 16 requires single proxy file
  const corsResponse = handleCors(request);
  if (corsResponse) {
    return corsResponse;
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
      url.pathname = `/status/custom-domain/${safeHostname}`;
      const response = NextResponse.rewrite(url);
      addSecurityHeaders(response);
      return response;
    }

    if (pathname.startsWith(`/status/custom-domain/${safeHostname}`)) {
      const response = NextResponse.next();
      addSecurityHeaders(response);
      return response;
    }

    url.pathname = `/status/custom-domain/${safeHostname}${pathname}`;
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
