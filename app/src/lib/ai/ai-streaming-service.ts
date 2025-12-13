import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
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

export class AIStreamingService {
  private static validateConfiguration(): void {
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

    // Validate API key format (should start with sk- for OpenAI)
    if (!apiKey.startsWith("sk-")) {
      console.warn(
        "[AI Streaming Service] Warning: API key does not follow expected OpenAI format (sk-*)"
      );
    }
  }

  private static getModel() {
    const modelName = process.env.AI_MODEL || "gpt-4o-mini";

    try {
      return openai(modelName);
    } catch (error) {
      console.error(
        "[AI Streaming Service] Error initializing OpenAI model:",
        error
      );
      // Fallback to default model
      return openai("gpt-4o-mini");
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
        model: this.getModel(),
        prompt,
        temperature: temperature || config.temperature,
        maxRetries: config.maxRetries,
        abortSignal: AbortSignal.timeout(config.timeout),
        maxOutputTokens: maxTokens,
      });

      // Create a custom readable stream that handles the AI response
      const stream = new ReadableStream({
        async start(controller) {
          try {
            let totalTokens = 0;
            let chunkCount = 0;
            let totalContentLength = 0;

            console.log(
              "[AI Streaming Service] Starting to consume text stream..."
            );

            // Stream the text chunks
            for await (const chunk of result.textStream) {
              chunkCount++;
              totalContentLength += chunk.length;

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
            // LanguageModelV2Usage may not expose prompt/completion tokens; fall back to input/output
            const promptTokens =
              "promptTokens" in (usage || {})
                ? (usage as Record<string, number>).promptTokens
                : "inputTokens" in (usage || {})
                  ? (usage as Record<string, number>).inputTokens
                  : 0;
            const completionTokens =
              "completionTokens" in (usage || {})
                ? (usage as Record<string, number>).completionTokens
                : "outputTokens" in (usage || {})
                  ? (usage as Record<string, number>).outputTokens
                  : 0;
            totalTokens =
              "totalTokens" in (usage || {})
                ? (usage as Record<string, number>).totalTokens
                : promptTokens + completionTokens;

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

      // Provide specific error messages based on error type
      if (
        errorMessage.includes("API key") ||
        errorMessage.includes("OPENAI_API_KEY")
      ) {
        throw new Error(
          "OpenAI API key is not configured. Please configure OPENAI_API_KEY environment variable with a valid API key to use AI features."
        );
      }

      if (
        errorMessage.includes("401") ||
        errorMessage.includes("Unauthorized")
      ) {
        throw new Error(
          "OpenAI API authentication failed. Please check that your OPENAI_API_KEY is valid and has not expired."
        );
      }

      if (errorMessage.includes("429") || errorMessage.includes("rate limit")) {
        throw new Error(
          "OpenAI API rate limit exceeded. Please wait a moment before trying again."
        );
      }

      if (
        errorMessage.includes("timeout") ||
        errorMessage.includes("timed out")
      ) {
        throw new Error(
          "AI request timed out. The request may be too complex or the service may be experiencing high load. Please try again."
        );
      }

      // Re-throw with sanitized error message for other errors
      const sanitizedMessage = errorMessage.replace(
        /api[_\s]*key/gi,
        "[REDACTED]"
      );

      throw new Error(`AI streaming generation failed: ${sanitizedMessage}`);
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
        model: this.getModel(),
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
