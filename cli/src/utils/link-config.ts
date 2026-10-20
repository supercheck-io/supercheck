/**
 * Pure text transforms for aligning a generated supercheck.config.ts with the logged-in context.
 * The config is edited as text (never executed), and only the two identity literals and the
 * generated default API URL are ever touched.
 */
const PLACEHOLDERS = new Set(['', 'my-org', 'my-project'])
const ORG_RE = /(project:\s*\{[^}]*?organization:\s*)(["'`])([^"'`\n]*)\2/
const PROJECT_RE = /(project:\s*\{[^}]*?\bproject:\s*)(["'`])([^"'`\n]*)\2/
const BASE_URL_RE = /(baseUrl:\s*process\.env\.SUPERCHECK_URL\s*\?\?\s*)(["'`])([^"'`\n]*)\2/

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
}

export function readConfigIdentity(text: string): { organization: string | null; project: string | null } {
  return { organization: ORG_RE.exec(text)?.[3] ?? null, project: PROJECT_RE.exec(text)?.[3] ?? null }
}

const matches = (value: string, target: { id: string; slug?: string | null }): boolean => value === target.id || (!!target.slug && value === target.slug)

export function planLink(text: string, target: LinkTarget, force = false): LinkPlan {
  const identity = readConfigIdentity(text)
  if (identity.organization === null || identity.project === null) return { text, changes: [], conflicts: [], unrecognized: true }
  let next = text
  const changes: LinkChange[] = []
  const conflicts: LinkChange[] = []
  const apply = (field: 'organization' | 'project', current: string, wanted: { id: string; slug?: string | null }, re: RegExp) => {
    if (matches(current, wanted)) return
    const change = { field, from: current, to: wanted.id }
    if (PLACEHOLDERS.has(current) || force) {
      next = next.replace(re, (_m, prefix: string, quote: string) => `${prefix}${quote}${wanted.id}${quote}`)
      changes.push(change)
    } else conflicts.push(change)
  }
  apply('organization', identity.organization, target.organization, ORG_RE)
  apply('project', identity.project, target.project, PROJECT_RE)

  // Only the generated default expression is rewritten, and only when it would point at a different server.
  const base = BASE_URL_RE.exec(next)
  if (base && base[3].replace(/\/+$/, '') !== target.apiUrl.replace(/\/+$/, '') && conflicts.length === 0) {
    next = next.replace(BASE_URL_RE, (_m, prefix: string, quote: string) => `${prefix}${quote}${target.apiUrl}${quote}`)
    changes.push({ field: 'api.baseUrl', from: base[3], to: target.apiUrl })
  }
  return { text: next, changes, conflicts, unrecognized: false }
}
