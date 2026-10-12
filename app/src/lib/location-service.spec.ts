import { calculateAggregatedStatus, type LocationConfig } from "./location-service";

describe("calculateAggregatedStatus", () => {
  const multiLocationConfig: LocationConfig = {
    enabled: true,
    locations: ["us-east", "eu-central"],
    threshold: 50,
    strategy: "majority",
  };

  it("uses configured locations as the majority denominator", () => {
    expect(
      calculateAggregatedStatus(
        {
          "us-east": true,
        },
        multiLocationConfig
      )
    ).toBe("up");
  });

  it("falls back to configured locations when no results are available", () => {
    expect(
      calculateAggregatedStatus(
        {} as Record<string, boolean>,
        multiLocationConfig
      )
    ).toBe("down");
  });
  it("does not report all locations up when one configured location is missing", () => {
    expect(calculateAggregatedStatus({ "us-east": true }, { ...multiLocationConfig, strategy: "all" })).toBe("partial");
  });

  it("ignores results outside the configured locations", () => {
    expect(calculateAggregatedStatus({ other: true }, { ...multiLocationConfig, strategy: "any" })).toBe("down");
  });

  it("counts missing locations toward the majority threshold", () => {
    expect(calculateAggregatedStatus({ "us-east": true }, { ...multiLocationConfig, threshold: 75 })).toBe("partial");
  });
});
