import { chromium, FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { env, validateEnv } from './utils/env';

const AUTH_STATE_PATH = path.join(__dirname, '.auth-state.json');

/**
 * Global setup - logs in ONCE and saves auth state for all tests
 */
async function globalSetup(config: FullConfig): Promise<void> {
  try {
    validateEnv();
  } catch (error) {
    console.error('Environment validation failed:', error);
    if (env.isCI) throw error;
  }

  console.log(`Setting up E2E tests for: ${env.baseUrl}`);

  // Check if we have test credentials
  if (!env.testUser.email || !env.testUser.password) {
    console.log('⚠️  No test user credentials - some tests will fail');
    return;
  }

  // Login and save auth state
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Logging in test user...');
    await page.goto(`${env.baseUrl}/sign-in`);
    await page.waitForLoadState('domcontentloaded');

    // Fill credentials
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
    
    await emailInput.fill(env.testUser.email);
    await passwordInput.fill(env.testUser.password);
    
    // Submit
    await page.locator('button[type="submit"]').click();
    
    // Wait for redirect away from sign-in
    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 15000 });
    await page.waitForLoadState('domcontentloaded');
    
    // Save auth state
    await context.storageState({ path: AUTH_STATE_PATH });
    console.log('✓ Auth state saved for all tests');
  } catch (error) {
    console.error('❌ Login failed:', (error as Error).message);
    // Continue anyway - auth tests can still run
  } finally {
    await browser.close();
  }
}

export default globalSetup;
export { AUTH_STATE_PATH };
