/** @jest-environment node */

jest.mock("@/lib/location-registry", () => ({
  getAllEnabledLocationCodes: jest.fn(),
  getWorkloadCapableLocationCodes: jest.fn(),
  getDefaultLocationCodes: jest.fn(),
  getFirstDefaultLocationCode: jest.fn(),
  getProjectAvailableLocationCodes: jest.fn(),
  hasProjectLocationRestrictions: jest.fn(),
  PROJECT_RESTRICTED_LOCATIONS_DISABLED_ERROR:
    "All restricted locations for this project are currently disabled. Enable at least one assigned location or remove the project restrictions.",
}));

jest.mock("@/lib/worker-registry", () => ({
  getActiveWorkerQueueNames: jest.fn(),
}));

import {
  findLocationsOutsideProject,
  findUnsupportedMonitorLocations,
  isMonitorLocationResolutionError,
  partitionMonitorLocationsByAvailability,
  resolveDefaultMonitorLocations,
  resolveMonitorLocations,
} from "./monitor-location-routing";

const locationRegistry = jest.requireMock("@/lib/location-registry") as {
  getAllEnabledLocationCodes: jest.Mock;
  getWorkloadCapableLocationCodes: jest.Mock;
  getDefaultLocationCodes: jest.Mock;
  getFirstDefaultLocationCode: jest.Mock;
  getProjectAvailableLocationCodes: jest.Mock;
  hasProjectLocationRestrictions: jest.Mock;
};

const workerRegistry = jest.requireMock("@/lib/worker-registry") as {
  getActiveWorkerQueueNames: jest.Mock;
};

describe("monitor-location-routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    locationRegistry.getAllEnabledLocationCodes.mockResolvedValue(["us-east", "eu-central"]);
    locationRegistry.getDefaultLocationCodes.mockResolvedValue(["us-east"]);
    locationRegistry.getFirstDefaultLocationCode.mockResolvedValue("us-east");
    locationRegistry.getProjectAvailableLocationCodes.mockResolvedValue(["us-east", "eu-central"]);
    locationRegistry.hasProjectLocationRestrictions.mockResolvedValue(false);
    workerRegistry.getActiveWorkerQueueNames.mockResolvedValue(
      new Set(["monitor-us-east"])
    );
  });

  it("filters explicit monitor locations against enabled and project-allowed sets", async () => {
    locationRegistry.getProjectAvailableLocationCodes.mockResolvedValue(["eu-central"]);

    const result = await resolveMonitorLocations(
      {
        enabled: true,
        locations: ["us-east", "eu-central", "eu-central"],
        threshold: 50,
        strategy: "majority",
      },
      "project-1"
    );

    expect(result).toEqual(["eu-central"]);
  });

  it("throws when explicit monitor locations are no longer valid", async () => {
    locationRegistry.getProjectAvailableLocationCodes.mockResolvedValue([]);

    await expect(
      resolveMonitorLocations(
        {
          enabled: true,
          locations: ["us-east"],
          threshold: 50,
          strategy: "majority",
        },
        "project-1"
      )
    ).rejects.toThrow(
      "Monitor has locations explicitly configured [us-east] but none are currently enabled for this project."
    );
  });

  it("falls back to project-allowed defaults when restricted", async () => {
    locationRegistry.getDefaultLocationCodes.mockResolvedValue(["us-east"]);
    locationRegistry.hasProjectLocationRestrictions.mockResolvedValue(true);
    locationRegistry.getProjectAvailableLocationCodes.mockResolvedValue(["eu-central"]);

    const result = await resolveDefaultMonitorLocations("project-1");

    expect(result).toEqual(["eu-central"]);
  });

  it("throws when restricted projects have no enabled allowed locations", async () => {
    locationRegistry.getDefaultLocationCodes.mockResolvedValue(["us-east"]);
    locationRegistry.hasProjectLocationRestrictions.mockResolvedValue(true);
    locationRegistry.getProjectAvailableLocationCodes.mockResolvedValue([]);

    await expect(resolveDefaultMonitorLocations("project-1")).rejects.toThrow(
      "All restricted locations for this project are currently disabled."
    );
  });

  it("classifies disabled restriction errors as location-resolution failures", () => {
    expect(
      isMonitorLocationResolutionError(
        "All restricted locations for this project are currently disabled. Enable at least one assigned location or remove the project restrictions."
      )
    ).toBe(true);
  });

  it("classifies explicit invalid monitor location errors as location-resolution failures", () => {
    expect(
      isMonitorLocationResolutionError(
        "Monitor has locations explicitly configured [us-east] but none are currently enabled for this project. Re-enable the locations or update the monitor's location configuration."
      )
    ).toBe(true);
  });

  it("only keeps locations with both queue objects and live worker heartbeats", async () => {
    const result = await partitionMonitorLocationsByAvailability(
      ["us-east", "eu-central", "ap-south"],
      ["us-east", "eu-central"],
      (location) => `monitor-${location}`
    );

    expect(result).toEqual({
      enqueuedLocations: ["us-east"],
      skippedLocations: ["eu-central", "ap-south"],
    });
  });
});

describe("monitor-location-routing workload capabilities", () => {
  const synthetic = { monitorType: "synthetic_test" };
  const config = (locations: string[]) => ({
    enabled: true,
    locations,
    threshold: 50,
    strategy: "majority" as const,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    locationRegistry.getAllEnabledLocationCodes.mockResolvedValue(["eu-central", "us-east", "asia-pacific"]);
    locationRegistry.getWorkloadCapableLocationCodes.mockResolvedValue(["eu-central"]);
    locationRegistry.getDefaultLocationCodes.mockResolvedValue(["eu-central"]);
    locationRegistry.getFirstDefaultLocationCode.mockResolvedValue("eu-central");
    locationRegistry.getProjectAvailableLocationCodes.mockResolvedValue(["eu-central", "us-east", "asia-pacific"]);
    locationRegistry.hasProjectLocationRestrictions.mockResolvedValue(false);
  });

  it("leaves HTTP monitors unrestricted across probe-only regions", async () => {
    await expect(
      resolveMonitorLocations(config(["eu-central", "us-east", "asia-pacific"]), "p1", { monitorType: "website" })
    ).resolves.toEqual(["eu-central", "us-east", "asia-pacific"]);
    expect(locationRegistry.getWorkloadCapableLocationCodes).not.toHaveBeenCalled();
  });

  it("keeps only browser-capable locations for synthetic monitors", async () => {
    await expect(
      resolveMonitorLocations(config(["eu-central", "us-east"]), "p1", synthetic)
    ).resolves.toEqual(["eu-central"]);
  });

  it("throws a configuration error, not another geography, when no selected location is capable", async () => {
    const error = await resolveMonitorLocations(config(["us-east", "asia-pacific"]), "p1", synthetic).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(isMonitorLocationResolutionError(error.message)).toBe(true);
    expect(error.message).toContain("browser-capable");
  });

  it("resolves synthetic defaults only within capable locations", async () => {
    locationRegistry.getDefaultLocationCodes.mockResolvedValue(["us-east"]);
    await expect(resolveDefaultMonitorLocations("p1", synthetic)).resolves.toEqual(["eu-central"]);
  });

  it("does not escape project restrictions for synthetic defaults", async () => {
    locationRegistry.hasProjectLocationRestrictions.mockResolvedValue(true);
    locationRegistry.getProjectAvailableLocationCodes.mockImplementation(
      async (_p: string, workload?: string) => (workload ? [] : ["us-east"])
    );
    const error = await resolveDefaultMonitorLocations("p1", synthetic).catch((e) => e);
    expect(isMonitorLocationResolutionError(error.message)).toBe(true);
    expect(error.message).toContain("browser checks");
  });

  it("finds unsupported selections only when the config is enabled and the type is synthetic", async () => {
    await expect(findUnsupportedMonitorLocations(config(["eu-central", "us-east"]), "synthetic_test")).resolves.toEqual(["us-east"]);
    await expect(findUnsupportedMonitorLocations(config(["us-east"]), "website")).resolves.toEqual([]);
    await expect(
      findUnsupportedMonitorLocations({ ...config(["us-east"]), enabled: false }, "synthetic_test")
    ).resolves.toEqual([]);
  });

  it("reports selected codes outside the project's allowed locations", async () => {
    locationRegistry.getProjectAvailableLocationCodes.mockResolvedValue(["eu-central"]);
    await expect(
      findLocationsOutsideProject(config(["eu-central", "us-east", "nowhere"]), "p1")
    ).resolves.toEqual(["us-east", "nowhere"]);
    await expect(findLocationsOutsideProject(null, "p1")).resolves.toEqual([]);
  });
});
