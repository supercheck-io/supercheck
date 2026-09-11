import { defineConfig } from 'tsup'
import pkg from './package.json'

export default defineConfig([
  {
    entry: { 'bin/supercheck': 'src/bin/supercheck.ts' },
    format: ['esm'],
    target: 'node20',
    sourcemap: true,
    clean: true,
    shims: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
    define: {
      __CLI_VERSION__: JSON.stringify(pkg.version),
    },
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node20',
    dts: true,
    sourcemap: true,
    splitting: true,
    shims: true,
    define: {
      __CLI_VERSION__: JSON.stringify(pkg.version),
    },
  },
])
