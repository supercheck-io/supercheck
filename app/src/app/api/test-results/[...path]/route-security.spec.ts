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
  getPermissionResource: (t: string) =>
    t === "test" ? "test" : t === "monitor" ? "monitor" : "run",
  getReportCacheControl: () => "private, no-store, no-cache, must-revalidate",
  resolveAccessContext: jest.fn(),
}));

import { db } from "@/utils/db";
import { fetchFromS3 } from "@/lib/s3-proxy";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { requireUserAuthContext } from "@/lib/auth-context";
import { resolveAccessContext } from "@/lib/test-results-access";
import { GET } from "./route";

const attachment = '<script>document.title = "attachment executed"</script>';
let entityType = "test";

// The in-app viewer loads reports as a same-origin iframe.
const viewerHeaders = { "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Site": "same-origin" };

function request(file: string, query = "") {
  return new Request(
    `https://app.example/api/test-results/run-id/${file}${query}`,
    { headers: viewerHeaders },
  );
}

describe("report artifact response security", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    entityType = "test";
    jest
      .mocked(requireUserAuthContext)
      .mockResolvedValue({ userId: "viewer" } as Awaited<
        ReturnType<typeof requireUserAuthContext>
      >);
    jest.mocked(hasPermissionForUser).mockResolvedValue(true);
    jest.mocked(resolveAccessContext).mockResolvedValue({
      organizationId: "org-id",
      projectId: "project-id",
    });
    (db.select as jest.Mock).mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () =>
            Promise.resolve([
              {
                entityType,
                s3Url:
                  "https://storage.example/bucket/run-id/report/index.html",
                reportPath: "run-id/report",
                status: "passed",
              },
            ]),
        }),
      }),
    });
    jest.mocked(fetchFromS3).mockImplementation(
      async () =>
        new Response(attachment, {
          headers: { "Content-Type": "text/html" },
        }),
    );
  });

  it.each(["", "?forceIframe=true"])(
    "downloads and sandboxes HTML attachments despite display flags %s",
    async (query) => {
      const response = await GET(request("report/data/evidence.html", query));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toMatch(
        /^attachment;/,
      );
      expect(response.headers.get("content-security-policy")).toContain(
        "sandbox;",
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.text()).toBe(attachment);
    },
  );

  it.each([
    ["k6_test", "report.html"],
    ["k6_test", "report/report.html"],
    ["k6_job", "report.html"],
    ["k6_job", "report/report.html"],
  ])("keeps the legacy k6 document usable for %s at %s", async (type, file) => {
    entityType = type;
    const response = await GET(request(file, "?forceIframe=true"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(await response.text()).toBe(attachment);
  });

  it.each([
    ["data/evidence.svg", "image/svg+xml"],
    ["data/evidence.xhtml", "application/xhtml+xml"],
    ["data/evidence.xml", "text/xml"],
    ["data/evidence.bin", "TEXT/HTML; charset=UTF-8"],
    ["data/evidence.html", "text/plain"],
    ["data/index.html", "text/html"],
    ["other/evidence.html", "text/html"],
    ["trace/data/evidence.html", "text/html"],
    ["data/evidence.dat", "application/octet-stream"],
  ])(
    "prevents active or unknown documents at %s (%s)",
    async (file, contentType) => {
      jest.mocked(fetchFromS3).mockResolvedValue(
        new Response(attachment, {
          headers: { "Content-Type": contentType },
        }),
      );
      const response = await GET(request(file));
      expect(response.headers.get("content-disposition")).toMatch(
        /^attachment;/,
      );
      expect(response.headers.get("content-security-policy")).toContain(
        "sandbox;",
      );
    },
  );

  it.each([
    "",
    "index.html",
    "report/index.html",
    "trace/index.html",
    "report/trace/index.html",
    "trace/snapshot.html",
    "trace/uiMode.html",
  ])(
    "keeps generated report and trace documents usable at %s",
    async (file) => {
      const response = await GET(request(file, "?forceIframe=true"));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html");
      expect(response.headers.get("content-disposition")).toBeNull();
      expect(response.headers.get("content-security-policy")).toBeNull();
      expect(await response.text()).toBe(attachment);
    },
  );

  it("sandboxes a generated document requested without fetch metadata", async () => {
    const response = await GET(new Request("https://app.example/api/test-results/run-id/report/index.html"));
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
  });

  it.each(["report/index.html", "report/trace/index.html", "report.html"])(
    "isolates a generated document opened as a top-level page at %s",
    async (file) => {
      entityType = "k6_job";
      const response = await GET(
        new Request(`https://app.example/api/test-results/run-id/${file}`, {
          headers: { "Sec-Fetch-Dest": "document", "Sec-Fetch-Site": "none" },
        }),
      );
      const csp = response.headers.get("content-security-policy") ?? "";
      // Opaque origin: test-authored script cannot use the viewer's session.
      expect(csp).toContain("sandbox allow-scripts");
      expect(csp).not.toContain("allow-same-origin");
    },
  );

  it.each([
    ["data/screenshot.png", "image/png"],
    ["data/video.webm", "video/webm"],
    ["data/log.txt", "text/plain"],
    ["trace/assets/viewer.js", "application/javascript"],
    ["trace/assets/viewer.css", "text/css"],
    ["trace/sw.bundle.js", "application/javascript"],
  ])(
    "preserves inline rendering or loading for %s",
    async (file, contentType) => {
      jest.mocked(fetchFromS3).mockResolvedValue(
        new Response("asset bytes", {
          headers: { "Content-Type": contentType },
        }),
      );
      const response = await GET(request(file));
      expect(response.headers.get("content-disposition") || "").not.toMatch(
        /^attachment;/,
      );
      expect(response.headers.get("content-type")).toBe(contentType);
      expect(await response.text()).toBe("asset bytes");
    },
  );

  it("keeps trace zip bytes readable by fetch", async () => {
    jest.mocked(fetchFromS3).mockResolvedValue(
      new Response("zip bytes", {
        headers: { "Content-Type": "application/zip" },
      }),
    );
    const response = await GET(request("data/trace.zip"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("zip bytes");
  });

  it("rejects unauthorized viewers before fetching artifacts", async () => {
    jest.mocked(hasPermissionForUser).mockResolvedValue(false);
    const response = await GET(request("data/evidence.html"));
    expect(response.status).toBe(403);
    expect(fetchFromS3).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests before reading report metadata", async () => {
    jest
      .mocked(requireUserAuthContext)
      .mockRejectedValue(new Error("No session"));
    const response = await GET(request("data/evidence.html"));
    expect(response.status).toBe(401);
    expect(db.select).not.toHaveBeenCalled();
    expect(fetchFromS3).not.toHaveBeenCalled();
  });
});
