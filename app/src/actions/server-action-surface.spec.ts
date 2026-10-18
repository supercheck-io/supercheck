/** @jest-environment node */
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

/**
 * Every exported function of a "use server" module is a public RPC endpoint:
 * the browser can call it with arbitrary arguments. Authorization must come
 * from the server session, never from a caller-supplied identity, role or
 * context, so no such parameter may appear on the public surface.
 */
const SRC_ROOT = path.resolve(__dirname, "..");
const FORBIDDEN_PARAMETER = /^(context|\w*Context|contextOverride|requestContext|authContext|role|userRole|userId|session|permissions)\??$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.(spec|test)\./.test(entry) ? [full] : [];
  });
}

function isUseServerModule(source: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*["']use server["']/.test(source);
}

/** Top-level parameter names of each exported function in a module. */
function exportedFunctionParameters(source: string): Array<{ name: string; parameters: string[] }> {
  const found: Array<{ name: string; parameters: string[] }> = [];
  const declaration = /export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^(]*>)?\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(source))) {
    let depth = 1;
    let index = declaration.lastIndex;
    let start = index;
    const parameters: string[] = [];
    for (; index < source.length && depth > 0; index++) {
      const char = source[index];
      if ("({[<".includes(char)) depth++;
      else if (")}]>".includes(char) && !(char === ">" && source[index - 1] === "=")) depth--;
      if ((char === "," && depth === 1) || depth === 0) {
        parameters.push(source.slice(start, char === "," ? index : index));
        start = index + 1;
      }
    }
    found.push({
      name: match[1],
      parameters: parameters
        .map((parameter) => parameter.trim().replace(/^\.\.\./, ""))
        .filter(Boolean)
        .map((parameter) => parameter.split(/[:=]/)[0].trim()),
    });
  }
  return found;
}

describe("server action public surface", () => {
  const serverModules = sourceFiles(SRC_ROOT).filter((file) => isUseServerModule(readFileSync(file, "utf8")));

  it("finds the server action modules", () => {
    expect(serverModules.length).toBeGreaterThan(20);
    expect(serverModules.map((file) => path.basename(file))).toEqual(
      expect.arrayContaining(["update-job.ts", "private-agents.ts", "sre-connectors.ts"]),
    );
  });

  it("never accepts a caller-supplied identity, role, or auth context", () => {
    const offenders = serverModules.flatMap((file) =>
      exportedFunctionParameters(readFileSync(file, "utf8")).flatMap(({ name, parameters }) =>
        parameters
          .filter((parameter) => FORBIDDEN_PARAMETER.test(parameter))
          .map((parameter) => `${path.relative(SRC_ROOT, file)}: ${name}(${parameter})`),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("never forwards unbounded arguments to a service function", () => {
    const offenders = serverModules.filter((file) => /\(\.\.\.args\b/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("detects a forged context parameter (self-test)", () => {
    const bad = `"use server";\nexport async function evil(data: Data, contextOverride?: Ctx) {}`;
    expect(exportedFunctionParameters(bad)).toEqual([{ name: "evil", parameters: ["data", "contextOverride?"] }]);
    expect(FORBIDDEN_PARAMETER.test("contextOverride?")).toBe(true);
    expect(FORBIDDEN_PARAMETER.test("input")).toBe(false);
  });
});
