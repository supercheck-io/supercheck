import { describe, expect, it, jest } from '@jest/globals'
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supercheckConfigSchema } from '../../config/schema.js'
import { buildLocalResources } from '../resources.js'
import { ApiClient } from '../../api/client.js'

const config = { schemaVersion: '1.0' as const, project: { organization: 'org', project: 'project' } }
describe('agent contract regressions', () => {
  it('rejects unknown typed fields while accepting provider-specific configuration', () => {
    expect(supercheckConfigSchema.safeParse({ ...config, notifcationProviders: [] }).success).toBe(false)
    expect(supercheckConfigSchema.safeParse({ ...config, monitors: [{ name: 'API', type: 'http_request', frequncyMinutes: 5 }] }).success).toBe(false)
    expect(supercheckConfigSchema.safeParse({ ...config, notificationProviders: [{ name: 'Slack', type: 'slack', config: { webhookUrl: 'https://example.com' } }] }).success).toBe(true)
  })
  it('keeps an inferred title stable after assigning a server UUID', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'supercheck-title-'))
    try {
      const dir = join(cwd, '_supercheck_/playwright'); mkdirSync(dir, { recursive: true })
      const path = join(dir, 'homepage.pw.ts'); writeFileSync(path, "import { test } from '@playwright/test'; test('home', async()=>{});")
      const input = { ...config, tests: { playwright: { browser: 'chromium' as const, testMatch: '_supercheck_/playwright/**/*.pw.ts' } } }
      expect(buildLocalResources(input, cwd)[0].definition.title).toBe('homepage')
      renameSync(path, join(dir, 'homepage.019a1234-1234-7123-8123-123456789abc.pw.ts'))
      expect(buildLocalResources(input, cwd)[0].definition.title).toBe('homepage')
    } finally { rmSync(cwd, { recursive: true, force: true }) }
  })
  it('classifies malformed successful responses as protocol errors', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>proxy</html>', { headers: { 'content-type': 'text/html' } }))
    try {
      await expect(new ApiClient({ baseUrl: 'https://example.com' }).request('GET', '/api/tests', { retries: 0 })).rejects.toThrow('Invalid JSON')
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally { fetch.mockRestore() }
  })
})
