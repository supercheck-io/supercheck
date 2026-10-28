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
  requireAuthContext: jest.fn(async () => ({ organizationId: "o", project: { id: "pr" } })),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn() }));
jest.mock("@/lib/asset-proxy", () => ({ generateProxyUrl: (v: string) => v }));
import { POST } from "./route";

it("does not leak storage error details to the client", async () => {
  send.mockRejectedValue(new Error("connect ECONNREFUSED minio.internal:9000"));
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
  form.set("type", "logo");
  const res = await POST({ formData: async () => form } as never, {
    params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }),
  });
  expect(res.status).toBe(500);
  expect(JSON.stringify(await res.json())).not.toContain("minio.internal");
});
