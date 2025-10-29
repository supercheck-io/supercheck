/**
 * Rate Limit Cleanup Service
 * Periodically cleans up expired rate limit entries to prevent memory leaks
 */

import { cleanupRateLimitEntries } from "./session-security";

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start the periodic cleanup service
 * Should be called when the application starts
 */
export function startRateLimitCleanup(intervalMs = 5 * 60 * 1000): void {
  if (cleanupInterval) {
    return; // Already started
  }

  console.log("Starting rate limit cleanup service...");

  // Initial cleanup
  cleanupRateLimitEntries();

  // Set up periodic cleanup
  cleanupInterval = setInterval(() => {
    try {
      cleanupRateLimitEntries();
    } catch (error) {
      console.error("Error during rate limit cleanup:", error);
    }
  }, intervalMs);
}

/**
 * Stop the cleanup service
 */
export function stopRateLimitCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log("Rate limit cleanup service stopped");
  }
}

/**
 * Initialize cleanup service in production environments
 */
if (process.env.NODE_ENV === "production" && typeof window === "undefined") {
  startRateLimitCleanup();
}
