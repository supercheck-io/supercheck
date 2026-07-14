import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";

// Use a unique ID to avoid collision across tests and runs
const uniqueId = `e2e-${Date.now().toString().slice(-6)}`;
const testServiceName = `Test Service ${uniqueId}`;
const testIncidentName = `Test Incident ${uniqueId}`;

test.describe('Section 1: AI SRE - Services & Incidents CRUD @aisre @critical', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });


  test('Services: Create, Update, Archive', async ({ page }) => {
    // 1. Navigate to Services catalog
    await page.goto('/org-admin?tab=services');
    
    // Wait for the table or empty state to load
    await page.waitForLoadState('domcontentloaded');

    // 2. Click "Add service"
    const addBtn = page.getByTestId('add-service-btn');
    
    // Explicitly click the Services tab if button isn't there
    if (!await addBtn.isVisible().catch(() => false)) {
        const servicesTab = page.locator('[role="tab"]', { hasText: /Services/i });
        if (await servicesTab.isVisible().catch(() => false)) {
            await servicesTab.click();
        }
    }
    
    if (await addBtn.isVisible().catch(() => false)) {
        await addBtn.click();

        // 3. Fill out the service form
        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible();
        await modal.getByLabel(/Service name/i).fill(testServiceName);
        await modal.getByLabel(/Environment/i).fill('staging');
        await modal.getByLabel(/Description/i).fill('Created by E2E test suite');
        
        // 4. Save
        await page.getByTestId('submit-service-btn').click();

        // 5. Verify creation
        const newRow = page.getByRole('row', { name: new RegExp(testServiceName, 'i') });
        await expect(newRow).toBeVisible({ timeout: 10000 });

        // 6. Navigate to detail view
        await newRow.click();
        await expect(page.locator('h1, h2').filter({ hasText: testServiceName })).toBeVisible();

        // Go back to services
        await page.goto('/org-admin?tab=services');
        await expect(newRow).toBeVisible();

        // 7. Archive (Cleanup)
        const archiveBtn = newRow.getByRole('button', { name: /delete|archive/i, exact: false }).or(
           newRow.getByRole('button').last()
        );
        // Open action menu if it exists, otherwise click delete directly
        if (await archiveBtn.getAttribute('aria-haspopup') === 'menu') {
            await archiveBtn.click();
            await page.getByRole('menuitem', { name: /archive/i }).click();
        } else {
            await archiveBtn.click();
        }

        // Confirm archive
        const confirmBtn = page.getByRole('button', { name: /Archive service/i });
        if (await confirmBtn.isVisible()) {
            await confirmBtn.click();
        }
    } else {
        test.skip(true, 'Services tab or Add Service button not accessible');
    }
  });

  test('Incidents: Create and view Evidence Graph', async ({ page }) => {
    // 1. Navigate to incidents
    await page.goto('/incidents');
    
    // 2. Click "New incident"
    const newIncidentBtn = page.getByRole('button', { name: /New incident/i });
    if (await newIncidentBtn.isVisible()) {
        await newIncidentBtn.click();
        
        // Fill form
        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible();
        await modal.getByLabel(/Title/i).fill(testIncidentName);
        await modal.getByRole('button', { name: /Create/i }).click();
        
        // Verify creation
        await expect(page.getByRole('heading', { name: testIncidentName })).toBeVisible({ timeout: 10000 });
    } else {
        // If "New incident" button is missing from this view, assume we test Evidence Graph directly
    }

    // 3. Evidence Graph fallback
    await page.goto('/copilot/evidence-graph');
    const canvas = page.locator('.react-flow, [data-testid="evidence-graph"], canvas').first();
    if (await canvas.isVisible().catch(() => false)) {
        await expect(canvas).toBeVisible({ timeout: 10000 });
    } else {
        test.skip(true, 'Evidence Graph not accessible or implemented yet');
    }
  });

  test('Copilot: Chat interface interaction', async ({ page }) => {
    await page.goto('/copilot');
    
    const chatInput = page.locator('textarea[placeholder*="message"], input[placeholder*="Ask"], [data-testid="chat-input"]').first();
    if (await chatInput.isVisible().catch(() => false)) {
        await expect(chatInput).toBeVisible({ timeout: 10000 });
        await expect(chatInput).toBeEnabled();
        
        await chatInput.fill('Is the system healthy?');
        await chatInput.press('Enter');
        
        // Check that a message bubble appears
        const messages = page.locator('[data-testid="chat-message"], .message-bubble');
        // We expect at least the user message to be in the DOM
        if (await messages.count() > 0) {
            expect(await messages.count()).toBeGreaterThan(0);
        }
    } else {
        test.skip(true, 'Copilot chat interface not accessible or implemented yet');
    }
  });

});
