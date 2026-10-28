/** @jest-environment node */

jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));
jest.mock("@/db/schema", () => ({ reports: {}, runs: {}, projects: {} }));
jest.mock("@/lib/s3-proxy", () => ({ fetchFromS3: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn() }));
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn(),
  isAuthError: jest.fn(),
}));
jest.mock("@/lib/report-results-utils", () => ({}));
jest.mock("@/lib/test-results-access", () => ({
  getReportCacheControl: () => "private, no-store",
  getPermissionResource: () => "test",
  resolveAccessContext: jest.fn(),
}));

import { db } from "@/utils/db";
import { fetchFromS3 } from "@/lib/s3-proxy";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { requireUserAuthContext } from "@/lib/auth-context";
import { resolveAccessContext } from "@/lib/test-results-access";
import { mintReportToken } from "@/lib/reports-origin";
import { GET } from "./route";

const ENTITY = "run-id";
const APP = "https://app.example";
const REPORTS = "https://reports.example.net";

const get = (host: string, path: string) => new Request(`${host}/api/test-results/${path}`);

describe("reports origin enforcement", () => {
  const original = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SECRET_ENCRYPTION_KEY = "a".repeat(64);
    process.env.APP_URL = APP;
    process.env.REPORTS_ORIGIN = REPORTS;
    jest.mocked(requireUserAuthContext).mockResolvedValue({ userId: "viewer" } as never);
    jest.mocked(hasPermissionForUser).mockResolvedValue(true);
    jest.mocked(resolveAccessContext).mockResolvedValue({ organizationId: "org", projectId: "project-id" });
    (db.select as jest.Mock).mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () =>
            Promise.resolve([
              {
                entityType: "test",
                s3Url: "https://storage.example/bucket/run-id/report/index.html",
                reportPath: "run-id/report",
                status: "passed",
              },
            ]),
        }),
      }),
    });
    jest.mocked(fetchFromS3).mockImplementation(
      async () => new Response("<html></html>", { headers: { "Content-Type": "text/html" } })
    );
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("serves a report on the reports host with a valid token and no session", async () => {
    const token = mintReportToken(ENTITY, "project-id");
    const res = await GET(get(REPORTS, `${token}/${ENTITY}/report/index.html`));
    expect(res.status).toBe(200);
    expect(requireUserAuthContext).not.toHaveBeenCalled();
    expect(hasPermissionForUser).not.toHaveBeenCalled();
    expect(res.headers.get("content-security-policy")).toBe(`frame-ancestors ${APP}`);
  });

  it("refuses the reports host without a token or with an invalid one", async () => {
    expect((await GET(get(REPORTS, `${ENTITY}/report/index.html`))).status).toBe(401);
    const token = mintReportToken(ENTITY, "project-id");
    expect((await GET(get(REPORTS, `${token}x/${ENTITY}/report/index.html`))).status).toBe(401);
    expect(fetchFromS3).not.toHaveBeenCalled();
  });

  it("refuses a token minted for another report or another project", async () => {
    const other = mintReportToken("other-run", "project-id");
    expect((await GET(get(REPORTS, `${other}/${ENTITY}/report/index.html`))).status).toBe(401);
    const wrongProject = mintReportToken(ENTITY, "other-project");
    expect((await GET(get(REPORTS, `${wrongProject}/${ENTITY}/report/index.html`))).status).toBe(403);
  });

  it("refuses an expired token", async () => {
    const expired = mintReportToken(ENTITY, "project-id", Date.now() - 3_600_000 - 1000);
    expect((await GET(get(REPORTS, `${expired}/${ENTITY}/report/index.html`))).status).toBe(401);
  });

  it("does not serve report HTML on the app host, nor accept a token there", async () => {
    const res = await GET(get(APP, `${ENTITY}/report/index.html`));
    expect(res.status).toBe(404);
    const token = mintReportToken(ENTITY, "project-id");
    expect((await GET(get(APP, `${token}/${ENTITY}/report/index.html`))).status).toBe(404);
  });

  it("still serves non-document report files on the app host", async () => {
    jest.mocked(fetchFromS3).mockImplementation(
      async () => new Response("{}", { headers: { "Content-Type": "application/json" } })
    );
    expect((await GET(get(APP, `${ENTITY}/summary.json`))).status).toBe(200);
  });

  it("behaves as before when REPORTS_ORIGIN is unset", async () => {
    delete process.env.REPORTS_ORIGIN;
    const res = await GET(get(APP, `${ENTITY}/report/index.html`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(requireUserAuthContext).toHaveBeenCalled();
  });
});
