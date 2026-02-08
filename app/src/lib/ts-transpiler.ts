/* ================================
   TYPESCRIPT TRANSPILER UTILITY
   -------------------------------
   Shared esbuild-based TypeScript-to-JavaScript transpiler for script validation.
   Used by both k6-validator and playwright-validator to avoid code duplication.

   Key design decisions:
   - Lazy-loads esbuild via require() to avoid Jest jsdom environment issues.
     Static `import { transformSync } from "esbuild"` breaks in jsdom because
     esbuild's WASM/native bindings are incompatible with the jsdom global scope.
   - Provides structured error extraction from esbuild's error format.
   - Type-safe result types with discriminated unions.
=================================== */

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Successful transpilation result. */
export interface TranspileSuccess {
  success: true;
  /** Transpiled JavaScript code (ESM format). */
  code: string;
}

/** Failed transpilation result with structured error details. */
export interface TranspileFailure {
  success: false;
  /** Human-readable error message. */
  message: string;
  /** 1-based line number in the original source (if available). */
  line?: number;
  /** 1-based column number in the original source (if available). */
  column?: number;
}

export type TranspileResult = TranspileSuccess | TranspileFailure;

// ---------------------------------------------------------------------------
// Shared esbuild options
// ---------------------------------------------------------------------------

const ESBUILD_OPTIONS = {
  loader: "ts" as const,
  format: "esm" as const,
  target: "es2022",
  legalComments: "none" as const,
  logLevel: "silent" as const,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transpiles TypeScript source to JavaScript using esbuild.
 *
 * esbuild is loaded lazily via `require()` so that this module can be safely
 * imported in Jest/jsdom test environments where esbuild's native bindings
 * would otherwise cause a top-level import failure.
 *
 * @param source - TypeScript source code to transpile.
 * @returns A discriminated union: `{ success: true, code }` on success, or
 *          `{ success: false, message, line?, column? }` on failure.
 */
export function transpileTypeScript(source: string): TranspileResult {
  try {
    // Lazy-load esbuild to avoid Jest jsdom environment issues.
    // Static `import { transformSync } from "esbuild"` breaks in jsdom because
    // esbuild's WASM/native bindings are incompatible with the jsdom global scope.
    const { transformSync } = require("esbuild") as typeof import("esbuild");

    const result = transformSync(source, ESBUILD_OPTIONS);
    return { success: true, code: result.code };
  } catch (error: unknown) {
    const details = extractEsbuildErrorDetails(error);
    return {
      success: false,
      message: details.message,
      line: details.line,
      column: details.column,
    };
  }
}

// ---------------------------------------------------------------------------
// Error detail extraction
// ---------------------------------------------------------------------------

/**
 * Extracts structured error details from an esbuild TransformFailure.
 *
 * esbuild errors contain an `errors` array where each entry has:
 * - `text`: human-readable error message
 * - `location.line`: 1-based line number
 * - `location.column`: 0-based column number
 *
 * We normalise the column to 1-based for consistency with editor conventions.
 */
function extractEsbuildErrorDetails(error: unknown): {
  message: string;
  line?: number;
  column?: number;
} {
  if (
    error &&
    typeof error === "object" &&
    "errors" in error &&
    Array.isArray((error as { errors?: unknown[] }).errors) &&
    (error as { errors?: unknown[] }).errors!.length > 0
  ) {
    const firstError = (
      error as {
        errors: Array<{
          text?: string;
          location?: { line?: number; column?: number };
        }>;
      }
    ).errors[0];

    return {
      message:
        firstError.text ||
        (error instanceof Error ? error.message : "Invalid syntax"),
      line: firstError.location?.line,
      column:
        typeof firstError.location?.column === "number"
          ? firstError.location.column + 1 // normalise 0-based → 1-based
          : undefined,
    };
  }

  return {
    message: error instanceof Error ? error.message : "Invalid syntax",
  };
}
