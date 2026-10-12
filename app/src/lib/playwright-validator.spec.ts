/** @jest-environment node */

import {
  PlaywrightValidationService,
  getAllowedModules,
  isModuleAllowed,
  playwrightValidationService,
} from "./playwright-validator";

const service = new PlaywrightValidationService();

const VALID_PLAYWRIGHT_SCRIPT = `import { test, expect } from '@playwright/test';

test('homepage loads', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});`;

const VALID_K6_SCRIPT = `import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { vus: 1, duration: '1s' };

export default function () {
  const res = http.get('https://example.com');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}`;

describe("playwright-validator", () => {
  describe("input validation", () => {
    it("rejects empty input", () => {
      const result = service.validateCode("");

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("syntax");
      expect(result.error).toContain("Invalid script content");
    });

    it("rejects non-string input", () => {
      const result = service.validateCode(null as unknown as string);

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("syntax");
    });

    it("rejects scripts over the 50KB limit", () => {
      const result = service.validateCode("a".repeat(50_001));

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("length");
      expect(result.error).toContain("Script too long");
    });
  });

  describe("test type routing", () => {
    it("accepts a valid Playwright script with no selected type", () => {
      expect(service.validateCode(VALID_PLAYWRIGHT_SCRIPT)).toEqual({
        valid: true,
      });
    });

    it("accepts a k6 script when the test type is performance", () => {
      expect(
        service.validateCode(VALID_K6_SCRIPT, { selectedTestType: "performance" }),
      ).toEqual({ valid: true });
    });

    it("accepts a k6 script when the test type is k6 (case-insensitive)", () => {
      // "k6" is accepted by the validator's normalisation but is not part of
      // the persisted TestType union, so the option is cast here.
      expect(
        service.validateCode(VALID_K6_SCRIPT, {
          selectedTestType: "k6" as never,
        }),
      ).toEqual({ valid: true });
      expect(
        service.validateCode(VALID_K6_SCRIPT, {
          selectedTestType: "PERFORMANCE" as never,
        }),
      ).toEqual({ valid: true });
    });

    it("rejects a k6 script when the test type is not performance", () => {
      const result = service.validateCode(VALID_K6_SCRIPT, {
        selectedTestType: "browser",
      });

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("type");
      expect(result.error).toContain("Detected k6 performance script");
    });

    it("rejects a Playwright script when the test type is performance", () => {
      const result = service.validateCode(VALID_PLAYWRIGHT_SCRIPT, {
        selectedTestType: "performance",
      });

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("type");
      expect(result.error).toContain("Performance tests must use k6 scripts");
    });

    it("surfaces k6 validation errors for invalid k6 scripts", () => {
      const result = service.validateCode(
        `import http from 'k6/http';\nhttp.get('https://example.com');`,
        { selectedTestType: "performance" },
      );

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("type");
    });
  });

  describe("dangerous pattern detection", () => {
    it.each([
      ["eval", `eval('1 + 1');`, "eval() is not allowed"],
      [
        "Function constructor",
        `const f = new Function('return 1');`,
        "Function constructor is not allowed",
      ],
      ["zero-delay setTimeout", `setTimeout(() => {}, 0);`, "Zero-delay setTimeout"],
      ["short setInterval", `setInterval(() => {}, 5);`, "Very short setInterval"],
      ["setImmediate", `setImmediate(() => {});`, "setImmediate is not allowed"],
      ["process access", `const p = process.env.FOO;`, "Process access is not allowed"],
      ["global access", `global.x = 1;`, "Global object access is not allowed"],
      ["globalThis access", `globalThis.x = 1;`, "GlobalThis access is not allowed"],
      ["javascript: URL", `const u = 'javascript:alert(1)';`, "JavaScript URLs are not allowed"],
      ["data:text/html URL", `const u = 'data:text/html,<h1>x</h1>';`, "Data URLs with HTML are not allowed"],
      ["srcdoc attribute", `const s = '<iframe srcdoc="x"></iframe>';`, "srcdoc attribute is not allowed"],
      ["while(true)", `while (true) {}`, "Infinite loop detected: while(true)"],
      ["while(1)", `while (1) {}`, "Infinite loop detected: while(1)"],
      ["while(!0)", `while (!0) {}`, "Infinite loop detected: while(!0)"],
      ["for(;;)", `for (;;) {}`, "Infinite loop detected: for(;;)"],
      ["for with true condition", `for (let i = 0; true; i++) {}`, "for loop with true condition"],
      ["__proto__", `const x = {}; x.__proto__ = null;`, "__proto__ manipulation is not allowed"],
      ["prototype access", `Foo.prototype['bar'] = 1;`, "Prototype manipulation is not allowed"],
      ["constructor access", `const n = ({}).constructor.name;`, "Constructor access is not allowed"],
      ["__dirname", `const d = __dirname;`, "__dirname is not allowed"],
      ["__filename", `const f = __filename;`, "__filename is not allowed"],
      ["Worker", `const w = new Worker('x.js');`, "Web Workers are not allowed"],
      ["SharedArrayBuffer", `const b = new SharedArrayBuffer(8);`, "SharedArrayBuffer is not allowed"],
      ["Atomics", `Atomics.store(new Int32Array(1), 0, 1);`, "Atomics operations are not allowed"],
      ["require.cache", `require.cache = {};`, "require.cache manipulation is not allowed"],
      ["require.resolve", `const p = require.resolve('x');`, "require.resolve is not allowed"],
      ["module.exports", `module.exports = {};`, "module.exports manipulation is not allowed"],
      ["new Buffer", `const b = new Buffer(8);`, "Buffer constructor is not allowed"],
      ["Buffer() call", `const b = Buffer('x');`, "Direct Buffer() calls are not allowed"],
      ["Buffer.allocUnsafe", `const b = Buffer.allocUnsafe(8);`, "Unsafe Buffer allocation methods are not allowed"],
      ["ArrayBuffer", `const b = new ArrayBuffer(8);`, "ArrayBuffer operations should be avoided"],
      ["unescape", `const s = unescape('%20');`, "unescape is not allowed"],
      ["decodeURI", `const s = decodeURI('%20');`, "URI decoding functions are not allowed"],
      ["console.clear", `console.clear();`, "Console clearing is not allowed"],
      ["console indexing", `console['log']('x');`, "Console manipulation is not allowed"],
    ])("rejects %s", (_label, script, expectedError) => {
      const result = service.validateCode(script);

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("security");
      expect(result.error).toContain(expectedError);
    });

    it("reports the line number of a dangerous pattern", () => {
      const script = `import { test } from '@playwright/test';\n\nconst p = process.env.FOO;`;

      const result = service.validateCode(script);

      expect(result.valid).toBe(false);
      expect(result.line).toBe(3);
    });
  });

  describe("obfuscation detection", () => {
    it("rejects excessive hex escapes", () => {
      const script = `const s = "${"\\x41".repeat(20)}";`;

      const result = service.validateCode(script);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("hex escape");
    });

    it("rejects excessive unicode escapes", () => {
      const script = `const s = "${"\\u0041".repeat(10)}";`;

      const result = service.validateCode(script);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("unicode escape");
    });

    it("rejects very large string arrays", () => {
      const entry = `"${"a".repeat(60)}"`;
      const script = `const s = [${Array.from({ length: 20 }, () => entry).join(",")}];`;

      const result = service.validateCode(script);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("string arrays");
    });
  });

  describe("module restrictions", () => {
    it.each(["zod", "axios", "date-fns", "pg", "@playwright/test"])(
      "accepts import of allowed module %s",
      (moduleName) => {
        const result = service.validateCode(
          `import mod from '${moduleName}';\nexport const value = mod;`,
        );

        expect(result.valid).toBe(true);
      },
    );

    it.each(["fs", "child_process", "http", "https", "os", "net"])(
      "rejects import of blocked module %s",
      (moduleName) => {
        const result = service.validateCode(
          `import mod from '${moduleName}';\nexport const value = mod;`,
        );

        expect(result.valid).toBe(false);
        expect(result.errorType).toBe("security");
        expect(result.error).toContain(
          `Import of module '${moduleName}' is not allowed`,
        );
      },
    );

    it.each(["fs", "child_process"])(
      "rejects side-effect import of blocked module %s",
      (moduleName) => {
        const result = service.validateCode(`import '${moduleName}';`);

        expect(result.valid).toBe(false);
        expect(result.error).toContain(
          `Import of module '${moduleName}' is not allowed`,
        );
      },
    );

    it("suggests @playwright/test when importing @playwright", () => {
      const result = service.validateCode(
        `import { test } from '@playwright';\nexport const t = test;`,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Use '@playwright/test' instead");
    });

    it("rejects dynamic require() calls", () => {
      const result = service.validateCode(
        `const name = 'zod';\nconst mod = require(name);`,
      );

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("pattern");
      expect(result.error).toContain("Usage of 'require' is not allowed");
    });

    it("rejects require() with the wrong number of arguments", () => {
      const result = service.validateCode(`const mod = require('zod', {});`);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Usage of 'require' is not allowed");
    });

    it("rejects require() usage with an ES-import suggestion", () => {
      const result = service.validateCode(`const mod = require('zod');`);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Use ES6 import statements instead");
    });

    it("accepts unused blocked imports because esbuild elides them before execution", () => {
      // TypeScript semantics: an unused default/named import is removed during
      // transpilation, so it never executes. Only imports that are actually
      // referenced (or side-effect imports) are validated — and those are
      // rejected by the tests above.
      expect(service.validateCode(`import mod from 'fs';`)).toEqual({
        valid: true,
      });
    });
  });

  describe("blocked identifiers", () => {
    it.each(["process", "global", "globalThis", "module", "exports"])(
      "rejects standalone identifier %s",
      (identifier) => {
        const result = service.validateCode(`const value = ${identifier};`);

        expect(result.valid).toBe(false);
        expect(result.errorType).toBe("security");
        expect(result.error).toContain(`Usage of '${identifier}' is not allowed`);
      },
    );
  });

  describe("complexity limits", () => {
    it("rejects scripts with more than 1000 statements", () => {
      const script = "a++;".repeat(1001);

      const result = service.validateCode(script);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Script too complex");
    });

    it("accepts scripts below the statement limit", () => {
      const script = "a++;".repeat(100);

      expect(service.validateCode(script)).toEqual({ valid: true });
    });

    it("rejects extremely long string literals", () => {
      const script = `const s = "${"a".repeat(5001)}";`;

      const result = service.validateCode(script);

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("security");
      expect(result.error).toContain("Extremely long string literal");
    });
  });

  describe("syntax errors", () => {
    it("rejects code that does not parse", () => {
      const result = service.validateCode("const x = ;");

      expect(result.valid).toBe(false);
      expect(result.errorType).toBe("syntax");
      expect(result.error).toContain("Syntax error");
    });

    it("accepts TypeScript syntax via transpilation", () => {
      const result = service.validateCode(
        `import { test } from '@playwright/test';\n\nconst value: string = 'ok';\ntest('x', async () => { console.log(value); });`,
      );

      expect(result).toEqual({ valid: true });
    });
  });

  describe("module allow-list helpers", () => {
    it("exposes the allowed module list", () => {
      const modules = getAllowedModules();

      expect(modules).toContain("@playwright/test");
      expect(modules).toContain("k6/http");
      expect(modules).not.toContain("fs");
      expect(service.getAllowedModules()).toEqual(modules);
    });

    it.each([
      ["@playwright/test", true],
      ["@playwright/experimental-ct-react", true],
      ["k6", true],
      ["k6/http", true],
      ["zod", true],
      ["fs", false],
      ["child_process", false],
      ["node:fs", false],
    ])("isModuleAllowed(%s) === %s", (moduleName, expected) => {
      expect(isModuleAllowed(moduleName)).toBe(expected);
      expect(service.isModuleAllowed(moduleName)).toBe(expected);
    });

    it("exports a shared singleton instance", () => {
      expect(playwrightValidationService).toBeInstanceOf(PlaywrightValidationService);
      expect(playwrightValidationService.validateCode(VALID_PLAYWRIGHT_SCRIPT)).toEqual(
        { valid: true },
      );
    });
  });
});
