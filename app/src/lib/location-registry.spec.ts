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
