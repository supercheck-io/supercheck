import { environmentTone } from "./service-style";

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
