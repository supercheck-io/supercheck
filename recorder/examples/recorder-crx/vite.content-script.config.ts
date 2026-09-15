/**
 * Copyright (c) Supercheck Contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import path from 'path';
import { defineConfig } from 'vite';

// Manifest content scripts are classic scripts, so they must be emitted as a
// self-contained bundle rather than an ES module with shared imports.
export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, 'src/content-script.ts'),
      name: 'SupercheckRecorderContentScript',
      formats: ['iife'],
      fileName: () => 'content-script.js',
    },
  },
});
