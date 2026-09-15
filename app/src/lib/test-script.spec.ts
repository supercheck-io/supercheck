import {
  decodeStoredTestScript,
  encodeStoredTestScript,
  sanitizeTestScript,
} from "./test-script";

describe("sanitizeTestScript", () => {
  it("strips sourceMappingURL comments and trailing binary bytes", () => {
    const source = [
      "import { test } from '@playwright/test';",
      "test('ok', async () => {});",
      "//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbXX0=",
      "\u0000\uFFFD\u0001binary-sourcemap",
    ].join("\n");

    expect(sanitizeTestScript(source)).toBe(
      "import { test } from '@playwright/test';\ntest('ok', async () => {});\n",
    );
  });

  it("keeps normal TypeScript including unicode in strings", () => {
    const source = "test('status 🚀', async () => {});\n";
    expect(sanitizeTestScript(source)).toBe(source);
  });
});

describe("decodeStoredTestScript", () => {
  it("decodes genuine base64 source", () => {
    const source = "import { test } from '@playwright/test';\n";
    const encoded = Buffer.from(source, "utf8").toString("base64");
    expect(decodeStoredTestScript(encoded)).toBe(source);
  });

  it("leaves raw TypeScript alone instead of base64-decoding it", () => {
    const source = "import { test } from '@playwright/test';\ntest('ok', async () => {});\n";
    expect(decodeStoredTestScript(source)).toBe(source);
  });
});

describe("encodeStoredTestScript", () => {
  it("round-trips raw source to base64 of sanitized UTF-8", () => {
    const source = "test('ok', async () => {});";
    const encoded = encodeStoredTestScript(source);
    expect(decodeStoredTestScript(encoded).trim()).toBe(source);
  });
});
