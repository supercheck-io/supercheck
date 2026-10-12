jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: jest.fn(() => false) }));

import {
  readBooleanEnv,
  readPositiveIntegerEnv,
} from "./usage-sync-scheduler";

describe("readPositiveIntegerEnv", () => {
  it.each([
    [undefined, 500, 500],
    ["", 500, 500],
    ["0", 500, 500],
    ["-5", 500, 500],
    ["abc", 500, 500],
    ["NaN", 500, 500],
    ["1000", 500, 1000],
    ["25", 500, 25],
  ])("parses %p with fallback %p as %p", (value, fallback, expected) => {
    expect(readPositiveIntegerEnv(value, fallback)).toBe(expected);
  });
});

describe("readBooleanEnv", () => {
  it.each([
    [undefined, true, true],
    [undefined, false, false],
    ["false", true, false],
    ["0", true, false],
    ["off", true, false],
    ["NO", true, false],
    ["true", false, true],
    ["1", false, true],
  ])("parses %p with fallback %p as %p", (value, fallback, expected) => {
    expect(readBooleanEnv(value, fallback)).toBe(expected);
  });
});
