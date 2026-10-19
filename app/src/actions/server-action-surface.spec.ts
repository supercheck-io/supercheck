/** @jest-environment node */
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import ts from "typescript";

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

function parseSource(source: string, fileName = "action.ts") {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function isUseServerModule(source: string, fileName?: string): boolean {
  for (const statement of parseSource(source, fileName).statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

/** Read actual declarations; comments and source strings cannot mask parameters. */
function exportedFunctionParameters(source: string, fileName?: string): Array<{ name: string; parameters: string[] }> {
  const file = parseSource(source, fileName);
  const found: Array<{ name: string; parameters: string[] }> = [];
  function add(name: string, parameters: ts.NodeArray<ts.ParameterDeclaration>) {
    found.push({ name, parameters: parameters.map((parameter) =>
      parameter.name.getText(file) + (parameter.questionToken ? "?" : "")),
    });
  }
  for (const statement of file.statements) {
    if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(statement)) {
      add(statement.name?.text ?? "default", statement.parameters);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
          add(declaration.name.getText(file), declaration.initializer.parameters);
        }
      }
    }
  }
  return found;
}

describe("server action public surface", () => {
  const serverModules = sourceFiles(SRC_ROOT).filter((file) => isUseServerModule(readFileSync(file, "utf8"), file));

  it("finds the server action modules", () => {
    expect(serverModules.length).toBeGreaterThan(20);
    expect(serverModules.map((file) => path.basename(file))).toEqual(
      expect.arrayContaining(["update-job.ts", "private-agents.ts", "sre-connectors.ts"]),
    );
  });

  it("never accepts a caller-supplied identity, role, or auth context", () => {
    const offenders = serverModules.flatMap((file) =>
      exportedFunctionParameters(readFileSync(file, "utf8"), file).flatMap(({ name, parameters }) =>
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

  it("handles comments and directive prologues without scanning comment contents", () => {
    expect(isUseServerModule('/*' + '*//*'.repeat(10000) + '*/\n"use server";')).toBe(true);
    expect(isUseServerModule('// comment\n"use strict";\n"use server";')).toBe(true);
    expect(isUseServerModule('const source = "use server";')).toBe(false);
    expect(exportedFunctionParameters('export const evil = async role => {};')).toEqual([{ name: "evil", parameters: ["role"] }]);
  });

  it("detects a forged context parameter (self-test)", () => {
    const bad = `"use server";\nexport async function evil(data: Data, contextOverride?: Ctx) {}`;
    expect(exportedFunctionParameters(bad)).toEqual([{ name: "evil", parameters: ["data", "contextOverride?"] }]);
    expect(FORBIDDEN_PARAMETER.test("contextOverride?")).toBe(true);
    expect(FORBIDDEN_PARAMETER.test("input")).toBe(false);
    const arrow = `"use server";\nexport const evil = async (data: Data, role: string) => {}`;
    expect(exportedFunctionParameters(arrow)).toEqual([{ name: "evil", parameters: ["data", "role"] }]);
  });
});
