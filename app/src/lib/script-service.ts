/**
 * Script Service
 *
 * This service handles loading sample scripts for different test types.
 * It provides a simple API for getting script content without using state management.
 */

import { codeTemplates } from "@/components/playground/template-data";

export enum ScriptType {
  Browser = "browser",
  API = "api",
  Database = "database",
  Custom = "custom",
  Performance = "performance",
}

// Map ScriptType to Template ID in template-data.ts
// Default templates should be simple, quick-start examples
const scriptTypeToTemplateId: Record<ScriptType, string> = {
  [ScriptType.Browser]: "pw-browser-smoke",
  [ScriptType.API]: "pw-api-health",
  [ScriptType.Database]: "pw-db-read",
  [ScriptType.Custom]: "pw-custom-e2e",
  [ScriptType.Performance]: "k6-smoke-check",
};

/**
 * Get the content of a sample script by type
 */
export function getSampleScript(type: ScriptType): string {
  const templateId = scriptTypeToTemplateId[type];
  const template = codeTemplates.find((t) => t.id === templateId);
  return template?.code || getDefaultScript();
}

/**
 * Get a default script if the requested script is not found
 */
function getDefaultScript() {
  return `import { test, expect } from '@playwright/test';

test('basic test', async ({ page }) => {
  // Navigate to a website
  await page.goto('https://playwright.dev/');

  // Verify the page title
  await expect(page).toHaveTitle(/Playwright/);
  
  // Click a link and verify navigation
  await page.getByRole('link', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
});
`;
}

/**
 * Get a list of all available sample scripts
 */
export function getAvailableScripts(): ScriptType[] {
  return Object.values(ScriptType);
}
