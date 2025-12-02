/**
 * AI Module - Centralized exports for AI-related functionality
 *
 * This module provides:
 * - AI Security utilities (input sanitization, prompt injection protection)
 * - AI Code Validation (AST-based analysis)
 * - AI Prompt Building (secure prompt construction)
 * - AI Services (fix and streaming services)
 * - AI Rate Limiting (Redis-based multi-tier limiting)
 * - AI Classification (failure analysis and categorization)
 */

// Security
export { AISecurityService, AuthService } from "./ai-security";
export type { UserSession } from "./ai-security";

// Code Validation
export {
  AICodeValidator,
  aiCodeValidator,
  validateAICode,
} from "./ai-code-validator";
export type {
  ValidationResult,
  SecurityViolation,
  ViolationType,
} from "./ai-code-validator";

// Prompt Building
export { AIPromptBuilder } from "./ai-prompts";

// Services
export { AIFixService } from "./ai-service";
export { AIStreamingService } from "./ai-streaming-service";

// Rate Limiting
export {
  AIRateLimiter,
  aiRateLimiter,
  PLUS_TIER_LIMITS,
  PRO_TIER_LIMITS,
  SELF_HOSTED_LIMITS,
} from "./ai-rate-limiter";
export type { RateLimitConfig, RateLimitResult } from "./ai-rate-limiter";

// Classification
export {
  FailureCategory,
  PlaywrightMarkdownParser,
  AIFixDecisionEngine,
} from "./ai-classifier";
