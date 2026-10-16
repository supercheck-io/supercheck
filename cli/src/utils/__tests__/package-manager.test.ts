import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const execSync = jest.fn()
jest.unstable_mockModule('node:child_process', () => ({ execSync }))
jest.unstable_mockModule('../../version.js', () => ({ CLI_VERSION: '0.3.1' }))
const { ensurePackageJson, installDependencies } = await import('../package-manager.js')
let cwd: string
const readPackage = () => JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'))
beforeEach(() => {
  cwd = mkdtempSync(resolve(tmpdir(), 'supercheck-package-'))
  ensurePackageJson(cwd)
  execSync.mockReset()
})
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

describe('scaffold dependencies', () => {
  it('declares dependencies without running an install', async () => {
    await installDependencies(cwd, 'pnpm', { skipInstall: true })
    expect(readPackage()).toMatchObject({
      private: true,
      devDependencies: { '@supercheck/cli': '^0.3.1', typescript: '^5.7.3', '@types/node': '^22.13.0' },
    })
    expect(execSync).not.toHaveBeenCalled()
  })

  it('preserves existing dependency ranges, scripts, and unrelated package fields', async () => {
    const pkg = { name: 'existing', scripts: { test: 'custom' }, dependencies: { '@supercheck/cli': '^0.2.0' }, devDependencies: { typescript: '~5.7.0' } }
    writeFileSync(resolve(cwd, 'package.json'), JSON.stringify(pkg))
    await installDependencies(cwd, 'npm', { skipInstall: true })
    expect(readPackage()).toEqual({ ...pkg, devDependencies: { ...pkg.devDependencies, '@types/node': '^22.13.0' } })
  })

  it('leaves an installable manifest when dependency installation fails', async () => {
    execSync.mockImplementation(() => { throw new Error('install unavailable') })
    await expect(installDependencies(cwd, 'npm')).rejects.toThrow('Failed to install dependencies')
    expect(readPackage().devDependencies['@supercheck/cli']).toBe('^0.3.1')
    expect(execSync).toHaveBeenCalledTimes(1)
  })
})

describe('scaffold dependency edge cases', () => {
  it.each(['{', '', 'null', '[]'])('rejects unreadable package.json %j with a clear error', async (content) => {
    writeFileSync(resolve(cwd, 'package.json'), content)
    await expect(installDependencies(cwd, 'npm', { skipInstall: true })).rejects.toThrow('package.json')
  })

  it('does not rewrite package.json when nothing changes and keeps tab indentation', async () => {
    const original = '{\n\t"devDependencies": {\n\t\t"@supercheck/cli": "^0.3.1",\n\t\t"typescript": "^5.0.0",\n\t\t"@types/node": "^20.0.0"\n\t}\n}\n'
    writeFileSync(resolve(cwd, 'package.json'), original)
    await installDependencies(cwd, 'npm', { skipInstall: true })
    expect(readFileSync(resolve(cwd, 'package.json'), 'utf8')).toBe(original)
    writeFileSync(resolve(cwd, 'package.json'), '{\n\t"name": "x"\n}\n')
    await installDependencies(cwd, 'npm', { skipInstall: true })
    expect(readFileSync(resolve(cwd, 'package.json'), 'utf8')).toContain('\n\t"devDependencies"')
  })

  it('treats peer dependencies as already declared', async () => {
    writeFileSync(resolve(cwd, 'package.json'), JSON.stringify({ peerDependencies: { typescript: '^5' } }))
    await installDependencies(cwd, 'npm', { skipInstall: true })
    expect(readPackage().devDependencies).not.toHaveProperty('typescript')
  })
})
