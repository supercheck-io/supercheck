import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { drizzleLogger } from "@/lib/logger/drizzle-logger";

const connectionString =
  process.env.DATABASE_URL ||
  `postgres://${process.env.DB_USER || "postgres"}:${
    process.env.DB_PASSWORD || "postgres"
  }@${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || "5432"}/${
    process.env.DB_NAME || "supercheck"
  }`;

// Connection pool configuration for Next.js app with schedulers and API routes
// See: https://github.com/porsager/postgres#connection-pool
const client = postgres(connectionString, {
  max: parseInt(process.env.DB_POOL_MAX || "10", 10), // Default: 10 connections
  idle_timeout: parseInt(process.env.DB_IDLE_TIMEOUT || "30", 10), // Default: 30 seconds
  connect_timeout: parseInt(process.env.DB_CONNECT_TIMEOUT || "10", 10), // Default: 10 seconds
  max_lifetime: parseInt(process.env.DB_MAX_LIFETIME || "1800", 10), // Default: 30 minutes (in seconds)
});

// Use custom Pino logger for Drizzle queries
// In development: use Pino logger (controlled by LOG_DB_QUERIES env var)
// In production: disable query logging for performance
const isDevelopment = process.env.NODE_ENV === "development";
export const db = drizzle(client, {
  schema,
  logger: isDevelopment ? drizzleLogger : false
});
