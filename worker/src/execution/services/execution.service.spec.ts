// Mock execa before any imports that use it
jest.mock('execa', () => ({
  execa: jest.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
  execSync: jest.fn(),
}));

// Mock fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(''),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn().mockResolvedValue({ isDirectory: () => false }),
  access: jest.fn().mockResolvedValue(undefined),
}));

// Mock fs sync
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
}));

import {
  getContentType,
  ensureProperTraceConfiguration,
  isWindows,
} from './execution.service';

describe('ExecutionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isWindows', () => {
    // Tests platform detection for conditional behavior
    it('should return a boolean indicating the platform', () => {
      expect(typeof isWindows).toBe('boolean');
    });
  });

  describe('getContentType', () => {
    // Tests MIME type mapping for report serving - critical for browser rendering

    it('should return text/html for .html files', () => {
      // HTML files must be served with correct MIME type for browser rendering
      expect(getContentType('/path/to/report.html')).toBe('text/html');
      expect(getContentType('index.HTML')).toBe('text/html');
    });

    it('should return text/css for .css files', () => {
      // CSS files need correct MIME type for styling to work
      expect(getContentType('/styles/main.css')).toBe('text/css');
    });

    it('should return application/javascript for .js files', () => {
      // JavaScript files must have correct MIME type for execution
      expect(getContentType('/scripts/app.js')).toBe('application/javascript');
    });

    it('should return application/json for .json files', () => {
      // JSON files need proper MIME type for API responses
      expect(getContentType('data.json')).toBe('application/json');
    });

    it('should return image/png for .png files', () => {
      // PNG screenshots from Playwright tests
      expect(getContentType('screenshot.png')).toBe('image/png');
    });

    it('should return image/jpeg for .jpg and .jpeg files', () => {
      // JPEG images should both map to same MIME type
      expect(getContentType('photo.jpg')).toBe('image/jpeg');
      expect(getContentType('photo.jpeg')).toBe('image/jpeg');
    });

    it('should return image/gif for .gif files', () => {
      expect(getContentType('animation.gif')).toBe('image/gif');
    });

    it('should return image/svg+xml for .svg files', () => {
      // SVG icons in reports
      expect(getContentType('icon.svg')).toBe('image/svg+xml');
    });

    it('should return text/plain for .txt files', () => {
      expect(getContentType('logs.txt')).toBe('text/plain');
    });

    it('should return application/octet-stream for unknown extensions', () => {
      // Unknown file types should get generic binary MIME type
      expect(getContentType('file.xyz')).toBe('application/octet-stream');
      expect(getContentType('file.bin')).toBe('application/octet-stream');
      expect(getContentType('noextension')).toBe('application/octet-stream');
    });

    it('should handle paths with multiple dots correctly', () => {
      // Edge case: files with multiple dots should use last extension
      expect(getContentType('report.test.html')).toBe('text/html');
      expect(getContentType('data.backup.json')).toBe('application/json');
    });

    it('should be case-insensitive for extensions', () => {
      // Extensions should work regardless of case
      expect(getContentType('FILE.HTML')).toBe('text/html');
      expect(getContentType('FILE.Json')).toBe('application/json');
      expect(getContentType('FILE.PNG')).toBe('image/png');
    });
  });

  describe('ensureProperTraceConfiguration', () => {
    // Tests trace configuration injection for parallel execution safety
    // Critical for preventing trace file conflicts in concurrent test runs

    it('should throw error for undefined script', () => {
      // Validates error handling for invalid inputs - prevents runtime crashes
      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      expect(() =>
        ensureProperTraceConfiguration(
          undefined as unknown as string,
          'test-123',
        ),
      ).toThrow('Test script is undefined or invalid for test test-123');
      consoleSpy.mockRestore();
    });

    it('should throw error for null script', () => {
      // Null scripts should be rejected with clear error message
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      expect(() =>
        ensureProperTraceConfiguration(null as unknown as string, 'test-456'),
      ).toThrow('Test script is undefined or invalid for test test-456');
      consoleSpy.mockRestore();
    });

    it('should throw error for non-string script', () => {
      // Non-string inputs should be rejected
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      expect(() =>
        ensureProperTraceConfiguration(123 as unknown as string, 'test-789'),
      ).toThrow('Test script is undefined or invalid for test test-789');
      consoleSpy.mockRestore();
    });

    it('should return script unchanged if no browser setup pattern found', () => {
      // Scripts without browser setup should pass through unchanged
      const script = 'console.log("hello");';
      const result = ensureProperTraceConfiguration(script, 'test-123');
      expect(result).toBe(script);
    });

    it('should add trace configuration after browser launch', () => {
      // Tests injection of trace config for Playwright scripts
      const script = `const browser = await chromium.launch();
const page = await browser.newPage();`;
      const result = ensureProperTraceConfiguration(script, 'test-abc');

      expect(result).toContain('context.tracing.start');
      expect(result).toContain('trace-test-abc');
    });

    it('should add directory to existing tracing config without dir', () => {
      // If tracing exists but lacks directory, add it for isolation
      const script = `await context.tracing.start({ screenshots: true, snapshots: true })`;
      const result = ensureProperTraceConfiguration(script, 'test-def');

      expect(result).toContain('dir:');
      expect(result).toContain('trace-test-def');
    });

    it('should not modify script with complete tracing config', () => {
      // Scripts with complete tracing config should not be modified
      const script = `await context.tracing.start({ screenshots: true, dir: './custom-trace' })`;
      const result = ensureProperTraceConfiguration(script, 'test-xyz');

      expect(result).toBe(script);
    });

    it('should generate unique trace directory when testId is not provided', () => {
      // When testId is missing, should still generate unique directory
      const script = `const browser = await chromium.launch();`;
      const result = ensureProperTraceConfiguration(script);

      // Should contain a trace directory reference
      expect(result).toContain('trace-');
    });

    it('should handle empty string script', () => {
      // Empty string should throw since it's falsy
      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      expect(() => ensureProperTraceConfiguration('', 'test-123')).toThrow(
        'Test script is undefined or invalid',
      );
      consoleSpy.mockRestore();
    });
  });
});
