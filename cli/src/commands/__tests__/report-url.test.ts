import { describe, it, expect } from '@jest/globals'
import { publicReportUrl } from '../runs.js'

const client = { getBaseUrl: () => 'https://app.example.com/' }

describe('publicReportUrl', () => {
  it('replaces the internal storage URL with the application report route', () => {
    expect(publicReportUrl(client, { id: 'r1', reportUrl: 'http://rustfs:9000/b/r1/report/index.html' }).reportUrl)
      .toBe('https://app.example.com/api/test-results/r1/report/index.html')
  })
  it('uses runId from the run status route', () => {
    expect(publicReportUrl(client, { runId: 'r2', reportUrl: 'http://rustfs:9000/b/r2/report/index.html' }).reportUrl)
      .toBe('https://app.example.com/api/test-results/r2/report/index.html')
  })
  it('leaves runs without a report untouched', () => {
    const run = { id: 'r1', reportUrl: null }
    expect(publicReportUrl(client, run)).toEqual(run)
  })
  it('omits the meaningless testCount 0 of a run without a job', () => {
    expect(publicReportUrl(client, { id: 'r1', jobId: null, testCount: 0 })).toEqual({ id: 'r1', jobId: null })
    expect(publicReportUrl(client, { id: 'r1', jobId: 'j', testCount: 0 }).testCount).toBe(0)
    expect(publicReportUrl(client, { id: 'r1', jobId: null, testCount: 3 }).testCount).toBe(3)
  })
})
