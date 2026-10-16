import { describe, it, expect } from '@jest/globals'
import { buildVariableDefinitions, generateConfigContent } from '../pull.js'

describe('pulled config source', () => {
  it('treats remote object keys and malformed env references as data', () => {
    const attackKey = 'safe: 1, injected: (globalThis.__pullInjected = true), filler'
    const config = JSON.parse(JSON.stringify({
      [attackKey]: 'value',
      nested: { [attackKey]: 'value' },
      malformed: '${BAD;globalThis.__pullInjected=true}',
      env: '${VALID_NAME}',
    }))
    const source = generateConfigContent({
      orgId: "org'break",
      projectId: 'project-id',
      baseUrl: "https://example.com/'break",
      monitors: [{ config }],
      jobs: [],
      variables: [],
      tags: [],
      notificationProviders: [],
      statusPages: [],
    })

    const executable = source
      .replace("import { defineConfig } from '@supercheck/cli'", 'const defineConfig = value => value')
      .replace('export default defineConfig(', 'const pulledConfig = defineConfig(')
    const result = new Function('process', `${executable}\nreturn pulledConfig`)({ env: { VALID_NAME: 'from-env' } })

    expect((globalThis as { __pullInjected?: boolean }).__pullInjected).toBeUndefined()
    expect(result.project.organization).toBe("org'break")
    expect(result.api.baseUrl).toBe("https://example.com/'break")
    expect(result.monitors[0].config[attackKey]).toBe('value')
    expect(result.monitors[0].config.nested[attackKey]).toBe('value')
    expect(result.monitors[0].config.malformed).toBe('${BAD;globalThis.__pullInjected=true}')
    // A server string shaped like an env reference is data, never a read of the local environment.
    expect(result.monitors[0].config.env).toBe('${VALID_NAME}')
  })
  it('never turns server strings into environment reads, in any field', () => {
    const source = generateConfigContent({
      orgId: 'o', projectId: 'p', baseUrl: 'https://example.com',
      monitors: [{ name: '${SUPERCHECK_TOKEN}', target: '${[AWS-KEY]}' }],
      jobs: [], variables: [], tags: [],
      notificationProviders: [{ name: '${HOME}', config: { url: '${SECRET}' } }],
      statusPages: [],
    })
    expect(source).not.toContain('process.env.SUPERCHECK_TOKEN')
    expect(source).not.toContain('AWS-KEY"]')
    expect(source).not.toMatch(/process\.env\.(HOME|SECRET)/)
    expect(source).toContain('"${SUPERCHECK_TOKEN}"')
  })
  it('still references the local environment for secret variables only', () => {
    const variables = buildVariableDefinitions([
      { id: 'a', key: 'api_key', value: 'server-value', isSecret: true },
      { id: 'b', key: 'my-secret', value: 'server-value', isSecret: true },
      { id: 'c', key: 'plain', value: '${SUPERCHECK_TOKEN}', isSecret: false },
    ] as never)
    const source = generateConfigContent({ orgId: 'o', projectId: 'p', baseUrl: 'https://example.com', monitors: [], jobs: [], variables, tags: [], notificationProviders: [], statusPages: [] })
    expect(source).toContain("process.env.API_KEY ?? ''")
    expect(source).toContain('process.env["MY-SECRET"] ?? \'\'')
    expect(source).not.toContain('server-value')
    expect(source).toContain('"${SUPERCHECK_TOKEN}"')
    expect(source).not.toContain('process.env.SUPERCHECK_TOKEN')
  })
})
