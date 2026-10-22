import { describe, it, expect } from '@jest/globals'
import { publicReportUrl } from '../runs.js'

const client = { getBaseUrl: () => 'https://app.example.com/' }

describe('publicReportUrl', () => {
  it('replaces the internal storage URL with the application report route', () => {
    expect(publicReportUrl(client, { id: 'r1', reportUrl: 'http://rustfs:9000/b/r1/report/index.html' }).reportUrl)
      .toBe('https://app.example.com/api/test-results/r1/report/index.html')
  })
  it('leaves runs without a report untouched', () => {
    const run = { id: 'r1', reportUrl: null }
    expect(publicReportUrl(client, run)).toEqual(run)
  })
})
