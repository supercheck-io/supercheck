import { readFileSync } from 'fs';
import { join } from 'path';
import { WARNING_KINDS } from './warning-kinds';

// The app registry is the source of truth for the UI; the worker sends. Both must list the same kinds.
const appSource = readFileSync(
  join(__dirname, '../../../app/src/lib/alerts/warning-kinds.ts'),
  'utf8',
);

function appKinds(): Record<
  string,
  { monitorTypes: string[]; defaultOn: boolean }
> {
  const body =
    /WARNING_KINDS = \{([\s\S]*?)\n\} as const/.exec(appSource)?.[1] ?? '';
  const out: Record<string, { monitorTypes: string[]; defaultOn: boolean }> =
    {};
  for (const m of body.matchAll(
    /\n {2}(\w+): \{[\s\S]*?monitorTypes: \[([^\]]*)\][\s\S]*?defaultOn: (true|false)/g,
  )) {
    out[m[1]] = {
      monitorTypes: m[2]
        .split(',')
        .map((t) => t.trim().replace(/["']/g, ''))
        .filter(Boolean),
      defaultOn: m[3] === 'true',
    };
  }
  return out;
}

describe('warning kinds parity (app <-> worker)', () => {
  it('lists the same kinds with the same monitor types and defaults', () => {
    const worker = Object.fromEntries(
      Object.entries(WARNING_KINDS).map(([k, v]) => [
        k,
        { monitorTypes: [...v.monitorTypes], defaultOn: v.defaultOn },
      ]),
    );
    expect(Object.keys(appKinds()).length).toBeGreaterThan(0);
    expect(worker).toEqual(appKinds());
  });
});
