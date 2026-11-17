/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST } from "./route";
import { checkAdminRateLimit } from "@/lib/session-security";

jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn().mockResolvedValue({ userId: "user-1" }),
  isAuthError: jest.fn().mockReturnValue(false),
}));
jest.mock("@/lib/session-security", () => ({
  checkAdminRateLimit: jest.fn(),
}));

beforeEach(() => {
  jest.mocked(checkAdminRateLimit).mockResolvedValue({ allowed: true });
});

it("rate limits validation requests per user", async () => {
  jest
    .mocked(checkAdminRateLimit)
    .mockResolvedValue({ allowed: false, resetTime: Date.now() + 30_000 });
  const response = await POST(
    new NextRequest("http://localhost/api/validate-script", {
      method: "POST",
      body: JSON.stringify({ script: "const a = 1;" }),
    }),
  );
  expect(response.status).toBe(429);
  expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
});

it.each([null, [], {}, { script: 123 }])(
  "rejects malformed validation payload %p",
  async (payload) => {
    const response = await POST(
      new NextRequest("http://localhost/api/validate-script", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
    expect(response.status).toBe(400);
  },
);

it("rejects malformed JSON", async () => {
  const response = await POST(
    new NextRequest("http://localhost/api/validate-script", {
      method: "POST",
      body: "{",
    }),
  );
  expect(response.status).toBe(400);
});

it.each(["k6", "PERFORMANCE", "load"])(
  "normalizes performance alias %s",
  async (testType) => {
    const response = await POST(
      new NextRequest("http://localhost/api/validate-script", {
        method: "POST",
        body: JSON.stringify({
          testType,
          script:
            "import http from 'k6/http'; export default function() { http.get('https://example.com'); }",
        }),
      }),
    );
    expect(response.status).toBe(200);
  },
);

it("rejects oversized chunked bodies that carry no Content-Length", async () => {
  const chunk = new TextEncoder().encode("a".repeat(1_000_000));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < 5; i++) controller.enqueue(chunk);
      controller.close();
    },
  });
  const response = await POST(
    new NextRequest("http://localhost/api/validate-script", {
      method: "POST",
      body,
      duplex: "half",
    } as unknown as ConstructorParameters<typeof NextRequest>[1]),
  );
  expect(response.status).toBe(413);
});

it("refuses a cross-origin cookie request before spending the rate limit, but not a CLI token", async () => {
  const cross = () => POST(new NextRequest("http://localhost/api/validate-script", {
    method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ script: "const a = 1;" }),
  }));
  const calls = jest.mocked(checkAdminRateLimit).mock.calls.length;
  expect((await cross()).status).toBe(403);
  expect(jest.mocked(checkAdminRateLimit).mock.calls.length).toBe(calls);
  const { requireAuthContext } = jest.requireMock("@/lib/auth-context") as { requireAuthContext: jest.Mock };
  requireAuthContext.mockResolvedValueOnce({ userId: "user-1", isCliAuth: true });
  expect((await cross()).status).not.toBe(403);
});
