/** @jest-environment node */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../../..");
const dbName = `mcp_oauth_db_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
let maintenance: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${dbName}"`);
}, 60_000);

afterAll(async () => {
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

// Real Better Auth against real PostgreSQL. jest mocks `better-auth`, so it runs under tsx.
describe("MCP OAuth against PostgreSQL", () => {
  it("disconnecting one project leaves the same client's other project connected", async () => {
    const target = new URL(process.env.TEST_DATABASE_URL as string);
    target.pathname = `/${dbName}`;
    const env = {
      ...process.env,
      DATABASE_URL: target.toString(),
      SELF_HOSTED: "true",
      NODE_ENV: "test",
      MCP_SERVER_ENABLED: "true",
      APP_URL: "http://localhost:3000",
      BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "mcp-oauth-db-check-secret-mcp-oauth-db-1",
    } as NodeJS.ProcessEnv;
    await execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], { cwd: APP_ROOT, env, timeout: 90_000 });

    const { stdout } = await execFileAsync(
      process.execPath,
      [require.resolve("tsx/cli"), "scripts/check-mcp-oauth-db.ts"],
      { cwd: APP_ROOT, env, timeout: 90_000 },
    );
    expect(stdout).toContain("MCP OAuth database check passed");
    expect(stdout).not.toContain("FAIL");
  }, 200_000);
});
