/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST } from "./route";

jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn().mockResolvedValue({}),
  isAuthError: jest.fn().mockReturnValue(false),
}));

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
