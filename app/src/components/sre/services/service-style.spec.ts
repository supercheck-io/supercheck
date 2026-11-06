import { environmentTone, TIER_TONES } from "./service-style";

it("maps tiers 1 to 4 from most to least prominent tone", () => {
  expect(TIER_TONES).toEqual({ "1": "purple", "2": "indigo", "3": "info", "4": "slate" });
});

describe("environmentTone", () => {
  it.each([
    [" Production ", "warning"],
    ["prod", "warning"],
    ["staging", "indigo"],
    ["stage", "indigo"],
    ["preprod", "indigo"],
    ["development", "slate"],
    ["dev", "slate"],
    ["test", "slate"],
    ["local", "slate"],
    ["eu-west", "info"],
  ])("maps %p to %s", (environment, tone) => {
    expect(environmentTone(environment)).toBe(tone);
  });
});
