import { isJobDeletingError } from "./errors";

describe("isJobDeletingError", () => {
  it("recognises the trigger's SQLSTATE directly and as a wrapped cause", () => {
    expect(isJobDeletingError({ code: "DL001" })).toBe(true);
    expect(isJobDeletingError({ cause: { code: "DL001" } })).toBe(true);
  });
  it("ignores other errors", () => {
    expect(isJobDeletingError({ code: "23503" })).toBe(false);
    expect(isJobDeletingError(new Error("x"))).toBe(false);
    expect(isJobDeletingError(null)).toBe(false);
  });
});
