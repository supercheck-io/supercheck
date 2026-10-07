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

const { postSse, getSse } = await import('../sse.js')

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

    await postSse('/api/sre/chat', { message: 'health?' }, (event) => { events.push(event) })

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
    await expect(postSse('/api/sre/chat', {}, () => undefined)).rejects.toThrow('Stream request failed (403): denied')
  })

  it('rejects events over the safety limit', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`data: ${'x'.repeat(1024 * 1024 + 1)}`, { status: 200 }))
    await expect(postSse('/api/sre/chat', {}, () => undefined)).rejects.toThrow('1 MiB safety limit')
  })

  it.each([
    ['event: error\ndata: {"message":"Agent failed"}\n\n', 'Agent failed'],
    ['data: {"type":"error","error":"Brief failed"}\n\n', 'Brief failed'],
    ['event: agent.fallback\ndata: {"reason":"ai_unavailable"}\n\n', 'Copilot is temporarily unavailable'],
  ])('fails on streamed API errors after forwarding the event to JSON consumers', async (body, message) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }))
    const onEvent = jest.fn<() => void>()
    await expect(postSse('/api/sre/chat', {}, onEvent)).rejects.toMatchObject({ message: expect.stringContaining(message), exitCode: 4 })
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it('parses split multiline frames and resets event names at the frame boundary', async () => {
    const encoder = new TextEncoder()
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        for (const part of [': heartbeat\r\nevent: console\r\nda', 'ta: first\r\ndata: second\r\n\r\ndata: {"status":"passed"}\n\n']) controller.enqueue(encoder.encode(part))
        controller.close()
      },
    })))
    const events: unknown[] = []
    await getSse('/api/runs/run-1/stream', (event) => { events.push(event) })
    expect(events).toEqual([
      { event: 'console', data: 'first\nsecond' },
      { event: 'message', data: { status: 'passed' } },
    ])
  })

  it('cancels the GET reader and clears timers when a terminal event stops the stream', async () => {
    const cancel = jest.fn<() => void>()
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('event: complete\ndata: {"status":"passed"}\n\n')) },
      cancel,
    })))
    const interrupts = process.listenerCount('SIGINT')
    await getSse('/api/runs/run-1/stream', () => false)
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: 'GET' }))
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined()
    expect(cancel).toHaveBeenCalled()
    expect(process.listenerCount('SIGINT')).toBe(interrupts)
  })

  it('applies the safety limit per event rather than per network chunk', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`data: ${'x'.repeat(600_000)}\n\ndata: ${'y'.repeat(600_000)}\n\n`))
    const onEvent = jest.fn<() => void>()
    await getSse('/api/runs/run-1/stream', onEvent)
    expect(onEvent).toHaveBeenCalledTimes(2)
  })
  it('retries one failed GET connection, but never replays a POST', async () => {
    const failure = new TypeError('fetch failed', { cause: { code: 'ETIMEDOUT' } })
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(failure).mockResolvedValueOnce(new Response('data: {}\n\n'))
    await getSse('/api/runs/run-1/stream', () => undefined)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fetchMock.mockReset().mockRejectedValue(failure)
    await expect(postSse('/api/sre/chat', {}, () => undefined)).rejects.toThrow('ETIMEDOUT')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('distinguishes interruption from an idle timeout and removes handlers', async () => {
    const interrupts = process.listenerCount('SIGINT')
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      process.emit('SIGINT')
      options?.signal?.throwIfAborted()
      return new Response('')
    })
    await expect(getSse('/api/runs/run-1/stream', () => undefined)).rejects.toMatchObject({ message: 'Cancelled', exitCode: 130 })
    expect(process.listenerCount('SIGINT')).toBe(interrupts)
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    await expect(getSse('/api/runs/run-1/stream', () => undefined, 5)).rejects.toMatchObject({ exitCode: 5 })
  })

})
