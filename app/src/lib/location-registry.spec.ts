/** @jest-environment node */

describe("location-registry helpers", () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, "__SUPERCHECK_LOCATION_CACHE__");
  });
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  async function loadModule(
    selfHosted: boolean,
    restrictionRows: Array<{ code: string }> = []
  ) {
    jest.doMock("@/utils/db", () => ({
      db: {
        select: jest.fn(() => ({
          from: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockResolvedValue(restrictionRows),
        })),
      },
    }));
    jest.doMock("@/lib/feature-flags", () => ({
      isSelfHosted: () => selfHosted,
    }));

    return import("./location-registry");
  }

  it.each([true, false])("projects only public display fields and respects self-hosted=%s", async (selfHosted) => {
    const { getLocationDisplayData } = await loadModule(selfHosted, [
      { code: "local" }, { code: "us-east" },
    ]);
    const displayed = await getLocationDisplayData();
    expect(displayed.map((row) => row.code)).toEqual(selfHosted ? ["local", "us-east"] : ["us-east"]);
    const { db } = await import("@/utils/db");
    const select = jest.mocked(db.select);
    expect(Object.keys(select.mock.calls[0][0] ?? {}).sort()).toEqual([
      "code", "coordinates", "flag", "isEnabled", "name", "region",
    ]);
  });

  it("drops hidden local restrictions in cloud mode", async () => {
    const { getVisibleProjectRestrictions } = await loadModule(false);

    expect(
      getVisibleProjectRestrictions([
        { locationId: "loc-local", code: "local" },
        { locationId: "loc-us-east", code: "us-east" },
      ])
    ).toEqual([{ locationId: "loc-us-east", code: "us-east" }]);
  });

  it("keeps local restrictions in self-hosted mode", async () => {
    const { getVisibleProjectRestrictions } = await loadModule(true);

    expect(
      getVisibleProjectRestrictions([
        { locationId: "loc-local", code: "local" },
      ])
    ).toEqual([{ locationId: "loc-local", code: "local" }]);
  });

  it("returns the first visible project restriction code", async () => {
    const { getFirstVisibleProjectRestrictionCode } = await loadModule(false, [
      { code: "local" },
      { code: "us-east" },
      { code: "eu-central" },
    ]);

    await expect(
      getFirstVisibleProjectRestrictionCode("project-1")
    ).resolves.toBe("us-east");
  });

  it("returns undefined when all project restrictions are hidden", async () => {
    const { getFirstVisibleProjectRestrictionCode } = await loadModule(false, [
      { code: "local" },
    ]);

    await expect(
      getFirstVisibleProjectRestrictionCode("project-1")
    ).resolves.toBeUndefined();
  });

  it("shares cached enabled locations across server module copies", async () => {
    const first = await loadModule(false, [{ code: "eu-central" }]);
    await expect(first.getAllEnabledLocationCodes()).resolves.toEqual(["eu-central"]);
    jest.resetModules();
    const second = await loadModule(false, [{ code: "us-east" }]);
    await expect(second.getAllEnabledLocationCodes()).resolves.toEqual(["eu-central"]);
    first.invalidateLocationCache();
    await expect(second.getAllEnabledLocationCodes()).resolves.toEqual(["us-east"]);
  });

  it("does not restore a stale database read after a location save invalidates it", async () => {
    const registry = await loadModule(false);
    const db = jest.requireMock("@/utils/db").db;
    let finishOldRead!: (rows: Array<{ code: string }>) => void;
    const orderBy = jest.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishOldRead = resolve; }))
      .mockResolvedValue([{ code: "eu-central" }, { code: "us-east" }]);
    db.select.mockImplementation(() => ({
      from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), orderBy,
    }));
    const pendingRead = registry.getAllEnabledLocationCodes();
    registry.invalidateLocationCache();
    finishOldRead([{ code: "eu-central" }]);
    await expect(pendingRead).resolves.toEqual(["eu-central", "us-east"]);
    await expect(registry.getAllEnabledLocationCodes()).resolves.toEqual(["eu-central", "us-east"]);
    expect(orderBy).toHaveBeenCalledTimes(2);
  });
});

describe("location-registry workload capabilities", () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, "__SUPERCHECK_LOCATION_CACHE__");
  });
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  const row = (code: string, supportsBrowser: boolean, supportsK6: boolean, isDefault = false) => ({
    code, isDefault, supportsBrowser, supportsK6,
  });

  async function load(rows: Array<ReturnType<typeof row>>, restrictionRows: Array<{ code: string; locationId: string }> = []) {
    // One chain serves every query: orderBy() resolves location rows (cache read);
    // an awaited where() resolves project restrictions.
    const chain: Record<string, unknown> = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockResolvedValue(rows),
      then: (resolve: (v: unknown) => void) => resolve(restrictionRows),
    };
    const select = jest.fn(() => chain);
    jest.doMock("@/utils/db", () => ({ db: { select } }));
    jest.doMock("@/lib/feature-flags", () => ({ isSelfHosted: () => false }));
    return import("./location-registry");
  }

  const probeOnly = [
    row("eu-central", true, true, true),
    row("us-east", false, false),
    row("asia-pacific", false, false),
  ];

  it("treats monitors as always supported and browser/k6 per flag", async () => {
    const { locationSupportsWorkload } = await load(probeOnly);
    expect(locationSupportsWorkload({ supportsBrowser: false, supportsK6: false }, "monitor")).toBe(true);
    expect(locationSupportsWorkload({ supportsBrowser: false, supportsK6: true }, "browser")).toBe(false);
    expect(locationSupportsWorkload({ supportsBrowser: true, supportsK6: false }, "k6")).toBe(false);
  });

  it("lists capable codes and answers isLocationCapable (unknown codes are never capable)", async () => {
    const { getWorkloadCapableLocationCodes, isLocationCapable } = await load(probeOnly);
    await expect(getWorkloadCapableLocationCodes("browser")).resolves.toEqual(["eu-central"]);
    await expect(isLocationCapable("us-east", "k6")).resolves.toBe(false);
    await expect(isLocationCapable("eu-central", "k6")).resolves.toBe(true);
    await expect(isLocationCapable("sa-east", "k6")).resolves.toBe(false);
  });

  it("resolves an omitted k6 location to a capable one, never a probe-only region", async () => {
    const { resolveProjectK6Location } = await load([
      row("us-east", false, false, true),
      row("eu-central", true, true),
    ]);
    await expect(resolveProjectK6Location("p1")).resolves.toBe("eu-central");
  });

  it("rejects an explicit probe-only k6 location with an unavailable error", async () => {
    const { resolveProjectK6Location, LocationWorkloadUnavailableError } = await load(probeOnly);
    await expect(resolveProjectK6Location("p1", "us-east")).rejects.toBeInstanceOf(LocationWorkloadUnavailableError);
  });

  it("rejects global k6 when no enabled location supports k6", async () => {
    const { resolveProjectK6Location, LocationWorkloadUnavailableError } = await load([
      row("us-east", false, false, true),
    ]);
    await expect(resolveProjectK6Location("p1", "global")).rejects.toBeInstanceOf(LocationWorkloadUnavailableError);
  });

  it("accepts global k6 when some location supports k6", async () => {
    const { resolveProjectK6Location } = await load(probeOnly);
    await expect(resolveProjectK6Location("p1", "global")).resolves.toBe("global");
  });

  it("rejects the browser gate for a project whose locations are all probe-only", async () => {
    const { assertProjectSupportsBrowser, LocationWorkloadUnavailableError } = await load(
      [row("us-east", false, false)]
    );
    await expect(assertProjectSupportsBrowser("p1")).rejects.toBeInstanceOf(LocationWorkloadUnavailableError);
  });

  it("keeps the pre-capability behaviour for a project with no usable locations", async () => {
    const { assertProjectSupportsBrowser } = await load([]);
    await expect(assertProjectSupportsBrowser("p1")).resolves.toBeUndefined();
  });

  it("passes the browser gate when any permitted location supports browser", async () => {
    const { assertProjectSupportsBrowser } = await load(probeOnly);
    await expect(assertProjectSupportsBrowser("p1")).resolves.toBeUndefined();
  });
});
