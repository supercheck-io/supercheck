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
    expect(request).toHaveBeenCalledTimes(1)
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
  it('preserves request failures that are not the overall wait deadline', async () => {
    const client = new ApiClient()
    for (const error of [new TimeoutError('Request timed out early'), new ApiRequestError('Forbidden', 403)]) {
      jest.spyOn(client, 'request').mockRejectedValue(error)
      await expect(waitForRun(client, 'run-id', 60000)).rejects.toBe(error)
    }
  })
})
