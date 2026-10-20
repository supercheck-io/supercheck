import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const waitForRun = jest.fn<(...a: unknown[]) => Promise<Record<string, unknown>>>()
jest.unstable_mockModule('../../utils/wait.js', () => ({ waitForRun }))
const { verifyDeployedTests } = await import('../deploy.js')

const post = jest.fn<(...a: unknown[]) => Promise<{ data: Record<string, unknown> }>>()
const client = { post } as never
const change = (name: string, testType: unknown, action = 'create') => ({ action, type: 'test', name, local: { definition: { testType } } })
const run = (changes: ReturnType<typeof change>[], ids = changes.map((_, i) => ({ id: `id-${i}` }))) => verifyDeployedTests(client, changes, ids, 1000)

beforeEach(() => {
  post.mockReset(); waitForRun.mockReset()
  post.mockResolvedValue({ data: { runId: 'run-1' } })
  waitForRun.mockResolvedValue({ status: 'passed' })
})

describe('verifyDeployedTests', () => {
  it('runs browser tests (playwright) and reports their status', async () => {
    const out = await run([change('a', 'playwright')])
    expect(post).toHaveBeenCalledWith('/api/tests/id-0/execute', {}, { retries: 0 })
    expect(out).toEqual([{ id: 'id-0', name: 'a', runId: 'run-1', status: 'passed' }])
  })

  it.each(['k6', 'K6', ' performance ', 'Performance', 'load', 'LOAD'])('never runs a performance test spelled %j', async (type) => {
    const out = await run([change('p', type)])
    expect(post).not.toHaveBeenCalled()
    expect(out[0]).toMatchObject({ status: 'skipped' })
    expect(String(out[0].reason)).toMatch(/Performance/)
  })

  it('names the type of a known non-browser test it skips', async () => {
    const out = await run([change('a', 'api')])
    expect(post).not.toHaveBeenCalled()
    expect(String(out[0].reason)).toMatch(/Only browser tests.*api/)
  })

  it.each([undefined, null, 'mystery', 42])('does not run a test whose type is %j', async (type) => {
    const out = await run([change('u', type)])
    expect(post).not.toHaveBeenCalled()
    expect(out[0]).toMatchObject({ status: 'skipped' })
  })

  it('caps verification at 5 runs and ignores non-test or no-change entries', async () => {
    const many = Array.from({ length: 7 }, (_, i) => change(`t${i}`, 'playwright'))
    const out = await run([...many, { action: 'create', type: 'job', name: 'j' } as never, change('same', 'playwright', 'no-change')])
    expect(post).toHaveBeenCalledTimes(5)
    expect(out.filter((o) => o.status === 'skipped')).toHaveLength(2)
    expect(out).toHaveLength(7)
  })

  it('keeps the accepted run id when waiting fails, and never retriggers', async () => {
    waitForRun.mockRejectedValue(new Error('timed out'))
    const out = await run([change('a', 'playwright')])
    expect(post).toHaveBeenCalledTimes(1)
    expect(out[0]).toMatchObject({ status: 'error', runId: 'run-1', reason: 'timed out' })
  })

  it('reports an error when execution returns no run id', async () => {
    post.mockResolvedValue({ data: {} })
    expect((await run([change('a', 'playwright')]))[0]).toMatchObject({ status: 'error' })
    expect(waitForRun).not.toHaveBeenCalled()
  })
})
