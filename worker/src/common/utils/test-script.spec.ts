import {
  decodeStoredTestScript,
  sanitizeTestScript,
} from './test-script';

describe('sanitizeTestScript', () => {
  it('strips sourceMappingURL comments and trailing binary bytes', () => {
    const source = [
      "import { test } from '@playwright/test';",
      "test('ok', async () => {});",
      '//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbXX0=',
      '\u0000\uFFFD\u0001binary-sourcemap',
    ].join('\n');

    expect(sanitizeTestScript(source)).toBe(
      "import { test } from '@playwright/test';\ntest('ok', async () => {});\n",
    );
  });
});

describe('decodeStoredTestScript', () => {
  it('does not Base64-decode raw TypeScript', () => {
    const source =
      "import { test } from '@playwright/test';\ntest('ok', async () => {});\n";
    expect(decodeStoredTestScript(source)).toBe(source);
  });

  it('decodes genuine Base64 source', () => {
    const source = "import { test } from '@playwright/test';\n";
    const encoded = Buffer.from(source, 'utf8').toString('base64');
    expect(decodeStoredTestScript(encoded)).toBe(source);
  });
});
