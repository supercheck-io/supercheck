import { isDeletingError } from "./errors";

describe("isDeletingError", () => {
  it("recognises the trigger's SQLSTATE directly and as a wrapped cause", () => {
    expect(isDeletingError({ code: "DL001" })).toBe(true);
    expect(isDeletingError({ cause: { code: "DL001" } })).toBe(true);
  });
  it("ignores other errors", () => {
    expect(isDeletingError({ code: "23503" })).toBe(false);
    expect(isDeletingError(new Error("x"))).toBe(false);
    expect(isDeletingError(null)).toBe(false);
  });
});
