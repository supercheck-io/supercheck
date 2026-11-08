/** @jest-environment node */

describe("worker-registry helpers", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  async function loadModule(excludeLocal: boolean) {
    jest.doMock("@/lib/queue", () => ({
      getRedisConnection: jest.fn(),
    }));
    jest.doMock("@/lib/location-registry", () => ({
      LOCAL_LOCATION_CODE: "local",
      shouldExcludeLocal: () => excludeLocal,
    }));

    return import("./worker-registry");
  }

  it("reports unknown local workers in cloud mode", async () => {
    const { shouldReportUnregisteredWorkerLocation } = await loadModule(true);

    expect(
      shouldReportUnregisteredWorkerLocation("local", new Set(["us-east"]))
    ).toBe(true);
  });

  it("ignores local workers in self-hosted mode when local is intentionally hidden from the known set", async () => {
    const { shouldReportUnregisteredWorkerLocation } = await loadModule(false);

    expect(
      shouldReportUnregisteredWorkerLocation("local", new Set(["us-east"]))
    ).toBe(false);
  });

  it("never reports known worker locations", async () => {
    const { shouldReportUnregisteredWorkerLocation } = await loadModule(true);

    expect(
      shouldReportUnregisteredWorkerLocation("us-east", new Set(["us-east"]))
    ).toBe(false);
  });

  describe("getActiveWorkers cache", () => {
    const hb = JSON.stringify({ location: "eu-central", queues: ["q1"] });

    async function loadWithRedis(scan: jest.Mock) {
      const pipeline = {
        get: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, hb]]),
      };
      jest.doMock("@/lib/queue", () => ({
        getRedisConnection: jest.fn().mockResolvedValue({
          scan,
          pipeline: () => pipeline,
        }),
      }));
      jest.doMock("@/lib/location-registry", () => ({
        LOCAL_LOCATION_CODE: "local",
        shouldExcludeLocal: () => false,
      }));
      return import("./worker-registry");
    }

    afterEach(() => jest.restoreAllMocks());

    it("serves repeat and concurrent calls from one scan, then rescans after 5s", async () => {
      const now = jest.spyOn(Date, "now").mockReturnValue(1_000);
      const scan = jest.fn().mockResolvedValue(["0", ["supercheck:worker-heartbeat:w1"]]);
      const { getActiveWorkers, getActiveWorkerQueueNames } = await loadWithRedis(scan);

      await Promise.all([getActiveWorkers(), getActiveWorkers(), getActiveWorkerQueueNames()]);
      expect(scan).toHaveBeenCalledTimes(1);
      expect([...(await getActiveWorkerQueueNames())]).toEqual(["q1"]);
      expect(scan).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000 + 5_000);
      await getActiveWorkers();
      expect(scan).toHaveBeenCalledTimes(2);
    });

    it("rescans when the clock steps backwards instead of serving a stale snapshot", async () => {
      const now = jest.spyOn(Date, "now").mockReturnValue(100_000);
      const scan = jest.fn().mockResolvedValue(["0", ["supercheck:worker-heartbeat:w1"]]);
      const { getActiveWorkers } = await loadWithRedis(scan);

      await getActiveWorkers();
      now.mockReturnValue(100_000 - 60_000);
      await getActiveWorkers();
      expect(scan).toHaveBeenCalledTimes(2);
    });

    it("does not cache errors", async () => {
      const scan = jest
        .fn()
        .mockRejectedValueOnce(new Error("redis down"))
        .mockResolvedValue(["0", ["supercheck:worker-heartbeat:w1"]]);
      const { getActiveWorkers } = await loadWithRedis(scan);

      await expect(getActiveWorkers()).rejects.toThrow("redis down");
      await expect(getActiveWorkers()).resolves.toHaveLength(1);
      expect(scan).toHaveBeenCalledTimes(2);
    });
  });
});
