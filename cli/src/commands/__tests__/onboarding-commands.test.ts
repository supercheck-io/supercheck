import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverRepository } from '../../utils/discover.js'
import { deriveOnboarding, countStateResources } from '../onboard.js'
import { githubWorkflow } from '../ci.js'
import { installAgentSkill } from '../agent.js'
import { classifyError } from '../../utils/error-codes.js'
import { ApiRequestError } from '../../utils/errors.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sc-onboard-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const write = (path: string, content = '') => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), content) }

describe('discoverRepository', () => {
  it('detects a single Next.js app, package manager, routes, tests, CI and env key names only', () => {
    write('package.json', JSON.stringify({ dependencies: { next: '15' }, scripts: { dev: 'next dev' } }))
    write('pnpm-lock.yaml'); write('app/checkout/page.tsx'); write('app/page.tsx'); write('app/(auth)/login/page.tsx')
    write('playwright.config.ts'); write('e2e/checkout.spec.ts'); write('e2e/.auth/user.json', '{"cookies":[]}')
    write('.github/workflows/ci.yml'); write('openapi.json', '{}')
    write('.env.example', 'API_URL=http://x\nSECRET_KEY=abc\n'); write('.env', 'REAL_SECRET=super-secret-value')
    const facts = discoverRepository(dir)
    expect(facts.repo.packageManager).toBe('pnpm')
    expect(facts.app).toMatchObject({ framework: 'nextjs', devCommand: 'pnpm dev', baseUrl: 'http://localhost:3000', baseUrlConfidence: 'low' })
    expect(facts.routes.map((r) => r.path).sort()).toEqual(['/', '/checkout', '/login'])
    expect(facts.routes.find((r) => r.path === '/checkout')?.hint).toBe('payments')
    expect(facts.existingTests.playwright.configs).toEqual(['playwright.config.ts'])
    expect(facts.existingTests.playwright.testFiles).toBe(1)
    expect(facts.existingTests.playwright.storageState).toEqual(['e2e/.auth/user.json'])
    expect(facts.ci).toBe('github-actions')
    expect(facts.api.openapi).toEqual(['openapi.json'])
    expect(facts.envKeys).toEqual(['API_URL', 'SECRET_KEY'])
    expect(JSON.stringify(facts)).not.toContain('super-secret-value')
  })

  it('reports unknown for ambiguous monorepos instead of guessing', () => {
    write('package.json', JSON.stringify({ workspaces: ['apps/*'] }))
    write('apps/web/package.json', JSON.stringify({ dependencies: { next: '15' } }))
    write('apps/admin/package.json', JSON.stringify({ dependencies: { vite: '6' } }))
    const facts = discoverRepository(dir)
    expect(facts.repo.monorepo).toBe(true)
    expect(facts.app.framework).toBe('unknown')
    expect(facts.app.baseUrl).toBeNull()
    expect(facts.warnings.join(' ')).toMatch(/Multiple apps/)
  })

  it('does not follow symlinks out of the root or crash on an empty directory', () => {
    const outside = mkdtempSync(join(tmpdir(), 'sc-outside-'))
    try {
      writeFileSync(join(outside, 'openapi.json'), '{}')
      symlinkSync(outside, join(dir, 'linked'))
      symlinkSync(join(outside, 'openapi.json'), join(dir, 'package.json'))
      const facts = discoverRepository(dir)
      expect(facts.api.openapi).toEqual([])
      expect(facts.app.framework).toBe('unknown')
      expect(facts.warnings.join(' ')).toMatch(/No package.json/)
    } finally { rmSync(outside, { recursive: true, force: true }) }
  })

  it('counts supercheck tests separately from application tests', () => {
    write('supercheck.config.ts'); write('_supercheck_/playwright/a.pw.ts'); write('_supercheck_/k6/b.k6.ts')
    const facts = discoverRepository(dir)
    expect(facts.existingTests.supercheck).toEqual({ config: 'supercheck.config.ts', playwright: 1, k6: 1 })
    expect(facts.existingTests.playwright.testFiles).toBe(0)
  })
})

describe('deriveOnboarding', () => {
  const base = { configExists: true, testCount: 1, authenticated: true as boolean | 'unknown', planState: 'active' as const, deployedResources: 0, hasCi: false }
  it.each([
    [{ configExists: false }, 'needs_init'],
    [{ testCount: 0 }, 'needs_tests'],
    [{ authenticated: false }, 'needs_auth'],
    [{ authenticated: 'unknown' as const }, 'needs_auth'],
    [{ planState: 'inactive' as never }, 'needs_plan'],
    [{}, 'ready_to_deploy'],
    [{ deployedResources: 3 }, 'deployed'],
  ])('%j -> %s', (patch, state) => {
    expect(deriveOnboarding({ ...base, ...patch }).state).toBe(state)
  })
  it('does local work before asking for an account and treats unknown plan as non-blocking', () => {
    expect(deriveOnboarding({ ...base, testCount: 0, authenticated: false }).state).toBe('needs_tests')
    expect(deriveOnboarding({ ...base, planState: 'unknown' as never }).state).toBe('ready_to_deploy')
  })
  it('flags human steps and offers CI only after deploy', () => {
    expect(deriveOnboarding({ ...base, authenticated: false }).next.requiresHuman).toBe(true)
    expect(deriveOnboarding({ ...base, deployedResources: 1 }).next.command).toBe('supercheck ci init --github')
    expect(deriveOnboarding({ ...base, deployedResources: 1, hasCi: true }).next.action).toBe('done')
  })
  it('counts resources in the managed state file shape', () => {
    write('supercheck.state.json', JSON.stringify({ version: 1, targets: { 'https://a|p': { 'test:x': 'id1', 'job:y': 'id2' } } }))
    expect(countStateResources(join(dir, 'supercheck.state.json'))).toBe(2)
    expect(countStateResources(join(dir, 'missing.json'))).toBe(0)
  })
})

describe('ci workflow', () => {
  it('never uses pull_request_target and keeps secrets out of the PR job', () => {
    const yaml = githubWorkflow('npm', true)
    expect(yaml).not.toContain('pull_request_target')
    const [testJob, deployJob] = yaml.split('  deploy:')
    expect(testJob).not.toContain('secrets.')
    expect(deployJob).toContain('secrets.SUPERCHECK_TOKEN')
    expect(yaml).toContain('permissions:\n  contents: read')
    expect(yaml).toContain('playwright install')
    expect(yaml).toContain('deploy --force --json --verify')
  })
  it('adapts to pnpm and omits browsers when unused', () => {
    const yaml = githubWorkflow('pnpm', false)
    expect(yaml).toContain('pnpm/action-setup@v4')
    expect(yaml).toContain('pnpm install --frozen-lockfile')
    expect(yaml).not.toContain('playwright install')
  })
})

describe('agent skill install', () => {
  it('writes target-specific files and never overwrites without force', () => {
    const claude = installAgentSkill({ target: 'claude', cwd: dir })
    expect(String(claude.path)).toBe(join(dir, '.claude/skills/supercheck/SKILL.md'))
    expect(readFileSync(String(claude.path), 'utf8')).toContain('supercheck onboard --json')
    expect(() => installAgentSkill({ target: 'claude', cwd: dir })).toThrow(/already exists/)
    const cursor = installAgentSkill({ target: 'cursor', cwd: dir })
    expect(readFileSync(String(cursor.path), 'utf8')).toContain('alwaysApply: false')
  })
  it('only rewrites its own pointer block and preserves user content', () => {
    write('AGENTS.md', '# Mine\nKeep this.\n')
    installAgentSkill({ target: 'generic', cwd: dir, pointer: 'AGENTS.md' })
    installAgentSkill({ target: 'generic', cwd: dir, pointer: 'AGENTS.md', force: true })
    const text = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(text.startsWith('# Mine\nKeep this.\n')).toBe(true)
    expect(text.match(/supercheck:begin/g)).toHaveLength(1)
  })
  it('refuses destinations outside the project or through symlinks', () => {
    expect(() => installAgentSkill({ target: 'generic', cwd: dir, pointer: '../escape.md' })).toThrow(/outside/)
    const outside = mkdtempSync(join(tmpdir(), 'sc-out-'))
    try {
      symlinkSync(outside, join(dir, '.agents'))
      expect(() => installAgentSkill({ target: 'generic', cwd: dir })).toThrow(/symlink/)
      expect(existsSync(join(outside, 'skills'))).toBe(false)
    } finally { rmSync(outside, { recursive: true, force: true }) }
  })
})

describe('classifyError', () => {
  const api = (status: number, body?: unknown) => new ApiRequestError('x', status, body)
  it('maps statuses without inferring billing from permission failures', () => {
    expect(classifyError(api(401))?.code).toBe('TOKEN_INVALID')
    expect(classifyError(api(401), false)?.code).toBe('AUTH_REQUIRED')
    expect(classifyError(api(403, { error: 'Insufficient permissions' }))?.code).toBe('PERMISSION_DENIED')
    expect(classifyError(api(402, { code: 'subscription_required' }))?.code).toBe('SUBSCRIPTION_REQUIRED')
    expect(classifyError(api(402, { code: 'BILLING_BLOCKED' }))?.code).toBe('SPENDING_LIMIT_REACHED')
    expect(classifyError(api(402, {}))?.code).toBe('PAYMENT_REQUIRED')
    expect(classifyError(api(429))).toMatchObject({ code: 'RATE_LIMITED', retryable: true })
    expect(classifyError(api(503))).toMatchObject({ code: 'SERVICE_UNAVAILABLE', retryable: true })
    expect(classifyError(api(400))?.code).toBe('VALIDATION_FAILED')
    expect(classifyError(new Error('boom'))).toBeUndefined()
  })
})
