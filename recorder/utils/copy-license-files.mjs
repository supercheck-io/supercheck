import { copyFileSync, mkdirSync } from 'node:fs';

const recorder = new URL('../', import.meta.url);
const output = new URL('examples/recorder-crx/dist/', recorder);
mkdirSync(new URL('playwright/', output), { recursive: true });

for (const file of ['LICENSE', 'NOTICE', 'playwright/LICENSE', 'playwright/NOTICE']) {
  copyFileSync(new URL(file, recorder), new URL(file, output));
}
