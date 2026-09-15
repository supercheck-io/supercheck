import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from '@jest/globals'
import { arePlaywrightBrowsersInstalled, checkAllDependencies, ensureDependenciesForTestType } from '../deps.js'

const originalPlaywrightBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH

afterEach(() => {
  if (originalPlaywrightBrowsersPath === undefined) {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH
  } else {
    process.env.PLAYWRIGHT_BROWSERS_PATH = originalPlaywrightBrowsersPath
  }
})

function createTempProject(): string {
  return mkdtempSync(join(tmpdir(), 'supercheck-deps-'))
}

function addPlaywrightPackage(cwd: string): void {
  const pkgPath = resolve(cwd, 'node_modules', '@playwright', 'test')
  mkdirSync(pkgPath, { recursive: true })
  writeFileSync(resolve(pkgPath, 'package.json'), '{"name":"@playwright/test"}\n', 'utf-8')
}

describe('Playwright dependency detection', () => {
  it('detects installed browsers from PLAYWRIGHT_BROWSERS_PATH', () => {
    const cwd = createTempProject()
    const browserCache = resolve(cwd, 'custom-browser-cache')
    mkdirSync(resolve(browserCache, 'chromium-1234'), { recursive: true })

    process.env.PLAYWRIGHT_BROWSERS_PATH = browserCache

    expect(arePlaywrightBrowsersInstalled(cwd)).toBe(true)
  })

  it('reports missing browsers when the cache directory is empty', () => {
    const cwd = createTempProject()
    const browserCache = resolve(cwd, 'empty-browser-cache')
    mkdirSync(browserCache, { recursive: true })

    process.env.PLAYWRIGHT_BROWSERS_PATH = browserCache

    expect(arePlaywrightBrowsersInstalled(cwd)).toBe(false)
  })

  it('marks Playwright browsers as missing in doctor output when only the package exists', () => {
    const cwd = createTempProject()
    addPlaywrightPackage(cwd)

    process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(cwd, 'missing-cache')

    const deps = checkAllDependencies(cwd)
    const browserDep = deps.find((dep) => dep.name === 'Playwright browsers')

    expect(browserDep?.installed).toBe(false)
  })

  it('fails local Playwright execution preflight when browsers are missing', () => {
    const cwd = createTempProject()
    addPlaywrightPackage(cwd)

    process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(cwd, 'missing-cache')

    expect(() => ensureDependenciesForTestType(cwd, 'playwright')).toThrow(/Playwright browsers are not installed/)
  })

  it('supports conditional dependency requirements for k6-only or non-playwright projects', () => {
    const cwd = createTempProject()
    const deps = checkAllDependencies(cwd, { requirePlaywright: false, requireK6: true })

    const pwDep = deps.find((dep) => dep.name === '@playwright/test')
    const browserDep = deps.find((dep) => dep.name === 'Playwright browsers')
    const k6Dep = deps.find((dep) => dep.name === 'k6')

    expect(pwDep?.required).toBe(false)
    expect(browserDep?.required).toBe(false)
    expect(k6Dep?.required).toBe(true)
  })
})
