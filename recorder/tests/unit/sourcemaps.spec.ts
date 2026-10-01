import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rollup } from 'rollup';
import sourcemaps from '../../utils/sourcemaps.mjs';

test('preserves original Unicode sources in external and inline maps', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'recorder-sourcemaps-'));
  try {
    await mkdir(path.join(dir, 'maps'));
    const original = 'export const greeting: string = "你好";';
    await writeFile(path.join(dir, 'source + привет.ts'), original);
    const map = {
      version: 3, sources: ['source%20+%20привет.ts'], names: [], mappings: 'AAAA',
    };
    for (const format of ['external', 'base64', 'uri']) {
      const mapFile = path.join(dir, 'maps', 'bundle + map.js.map');
      const externalMap = { ...map, sourceRoot: '../' };
      await writeFile(mapFile, JSON.stringify(externalMap));
      const url = format === 'base64' ?
          `data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}` :
          format === 'uri' ? `data:application/json,${encodeURIComponent(JSON.stringify(map))}` :
            'maps/bundle%20+%20map.js.map';
      const input = path.join(dir, 'bundle.js');
      await writeFile(input, `export const greeting = "你好";\n//# sourceMappingURL=${url}\n`);
      const bundle = await rollup({ input, plugins: [sourcemaps()] });
      try {
        const { output } = await bundle.generate({ format: 'es', sourcemap: true });
        expect(output[0].map?.sourcesContent).toContain(original);
        expect(output[0].map?.sources.some(source => source.endsWith('source + привет.ts'))).toBe(true);
      } finally {
        await bundle.close();
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('malformed percent-encoded map paths do not block builds', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'recorder-sourcemaps-'));
  try {
    const input = path.join(dir, 'bundle.js');
    await writeFile(input, `export const value = 42;\n//# sourceMappingURL=${'%FF'.repeat(2000)}.map\n`);
    const warnings: string[] = [];
    const bundle = await rollup({ input, plugins: [sourcemaps()], onwarn: warning => warnings.push(warning.message) });
    try {
      const { output } = await bundle.generate({ format: 'es', sourcemap: true });
      expect(output[0].code).toContain('value = 42');
      expect(warnings.some(warning => warning.includes('Failed resolving source map'))).toBe(true);
    } finally {
      await bundle.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
