import { openai } from "@ai-sdk/openai";
import { streamText, StreamTextResult } from "ai";

interface AIStreamRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  testType?: string;
}

interface AIStreamResponse {
  stream: ReadableStream;
  model: string;
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
  private static getModel() {
    const modelName = process.env.AI_MODEL || "gpt-4o-mini";

    try {
      return openai(modelName);
    } catch (error) {
      console.error("[AI Streaming Service] Error initializing OpenAI model:", error);
      // Fallback to default model
      return openai("gpt-4o-mini");
    }
  }

  private static async checkRateLimit(): Promise<void> {
    // Rate limiting check - placeholder for Redis implementation
  }

  private static getServiceConfiguration() {
    // Configuration optimized for OpenAI models including newer ones like GPT-5
    const baseTimeout = parseInt(process.env.AI_TIMEOUT_MS || "90000"); // Increased default to 90 seconds
    const maxRetries = parseInt(process.env.AI_MAX_RETRIES || "2");
    const temperature = parseFloat(process.env.AI_TEMPERATURE || "0.1");

    // Validate configuration values
    if (isNaN(baseTimeout) || baseTimeout < 10000) {
      console.warn("[AI Streaming Service] Invalid timeout, using default 90000ms");
    }
    if (isNaN(maxRetries) || maxRetries < 1 || maxRetries > 5) {
      console.warn("[AI Streaming Service] Invalid maxRetries, using default 2");
    }
    if (isNaN(temperature) || temperature < 0 || temperature > 2) {
      console.warn("[AI Streaming Service] Invalid temperature, using default 0.1");
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
  }: AIStreamRequest): Promise<AIStreamResponse> {
    const startTime = Date.now();

    try {
      // Security: Check rate limits before making request
      await this.checkRateLimit();

      // Get universal service configuration
      const config = this.getServiceConfiguration();

      // Create streaming response
      const result: StreamTextResult<Record<string, never>> = await streamText({
        model: this.getModel(),
        prompt,
        temperature: temperature || config.temperature,
        maxRetries: config.maxRetries,
        abortSignal: AbortSignal.timeout(config.timeout),
        maxTokens,
      });

      // Create a custom readable stream that handles the AI response
      const stream = new ReadableStream({
        async start(controller) {
          try {
            let totalTokens = 0;

            // Stream the text chunks
            for await (const chunk of result.textStream) {
              const data = JSON.stringify({
                type: 'content',
                content: chunk
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
            }

            // Get usage information after streaming completes
            const usage = await result.usage;
            const promptTokens = usage?.promptTokens || 0;
            const completionTokens = usage?.completionTokens || 0;
            totalTokens = usage?.totalTokens || promptTokens + completionTokens;

            // Send completion message with metadata
            const duration = Date.now() - startTime;
            const completionData = JSON.stringify({
              type: 'done',
              usage: {
                promptTokens,
                completionTokens,
                totalTokens,
              },
              model: process.env.AI_MODEL || "gpt-4o-mini",
              duration,
            });
            controller.enqueue(new TextEncoder().encode(`data: ${completionData}\n\n`));

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

            // Log failure metrics
            await AIStreamingService.logAIUsage({
              success: false,
              duration,
              error: error instanceof Error ? error.message : "Unknown error",
              model: process.env.AI_MODEL || "gpt-4o-mini",
              testType,
            });

            const errorData = JSON.stringify({
              type: 'error',
              error: error instanceof Error ? error.message : "Streaming error occurred",
            });
            controller.enqueue(new TextEncoder().encode(`data: ${errorData}\n\n`));
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

      // Log failure metrics for monitoring
      await this.logAIUsage({
        success: false,
        duration,
        error: error instanceof Error ? error.message : "Unknown error",
        model: process.env.AI_MODEL || "gpt-4o-mini",
        testType,
      });

      // Re-throw with sanitized error message
      const sanitizedMessage =
        error instanceof Error
          ? error.message.replace(/api[_\s]*key/gi, "[REDACTED]")
          : "AI streaming service temporarily unavailable";

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
      for await (const _ of result.textStream) {
        // Just consume the stream
        break; // Exit after first chunk for quick health check
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
