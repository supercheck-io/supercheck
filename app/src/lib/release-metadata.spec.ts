import { getReleaseVersionBadge } from "./release-metadata";

describe("getReleaseVersionBadge", () => {
  it.each([
    ["1.3.6-aisre-41", "v1.3.6-aisre-41"],
    ["v1.3.6", "v1.3.6"],
    ["2.0.0-rc.1+build.7", "v2.0.0-rc.1+build.7"],
    [" 1.3.6-aisre-41 ", "v1.3.6-aisre-41"],
  ])("formats release version %s", (version, expected) => {
    expect(getReleaseVersionBadge(version)).toBe(expected);
  });

  it.each([
    undefined,
    "",
    "unknown",
    "feature-sre-agent-123",
    "75c9161a8c7bc4d4687558e0c3fc323a49e1d0aa",
    "1.3",
    "1.3.6 latest",
  ])("omits invalid or non-release metadata %s", (version) => {
    expect(getReleaseVersionBadge(version)).toBeUndefined();
  });
});
