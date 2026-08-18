const fs = require("node:fs");
const path = require("node:path");

describe("production startup script security", () => {
  const startScript = fs.readFileSync(path.join(__dirname, "start.sh"), "utf8");

  it("reports sensitive database configuration by presence only", () => {
    expect(startScript).toContain('log_env_presence "DATABASE_URL"');
    expect(startScript).not.toMatch(/DATABASE_URL:\s*\$\{/);
    expect(startScript).not.toMatch(/DB_(?:HOST|PORT|USER|NAME):\s*\$\{/);
  });

  it("fails closed instead of starting the Next.js development server", () => {
    expect(startScript).not.toContain("npm run dev");
    expect(startScript).toContain(
      "server.js not found. The standalone production build is incomplete.",
    );
  });
});
