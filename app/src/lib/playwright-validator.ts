import type { TestType } from "@/db/schema/types";
import { validateTestScript } from "./script-type-validator";

// Known bundled libraries for editor guidance, not a runtime import allow-list.
const ALLOWED_MODULES = new Set([
  // Testing & Automation
  "@playwright/test", // UI & E2E testing framework

  // k6 Performance Testing (all k6 core modules)
  "k6", // k6 core module
  "k6/http", // HTTP client for load testing
  "k6/metrics", // Custom metrics
  "k6/crypto", // Cryptographic functions
  "k6/data", // Data handling utilities
  "k6/encoding", // Encoding/decoding utilities
  "k6/html", // HTML parsing
  "k6/ws", // WebSocket support
  "k6/grpc", // gRPC support
  "k6/net/grpc", // gRPC networking
  "k6/execution", // Execution context (VU, scenario info)

  // File helpers remain the portable way to use project file variables.
  "path", // Path manipulation utilities
  "node:path", // Node.js URL-style path import

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

export interface ValidationResult {
  valid: boolean;
  error?: string;
  line?: number;
  column?: number;
  errorType?:
    | "syntax"
    | "security"
    | "complexity"
    | "length"
    | "pattern"
    | "type";
}

interface PlaywrightValidationOptions {
  selectedTestType?: TestType;
}

export class PlaywrightValidationService {
  validateCode(
    code: string,
    options: PlaywrightValidationOptions = {},
  ): ValidationResult {
    // Submission feedback only. Kubernetes/gVisor provides runtime isolation.
    if (!code || typeof code !== "string" || !code.trim()) {
      return {
        valid: false,
        error: "Invalid script content. Please provide valid code to proceed.",
        errorType: "syntax",
      };
    }
    return validateTestScript(code, options.selectedTestType ?? "browser");
  }

  // Helper method to get allowed modules for external use
  getAllowedModules(): string[] {
    return Array.from(ALLOWED_MODULES);
  }

  // Helper method to check if a module is allowed
  isModuleAllowed(moduleName: string): boolean {
    return (
      ALLOWED_MODULES.has(moduleName) ||
      moduleName.startsWith("@playwright/") ||
      moduleName.startsWith("k6/") ||
      moduleName === "k6"
    );
  }
}

// Export a singleton instance
export const playwrightValidationService = new PlaywrightValidationService();

// Export the allowed modules list for UI components
export const getAllowedModules = () =>
  playwrightValidationService.getAllowedModules();
export const isModuleAllowed = (moduleName: string) =>
  playwrightValidationService.isModuleAllowed(moduleName);
