/** @jest-environment node */
import { createPolarClient, POLAR_API_VERSION } from "./polar-client";

// Unmocked on purpose: raw-fetch callers send POLAR_API_VERSION, so the real SDK
// must send the same value or the two paths silently use different contracts.
describe("Polar SDK version header", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("sends the same Polar-Version the raw-fetch callers use", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    global.fetch = fetchMock;
    await createPolarClient({ accessToken: "t", server: "sandbox" })
      .customers.getExternal("org_1")
      .catch(() => undefined);
    const [input, init] = fetchMock.mock.calls[0] as [
      Request | string | URL,
      RequestInit | undefined,
    ];
    const headers = new Headers(
      input instanceof Request ? input.headers : init?.headers,
    );
    expect(headers.get("Polar-Version")).toBe(POLAR_API_VERSION);
  });
});
