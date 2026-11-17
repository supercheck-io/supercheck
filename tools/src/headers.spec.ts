import { describe, expect, it } from "vitest";
import { keptHeaders } from "./context";

describe("header allow-list", () => {
  it("drops set-cookie and unknown headers", () => {
    const h = new Headers({ "set-cookie": "s=1", "x-secret": "y", server: "nginx", "Content-Type": "text/html" });
    expect(keptHeaders(h)).toEqual({ server: "nginx", "content-type": "text/html" });
  });

  it("caps values at 4 KB", () => {
    const h = new Headers({ "content-security-policy": "a".repeat(9000) });
    expect(keptHeaders(h)["content-security-policy"]).toHaveLength(4096);
  });
});
