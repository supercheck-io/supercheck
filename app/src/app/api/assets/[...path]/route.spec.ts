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

import { GET, HEAD } from "./route";
import { fetchFromS3 } from "@/lib/s3-proxy";
import { db } from "@/utils/db";

const mockFetchFromS3 = fetchFromS3 as jest.MockedFunction<typeof fetchFromS3>;
const mockFindStatusPage = db.query.statusPages.findFirst as jest.Mock;

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
    mockFindStatusPage.mockResolvedValue({ id: "status-1" });
    mockFetchFromS3.mockResolvedValue(
      new Response("icon-data", {
        status: 200,
        headers: {
          "content-type": "image/x-icon",
        },
      })
    );

    const request = new NextRequest(
      "http://localhost/api/assets/status-pages/status-1/favicon/favicon.ico"
    );

    const response = await GET(request, {
      params: Promise.resolve({
        path: ["status-pages", "status-1", "favicon", "favicon.ico"],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/x-icon");
    expect(mockFetchFromS3).toHaveBeenCalledWith(
      "status-page-artifacts",
      "status-pages/status-1/favicon/favicon.ico",
      {
        cacheControl: "public, max-age=0, must-revalidate",
      }
    );
  });

  it("returns 404 for HEAD when status page asset is not published", async () => {
    mockFindStatusPage.mockResolvedValue(null);

    const request = new NextRequest(
      "http://localhost/api/assets/status-pages/status-2/banner.png"
    );

    const response = await HEAD(request, {
      params: Promise.resolve({
        path: ["status-pages", "status-2", "banner.png"],
      }),
    });

    expect(response.status).toBe(404);
    expect(mockFetchFromS3).not.toHaveBeenCalled();
  });
});
