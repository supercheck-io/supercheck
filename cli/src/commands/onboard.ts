import { Command } from 'commander'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getApiClient } from '../api/client.js'
import { getStoredBaseUrl, getToken } from '../auth/store.js'
import { outputDetail } from '../output/formatter.js'
import { ApiRequestError } from '../utils/errors.js'
import { discoverRepository } from '../utils/discover.js'
import { readPlan } from './plan.js'
import { readSmallFile } from '../utils/safe-read.js'
import { planLink } from '../utils/link-config.js'

const DEFAULT_API_URL = 'https://app.supercheck.io'

export type OnboardState = 'needs_init' | 'needs_tests' | 'needs_auth' | 'needs_link' | 'needs_plan' | 'ready_to_deploy' | 'deployed'

interface Next { action: string; command: string | null; why: string; requiresHuman?: boolean }

/**
 * Pure derivation of the current onboarding state from observed facts. Nothing is persisted: readiness is
 * recomputed every time, so it can never claim a stale "ready".
 */
export function deriveOnboarding(facts: {
  configExists: boolean
  testCount: number
  authenticated: boolean | 'unknown'
  planState: 'active' | 'inactive' | 'unknown' | null
  /** Does supercheck.config.ts target the project you are logged in to? */
  linkState?: 'ok' | 'needs_link' | 'conflict'
  deployedResources: number
  hasCi: boolean
}): { state: OnboardState; next: Next; alsoConsider: Next[] } {
  const localRun: Next = { action: 'run_local_tests', command: 'supercheck test run --offline --all --json', why: 'Prove the tests pass locally before publishing' }
  if (!facts.configExists) {
    return { state: 'needs_init', next: { action: 'init', command: 'supercheck init --skip-examples --json', why: 'Create supercheck.config.ts and the _supercheck_ folders without example.com tests' }, alsoConsider: [{ action: 'discover', command: 'supercheck discover --json', why: 'Learn the repository before writing a test' }] }
  }
  if (facts.testCount === 0) {
    return { state: 'needs_tests', next: { action: 'write_test', command: null, why: 'Write one focused test in _supercheck_/playwright/*.pw.ts or _supercheck_/k6/*.k6.ts; see `supercheck skills authoring`' }, alsoConsider: [{ action: 'discover', command: 'supercheck discover --json', why: 'Pick a flow from real routes and existing tests' }] }
  }
  if (facts.authenticated !== true) {
    return { state: 'needs_auth', next: { action: 'login', command: 'supercheck login --json', why: facts.authenticated === 'unknown' ? 'Could not verify the stored credential (network); log in again or retry' : 'Prints a URL and code and returns immediately; a person approves in the browser, then run it again', requiresHuman: true }, alsoConsider: [localRun] }
  }
  if (facts.linkState === 'needs_link') {
    return { state: 'needs_link', next: { action: 'link', command: 'supercheck link', why: 'supercheck.config.ts still has placeholder or default values; this points it at the project you are logged in to (edits only those lines)' }, alsoConsider: [localRun] }
  }
  if (facts.linkState === 'conflict') {
    return { state: 'needs_link', next: { action: 'review_link', command: 'supercheck link --dry-run', why: 'supercheck.config.ts targets a different project than you are logged in to; confirm with the user before running `supercheck link --force`', requiresHuman: true }, alsoConsider: [localRun] }
  }
  if (facts.planState === 'inactive') {
    return { state: 'needs_plan', next: { action: 'choose_plan', command: 'supercheck plan --json', why: 'Cloud deploy needs an active plan; a person must choose one in the dashboard billing page', requiresHuman: true }, alsoConsider: [localRun] }
  }
  if (facts.deployedResources === 0) {
    return { state: 'ready_to_deploy', next: { action: 'preview_deploy', command: 'supercheck deploy --dry-run --json', why: 'Preview changes; then apply only what the user authorized with `supercheck deploy --force --json --verify`' }, alsoConsider: [localRun] }
  }
  return {
    state: 'deployed',
    next: facts.hasCi ? { action: 'done', command: null, why: 'Deployed and CI is configured' } : { action: 'ci_init', command: 'supercheck ci init --github', why: 'Add a GitHub Actions workflow (a person must add the secrets it needs)' },
    alsoConsider: [],
  }
}

export function countStateResources(path: string): number {
  try {
    const text = readSmallFile(path)
    if (text === null) return 0
    const parsed = JSON.parse(text) as { targets?: Record<string, Record<string, unknown>> }
    return Object.values(parsed.targets ?? {}).reduce((sum, bucket) => sum + (bucket && typeof bucket === 'object' ? Object.keys(bucket).length : 0), 0)
  } catch { return 0 }
}

export const onboardCommand = new Command('onboard')
  .description('Read-only onboarding status: where you are and the single next step (safe to run repeatedly)')
  .action(async () => {
    const cwd = process.cwd()
    // Never loads supercheck.config.ts: onboarding inspects files, it does not execute repository code.
    const facts = discoverRepository(cwd)
    const configExists = Boolean(facts.existingTests.supercheck.config)
    const testCount = facts.existingTests.supercheck.playwright + facts.existingTests.supercheck.k6

    const token = getToken()
    let authenticated: boolean | 'unknown' = false
    let context: unknown = null
    // The token is only ever sent to the URL of the stored login (or an explicit real SUPERCHECK_URL),
    // never to a URL declared by repository files: this command loads neither .env nor config.
    const client = token ? getApiClient({ baseUrl: getStoredBaseUrl() ?? DEFAULT_API_URL, token, timeout: 8000 }) : null
    if (token && client) {
      try {
        const { data } = await client.get('/api/context')
        authenticated = true
        context = data
      } catch (error) {
        authenticated = error instanceof ApiRequestError && [401, 403].includes(error.statusCode ?? 0) ? false : 'unknown'
      }
    }

    let planState: 'active' | 'inactive' | 'unknown' | null = null
    if (authenticated === true) {
      try { planState = ((await readPlan(client!)).state as 'active' | 'inactive' | 'unknown') ?? 'unknown' } catch { planState = 'unknown' }
    }

    let linkState: 'ok' | 'needs_link' | 'conflict' = 'ok'
    const ctx = context as { organization?: { id?: string; slug?: string | null }; project?: { id?: string; slug?: string | null } } | null
    if (authenticated === true && configExists && ctx?.organization?.id && ctx.project?.id) {
      const configFile = facts.existingTests.supercheck.config
      const text = configFile ? readSmallFile(resolve(cwd, configFile)) : null
      if (text !== null) {
        const plan = planLink(text, { organization: { id: ctx.organization.id, slug: ctx.organization.slug }, project: { id: ctx.project.id, slug: ctx.project.slug }, apiUrl: (getStoredBaseUrl() ?? DEFAULT_API_URL).replace(/\/+$/, '') })
        linkState = plan.conflicts.length > 0 ? 'conflict' : plan.changes.length > 0 ? 'needs_link' : 'ok'
      }
    }
    const deployedResources = countStateResources(resolve(cwd, 'supercheck.state.json'))
    const hasCi = existsSync(resolve(cwd, '.github/workflows/supercheck.yml'))
    const derived = deriveOnboarding({ configExists, testCount, authenticated, planState, linkState, deployedResources, hasCi })

    outputDetail({
      schemaVersion: '1.0',
      state: derived.state,
      authenticated,
      next: derived.next,
      alsoConsider: derived.alsoConsider,
      checks: { config: configExists, tests: { playwright: facts.existingTests.supercheck.playwright, k6: facts.existingTests.supercheck.k6 }, plan: planState, deployedResources, ci: hasCi },
      ...(context && typeof context === 'object' ? { context: { project: (context as { project?: unknown }).project, organization: (context as { organization?: unknown }).organization } } : {}),
      note: 'Local state only reflects files and the server; it does not prove tests pass. Run the local tests before deploying.',
    }, { redact: false })
  })
