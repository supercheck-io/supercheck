import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const get = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const getClient = jest.fn<(...args: unknown[]) => { get: typeof get }>(() => ({ get }))
const setToken = jest.fn()
const setBaseUrl = jest.fn()
const output = jest.fn()
let storedUrl: string | null = null
jest.unstable_mockModule('../../auth/store.js', () => ({
  getToken: () => 'sck_live_fixture', getStoredBaseUrl: () => storedUrl,
  validateTokenFormat: () => true, setToken, setBaseUrl, clearAuth: jest.fn(),
}))
jest.unstable_mockModule('../../api/client.js', () => ({ getApiClient: getClient }))
jest.unstable_mockModule('../../api/authenticated-client.js', () => ({ getResolvedConfigBaseUrl: () => 'https://config.example.com' }))
jest.unstable_mockModule('../../utils/logger.js', () => ({ logger: { output, info: jest.fn(), success: jest.fn(), warn: jest.fn(), newline: jest.fn(), header: jest.fn() } }))
jest.unstable_mockModule('../../utils/spinner.js', () => ({ withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn() }))
jest.unstable_mockModule('../../utils/resources.js', () => ({ safeTokenPreview: () => 'sck_live_...' }))
jest.unstable_mockModule('../../output/formatter.js', () => ({ getOutputFormat: () => 'json' }))
const { loginCommand, logoutCommand, whoamiCommand } = await import('../login.js')
const { ApiRequestError } = await import('../../utils/errors.js')

describe('CLI authentication', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    getClient.mockReturnValue({ get })
    storedUrl = 'https://demo.supercheck.io'
    loginCommand.setOptionValue('url', undefined)
  })

  it('verifies and persists the same stored target when --url is omitted', async () => {
    get.mockResolvedValue({ data: { success: true } })
    await loginCommand.parseAsync(['node', 'login', '--token', 'sck_live_fixture'])
    expect(getClient).toHaveBeenCalledWith({ token: 'sck_live_fixture', baseUrl: storedUrl })
    expect(get).toHaveBeenCalledWith('/api/context')
    expect(setBaseUrl).toHaveBeenCalledWith(storedUrl)
    expect(setToken).toHaveBeenCalledWith('sck_live_fixture')
  })

  it('uses explicit --url ahead of the stored target', async () => {
    get.mockResolvedValue({ data: { success: true } })
    await loginCommand.parseAsync(['node', 'login', '--token', 'sck_live_fixture', '--url', 'https://explicit.example.com'])
    expect(getClient).toHaveBeenCalledWith({ token: 'sck_live_fixture', baseUrl: 'https://explicit.example.com' })
    expect(setBaseUrl).toHaveBeenCalledWith('https://explicit.example.com')
  })

  it('uses config URL when no stored target exists', async () => {
    storedUrl = null
    get.mockResolvedValue({ data: { success: true } })
    await loginCommand.parseAsync(['node', 'login', '--token', 'sck_live_fixture'])
    expect(setBaseUrl).toHaveBeenCalledWith('https://config.example.com')
  })

  it('preserves stored credentials when verification fails', async () => {
    get.mockRejectedValue(new ApiRequestError('Invalid token', 401))
    await expect(loginCommand.parseAsync(['node', 'login', '--token', 'sck_live_fixture'])).rejects.toThrow('Token verification failed')
    expect(setToken).not.toHaveBeenCalled()
    expect(setBaseUrl).not.toHaveBeenCalled()
  })

  it('whoami works for viewers without token-management permission', async () => {
    const context = { user: { id: 'u1', role: 'project_viewer' }, organization: { id: 'o1' }, project: { id: 'p1', name: 'Demo' } }
    get.mockResolvedValueOnce({ data: context }).mockRejectedValueOnce(new ApiRequestError('Forbidden', 403))
    await whoamiCommand.parseAsync(['node', 'whoami'])
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({ project: context.project, organization: context.organization, role: 'project_viewer', userId: 'u1', tokenName: null })
  })
  it('rejects invalid URLs before fetching or persisting credentials', async () => {
    await expect(loginCommand.parseAsync(['node', 'login', '--token', 'sck_live_fixture', '--url', 'not-a-url'])).rejects.toMatchObject({ exitCode: 3 })
    expect(get).not.toHaveBeenCalled()
    expect(setToken).not.toHaveBeenCalled()
  })

  it('preserves connection diagnostics instead of blaming the token', async () => {
    get.mockRejectedValue(new ApiRequestError('fetch failed (ETIMEDOUT)'))
    await expect(loginCommand.parseAsync(['node', 'login', '--token', 'sck_live_fixture'])).rejects.toMatchObject({ exitCode: 4, message: 'fetch failed (ETIMEDOUT)' })
    expect(setToken).not.toHaveBeenCalled()
  })

  it('emits structured login/logout results without copying the token', async () => {
    get.mockResolvedValue({ data: { success: true } })
    await loginCommand.parseAsync(['node', 'login', '--token', 'sck_live_fixture'])
    expect(JSON.parse(String(output.mock.calls[0][0]))).toEqual({ authenticated: true, apiUrl: storedUrl })
    await logoutCommand.parseAsync(['node', 'logout'])
    expect(JSON.parse(String(output.mock.calls[1][0]))).toEqual({ authenticated: false })
    expect(output.mock.calls.join(' ')).not.toContain('sck_live_fixture')
  })

})
