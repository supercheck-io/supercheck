/**
 * Playwright Per-Test Setup for Network Events API
 *
 * This file is automatically loaded before each test file.
 * It patches the global test object to add network instrumentation.
 */

const { test: baseTest } = require('@playwright/test');
const fs = require('fs');

// Only patch if network events capture is enabled
if (process.env.PLAYWRIGHT_NETWORK_EVENTS_FILE) {
  const outputFile = process.env.PLAYWRIGHT_NETWORK_EVENTS_FILE;

  /**
   * Check if URL should be filtered
   */
  function shouldIgnoreRequest(url) {
    if (!url) return true;

    try {
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        return true;
      }

      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();
      const hostname = urlObj.hostname.toLowerCase();

      // Ignore analytics
      const ignoredDomains = [
        'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
        'facebook.com', 'facebook.net', 'analytics', 'tracking',
      ];

      if (ignoredDomains.some(domain => hostname.includes(domain))) {
        return true;
      }

      // Ignore static assets
      const ignoredExtensions = [
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
        '.woff', '.woff2', '.ttf', '.eot', '.css', '.map'
      ];

      if (ignoredExtensions.some(ext => pathname.endsWith(ext))) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Normalize URL
   */
  function normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      let pathname = urlObj.pathname;
      pathname = pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}');
      pathname = pathname.replace(/\/\d+/g, '/{id}');
      pathname = pathname.replace(/\/[0-9a-f]{9,}/gi, '/{hash}');
      return `${urlObj.origin}${pathname}${urlObj.search ? '?...' : ''}`;
    } catch {
      return url;
    }
  }

  /**
   * Instrument page
   */
  function instrumentPage(page, testInfo) {
    const requestMap = new Map();

    page.on('request', (request) => {
      try {
        const url = request.url();
        if (shouldIgnoreRequest(url)) return;

        requestMap.set(request, {
          startTime: Date.now(),
          url,
          method: request.method(),
          resourceType: request.resourceType(),
          testId: testInfo.testId,
          testTitle: testInfo.title,
          testFile: testInfo.file,
        });
      } catch {}
    });

    page.on('response', async (response) => {
      try {
        const tracked = requestMap.get(response.request());
        if (tracked) {
          tracked.status = response.status();
          tracked.responseTime = Date.now();
        }
      } catch {}
    });

    page.on('requestfinished', async (request) => {
      try {
        const tracked = requestMap.get(request);
        if (!tracked) return;

        const timing = await request.timing();
        const endTime = Date.now();

        const event = {
          type: 'http_request',
          testId: tracked.testId,
          testTitle: tracked.testTitle,
          testFile: tracked.testFile,
          url: tracked.url,
          normalizedUrl: normalizeUrl(tracked.url),
          method: tracked.method,
          status: tracked.status || 0,
          resourceType: tracked.resourceType,
          startTime: tracked.startTime,
          endTime,
          duration: endTime - tracked.startTime,
          timing: {
            dns: timing.domainLookupEnd > 0 ? timing.domainLookupEnd - timing.domainLookupStart : undefined,
            tcp: timing.connectEnd > 0 ? timing.connectEnd - timing.connectStart : undefined,
            tls: timing.secureConnectionStart > 0 ? timing.connectEnd - timing.secureConnectionStart : undefined,
            ttfb: timing.responseStart > 0 && timing.requestStart > 0 ? timing.responseStart - timing.requestStart : undefined,
            download: timing.responseEnd > 0 && timing.responseStart > 0 ? timing.responseEnd - timing.responseStart : undefined,
          },
        };

        fs.appendFileSync(outputFile, JSON.stringify(event) + '\n', 'utf8');
        requestMap.delete(request);
      } catch {}
    });

    page.on('requestfailed', (request) => {
      try {
        const tracked = requestMap.get(request);
        if (!tracked) return;

        const endTime = Date.now();
        const failure = request.failure();

        const event = {
          type: 'http_request_failed',
          testId: tracked.testId,
          testTitle: tracked.testTitle,
          testFile: tracked.testFile,
          url: tracked.url,
          normalizedUrl: normalizeUrl(tracked.url),
          method: tracked.method,
          resourceType: tracked.resourceType,
          startTime: tracked.startTime,
          endTime,
          duration: endTime - tracked.startTime,
          errorText: failure?.errorText || 'Unknown error',
        };

        fs.appendFileSync(outputFile, JSON.stringify(event) + '\n', 'utf8');
        requestMap.delete(request);
      } catch {}
    });
  }

  // Hook into test lifecycle
  baseTest.beforeEach(async ({ page, context }, testInfo) => {
    try {
      if (page) {
        instrumentPage(page, testInfo);
      }

      if (context) {
        context.on('page', (newPage) => {
          try {
            instrumentPage(newPage, testInfo);
          } catch {}
        });
      }
    } catch (error) {
      console.error('[Network Events] Failed to instrument:', error);
    }
  });
}
