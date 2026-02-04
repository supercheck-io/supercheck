import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Log the database connection configuration for debugging
const dbHost = process.env.DB_HOST || "localhost";
const dbPort = parseInt(process.env.DB_PORT || "5432");
const dbUser = process.env.DB_USER || "postgres";
const dbPassword = process.env.DB_PASSWORD || "postgres";
const dbName = process.env.DB_NAME || "supercheck";

// SSL: Enable only in cloud mode
const isSelfHosted = process.env.SELF_HOSTED?.toLowerCase() === "true";
const dbSsl = !isSelfHosted;

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
