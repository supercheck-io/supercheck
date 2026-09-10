const { getDatabaseSSLConfig } = require("./db-ssl.js");
const DEFAULT_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_DELAY_MS = 2000;

/**
 * Acquire a transaction-scoped advisory lock.
 *
 * The transaction stays open until releaseMigrationLock commits or rolls back.
 * This is intentional: transaction-scoped locks are released by PostgreSQL on
 * every exit path and remain safe when DATABASE_URL points at a pooler.
 */
async function acquireMigrationLock(
  postgres,
  connectionString,
  {
    lockName = "supercheck-db-migrate-v1",
    timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    log = () => undefined,
    logSuccess = () => undefined,
    logError = () => undefined,
  } = {},
) {
  const lockClient = postgres(connectionString, { max: 1, ssl: getDatabaseSSLConfig() });
  const deadline = Date.now() + timeoutMs;

  log(`Waiting up to ${timeoutMs}ms for the ${lockName} advisory lock...`);

  try {
    await lockClient`BEGIN`;

    while (Date.now() < deadline) {
      const result = await lockClient`
        SELECT pg_try_advisory_xact_lock(hashtext(${lockName})) AS acquired
      `;

      if (result[0]?.acquired === true) {
        logSuccess("Database migration advisory lock acquired");
        return lockClient;
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }

    logError(
      `Timed out waiting for the database migration advisory lock after ${timeoutMs}ms`,
    );
    await lockClient`ROLLBACK`.catch(() => undefined);
    await lockClient.end().catch(() => undefined);
    return null;
  } catch (error) {
    await lockClient`ROLLBACK`.catch(() => undefined);
    await lockClient.end().catch(() => undefined);
    throw error;
  }
}

async function releaseMigrationLock(
  lockClient,
  { commit = false, logSuccess = () => undefined } = {},
) {
  if (!lockClient) return;

  try {
    if (commit) {
      await lockClient`COMMIT`;
      logSuccess("Database migration transaction committed");
    } else {
      await lockClient`ROLLBACK`;
      logSuccess("Database migration transaction rolled back");
    }
  } finally {
    await lockClient.end();
  }
}

module.exports = {
  acquireMigrationLock,
  releaseMigrationLock,
};
