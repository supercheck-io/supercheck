import { expect, test } from '@playwright/test';

import { env } from '../../utils/env';

const hasExpectedBuildSha = /^[0-9a-f]{40}$/i.test(env.expectedBuildSha);

if (hasExpectedBuildSha) {
  test.describe('Deployment revision attestation @core @critical', () => {
    test('target health endpoint reports the exact expected commit SHA', async ({ request }) => {
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
}
