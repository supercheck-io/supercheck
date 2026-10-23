/**
 * Pure text transforms for aligning a generated supercheck.config.ts with the logged-in context.
 * The config is edited as text and never executed. Server-provided values are validated and written
 * with JSON.stringify so they can never become code, and only the two identity literals and the
 * generated default API URL are touched.
 */
const PLACEHOLDERS = new Set(['', 'my-org', 'my-project'])
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/
const MAX_BLOCK = 4096

export interface LinkTarget {
  organization: { id: string; slug?: string | null }
  project: { id: string; slug?: string | null }
  apiUrl: string
}

export interface LinkChange { field: 'organization' | 'project' | 'api.baseUrl'; from: string; to: string }

export interface LinkPlan {
  text: string
  changes: LinkChange[]
  /** Existing non-placeholder identity that points somewhere else: never retargeted without --force. */
  conflicts: LinkChange[]
  /** True when the identity literals were not found in an editable form. */
  unrecognized: boolean
  /** True when the server returned ids/slugs that are not plain identifiers; nothing is written. */
  invalidTarget: boolean
}

/** Blank out comments (keeping offsets and strings intact) so patterns never match commented-out code. */
export function maskComments(text: string): string {
  const out = text.split('')
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') out[i++] = ' '
      i--
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? text.length : end + 2
      for (; i < stop; i++) if (text[i] !== '\n') out[i] = ' '
      i--
    }
  }
  return out.join('')
}

interface Literal { start: number; end: number; value: string }

function findLiterals(text: string): {
  org: Literal | null
  project: Literal | null
  /** Only the generated `process.env.SUPERCHECK_URL ?? '...'` form (what `link` may rewrite). */
  baseUrl: Literal | null
  /** Any literal api.baseUrl, generated or hand-written. */
  declaredBaseUrl: Literal | null
  baseUrlFollowsEnv: boolean
} {
  const masked = maskComments(text)
  const open = /\bproject\s*:\s*\{/.exec(masked)
  let org: Literal | null = null
  let project: Literal | null = null
  if (open) {
    const bodyStart = open.index + open[0].length
    const close = masked.indexOf('}', bodyStart)
    if (close !== -1 && close - bodyStart <= MAX_BLOCK) {
      const body = masked.slice(bodyStart, close)
      const lit = (re: RegExp): Literal | null => {
        const m = re.exec(body)
        if (!m) return null
        const start = bodyStart + m.index + m[0].indexOf(m[1])
        return { start, end: start + m[1].length + m[2].length + 1, value: m[2] }
      }
      org = lit(/\borganization\s*:\s*(["'`])([^"'`\n\\]{0,256})\1/)
      project = lit(/\bproject\s*:\s*(["'`])([^"'`\n\\]{0,256})\1/)
    }
  }
  let baseUrl: Literal | null = null
  let baseUrlFollowsEnv = false
  const b = /\bbaseUrl\s*:\s*process\.env\.SUPERCHECK_URL\s*\?\?\s*(["'`])([^"'`\n\\]{0,2048})\1/.exec(masked)
  if (b) {
    const start = b.index + b[0].indexOf(b[1], b[0].indexOf('??'))
    baseUrl = { start, end: start + b[2].length + 2, value: b[2] }
    baseUrlFollowsEnv = true
  }
  // A hand-written config often just has `api: { baseUrl: 'https://...' }`; the loader reads that too.
  let declaredBaseUrl: Literal | null = baseUrl
  if (!declaredBaseUrl) {
    const api = /\bapi\s*:\s*\{/.exec(masked)
    if (api) {
      const bodyStart = api.index + api[0].length
      const close = masked.indexOf('}', bodyStart)
      if (close !== -1 && close - bodyStart <= MAX_BLOCK) {
        const m = /\bbaseUrl\s*:\s*(["'`])([^"'`\n\\]{0,2048})\1/.exec(masked.slice(bodyStart, close))
        if (m) {
          const start = bodyStart + m.index + m[0].indexOf(m[1])
          declaredBaseUrl = { start, end: start + m[2].length + 2, value: m[2] }
        }
      }
    }
  }
  return { org, project, baseUrl, declaredBaseUrl, baseUrlFollowsEnv }
}

/** The literal fallback in `baseUrl: process.env.SUPERCHECK_URL ?? '<url>'`, read as text like the identity. */
export function readConfigBaseUrl(text: string): string | null {
  return findLiterals(text).declaredBaseUrl?.value ?? null
}

/**
 * The API URL a config declares, and whether it follows SUPERCHECK_URL. A config of the generated form
 * (`process.env.SUPERCHECK_URL ?? '...'`) agrees with the environment by construction; a plain literal
 * does not, and the CLI refuses to sync when it differs from the API in use.
 */
export function readConfigBaseUrlInfo(text: string): { url: string; followsEnv: boolean } | null {
  const found = findLiterals(text)
  return found.declaredBaseUrl ? { url: found.declaredBaseUrl.value, followsEnv: found.baseUrlFollowsEnv } : null
}

/** Same names, in the loader's precedence order (local overrides main), as config/loader.ts. */
export const LOCAL_CONFIG_FILES = ['supercheck.config.local.ts', 'supercheck.config.local.js', 'supercheck.config.local.mjs'] as const

export function readConfigIdentity(text: string): { organization: string | null; project: string | null } {
  const { org, project } = findLiterals(text)
  return { organization: org?.value ?? null, project: project?.value ?? null }
}

const matches = (value: string, target: { id: string; slug?: string | null }): boolean => value === target.id || (!!target.slug && value === target.slug)
const validIdentity = (t: { id: string; slug?: string | null }): boolean => SAFE_ID.test(t.id) && (t.slug == null || SAFE_ID.test(t.slug))

export function planLink(text: string, target: LinkTarget, force = false): LinkPlan {
  const base = { text, changes: [] as LinkChange[], conflicts: [] as LinkChange[], unrecognized: false, invalidTarget: false }
  if (!validIdentity(target.organization) || !validIdentity(target.project)) return { ...base, invalidTarget: true }
  const found = findLiterals(text)
  if (!found.org || !found.project) return { ...base, unrecognized: true }

  const edits: { lit: Literal; value: string }[] = []
  const changes: LinkChange[] = []
  const conflicts: LinkChange[] = []
  const apply = (field: 'organization' | 'project', lit: Literal, wanted: { id: string; slug?: string | null }) => {
    if (matches(lit.value, wanted)) return
    const change = { field, from: lit.value, to: wanted.id }
    if (PLACEHOLDERS.has(lit.value) || force) { edits.push({ lit, value: wanted.id }); changes.push(change) } else conflicts.push(change)
  }
  apply('organization', found.org, target.organization)
  apply('project', found.project, target.project)

  // Only the generated default expression is rewritten, and only when it would point at a different server.
  if (found.baseUrl && conflicts.length === 0 && found.baseUrl.value.replace(/\/+$/, '') !== target.apiUrl.replace(/\/+$/, '')) {
    edits.push({ lit: found.baseUrl, value: target.apiUrl })
    changes.push({ field: 'api.baseUrl', from: found.baseUrl.value, to: target.apiUrl })
  }

  let next = text
  for (const { lit, value } of [...edits].sort((a, b) => b.lit.start - a.lit.start)) {
    next = next.slice(0, lit.start) + JSON.stringify(value) + next.slice(lit.end)
  }
  if (changes.length > 0) {
    // Never write a file we cannot read back as intended.
    const after = readConfigIdentity(next)
    const wantedOrg = changes.some((c) => c.field === 'organization') ? target.organization.id : found.org.value
    const wantedProject = changes.some((c) => c.field === 'project') ? target.project.id : found.project.value
    if (after.organization !== wantedOrg || after.project !== wantedProject) return { ...base, unrecognized: true }
  }
  return { text: next, changes, conflicts, unrecognized: false, invalidTarget: false }
}
