/** @jest-environment node */
import { pinoConfig } from "./pino-config";
import { scrubSerializedError } from "@/lib/log-safe-error";

function drizzleError(token: string) {
  const pg = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
  return Object.assign(new Error(`Failed query: select * from session where token = $1\nparams: ${token}`), {
    query: "select * from session where token = $1",
    params: [token],
    cause: pg,
  });
}

describe("pino error serializers", () => {
  it.each(["err", "error"] as const)("keep a failed query's parameters out of %s", (key) => {
    const out = pinoConfig.serializers[key](drizzleError("tok_live_123")) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain("tok_live_123");
    expect(out.params).toBeUndefined();
    expect(out.query).toBe("select * from session where token = $1");
    expect(String(out.stack)).toMatch(/\n\s+at /);
    // The root cause stays readable.
    expect(String(out.stack)).toContain("caused by: Error: canceling statement due to statement timeout");
  });
});

describe("scrubSerializedError", () => {
  it("passes non-objects through", () => {
    expect(scrubSerializedError(undefined)).toBeUndefined();
    expect(scrubSerializedError("x")).toBe("x");
  });

  it("does not throw on a hostile object", () => {
    const hostile = new Proxy({}, { ownKeys() { throw new Error("nope"); } });
    expect(scrubSerializedError(hostile)).toEqual({ type: "Error", message: "[unprintable]" });
  });
});
