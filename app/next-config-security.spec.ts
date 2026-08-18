import { PHASE_PRODUCTION_BUILD } from "next/constants";

import createNextConfig from "./next.config";

describe("production security headers", () => {
  it("disables framework disclosure and development-only CSP sources", async () => {
    const config = createNextConfig(PHASE_PRODUCTION_BUILD);

    expect(config.poweredByHeader).toBe(false);
    expect(config.headers).toBeDefined();

    const headerRules = await config.headers!();
    const headers = new Map(
      headerRules[0].headers.map(({ key, value }) => [key, value]),
    );
    const contentSecurityPolicy = headers.get("Content-Security-Policy");

    expect(contentSecurityPolicy).toBeDefined();
    const directives = new Map(
      contentSecurityPolicy!
        .split(";")
        .map((directive) => directive.trim())
        .filter(Boolean)
        .map((directive) => {
          const [name, ...sources] = directive.split(/\s+/);
          return [name, sources];
        }),
    );

    expect(directives.get("script-src")).not.toContain("'unsafe-eval'");
    for (const directive of [
      "script-src",
      "style-src",
      "img-src",
      "font-src",
      "connect-src",
      "media-src",
      "frame-src",
      "form-action",
    ]) {
      expect(directives.get(directive)).not.toContain("http:");
    }
    expect(directives.get("connect-src")).not.toContain("ws:");
    expect(headers.get("X-XSS-Protection")).toBe("0");
  });
});
