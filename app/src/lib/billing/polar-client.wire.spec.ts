/** @jest-environment node */
import { createPolarClient, POLAR_API_VERSION } from "./polar-client";

// Unmocked SDK against a stubbed network: proves what actually goes on the wire.
describe("Polar SDK wire format (2026-10)", () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  async function sent() {
    const [input, init] = fetchMock.mock.calls[0] as [
      Request | string | URL,
      RequestInit | undefined,
    ];
    const request = input instanceof Request ? input : new Request(input, init);
    const text = await request.clone().text();
    return {
      request,
      url: new URL(request.url),
      body: text ? JSON.parse(text) : null,
    };
  }
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  it.each([
    ["sandbox", "sandbox-api.polar.sh"],
    ["production", "api.polar.sh"],
  ] as const)(
    "targets the %s host with bearer auth and the pinned version",
    async (server, host) => {
      fetchMock.mockResolvedValue(ok({ id: "c" }));
      await createPolarClient({
        accessToken: "tok",
        server,
      }).customers.getExternal("organization:o 1");
      const { request, url } = await sent();
      expect(url.host).toBe(host);
      expect(url.pathname).toBe("/v1/customers/external/organization%3Ao%201");
      expect(request.headers.get("Authorization")).toBe("Bearer tok");
      expect(request.headers.get("Polar-Version")).toBe(POLAR_API_VERSION);
    },
  );

  it("sends checkout creation as snake_case JSON", async () => {
    fetchMock.mockResolvedValue(ok({ id: "co", url: "https://x/checkout" }));
    const checkout = await createPolarClient({
      accessToken: "t",
      server: "sandbox",
    }).checkouts.create({
      customer_id: "cus_1",
      products: ["prod_pro"],
      success_url: "https://app/success",
      return_url: "https://app/back",
      metadata: { referenceId: "org_1" },
      allow_discount_codes: true,
    });
    const { request, url, body } = await sent();
    expect(request.method).toBe("POST");
    expect(url.pathname).toBe("/v1/checkouts/");
    expect(body).toMatchObject({
      customer_id: "cus_1",
      products: ["prod_pro"],
      success_url: "https://app/success",
      return_url: "https://app/back",
      metadata: { referenceId: "org_1" },
      allow_discount_codes: true,
    });
    expect(body).not.toHaveProperty("customerId");
    expect(checkout.url).toBe("https://x/checkout");
  });

  it("sends portal sessions as snake_case and reads customer_portal_url", async () => {
    fetchMock.mockResolvedValue(
      ok({ id: "s", customer_portal_url: "https://x/portal" }),
    );
    const session = await createPolarClient({
      accessToken: "t",
      server: "sandbox",
    }).customerSessions.create({
      customer_id: "cus_1",
      return_url: "https://app/org-admin",
    });
    const { url, body } = await sent();
    expect(url.pathname).toBe("/v1/customer-sessions/");
    expect(body).toEqual({
      customer_id: "cus_1",
      return_url: "https://app/org-admin",
    });
    expect(session.customer_portal_url).toBe("https://x/portal");
  });

  it("creates customers with external_id and surfaces a 404 with statusCode for the lookup fallback", async () => {
    fetchMock.mockResolvedValueOnce(ok({ detail: "Not found" }, 404));
    const client = createPolarClient({ accessToken: "t", server: "sandbox" });
    await expect(
      client.customers.getExternal("organization:o1"),
    ).rejects.toMatchObject({ statusCode: 404 });
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(ok({ id: "cus_new" }));
    await client.customers.create({
      external_id: "organization:o1",
      email: "a@example.com",
      name: "A",
      metadata: { referenceId: "o1" },
    });
    const { body } = await sent();
    expect(body).toMatchObject({
      external_id: "organization:o1",
      email: "a@example.com",
    });
    expect(body).not.toHaveProperty("externalId");
  });
});
