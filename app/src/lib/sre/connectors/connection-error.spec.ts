import { describeConnectionError } from "./connection-error";

const withCause = (code: string) =>
  Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("x"), { code }) });

describe("describeConnectionError", () => {
  it.each([
    ["ECONNREFUSED", "Connection refused"],
    ["ETIMEDOUT", "timed out"],
    ["ENOTFOUND", "Could not resolve"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "self-signed"],
    ["CERT_HAS_EXPIRED", "expired"],
  ])("maps a fetch failure caused by %s", (code, text) => {
    const message = describeConnectionError(withCause(code), "failed");
    expect(message).toContain(text);
    expect(message).toContain(code);
  });

  it("keeps ordinary messages and names timeouts", () => {
    expect(describeConnectionError(new Error("credentials rejected with HTTP 401"), "failed")).toBe("credentials rejected with HTTP 401");
    expect(describeConnectionError(Object.assign(new Error("aborted"), { name: "TimeoutError" }), "failed")).toContain("timed out");
    expect(describeConnectionError("weird", "failed")).toBe("failed");
  });
});
