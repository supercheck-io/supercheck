import { getDatabasePoolMax } from "./db-pool";

describe("app database pool size", () => {
  it("preserves the default and accepts an explicit size", () => {
    expect(getDatabasePoolMax("")).toBe(30);
    expect(getDatabasePoolMax("10")).toBe(10);
  });

  it.each([
    "0",
    "1",
    "-1",
    "2.5",
    "10oops",
    " 10 ",
    "NaN",
    "Infinity",
    "9007199254740992",
  ])("rejects %s before constructing a pool", (value) =>
    expect(() => getDatabasePoolMax(value)).toThrow("DB_POOL_MAX"),
  );
});
