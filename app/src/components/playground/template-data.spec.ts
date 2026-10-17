/** @jest-environment node */
import ts from "typescript";
import { codeTemplates, getTemplatesByType } from "./template-data";
import { playwrightValidationService } from "@/lib/playwright-validator";
function evaluateTemplate(
  id: string,
  modules: Record<string, unknown> = {},
  helpers: Record<string, unknown> = {},
) {
  const template = codeTemplates.find((t) => t.id === id)!;
  const source = ts.transpileModule(template.code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", ...Object.keys(helpers), source)(
    (name: string) => modules[name] ?? {},
    exports,
    ...Object.values(helpers),
  );
  return exports;
}
it("keeps IDs unique and test types isolated", () => {
  expect(new Set(codeTemplates.map((t) => t.id)).size).toBe(
    codeTemplates.length,
  );
  for (const type of [
    "browser",
    "api",
    "database",
    "custom",
    "performance",
  ] as const) {
    expect(getTemplatesByType(type).length).toBeGreaterThan(0);
    expect(getTemplatesByType(type).every((t) => t.testType === type)).toBe(
      true,
    );
  }
});
it.each(codeTemplates.map((t) => [t.id, t] as const))(
  "validates offered template %s",
  (_id, template) => {
    const result = playwrightValidationService.validateCode(template.code, {
      selectedTestType: template.testType,
    });
    expect(result.error).toBeUndefined();
    expect(result.valid).toBe(true);
  },
);
it("configures breakpoint arrival rate in a named scenario", () => {
  const { options } = evaluateTemplate("k6-breakpoint-test");
  expect(options).toMatchObject({
    scenarios: {
      breakpoint: {
        executor: "ramping-arrival-rate",
        startRate: 5,
        preAllocatedVUs: 10,
        maxVUs: 20,
      },
    },
  });
  expect(options).not.toHaveProperty("executor");
});
it("handles malformed response JSON as failed checks", () => {
  const results: boolean[] = [];
  const response = {
    status: 200,
    body: "not JSON",
    headers: { "Content-Type": "text/html" },
    timings: { duration: 10 },
  };
  class Metric {
    add() {}
  }
  const script = evaluateTemplate("k6-checks-assertions", {
    "k6/http": { get: () => response },
    "k6/metrics": { Rate: Metric, Trend: Metric },
    k6: {
      sleep: () => {},
      check: (
        value: typeof response,
        checks: Record<string, (r: typeof response) => boolean>,
      ) => {
        results.push(
          ...Object.values(checks).map((check) => Boolean(check(value))),
        );
        return results.every(Boolean);
      },
    },
  });
  expect(() => (script.default as () => void)()).not.toThrow();
  expect(results).toContain(false);
});
it("rejects empty or malformed file datasets and ignores blank lines", () => {
  const register = jest.fn();
  const modules = { "@playwright/test": { test: register } };
  expect(() =>
    evaluateTemplate("pw-data-driven-file", modules, {
      readFile: () => "url,expectedTitle\n",
    }),
  ).toThrow("at least one data row");
  expect(() =>
    evaluateTemplate("pw-data-driven-file", modules, {
      readFile: () => "url,expectedTitle\nhttps://example.com",
    }),
  ).toThrow("url,expectedTitle");
  evaluateTemplate("pw-data-driven-file", modules, {
    readFile: () =>
      "url,expectedTitle\nhttps://example.com,Example (Domain)\n\n",
  });
  expect(register).toHaveBeenCalledTimes(1);
  class SharedArray {
    constructor(_name: string, factory: () => unknown[]) {
      return factory();
    }
  }
  const k6Modules = { "k6/data": { SharedArray } };
  const helpers = {
    getFile: () => "/tmp/users.csv",
    open: () => "username,password\n",
  };
  expect(() =>
    evaluateTemplate("k6-data-driven-file", k6Modules, helpers),
  ).toThrow("at least one data row");
  expect(() =>
    evaluateTemplate("k6-data-driven-file", k6Modules, {
      ...helpers,
      open: () => "username,password\nuser",
    }),
  ).toThrow("username,password");
});

it.each(["pw-db-read", "pw-db-transaction", "pw-db-update"])(
  "closes database connections when %s fails",
  async (id) => {
    let run: () => Promise<void> = async () => {};
    const test = Object.assign(
      (_name: string, callback: () => Promise<void>) => {
        run = callback;
      },
      {
        describe: (_name: string, body: () => void) => body(),
      },
    );
    const end = jest.fn();
    class Client {
      connect = jest.fn();
      query = jest.fn().mockRejectedValue(new Error("query failed"));
      end = end;
    }
    evaluateTemplate(id, {
      "@playwright/test": { test, expect },
      pg: { Client },
    });
    await expect(run()).rejects.toThrow("query failed");
    expect(end).toHaveBeenCalledTimes(1);
  },
);

it.each([false, true])(
  "checks WebSocket echoes even when no matching message arrives: %s",
  (echo) => {
    const checkResults: Record<string, boolean> = {};
    const response = { status: 200 };
    const script = evaluateTemplate("k6-websocket", {
      "k6/http": { get: () => response },
      k6: {
        sleep: () => {},
        group: (_name: string, fn: () => void) => fn(),
        check: (
          value: unknown,
          checks: Record<string, (value: unknown) => boolean>,
        ) => {
          for (const [name, check] of Object.entries(checks))
            checkResults[name] = Boolean(check(value));
        },
      },
      "k6/ws": {
        connect: (
          _url: string,
          _options: unknown,
          callback: (socket: unknown) => void,
        ) => {
          const handlers: Record<string, (value?: string) => void> = {};
          callback({
            on: (name: string, fn: (value?: string) => void) => {
              handlers[name] = fn;
            },
            send: () => {},
            close: () => {},
            setTimeout: () => {},
          });
          handlers.message("server greeting");
          if (echo) handlers.message("Hello from k6!");
          return { status: 101 };
        },
      },
    });
    (script.default as () => void)();
    expect(checkResults["WebSocket upgraded"]).toBe(true);
    expect(checkResults["echo received"]).toBe(echo);
  },
);

it("uses one VU per CSV data row and accepts Windows line endings", () => {
  class SharedArray {
    constructor(_name: string, factory: () => unknown[]) {
      return factory();
    }
  }
  const { options } = evaluateTemplate("k6-data-driven-file", {
    "k6/data": { SharedArray },
  }, {
    getFile: () => "/tmp/users.csv",
    open: () => "username,password\r\nuser1,password1\r\nuser2,password2\r\n\r\n",
  });
  expect(options).toMatchObject({ vus: 2 });
});

it.each([
  ["pw-data-driven-file", "url,expectedTitle", "https://example.com,Example"],
  ["k6-data-driven-file", "username,password", "user,password"],
])("rejects unsupported CSV formats in %s", (id, header, row) => {
  class SharedArray {
    constructor(_name: string, factory: () => unknown[]) {
      return factory();
    }
  }
  const modules = {
    "@playwright/test": { test: jest.fn() },
    "k6/data": { SharedArray },
  };
  for (const content of [
    `wrong,header\n${row}`,
    `${header}\n${row},extra`,
    `${header}\n"${row}"`,
  ]) {
    expect(() => evaluateTemplate(id, modules, {
      readFile: () => content,
      open: () => content,
      getFile: () => "/tmp/data.csv",
    })).toThrow();
  }
});

it.each(getTemplatesByType("performance").map((template) => template.id))(
  "makes response validation affect pass/fail in %s",
  (id) => {
    class Metric { add() {} }
    class SharedArray {
      constructor(_name: string, factory: () => unknown[]) { return factory(); }
    }
    const { options } = evaluateTemplate(id, {
      "k6/metrics": { Rate: Metric, Counter: Metric, Trend: Metric },
      "k6/data": { SharedArray },
      "k6/net/grpc": { Client: class {} },
    }, {
      open: () => "username,password\nuser,password",
      getFile: () => "/tmp/data.csv",
    });
    const thresholds = (options as { thresholds: Record<string, unknown> }).thresholds;
    // The stress example records every check result in its own error-rate metric.
    expect(thresholds.checks ?? thresholds.errors).toBeDefined();
  },
);

it.each(["connect", "invoke", "success"])(
  "records gRPC %s outcomes and closes the client",
  (outcome) => {
    const results: boolean[] = [];
    const close = jest.fn();
    class Client {
      connect() { if (outcome === "connect") throw new Error("unavailable"); }
      invoke() {
        if (outcome === "invoke") throw new Error("RPC failed");
        return { status: 0 };
      }
      close = close;
    }
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const script = evaluateTemplate("k6-grpc", {
        "k6/http": { get: () => ({ status: 200 }) },
        "k6/net/grpc": { Client, StatusOK: 0 },
        k6: {
          sleep: () => {},
          group: (_name: string, body: () => void) => body(),
          check: (value: unknown, checks: Record<string, (value: unknown) => boolean>) => {
            if ("gRPC ok" in checks) results.push(checks["gRPC ok"](value));
          },
        },
      });
      expect(() => (script.default as () => void)()).not.toThrow();
      expect(results).toEqual([outcome === "success"]);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  },
);

it("registers distinct tests for repeated CSV rows", () => {
  const register = jest.fn();
  evaluateTemplate("pw-data-driven-file", {
    "@playwright/test": { test: register },
  }, {
    readFile: () => "url,expectedTitle\nhttps://example.com,Example\nhttps://example.com,Example\n",
  });
  const titles = register.mock.calls.map(([title]) => title);
  expect(titles).toHaveLength(2);
  expect(new Set(titles).size).toBe(2);
});

it.each(["navigator", "document"])(
  "registers and calls its WebMCP example with the %s API",
  async (placement) => {
    let run: (args: unknown) => Promise<void> = async () => {};
    let body = "";
    let tool: { name: string; execute: (args: unknown) => unknown } | undefined;
    const modelContext = { registerTool: (value: typeof tool) => { tool = value; } };
    const test = Object.assign(
      (_title: string, callback: typeof run) => { run = callback; },
      { use: () => {}, step: (_title: string, callback: () => unknown) => callback() },
    );
    evaluateTemplate("pw-webmcp-tools", { "@playwright/test": { test, expect } });
    const page = {
      route: async (_url: string, handler: (route: unknown) => unknown) => {
        await handler({ fulfill: (options: { body: string }) => { body = options.body; } });
      },
      goto: async () => {
        const script = body.split("<script>")[1].split("</script>")[0];
        new Function("navigator", "document", script)(
          placement === "navigator" ? { modelContext } : {},
          placement === "document" ? { modelContext } : {},
        );
      },
      webmcp: {
        tools: async () => tool ? [{ name: tool.name }] : [],
        callTool: async (_name: string, args: unknown) => tool!.execute(args),
      },
    };
    await run({ page });
    expect(tool?.name).toBe("add");
  },
);
