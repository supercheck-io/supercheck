/**
 * Shared AI Provider utilities
 *
 * This module provides reusable AI provider configuration, validation,
 * and model instantiation used across all AI features.
 *
 * DRY: Centralizes provider logic to avoid duplication in:
 * - extract-requirements.ts
 * - ai-service.ts (AI Fix)
 * - ai-streaming-service.ts (AI Create)
 */

import { openai, createOpenAI } from "@ai-sdk/openai";
import { azure } from "@ai-sdk/azure";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { vertex } from "@ai-sdk/google-vertex";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from "ai";

export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

function getOpenAIModel(model: string): LanguageModel {
  if (model !== DEFAULT_OPENAI_MODEL) return openai(model);

  // This SDK treats every GPT-6 model as Astra and strips Luna's supported
  // "none" effort. Set it on the wire to preserve latency/output budgets.
  return wrapLanguageModel({
    model: createOpenAI({
      fetch: (url, init) => fetch(url, {
        ...init,
        body: JSON.stringify({
          ...JSON.parse(String(init?.body)),
          reasoning: { effort: "none" },
        }),
      }),
    }).responses(model),
    // Input conversion must also know storage is disabled so later tool
    // steps replay content instead of referencing unstored response IDs.
    middleware: defaultSettingsMiddleware({
      settings: { providerOptions: { openai: { store: false } } },
    }),
  });
}

// Supported AI providers
export type AIProvider =
  | "openai"
  | "azure"
  | "anthropic"
  | "gemini"
  | "google-vertex"
  | "bedrock"
  | "openrouter"
  | "deepseek";

/**
 * Configuration for AI service requests
 */
export interface AIServiceConfig {
  maxRetries: number;
  temperature: number;
  timeout: number;
}

export interface AIGenerationOptions {
  temperature?: number;
}

/**
 * Validates that the required credentials are configured for the selected provider.
 * Throws an error if credentials are missing or invalid.
 *
 * This is a shared utility used by all AI features to ensure consistent
 * validation before making AI requests.
 */
export function validateAIConfiguration(): void {
  const provider = getAIProvider();

  switch (provider) {
    case "deepseek": {
      if (!process.env.DEEPSEEK_API_KEY?.trim()) {
        throw new Error(
          "DeepSeek API key is not configured. Please set DEEPSEEK_API_KEY environment variable."
        );
      }
      break;
    }
    case "azure": {
      const resourceName = process.env.AZURE_RESOURCE_NAME;
      const apiKey = process.env.AZURE_API_KEY;
      const useManagedIdentity =
        process.env.AZURE_USE_MANAGED_IDENTITY === "true";

      if (!resourceName) {
        throw new Error(
          "Azure OpenAI resource name is not configured. Please set AZURE_RESOURCE_NAME environment variable."
        );
      }
      if (!useManagedIdentity && (!apiKey || apiKey.trim().length === 0)) {
        throw new Error(
          "Azure OpenAI API key is not configured. Please set AZURE_API_KEY or enable AZURE_USE_MANAGED_IDENTITY."
        );
      }
      break;
    }

    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey || apiKey.trim().length === 0) {
        throw new Error(
          "Anthropic API key is not configured. Please set ANTHROPIC_API_KEY environment variable."
        );
      }
      if (!apiKey.startsWith("sk-ant-")) {
        console.warn(
          "[AI Provider] Warning: Anthropic API key does not follow expected format (sk-ant-*)"
        );
      }
      break;
    }

    case "gemini": {
      const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      if (!apiKey || apiKey.trim().length === 0) {
        throw new Error(
          "Google AI API key is not configured. Please set GOOGLE_GENERATIVE_AI_API_KEY environment variable. Get your key from https://aistudio.google.com/apikey"
        );
      }
      break;
    }

    case "google-vertex": {
      const projectId = process.env.GOOGLE_VERTEX_PROJECT;
      if (!projectId) {
        throw new Error(
          "Google Vertex AI project ID is not configured. Please set GOOGLE_VERTEX_PROJECT environment variable."
        );
      }
      break;
    }

    case "bedrock": {
      const region = process.env.BEDROCK_AWS_REGION;
      if (!region) {
        throw new Error(
          "AWS Bedrock region is not configured. Please set BEDROCK_AWS_REGION environment variable."
        );
      }
      // Validate credential pair: if one is set, both must be set
      const accessKeyId = process.env.BEDROCK_AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.BEDROCK_AWS_SECRET_ACCESS_KEY;
      if (
        (accessKeyId && !secretAccessKey) ||
        (!accessKeyId && secretAccessKey)
      ) {
        throw new Error(
          "AWS Bedrock credentials incomplete. Both BEDROCK_AWS_ACCESS_KEY_ID and BEDROCK_AWS_SECRET_ACCESS_KEY must be set together, or neither (for IAM role authentication)."
        );
      }
      break;
    }

    case "openrouter": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey || apiKey.trim().length === 0) {
        throw new Error(
          "OpenRouter API key is not configured. Please set OPENROUTER_API_KEY environment variable. Get your key from https://openrouter.ai/keys"
        );
      }
      break;
    }

    case "openai":
    default: {
      const apiKey = process.env.OPENAI_API_KEY;
      if (
        !apiKey ||
        apiKey === "your-openai-api-key-here" ||
        apiKey.trim().length === 0
      ) {
        throw new Error(
          "OpenAI API key is not configured. Please set OPENAI_API_KEY environment variable with a valid API key."
        );
      }
      if (!apiKey.trim().startsWith("sk-")) {
        console.warn(
          "[AI Provider] Warning: API key does not follow expected OpenAI format (sk-*)"
        );
      }
      break;
    }
  }
}

/**
 * Get the current AI provider from environment
 */
export function getAIProvider(): AIProvider {
  return (process.env.AI_PROVIDER || "openai").toLowerCase() as AIProvider;
}

/**
 * Returns the actual model name being used based on provider configuration.
 * Used for accurate logging and metrics.
 */
export function getActualModelName(): string {
  const provider = getAIProvider();
  const modelName = process.env.AI_MODEL;

  switch (provider) {
    case "azure":
      return process.env.AZURE_OPENAI_DEPLOYMENT || modelName || "gpt-4o-mini";
    case "anthropic":
      return modelName || "claude-3-5-haiku-20241022";
    case "gemini":
      return modelName || "gemini-2.5-flash";
    case "google-vertex":
      return modelName || "gemini-2.5-flash";
    case "bedrock":
      return modelName || "anthropic.claude-3-5-haiku-20241022-v1:0";
    case "openrouter":
      return modelName || "anthropic/claude-3.5-haiku";
    case "deepseek":
      return modelName || "deepseek-flash";
    case "openai":
    default:
      return modelName || DEFAULT_OPENAI_MODEL;
  }
}

/**
 * Factory method that returns the appropriate AI model based on AI_PROVIDER env var.
 * Supports: OpenAI, Azure OpenAI, Anthropic, Gemini, Google Vertex AI, AWS Bedrock, OpenRouter, DeepSeek.
 * DeepSeek initialization errors fail closed to avoid switching data processors.
 */
export function getProviderModel(): LanguageModel {
  const provider = getAIProvider();
  const modelName = process.env.AI_MODEL;

  try {
    switch (provider) {
      case "azure": {
        // Azure uses deployment name, not model name
        // AZURE_RESOURCE_NAME and AZURE_API_KEY are read automatically from env
        const deployment =
          process.env.AZURE_OPENAI_DEPLOYMENT || modelName || "gpt-4o-mini";
        console.log(
          `[AI Provider] Initializing Azure OpenAI with deployment: ${deployment}`
        );
        return azure(deployment) as unknown as LanguageModel;
      }

      case "anthropic": {
        // ANTHROPIC_API_KEY is read automatically from env
        const model = modelName || "claude-3-5-haiku-20241022";
        console.log(`[AI Provider] Initializing Anthropic with model: ${model}`);
        return anthropic(model) as unknown as LanguageModel;
      }

      case "gemini": {
        // Google AI Studio - simple API key like OpenAI
        // GOOGLE_GENERATIVE_AI_API_KEY is read automatically from env
        const model = modelName || "gemini-2.5-flash";
        console.log(
          `[AI Provider] Initializing Google AI (Gemini) with model: ${model}`
        );
        return google(model) as unknown as LanguageModel;
      }

      case "google-vertex": {
        // Google Vertex AI - enterprise GCP setup
        // Uses ADC automatically, GOOGLE_VERTEX_PROJECT and GOOGLE_VERTEX_LOCATION configure the endpoint
        const model = modelName || "gemini-2.5-flash";
        console.log(
          `[AI Provider] Initializing Google Vertex AI with model: ${model}`
        );
        return vertex(model) as unknown as LanguageModel;
      }

      case "bedrock": {
        // Create Bedrock with ISOLATED credentials (BEDROCK_* prefix)
        // This prevents conflicts with S3/R2 which use standard AWS_* vars
        const bedrock = createAmazonBedrock({
          region: process.env.BEDROCK_AWS_REGION || "us-east-1",
          // Only pass explicit creds if running outside AWS (self-hosted)
          // On AWS (ECS/Lambda/EC2), leave undefined to use instance role
          accessKeyId: process.env.BEDROCK_AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.BEDROCK_AWS_SECRET_ACCESS_KEY,
          sessionToken: process.env.BEDROCK_AWS_SESSION_TOKEN,
        });
        const model = modelName || "anthropic.claude-3-5-haiku-20241022-v1:0";
        console.log(`[AI Provider] Initializing AWS Bedrock with model: ${model}`);
        return bedrock(model) as unknown as LanguageModel;
      }

      case "openrouter": {
        // OpenRouter - unified gateway to 400+ models
        // OPENROUTER_API_KEY is read automatically from env
        const openrouter = createOpenRouter({
          apiKey: process.env.OPENROUTER_API_KEY!,
        });
        const model = modelName || "anthropic/claude-3.5-haiku";
        console.log(`[AI Provider] Initializing OpenRouter with model: ${model}`);
        return openrouter(model) as unknown as LanguageModel;
      }

      case "deepseek": {
        validateAIConfiguration();
        const deepseek = createOpenAI({
          apiKey: process.env.DEEPSEEK_API_KEY,
          baseURL: "https://api.deepseek.com",
          name: "deepseek",
          // DeepSeek enables thinking by default. Disable it so tool loops
          // do not require reasoning_content unsupported by this adapter.
          fetch: (url, init) => fetch(url, {
            ...init,
            body: JSON.stringify({
              ...JSON.parse(String(init?.body)),
              thinking: { type: "disabled" },
            }),
          }),
        });
        return deepseek.chat(modelName || "deepseek-flash");
      }

      case "openai":
      default: {
        // OPENAI_API_KEY is read automatically from env
        const model = modelName || DEFAULT_OPENAI_MODEL;
        if (provider !== "openai") {
          console.warn(
            `[AI Provider] Unknown provider '${provider}', falling back to OpenAI`
          );
        }
        console.log(`[AI Provider] Initializing OpenAI with model: ${model}`);
        return getOpenAIModel(model);
      }
    }
  } catch (error) {
    if (provider === "deepseek") throw error;
    console.error(`[AI Provider] Error initializing ${provider}:`, error);
    // Fallback to OpenAI on initialization error
    console.log(`[AI Provider] Falling back to OpenAI ${DEFAULT_OPENAI_MODEL}`);
    return getOpenAIModel(DEFAULT_OPENAI_MODEL);
  }
}

/**
 * Get service configuration from environment with validated defaults.
 * Used across all AI features for consistent timeout and retry behavior.
 */
export function getServiceConfiguration(): AIServiceConfig {
  const baseTimeout = parseInt(process.env.AI_TIMEOUT_MS || "90000");
  const maxRetries = parseInt(process.env.AI_MAX_RETRIES || "2");
  const temperature = parseFloat(process.env.AI_TEMPERATURE || "0.1");

  // Validate and apply sensible defaults
  if (isNaN(baseTimeout) || baseTimeout < 10000) {
    console.warn("[AI Provider] Invalid timeout, using default 90000ms");
  }
  if (isNaN(maxRetries) || maxRetries < 1 || maxRetries > 5) {
    console.warn("[AI Provider] Invalid maxRetries, using default 2");
  }
  if (isNaN(temperature) || temperature < 0 || temperature > 2) {
    console.warn("[AI Provider] Invalid temperature, using default 0.1");
  }

  return {
    maxRetries: Math.max(1, Math.min(isNaN(maxRetries) ? 2 : maxRetries, 5)),
    temperature: Math.max(0, Math.min(isNaN(temperature) ? 0.1 : temperature, 2)),
    timeout: Math.min(
      Math.max(isNaN(baseTimeout) ? 90000 : baseTimeout, 10000),
      120000
    ),
  };
}

/**
 * Builds provider-safe generation options for AI SDK calls.
 * Azure OpenAI deployments, especially GPT-5/reasoning deployments, can reject
 * the temperature parameter even when other providers accept it.
 */
export function getProviderGenerationOptions(
  options: AIGenerationOptions = {}
): AIGenerationOptions {
  const provider = getAIProvider();

  if (provider === "azure" && process.env.AZURE_INCLUDE_TEMPERATURE !== "true") {
    return {};
  }

  if (provider === "openai" && getActualModelName() === DEFAULT_OPENAI_MODEL) {
    return {};
  }

  return options.temperature === undefined
    ? {}
    : { temperature: options.temperature };
}

/**
 * Map provider-specific errors to standardized error messages.
 * Sanitizes error messages to prevent API key leakage.
 */
export function mapProviderError(error: unknown): Error {
  const errorMessage =
    error instanceof Error ? error.message : String(error);

  // Map common error types
  if (
    errorMessage.includes("401") ||
    errorMessage.toLowerCase().includes("unauthorized") ||
    errorMessage.toLowerCase().includes("invalid api key")
  ) {
    return new Error("AI_AUTH_ERROR: Invalid API credentials");
  }
  if (
    errorMessage.includes("429") ||
    errorMessage.toLowerCase().includes("rate limit")
  ) {
    return new Error("AI_RATE_LIMIT: Provider rate limit exceeded");
  }
  if (
    errorMessage.toLowerCase().includes("timeout") ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return new Error("AI_TIMEOUT: Request timed out");
  }

  // Sanitize to prevent API key leakage
  const sanitizedMessage = errorMessage.replace(/api[_\s]*key/gi, "[REDACTED]");
  return new Error(`AI_ERROR: ${sanitizedMessage}`);
}
