/** @jest-environment node */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "..");

// Runs Polar's webhook endpoint inside a real Better Auth instance. jest mocks
// `better-auth`, so the check runs in a child process under tsx.
describe("Polar webhook endpoint on the installed Better Auth", () => {
  it("accepts a signed event, dispatches it, and rejects a forged one", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [require.resolve("tsx/cli"), "scripts/check-polar-webhooks.ts"],
      { cwd: APP_ROOT, env: { ...process.env }, timeout: 60_000 },
    );
    expect(stdout).toContain("Polar webhook endpoint check passed");
  }, 90_000);
});
