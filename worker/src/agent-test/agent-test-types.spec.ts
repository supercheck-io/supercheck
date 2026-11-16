import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

// The app cannot import the worker package, so the editor's copy is a committed .d.ts.
const dts = join(__dirname, '../../../app/public/agent-test-types.d.ts');

/** Exported interface/type/const declarations as comment-free, whitespace-free text, by name. */
function declarations(file: string): Record<string, string> {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const printer = ts.createPrinter({ removeComments: true });
  const out: Record<string, string> = {};
  const visit = (node: ts.Node) => {
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      out[node.name.text] = printer
        .printNode(ts.EmitHint.Unspecified, node, source)
        .replace(/\s+/g, '');
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe('@supercheck/agent-test editor types', () => {
  it('declares exactly the public types of the package', () => {
    const real = declarations(join(__dirname, 'types.ts'));
    expect(Object.keys(real).length).toBeGreaterThan(10);
    expect(declarations(dts)).toEqual(real);
  });

  it('declares the test and expect exports, and the package exports them', () => {
    const text = readFileSync(dts, 'utf8');
    expect(text).toContain("declare module '@supercheck/agent-test'");
    expect(text).toMatch(/export const test:[\s\S]*agent: Agent/);
    expect(text).toMatch(/export const expect:/);
    const index = readFileSync(join(__dirname, 'index.ts'), 'utf8');
    expect(index).toMatch(/export \* from '\.\/types'/);
    expect(index).toMatch(/export const test = /);
    expect(index).toMatch(/export \{ expect \}/);
  });
});
