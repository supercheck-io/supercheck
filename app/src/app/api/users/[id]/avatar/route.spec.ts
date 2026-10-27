jest.mock("@aws-sdk/client-s3", () => ({ S3Client: jest.fn(() => ({ send: jest.fn() })), PutObjectCommand: jest.fn(), GetObjectCommand: jest.fn(), DeleteObjectCommand: jest.fn() }));
const mockViewer = jest.fn();
const mockGet = jest.fn();
const mockRows = jest.fn();

jest.mock("@/utils/db", () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => mockRows();
  return { db: { select: () => chain } };
});
jest.mock("@/db/schema", () => ({ member: { id: "id", userId: "u", organizationId: "o" }, user: { id: "id", image: "image" } }));
jest.mock("drizzle-orm", () => ({ and: jest.fn(), eq: jest.fn() }));
jest.mock("drizzle-orm/pg-core", () => ({ alias: (t: unknown) => t }));
jest.mock("@/lib/session", () => ({ getCurrentUser: () => mockViewer() }));
jest.mock("@/lib/user-avatar", () => ({ ...jest.requireActual("@/lib/user-avatar"), getAvatar: (...a: unknown[]) => mockGet(...a) }));

import { GET } from "./route";

const TARGET = "0192a000-0000-7000-8000-000000000001";
const VERSION = `${"c".repeat(32)}.webp`;
const call = (id = TARGET) => GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });

describe("GET /api/users/[id]/avatar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockViewer.mockResolvedValue({ id: "0192a000-0000-7000-8000-000000000002" });
    mockGet.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it("404 for a malformed id", async () => {
    expect((await call("nope")).status).toBe(404);
  });

  it("401 when signed out", async () => {
    mockViewer.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("403 when the users share no organization", async () => {
    mockRows.mockResolvedValueOnce([]);
    const res = await call();
    expect(res.status).toBe(403);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("serves the image with safe headers to an organization peer", async () => {
    mockRows.mockResolvedValueOnce([{ id: "m" }]).mockResolvedValueOnce([{ image: `/api/users/${TARGET}/avatar?v=${VERSION}` }]);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toContain("private");
    expect(mockGet).toHaveBeenCalledWith(TARGET, VERSION);
  });

  it("serves the owner without a membership lookup", async () => {
    mockViewer.mockResolvedValue({ id: TARGET });
    mockRows.mockResolvedValueOnce([{ image: `/api/users/${TARGET}/avatar?v=${VERSION}` }]);
    expect((await call()).status).toBe(200);
  });

  it("404 when the profile image is not a stored avatar (e.g. an OAuth URL)", async () => {
    mockViewer.mockResolvedValue({ id: TARGET });
    mockRows.mockResolvedValueOnce([{ image: "https://example.com/a.png" }]);
    expect((await call()).status).toBe(404);
  });
});
