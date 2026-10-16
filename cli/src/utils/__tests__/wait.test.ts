import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { ApiClient } from '../../api/client.js'
import { waitForRun } from '../wait.js'
import { ApiRequestError, TimeoutError } from '../errors.js'

const response = (status: string) => ({ data: { status }, status: 200, headers: new Headers() })
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers() })
describe('bounded run waiting', () => {
  it('polls an accepted run until success without issuing mutations', async () => {
    jest.useFakeTimers()
    const client = new ApiClient()
    const request = jest.spyOn(client, 'request').mockResolvedValueOnce(response('running')).mockResolvedValueOnce(response('passed'))
    const result = waitForRun(client, 'run-id', 5000)
    await jest.advanceTimersByTimeAsync(3000)
    await expect(result).resolves.toEqual({ status: 'passed' })
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.every(([method, path]) => method === 'GET' && path === '/api/runs/run-id')).toBe(true)
    expect(request.mock.calls[1][2]?.timeout).toBeLessThanOrEqual(2000)
  })
  it.each(['failed', 'error', 'blocked', 'cancelled', 'canceled', 'aborted'])('reports terminal %s with its run identity', async (status) => {
    const client = new ApiClient()
    jest.spyOn(client, 'request').mockResolvedValue(response(status))
    await expect(waitForRun(client, 'run-id', 1000)).rejects.toMatchObject({ exitCode: 1, details: { runId: 'run-id', status } })
  })
  it('ends at the overall deadline instead of starting another run', async () => {
    jest.useFakeTimers()
    const client = new ApiClient()
    const request = jest.spyOn(client, 'request').mockResolvedValue(response('running'))
    const failure = expect(waitForRun(client, 'run-id', 5)).rejects.toMatchObject({ exitCode: 5, details: { runId: 'run-id' } })
    await jest.advanceTimersByTimeAsync(5)
    await failure
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('preserves the run ID and recovery instruction when a request times out at the deadline', async () => {
    jest.useFakeTimers()
    const client = new ApiClient()
    jest.spyOn(client, 'request').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      throw new TimeoutError('Request timed out')
    })
    const failure = expect(waitForRun(client, 'run-id', 5)).rejects.toMatchObject({ exitCode: 5, details: { runId: 'run-id' }, message: expect.stringContaining('run wait run-id') })
    await jest.advanceTimersByTimeAsync(5)
    await failure
  })
  it('keeps waiting through transient poll failures instead of abandoning a started run', async () => {
    jest.useFakeTimers()
    const client = new ApiClient()
    const request = jest.spyOn(client, 'request')
      .mockRejectedValueOnce(new TimeoutError('Request timed out early'))
      .mockRejectedValueOnce(new ApiRequestError('Bad gateway', 502))
      .mockRejectedValueOnce(new ApiRequestError('Rate limited', 429))
      .mockResolvedValueOnce(response('passed'))
    const result = waitForRun(client, 'run-id', 60000)
    await jest.advanceTimersByTimeAsync(9000)
    await expect(result).resolves.toEqual({ status: 'passed' })
    expect(request).toHaveBeenCalledTimes(4)
  })
  it('reports the run ID and last poll error when only transient failures occur until the deadline', async () => {
    jest.useFakeTimers()
    const client = new ApiClient()
    jest.spyOn(client, 'request').mockRejectedValue(new ApiRequestError('Bad gateway', 502))
    const failure = expect(waitForRun(client, 'run-id', 4000)).rejects.toMatchObject({ exitCode: 5, details: { runId: 'run-id' }, message: expect.stringContaining('Bad gateway') })
    await jest.advanceTimersByTimeAsync(4000)
    await failure
  })
  it('fails immediately on non-transient request errors', async () => {
    const client = new ApiClient()
    const error = new ApiRequestError('Forbidden', 403)
    const request = jest.spyOn(client, 'request').mockRejectedValue(error)
    await expect(waitForRun(client, 'run-id', 60000)).rejects.toBe(error)
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('gives the final poll at the deadline a usable request budget', async () => {
    jest.useFakeTimers()
    const client = new ApiClient()
    const request = jest.spyOn(client, 'request').mockResolvedValueOnce(response('running')).mockResolvedValueOnce(response('passed'))
    const result = waitForRun(client, 'run-id', 3000)
    await jest.advanceTimersByTimeAsync(3000)
    await expect(result).resolves.toEqual({ status: 'passed' })
    expect(request.mock.calls[1][2]?.timeout).toBeGreaterThanOrEqual(5000)
  })
})
