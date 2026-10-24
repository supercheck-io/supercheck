/** @jest-environment node */
import { NextRequest } from "next/server";

jest.mock("@/lib/s3-proxy", () => ({
  fetchFromS3: jest.fn(),
}));

jest.mock("@/utils/db", () => ({
  db: {
    query: {
      statusPages: {
        findFirst: jest.fn(),
      },
    },
  },
}));

jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  requirePermissions: jest.fn(),
}));

import { GET, HEAD } from "./route";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { fetchFromS3 } from "@/lib/s3-proxy";
import { db } from "@/utils/db";

const mockFetchFromS3 = fetchFromS3 as jest.MockedFunction<typeof fetchFromS3>;
const mockFindStatusPage = db.query.statusPages.findFirst as jest.Mock;
const mockRequireProjectContext = requireProjectContext as jest.Mock;
const mockRequirePermissions = requirePermissions as jest.Mock;
const PAGE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PAGE_ID = "22222222-2222-4222-8222-222222222222";

describe("Assets Proxy Route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 for keys not scoped to status-pages assets", async () => {
    const request = new NextRequest("http://localhost/api/assets/logo.png");

    const response = await GET(request, {
      params: Promise.resolve({ path: ["logo.png"] }),
    });

    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Asset not found");
    expect(mockFindStatusPage).not.toHaveBeenCalled();
    expect(mockFetchFromS3).not.toHaveBeenCalled();
  });

  it("serves published status-page favicon assets with no-cache override", async () => {
    mockFindStatusPage.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
    mockFetchFromS3.mockResolvedValue(
      new Response("icon-data", {
        status: 200,
        headers: {
          "content-type": "image/x-icon",
        },
      })
    );

    const request = new NextRequest(
      "http://localhost/api/assets/status-pages/11111111-1111-4111-8111-111111111111/favicon/favicon.ico"
    );

    const response = await GET(request, {
      params: Promise.resolve({
        path: ["status-pages", "11111111-1111-4111-8111-111111111111", "favicon", "favicon.ico"],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/x-icon");
    expect(mockFetchFromS3).toHaveBeenCalledWith(
      "status-page-artifacts",
      "status-pages/11111111-1111-4111-8111-111111111111/favicon/favicon.ico",
      {
        cacheControl: "public, max-age=0, must-revalidate",
      }
    );
  });

  it("prevents a published SVG asset from running as a document", async () => {
    mockFindStatusPage.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
    mockFetchFromS3.mockResolvedValue(new Response("<svg><script>1</script></svg>", {
      headers: { "content-type": "image/svg+xml" },
    }));
    const response = await GET(new NextRequest("http://localhost/api/assets/status-pages/11111111-1111-4111-8111-111111111111/logo/x.svg"), {
      params: Promise.resolve({ path: ["status-pages", "11111111-1111-4111-8111-111111111111", "logo", "x.svg"] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("returns 404 for HEAD when status page asset is not published", async () => {
    mockFindStatusPage.mockResolvedValue(null);

    const request = new NextRequest(
      "http://localhost/api/assets/status-pages/22222222-2222-4222-8222-222222222222/banner.png"
    );

    const response = await HEAD(request, {
      params: Promise.resolve({
        path: ["status-pages", "22222222-2222-4222-8222-222222222222", "banner.png"],
      }),
    });

    expect(response.status).toBe(404);
    expect(mockFetchFromS3).not.toHaveBeenCalled();
  });

  describe("draft preview", () => {
    // Published lookup misses, then the authorized-preview lookup finds the page.
    const draftPage = () =>
      mockFindStatusPage.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: PAGE_ID });

    it("serves an authorized draft preview with private, no-store", async () => {
      draftPage();
      mockRequireProjectContext.mockResolvedValue({ project: { id: "p1" }, organizationId: "o1" });
      mockRequirePermissions.mockResolvedValue(undefined);
      mockFetchFromS3.mockResolvedValue(new Response("png", { headers: { "content-type": "image/png" } }));

      const response = await GET(new NextRequest(`http://localhost/api/assets/status-pages/${PAGE_ID}/logo/a.png`), {
        params: Promise.resolve({ path: ["status-pages", PAGE_ID, "logo", "a.png"] }),
      });

      expect(response.status).toBe(200);
      expect(mockRequirePermissions).toHaveBeenCalledWith(
        { status_page: ["view"] },
        { organizationId: "o1", projectId: "p1" }
      );
      expect(mockFetchFromS3).toHaveBeenCalledWith(
        "status-page-artifacts",
        `status-pages/${PAGE_ID}/logo/a.png`,
        { cacheControl: "private, no-store" }
      );
    });

    it("returns 404 when the viewer lacks status_page view permission", async () => {
      draftPage();
      mockRequireProjectContext.mockResolvedValue({ project: { id: "p1" }, organizationId: "o1" });
      mockRequirePermissions.mockRejectedValue(new Error("forbidden"));

      const response = await GET(new NextRequest(`http://localhost/api/assets/status-pages/${PAGE_ID}/logo/a.png`), {
        params: Promise.resolve({ path: ["status-pages", PAGE_ID, "logo", "a.png"] }),
      });

      expect(response.status).toBe(404);
      expect(mockFetchFromS3).not.toHaveBeenCalled();
    });
  });

  describe("key validation", () => {
    it.each([
      ["a dot-dot segment", ["status-pages", PAGE_ID, "..", OTHER_PAGE_ID, "logo.png"]],
      ["a dot segment", ["status-pages", PAGE_ID, ".", "logo.png"]],
      ["a backslash segment", ["status-pages", PAGE_ID, "..\\x", "logo.png"]],
      ["a non-uuid status page id", ["status-pages", "not-a-uuid", "logo.png"]],
    ])("returns 404 without querying or fetching for %s", async (_name, path) => {
      const response = await GET(new NextRequest(`http://localhost/api/assets/${path.join("/")}`), {
        params: Promise.resolve({ path }),
      });

      expect(response.status).toBe(404);
      expect(mockFindStatusPage).not.toHaveBeenCalled();
      expect(mockFetchFromS3).not.toHaveBeenCalled();
    });
  });
});
