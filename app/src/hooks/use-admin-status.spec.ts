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
});
