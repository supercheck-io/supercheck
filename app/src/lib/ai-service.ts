import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

interface AIFixRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  testType?: "browser" | "api" | "custom" | "database";
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

export class AIFixService {
  private static getModel() {
    const modelName = process.env.AI_MODEL || "gpt-4o-mini";

    try {
      return openai(modelName);
    } catch (error) {
      console.error("[AI Service] Error initializing OpenAI model:", error);
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
  }: AIFixRequest): Promise<AIFixResponse> {
    // Note: maxTokens parameter is currently unused but kept for interface compatibility
    // We use the model's default token limits instead
    void maxTokens; // Explicitly mark as used to avoid linting warning
    const startTime = Date.now();

    try {
      // Security: Check rate limits before making request
      await this.checkRateLimit();

      // Get universal service configuration
      const config = this.getServiceConfiguration();

      // Optimize prompt for universal compatibility
      const optimizedPrompt = this.optimizePrompt(prompt, testType);

      const { text, usage } = await generateText({
        model: this.getModel(),
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
          : "AI service temporarily unavailable";

      throw new Error(`AI fix generation failed: ${sanitizedMessage}`);
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
        model: this.getModel(),
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
