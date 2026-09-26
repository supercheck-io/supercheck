import { describe, it, expect } from '@jest/globals'
import { generateConfigContent } from '../pull.js'

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
    expect(result.monitors[0].config.env).toBe('from-env')
  })
})
