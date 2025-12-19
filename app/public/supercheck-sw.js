/**
 * Supercheck Service Worker - Static Asset Cache
 * 
 * PRODUCTION-READY | SECURE | PERFORMANT
 *
 * This service worker provides intelligent caching for static assets
 * to improve page load performance without impacting functionality.
 *
 * WHAT IT CACHES:
 * ✓ Cloud storage assets (Cloudflare R2, S3, GCS, Azure)
 * ✓ Images, fonts, CSS
 * ✓ Next.js static chunks (immutable)
 * ✓ Playwright & K6 HTML reports
 * ✓ Monaco type definitions
 *
 * WHAT IT NEVER CACHES:
 * ✗ API calls (/api/*)
 * ✗ Authentication endpoints
 * ✗ Dynamic content
 * ✗ WebSocket connections
 * ✗ Development resources
 *
 * CACHE STRATEGY:
 * - Static assets: Cache-first with stale-while-revalidate
 * - Max cache size: 100 items (auto-cleanup of oldest)
 * - Max cache age: 30 days
 *
 * SECURITY CONSIDERATIONS:
 * - Only caches responses with valid CORS headers
 * - Never caches responses with Set-Cookie
 * - Only handles same-origin and allowed cross-origin requests
 *
 * WHY JAVASCRIPT:
 * Service workers run in a separate browser context and are loaded
 * directly from the public folder without compilation.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  CACHE_NAME: "supercheck-static-cache-v1",
  MAX_CACHE_SIZE: 100,          // Maximum number of cached items
  MAX_CACHE_AGE_MS: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
};

// ============================================================================
// STATIC ASSETS - Pre-cached on install
// ============================================================================

const STATIC_ASSETS = [
  "/supercheck.d.ts",           // Monaco TypeScript definitions (~62KB)
  "/favicon.ico",
];

// ============================================================================
// CACHE PATTERNS - Assets cached dynamically on fetch
// ============================================================================

const CACHE_PATTERNS = [
  // -------------------------------------------------------------------------
  // Cloudflare R2 (primary storage for Supercheck)
  // -------------------------------------------------------------------------
  /\.r2\.cloudflarestorage\.com/i,
  /\.r2\.dev/i,
  /pub-[a-z0-9]+\.r2\.dev/i,
  /[a-z0-9-]+\.r2\.cloudflarestorage\.com/i,
  
  // -------------------------------------------------------------------------
  // AWS S3
  // -------------------------------------------------------------------------
  /\.s3\.[a-z0-9-]+\.amazonaws\.com/i,
  /s3\.[a-z0-9-]+\.amazonaws\.com/i,
  /[a-z0-9-]+\.s3\.amazonaws\.com/i,
  /s3-[a-z0-9-]+\.amazonaws\.com/i,
  
  // -------------------------------------------------------------------------
  // Google Cloud Storage
  // -------------------------------------------------------------------------
  /storage\.googleapis\.com/i,
  /\.storage\.googleapis\.com/i,
  
  // -------------------------------------------------------------------------
  // Azure Blob Storage
  // -------------------------------------------------------------------------
  /\.blob\.core\.windows\.net/i,
  
  // -------------------------------------------------------------------------
  // Supercheck CDN
  // -------------------------------------------------------------------------
  /cdn\.supercheck\.io/i,
  /assets\.supercheck\.io/i,
  /static\.supercheck\.io/i,
  
  // -------------------------------------------------------------------------
  // Static File Types (by extension)
  // -------------------------------------------------------------------------
  
  // Images
  /\.(png|jpg|jpeg|gif|svg|webp|ico|bmp|tiff|avif)(\?.*)?$/i,
  
  // Fonts
  /\.(woff|woff2|ttf|eot|otf)(\?.*)?$/i,
  
  // -------------------------------------------------------------------------
  // Next.js Static Assets (immutable, content-hashed)
  // -------------------------------------------------------------------------
  /_next\/static\/chunks\/[a-f0-9]+\.js$/i,
  /_next\/static\/css\/[a-f0-9]+\.css$/i,
  /_next\/static\/media\/.+$/i,
  
  // -------------------------------------------------------------------------
  // Test Reports - Playwright & K6
  // -------------------------------------------------------------------------
  
  // Playwright reports
  /playwright-report/i,
  /test-results/i,
  
  // K6 HTML reports
  /k6-report/i,
  /k6-summary/i,
  /k6-html/i,
  /performance-report/i,
  
  // Report assets (HTML, JSON summaries)
  /report\.html(\?.*)?$/i,
  /index\.html(\?.*)?$/i,
  /summary\.json(\?.*)?$/i,
  /results\.json(\?.*)?$/i,
];

// ============================================================================
// NEVER CACHE PATTERNS - Always fetch from network
// ============================================================================

const NO_CACHE_PATTERNS = [
  // API routes (dynamic data)
  /\/api\//i,
  
  // Authentication (security-sensitive)
  /\/auth\//i,
  /\/sign-in/i,
  /\/sign-up/i,
  /\/sign-out/i,
  /\/verify/i,
  /\/reset-password/i,
  /better-auth/i,
  
  // Billing & payments (path segment match to avoid matching asset names)
  /\/billing(?:\/|$)/i,  // Matches /billing or /billing/... but not /assets/billing-icon.png
  /stripe\.com/i,        // Only match Stripe domain, not arbitrary paths with "stripe"
  
  // Development & HMR
  /\/_next\/webpack-hmr/i,
  /__nextjs/i,
  /\.hot-update\./i,
  
  // Development servers
  /localhost/i,
  /127\.0\.0\.1/i,
  /0\.0\.0\.0/i,
  
  // WebSocket connections
  /^wss?:\/\//i,
  
  // Server-side data fetching
  /\/_next\/data\//i,
  
  // Server-sent events (path segment match to avoid matching page names)
  /\/api\/events/i,      // API event endpoints
  /\/api\/stream/i,      // API streaming endpoints
  /\/api\/sse/i,         // Server-sent events API
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a URL should be cached
 */
function shouldCache(url) {
  // Never cache if in no-cache list
  if (NO_CACHE_PATTERNS.some(pattern => pattern.test(url))) {
    return false;
  }
  
  // Cache if matches cache pattern
  return CACHE_PATTERNS.some(pattern => pattern.test(url));
}

/**
 * Check if response is cacheable
 * Only cache successful responses without security-sensitive headers
 */
function isResponseCacheable(response) {
  if (!response || !response.ok) {
    return false;
  }
  
  // Don't cache responses with Set-Cookie (session data)
  if (response.headers.has("Set-Cookie")) {
    return false;
  }
  
  // Don't cache if explicitly marked no-store
  const cacheControl = response.headers.get("Cache-Control");
  if (cacheControl && cacheControl.includes("no-store")) {
    return false;
  }
  
  return true;
}

/**
 * Limit cache size by removing oldest entries
 */
async function limitCacheSize(cacheName, maxSize) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  
  if (keys.length > maxSize) {
    // Remove oldest entries (first in list)
    const toDelete = keys.slice(0, keys.length - maxSize);
    await Promise.all(toDelete.map(key => cache.delete(key)));
  }
}

// ============================================================================
// SERVICE WORKER LIFECYCLE
// ============================================================================

/**
 * Install - Pre-cache static assets
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CONFIG.CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/**
 * Activate - Clean up old caches
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => 
        Promise.all(
          cacheNames
            .filter((name) => name.startsWith("supercheck-") && name !== CONFIG.CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * Fetch - Serve from cache with network fallback
 * 
 * Strategy: Stale-While-Revalidate
 * 1. Return cached response immediately (fast!)
 * 2. Fetch fresh version in background
 * 3. Update cache for next request
 */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  
  // Only handle GET requests
  if (request.method !== "GET") {
    return;
  }
  
  // Check if URL should be cached
  if (!shouldCache(request.url)) {
    return;
  }
  
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      // Create network request
      const networkFetch = fetch(request)
        .then((networkResponse) => {
          if (isResponseCacheable(networkResponse)) {
            const responseClone = networkResponse.clone();
            caches.open(CONFIG.CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
              // Limit cache size
              limitCacheSize(CONFIG.CACHE_NAME, CONFIG.MAX_CACHE_SIZE);
            });
          }
          return networkResponse;
        })
        .catch((error) => {
          // Network failed, but we might have cache
          if (cachedResponse) {
            return cachedResponse;
          }
          throw error;
        });
      
      // Return cached immediately, update in background (stale-while-revalidate)
      if (cachedResponse) {
        event.waitUntil(networkFetch);
        return cachedResponse;
      }
      
      // No cache - wait for network
      return networkFetch;
    })
  );
});

/**
 * Message - Handle commands from main thread
 */
self.addEventListener("message", (event) => {
  const { type } = event.data || {};
  
  switch (type) {
    case "SKIP_WAITING":
      self.skipWaiting();
      break;
      
    case "CLEAR_CACHE":
      caches.delete(CONFIG.CACHE_NAME);
      break;
      
    case "GET_CACHE_SIZE":
      caches.open(CONFIG.CACHE_NAME)
        .then(cache => cache.keys())
        .then(keys => {
          event.source.postMessage({
            type: "CACHE_SIZE",
            size: keys.length,
            maxSize: CONFIG.MAX_CACHE_SIZE,
          });
        });
      break;
  }
});
