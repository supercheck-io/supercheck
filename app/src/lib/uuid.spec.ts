import { isInvalidUuidError, isUuid } from "./uuid";

describe("uuid helpers", () => {
  it("accepts canonical uuids only", () => {
    expect(isUuid("0196b0f2-7c1e-7a3b-8d11-2f5e9c3a4b6d")).toBe(true);
    expect(isUuid("3885")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
  it("recognises Postgres invalid-uuid errors, including wrapped ones", () => {
    expect(isInvalidUuidError({ code: "22P02" })).toBe(true);
    expect(isInvalidUuidError(new Error("x", { cause: { code: "22P02" } }))).toBe(true);
    expect(isInvalidUuidError(new Error('invalid input syntax for type uuid: "3885"'))).toBe(true);
    expect(isInvalidUuidError(Object.assign(new Error("Failed query: select ..."), { cause: Object.assign(new Error("pg"), { code: "22P02" }) }))).toBe(true);
    expect(isInvalidUuidError(new Error("connection refused"))).toBe(false);
  });
});
