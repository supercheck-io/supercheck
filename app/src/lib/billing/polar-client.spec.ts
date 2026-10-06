/** @jest-environment node */
jest.mock("@polar-sh/sdk", () => ({ Polar: jest.fn() }));

import { Polar } from "@polar-sh/sdk";
import { createPolarClient, POLAR_API_VERSION } from "./polar-client";

describe("Polar SDK transport", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.clearAllMocks(); });

  it.each(["sandbox", "production"] as const)("pins %s SDK requests and bounds their timeout", async (server) => {
    const fetchMock = jest.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    global.fetch = fetchMock;
    createPolarClient({ accessToken: "test-token", server });
    const options = jest.mocked(Polar).mock.calls[0][0];
    expect(options).toMatchObject({ server, timeoutMs: 15_000 });
    await options?.httpClient?.request(new Request("https://example.test/v1/customers", {
      headers: { Authorization: "Bearer test-token" },
    }));
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.headers.get("Polar-Version")).toBe(POLAR_API_VERSION);
    expect(request.headers.get("Authorization")).toBe("Bearer test-token");
  });
});
