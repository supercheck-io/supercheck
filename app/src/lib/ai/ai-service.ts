import { openai } from "@ai-sdk/openai";
import { azure } from "@ai-sdk/azure";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { vertex } from "@ai-sdk/google-vertex";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, LanguageModel } from "ai";
import { aiRateLimiter } from "./ai-rate-limiter";

interface AIFixRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  testType?: "browser" | "api" | "custom" | "database";
  // Optional rate limit context
  userId?: string;
  orgId?: string;
  tier?: string;
}

interface AIFixResponse {
  fixedScript: string;
  explanation: string;
  aiConfidence?: number;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  duration: number;
}

interface AIUsageLog {
  success: boolean;
  duration: number;
  tokensUsed?: number;
  error?: string;
  model: string;
  testType?: string;
}

// Supported AI providers
// - gemini: Google AI Studio with simple API key (recommended for most users)
// - google-vertex: Google Vertex AI with GCP project (enterprise)
// - openrouter: Unified gateway to 400+ models (simple fallback and model variety)
type AIProvider = "openai" | "azure" | "anthropic" | "gemini" | "google-vertex" | "bedrock" | "openrouter";

export class AIFixService {
  /**
   * Validates that the required credentials are configured for the selected provider.
   * Throws an error if credentials are missing or invalid.
   */
  private static validateConfiguration(): void {
    const provider = (process.env.AI_PROVIDER || "openai").toLowerCase() as AIProvider;

    switch (provider) {
      case "azure": {
        const resourceName = process.env.AZURE_RESOURCE_NAME;
        const apiKey = process.env.AZURE_API_KEY;
        const useManagedIdentity = process.env.AZURE_USE_MANAGED_IDENTITY === "true";
        
        if (!resourceName) {
          throw new Error("Azure OpenAI resource name is not configured. Please set AZURE_RESOURCE_NAME environment variable.");
        }
        if (!useManagedIdentity && (!apiKey || apiKey.trim().length === 0)) {
          throw new Error("Azure OpenAI API key is not configured. Please set AZURE_API_KEY or enable AZURE_USE_MANAGED_IDENTITY.");
        }
        break;
      }

      case "anthropic": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey || apiKey.trim().length === 0) {
          throw new Error("Anthropic API key is not configured. Please set ANTHROPIC_API_KEY environment variable.");
        }
        if (!apiKey.startsWith("sk-ant-")) {
          console.warn("[AI Service] Warning: Anthropic API key does not follow expected format (sk-ant-*)");
        }
        break;
      }

      case "gemini": {
        // Google AI Studio - simple API key like OpenAI
        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!apiKey || apiKey.trim().length === 0) {
          throw new Error("Google AI API key is not configured. Please set GOOGLE_GENERATIVE_AI_API_KEY environment variable. Get your key from https://aistudio.google.com/apikey");
        }
        break;
      }

      case "google-vertex": {
        // Google Vertex AI - enterprise GCP setup
        const projectId = process.env.GOOGLE_VERTEX_PROJECT;
        if (!projectId) {
          throw new Error("Google Vertex AI project ID is not configured. Please set GOOGLE_VERTEX_PROJECT environment variable.");
        }
        break;
      }

      case "bedrock": {
        const region = process.env.BEDROCK_AWS_REGION;
        if (!region) {
          throw new Error("AWS Bedrock region is not configured. Please set BEDROCK_AWS_REGION environment variable.");
        }
        // Validate credential pair: if one is set, both must be set
        const accessKeyId = process.env.BEDROCK_AWS_ACCESS_KEY_ID;
        const secretAccessKey = process.env.BEDROCK_AWS_SECRET_ACCESS_KEY;
        if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
          throw new Error("AWS Bedrock credentials incomplete. Both BEDROCK_AWS_ACCESS_KEY_ID and BEDROCK_AWS_SECRET_ACCESS_KEY must be set together, or neither (for IAM role authentication).");
        }
        break;
      }

      case "openrouter": {
        // OpenRouter - unified gateway to many providers
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey || apiKey.trim().length === 0) {
          throw new Error("OpenRouter API key is not configured. Please set OPENROUTER_API_KEY environment variable. Get your key from https://openrouter.ai/keys");
        }
        break;
      }

      case "openai":
      default: {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey || apiKey === "your-openai-api-key-here" || apiKey.trim().length === 0) {
          throw new Error("OpenAI API key is not configured. Please set OPENAI_API_KEY environment variable with a valid API key.");
        }
        if (!apiKey.trim().startsWith("sk-")) {
          console.warn("[AI Service] Warning: API key does not follow expected OpenAI format (sk-*)");
        }
        break;
      }
    }
  }

  /**
   * Returns the actual model name being used based on provider configuration.
   * Used for accurate logging and metrics.
   */
  private static getActualModelName(): string {
    const provider = (process.env.AI_PROVIDER || "openai").toLowerCase() as AIProvider;
    const modelName = process.env.AI_MODEL;

    switch (provider) {
      case "azure":
        return process.env.AZURE_OPENAI_DEPLOYMENT || modelName || "gpt-4o-mini";
      case "anthropic":
        return modelName || "claude-3-5-haiku-20241022";
      case "gemini":
        return modelName || "gemini-2.0-flash";
      case "google-vertex":
        return modelName || "gemini-2.0-flash";
      case "bedrock":
        return modelName || "anthropic.claude-3-5-haiku-20241022-v1:0";
      case "openrouter":
        return modelName || "anthropic/claude-3.5-haiku";
      case "openai":
      default:
        return modelName || "gpt-4o-mini";
    }
  }

  /**
   * Factory method that returns the appropriate AI model based on AI_PROVIDER env var.
   * Supports: OpenAI, Azure OpenAI, Anthropic, Google Vertex AI, AWS Bedrock.
   * Falls back to OpenAI gpt-4o-mini on any initialization error.
   */
  private static getProviderModel(): LanguageModel {
    const provider = (process.env.AI_PROVIDER || "openai").toLowerCase() as AIProvider;
    const modelName = process.env.AI_MODEL;

    try {
      switch (provider) {
        case "azure": {
          // Azure uses deployment name, not model name
          // AZURE_RESOURCE_NAME and AZURE_API_KEY are read automatically from env
          const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || modelName || "gpt-4o-mini";
          console.log(`[AI Service] Initializing Azure OpenAI with deployment: ${deployment}`);
          return azure(deployment) as unknown as LanguageModel;
        }

        case "anthropic": {
          // ANTHROPIC_API_KEY is read automatically from env
          const model = modelName || "claude-3-5-haiku-20241022";
          console.log(`[AI Service] Initializing Anthropic with model: ${model}`);
          return anthropic(model) as unknown as LanguageModel;
        }

        case "gemini": {
          // Google AI Studio - simple API key like OpenAI
          // GOOGLE_GENERATIVE_AI_API_KEY is read automatically from env
          const model = modelName || "gemini-2.0-flash";
          console.log(`[AI Service] Initializing Google AI (Gemini) with model: ${model}`);
          return google(model) as unknown as LanguageModel;
        }

        case "google-vertex": {
          // Google Vertex AI - enterprise GCP setup
          // Uses ADC automatically, GOOGLE_VERTEX_PROJECT and GOOGLE_VERTEX_LOCATION configure the endpoint
          const model = modelName || "gemini-2.0-flash";
          console.log(`[AI Service] Initializing Google Vertex AI with model: ${model}`);
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
          console.log(`[AI Service] Initializing AWS Bedrock with model: ${model}`);
          return bedrock(model) as unknown as LanguageModel;
        }

        case "openrouter": {
          // OpenRouter - unified gateway to 400+ models
          // OPENROUTER_API_KEY is read automatically from env
          const openrouter = createOpenRouter({
            apiKey: process.env.OPENROUTER_API_KEY!,
          });
          const model = modelName || "anthropic/claude-3.5-haiku";
          console.log(`[AI Service] Initializing OpenRouter with model: ${model}`);
          return openrouter(model) as unknown as LanguageModel;
        }

        case "openai":
        default: {
          // OPENAI_API_KEY is read automatically from env
          const model = modelName || "gpt-4o-mini";
          if (provider !== "openai") {
            console.warn(`[AI Service] Unknown provider '${provider}', falling back to OpenAI`);
          }
          console.log(`[AI Service] Initializing OpenAI with model: ${model}`);
          return openai(model) as unknown as LanguageModel;
        }
      }
    } catch (error) {
      console.error(`[AI Service] Error initializing ${provider}:`, error);
      // Fallback to OpenAI on initialization error
      console.log("[AI Service] Falling back to OpenAI gpt-4o-mini");
      return openai("gpt-4o-mini") as unknown as LanguageModel;
    }
  }

  private static async checkRateLimit(
    userId?: string,
    orgId?: string,
    tier?: string
  ): Promise<void> {
    // Skip rate limiting in self-hosted mode
    if (process.env.SELF_HOSTED === "true") {
      return;
    }

    // Check rate limits if we have user/org context
    if (userId || orgId) {
      const result = await aiRateLimiter.checkRateLimit({
        userId,
        orgId,
        tier,
      });

      if (!result.allowed) {
        throw new Error(
          `Rate limit exceeded. Please try again in ${result.retryAfter || 60} seconds.`
        );
      }
    }
  }

  private static getServiceConfiguration() {
    // Configuration optimized for OpenAI models including newer ones like GPT-5
    const baseTimeout = parseInt(process.env.AI_TIMEOUT_MS || "90000"); // Increased default to 90 seconds
    const maxRetries = parseInt(process.env.AI_MAX_RETRIES || "2");
    const temperature = parseFloat(process.env.AI_TEMPERATURE || "0.1");

    // Validate configuration values
    if (isNaN(baseTimeout) || baseTimeout < 10000) {
      console.warn("[AI Service] Invalid timeout, using default 90000ms");
    }
    if (isNaN(maxRetries) || maxRetries < 1 || maxRetries > 5) {
      console.warn("[AI Service] Invalid maxRetries, using default 2");
    }
    if (isNaN(temperature) || temperature < 0 || temperature > 2) {
      console.warn("[AI Service] Invalid temperature, using default 0.1");
    }

    return {
      maxRetries: Math.max(1, Math.min(maxRetries, 5)), // Between 1-5
      temperature: Math.max(0, Math.min(temperature, 2)), // Between 0-2
      timeout: Math.min(Math.max(baseTimeout, 10000), 120000), // Between 10-120 seconds for all OpenAI models
    };
  }

  private static optimizePrompt(prompt: string, testType?: string): string {
    const testTypeContext = testType ? `\n\nTest Type: ${testType}` : "";

    return `You are an expert Playwright test automation engineer. Fix the failing test script based on the error report.

${prompt}${testTypeContext}

IMPORTANT:
- Return ONLY the fixed JavaScript/TypeScript code
- Keep the original test structure and intent
- Fix only the specific issues mentioned
- Use proper Playwright best practices
- Do NOT add any explanation comments in the code
- Do NOT add EXPLANATION or CONFIDENCE comments in the code

RESPONSE FORMAT:
FIXED_SCRIPT:
\`\`\`javascript
[Clean fixed code without any explanation comments]
\`\`\`

EXPLANATION:
[Brief explanation of what was fixed and why]`;
  }

  private static parseAIResponse(response: string): {
    fixedScript: string;
    explanation: string;
    aiConfidence?: number;
  } {
    try {
      // Try standard format first
      let scriptMatch = response.match(
        /FIXED_SCRIPT:\s*```(?:javascript|typescript|js|ts)?\s*([\s\S]*?)```/i
      );
      const explanationMatch = response.match(
        /EXPLANATION:\s*([\s\S]*?)(?:CONFIDENCE:|$)/i
      );
      const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);

      // If standard format fails, try flexible parsing for any AI model
      if (!scriptMatch) {
        // Try to find any code block
        const codeBlocks = response.match(
          /```(?:javascript|typescript|js|ts)?\s*([\s\S]*?)```/gi
        );
        if (codeBlocks && codeBlocks.length > 0) {
          // Find the largest code block (most likely the full script)
          let largestBlock = "";
          for (const block of codeBlocks) {
            const content = block
              .replace(/```(?:javascript|typescript|js|ts)?/gi, "")
              .replace(/```/g, "")
              .trim();
            if (content.length > largestBlock.length) {
              largestBlock = content;
            }
          }
          if (largestBlock.length > 10) {
            scriptMatch = [largestBlock, largestBlock];
          }
        }
      }

      if (!scriptMatch) {
        throw new Error("Invalid AI response format - missing code block");
      }

      const fixedScript = scriptMatch[1].trim();

      const explanation = explanationMatch
        ? explanationMatch[1].trim()
        : "Script has been fixed to resolve the reported issues.";
      const aiConfidence = confidenceMatch
        ? parseFloat(confidenceMatch[1])
        : 0.7;

      if (!fixedScript || fixedScript.length < 10) {
        throw new Error("AI response contains insufficient code");
      }

      // Validate confidence score if provided
      if (
        aiConfidence !== undefined &&
        (aiConfidence < 0.1 || aiConfidence > 1.0)
      ) {
        console.warn(
          `AI provided invalid confidence score: ${aiConfidence}, using default`
        );
        return { fixedScript, explanation, aiConfidence: 0.7 };
      }

      return {
        fixedScript,
        explanation,
        aiConfidence,
      };
    } catch (error) {
      console.error(
        "AI Response parsing failed, raw response:",
        response.substring(0, 500)
      );
      throw new Error(
        `Failed to parse AI response: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private static async logAIUsage(usage: AIUsageLog): Promise<void> {
    // Log usage for monitoring and cost tracking
    const logEntry = {
      timestamp: new Date().toISOString(),
      service: "ai-fix",
      ...usage,
    };

    console.log("[AI Usage]", logEntry);

    // TODO: Implement proper logging to database/monitoring system
    // await logToDatabase(logEntry);
  }

  static async generateScriptFix({
    prompt,
    maxTokens = 2000,
    temperature = 0.1,
    testType,
    userId,
    orgId,
    tier,
  }: AIFixRequest): Promise<AIFixResponse> {
    // Note: maxTokens parameter is currently unused but kept for interface compatibility
    // We use the model's default token limits instead
    void maxTokens; // Explicitly mark as used to avoid linting warning
    const startTime = Date.now();

    try {
      // Step 1: Validate configuration before doing anything
      this.validateConfiguration();

      // Step 2: Check rate limits before making request
      await this.checkRateLimit(userId, orgId, tier);

      // Get universal service configuration
      const config = this.getServiceConfiguration();

      // Optimize prompt for universal compatibility
      const optimizedPrompt = this.optimizePrompt(prompt, testType);

      const { text, usage } = await generateText({
        model: this.getProviderModel(),
        prompt: optimizedPrompt,
        temperature: temperature || config.temperature,
        maxRetries: config.maxRetries,
        abortSignal: AbortSignal.timeout(config.timeout),
      });

      const duration = Date.now() - startTime;

      // Parse and validate AI response
      const parsedResponse = this.parseAIResponse(text);

      // Log successful usage
      const promptTokens =
        "promptTokens" in usage ? Number(usage.promptTokens) || 0 : 0;
      const completionTokens =
        "completionTokens" in usage ? Number(usage.completionTokens) || 0 : 0;
      const totalTokens =
        "totalTokens" in usage
          ? Number(usage.totalTokens) || 0
          : promptTokens + completionTokens;

      await this.logAIUsage({
        success: true,
        duration,
        tokensUsed: totalTokens,
        model: process.env.AI_MODEL || "gpt-4o-mini",
        testType,
      });

      return {
        ...parsedResponse,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
        },
        model: process.env.AI_MODEL || "gpt-4o-mini",
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Log failure metrics for monitoring
      await this.logAIUsage({
        success: false,
        duration,
        error: errorMessage,
        model: process.env.AI_MODEL || "gpt-4o-mini",
        testType,
      });

      // Map provider-specific errors to standardized Supercheck errors
      if (errorMessage.includes("401") || errorMessage.toLowerCase().includes("unauthorized") || errorMessage.toLowerCase().includes("invalid api key")) {
        throw new Error("AI_AUTH_ERROR: Invalid API credentials");
      }
      if (errorMessage.includes("429") || errorMessage.toLowerCase().includes("rate limit")) {
        throw new Error("AI_RATE_LIMIT: Provider rate limit exceeded");
      }
      if (errorMessage.toLowerCase().includes("timeout") || (error instanceof Error && error.name === "AbortError")) {
        throw new Error("AI_TIMEOUT: Request timed out");
      }

      // Re-throw with sanitized error message
      const sanitizedMessage = errorMessage.replace(/api[_\s]*key/gi, "[REDACTED]");
      throw new Error(`AI_FIX_ERROR: ${sanitizedMessage}`);
    }
  }

  // Health check method for monitoring
  static async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    details?: string;
  }> {
    try {
      const testPrompt = "Test prompt for health check";
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      await generateText({
        model: this.getProviderModel(),
        prompt: testPrompt,
        abortSignal: controller.signal,
      });

      clearTimeout(timeoutId);
      return { status: "healthy" };
    } catch (error) {
      return {
        status: "unhealthy",
        details: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
