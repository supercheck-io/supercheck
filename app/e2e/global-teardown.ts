import { FullConfig } from '@playwright/test';

/**
 * Global teardown - runs after all tests complete
 * We don't delete .auth-state.json so it can be reused in subsequent runs
 */
async function globalTeardown(config: FullConfig): Promise<void> {
  console.log('Global teardown complete');
}

export default globalTeardown;
