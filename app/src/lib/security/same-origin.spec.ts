/** @jest-environment node */
import { NextRequest } from "next/server";
import { requireSameOriginRequest, requireSessionSameOrigin } from "./same-origin";

const req = (headers: Record<string, string>) => new NextRequest("http://localhost/api/x", { method: "POST", headers });

describe("requireSameOriginRequest", () => {
  it("allows the app's own origin and refuses another", () => {
    expect(requireSameOriginRequest(req({ origin: "http://localhost" }))).toBeNull();
    expect(requireSameOriginRequest(req({ origin: "https://evil.example" }))?.status).toBe(403);
  });

  it("falls back to Referer only when Origin is absent", () => {
    expect(requireSameOriginRequest(req({ referer: "http://localhost/monitors" }))).toBeNull();
    expect(requireSameOriginRequest(req({ referer: "https://evil.example/x" }))?.status).toBe(403);
  });

  it('treats "Origin: null" as a mismatch even with a same-origin Referer or allowMissing', () => {
    expect(requireSameOriginRequest(req({ origin: "null", referer: "http://localhost/x" }))?.status).toBe(403);
    expect(requireSameOriginRequest(req({ origin: "null" }), { allowMissing: true })?.status).toBe(403);
  });

  it("lets a request with neither header through only with allowMissing", () => {
    expect(requireSameOriginRequest(req({}))?.status).toBe(403);
    expect(requireSameOriginRequest(req({}), { allowMissing: true })).toBeNull();
  });
});

describe("requireSessionSameOrigin", () => {
  it("refuses a cross-origin cookie session, allows same-origin and header-less clients", () => {
    expect(requireSessionSameOrigin(req({ origin: "https://evil.example" }))?.status).toBe(403);
    expect(requireSessionSameOrigin(req({ origin: "http://localhost" }))).toBeNull();
    expect(requireSessionSameOrigin(req({}))).toBeNull();
  });

  it("does not apply to CLI-token callers", () => {
    expect(requireSessionSameOrigin(req({ origin: "https://evil.example" }), true)).toBeNull();
  });
});

describe("behind a proxy", () => {
  // Standalone Next builds request.url from its own bind address, not the public host.
  const internal = (headers: Record<string, string>) => new NextRequest("http://0.0.0.0:3000/api/x", { method: "POST", headers });
  it("accepts the origin the browser addressed through Host or X-Forwarded-Host/Proto", () => {
    expect(requireSameOriginRequest(internal({ origin: "http://checks.example.com", host: "checks.example.com" }))).toBeNull();
    expect(requireSameOriginRequest(internal({ origin: "https://checks.example.com", "x-forwarded-host": "checks.example.com, proxy.internal", "x-forwarded-proto": "https" }))).toBeNull();
  });
  it("still refuses an origin that is not the addressed host", () => {
    expect(requireSameOriginRequest(internal({ origin: "https://evil.example", host: "checks.example.com" }))?.status).toBe(403);
    expect(requireSameOriginRequest(internal({ origin: "http://checks.example.com", "x-forwarded-host": "checks.example.com", "x-forwarded-proto": "https" }))?.status).toBe(403);
    expect(requireSameOriginRequest(internal({ origin: "javascript://checks.example.com", host: "checks.example.com", "x-forwarded-proto": "javascript" }))?.status).toBe(403);
  });
});
