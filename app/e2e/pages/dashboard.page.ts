import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./base.page";
import { routes } from "../utils/env";

export class DashboardPage extends BasePage {
  // Metric cards
  readonly requirementsCard: Locator;
  readonly testsCard: Locator;
  readonly monitorsCard: Locator;

  // Sidebar navigation
  readonly sidebar: Locator;
  readonly navDashboard: Locator;
  readonly navTests: Locator;
  readonly navMonitors: Locator;
  readonly breadcrumbs: Locator;

  // Project Switcher
  readonly projectSwitcher: Locator;
  readonly projectSwitcherMenu: Locator;

  // Loading & Error states
  readonly skeletons: Locator;
  readonly errorBoundary: Locator;

  constructor(page: Page) {
    super(page);

    // Metric cards
    this.requirementsCard = page.locator('[data-testid="metrics-requirements"]').or(page.locator('text=Requirements').locator('..'));
    this.testsCard = page.locator('[data-testid="metrics-tests"]').or(page.locator('text=Tests').locator('..'));
    this.monitorsCard = page.locator('[data-testid="metrics-monitors"]').or(page.locator('text=Monitors').locator('..'));

    // Sidebar navigation
    this.sidebar = page.locator('[data-testid="sidebar"]').or(page.locator('aside'));
    this.navDashboard = this.sidebar.locator('a[href="/"]').or(this.sidebar.locator('text=Dashboard'));
    this.navTests = this.sidebar.locator('a[href="/tests"]').or(this.sidebar.locator('text=Tests'));
    this.navMonitors = this.sidebar.locator('a[href="/monitors"]').or(this.sidebar.locator('text=Monitors'));
    this.breadcrumbs = page.locator('nav[aria-label="breadcrumb"]').or(page.locator('[data-testid="breadcrumbs"]'));

    // Project Switcher
    this.projectSwitcher = page.locator('[data-testid="project-switcher"]').or(page.locator('button:has-text("Project")')).first();
    this.projectSwitcherMenu = page.locator('[role="menu"]').or(page.locator('[data-radix-popper-content-wrapper]'));

    // Loading & Error states
    this.skeletons = page.locator('[data-testid="skeleton"]').or(page.locator('.animate-pulse'));
    this.errorBoundary = page.locator('[data-testid="error-boundary"]').or(page.locator('text=Something went wrong'));
  }

  async navigate(): Promise<void> {
    await this.goto(routes.dashboard);
    await this.waitForPageLoad();
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(routes.dashboard);
    // Either skeletons are visible (loading) or metric cards (loaded)
    const hasSkeletons = await this.skeletons.first().isVisible().catch(() => false);
    const hasCards = await this.testsCard.isVisible().catch(() => false);
    expect(hasSkeletons || hasCards).toBe(true);
  }

  async expectCardsVisible(): Promise<void> {
    // We expect the text to be visible on the dashboard somewhere
    await expect(this.page.locator('text=Tests').first()).toBeVisible();
    await expect(this.page.locator('text=Monitors').first()).toBeVisible();
  }

  async switchProject(projectName: string): Promise<void> {
    await this.projectSwitcher.click();
    await this.projectSwitcherMenu.locator(`text=${projectName}`).click();
    await this.waitForPageLoad();
  }
}
