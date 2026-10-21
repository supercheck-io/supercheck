/** @jest-environment node */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "..");

// Better Auth fails every request with a SchemaMismatchError when our Drizzle
// tables cannot hold what it writes. jest mocks `better-auth`, so the real
// check runs in a child process under tsx.
describe("Better Auth schema contract", () => {
  async function run(extraEnv: Record<string, string>) {
    return execFileAsync(
      process.execPath,
      [require.resolve("tsx/cli"), "scripts/check-auth-schema.ts"],
      {
        cwd: APP_ROOT,
        env: {
          ...process.env,
          BETTER_AUTH_SECRET: "schema-contract-secret-schema-contract-1",
          BETTER_AUTH_URL: "http://localhost:3000",
          ...extraEnv,
        },
        timeout: 60_000,
      },
    );
  }

  it("the Drizzle schema can hold everything Better Auth writes", async () => {
    const { stdout } = await run({ MCP_SERVER_ENABLED: "false" });
    expect(stdout).toContain("Better Auth schema check passed");
  }, 90_000);

  // The OAuth/MCP plugins add eight tables; the check must hold when they are registered too.
  it("the Drizzle schema also holds the OAuth and MCP tables when the MCP server is enabled", async () => {
    const { stdout } = await run({ MCP_SERVER_ENABLED: "true", APP_URL: "http://localhost:3000" });
    expect(stdout).toContain("Better Auth schema check passed");
  }, 90_000);
});
