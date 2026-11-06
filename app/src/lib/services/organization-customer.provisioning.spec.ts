/** @jest-environment node */
// Real SDK against a stubbed network: what customer provisioning actually sends and how it reacts.
const mockFindFirst = jest.fn();
const mockReturning = jest.fn();
jest.mock("@/utils/db", () => ({
  db: {
    query: {
      organization: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
    update: () => ({
      set: () => ({ where: () => ({ returning: () => mockReturning() }) }),
    }),
  },
}));
const mockEnabled = jest.fn(() => true);
jest.mock("@/lib/feature-flags", () => ({
  isPolarEnabled: () => mockEnabled(),
  getPolarConfig: () => ({
    accessToken: "tok",
    server: "sandbox",
    webhookSecret: "w",
  }),
}));

import { ensurePolarCustomerAndLink } from "./organization-customer";

const realFetch = global.fetch;
let fetchMock: jest.Mock;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
async function request(call: number) {
  const [input, init] = fetchMock.mock.calls[call] as [
    Request | string | URL,
    RequestInit | undefined,
  ];
  const req = input instanceof Request ? input : new Request(input, init);
  const text = await req.clone().text();
  return {
    method: req.method,
    url: new URL(req.url),
    body: text ? JSON.parse(text) : null,
  };
}
const ORG = "0198a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b";
const provision = (options?: { throwOnError?: boolean }) =>
  ensurePolarCustomerAndLink(
    "user-1",
    "owner@example.com",
    "Owner",
    ORG,
    options,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockEnabled.mockReturnValue(true);
  mockFindFirst.mockReset();
  mockFindFirst.mockResolvedValue({ polarCustomerId: null });
  mockReturning.mockResolvedValue([{ polarCustomerId: "cus_linked" }]);
  fetchMock = jest.fn();
  global.fetch = fetchMock;
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(() => {
  global.fetch = realFetch;
});

describe("ensurePolarCustomerAndLink against the provider API", () => {
  it("does nothing when billing is disabled", async () => {
    mockEnabled.mockReturnValue(false);
    await expect(provision()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for an unknown organization without calling the provider", async () => {
    mockFindFirst.mockResolvedValue(undefined);
    await expect(provision()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("links an existing customer found by the organization external id and never creates one", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "cus_linked" }));
    await expect(provision()).resolves.toBe("cus_linked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const lookup = await request(0);
    expect(lookup.method).toBe("GET");
    expect(lookup.url.pathname).toBe(
      `/v1/customers/external/${encodeURIComponent(`organization:${ORG}`)}`,
    );
  });

  it("creates the customer with the organization external id, owner details and references on a 404", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ detail: "Not found" }, 404))
      .mockResolvedValueOnce(json({ id: "cus_linked" }, 201));
    await expect(provision()).resolves.toBe("cus_linked");
    const create = await request(1);
    expect(create.method).toBe("POST");
    expect(create.url.pathname).toBe("/v1/customers/");
    expect(create.body).toMatchObject({
      external_id: `organization:${ORG}`,
      email: "owner@example.com",
      name: "Owner",
      metadata: {
        userId: "user-1",
        referenceId: ORG,
        source: "supercheck-setup-defaults",
      },
    });
    expect(create.body).not.toHaveProperty("externalId");
  });

  it("falls back to the email when the user has no name", async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({ id: "cus_linked" }, 201));
    await ensurePolarCustomerAndLink("user-1", "owner@example.com", null, ORG);
    expect((await request(1)).body.name).toBe("owner@example.com");
  });

  it("never looks customers up by email", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "cus_linked" }));
    await provision();
    for (let i = 0; i < fetchMock.mock.calls.length; i++) {
      expect((await request(i)).url.search).not.toContain("email");
    }
  });

  it("resolves a concurrent creation by reading the customer the other request made", async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({ detail: "external_id exists" }, 422))
      .mockResolvedValueOnce(json({ id: "cus_linked" }));
    await expect(provision()).resolves.toBe("cus_linked");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  describe("an email kept by the customer of a deleted organization", () => {
    const FORMER = "0198a1b2-c3d4-7e5f-8a6b-000000000001";
    const conflict = () => fetchMock
      .mockResolvedValueOnce(json({ detail: "Not found" }, 404))
      .mockResolvedValueOnce(json({ detail: [{ loc: ["body", "email"], msg: "exists" }] }, 422))
      .mockResolvedValueOnce(json({ detail: "Not found" }, 404));
    const customer = (externalId: string | null, userId = "user-1") => ({
      id: "cus_former", email: "Owner@example.com", external_id: externalId, metadata: { referenceId: FORMER, userId, stale: "x" },
    });
    const list = (...items: unknown[]) => json({ items, pagination: { total_count: items.length, max_page: 1 } });

    it("reuses it when the old organization is gone and nothing is active, moving its reference", async () => {
      conflict()
        .mockResolvedValueOnce(list(customer(`organization:${FORMER}`)))
        .mockResolvedValueOnce(json({ id: "cus_former", active_subscriptions: [] }))
        .mockResolvedValueOnce(json({ id: "cus_former" }));
      mockFindFirst
        .mockResolvedValueOnce({ polarCustomerId: null })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      mockReturning.mockResolvedValue([{ polarCustomerId: "cus_former" }]);
      jest.spyOn(console, "warn").mockImplementation(() => undefined);

      await expect(provision({ throwOnError: true })).resolves.toBe("cus_former");
      const lookup = await request(3);
      expect(lookup.url.pathname).toBe("/v1/customers/");
      expect(lookup.url.searchParams.get("email")).toBe("owner@example.com");
      const update = await request(5);
      expect(update.method).toBe("PATCH");
      expect(update.body.metadata).toEqual({ referenceId: ORG, userId: "user-1", source: "supercheck-reused-after-organization-deletion" });
    });

    it.each([
      ["the old organization still exists", `organization:${FORMER}`, "user-1", { id: FORMER }, undefined, []],
      ["another organization already holds it", `organization:${FORMER}`, "user-1", undefined, { id: "org-other" }, []],
      ["it still has an active subscription", `organization:${FORMER}`, "user-1", undefined, undefined, [{ id: "sub_1" }]],
      ["it was created for a different user", `organization:${FORMER}`, "user-2", undefined, undefined, []],
      ["it is not an organization customer", "legacy-user-id", "user-1", undefined, undefined, []],
      ["its organization id is not a UUID", "organization:not-a-uuid", "user-1", undefined, undefined, []],
    ])("refuses with a clear conflict when %s", async (_case, externalId, owner, former, holder, active) => {
      conflict()
        .mockResolvedValueOnce(list(customer(externalId, owner)))
        .mockResolvedValueOnce(json({ id: "cus_former", active_subscriptions: active }));
      mockFindFirst
        .mockResolvedValueOnce({ polarCustomerId: null })
        .mockResolvedValueOnce(former)
        .mockResolvedValueOnce(holder);

      await expect(provision({ throwOnError: true })).rejects.toMatchObject({ name: "BillingCustomerConflictError" });
      for (let i = 0; i < fetchMock.mock.calls.length; i++) {
        expect((await request(i)).method).not.toBe("PATCH");
      }
    });
  });

  it("surfaces a rejected create unchanged when no customer has the email", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ detail: "Not found" }, 404))
      .mockResolvedValueOnce(json({ detail: [{ loc: ["body", "name"], msg: "too long" }] }, 422))
      .mockResolvedValueOnce(json({ detail: "Not found" }, 404))
      .mockResolvedValueOnce(json({ items: [], pagination: { total_count: 0, max_page: 1 } }));
    await expect(provision({ throwOnError: true })).rejects.toMatchObject({ statusCode: 422 });
  });

  it("surfaces the creation error when neither create nor the follow-up lookup works", async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({ detail: "boom" }, 500))
      .mockResolvedValueOnce(json({ detail: "boom" }, 500));
    await expect(provision({ throwOnError: true })).rejects.toBeDefined();
    await expect(provision()).resolves.toBeNull();
  });

  it.each([401, 429, 500, 503])(
    "does not create a customer when the lookup fails with HTTP %i",
    async (status) => {
      fetchMock.mockResolvedValue(json({ detail: "x" }, status));
      await expect(provision({ throwOnError: true })).rejects.toMatchObject({
        statusCode: status,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(provision()).resolves.toBeNull();
    },
  );

  it("does not treat a non-JSON 404 (for example a proxy page) as 'customer missing'", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>not found</html>", {
        status: 404,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(provision({ throwOnError: true })).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the customer another request linked first instead of overwriting it", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "cus_mine" }));
    mockReturning.mockResolvedValue([]);
    mockFindFirst
      .mockResolvedValueOnce({ polarCustomerId: null })
      .mockResolvedValueOnce({ polarCustomerId: "cus_other" });
    await expect(provision()).resolves.toBe("cus_other");
  });
});
