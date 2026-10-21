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
  it("the Drizzle schema can hold everything Better Auth writes", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [path.join(APP_ROOT, "node_modules/tsx/dist/cli.mjs"), "scripts/check-auth-schema.ts"],
      {
        cwd: APP_ROOT,
        env: {
          ...process.env,
          BETTER_AUTH_SECRET: "schema-contract-secret-schema-contract-1",
          BETTER_AUTH_URL: "http://localhost:3000",
        },
        timeout: 60_000,
      },
    );
    expect(stdout).toContain("Better Auth schema check passed");
  }, 90_000);
});
