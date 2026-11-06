import { describe, it, expect } from '@jest/globals'
import { detectPackageManager, spawnArgs } from '../upgrade.js'

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
  it('matches whole path segments, not substrings of a user or package name', () => {
    expect(detectPackageManager('', '/Users/bunny/.nvm/versions/node/v22/lib/node_modules/@supercheck/cli/dist/bin.js')).toBe('npm')
    expect(detectPackageManager('', '/home/bundy/yarnish/lib/node_modules/@supercheck/cli/bin.js')).toBe('npm')
  })
  it.each([
    ['npm/10.8.0 node/v22 linux x64', '/home/u/.local/share/pnpm/global/5/node_modules/@supercheck/cli/bin.js', 'npm'],
    ['yarn/1.22.22 npm/? node/v22', '/usr/lib/node_modules/@supercheck/cli/bin.js', 'yarn'],
    ['bun/1.1.0 npm/? node/v22', '/home/u/.config/yarn/global/node_modules/@supercheck/cli/bin.js', 'bun'],
  ])('trusts the user agent %s over a conflicting install path', (userAgent, path, expected) => {
    expect(detectPackageManager(userAgent, path)).toBe(expected)
  })

  it('recognises a .yarn segment as Yarn', () => {
    expect(detectPackageManager('', '/home/u/.yarn/bin/../global/node_modules/@supercheck/cli/bin.js')).toBe('yarn')
  })

  it('spawns one shell command string on win32 and an args array without a shell elsewhere', () => {
    expect(spawnArgs('pnpm', ['add', '-g', '@supercheck/cli@latest'], 'win32')).toEqual(['pnpm add -g @supercheck/cli@latest', [], { stdio: 'inherit', shell: true }])
    expect(spawnArgs('pnpm', ['add', '-g', '@supercheck/cli@latest'], 'linux')).toEqual(['pnpm', ['add', '-g', '@supercheck/cli@latest'], { stdio: 'inherit', shell: false }])
  })
})
