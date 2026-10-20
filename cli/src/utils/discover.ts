import { readdirSync } from 'node:fs'
import { readSmallFile } from './safe-read.js'
import { join, relative, resolve } from 'node:path'

/**
 * Bounded, read-only repository facts for agents. It never executes repository code, imports config,
 * runs package scripts, reads `.env` files (only key names in `.env.example`), or follows symlinks.
 */
export type Confidence = 'high' | 'medium' | 'low'

export interface DiscoverResult {
  schemaVersion: '1.0'
  repo: { root: string; packageManager: string | 'unknown'; monorepo: boolean; packages: string[] }
  app: {
    framework: string | 'unknown'
    devCommand: string | null
    baseUrl: string | null
    baseUrlConfidence: Confidence | null
    evidence: string[]
  }
  routes: { path: string; source: string; hint?: string }[]
  existingTests: {
    playwright: { configs: string[]; testFiles: number; storageState: string[] }
    k6: { files: number }
    supercheck: { config: string | null; playwright: number; k6: number }
  }
  api: { openapi: string[] }
  ci: string | 'unknown'
  envKeys: string[]
  warnings: string[]
}

const SKIP = new Set(['node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out', 'coverage', '.turbo', '.cache', '.vercel', 'vendor', '.svelte-kit', 'playwright-report', 'test-results'])
const MAX_ENTRIES = 8000
const MAX_DEPTH = 6
const MAX_JSON_BYTES = 512 * 1024
const FRAMEWORKS: [string, string, string | null][] = [
  ['next', 'nextjs', '3000'], ['nuxt', 'nuxt', '3000'], ['@remix-run/dev', 'remix', '3000'], ['astro', 'astro', '4321'],
  ['@sveltejs/kit', 'sveltekit', '5173'], ['vite', 'vite', '5173'], ['react-scripts', 'create-react-app', '3000'],
  ['@nestjs/core', 'nestjs', '3000'], ['fastify', 'fastify', null], ['express', 'express', null],
]
const CONFIG_NAMES = ['supercheck.config.ts', 'supercheck.config.mjs', 'supercheck.config.js']
const ROUTE_HINTS: [RegExp, string][] = [[/login|sign-?in|auth/i, 'auth'], [/sign-?up|register/i, 'signup'], [/checkout|cart|pay|billing/i, 'payments'], [/dashboard|account|settings/i, 'account']]

function readJson(path: string): Record<string, unknown> | null {
  try {
    const text = readSmallFile(path, MAX_JSON_BYTES)
    if (text === null) return null
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch { return null }
}

function walk(root: string): string[] {
  const files: string[] = []
  const visit = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || files.length >= MAX_ENTRIES) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (files.length >= MAX_ENTRIES) return
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) { if (!SKIP.has(entry.name)) visit(join(dir, entry.name), depth + 1) }
      else if (entry.isFile()) files.push(join(dir, entry.name))
    }
  }
  visit(root, 0)
  return files
}

function detectPackageManager(pkg: Record<string, unknown> | null, names: Set<string>): string {
  const declared = typeof pkg?.packageManager === 'string' ? pkg.packageManager.split('@')[0] : null
  if (declared && ['pnpm', 'yarn', 'npm', 'bun'].includes(declared)) return declared
  if (names.has('pnpm-lock.yaml')) return 'pnpm'
  if (names.has('yarn.lock')) return 'yarn'
  if (names.has('bun.lockb') || names.has('bun.lock')) return 'bun'
  if (names.has('package-lock.json')) return 'npm'
  return 'unknown'
}

export function discoverRepository(rootInput: string): DiscoverResult {
  const root = resolve(rootInput)
  const warnings: string[] = []
  const files = walk(root)
  if (files.length >= MAX_ENTRIES) warnings.push(`Scan stopped after ${MAX_ENTRIES} files; results may be incomplete.`)
  const rel = (f: string) => relative(root, f).split('\\').join('/')
  const relFiles = files.map(rel)
  const rootNames = new Set(relFiles.filter((f) => !f.includes('/')))

  const rootPkg = readJson(join(root, 'package.json'))
  const packageManager = detectPackageManager(rootPkg, rootNames)
  if (!rootPkg) warnings.push('No package.json at the repository root.')

  const workspaceGlobs = Array.isArray(rootPkg?.workspaces) ? (rootPkg.workspaces as unknown[]) : Array.isArray((rootPkg?.workspaces as { packages?: unknown[] } | undefined)?.packages) ? ((rootPkg!.workspaces as { packages: unknown[] }).packages) : []
  const packageJsons = relFiles.filter((f) => f.endsWith('/package.json') && f.split('/').length <= 4)
  const monorepo = workspaceGlobs.length > 0 || rootNames.has('pnpm-workspace.yaml') || rootNames.has('turbo.json') || rootNames.has('nx.json')
  const packages = monorepo ? packageJsons.map((f) => f.slice(0, -'/package.json'.length)).sort() : []

  // Framework: only trust an unambiguous single match; a monorepo with several apps is reported as unknown.
  const candidates: { pkgPath: string; framework: string; port: string | null; script: string | null }[] = []
  const pkgPaths = [...(rootPkg ? ['package.json'] : []), ...(monorepo ? packageJsons : [])]
  for (const pkgPath of pkgPaths) {
    const pkg = pkgPath === 'package.json' ? rootPkg : readJson(join(root, pkgPath))
    const deps = { ...((pkg?.dependencies as Record<string, unknown>) ?? {}), ...((pkg?.devDependencies as Record<string, unknown>) ?? {}) }
    const hit = FRAMEWORKS.find(([dep]) => dep in deps)
    if (hit) {
      const scripts = (pkg?.scripts as Record<string, unknown>) ?? {}
      candidates.push({ pkgPath, framework: hit[1], port: hit[2], script: typeof scripts.dev === 'string' ? 'dev' : typeof scripts.start === 'string' ? 'start' : null })
    }
  }
  const frontendCandidates = candidates.filter((c) => !['express', 'fastify', 'nestjs'].includes(c.framework))
  const pool = frontendCandidates.length ? frontendCandidates : candidates
  let app: DiscoverResult['app'] = { framework: 'unknown', devCommand: null, baseUrl: null, baseUrlConfidence: null, evidence: [] }
  if (pool.length === 1) {
    const [c] = pool
    const runner = packageManager === 'unknown' ? 'npm run' : packageManager === 'npm' ? 'npm run' : packageManager
    const dir = c.pkgPath === 'package.json' ? null : c.pkgPath.slice(0, -'/package.json'.length)
    // Directory names come from the repository: only emit a shell command for plainly safe paths.
    const safeDir = dir === null || /^[A-Za-z0-9._/@-]+$/.test(dir)
    if (!safeDir) warnings.push('devCommand omitted: the app directory name contains unusual characters.')
    app = {
      framework: c.framework,
      devCommand: c.script && safeDir ? `${dir ? `cd ${dir} && ` : ''}${runner} ${c.script}` : null,
      baseUrl: c.port ? `http://localhost:${c.port}` : null,
      baseUrlConfidence: c.port ? 'low' : null,
      evidence: [c.pkgPath],
    }
    if (c.port) warnings.push('baseUrl is the framework default port, not read from configuration; confirm it before use.')
  } else if (pool.length > 1) {
    warnings.push(`Multiple apps detected (${pool.map((c) => c.pkgPath).join(', ')}); choose the target app explicitly.`)
    app.evidence = pool.map((c) => c.pkgPath)
  }

  const routes: DiscoverResult['routes'] = []
  const routeFiles = relFiles.filter((f) => !/\/api\//.test(f) && (/(^|\/)(app|src\/app)\/(.*\/)?page\.(tsx|jsx|ts|js)$/.test(f) || /(^|\/)(pages|src\/pages)\/[^_].*\.(tsx|jsx|ts|js)$/.test(f)))
  for (const f of routeFiles.slice(0, 60)) {
    const path = '/' + f.replace(/^(.*\/)?(src\/)?(app|pages)\//, '').replace(/\/?page\.(tsx|jsx|ts|js)$/, '').replace(/\.(tsx|jsx|ts|js)$/, '').replace(/\/index$/, '').replace(/\([^)]*\)\//g, '')
    const hint = ROUTE_HINTS.find(([re]) => re.test(path))?.[1]
    routes.push({ path: path === '/' ? '/' : path.replace(/\/$/, ''), source: f, ...(hint ? { hint } : {}) })
  }

  const playwrightConfigs = relFiles.filter((f) => /(^|\/)playwright\.config\.(ts|js|mjs|cjs)$/.test(f))
  const pwTests = relFiles.filter((f) => /\.(spec|test)\.(ts|js|mjs)$/.test(f) && /(e2e|tests?|playwright)/i.test(f) && !f.startsWith('_supercheck_/'))
  const storageState = relFiles.filter((f) => /(^|\/)\.auth\/.+\.json$/.test(f) || /storage-?state.*\.json$/i.test(f))
  const k6Files = relFiles.filter((f) => /\.k6\.(ts|js)$/.test(f) && !f.startsWith('_supercheck_/'))
  const config = CONFIG_NAMES.find((n) => rootNames.has(n)) ?? null
  const scPw = relFiles.filter((f) => f.startsWith('_supercheck_/playwright/') && /\.pw\.ts$/.test(f)).length
  const scK6 = relFiles.filter((f) => f.startsWith('_supercheck_/k6/') && /\.k6\.ts$/.test(f)).length

  const openapi = relFiles.filter((f) => /(^|\/)(openapi|swagger)\.(json|ya?ml)$/i.test(f)).slice(0, 5)
  const ci = relFiles.some((f) => f.startsWith('.github/workflows/')) ? 'github-actions' : rootNames.has('.gitlab-ci.yml') ? 'gitlab-ci' : relFiles.some((f) => f.startsWith('.circleci/')) ? 'circleci' : 'unknown'

  // Key names only from the committed example file; real .env files are never opened.
  let envKeys: string[] = []
  try {
    const example = rootNames.has('.env.example') ? readSmallFile(join(root, '.env.example'), 128 * 1024) : null
    if (example !== null) {
      envKeys = example.split('\n').map((l) => /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(l)?.[1]).filter((k): k is string => Boolean(k)).slice(0, 100)
    }
  } catch { /* unreadable: omit */ }
  if (playwrightConfigs.length && !storageState.length && /auth|login/i.test(pwTests.join(' '))) warnings.push('Auth-related tests found but no storage state file detected.')

  return {
    schemaVersion: '1.0',
    repo: { root, packageManager, monorepo, packages },
    app,
    routes,
    existingTests: {
      playwright: { configs: playwrightConfigs, testFiles: pwTests.length, storageState },
      k6: { files: k6Files.length },
      supercheck: { config, playwright: scPw, k6: scK6 },
    },
    api: { openapi },
    ci,
    envKeys,
    warnings,
  }
}
