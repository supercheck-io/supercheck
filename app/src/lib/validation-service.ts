import * as acorn from "acorn";
import * as walk from "acorn-walk";

// Strictly allowed modules with expanded safe libraries
const ALLOWED_MODULES = new Set([
  // Testing & Automation
  "@playwright/test", // UI & E2E testing framework

  // Database Clients
  "mssql", // MSSQL database client
  "mysql2", // Improved MySQL client
  "pg", // PostgreSQL client
  "oracledb", // Oracle DB client
  "mongodb", // MongoDB driver

  // HTTP & Network (Safe)
  "axios", // Promise-based HTTP client – safer than native http

  // Utilities & Data Processing
  "zod", // Type-safe input validation

  // Date/Time
  "date-fns", // Modular date utility library

  // Testing Utilities
  "@faker-js/faker", // Modern faker alternative
]);

// Enhanced blocked identifiers with balanced security
const BLOCKED_IDENTIFIERS = new Set([
  // Core Node.js/System Access
  "process",
  "global",
  "globalThis",
  "__dirname",
  "__filename",
  "require",
  "module",
  "exports",
  "__non_webpack_require__",

  // Code Execution
  "eval",
  "Function",
  "GeneratorFunction",
  "AsyncFunction",
  "AsyncGeneratorFunction",

  // Timers (DoS potential) - but allow in controlled context
  // Note: Playwright has built-in timeouts and wait functions
  "setTimeout",
  "setInterval",
  "setImmediate",
  "clearTimeout",
  "clearInterval",
  "clearImmediate",

  // Binary/Low-level operations (btoa/atob moved to allowed for auth)
  "SharedArrayBuffer",
  "Atomics",
  "WebAssembly",

  // File System
  "fs",
  "path",
  "os",
  "net",
  "http",
  "https",
  "stream",
  "child_process",
  "cluster",
  "worker_threads",

  // Dangerous globals (selectively block)
  "location",
  "window.location",
  "document.cookie",
]);

// Allow certain browser APIs that are safe in Playwright context
const ALLOWED_BROWSER_APIS = new Set([
  "console",
  "JSON",
  "Math",
  "Date",
  "RegExp",
  "Array",
  "Object",
  "String",
  "Number",
  "Promise",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Intl",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "localStorage",
  "sessionStorage", // Safe in browser context
  "fetch",
  "Request",
  "Response",
  "Headers", // Modern HTTP APIs
  "URL",
  "URLSearchParams",
  "Blob",
  "File",
  "FileReader",
  "Buffer", // Allow Buffer objects returned by Playwright APIs
  "btoa",
  "atob", // Base64 encoding/decoding for auth
  "crypto", // For generating UUIDs and secure random values
  "TextEncoder",
  "TextDecoder", // Text encoding utilities
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite", // Number parsing
  "Boolean", // Boolean constructor for type conversion
]);

// Security constants
const MAX_SCRIPT_LENGTH = 50000; // 50KB max
const MAX_STATEMENTS = 1000;

export interface ValidationResult {
  valid: boolean;
  error?: string;
  line?: number;
  column?: number;
  errorType?: "syntax" | "security" | "complexity" | "length" | "pattern";
}

export class ValidationService {
  validateCode(code: string): ValidationResult {
    console.log("Validating code snippet with enhanced security checks...");

    // 1. Basic length and content validation
    if (!code || typeof code !== "string") {
      return {
        valid: false,
        error: "Invalid script content. Please provide valid code to proceed.",
        errorType: "syntax",
      };
    }

    if (code.length > MAX_SCRIPT_LENGTH) {
      return {
        valid: false,
        error: `Script too long (${code.length} chars). Maximum allowed: ${MAX_SCRIPT_LENGTH} characters. Please reduce the script size to proceed.`,
        errorType: "length",
      };
    }

    // 2. Screenshot detection - block all screenshot-related operations
    const screenshotPatterns = [
      {
        pattern: /\.screenshot\s*\(/i,
        message:
          "Screenshot operations are not allowed as Playwright Traces have live screenshot capabilities.",
      },
      {
        pattern: /toHaveScreenshot\s*\(/i,
        message:
          "Visual comparison screenshots (toHaveScreenshot) are not allowed.",
      },
      {
        pattern: /expect\s*\([^)]*\)\s*\.toHaveScreenshot/i,
        message: "Visual regression testing with screenshots is not allowed.",
      },
    ];

    for (const { pattern, message } of screenshotPatterns) {
      const match = pattern.exec(code);
      if (match) {
        const line = this.getLineNumber(code, match.index);
        return {
          valid: false,
          error: `${message} Please remove screenshot related code to proceed.`,
          line,
          errorType: "pattern",
        };
      }
    }

    // 3. Enhanced dangerous patterns detection with balanced approach
    const dangerousPatterns = [
      // Function constructors and eval
      { pattern: /\beval\s*\(/, message: "eval() is not allowed" },
      {
        pattern: /new\s+Function\s*\(/,
        message: "Function constructor is not allowed",
      },
      {
        pattern: /\bFunction\s*\(/,
        message: "Function constructor is not allowed",
      },

      // Timer functions with DoS prevention (allow reasonable timeouts)
      {
        pattern: /setTimeout\s*\([^,]*,\s*0\s*\)/,
        message: "Zero-delay setTimeout can cause performance issues",
      },
      {
        pattern: /setInterval\s*\([^,]*,\s*[0-9]\s*\)/,
        message: "Very short setInterval (< 10ms) is not allowed",
      },
      {
        pattern: /setImmediate\s*\(/,
        message: "setImmediate is not allowed in browser context",
      },

      // Process and system access
      { pattern: /process\s*\./, message: "Process access is not allowed" },
      {
        pattern: /global\s*\./,
        message: "Global object access is not allowed",
      },
      {
        pattern: /globalThis\s*\./,
        message: "GlobalThis access is not allowed",
      },

      // Code injection patterns
      { pattern: /javascript\s*:/, message: "JavaScript URLs are not allowed" },
      {
        pattern: /data\s*:\s*text\/html/,
        message: "Data URLs with HTML are not allowed",
      },
      { pattern: /srcdoc\s*=/, message: "srcdoc attribute is not allowed" },

      // Loop bombing patterns (enhanced detection for all infinite loop variants)
      {
        pattern: /while\s*\(\s*true\s*\)/,
        message: "Infinite loop detected: while(true)",
      },
      {
        pattern: /while\s*\(\s*1\s*\)/,
        message: "Infinite loop detected: while(1)",
      },
      {
        pattern: /while\s*\(\s*!0\s*\)/,
        message: "Infinite loop detected: while(!0)",
      },
      {
        pattern: /for\s*\(\s*;[^;]*;\s*\)/,
        message: "Infinite loop detected: for(;;) or for(;condition;)",
      },
      {
        pattern: /for\s*\(\s*;\s*;\s*[^)]*\)/,
        message: "Infinite loop detected: for(;;) variant",
      },
      {
        pattern: /for\s*\(\s*[^;]*;\s*true\s*;[^)]*\)/,
        message: "Infinite loop detected: for loop with true condition",
      },
      {
        pattern: /for\s*\(\s*[^;]*;\s*1\s*;[^)]*\)/,
        message: "Infinite loop detected: for loop with 1 condition",
      },
      {
        pattern: /for\s*\(\s*[^;]*;\s*!0\s*;[^)]*\)/,
        message: "Infinite loop detected: for loop with !0 condition",
      },

      // Prototype pollution
      {
        pattern: /__proto__/,
        message: "__proto__ manipulation is not allowed",
      },
      {
        pattern: /prototype\s*\[/,
        message: "Prototype manipulation is not allowed",
      },
      {
        pattern: /constructor\s*\./,
        message: "Constructor access is not allowed",
      },

      // File system indicators
      { pattern: /\b__dirname\b/, message: "__dirname is not allowed" },
      { pattern: /\b__filename\b/, message: "__filename is not allowed" },

      // Worker and threading
      { pattern: /Worker\s*\(/, message: "Web Workers are not allowed" },
      {
        pattern: /SharedArrayBuffer/,
        message: "SharedArrayBuffer is not allowed",
      },
      {
        pattern: /Atomics\s*\./,
        message: "Atomics operations are not allowed",
      },

      // Module system manipulation
      {
        pattern: /require\s*\.\s*cache/,
        message: "require.cache manipulation is not allowed",
      },
      {
        pattern: /require\s*\.\s*resolve/,
        message: "require.resolve is not allowed",
      },
      {
        pattern: /module\s*\.\s*exports/,
        message: "module.exports manipulation is not allowed",
      },

      // Dangerous Buffer constructors and methods (allow Playwright Buffer usage)
      {
        pattern: /new\s+Buffer\s*\(/,
        message:
          "Buffer constructor is not allowed - use Buffer.from() or Buffer.alloc() instead",
      },
      {
        pattern: /Buffer\s*\(/,
        message:
          "Direct Buffer() calls are not allowed - use Buffer.from() or Buffer.alloc() instead",
      },
      {
        pattern: /Buffer\s*\.\s*(allocUnsafe|allocUnsafeSlow)/,
        message: "Unsafe Buffer allocation methods are not allowed",
      },
      {
        pattern: /ArrayBuffer/,
        message: "ArrayBuffer operations should be avoided",
      },

      // Encoding/decoding that could be used for obfuscation
      { pattern: /unescape\s*\(/, message: "unescape is not allowed" },
      {
        pattern: /decodeURI/,
        message: "URI decoding functions are not allowed",
      },

      // Console manipulation
      {
        pattern: /console\s*\.\s*clear/,
        message: "Console clearing is not allowed",
      },
      {
        pattern: /console\s*\[/,
        message: "Console manipulation is not allowed",
      },
    ];

    for (const { pattern, message } of dangerousPatterns) {
      const match = pattern.exec(code);
      if (match) {
        const line = this.getLineNumber(code, match.index);
        return {
          valid: false,
          error: `${message}. Please review and remove the restricted code to proceed.`,
          line,
          errorType: "security",
        };
      }
    }

    // 4. Check for suspicious obfuscation patterns (with more nuanced detection)
    const suspiciousPatterns = [
      // Only block excessive use of character codes
      {
        pattern: /(String\.fromCharCode\s*\([^)]*\)){5,}/,
        message: "Excessive String.fromCharCode usage suggests obfuscation",
      },
      // Allow occasional hex escapes but block large sequences
      {
        pattern: /(\\x[0-9a-fA-F]{2}){20,}/,
        message: "Excessive hex escape sequences suggest obfuscation",
      },
      // Allow unicode but block large sequences
      {
        pattern: /(\\u[0-9a-fA-F]{4}){10,}/,
        message: "Excessive unicode escape sequences suggest obfuscation",
      },
      // Very large string arrays might be suspicious
      {
        pattern: /\[(['"][^'"]{50,}['"],?\s*){20,}\]/,
        message: "Extremely large string arrays suggest obfuscation",
      },
    ];

    for (const { pattern, message } of suspiciousPatterns) {
      const match = pattern.exec(code);
      if (match) {
        const line = this.getLineNumber(code, match.index);
        return {
          valid: false,
          error: `${message}. Please review and simplify the code to proceed.`,
          line,
          errorType: "security",
        };
      }
    }

    // 5. Parse into AST with enhanced validation
    let ast: acorn.Node;
    try {
      ast = acorn.parse(code, {
        ecmaVersion: 2022,
        sourceType: "module",
        locations: true,
        allowReturnOutsideFunction: false,
        allowHashBang: false,
      }) as acorn.Node;
    } catch (err: unknown) {
      if (err instanceof Error) {
        const lineMatch = err.message.match(/\((\d+):(\d+)\)/);
        if (lineMatch) {
          const line = parseInt(lineMatch[1]);
          const column = parseInt(lineMatch[2]);
          return {
            valid: false,
            error: `Syntax error. Please check your code structure and fix the syntax issue to proceed.`,
            line,
            column,
            errorType: "syntax",
          };
        }
        return {
          valid: false,
          error: `Syntax error: ${err.message}. Please check your code structure and fix the syntax issues to proceed.`,
          errorType: "syntax",
        };
      }
      return {
        valid: false,
        error:
          "Code parsing failed. Please check your code structure and fix any syntax issues to proceed.",
        errorType: "syntax",
      };
    }

    // 6. Enhanced AST analysis with complexity checks and structural validation
    try {
      let statementCount = 0;

      // Validate imports using simple approach - just check if they exist and are allowed
      // The AST parsing itself will catch syntax errors like imports in wrong places
      walk.simple(ast, {
        Statement: () => {
          statementCount++;
          if (statementCount > MAX_STATEMENTS) {
            throw new Error(
              `Script too complex: more than ${MAX_STATEMENTS} statements. Please simplify your code to proceed.`
            );
          }
        },

        CallExpression: (node: acorn.CallExpression & acorn.Node) => {
          const callee = node.callee as acorn.Node;

          // Enhanced require() validation
          if (
            callee.type === "Identifier" &&
            (callee as acorn.Identifier).name === "require"
          ) {
            if (node.arguments.length !== 1) {
              throw new Error(
                `Invalid require() call. Please review and remove the invalid require statement to proceed.`
              );
            }

            const arg = node.arguments[0];
            if (arg.type !== "Literal" || typeof arg.value !== "string") {
              throw new Error(
                `Dynamic require() calls are not allowed. Please review and remove the dynamic require to proceed.`
              );
            }

            const moduleName = arg.value as string;
            if (
              !ALLOWED_MODULES.has(moduleName) &&
              !moduleName.startsWith("@playwright/")
            ) {
              throw new Error(
                `Module '${moduleName}' is not allowed. Please review and remove the restricted module import to proceed.`
              );
            }
          }

          // Check for blocked function calls
          if (callee.type === "MemberExpression") {
            const obj = (callee as acorn.MemberExpression).object as acorn.Node;
            if (
              obj.type === "Identifier" &&
              BLOCKED_IDENTIFIERS.has((obj as acorn.Identifier).name)
            ) {
              throw new Error(
                `Access to '${
                  (obj as acorn.Identifier).name
                }' is not allowed. Please review and remove the restricted code to proceed.`
              );
            }
          }
        },

        ImportDeclaration: (node: acorn.ImportDeclaration & acorn.Node) => {
          if (
            node.source &&
            node.source.type === "Literal" &&
            typeof node.source.value === "string"
          ) {
            const moduleName = node.source.value as string;
            if (
              !ALLOWED_MODULES.has(moduleName) &&
              !moduleName.startsWith("@playwright/")
            ) {
              // Special case for common @playwright mistake
              if (moduleName === "@playwright") {
                throw new Error(
                  `Import of module '${moduleName}' is not allowed. Use '@playwright/test' instead for Playwright testing functionality.`
                );
              }
              throw new Error(
                `Import of module '${moduleName}' is not allowed. Please review and remove the restricted import to proceed.`
              );
            }
          }
        },

        Identifier: (node: acorn.Identifier & acorn.Node) => {
          // More nuanced identifier checking
          if (
            BLOCKED_IDENTIFIERS.has(node.name) &&
            !ALLOWED_BROWSER_APIS.has(node.name)
          ) {
            // Special case for require - suggest ES6 imports
            if (node.name === "require") {
              throw new Error(
                `Usage of 'require' is not allowed. Use ES6 import statements instead (e.g., import { test } from '@playwright/test').`
              );
            }
            throw new Error(
              `Usage of '${node.name}' is not allowed. Please review and remove the restricted code to proceed.`
            );
          }
        },

        Literal: (node: acorn.Literal & acorn.Node) => {
          // Check for suspicious string literals (more reasonable limit)
          if (typeof node.value === "string" && node.value.length > 5000) {
            throw new Error(
              `Extremely long string literal (${node.value.length} chars). Please break down large strings to proceed.`
            );
          }
        },
      });

      console.log("Enhanced validation passed. Complexity stats:", {
        statements: statementCount,
      });

      return { valid: true };
    } catch (error) {
      if (error instanceof Error) {
        const lineMatch = error.message.match(/at line (\d+)/);
        const line = lineMatch ? parseInt(lineMatch[1]) : undefined;
        console.warn(`Enhanced AST validation failed: ${error.message}`);
        return {
          valid: false,
          error: error.message,
          line,
          errorType: error.message.includes("Too many")
            ? "complexity"
            : error.message.includes("Usage of 'require'")
            ? "pattern"
            : "security",
        };
      }
      return {
        valid: false,
        error:
          "Validation failed. Please review your code and fix any issues to proceed.",
        errorType: "security",
      };
    }
  }

  private getLineNumber(code: string, index: number): number {
    const lines = code.substring(0, index).split("\n");
    return lines.length;
  }

  // Helper method to get allowed modules for external use
  getAllowedModules(): string[] {
    return Array.from(ALLOWED_MODULES);
  }

  // Helper method to check if a module is allowed
  isModuleAllowed(moduleName: string): boolean {
    return (
      ALLOWED_MODULES.has(moduleName) || moduleName.startsWith("@playwright/")
    );
  }
}

// Export a singleton instance
export const validationService = new ValidationService();

// Export the allowed modules list for UI components
export const getAllowedModules = () => validationService.getAllowedModules();
export const isModuleAllowed = (moduleName: string) =>
  validationService.isModuleAllowed(moduleName);
