import { expect, test } from '@playwright/test';

import { env } from '../../utils/env';

test.describe('Deployment revision attestation @core @critical', () => {
  test('target health endpoint reports the exact expected commit SHA', async ({ request }) => {
    if (!/^[0-9a-f]{40}$/i.test(env.expectedBuildSha)) {
      throw new Error('E2E_EXPECTED_BUILD_SHA must be the full 40-character deployed commit SHA');
    }
    const response = await request.get('/api/health');
    expect(response.status(), await response.text()).toBe(200);
    const body = await response.json() as {
      status: string;
      build: { revision: string };
      checks: Record<string, { status: string }>;
    };
    expect(body.build.revision).toBe(env.expectedBuildSha);
    expect(body.status).toMatch(/^(ok|degraded)$/);
    expect(body.checks.database).toMatchObject({ status: 'ok' });
  });
});
