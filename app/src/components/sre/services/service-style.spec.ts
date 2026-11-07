import { environmentTone, TIER_TONES } from "./service-style";

it("maps tiers 1 to 4 from most to least prominent tone", () => {
  expect(TIER_TONES).toEqual({ "1": "info", "2": "cyan", "3": "slate", "4": "neutral" });
});

describe("environmentTone", () => {
  it.each([
    [" Production ", "warning"],
    ["prod", "warning"],
    ["staging", "cyan"],
    ["stage", "cyan"],
    ["preprod", "cyan"],
    ["development", "neutral"],
    ["dev", "neutral"],
    ["test", "neutral"],
    ["local", "neutral"],
    ["eu-west", "slate"],
  ])("maps %p to %s", (environment, tone) => {
    expect(environmentTone(environment)).toBe(tone);
  });
});
