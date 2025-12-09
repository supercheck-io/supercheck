/**
 * Playground Page Object Model
 *
 * Page objects for the Playground and AI features including:
 * - Monaco code editor
 * - AI Fix suggestions
 * - AI Create test generation
 * - Test execution results
 */

import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Playground Page
 * Monaco editor for writing and running tests
 */
export class PlaygroundPage extends BasePage {
  /** Page title */
  readonly pageTitle: Locator;

  /** Monaco editor container */
  readonly monacoEditor: Locator;

  /** Monaco editor textarea (for typing) */
  readonly editorTextarea: Locator;

  /** Run test button */
  readonly runButton: Locator;

  /** Save to project button */
  readonly saveButton: Locator;

  /** AI Fix button */
  readonly aiFixButton: Locator;

  /** AI Create button */
  readonly aiCreateButton: Locator;

  /** Test results panel */
  readonly resultsPanel: Locator;

  /** Test output/console area */
  readonly outputArea: Locator;

  /** Test status indicator */
  readonly statusIndicator: Locator;

  /** Error message display */
  readonly errorMessage: Locator;

  /** Templates dropdown */
  readonly templatesButton: Locator;

  /** Theme toggle button */
  readonly themeToggle: Locator;

  /** Test type selector */
  readonly testTypeSelector: Locator;

  constructor(page: Page) {
    super(page, '/playground');

    this.pageTitle = page
      .locator('h1')
      .or(page.locator('[data-testid="playground-title"]'))
      .or(page.locator('text=/playground/i'));

    this.monacoEditor = page
      .locator('.monaco-editor')
      .or(page.locator('[data-testid="code-editor"]'))
      .or(page.locator('[role="code"]'));

    this.editorTextarea = page
      .locator('.monaco-editor textarea')
      .or(page.locator('[data-testid="code-editor"] textarea'))
      .or(page.locator('textarea'));

    this.runButton = page
      .locator('[data-testid="run-test-button"]')
      .or(page.locator('button:has-text("Run")'))
      .or(page.locator('button:has-text("Execute")'));

    this.saveButton = page
      .locator('[data-testid="save-test-button"]')
      .or(page.locator('button:has-text("Save")'));

    this.aiFixButton = page
      .locator('[data-testid="ai-fix-button"]')
      .or(page.locator('button:has-text("AI Fix")'))
      .or(page.locator('button:has-text("Fix")'));

    this.aiCreateButton = page
      .locator('[data-testid="ai-create-button"]')
      .or(page.locator('button:has-text("AI Create")'))
      .or(page.locator('button:has-text("Generate")'));

    this.resultsPanel = page
      .locator('[data-testid="results-panel"]')
      .or(page.locator('[role="tabpanel"]'))
      .or(page.locator('.results-panel'));

    this.outputArea = page
      .locator('[data-testid="test-output"]')
      .or(page.locator('pre'))
      .or(page.locator('.console-output'));

    this.statusIndicator = page
      .locator('[data-testid="test-status"]')
      .or(page.locator('[role="status"]'))
      .or(page.locator('.status-badge'));

    this.errorMessage = page
      .locator('[data-testid="error-message"]')
      .or(page.locator('[role="alert"]'))
      .or(page.locator('.error'));

    this.templatesButton = page
      .locator('[data-testid="templates-button"]')
      .or(page.locator('button:has-text("Templates")'));

    this.themeToggle = page
      .locator('[data-testid="theme-toggle"]')
      .or(page.locator('button[aria-label="Toggle theme"]'));

    this.testTypeSelector = page
      .locator('[data-testid="test-type-selector"]')
      .or(page.locator('select'))
      .or(page.locator('[role="combobox"]'));
  }

  /**
   * Navigate to the playground page
   */
  async navigate(): Promise<void> {
    await this.page.goto('/playground');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1500);
  }

  /**
   * Expect the page to be loaded
   */
  async expectLoaded(): Promise<void> {
    await this.page.waitForURL(/playground/);
  }

  /**
   * Type code into the Monaco editor
   */
  async typeCode(code: string): Promise<void> {
    // Monaco editor has special handling - click first
    await this.monacoEditor.click();
    await this.page.waitForTimeout(200);

    // Try typing into the editor
    await this.page.keyboard.type(code, { delay: 10 });
  }

  /**
   * Run the test
   */
  async runTest(): Promise<void> {
    await this.runButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if editor is visible
   */
  async isEditorVisible(): Promise<boolean> {
    return this.monacoEditor.isVisible().catch(() => false);
  }

  /**
   * Check if run button is visible
   */
  async isRunButtonVisible(): Promise<boolean> {
    return this.runButton.isVisible().catch(() => false);
  }

  /**
   * Check if AI Fix button is visible
   */
  async isAiFixVisible(): Promise<boolean> {
    return this.aiFixButton.isVisible().catch(() => false);
  }

  /**
   * Click AI Fix button
   */
  async clickAiFix(): Promise<void> {
    await this.aiFixButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if results panel is visible
   */
  async isResultsPanelVisible(): Promise<boolean> {
    return this.resultsPanel.isVisible().catch(() => false);
  }

  /**
   * Get the test status text
   */
  async getStatusText(): Promise<string> {
    const text = await this.statusIndicator.textContent().catch(() => '');
    return text || '';
  }
}

/**
 * AI Create Page
 * Generate tests from natural language descriptions
 */
export class AICreatePage extends BasePage {
  /** Page title */
  readonly pageTitle: Locator;

  /** Prompt input */
  readonly promptInput: Locator;

  /** Generate button */
  readonly generateButton: Locator;

  /** Generated code preview */
  readonly codePreview: Locator;

  /** Use/Apply generated code button */
  readonly useCodeButton: Locator;

  /** Regenerate button */
  readonly regenerateButton: Locator;

  /** Example prompts */
  readonly examplePrompts: Locator;

  /** Loading indicator */
  readonly loadingIndicator: Locator;

  constructor(page: Page) {
    super(page, '/playground/ai-create');

    this.pageTitle = page
      .locator('h1')
      .or(page.locator('[data-testid="ai-create-title"]'));

    this.promptInput = page
      .locator('[data-testid="prompt-input"]')
      .or(page.locator('textarea[placeholder*="Describe"]'))
      .or(page.locator('textarea').first());

    this.generateButton = page
      .locator('[data-testid="generate-button"]')
      .or(page.locator('button:has-text("Generate")'))
      .or(page.locator('button:has-text("Create")'));

    this.codePreview = page
      .locator('[data-testid="code-preview"]')
      .or(page.locator('.monaco-editor'))
      .or(page.locator('pre'));

    this.useCodeButton = page
      .locator('[data-testid="use-code-button"]')
      .or(page.locator('button:has-text("Use")'))
      .or(page.locator('button:has-text("Apply")'));

    this.regenerateButton = page
      .locator('[data-testid="regenerate-button"]')
      .or(page.locator('button:has-text("Regenerate")'));

    this.examplePrompts = page
      .locator('[data-testid="example-prompts"]')
      .or(page.locator('.example-prompts'));

    this.loadingIndicator = page
      .locator('[data-testid="loading"]')
      .or(page.locator('[role="progressbar"]'))
      .or(page.locator('.loading'));
  }

  /**
   * Navigate to AI Create page
   */
  async navigate(): Promise<void> {
    await this.page.goto('/playground/ai-create');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1500);
  }

  /**
   * Expect the page to be loaded
   */
  async expectLoaded(): Promise<void> {
    await this.page.waitForURL(/playground/);
  }

  /**
   * Enter a prompt for test generation
   */
  async enterPrompt(prompt: string): Promise<void> {
    await this.promptInput.fill(prompt);
  }

  /**
   * Click generate button
   */
  async generate(): Promise<void> {
    await this.generateButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if prompt input is visible
   */
  async isPromptInputVisible(): Promise<boolean> {
    return this.promptInput.isVisible().catch(() => false);
  }

  /**
   * Check if generate button is visible
   */
  async isGenerateButtonVisible(): Promise<boolean> {
    return this.generateButton.isVisible().catch(() => false);
  }
}
