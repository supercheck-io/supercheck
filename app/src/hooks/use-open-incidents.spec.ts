import { fetchOpenIncidents } from "./use-open-incidents";

describe("open incident requests", () => {
  afterEach(() => jest.restoreAllMocks());
  it("requests unresolved incidents before the server limit", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ incidents: [
      { id: "open", status: "investigating" }, { id: "closed", status: "resolved" },
    ] }) } as Response);
    expect(await fetchOpenIncidents("project-a")).toEqual({ available: true, incidents: [{ id: "open", status: "investigating" }] });
    expect(fetchMock).toHaveBeenCalledWith("/api/sre/incidents?status=open", {
      headers: { "Content-Type": "application/json", "x-project-id": "project-a" },
    });
  });
  it.each([401, 402, 403, 404, 500])("hides unavailable incidents on HTTP %s", async (status) => {
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status } as Response);
    expect(await fetchOpenIncidents()).toEqual({ available: false });
  });
  it("hides incidents when the request fails", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    expect(await fetchOpenIncidents()).toEqual({ available: false });
  });
});

describe("open incident query options", () => {
  it("is never persisted and refetches on mount so counts are live", () => {
    jest.isolateModules(() => {
      const useQuery = jest.fn(() => ({}));
      jest.doMock("@tanstack/react-query", () => ({ useQuery }));
      jest.doMock("./use-project-context", () => ({ useProjectContext: () => ({ currentProject: { id: "p" } }) }));
      require("./use-open-incidents").useOpenIncidents();
      expect(useQuery).toHaveBeenCalledWith(expect.objectContaining({ refetchOnMount: true, meta: { persist: false }, queryKey: ["dashboard", "open-incidents", "p"] }));
    });
  });
});
