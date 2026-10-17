import type { TestType } from "@/db/schema/types";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { transpileTypeScript } from "./ts-transpiler";
import { MAX_SCRIPT_LENGTH } from "./validations/common";

export interface ScriptValidationResult {
  valid: boolean;
  error?: string;
  suggestedType?: TestType;
  warnings?: string[];
  line?: number;
  column?: number;
  errorType?: "syntax" | "length" | "complexity" | "type";
}

/** Bounded syntax feedback, not a filter for untrusted code. */
export function validateScriptSyntax(script: string): ScriptValidationResult {
  if (script.length > MAX_SCRIPT_LENGTH) {
    return {
      valid: false,
      error: `Script too long. Maximum allowed: ${MAX_SCRIPT_LENGTH} characters.`,
      errorType: "length",
    };
  }
  const result = transpileTypeScript(script);
  if (!result.success) {
    return {
      valid: false,
      error: `Syntax error: ${result.message}`,
      line: result.line,
      column: result.column,
      errorType: "syntax",
    };
  }
  try {
    const ast = acorn.parse(result.code, {
      ecmaVersion: "latest",
      sourceType: "module",
    });
    let statements = 0;
    walk.simple(ast, {
      Statement() {
        statements++;
      },
    });
    if (statements > 1000) {
      return {
        valid: false,
        error: "Script too complex: more than 1000 statements.",
        errorType: "complexity",
      };
    }
  } catch (error) {
    return {
      valid: false,
      error: `Syntax error: ${error instanceof Error ? error.message : "Invalid script"}`,
      errorType: "syntax",
    };
  }
  return { valid: true };
}
