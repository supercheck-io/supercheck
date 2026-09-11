import { beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.unstable_mockModule('../../auth/store.js', () => ({
  requireAuth: () => 'sck_live_test',
  getStoredBaseUrl: () => 'https://app.supercheck.io',
}))
jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  getResolvedConfigBaseUrl: () => null,
}))
jest.unstable_mockModule('../proxy.js', () => ({
  getProxyAgent: jest.fn(),
  getProxyEnv: () => null,
}))

const { postSse } = await import('../sse.js')

describe('postSse', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('sends bearer-authenticated POSTs and parses named JSON events', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      'event: message\ndata: {"role":"assistant","content":"ok"}\n\nevent: done\ndata: {"ok":true}\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ))
    const events: Array<{ event: string; data: unknown }> = []

    await postSse('/api/sre/chat', { message: 'health?' }, (event) => events.push(event))

    expect(events).toEqual([
      { event: 'message', data: { role: 'assistant', content: 'ok' } },
      { event: 'done', data: { ok: true } },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://app.supercheck.io/api/sre/chat'),
      expect.objectContaining({ method: 'POST', body: '{"message":"health?"}' }),
    )
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sck_live_test')
  })

  it('rejects unsuccessful responses without exposing unbounded bodies', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('denied', { status: 403 }))
    await expect(postSse('/api/sre/chat', {}, () => undefined)).rejects.toThrow('SRE stream request failed (403): denied')
  })

  it('rejects events over the safety limit', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`data: ${'x'.repeat(1024 * 1024 + 1)}`, { status: 200 }))
    await expect(postSse('/api/sre/chat', {}, () => undefined)).rejects.toThrow('1 MiB safety limit')
  })
})
