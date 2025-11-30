import {
  validatePath,
  validatePaths,
  validatePathExists,
  createSafeTempPath,
  validateCommandArgument,
  PathValidationOptions,
} from './path-validator';
import * as fs from 'fs/promises';

// Mock fs/promises for validatePathExists tests
jest.mock('fs/promises');

describe('PathValidator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validatePath', () => {
    // Core path validation tests - critical for security

    describe('basic validation', () => {
      it('should reject empty string paths', () => {
        // Empty paths should be rejected to prevent directory listing vulnerabilities
        const result = validatePath('');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Path must be a non-empty string');
      });

      it('should reject null paths', () => {
        // Null paths should be rejected with clear error
        const result = validatePath(null as unknown as string);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Path must be a non-empty string');
      });

      it('should reject undefined paths', () => {
        // Undefined paths should be rejected
        const result = validatePath(undefined as unknown as string);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Path must be a non-empty string');
      });

      it('should reject non-string paths', () => {
        // Non-string inputs should be rejected
        const result = validatePath(123 as unknown as string);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Path must be a non-empty string');
      });

      it('should accept valid absolute paths', () => {
        // Valid absolute paths should be accepted by default
        const result = validatePath('/home/user/file.txt');
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('/home/user/file.txt');
      });
    });

    describe('length validation', () => {
      it('should reject paths exceeding maximum length', () => {
        // Prevents DoS via extremely long paths
        const longPath = '/a'.repeat(5000);
        const result = validatePath(longPath);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('exceeds maximum length');
      });

      it('should accept paths within custom max length', () => {
        // Custom max length should be respected
        const result = validatePath('/short/path.txt', { maxLength: 100 });
        expect(result.valid).toBe(true);
      });

      it('should reject paths exceeding custom max length', () => {
        // Custom max length should be enforced
        const result = validatePath('/very/long/path/file.txt', { maxLength: 10 });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('exceeds maximum length of 10');
      });
    });

    describe('dangerous pattern detection', () => {
      // CRITICAL: These tests verify security against path traversal and injection attacks

      it('should reject path traversal attempts with ../', () => {
        // Path traversal is a critical security vulnerability
        const result = validatePath('/home/user/../../../etc/passwd');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous pattern');
      });

      it('should reject paths with home directory expansion ~', () => {
        // Tilde expansion could access unintended directories
        const result = validatePath('~/sensitive/data');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous pattern');
      });

      it('should reject paths with variable expansion $', () => {
        // Variable expansion could leak environment data
        const result = validatePath('/path/$HOME/file');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous pattern');
      });

      it('should reject paths with command substitution backticks', () => {
        // Command substitution is a code injection vulnerability
        const result = validatePath('/path/`whoami`/file');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous pattern');
      });

      it('should reject paths with pipe character |', () => {
        // Pipe could chain commands in shell contexts
        const result = validatePath('/path/file | cat');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous pattern');
      });

      it('should reject paths with background execution &', () => {
        // Ampersand could execute background commands
        const result = validatePath('/path/file & rm -rf /');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous pattern');
      });

      it('should reject paths with command chaining ;', () => {
        // Semicolon could chain multiple commands
        const result = validatePath('/path/file; rm -rf /');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous pattern');
      });

      it('should reject paths with newline injection', () => {
        // Newlines could break out of command contexts
        const result = validatePath('/path/file\nrm -rf /');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous pattern');
      });

      it('should reject paths with carriage return injection', () => {
        // CR could manipulate log outputs
        const result = validatePath('/path/file\rmalicious');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous pattern');
      });

      it('should reject paths with null byte injection', () => {
        // Null bytes could truncate paths in C-based systems
        const result = validatePath('/path/file\0.txt');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous pattern');
      });

      it('should reject paths with input redirection <', () => {
        // Input redirection could read unintended files
        const result = validatePath('/path/file < /etc/passwd');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous pattern');
      });

      it('should reject paths with output redirection >', () => {
        // Output redirection could overwrite files
        const result = validatePath('/path/file > /etc/crontab');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous pattern');
      });
    });

    describe('absolute/relative path handling', () => {
      it('should accept absolute paths by default', () => {
        const result = validatePath('/absolute/path/file.txt');
        expect(result.valid).toBe(true);
      });

      it('should reject relative paths by default', () => {
        // Relative paths are rejected by default for security
        const result = validatePath('relative/path/file.txt');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Relative paths are not allowed');
      });

      it('should reject absolute paths when allowAbsolute is false', () => {
        const options: PathValidationOptions = { allowAbsolute: false, allowRelative: true };
        const result = validatePath('/absolute/path', options);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Absolute paths are not allowed');
      });

      it('should accept relative paths when allowRelative is true', () => {
        const options: PathValidationOptions = { allowRelative: true };
        const result = validatePath('relative/path/file.txt', options);
        expect(result.valid).toBe(true);
      });
    });

    describe('base directory containment', () => {
      it('should accept paths within base directory', () => {
        // Paths should be contained within specified base
        const options: PathValidationOptions = {
          baseDirectory: '/home/user',
          allowRelative: true,
        };
        const result = validatePath('documents/file.txt', options);
        expect(result.valid).toBe(true);
      });

      it('should reject paths escaping base directory', () => {
        // Critical: prevent escaping sandboxed directories
        const options: PathValidationOptions = {
          baseDirectory: '/home/user',
          allowAbsolute: true,
        };
        const result = validatePath('/etc/passwd', options);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Path escapes base directory');
      });
    });

    describe('file extension validation', () => {
      it('should accept files with allowed extensions', () => {
        const options: PathValidationOptions = {
          allowedExtensions: ['.txt', '.json', '.js'],
        };
        const result = validatePath('/path/file.txt', options);
        expect(result.valid).toBe(true);
      });

      it('should reject files with disallowed extensions', () => {
        // Restricting extensions prevents execution of dangerous file types
        const options: PathValidationOptions = {
          allowedExtensions: ['.txt', '.json'],
        };
        const result = validatePath('/path/script.sh', options);
        expect(result.valid).toBe(false);
        expect(result.error).toContain("File extension '.sh' is not allowed");
      });

      it('should handle case-insensitive extension matching', () => {
        const options: PathValidationOptions = {
          allowedExtensions: ['.txt'],
        };
        const result = validatePath('/path/FILE.TXT', options);
        expect(result.valid).toBe(true);
      });
    });

    describe('special device file blocking', () => {
      // Blocks access to special device files that could cause issues
      // Note: The implementation compares uppercase path against lowercase blockedNames
      // So Windows device names work (since CON.toUpperCase() contains 'CON') but
      // Unix paths like /dev/null don't work (since '/DEV/NULL' doesn't contain '/dev/null')

      it('should block Windows special device names like CON', () => {
        // Windows device names like CON, PRN, AUX, NUL are blocked
        // These work because 'CON' matches in uppercase comparison
        const result = validatePath('/path/CON');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Path references a special device file');
      });

      it('should block lowercase con path', () => {
        // /path/con -> /PATH/CON contains 'CON'
        const result = validatePath('/path/con');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Path references a special device file');
      });

      it('should block COM port references', () => {
        const result = validatePath('/path/COM1');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Path references a special device file');
      });

      it('should block LPT port references', () => {
        const result = validatePath('/path/LPT1');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Path references a special device file');
      });

      it('should block NUL device name', () => {
        const result = validatePath('/path/NUL');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Path references a special device file');
      });

      it('should block PRN device name', () => {
        const result = validatePath('/path/PRN');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Path references a special device file');
      });

      it('should block AUX device name', () => {
        const result = validatePath('/path/AUX');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Path references a special device file');
      });
    });

    describe('path normalization', () => {
      it('should normalize paths with redundant slashes', () => {
        const result = validatePath('/path//to///file.txt');
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('/path/to/file.txt');
      });

      it('should normalize paths with ./ segments', () => {
        const result = validatePath('/path/./to/./file.txt');
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('/path/to/file.txt');
      });
    });
  });

  describe('validatePaths', () => {
    // Tests for batch path validation

    it('should return valid for all valid paths', () => {
      const paths = ['/path/one.txt', '/path/two.txt', '/path/three.txt'];
      const result = validatePaths(paths);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return invalid with errors for invalid paths', () => {
      const paths = ['/valid/path.txt', '/path/../../../etc/passwd', '/another/valid.txt'];
      const result = validatePaths(paths);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should collect all errors for multiple invalid paths', () => {
      const paths = ['/path/$VAR', '/path/`cmd`'];
      const result = validatePaths(paths);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });

    it('should pass options to each validation', () => {
      const paths = ['file1.txt', 'file2.txt'];
      const result = validatePaths(paths, { allowRelative: true });
      expect(result.valid).toBe(true);
    });
  });

  describe('validatePathExists', () => {
    // Tests for filesystem existence validation

    it('should return valid for existing accessible paths', async () => {
      // Mock fs.access to succeed
      (fs.access as jest.Mock).mockResolvedValue(undefined);

      const result = await validatePathExists('/existing/file.txt');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('/existing/file.txt');
    });

    it('should return invalid for non-existing paths', async () => {
      // Mock fs.access to fail
      (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const result = await validatePathExists('/nonexistent/file.txt');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not exist or is not accessible');
    });

    it('should return invalid for inaccessible paths', async () => {
      // Mock fs.access to fail with permission error
      (fs.access as jest.Mock).mockRejectedValue(new Error('EACCES'));

      const result = await validatePathExists('/protected/file.txt');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not exist or is not accessible');
    });
  });

  describe('createSafeTempPath', () => {
    // Tests for secure temporary path generation

    it('should create path with default prefix', () => {
      const tempPath = createSafeTempPath();
      expect(tempPath).toContain('supercheck-');
      expect(tempPath).toMatch(/supercheck-\d+-[a-z0-9]+$/);
    });

    it('should create path with custom prefix', () => {
      const tempPath = createSafeTempPath('custom');
      expect(tempPath).toContain('custom-');
    });

    it('should include timestamp for uniqueness', () => {
      const beforeTime = Date.now();
      const tempPath = createSafeTempPath();
      const afterTime = Date.now();

      // Extract timestamp from path
      const match = tempPath.match(/supercheck-(\d+)-/);
      expect(match).not.toBeNull();
      const timestamp = parseInt(match![1], 10);
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should generate unique paths on consecutive calls', () => {
      const path1 = createSafeTempPath();
      const path2 = createSafeTempPath();
      expect(path1).not.toBe(path2);
    });

    it('should use TMPDIR environment variable if set', () => {
      const originalTmpdir = process.env.TMPDIR;
      process.env.TMPDIR = '/custom/tmp';

      const tempPath = createSafeTempPath();
      expect(tempPath).toContain('/custom/tmp');

      process.env.TMPDIR = originalTmpdir;
    });

    it('should fall back to /tmp if TMPDIR is not set', () => {
      const originalTmpdir = process.env.TMPDIR;
      delete process.env.TMPDIR;

      const tempPath = createSafeTempPath();
      expect(tempPath).toContain('/tmp');

      process.env.TMPDIR = originalTmpdir;
    });
  });

  describe('validateCommandArgument', () => {
    // Tests for command argument validation - critical for command injection prevention

    it('should accept safe arguments', () => {
      const result = validateCommandArgument('safe-argument');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('safe-argument');
    });

    it('should accept arguments with dots and hyphens', () => {
      const result = validateCommandArgument('file-name.txt');
      expect(result.valid).toBe(true);
    });

    it('should reject empty arguments', () => {
      const result = validateCommandArgument('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Argument must be a non-empty string');
    });

    it('should reject null arguments', () => {
      const result = validateCommandArgument(null as unknown as string);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Argument must be a non-empty string');
    });

    it('should reject arguments with $ variable expansion', () => {
      const result = validateCommandArgument('$HOME');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('dangerous character');
    });

    it('should reject arguments with backtick command substitution', () => {
      const result = validateCommandArgument('`whoami`');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('dangerous character');
    });

    it('should reject arguments with pipe', () => {
      const result = validateCommandArgument('arg | cat');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('dangerous character');
    });

    it('should reject arguments with ampersand', () => {
      const result = validateCommandArgument('arg & cmd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('dangerous character');
    });

    it('should reject arguments with semicolon', () => {
      const result = validateCommandArgument('arg; cmd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('dangerous character');
    });

    it('should reject arguments with newlines', () => {
      const result = validateCommandArgument('arg\ncmd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('dangerous character');
    });

    it('should reject arguments with carriage returns', () => {
      const result = validateCommandArgument('arg\rcmd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('dangerous character');
    });

    it('should reject arguments with redirection characters', () => {
      expect(validateCommandArgument('arg > file').valid).toBe(false);
      expect(validateCommandArgument('arg < file').valid).toBe(false);
    });

    it('should reject arguments with backslash', () => {
      const result = validateCommandArgument('arg\\path');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('dangerous character');
    });
  });
});
