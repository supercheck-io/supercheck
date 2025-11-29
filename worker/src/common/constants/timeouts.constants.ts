/**
 * Timeout and timing constants used across the worker service
 * Centralized to maintain consistency and ease of configuration
 */

export const TIMEOUTS = {
  // Execution timeouts (in milliseconds)
  // IMPORTANT: TEST_EXECUTION_DEFAULT_MS should be <= minimum synthetic monitor frequency (5 min)
  // to prevent overlapping executions. If tests need more time, users should increase monitor frequency.
  TEST_EXECUTION_DEFAULT_MS: 300000, // 5 minutes (matches min synthetic monitor frequency)
  JOB_EXECUTION_DEFAULT_MS: 3600000, // 1 hour (60 minutes) - for complex multi-test jobs
  K6_EXECUTION_DEFAULT_MS: 3600000, // 1 hour (60 minutes) - for high-load K6 tests
  HTTP_REQUEST_DEFAULT_MS: 30000, // 30 seconds
  PING_HOST_DEFAULT_MS: 5000, // 5 seconds
  PORT_CHECK_DEFAULT_MS: 10000, // 10 seconds
  SSL_CHECK_DEFAULT_MS: 10000, // 10 seconds

  // Cleanup and maintenance intervals
  MEMORY_CLEANUP_INTERVAL_MS: 300000, // 5 minutes
  GC_INTERVAL_MS: 600000, // 10 minutes
  TEMP_FILE_CLEANUP_AGE_MS: 7200000, // 2 hours
  STALE_EXECUTION_TIMEOUT_MS: 1800000, // 30 minutes

  // Stalled job detection
  STALLED_JOB_CHECK_INTERVAL_MS: 60000, // 1 minute - check for stalled jobs
  STALLED_JOB_BUFFER_MS: 10 * 60 * 1000, // 10 minutes - buffer before marking as stalled
  STALLED_JOB_THRESHOLD_MS: 70 * 60 * 1000, // 70 minutes - matches lockDuration in queue config

  // Session and authentication
  SESSION_MAX_AGE_MS: 86400000, // 24 hours
  SESSION_INACTIVE_TIMEOUT_MS: 7200000, // 2 hours
  PASSWORD_RESET_WINDOW_MS: 900000, // 15 minutes

  // Alert and notification
  SSL_ALERT_COOLDOWN_MS: 86400000, // 24 hours (1 day)
  ALERT_RATE_LIMIT_WINDOW_MS: 300000, // 5 minutes
} as const;

export const TIMEOUTS_SECONDS = {
  TEST_EXECUTION_DEFAULT: 300, // 5 minutes (matches min synthetic monitor frequency)
  JOB_EXECUTION_DEFAULT: 3600, // 1 hour (60 minutes)
  K6_EXECUTION_DEFAULT: 3600, // 1 hour (60 minutes)
  HTTP_REQUEST_DEFAULT: 30,
  PING_HOST_DEFAULT: 5,
  PORT_CHECK_DEFAULT: 10,
  SSL_CHECK_DEFAULT: 10,
} as const;
