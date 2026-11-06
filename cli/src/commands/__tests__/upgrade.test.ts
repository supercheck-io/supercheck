import { describe, it, expect } from '@jest/globals'
import { detectPackageManager, executableFor } from '../upgrade.js'

describe('upgrade package manager detection', () => {
  it('prefers the user agent', () => {
    expect(detectPackageManager('pnpm/9.0.0 npm/? node/v22', '/usr/lib/node_modules/@supercheck/cli/dist/bin.js')).toBe('pnpm')
  })
  it.each([
    ['/home/u/.local/share/pnpm/global/5/node_modules/@supercheck/cli/dist/bin.js', 'pnpm'],
    ['/home/u/.bun/install/global/node_modules/@supercheck/cli/dist/bin.js', 'bun'],
    ['/home/u/.config/yarn/global/node_modules/@supercheck/cli/dist/bin.js', 'yarn'],
    ['C:\\Users\\u\\AppData\\Local\\pnpm\\global\\5\\node_modules\\@supercheck\\cli\\bin.js', 'pnpm'],
    ['/usr/lib/node_modules/@supercheck/cli/dist/bin.js', 'npm'],
  ])('infers the manager from the install path %s', (path, expected) => {
    expect(detectPackageManager('', path)).toBe(expected)
  })
  it('uses the .cmd shim on Windows only', () => {
    expect(executableFor('npm', 'win32')).toBe('npm.cmd')
    expect(executableFor('npm', 'linux')).toBe('npm')
  })
})
