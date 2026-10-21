/** @jest-environment node */
const mockHandler = jest.fn();
jest.mock("@/utils/auth", () => ({ auth: { handler: (...a: unknown[]) => mockHandler(...a), api: { marker: "api" } } }));

import { ConsentRejectedError, mcpAuthApi, submitConsent } from "./auth-api";

const json = (status: number, body: unknown) => Response.json(body, { status });
const headers = (init: Record<string, string>) => new Headers(init);

describe("submitConsent", () => {
  const original = process.env.BETTER_AUTH_URL;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BETTER_AUTH_URL = "https://app.example.com";
  });
  afterAll(() => {
    if (original === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = original;
  });

  it("posts the decision to the consent endpoint as a real request, and returns the redirect", async () => {
    mockHandler.mockResolvedValue(json(200, { redirect: true, url: "http://127.0.0.1:8765/cb?code=abc" }));
    const result = await submitConsent({ headers: headers({ cookie: "s=1", origin: "https://app.example.com" }), accept: true, oauthQuery: "client_id=c&sig=s" });

    expect(result).toEqual({ url: "http://127.0.0.1:8765/cb?code=abc" });
    const request = mockHandler.mock.calls[0][0] as Request;
    expect(request).toBeInstanceOf(Request);
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://app.example.com/api/auth/oauth2/consent");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(await request.json()).toEqual({ accept: true, oauth_query: "client_id=c&sig=s" });
  });

  it("forwards only the headers that identify the caller", async () => {
    mockHandler.mockResolvedValue(json(200, { url: "http://127.0.0.1/cb" }));
    await submitConsent({
      headers: headers({
        cookie: "s=1", origin: "https://app.example.com", "user-agent": "UA", "x-forwarded-for": "203.0.113.9",
        "x-real-ip": "203.0.113.9", "cf-connecting-ip": "203.0.113.9",
        authorization: "Bearer sck_live_secret", "x-project-id": "p1", "x-anything": "else",
      }),
      accept: false,
      oauthQuery: "q=1",
    });
    const sent = (mockHandler.mock.calls[0][0] as Request).headers;
    for (const name of ["cookie", "origin", "user-agent", "x-forwarded-for", "x-real-ip", "cf-connecting-ip"]) {
      expect(sent.get(name)).not.toBeNull();
    }
    // A bearer credential or an arbitrary header must not ride along into the auth layer.
    expect(sent.get("authorization")).toBeNull();
    expect(sent.get("x-project-id")).toBeNull();
    expect(sent.get("x-anything")).toBeNull();
  });

  it("accepts the alternative redirect_uri field", async () => {
    mockHandler.mockResolvedValue(json(200, { redirect_uri: "http://127.0.0.1/cb?error=access_denied" }));
    await expect(submitConsent({ headers: headers({}), accept: false, oauthQuery: "q" })).resolves.toEqual({
      url: "http://127.0.0.1/cb?error=access_denied",
    });
  });

  it.each([
    ["a rejected request", json(400, { error: "invalid_request" }), 400, "invalid_request"],
    ["an unauthenticated request", json(401, { error: "unauthorized" }), 401, "unauthorized"],
    ["a success with no redirect", json(200, {}), 200, "consent_failed"],
    ["a non-JSON failure", new Response("oops", { status: 502 }), 502, "consent_failed"],
  ])("throws ConsentRejectedError for %s", async (_name, response, status, reason) => {
    mockHandler.mockResolvedValue(response);
    const error = await submitConsent({ headers: headers({}), accept: true, oauthQuery: "q" }).catch((e) => e);
    expect(error).toBeInstanceOf(ConsentRejectedError);
    expect(error).toMatchObject({ status, reason });
  });

  it("refuses to run without BETTER_AUTH_URL rather than guessing a host", async () => {
    delete process.env.BETTER_AUTH_URL;
    await expect(submitConsent({ headers: headers({}), accept: true, oauthQuery: "q" })).rejects.toThrow("BETTER_AUTH_URL");
    expect(mockHandler).not.toHaveBeenCalled();
  });
});

describe("mcpAuthApi", () => {
  it("is the in-process API, typed for the OAuth endpoints the plugins add", () => {
    expect(mcpAuthApi()).toEqual({ marker: "api" });
  });
});
