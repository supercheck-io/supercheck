import { getSourceBuildBadge } from "./build-metadata";

describe("getSourceBuildBadge", () => {
  it("derives a compact label from an immutable GitHub revision", () => {
    expect(
      getSourceBuildBadge(
        "https://github.com/supercheck-io/supercheck/tree/E939F90E45E70DD141B7644E1665CD0F36FAE5E3",
      ),
    ).toBe("build e939f90");
  });

  it.each([
    undefined,
    "",
    "not-a-url",
    "https://github.com/supercheck-io/supercheck",
    "https://github.com/supercheck-io/supercheck/tree/feature/sre-agent",
    "https://example.com/supercheck/tree/e939f90e45e70dd141b7644e1665cd0f36fae5e3",
  ])("omits the badge when immutable build metadata is unavailable", (sourceUrl) => {
    expect(getSourceBuildBadge(sourceUrl)).toBeUndefined();
  });
});
