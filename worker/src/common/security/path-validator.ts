/**
 * Path Validation and Sanitization Utilities
 *
 * Security-focused path validation following OWASP guidelines.
 * Prevents path traversal, command injection, and other path-based attacks.
 */

import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Validation result interface
 */
export interface PathValidationResult {
  valid: boolean;
  sanitized?: string;
  error?: string;
}

/**
 * Path validation options
 */
export interface PathValidationOptions {
  allowAbsolute?: boolean;
  allowRelative?: boolean;
  allowedExtensions?: string[];
  baseDirectory?: string;
  maxLength?: number;
}

/**
 * Dangerous path patterns that should be blocked
 */
const DANGEROUS_PATTERNS = [
  /\.\./g, // Path traversal
  /~/, // Home directory expansion
  /\$/, // Variable expansion
  /`/, // Command substitution
  /\|/, // Pipe
  /&/, // Background execution
  /;/, // Command chaining
  /\n/, // Newline injection
  /\r/, // Carriage return injection
  /\0/, // Null byte injection
  /</, // Input redirection
  />/, // Output redirection
];

/**
 * Validates and sanitizes a file path to prevent security vulnerabilities
 *
 * @param inputPath - The path to validate
 * @param options - Validation options
 * @returns PathValidationResult with validation status and sanitized path
 */
export function validatePath(
  inputPath: string,
  options: PathValidationOptions = {},
): PathValidationResult {
  // Default options
  const {
    allowAbsolute = true,
    allowRelative = false,
    allowedExtensions,
    baseDirectory,
    maxLength = 4096,
  } = options;

  // 1. Basic validation
  if (!inputPath || typeof inputPath !== 'string') {
    return {
      valid: false,
      error: 'Path must be a non-empty string',
    };
  }

  // 2. Length check
  if (inputPath.length > maxLength) {
    return {
      valid: false,
      error: `Path exceeds maximum length of ${maxLength} characters`,
    };
  }

  // 3. Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(inputPath)) {
      return {
        valid: false,
        error: `Path contains dangerous pattern: ${pattern.source}`,
      };
    }
  }

  // 4. Normalize the path
  const normalized = path.normalize(inputPath);

  // 5. Check if path is absolute
  const isAbsolute = path.isAbsolute(normalized);

  if (isAbsolute && !allowAbsolute) {
    return {
      valid: false,
      error: 'Absolute paths are not allowed',
    };
  }

  if (!isAbsolute && !allowRelative) {
    return {
      valid: false,
      error: 'Relative paths are not allowed',
    };
  }

  // 6. If base directory is specified, ensure path is within it
  if (baseDirectory) {
    const resolvedBase = path.resolve(baseDirectory);
    const resolvedPath = path.resolve(baseDirectory, normalized);

    if (!resolvedPath.startsWith(resolvedBase)) {
      return {
        valid: false,
        error: 'Path escapes base directory',
      };
    }
  }

  // 7. Check file extension if specified
  if (allowedExtensions && allowedExtensions.length > 0) {
    const ext = path.extname(normalized).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return {
        valid: false,
        error: `File extension '${ext}' is not allowed. Allowed: ${allowedExtensions.join(', ')}`,
      };
    }
  }

  // 8. Additional security checks
  // Block special device files on Unix systems
  const fileName = path.basename(normalized);
  const blockedNames = [
    '/dev/null',
    '/dev/zero',
    '/dev/random',
    '/dev/urandom',
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'LPT1',
    'LPT2',
    'LPT3',
  ];

  if (blockedNames.some((blocked) => normalized.toUpperCase().includes(blocked))) {
    return {
      valid: false,
      error: 'Path references a special device file',
    };
  }

  return {
    valid: true,
    sanitized: normalized,
  };
}

/**
 * Validates multiple paths at once
 */
export function validatePaths(
  paths: string[],
  options?: PathValidationOptions,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const inputPath of paths) {
    const result = validatePath(inputPath, options);
    if (!result.valid) {
      errors.push(`${inputPath}: ${result.error}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Checks if a path exists and is accessible
 */
export async function validatePathExists(
  inputPath: string,
): Promise<PathValidationResult> {
  try {
    await fs.access(inputPath, fs.constants.R_OK);
    return {
      valid: true,
      sanitized: inputPath,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Path does not exist or is not accessible: ${inputPath}`,
    };
  }
}

/**
 * Creates a safe temporary directory path
 */
export function createSafeTempPath(prefix = 'supercheck'): string {
  const tempDir = process.env.TMPDIR || '/tmp';
  const random = Math.random().toString(36).substring(2, 15);
  const timestamp = Date.now();
  return path.join(tempDir, `${prefix}-${timestamp}-${random}`);
}

/**
 * Validates a command argument to prevent injection
 */
export function validateCommandArgument(arg: string): PathValidationResult {
  if (!arg || typeof arg !== 'string') {
    return {
      valid: false,
      error: 'Argument must be a non-empty string',
    };
  }

  // Check for shell metacharacters
  const dangerousChars = ['$', '`', '|', '&', ';', '\n', '\r', '<', '>', '\\'];
  for (const char of dangerousChars) {
    if (arg.includes(char)) {
      return {
        valid: false,
        error: `Argument contains dangerous character: ${char}`,
      };
    }
  }

  return {
    valid: true,
    sanitized: arg,
  };
}
