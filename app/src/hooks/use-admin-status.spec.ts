import { fetchAdminStatus } from "./use-admin-status";

describe("fetchAdminStatus", () => {
  afterEach(() => jest.restoreAllMocks());

  it("reads both flags from one admin check request", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, isAdmin: false, isOrgAdmin: true }),
    } as Response);
    expect(await fetchAdminStatus()).toEqual({ isAdmin: false, isOrgAdmin: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/check");
  });

  it("treats a missing flag (older server) as not an admin", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ isAdmin: true }) } as Response);
    expect(await fetchAdminStatus()).toEqual({ isAdmin: true, isOrgAdmin: false });
  });

  it.each([401, 500])("denies both on HTTP %s", async (status) => {
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status } as Response);
    expect(await fetchAdminStatus()).toEqual({ isAdmin: false, isOrgAdmin: false });
  });

  it("denies both on an unreadable body", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError("bad"); } } as unknown as Response);
    expect(await fetchAdminStatus()).toEqual({ isAdmin: false, isOrgAdmin: false });
  });

  it("falls back to the org stats endpoint when an older server omits isOrgAdmin", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (url: unknown) =>
      url === "/api/admin/check"
        ? ({ ok: true, json: async () => ({ success: true, isAdmin: true }) } as Response)
        : ({ ok: true, status: 200 } as Response),
    );
    expect(await fetchAdminStatus()).toEqual({ isAdmin: true, isOrgAdmin: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/organizations/stats");
  });

  it("keeps isAdmin when the fallback request fails", async () => {
    jest.spyOn(global, "fetch").mockImplementation(async (url: unknown) => {
      if (url === "/api/admin/check") return { ok: true, json: async () => ({ isAdmin: true }) } as Response;
      throw new Error("network");
    });
    expect(await fetchAdminStatus()).toEqual({ isAdmin: true, isOrgAdmin: false });
  });
});
