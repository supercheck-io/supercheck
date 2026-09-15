jest.mock('execa', () => ({
  execa: jest.fn(),
}));

import { getFailedHttpRequestCount } from './k6-execution.processor';

describe('k6 HTTP failure metrics', () => {
  it('uses http_req_failed passes instead of check failures', () => {
    expect(
      getFailedHttpRequestCount({
        http_reqs: { count: 20 },
        http_req_failed: { passes: 3, fails: 17, rate: 0.15 },
        checks: { fails: 9 },
      }),
    ).toBe(3);
  });

  it('falls back to the failure rate when counts are absent', () => {
    expect(
      getFailedHttpRequestCount({
        http_reqs: { count: 20 },
        http_req_failed: { rate: 0.1 },
      }),
    ).toBe(2);
  });
});
