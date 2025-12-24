import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Log the database connection configuration for debugging
const dbHost = process.env.DB_HOST || "localhost";
const dbPort = parseInt(process.env.DB_PORT || "5432");
const dbUser = process.env.DB_USER || "postgres";
const dbPassword = process.env.DB_PASSWORD || "postgres";
const dbName = process.env.DB_NAME || "supercheck";

// SSL: Use DB_SSL env var if set, otherwise enable for non-localhost hosts
const dbSsl = process.env.DB_SSL 
  ? process.env.DB_SSL === "true" 
  : dbHost !== "localhost" && dbHost !== "127.0.0.1" && dbHost !== "postgres";

console.log(`Database connection config: ${dbHost}:${dbPort} as ${dbUser}`);

export default defineConfig({
  out: "./src/db/migrations",
  schema: ["./src/db/schema/*.ts"],
  dialect: "postgresql",
  dbCredentials: {
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    ssl: dbSsl,
  },
  verbose: true,
  strict: true,
});
