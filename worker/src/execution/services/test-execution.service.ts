import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { exec, ExecOptions } from 'child_process';
import { randomUUID } from 'crypto';

// Utility function to safely get error message
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Utility function to safely get error stack
function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}

const execAsync = promisify(exec);

// Interface for exec error with proper typing
interface ExecError extends Error {
  code?: number;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

// Helper function to execute a command and get the exitCode
async function execWithExitCode(
  command: string,
  options: ExecOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execAsync(command, options);
    return {
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      exitCode: 0,
    }; // Success
  } catch (error: unknown) {
    const execError = error as ExecError;
    if (
      execError?.code !== undefined &&
      execError?.stdout !== undefined &&
      execError?.stderr !== undefined
    ) {
      return {
        stdout:
          typeof execError.stdout === 'string'
            ? execError.stdout
            : String(execError.stdout),
        stderr:
          typeof execError.stderr === 'string'
            ? execError.stderr
            : String(execError.stderr),
        exitCode: execError.code,
      };
    }
    throw error; // Re-throw if it's not the expected error format
  }
}

// Define interfaces used in this service
interface ExecutionParams {
  testId?: string;
  name?: string;
  code: string;
  url?: string;
  testName?: string;
  testScript?: string;
}

interface ExecutionResult {
  success: boolean;
  exitCode?: number;
  duration?: number;
  stdout: string;
  stderr: string;
  reportDir?: string;
  testId?: string;
  screenshots?: string[];
}

@Injectable()
export class TestExecutionService {
  private readonly logger = new Logger(TestExecutionService.name);

  private async _createTestFile(
    testParams: ExecutionParams,
    tempDirPath: string,
  ): Promise<string> {
    // Create a self-executing script that uses playwright directly instead of @playwright/test
    const script = `
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Set up screenshot directory
    const reportDir = process.env.REPORT_DIR || './playwright-results';
    if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
    }
    
    // Test execution started
    
    try {
        // Execute the actual test
        ${testParams.testScript}
        
        // Take a final screenshot for reference
        await page.screenshot({ path: path.join(reportDir, 'final-state.png') });
        
        // Test completed successfully
        process.exit(0);
    } catch (error) {
        console.error('Test failed:', error.message);
        
        // Take a screenshot of failure state
        try {
            await page.screenshot({ path: path.join(reportDir, 'error-state.png') });
        } catch (screenshotError) {
            console.error('Failed to take error screenshot:', screenshotError.message);
        }
        
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
`.trim();

    // Write the test file
    const testFile = path.join(tempDirPath, 'test.js');
    await fs.writeFile(testFile, script, 'utf8');

    this.logger.log(`Created test file at ${testFile}`);

    return testFile;
  }

  /**
   * Escape content for inclusion in a JavaScript string
   */
  private _escapeScriptContent(content: string): string {
    if (!content) return '';
    return content
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  private async _executePlaywright(
    testFilePath: string,
    reportDir: string,
    testId: string,
    extraEnv: Record<string, string> = {},
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Set up environment variables for the test execution
      const env = {
        ...process.env,
        ...extraEnv,
        REPORT_DIR: reportDir,
        TEST_ID: testId,
      };

      this.logger.log(`Executing test from: ${testFilePath}`);
      this.logger.log(`Reports will be saved to: ${reportDir}`);

      // Execute the test file directly with Node instead of using Playwright Test
      const { stdout, stderr, exitCode } = await execWithExitCode(
        `node "${testFilePath}"`,
        {
          env,
          cwd: process.cwd(),
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        },
      );

      const duration = Date.now() - startTime;

      return {
        success: exitCode === 0,
        exitCode,
        duration,
        stdout,
        stderr,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Failed to execute test: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );

      return {
        success: false,
        exitCode: 1,
        duration,
        stdout: '',
        stderr: getErrorMessage(error),
      };
    }
  }

  private async _executeCommand(
    command: string,
    args: string[] = [],
    options: Record<string, any> = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const cmdString = `${command} ${args.join(' ')}`;
    try {
      const result = await execWithExitCode(cmdString, options);
      return result;
    } catch (error) {
      this.logger.error(`Command execution failed: ${getErrorMessage(error)}`);
      return { stdout: '', stderr: getErrorMessage(error), exitCode: 1 };
    }
  }

  private async _executeNode(
    testFilePath: string,
    reportDir: string,
  ): Promise<ExecutionResult> {
    this.logger.log(`Executing Node script: ${testFilePath}`);

    try {
      // Execute the test script with Node.js
      const { stdout, stderr, exitCode } = await this._executeCommand(
        'node',
        [testFilePath],
        { cwd: process.cwd() },
      );

      // Check if there's a success.json file which our test script creates on success
      const successFilePath = path.join(reportDir, 'success.json');
      let success = false;
      let result: Record<string, unknown> = {};

      try {
        if (await this._fileExists(successFilePath)) {
          const resultData = await fs.readFile(successFilePath, 'utf8');
          result = JSON.parse(resultData) as Record<string, unknown>;
          success = true;
        }
      } catch (error) {
        this.logger.error(
          `Error reading success file: ${getErrorMessage(error)}`,
        );
      }

      return {
        success: success,
        exitCode: exitCode,
        stdout: stdout,
        stderr: stderr,
        reportDir: reportDir,
        screenshots: (result.screenshots as string[]) || [],
      };
    } catch (error) {
      this.logger.error(
        `Error executing Node script: ${getErrorMessage(error)}`,
      );
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: getErrorMessage(error),
        reportDir: reportDir,
      };
    }
  }

  private async _fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  public async executeTest(params: ExecutionParams): Promise<ExecutionResult> {
    const startTime = Date.now();
    this.logger.log(`Executing test: ${params.name || 'Unnamed test'}`);

    // Create a temp directory for the test
    const tempDir = await this._createTempDir();
    try {
      // Generate the test file
      const testFilePath = path.join(tempDir, 'test.js');

      // Create a self-executing Node.js script
      const testCode = this._generateNodeTestScript(params);
      await fs.writeFile(testFilePath, testCode);
      this.logger.log(`Test file written to ${testFilePath}`);

      // Create report directory
      const testId = params.testId || 'unknown';
      const reportDir = path.join(process.cwd(), 'playwright-results', testId);
      await fs.mkdir(reportDir, { recursive: true });
      this.logger.log(`Report directory created at ${reportDir}`);

      // Execute the test with Node
      const result = await this._executeNode(testFilePath, reportDir);

      const duration = Date.now() - startTime;
      this.logger.log(
        `Test execution completed in ${duration}ms, success: ${result.success}`,
      );

      return {
        ...result,
        duration,
        testId,
      };
    } catch (error) {
      this.logger.error(`Error executing test: ${getErrorMessage(error)}`);
      return {
        success: false,
        exitCode: 1,
        stderr: getErrorMessage(error),
        stdout: '',
        reportDir: '',
        duration: Date.now() - startTime,
        testId: params.testId,
      };
    } finally {
      // Clean up temp directory
      await this._removeTempDir(tempDir);
    }
  }

  private async _createTempDir(): Promise<string> {
    const tempDir = path.join(os.tmpdir(), `${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });
    this.logger.log(`Created temporary directory: ${tempDir}`);
    return tempDir;
  }

  private async _removeTempDir(dir: string): Promise<void> {
    if (await this._fileExists(dir)) {
      await fs.rm(dir, { recursive: true, force: true });
      this.logger.log(`Removed temporary directory: ${dir}`);
    }
  }

  private _generateNodeTestScript(params: ExecutionParams): string {
    const { code, url } = params;

    return `
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

// Robust browser launch with retry logic
async function launchBrowserWithRetry(maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const browser = await chromium.launch({
        headless: true,
        args: [
          // CRITICAL: Container compatibility
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',

          // Font rendering fixes
          '--font-render-hinting=none',
          '--disable-font-subpixel-positioning',

          // Stability optimizations
          '--disable-features=TranslateUI,AudioServiceOutOfProcess',
          '--disable-background-networking',
          '--disable-extensions',
          '--disable-sync',
          '--no-first-run',
          '--disable-gpu-sandbox',
          '--disable-accelerated-2d-canvas',
        ],
        timeout: 30000, // 30 second timeout for browser launch
      });

      return browser;
    } catch (error) {
      console.error(\`Browser launch attempt \${attempt} failed: \${error.message}\`);

      if (attempt === maxRetries) {
        throw new Error(\`Failed to launch browser after \${maxRetries} attempts: \${error.message}\`);
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

(async () => {
  // Store test results
  const results = {
    success: false,
    message: '',
    screenshots: []
  };

  let browser = null;
  let page = null;

  try {
    // Launch browser with retry logic
    browser = await launchBrowserWithRetry(3);
    page = await browser.newPage();
    
    // Navigate to URL if provided
    ${url ? `await page.goto('${url}');` : ''}
    
    // Execute the test code
    const testFn = async (page) => {
      ${code}
    };
    
    await testFn(page);
    
    // If execution reaches here without errors, mark as success
    results.success = true;
    results.message = 'Test executed successfully';
  } catch (error) {
    results.success = false;
    results.message = error.toString();
    
    // Capture screenshot on failure if page is available
    if (page) {
      try {
        const screenshotPath = path.join(process.cwd(), 'error-screenshot.png');
        await page.screenshot({ path: screenshotPath });
        results.screenshots.push(screenshotPath);
      } catch (screenshotError) {
        console.error('Failed to take screenshot:', screenshotError);
      }
    }
  } finally {
    // Close browser
    if (browser) {
      await browser.close();
    }
    
    // Write results to file
    fs.writeFileSync(
      path.join(process.cwd(), 'success.json'),
      JSON.stringify(results, null, 2)
    );
    
    if (results.success) {
      // Test completed successfully
    } else {
      // Test failed
      process.exit(1);
    }
  }
})();
`;
  }
}
