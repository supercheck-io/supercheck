import { safeErrorFields } from "./log-safe-error";

describe("safeErrorFields", () => {
  it("redacts drizzle query params but keeps name and code", () => {
    const err = Object.assign(new Error("Failed query: select 1 where token = $1\nparams: tok_secret"), {
      name: "DrizzleQueryError",
      code: "57P01",
    });
    const out = safeErrorFields(err);
    expect(out.name).toBe("DrizzleQueryError");
    expect(out.code).toBe("57P01");
    expect(JSON.stringify(out)).not.toContain("tok_secret");
  });

  it("reads the code from a nested cause (pg errors)", () => {
    const err = new Error("boom", { cause: { code: "23505" } });
    expect(safeErrorFields(err).code).toBe("23505");
  });

  it("handles non-Error values", () => {
    expect(safeErrorFields("plain")).toEqual({ name: "Error", message: "plain" });
    expect(safeErrorFields(undefined)).toEqual({ name: "Error", message: "undefined" });
    expect(safeErrorFields(null).code).toBeUndefined();
  });

  it("keeps the scrubbed root-cause message, not the params", () => {
    const err = new Error("Failed query: select 1\nparams: tok_secret", { cause: new Error("statement timeout") });
    const out = safeErrorFields(err);
    expect(out.cause).toBe("statement timeout");
    expect(JSON.stringify(out)).not.toContain("tok_secret");
  });

  it("never throws on unprintable values", () => {
    expect(safeErrorFields(Object.create(null)).message).toBe("[unprintable]");
  });

  it("never throws when reading the error's fields throws", () => {
    const error = Object.defineProperty(new Error("db down"), "cause", {
      get() { throw new Error("unavailable cause"); },
    });
    expect(safeErrorFields(error)).toEqual({ name: "Error", message: "[unprintable]" });
  });
});
