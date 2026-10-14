const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const ts = require("typescript");

const appRoot = path.resolve(__dirname, "..");
const modulesRoot = path.join(appRoot, "node_modules");
const testPackagePath = require.resolve("@playwright/test/package.json");
const testPackage = require(testPackagePath);
const version = testPackage.version;
assert.equal(require("playwright/package.json").version, version);
assert.equal(require("playwright-core/package.json").version, version);

const entry = ts.resolveModuleName("@playwright/test", path.join(appRoot, "editor.ts"), {
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
}, ts.sys).resolvedModule;
assert.ok(entry, "Cannot resolve installed Playwright declarations");
const program = ts.createProgram([entry.resolvedFileName], {
  types: ["node"],
  typeRoots: [path.join(modulesRoot, "@types")],
  skipLibCheck: true,
});
const files = {};
const licenses = {};
const packages = new Set();
for (const source of program.getSourceFiles()) {
  if (!source.isDeclarationFile) continue;
  const relative = path.relative(modulesRoot, source.fileName).replaceAll(path.sep, "/");
  if (relative.startsWith("../") || path.isAbsolute(relative) || relative.startsWith("typescript/lib/")) continue;
  files[`file:///node_modules/${relative}`] = source.text;
  const parts = relative.split("/");
  packages.add(parts.slice(0, parts[0].startsWith("@") ? 2 : 1).join("/"));
  if (/\/index\.d\.[cm]ts$/.test(relative)) {
    const extension = relative.endsWith(".cts") ? "cjs" : "mjs";
    files[`file:///node_modules/${relative.replace(/\.d\.[cm]ts$/, ".d.ts")}`] = `export * from './index.${extension}';\n`;
  }
}
for (const name of packages) {
  const packageRoot = path.join(modulesRoot, name);
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const entry = manifest.types || manifest.typings;
  const index = `file:///node_modules/${name}/index.d.ts`;
  if (typeof entry === "string" && !files[index]) {
    const target = entry.replace(/\.d\.ts$/, "").replace(/\.d\.cts$/, ".cjs").replace(/\.d\.mts$/, ".mjs");
    files[index] = `export * from './${target.replace(/^\.\//, "")}';\n`;
  }
  for (const filename of ["LICENSE", "LICENSE.md", "LICENSE.txt", "NOTICE"]) {
    const file = path.join(packageRoot, filename);
    if (fs.existsSync(file)) licenses[`${name}/${filename}`] = fs.readFileSync(file, "utf8");
  }
}
const bundle = JSON.stringify({ version, files, licenses });
fs.writeFileSync(path.join(appRoot, "public/playwright-types.json"), bundle);
console.log(`Generated Playwright ${version} editor types (${Object.keys(files).length} declarations).`);
