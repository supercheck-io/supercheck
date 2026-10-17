import type { TestType } from "@/db/schema/types";
import { validateTestScript } from "./script-type-validator";

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
    const result = validateTestScript(
      code,
      options.selectedTestType ?? "browser",
    );
    return result.valid ? { valid: true } : result;
  }
}

export const playwrightValidationService = new PlaywrightValidationService();
