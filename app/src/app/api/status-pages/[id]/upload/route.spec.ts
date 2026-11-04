/** @jest-environment node */
const send = jest.fn();
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(() => ({ send: (...a: unknown[]) => send(...a) })),
  PutObjectCommand: jest.fn(),
}));
jest.mock("@/utils/db", () => ({
  db: { query: { statusPages: { findFirst: jest.fn(async () => ({ id: "p" })) } }, update: jest.fn() },
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => ({ organizationId: "o", userId: "u1", project: { id: "pr" } })),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn() }));
jest.mock("@/lib/asset-proxy", () => ({ generateProxyUrl: (v: string) => v }));
const mockLimit = jest.fn();
jest.mock("@/lib/api-key-rate-limiter", () => ({
  apiKeyRateLimiter: { checkAndIncrement: (...a: unknown[]) => mockLimit(...a) ?? Promise.resolve({ allowed: true }) },
  createRateLimitHeaders: () => ({ "Retry-After": "30" }),
}));
import { POST } from "./route";
import { requirePermissions } from "@/lib/rbac/middleware";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const params = { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) };
function upload(bytes: Uint8Array, type: string, contentLength: string | null = "2048") {
  const form = new FormData();
  form.set("file", new File([Buffer.from(bytes)], "a", { type }));
  form.set("type", "logo");
  const headers = new Headers();
  if (contentLength !== null) headers.set("content-length", contentLength);
  return POST({ headers, formData: async () => form } as never, params);
}

beforeEach(() => {
  send.mockReset();
  (requirePermissions as jest.Mock).mockReset();
});


it("does not leak storage error details to the client", async () => {
  send.mockRejectedValue(new Error("connect ECONNREFUSED minio.internal:9000"));
  const res = await upload(PNG, "image/png");
  expect(send).toHaveBeenCalled();
  expect(res.status).toBe(500);
  expect(JSON.stringify(await res.json())).not.toContain("minio.internal");
});

it("requires Content-Length and rejects oversized bodies before parsing", async () => {
  expect((await upload(PNG, "image/png", null)).status).toBe(411);
  expect((await upload(PNG, "image/png", String(6 * 1024 * 1024))).status).toBe(413);
  expect(send).not.toHaveBeenCalled();
});

it("rejects content that does not match the declared image type", async () => {
  const res = await upload(new Uint8Array(Buffer.from("<html><script>alert(1)</script></html>")), "image/png");
  expect(res.status).toBe(400);
  expect(send).not.toHaveBeenCalled();
});

it("returns 403 when the caller lacks status_page:update", async () => {
  (requirePermissions as jest.Mock).mockRejectedValue(new Error("Permission check failed: Access denied: Missing status_page:update permission"));
  expect((await upload(PNG, "image/png")).status).toBe(403);
});

it("answers 429 with Retry-After when the upload limit is exceeded", async () => {
  mockLimit.mockResolvedValueOnce({ allowed: false });
  const res = await upload(PNG, "image/png");
  expect(res.status).toBe(429);
  expect(res.headers.get("Retry-After")).toBe("30");
  expect(send).not.toHaveBeenCalled();
});
