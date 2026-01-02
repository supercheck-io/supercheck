import { openai } from "@ai-sdk/openai";
import { azure } from "@ai-sdk/azure";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { vertex } from "@ai-sdk/google-vertex";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { streamText, LanguageModel } from "ai";
import { aiRateLimiter } from "./ai-rate-limiter";
import { aiCodeValidator } from "./ai-code-validator";
import { getRedisConnection } from "@/lib/queue";

// Idempotency key configuration
const IDEMPOTENCY_KEY_PREFIX = "supercheck:ai:idempotency";

interface AIStreamRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  testType?: string;
  // Optional rate limit context
  userId?: string;
  orgId?: string;
  tier?: string;
  // Idempotency key to prevent duplicate requests
  idempotencyKey?: string;
}

interface AIStreamResponse {
  stream: ReadableStream;
  model: string;
  cached?: boolean; // True if returned from idempotency cache
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

export class AIStreamingService {
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
          console.warn("[AI Streaming Service] Warning: Anthropic API key does not follow expected format (sk-ant-*)");
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
        if (!apiKey.startsWith("sk-")) {
          console.warn("[AI Streaming Service] Warning: API key does not follow expected OpenAI format (sk-*)");
        }
        break;
      }
    }
  }

  /**
   * Factory method that returns the appropriate AI model based on AI_PROVIDER env var.
   * Supports: OpenAI, Azure OpenAI, Anthropic, Gemini (Google AI Studio), Google Vertex AI, AWS Bedrock, OpenRouter.
   * Falls back to OpenAI gpt-4o-mini on any initialization error.
   */
  private static getProviderModel(): LanguageModel {
    const provider = (process.env.AI_PROVIDER || "openai").toLowerCase() as AIProvider;
    const modelName = process.env.AI_MODEL;

    try {
      switch (provider) {
        case "azure": {
          const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || modelName || "gpt-4o-mini";
          console.log(`[AI Streaming Service] Initializing Azure OpenAI with deployment: ${deployment}`);
          return azure(deployment) as unknown as LanguageModel;
        }

        case "anthropic": {
          const model = modelName || "claude-3-5-haiku-20241022";
          console.log(`[AI Streaming Service] Initializing Anthropic with model: ${model}`);
          return anthropic(model) as unknown as LanguageModel;
        }

        case "gemini": {
          // Google AI Studio - simple API key like OpenAI
          const model = modelName || "gemini-2.0-flash";
          console.log(`[AI Streaming Service] Initializing Google AI (Gemini) with model: ${model}`);
          return google(model) as unknown as LanguageModel;
        }

        case "google-vertex": {
          // Google Vertex AI - enterprise GCP setup
          const model = modelName || "gemini-2.0-flash";
          console.log(`[AI Streaming Service] Initializing Google Vertex AI with model: ${model}`);
          return vertex(model) as unknown as LanguageModel;
        }

        case "bedrock": {
          const bedrock = createAmazonBedrock({
            region: process.env.BEDROCK_AWS_REGION || "us-east-1",
            accessKeyId: process.env.BEDROCK_AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.BEDROCK_AWS_SECRET_ACCESS_KEY,
            sessionToken: process.env.BEDROCK_AWS_SESSION_TOKEN,
          });
          const model = modelName || "anthropic.claude-3-5-haiku-20241022-v1:0";
          console.log(`[AI Streaming Service] Initializing AWS Bedrock with model: ${model}`);
          return bedrock(model) as unknown as LanguageModel;
        }

        case "openrouter": {
          // OpenRouter - unified gateway to 400+ models
          const openrouter = createOpenRouter({
            apiKey: process.env.OPENROUTER_API_KEY!,
          });
          const model = modelName || "anthropic/claude-3.5-haiku";
          console.log(`[AI Streaming Service] Initializing OpenRouter with model: ${model}`);
          return openrouter(model) as unknown as LanguageModel;
        }

        case "openai":
        default: {
          const model = modelName || "gpt-4o-mini";
          if (provider !== "openai") {
            console.warn(`[AI Streaming Service] Unknown provider '${provider}', falling back to OpenAI`);
          }
          console.log(`[AI Streaming Service] Initializing OpenAI with model: ${model}`);
          return openai(model) as unknown as LanguageModel;
        }
      }
    } catch (error) {
      console.error(`[AI Streaming Service] Error initializing ${provider}:`, error);
      console.log("[AI Streaming Service] Falling back to OpenAI gpt-4o-mini");
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
      console.warn(
        "[AI Streaming Service] Invalid timeout, using default 90000ms"
      );
    }
    if (isNaN(maxRetries) || maxRetries < 1 || maxRetries > 5) {
      console.warn(
        "[AI Streaming Service] Invalid maxRetries, using default 2"
      );
    }
    if (isNaN(temperature) || temperature < 0 || temperature > 2) {
      console.warn(
        "[AI Streaming Service] Invalid temperature, using default 0.1"
      );
    }

    return {
      maxRetries: Math.max(1, Math.min(maxRetries, 5)), // Between 1-5
      temperature: Math.max(0, Math.min(temperature, 2)), // Between 0-2
      timeout: Math.min(Math.max(baseTimeout, 10000), 120000), // Between 10-120 seconds for all OpenAI models
    };
  }

  private static async logAIUsage(usage: AIUsageLog): Promise<void> {
    // Log usage for monitoring and cost tracking
    const logEntry = {
      timestamp: new Date().toISOString(),
      service: "ai-streaming",
      ...usage,
    };

    console.log("[AI Streaming Usage]", logEntry);

    // TODO: Implement proper logging to database/monitoring system
    // await logToDatabase(logEntry);
  }

  /**
   * Generate streaming AI response
   * Returns a ReadableStream that can be consumed by the client
   */
  static async generateStreamingResponse({
    prompt,
    maxTokens = 4000,
    temperature = 0.1,
    testType,
    userId,
    orgId,
    tier,
    idempotencyKey,
  }: AIStreamRequest): Promise<AIStreamResponse> {
    const startTime = Date.now();

    try {
      // Step 0: Check idempotency key if provided
      if (idempotencyKey) {
        try {
          const redis = await getRedisConnection();
          const cacheKey = `${IDEMPOTENCY_KEY_PREFIX}:${idempotencyKey}`;
          const cached = await redis.get(cacheKey);
          
          if (cached) {
            console.log(`[AI Streaming Service] Returning cached result for idempotency key: ${idempotencyKey.slice(0, 8)}...`);
            // Create a stream from cached content
            const cachedStream = new ReadableStream({
              start(controller) {
                const data = JSON.stringify({ type: "content", content: cached });
                controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
                const doneData = JSON.stringify({ type: "done", cached: true });
                controller.enqueue(new TextEncoder().encode(`data: ${doneData}\n\n`));
                controller.close();
              },
            });
            return {
              stream: cachedStream,
              model: process.env.AI_MODEL || "gpt-4o-mini",
              cached: true,
            };
          }
        } catch (redisError) {
          // Redis failure should not block the request
          console.warn("[AI Streaming Service] Idempotency check failed, proceeding with request:", redisError);
        }
      }

      // Step 1: Validate configuration (API key, etc.)
      this.validateConfiguration();

      // Step 2: Security: Check rate limits before making request
      await this.checkRateLimit(userId, orgId, tier);

      // Step 3: Get universal service configuration
      const config = this.getServiceConfiguration();

      console.log(
        `[AI Streaming Service] Starting stream generation with model: ${process.env.AI_MODEL || "gpt-4o-mini"}`
      );
      console.log(
        `[AI Streaming Service] Prompt length: ${prompt.length} characters`
      );
      console.log(
        `[AI Streaming Service] Config: maxTokens=${maxTokens}, temperature=${temperature || config.temperature}, timeout=${config.timeout}ms`
      );


      // Step 4: Create streaming response
      const result = await streamText({
        model: this.getProviderModel(),
        prompt,
        temperature: temperature || config.temperature,
        maxRetries: config.maxRetries,
        abortSignal: AbortSignal.timeout(config.timeout),
        maxOutputTokens: maxTokens,
      });

      // Capture the idempotency key and cache key for use in the stream callback
      const cacheIdempotencyKey = idempotencyKey;
      const CACHE_TTL_SECONDS = 300; // 5 minutes

      // Create a custom readable stream that handles the AI response
      const stream = new ReadableStream({
        async start(controller) {
          try {
            let totalTokens = 0;
            let chunkCount = 0;
            let totalContentLength = 0;
            const collectedContent: string[] = []; // Collect content for idempotency caching

            console.log(
              "[AI Streaming Service] Starting to consume text stream..."
            );

            // Stream the text chunks
            for await (const chunk of result.textStream) {
              chunkCount++;
              totalContentLength += chunk.length;
              collectedContent.push(chunk); // Collect for idempotency caching

              // Security: Validate chunk for critical security patterns
              const validation = aiCodeValidator.quickValidate(chunk);
              if (validation.hasIssues) {
                console.warn(
                  "[AI Streaming Service] Security concern in chunk:",
                  validation.issues
                );
                // Log but don't block - full validation happens on final code acceptance
                // Critical issues will be caught in sanitizeCodeOutput before user accepts
              }

              const data = JSON.stringify({
                type: "content",
                content: chunk,
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));

              // Log progress every 10 chunks
              if (chunkCount % 10 === 0) {
                console.log(
                  `[AI Streaming Service] Streamed ${chunkCount} chunks, ${totalContentLength} characters so far`
                );
              }
            }

            console.log(
              `[AI Streaming Service] Stream complete. Total chunks: ${chunkCount}, Total content: ${totalContentLength} characters`
            );

            // Check if we got any content
            if (chunkCount === 0 || totalContentLength === 0) {
              console.error(
                "[AI Streaming Service] WARNING: No content was generated by the AI model"
              );
              throw new Error(
                "AI model generated no content. This may indicate an issue with the prompt or API configuration."
              );
            }

            // Get usage information after streaming completes
            const usage = await result.usage;
            // AI SDK v6 LanguageModelUsage type - safely extract token counts
            const usageData = usage as unknown as { 
              promptTokens?: number; 
              completionTokens?: number; 
              totalTokens?: number;
            } | undefined;
            const promptTokens = usageData?.promptTokens ?? 0;
            const completionTokens = usageData?.completionTokens ?? 0;
            totalTokens = usageData?.totalTokens ?? (promptTokens + completionTokens);

            // Send completion message with metadata
            const duration = Date.now() - startTime;
            const completionData = JSON.stringify({
              type: "done",
              usage: {
                promptTokens,
                completionTokens,
                totalTokens,
              },
              model: process.env.AI_MODEL || "gpt-4o-mini",
              duration,
            });
            controller.enqueue(
              new TextEncoder().encode(`data: ${completionData}\n\n`)
            );

            console.log(
              `[AI Streaming Service] Generation successful in ${duration}ms. Tokens: ${totalTokens}`
            );

            // Log successful usage
            await AIStreamingService.logAIUsage({
              success: true,
              duration,
              tokensUsed: totalTokens,
              model: process.env.AI_MODEL || "gpt-4o-mini",
              testType,
            });

            // Store in idempotency cache if key was provided
            if (cacheIdempotencyKey && collectedContent.length > 0) {
              try {
                const redis = await getRedisConnection();
                const cacheKey = `${IDEMPOTENCY_KEY_PREFIX}:${cacheIdempotencyKey}`;
                const fullContent = collectedContent.join('');
                await redis.set(cacheKey, fullContent, 'EX', CACHE_TTL_SECONDS);
                console.log(`[AI Streaming Service] Cached result for idempotency key: ${cacheIdempotencyKey.slice(0, 8)}... (TTL: ${CACHE_TTL_SECONDS}s)`);
              } catch (cacheError) {
                // Cache failure should not affect the response
                console.warn('[AI Streaming Service] Failed to cache idempotency result:', cacheError);
              }
            }

            controller.close();
          } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage =
              error instanceof Error
                ? error.message
                : "Unknown streaming error";

            console.error("[AI Streaming Service] Stream error:", errorMessage);
            console.error("[AI Streaming Service] Full error:", error);

            // Log failure metrics
            await AIStreamingService.logAIUsage({
              success: false,
              duration,
              error: errorMessage,
              model: process.env.AI_MODEL || "gpt-4o-mini",
              testType,
            });

            // Send error event to client
            const errorData = JSON.stringify({
              type: "error",
              error: errorMessage,
            });
            controller.enqueue(
              new TextEncoder().encode(`data: ${errorData}\n\n`)
            );
            controller.close();
          }
        },
      });

      return {
        stream,
        model: process.env.AI_MODEL || "gpt-4o-mini",
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      console.error(
        "[AI Streaming Service] Failed to initialize streaming:",
        errorMessage
      );
      console.error("[AI Streaming Service] Full error:", error);

      // Log failure metrics for monitoring
      await this.logAIUsage({
        success: false,
        duration,
        error: errorMessage,
        model: process.env.AI_MODEL || "gpt-4o-mini",
        testType,
      });

      // Map provider-specific errors to standardized Supercheck errors
      if (
        errorMessage.includes("API key") ||
        errorMessage.toLowerCase().includes("not configured") ||
        errorMessage.toLowerCase().includes("invalid api key")
      ) {
        throw new Error("AI_AUTH_ERROR: AI provider credentials are not configured. Please check your environment variables.");
      }

      if (
        errorMessage.includes("401") ||
        errorMessage.toLowerCase().includes("unauthorized")
      ) {
        throw new Error("AI_AUTH_ERROR: Invalid API credentials");
      }

      if (errorMessage.includes("429") || errorMessage.toLowerCase().includes("rate limit")) {
        throw new Error("AI_RATE_LIMIT: Provider rate limit exceeded");
      }

      if (
        errorMessage.toLowerCase().includes("timeout") ||
        errorMessage.toLowerCase().includes("timed out") ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new Error("AI_TIMEOUT: Request timed out");
      }

      // Re-throw with sanitized error message for other errors
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

      const result = await streamText({
        model: this.getProviderModel(),
        prompt: testPrompt,
        abortSignal: controller.signal,
      });

      // Consume the stream to complete the health check
      for await (const chunk of result.textStream) {
        void chunk; // consume the first chunk for a quick health check
        break;
      }

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
