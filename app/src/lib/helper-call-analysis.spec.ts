import { hasUnboundHelperCall } from "./helper-call-analysis";

describe("hasUnboundHelperCall globalThis", () => {
  it("detects globalThis.getFile(...)", () => {
    expect(hasUnboundHelperCall("globalThis.getFile('a')", "getFile")).toBe(true);
  });
  it("ignores a locally bound globalThis", () => {
    expect(
      hasUnboundHelperCall("const globalThis = { getFile() {} }; globalThis.getFile('a');", "getFile"),
    ).toBe(false);
  });
});
