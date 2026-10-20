import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverRepository } from '../../utils/discover.js'
import { deriveOnboarding, countStateResources } from '../onboard.js'
import { githubWorkflow, isInsideProject } from '../ci.js'
import { installAgentSkill } from '../agent.js'
import { classifyError } from '../../utils/error-codes.js'
import { planLink, readConfigIdentity } from '../../utils/link-config.js'
import { failedVerifications } from '../deploy.js'
import { ApiRequestError, CLIError, ExitCode } from '../../utils/errors.js'

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
    expect(classifyError(new CLIError('Not authenticated. Run `supercheck login`.', ExitCode.AuthError), false)?.code).toBe('AUTH_REQUIRED')
    expect(classifyError(new CLIError('Not authenticated.', ExitCode.AuthError), true)).toBeUndefined()
    // a rejected or malformed pasted token is not "sign in"
    expect(classifyError(new CLIError('Token verification failed. Please check your token and try again.', ExitCode.AuthError), false)).toBeUndefined()
    expect(classifyError(new CLIError('Invalid token. `supercheck login` requires a CLI token', ExitCode.AuthError), false)).toBeUndefined()
  })
})

describe('planLink', () => {
  const template = (org: string, project: string, url = 'https://app.supercheck.io') => `export default defineConfig({
  project: {
    organization: ${JSON.stringify(org)},
    project: ${JSON.stringify(project)},
  },
  api: {
    baseUrl: process.env.SUPERCHECK_URL ?? ${JSON.stringify(url)},
  },
})
`
  const target = { organization: { id: 'org-1', slug: 'acme' }, project: { id: 'proj-1', slug: 'web' }, apiUrl: 'http://localhost:3010' }

  it('fills init placeholders and the default API URL, touching nothing else', () => {
    const plan = planLink(template('my-org', 'my-project'), target)
    expect(plan.changes.map((c) => c.field)).toEqual(['organization', 'project', 'api.baseUrl'])
    expect(readConfigIdentity(plan.text)).toEqual({ organization: 'org-1', project: 'proj-1' })
    expect(plan.text).toContain('process.env.SUPERCHECK_URL ?? "http://localhost:3010"')
    expect(plan.text.replace(/org-1|proj-1|http:\/\/localhost:3010/g, '').replace(/""/g, '').length).toBeGreaterThan(0)
  })
  it('is a no-op when already linked (by id or slug)', () => {
    expect(planLink(template('org-1', 'proj-1', 'http://localhost:3010'), target).changes).toEqual([])
    expect(planLink(template('acme', 'web', 'http://localhost:3010'), target).changes).toEqual([])
  })
  it('refuses to retarget a different real project unless forced', () => {
    const plan = planLink(template('other-org', 'other-proj'), target)
    expect(plan.conflicts.map((c) => c.field)).toEqual(['organization', 'project'])
    expect(plan.text).toBe(template('other-org', 'other-proj'))
    expect(planLink(template('other-org', 'other-proj'), target, true).changes).toHaveLength(3)
  })
  it('does not edit configs it cannot recognise, or rewrite a custom API URL expression', () => {
    expect(planLink('export default {}', target).unrecognized).toBe(true)
    const custom = template('my-org', 'my-project').replace('process.env.SUPERCHECK_URL ?? "https://app.supercheck.io"', '"https://custom.example.com"')
    expect(planLink(custom, target).changes.map((c) => c.field)).toEqual(['organization', 'project'])
  })
})

describe('onboarding link state', () => {
  const base = { configExists: true, testCount: 1, authenticated: true as boolean | 'unknown', planState: 'active' as const, deployedResources: 0, hasCi: false }
  it('asks to link before anything cloud-related, and flags conflicts for a human', () => {
    expect(deriveOnboarding({ ...base, linkState: 'needs_link' })).toMatchObject({ state: 'needs_link', next: { command: 'supercheck link' } })
    expect(deriveOnboarding({ ...base, linkState: 'conflict' }).next.requiresHuman).toBe(true)
    expect(deriveOnboarding({ ...base, linkState: 'ok' }).state).toBe('ready_to_deploy')
  })
})

describe('deploy --verify outcome', () => {
  it('does not fail a deploy because k6 or over-cap tests were intentionally skipped', () => {
    expect(failedVerifications([{ status: 'passed' }, { status: 'skipped' }])).toEqual([])
    expect(failedVerifications(undefined)).toEqual([])
  })
  it('fails on failed or errored runs', () => {
    expect(failedVerifications([{ status: 'passed' }, { status: 'failed' }, { status: 'error' }, { status: 'skipped' }])).toHaveLength(2)
  })
})

describe('install ordering and path rules', () => {
  it('writes nothing when the pointer file has bad markers', () => {
    write('AGENTS.md', '<!-- supercheck:begin -->\nstray only\n')
    expect(() => installAgentSkill({ target: 'generic', cwd: dir, pointer: 'AGENTS.md' })).toThrow(/unexpected supercheck markers/)
    expect(existsSync(join(dir, '.agents/skills/supercheck/SKILL.md'))).toBe(false)
    // and a retry after fixing the file works without --force
    write('AGENTS.md', '# fine\n')
    expect(() => installAgentSkill({ target: 'generic', cwd: dir, pointer: 'AGENTS.md' })).not.toThrow()
  })
  it('keeps accepting an explicit --path outside the project (legacy skills install behaviour)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'sc-explicit-'))
    try {
      const r = installAgentSkill({ target: 'generic', cwd: dir, path: outside })
      expect(String(r.path)).toBe(join(outside, 'SKILL.md'))
      expect(existsSync(join(outside, 'SKILL.md'))).toBe(true)
    } finally { rmSync(outside, { recursive: true, force: true }) }
  })
  it('accepts an in-project directory whose name merely starts with two dots', () => {
    expect(() => installAgentSkill({ target: 'generic', cwd: dir, pointer: '..notes/AGENTS.md' })).not.toThrow()
  })
  it('isInsideProject only accepts paths strictly inside the project', () => {
    expect(isInsideProject('/p', '/p/.github/workflows/x.yml')).toBe(true)
    expect(isInsideProject('/p', '/p/..foo/x.yml')).toBe(true)
    expect(isInsideProject('/p', '/p')).toBe(false)
    expect(isInsideProject('/p', '/p/../x.yml')).toBe(false)
    expect(isInsideProject('/p', '/other/x.yml')).toBe(false)
    expect(isInsideProject('/', '/x.yml')).toBe(true)
  })
})
