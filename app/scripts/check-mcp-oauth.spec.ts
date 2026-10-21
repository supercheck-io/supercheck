/** @jest-environment node */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "..");

// Drives the real OAuth/MCP authorization server end to end on an in-memory
// Better Auth instance. jest mocks `better-auth`, so it runs under tsx.
describe("MCP OAuth authorization server on the installed Better Auth", () => {
  it("registers only public clients, enforces PKCE, binds tokens to the project and the MCP URL, and rotates refresh tokens", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [path.join(APP_ROOT, "node_modules/tsx/dist/cli.mjs"), "scripts/check-mcp-oauth.ts"],
      { cwd: APP_ROOT, env: { ...process.env }, timeout: 90_000 },
    );
    expect(stdout).toContain("MCP OAuth server check passed");
    expect(stdout).not.toContain("FAIL");
  }, 120_000);
});
