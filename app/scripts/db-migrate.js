#!/usr/bin/env node

/**
 * Simple and Robust Database Migration Script
 * Handles all migration scenarios in a clean, predictable way
 */

const postgres = require("postgres");
const fs = require("fs");
const path = require("path");

// Configuration
const MAX_RETRIES = 20;
const RETRY_DELAY = 2000;

// Environment variables with defaults
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = process.env.DB_PORT || "5432";
const DB_USER = process.env.DB_USER || "postgres";
const DB_PASSWORD = process.env.DB_PASSWORD || "postgres";
const DB_NAME = process.env.DB_NAME || "supercheck";
const HAS_EXPLICIT_DATABASE_URL =
  typeof process.env.DATABASE_URL === "string" &&
  process.env.DATABASE_URL.trim().length > 0;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

function getConnectionTargets(connectionString) {
  if (!HAS_EXPLICIT_DATABASE_URL) {
    return {
      targetConnectionString: connectionString,
      adminConnectionString: `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres`,
      databaseName: DB_NAME,
    };
  }

  try {
    const targetUrl = new URL(connectionString);
    const adminUrl = new URL(connectionString);
    const databaseName =
      decodeURIComponent(targetUrl.pathname.replace(/^\/+/, "")) || DB_NAME;

    adminUrl.pathname = "/postgres";
    adminUrl.search = targetUrl.search;

    return {
      targetConnectionString: targetUrl.toString(),
      adminConnectionString: adminUrl.toString(),
      databaseName,
    };
  } catch {
    return {
      targetConnectionString: connectionString,
      adminConnectionString: `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres`,
      databaseName: DB_NAME,
    };
  }
}

function parseBooleanEnv(value) {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

const {
  targetConnectionString: TARGET_DATABASE_URL,
  adminConnectionString: ADMIN_DATABASE_URL,
  databaseName: TARGET_DB_NAME,
} = getConnectionTargets(DATABASE_URL);
const IS_SELF_HOSTED = parseBooleanEnv(process.env.SELF_HOSTED) === true;
const EXPLICIT_SKIP_ADMIN_OPERATIONS = parseBooleanEnv(
  process.env.DB_SKIP_ADMIN_OPERATIONS
);

// If deployment is cloud-hosted (SELF_HOSTED is not true), treat DB as managed.
const IS_CLOUD_DB =
  EXPLICIT_SKIP_ADMIN_OPERATIONS !== undefined
    ? EXPLICIT_SKIP_ADMIN_OPERATIONS
    : !IS_SELF_HOSTED;
const CLOUD_MODE_SOURCE =
  EXPLICIT_SKIP_ADMIN_OPERATIONS !== undefined
    ? "DB_SKIP_ADMIN_OPERATIONS override"
    : IS_SELF_HOSTED
      ? "SELF_HOSTED=true"
      : "SELF_HOSTED is not true (cloud mode)";

// Logging functions
function log(message) {
  console.log(`[${new Date().toISOString()}] [MIGRATION] ${message}`);
}

function logSuccess(message) {
  console.log(`[${new Date().toISOString()}] [SUCCESS] ${message}`);
}

function logError(message) {
  console.error(`[${new Date().toISOString()}] [ERROR] ${message}`);
}

function logWarning(message) {
  console.log(`[${new Date().toISOString()}] [WARNING] ${message}`);
}

function isMissingDatabaseError(error) {
  if (!error) return false;

  const errorCode = String(error.code || "").toUpperCase();
  if (errorCode === "3D000") return true;

  const message = String(error.message || "").toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("unknown database") ||
    message.includes("invalid catalog name")
  );
}

// Function to wait for database to be ready
async function waitForConnection(connectionString, connectionLabel, options = {}) {
  const {
    maxRetries = MAX_RETRIES,
    retryDelayMs = RETRY_DELAY,
    stopOnMissingDatabase = false,
  } = options;

  log(`Waiting for ${connectionLabel} to be ready...`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    log(`Attempt ${attempt}/${maxRetries}: Checking ${connectionLabel}...`);

    let client;

    try {
      client = postgres(connectionString);
      await client`SELECT 1`;
      logSuccess(`${connectionLabel} is ready`);
      return true;
    } catch (err) {
      log(`${connectionLabel} not ready: ${err.message}`);

      if (stopOnMissingDatabase && isMissingDatabaseError(err)) {
        logWarning(
          `${connectionLabel} appears to be missing. Skipping further retries.`
        );
        return false;
      }

      if (attempt < maxRetries) {
        log(`Waiting ${retryDelayMs}ms before next attempt...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    } finally {
      if (client) {
        try {
          await client.end();
        } catch {
          // Best-effort cleanup for failed connection attempts.
        }
      }
    }
  }

  logError(`${connectionLabel} failed to become ready after maximum attempts`);
  return false;
}

async function waitForDatabase() {
  return waitForConnection(ADMIN_DATABASE_URL, "database");
}

// Function to create database if it doesn't exist
async function createDatabaseIfNotExists() {
  log(`Checking if database '${TARGET_DB_NAME}' exists...`);

  try {
    // Try to connect to the target database
    const targetClient = postgres(TARGET_DATABASE_URL);
    await targetClient`SELECT 1`;
    await targetClient.end();
    logSuccess(`Database '${TARGET_DB_NAME}' exists and is accessible`);
    return true;
  } catch (err) {
    if (isMissingDatabaseError(err)) {
      log(`Database '${TARGET_DB_NAME}' does not exist, creating it...`);

      try {
        const adminClient = postgres(ADMIN_DATABASE_URL);
        const quotedName = `"${TARGET_DB_NAME.replace(/"/g, '""')}"`;  
        await adminClient.unsafe(`CREATE DATABASE ${quotedName}`);
        await adminClient.end();
        logSuccess(`Database '${TARGET_DB_NAME}' created successfully`);
        return true;
      } catch (createErr) {
        logError(
          `Failed to create database '${TARGET_DB_NAME}': ${createErr.message}`
        );
        return false;
      }
    } else {
      logError(`Database connection error: ${String(err.message || err)}`);
      return false;
    }
  }
}

// Function to run migrations
async function runMigrations() {
  log("Running database migrations...");

  try {
    // Connect to the database
    const client = postgres(TARGET_DATABASE_URL);

    // Get the migrations directory
    const migrationsDir = path.join(process.cwd(), "src", "db", "migrations");

    if (!fs.existsSync(migrationsDir)) {
      logError(`Migrations directory not found: ${migrationsDir}`);
      logError("Current directory structure:");
      logError(`  Current dir: ${process.cwd()}`);
      logError(`  Available: ${fs.readdirSync(process.cwd()).join(", ")}`);
      if (fs.existsSync("src")) {
        logError(`  src contents: ${fs.readdirSync("src").join(", ")}`);
      }
      if (fs.existsSync("src/db")) {
        logError(`  src/db contents: ${fs.readdirSync("src/db").join(", ")}`);
      }
      await client.end();
      return false;
    }

    // Read migration files
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    log(`Found ${migrationFiles.length} migration files`);

    if (migrationFiles.length === 0) {
      logWarning("No migration files found");
      await client.end();
      return true;
    }

    // Check if migrations table exists
    const migrationsTableExists = await client`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = '__drizzle_migrations'
            );
        `.then((result) => result[0]?.exists);

    if (!migrationsTableExists) {
      log("Creating migrations table...");
      await client`
                CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
                    "id" SERIAL PRIMARY KEY,
                    "hash" text NOT NULL,
                    "created_at" bigint
                );
            `;
    }

    // Run each migration
    for (const migrationFile of migrationFiles) {
      const migrationPath = path.join(migrationsDir, migrationFile);
      let migrationContent = fs.readFileSync(migrationPath, "utf8");
      const migrationHash = require("crypto")
        .createHash("md5")
        .update(migrationContent)
        .digest("hex");

      // Check if migration has already been applied
      const applied = await client`
                SELECT id FROM "__drizzle_migrations" WHERE hash = ${migrationHash}
            `.then((result) => result.length > 0);

      if (applied) {
        log(`Migration ${migrationFile} already applied, skipping`);
        continue;
      }

      log(`Applying migration: ${migrationFile}`);

      try {
        // Make migration idempotent by adding IF NOT EXISTS to CREATE statements
        migrationContent = migrationContent.replace(
          /CREATE TABLE "([^"]+)"/g,
          'CREATE TABLE IF NOT EXISTS "$1"'
        );
        migrationContent = migrationContent.replace(
          /CREATE INDEX "([^"]+)"/g,
          'CREATE INDEX IF NOT EXISTS "$1"'
        );
        migrationContent = migrationContent.replace(
          /CREATE UNIQUE INDEX "([^"]+)"/g,
          'CREATE UNIQUE INDEX IF NOT EXISTS "$1"'
        );

        // Split migration into individual statements
        const statements = migrationContent
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        // Execute each statement individually with error handling
        for (const statement of statements) {
          if (!statement) continue;

          try {
            await client.unsafe(statement);
          } catch (stmtErr) {
            // Log but don't fail on certain expected errors
            const errorMsg = stmtErr.message.toLowerCase();
            if (
              errorMsg.includes("already exists") ||
              errorMsg.includes("duplicate key value") ||
              (errorMsg.includes("constraint") &&
                errorMsg.includes("already exists"))
            ) {
              log(`Skipping statement (already exists): ${stmtErr.message}`);
            } else {
              // Re-throw unexpected errors
              throw stmtErr;
            }
          }
        }

        // Record the migration
        await client`
                    INSERT INTO "__drizzle_migrations" (hash, created_at)
                    VALUES (${migrationHash}, ${Date.now()})
                `;

        logSuccess(`Migration ${migrationFile} applied successfully`);
      } catch (err) {
        logError(`Failed to apply migration ${migrationFile}: ${err.message}`);
        await client.end();
        return false;
      }
    }

    await client.end();
    logSuccess("All migrations completed successfully");
    return true;
  } catch (err) {
    logError(`Migration error: ${err.message}`);
    return false;
  }
}

// Function to ensure critical columns exist for Polar billing
// Since app is not live yet, we can be more aggressive about schema fixes
async function ensurePolarColumns() {
  log("Ensuring Polar billing columns exist...");

  try {
    const client = postgres(TARGET_DATABASE_URL);

    // Check if organization table exists
    const orgTableExists = await client`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'organization'
      );
    `.then((result) => result[0]?.exists);

    if (!orgTableExists) {
      log("Organization table doesn't exist, will be created by migration");
      await client.end();
      return true;
    }

    // Define all required Polar columns
    const requiredColumns = [
      { name: "polar_customer_id", type: "text" },
      { name: "subscription_plan", type: "text" },
      { name: "subscription_status", type: "text DEFAULT 'none'" },
      { name: "subscription_id", type: "text" },
      { name: "subscription_started_at", type: "timestamp" },
      { name: "subscription_ends_at", type: "timestamp" },
      { name: "playwright_minutes_used", type: "integer DEFAULT 0" },
      { name: "k6_vu_minutes_used", type: "integer DEFAULT 0" },
      { name: "usage_period_start", type: "timestamp" },
      { name: "usage_period_end", type: "timestamp" },
    ];

    for (const column of requiredColumns) {
      const columnExists = await client`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'organization'
          AND column_name = ${column.name}
        );
      `.then((result) => result[0]?.exists);

      if (!columnExists) {
        log(`Adding missing ${column.name} column to organization table`);

        try {
          await client.unsafe(
            `ALTER TABLE organization ADD COLUMN IF NOT EXISTS ${column.name} ${column.type}`
          );
          logSuccess(`Added ${column.name} column`);
        } catch (err) {
          if (err.message.includes("already exists")) {
            log(`${column.name} column already exists`);
          } else {
            logError(`Failed to add ${column.name}: ${err.message}`);
            await client.end();
            return false;
          }
        }
      } else {
        log(`${column.name} column already exists`);
      }
    }

    await client.end();
    logSuccess("All Polar billing columns verified");
    return true;
  } catch (err) {
    logError(`Polar column check error: ${err.message}`);
    return false;
  }
}

// Function to verify migrations
async function verifyMigrations() {
  log("Verifying migrations...");

  try {
    const client = postgres(TARGET_DATABASE_URL);

    // Check if key tables exist
    const tables = ["user", "organization", "tests", "jobs", "runs"];
    const missingTables = [];

    for (const table of tables) {
      const exists = await client`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = ${table}
                );
            `.then((result) => result[0]?.exists);

      if (!exists) {
        missingTables.push(table);
      }
    }

    await client.end();

    if (missingTables.length > 0) {
      logError(`Missing tables: ${missingTables.join(", ")}`);
      return false;
    }

    logSuccess("Migration verification passed");
    return true;
  } catch (err) {
    logError(`Verification error: ${err.message}`);
    return false;
  }
}

// Function to run database seeds (idempotent)
async function runSeeds() {
  log("Running database seeds...");

  try {
    const seedModule = require("./db-seed.js");
    const client = postgres(TARGET_DATABASE_URL);

    // Run plan_limits seeding
    if (!(await seedModule.seedPlanLimits(client))) {
      await client.end();
      logError("Failed to seed plan_limits");
      return false;
    }

    // Run overage_pricing seeding
    if (!(await seedModule.seedOveragePricing(client))) {
      await client.end();
      logError("Failed to seed overage_pricing");
      return false;
    }

    await client.end();
    logSuccess("Database seeds completed successfully");
    return true;
  } catch (err) {
    logError(`Seeding error: ${err.message}`);
    return false;
  }
}

// Function to verify plan_limits are seeded (CRITICAL)
async function verifyPlanLimitsSeeded() {
  log("Verifying plan_limits table has required data...");

  try {
    const client = postgres(TARGET_DATABASE_URL);

    // Check if plan_limits table exists
    const tableExists = await client`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'plan_limits'
      );
    `.then((result) => result[0]?.exists);

    if (!tableExists) {
      logError("plan_limits table does not exist");
      await client.end();
      return false;
    }

    // Check if required plans exist
    const plans = await client`SELECT plan FROM plan_limits ORDER BY plan`;
    const planNames = plans.map((p) => p.plan);

    if (planNames.length === 0) {
      logError("plan_limits table is empty - no plans found");
      await client.end();
      return false;
    }

    // Verify all required plans exist
    const requiredPlans = ["plus", "pro", "unlimited"];
    const missingPlans = requiredPlans.filter((p) => !planNames.includes(p));

    if (missingPlans.length > 0) {
      logError(`Missing required plans: ${missingPlans.join(", ")}`);
      await client.end();
      return false;
    }

    await client.end();
    logSuccess(
      `Verified ${planNames.length} plan(s) in database: ${planNames.join(", ")}`
    );
    return true;
  } catch (err) {
    logError(`Plan limits verification error: ${err.message}`);
    return false;
  }
}

// Main function
async function main() {
  try {
    log("Starting database migration process...");
    log(`Database URL: ${DATABASE_URL.replace(/:[^:@]*@/, ":***@")}`);
    log(`Cloud database mode: ${IS_CLOUD_DB} (${CLOUD_MODE_SOURCE})`);
    log(`Target database: ${TARGET_DB_NAME}`);

    let shouldSkipAdminOperations = IS_CLOUD_DB;
    let targetConnectionVerified = false;

    // In auto mode with DATABASE_URL, verify target connectivity first.
    // If target DB is already reachable, admin operations are unnecessary.
    if (
      !shouldSkipAdminOperations &&
      EXPLICIT_SKIP_ADMIN_OPERATIONS === undefined &&
      HAS_EXPLICIT_DATABASE_URL
    ) {
      log(
        "Auto mode with DATABASE_URL detected. Probing target database before admin operations..."
      );
      if (
        await waitForConnection(TARGET_DATABASE_URL, "target database connection", {
          maxRetries: 3,
          stopOnMissingDatabase: true,
        })
      ) {
        shouldSkipAdminOperations = true;
        targetConnectionVerified = true;
        logSuccess(
          "Target database is reachable. Skipping admin DB wait/create steps."
        );
      }
    }

    if (shouldSkipAdminOperations) {
      if (!targetConnectionVerified) {
        // In cloud mode, DB is assumed managed/provisioned.
        // Skip admin DB wait/create and only verify connectivity.
        log("Cloud database detected. Verifying connection with retries...");
        if (
          !(await waitForConnection(
            TARGET_DATABASE_URL,
            "cloud database connection"
          ))
        ) {
          process.exit(1);
        }
      }
    } else {
      // Self-hosted/admin-access path: wait for admin database and create target if needed
      // Step 1: Wait for database to be ready
      if (!(await waitForDatabase())) {
        process.exit(1);
      }

      // Step 2: Create database if it doesn't exist
      if (!(await createDatabaseIfNotExists())) {
        process.exit(1);
      }
    }

    // Step 3: Run migrations
    if (!(await runMigrations())) {
      process.exit(1);
    }

    // Step 4: Verify migrations
    if (!(await verifyMigrations())) {
      process.exit(1);
    }

    // Step 4.5: Ensure Polar columns exist (critical for subscription flow)
    if (!(await ensurePolarColumns())) {
      logError("Failed to ensure Polar columns exist");
      process.exit(1);
    }

    // Step 5: Run database seeds (idempotent - safe to run multiple times)
    log("Running database seeds...");
    if (!(await runSeeds())) {
      logError("CRITICAL: Database seeding failed.");
      process.exit(1);
    }

    // Step 6: Verify plan_limits are seeded (CRITICAL - app cannot function without this)
    log("Verifying plan_limits seeding...");
    if (!(await verifyPlanLimitsSeeded())) {
      logError("CRITICAL: plan_limits table is empty after seeding.");
      process.exit(1);
    }

    logSuccess("Database migration process completed successfully");
    process.exit(0);
  } catch (err) {
    logError(`Unexpected error: ${err.message}`);
    process.exit(1);
  }
}

// Run the main function
main();
