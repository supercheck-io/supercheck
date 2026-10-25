import { isTestPriority } from "./common";

describe("isTestPriority", () => {
  it.each(["low", "medium", "high"])("accepts %s", (value) => {
    expect(isTestPriority(value)).toBe(true);
  });

  it.each(["urgent", "", "HIGH", null, 1])("rejects %p", (value) => {
    expect(isTestPriority(value)).toBe(false);
  });
});
