/** @jest-environment node */

jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));
jest.mock("@/db/schema", () => ({ reports: {}, runs: {}, projects: {} }));
jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn() }));
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn(),
  isAuthError: jest.fn(() => true),
}));
jest.mock("@/lib/test-results-access", () => ({
  getPermissionResource: () => "test",
  resolveAccessContext: jest.fn(),
}));

import { db } from "@/utils/db";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { requireUserAuthContext } from "@/lib/auth-context";
import { resolveAccessContext } from "@/lib/test-results-access";
import { verifyReportToken } from "@/lib/reports-origin";
import { POST } from "./route";

const post = (path: unknown) =>
  new Request("https://app.example/api/report-urls", {
    method: "POST",
    body: JSON.stringify({ path }),
  });

describe("POST /api/report-urls", () => {
  const original = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SECRET_ENCRYPTION_KEY = "a".repeat(64);
    process.env.REPORTS_ORIGIN = "https://reports.example.net";
    jest.mocked(requireUserAuthContext).mockResolvedValue({ userId: "u" } as never);
    jest.mocked(hasPermissionForUser).mockResolvedValue(true);
    jest.mocked(resolveAccessContext).mockResolvedValue({ organizationId: "org", projectId: "project-id" });
    (db.select as jest.Mock).mockReturnValue({
      from: () => ({ where: () => ({ orderBy: () => Promise.resolve([{ entityType: "test" }]) }) }),
    });
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("returns null without touching auth when REPORTS_ORIGIN is unset", async () => {
    delete process.env.REPORTS_ORIGIN;
    const res = await POST(post("/api/test-results/run-id/report/index.html"));
    expect(await res.json()).toEqual({ url: null });
    expect(requireUserAuthContext).not.toHaveBeenCalled();
  });

  it("mints a URL on the reports origin bound to the report and project", async () => {
    const res = await POST(post("/api/test-results/run-id/report/index.html?forceIframe=true"));
    const { url } = await res.json();
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://reports.example.net");
    expect(parsed.search).toBe("?forceIframe=true");
    const [token, id, ...rest] = parsed.pathname.split("/").slice(3);
    expect(id).toBe("run-id");
    expect(rest.join("/")).toBe("report/index.html");
    expect(verifyReportToken(decodeURIComponent(token), "run-id")).toEqual({ projectId: "project-id" });
  });

  it("refuses a caller without view permission", async () => {
    jest.mocked(hasPermissionForUser).mockResolvedValue(false);
    expect((await POST(post("/api/test-results/run-id/report/index.html"))).status).toBe(403);
  });

  it("rejects paths outside the report API", async () => {
    expect((await POST(post("/api/other"))).status).toBe(400);
    expect((await POST(post(42))).status).toBe(400);
  });
});
