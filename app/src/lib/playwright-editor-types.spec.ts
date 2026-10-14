/** @jest-environment node */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { getTemplatesByType } from "@/components/playground/template-data";

const appRoot = path.resolve(__dirname, "../..");
const bundlePath = path.join(appRoot, "public/playwright-types.json");

function diagnostics(code: string) {
  const bundle = fs.existsSync(bundlePath)
    ? JSON.parse(fs.readFileSync(bundlePath, "utf8")) as { files: Record<string, string> }
    : { files: {} };
  const files: Record<string, string> = {
    "/playground/example.ts": code,
    "/types/supercheck.d.ts": fs.readFileSync(path.join(appRoot, "public/supercheck.d.ts"), "utf8"),
    ...Object.fromEntries(Object.entries(bundle.files).map(([uri, content]) => [uri.replace("file://", ""), content])),
  };
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const originalReadFile = host.readFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.readFile = (file) => files[file] ?? originalReadFile(file);
  host.fileExists = (file) => file in files || originalFileExists(file);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
    file in files
      ? ts.createSourceFile(file, files[file], languageVersion, true)
      : originalGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram(Object.keys(files), options, host);
  return ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === "/playground/example.ts")
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
}

describe("Playground Playwright declarations", () => {
  it("accepts current APIs, capture options, and Supercheck helpers", () => {
    expect(diagnostics(`
      import { test, type Locator, type BrowserContext, type Page } from '@playwright/test';
      declare const locator: Locator;
      declare const context: BrowserContext;
      declare const page: Page;
      locator.within(locator).visible();
      void context.credentials;
      void context.tracing.startHar('network.har');
      void page.webmcp.tools();
      test.use({
        trace: { mode: 'retain-on-failure-and-retries', snapshots: { dom: true, aria: true, screen: true } },
        video: { mode: 'retain-on-failure-and-retries', fps: 25, show: { actions: { position: 'top-right' } } }
      });
      test.step('sign in', async () => {}, { subtitle: 'test account', params: { user: 'synthetic' } });
      getVariable('URL', { default: 'https://example.com' });
      getSecret('TOKEN');
      getFile('DATA');
      readFile('DATA');
    `)).toEqual([]);
  });

  it("still rejects unsupported APIs", () => {
    expect(diagnostics(`
      import { test } from '@playwright/test';
      test('invalid API', async ({ page }) => { await page.notARealAPI(); });
    `).join("\n")).toContain("Property 'notARealAPI' does not exist");
  });

  it.each(["pw-failure-diagnostics", "pw-passkey-authentication", "pw-webmcp-tools", "pw-resource-lock"])(
    "offers a type-correct browser template: %s",
    (id) => {
      const template = getTemplatesByType("browser").find((item) => item.id === id);
      expect(template).toBeDefined();
      expect(diagnostics(template!.code)).toEqual([]);
    },
  );
});
