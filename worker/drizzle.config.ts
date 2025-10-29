import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const dbHost = process.env.DB_HOST || "postgres";
const dbPort = parseInt(process.env.DB_PORT || "5432");
const dbUser = process.env.DB_USER || "postgres";
const dbPassword = process.env.DB_PASSWORD || "postgrespassword";
const dbName = process.env.DB_NAME || "supercheck";

export default defineConfig({
  out: "./src/db/migrations",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    ssl: false,
  },
  verbose: true,
  strict: true,
});
