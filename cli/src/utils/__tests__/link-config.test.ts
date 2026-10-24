import { describe, it, expect } from '@jest/globals'
import { planLink, readConfigBaseUrlInfo, readConfigIdentity } from '../link-config.js'
import { isTokenSafeUrl, sanitizeApiUrl } from '../api-url.js'

const cfg = (org = 'my-org', project = 'my-project', url = 'https://app.supercheck.io') => `export default defineConfig({
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

describe('planLink injection resistance', () => {
  it.each([
    'o"); require("child_process").execSync("id"); ("',
    "o'); process.exit(1); ('",
    'o`${process.exit(1)}`',
    'a b',
    'x\nproject: "evil"',
    '',
    'a'.repeat(200),
  ])('refuses a server-supplied organization id of %j and writes nothing', (id) => {
    const plan = planLink(cfg(), { ...target, organization: { id } })
    expect(plan.invalidTarget).toBe(true)
    expect(plan.text).toBe(cfg())
    expect(plan.changes).toEqual([])
  })
  it('refuses unsafe project ids and slugs too', () => {
    expect(planLink(cfg(), { ...target, project: { id: 'p"; x; "' } }).invalidTarget).toBe(true)
    expect(planLink(cfg(), { ...target, project: { id: 'ok', slug: 'bad slug' } }).invalidTarget).toBe(true)
  })
  it('always writes values as JSON strings, regardless of the file\'s quote style', () => {
    const single = cfg().replace(/"my-org"/, "'my-org'").replace(/"my-project"/, '`my-project`')
    const plan = planLink(single, target)
    expect(plan.text).toContain('organization: "org-1"')
    expect(plan.text).toContain('project: "proj-1"')
    expect(readConfigIdentity(plan.text)).toEqual({ organization: 'org-1', project: 'proj-1' })
  })
  it('writes the API URL as an escaped JSON string', () => {
    const plan = planLink(cfg(), { ...target, apiUrl: 'https://evil/"+require("x")+"' })
    expect(plan.text).not.toContain('require("x")+"')
    expect(plan.text).toContain(JSON.stringify('https://evil/"+require("x")+"'))
  })
})

describe('planLink matching robustness', () => {
  it('ignores commented-out blocks and trailing comments', () => {
    const text = `// project: { organization: "acme", project: "x" }\n/* project: { organization: "zzz", project: "zzz" } */\n${cfg().replace('project: "my-project",', 'project: "my-project", // project: "zzz"')}`
    const plan = planLink(text, target)
    expect(plan.conflicts).toEqual([])
    expect(plan.changes.map((c) => c.field)).toEqual(['organization', 'project', 'api.baseUrl'])
    expect(plan.text).toContain('// project: { organization: "acme", project: "x" }')
    expect(plan.text).toContain('// project: "zzz"')
  })
  it('does not treat comment markers inside strings as comments', () => {
    const plan = planLink(cfg('my-org', 'my-project', 'http://localhost:3010'), target)
    expect(plan.changes.map((c) => c.field)).toEqual(['organization', 'project'])
    expect(plan.text).toContain('"http://localhost:3010"')
  })
  it('does not match keys that merely end in "project"', () => {
    const text = cfg().replace('project: {', 'subproject: { x: 1 },\n  project: {')
    expect(planLink(text, target).changes.map((c) => c.field)).toContain('project')
    expect(planLink('export default { subproject: { organization: "a", project: "b" } }', target).unrecognized).toBe(true)
  })
  it('stays fast on hostile input (no quadratic scan)', () => {
    const hostile = 'project: {\n'.repeat(40_000)
    const t0 = Date.now()
    planLink(hostile, target)
    readConfigIdentity(hostile)
    expect(Date.now() - t0).toBeLessThan(1500)
  })
  it('refuses to write what it cannot read back', () => {
    const odd = 'export default { project: { organization: "my-org", project: "my-project" /* } */ } }'
    const plan = planLink(odd, target)
    expect(plan.unrecognized || plan.text.includes('"org-1"')).toBe(true)
  })
})

describe('api url helpers', () => {
  it('allows only https or loopback http without credentials', () => {
    expect(isTokenSafeUrl('https://app.example.com')).toBe(true)
    expect(isTokenSafeUrl('http://localhost:3000')).toBe(true)
    expect(isTokenSafeUrl('http://app.example.com')).toBe(false)
    expect(isTokenSafeUrl('https://u:p@app.example.com')).toBe(false)
    expect(isTokenSafeUrl('nope')).toBe(false)
  })
  it('keeps origin and sub-path only', () => {
    expect(sanitizeApiUrl('https://h.example.com/supercheck/?a=1#x')).toBe('https://h.example.com/supercheck')
    expect(sanitizeApiUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeApiUrl('https://u:p@h.example.com')).toBeNull()
  })
})

describe('readConfigBaseUrlInfo', () => {
  it('reads the generated env-default form and says it follows SUPERCHECK_URL', () => {
    expect(readConfigBaseUrlInfo("export default { api: { baseUrl: process.env.SUPERCHECK_URL ?? 'https://a.example.com' } }")).toEqual({ url: 'https://a.example.com', followsEnv: true })
  })
  it('reads a hand-written literal inside the api block', () => {
    expect(readConfigBaseUrlInfo("export default { api: { timeout: 5, baseUrl: 'https://b.example.com' } }")).toEqual({ url: 'https://b.example.com', followsEnv: false })
  })
  it('ignores baseUrl outside api, commented-out values, and configs that declare none', () => {
    expect(readConfigBaseUrlInfo("export default { other: { baseUrl: 'https://x.test' } }")).toBeNull()
    expect(readConfigBaseUrlInfo("export default { api: { /* baseUrl: 'https://old.test' */ } }")).toBeNull()
    expect(readConfigBaseUrlInfo("export default { project: {} }")).toBeNull()
  })
})
