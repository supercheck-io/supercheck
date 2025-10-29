#!/usr/bin/env node

/**
 * Simple and Robust Database Migration Script
 * Handles all migration scenarios in a clean, predictable way
 */

const { drizzle } = require("drizzle-orm/postgres-js");
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
const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

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

// Function to wait for database to be ready
async function waitForDatabase() {
  log("Waiting for database to be ready...");

  const adminConnectionString = `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log(`Attempt ${attempt}/${MAX_RETRIES}: Checking database connection...`);

    try {
      const client = postgres(adminConnectionString);
      await client`SELECT 1`;
      await client.end();
      logSuccess("Database is ready");
      return true;
    } catch (err) {
      log(`Database not ready: ${err.message}`);

      if (attempt < MAX_RETRIES) {
        log(`Waiting ${RETRY_DELAY}ms before next attempt...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }

  logError("Database failed to become ready after maximum attempts");
  return false;
}

// Function to create database if it doesn't exist
async function createDatabaseIfNotExists() {
  log(`Checking if database '${DB_NAME}' exists...`);

  const targetConnectionString = `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
  const adminConnectionString = `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres`;

  try {
    // Try to connect to the target database
    const targetClient = postgres(targetConnectionString);
    await targetClient`SELECT 1`;
    await targetClient.end();
    logSuccess(`Database '${DB_NAME}' exists and is accessible`);
    return true;
  } catch (err) {
    if (err.message.includes("does not exist")) {
      log(`Database '${DB_NAME}' does not exist, creating it...`);

      try {
        const adminClient = postgres(adminConnectionString);
        await adminClient`CREATE DATABASE ${adminClient.unsafe(DB_NAME)}`;
        await adminClient.end();
        logSuccess(`Database '${DB_NAME}' created successfully`);
        return true;
      } catch (createErr) {
        logError(
          `Failed to create database '${DB_NAME}': ${createErr.message}`
        );
        return false;
      }
    } else {
      logError(`Database connection error: ${err.message}`);
      return false;
    }
  }
}

// Function to run migrations
async function runMigrations() {
  log("Running database migrations...");

  try {
    // Connect to the database
    const client = postgres(DATABASE_URL);
    const db = drizzle(client);

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

// Function to verify migrations
async function verifyMigrations() {
  log("Verifying migrations...");

  try {
    const client = postgres(DATABASE_URL);

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

// Main function
async function main() {
  try {
    log("Starting database migration process...");
    log(`Database URL: ${DATABASE_URL.replace(/:[^:@]*@/, ":***@")}`);

    // Step 1: Wait for database to be ready
    if (!(await waitForDatabase())) {
      process.exit(1);
    }

    // Step 2: Create database if it doesn't exist
    if (!(await createDatabaseIfNotExists())) {
      process.exit(1);
    }

    // Step 3: Run migrations
    if (!(await runMigrations())) {
      process.exit(1);
    }

    // Step 4: Verify migrations
    if (!(await verifyMigrations())) {
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
