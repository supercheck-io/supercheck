"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface AIFixButtonProps {
  testId: string;
  failedScript: string;
  testType: string;
  isVisible: boolean;
  onAIFixSuccess: (
    fixedScript: string,
    explanation: string,
    confidence: number
  ) => void;
  onShowGuidance: (
    reason: string,
    guidance: string,
    errorAnalysis?: { totalErrors?: number; categories?: string[] }
  ) => void;
  onAnalyzing?: (isAnalyzing: boolean) => void;
  onStreamingStart?: () => void;
  onStreamingUpdate?: (text: string) => void;
}

export function AIFixButton({
  testId,
  failedScript,
  testType,
  isVisible,
  onAIFixSuccess,
  onShowGuidance,
  onAnalyzing,
  onStreamingStart,
  onStreamingUpdate,
}: AIFixButtonProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const parseAIResponse = (fullText: string): {
    script: string;
    explanation: string;
    confidence: number;
  } => {
    try {
      console.log("Parsing AI Fix response, text length:", fullText.length);
      console.log("First 200 chars:", fullText.substring(0, 200));

      // Try to extract FIXED_SCRIPT, EXPLANATION, and CONFIDENCE sections
      const scriptMatch = fullText.match(
        /FIXED_SCRIPT:\s*```(?:javascript|typescript|js|ts)?\s*([\s\S]*?)```/i
      );
      const explanationMatch = fullText.match(
        /EXPLANATION:\s*([\s\S]*?)(?:CONFIDENCE:|$)/i
      );
      const confidenceMatch = fullText.match(/CONFIDENCE:\s*([\d.]+)/i);

      // If standard format fails, try to find any code block
      if (!scriptMatch) {
        console.log("Standard format not found, looking for code blocks...");
        const codeBlocks = fullText.match(
          /```(?:javascript|typescript|js|ts)?\s*([\s\S]*?)```/gi
        );
        if (codeBlocks && codeBlocks.length > 0) {
          console.log("Found", codeBlocks.length, "code blocks");
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

          console.log("Largest code block length:", largestBlock.length);

          const explanation = explanationMatch
            ? explanationMatch[1].trim()
            : "Script has been fixed to resolve the reported issues.";
          const confidence = confidenceMatch
            ? parseFloat(confidenceMatch[1])
            : 0.7;

          return {
            script: largestBlock,
            explanation,
            confidence,
          };
        } else {
          console.log("No code blocks found in response");
        }
      } else {
        console.log("Found script in standard format, length:", scriptMatch[1].trim().length);
      }

      const script = scriptMatch ? scriptMatch[1].trim() : "";
      const explanation = explanationMatch
        ? explanationMatch[1].trim()
        : "Script has been fixed to resolve the reported issues.";
      const confidence = confidenceMatch
        ? parseFloat(confidenceMatch[1])
        : 0.7;

      return {
        script,
        explanation,
        confidence,
      };
    } catch (error) {
      console.error("Error parsing AI Fix response:", error);
      console.error("Full text:", fullText);
      // Return empty to trigger error handling
      return {
        script: "",
        explanation: "Failed to parse AI response",
        confidence: 0.5,
      };
    }
  };

  const handleAIFix = async () => {
    if (!failedScript?.trim()) {
      toast.error("Cannot generate AI fix", {
        description: "A test script is required for AI analysis.",
      });
      return;
    }

    // Use provided testId or generate a playground ID
    const currentTestId = testId || `playground-${Date.now()}`;

    setIsProcessing(true);
    onAnalyzing?.(true);
    onStreamingStart?.(); // Notify parent that streaming has started

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      const response = await fetch("/api/ai/fix-test-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          failedScript: failedScript.trim(),
          testType,
          testId: currentTestId,
          executionContext: {
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
          },
        }),
      });

      if (!response.ok) {
        let result;
        try {
          result = await response.json();
        } catch {
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }

        // Handle non-streaming error responses
        switch (response.status) {
          case 401:
            toast.error("Authentication required", {
              description: "Please log in to use AI fix feature.",
            });
            return;
          case 429:
            toast.error("Rate limit exceeded", {
              description: "Please wait before making another AI fix request.",
            });
            return;
          case 400:
            if (result.reason === "security_violation") {
              toast.error("Security check failed", {
                description:
                  "Please ensure your test script follows security guidelines.",
              });
              return;
            } else if (result.reason === "not_fixable") {
              toast.info("Manual investigation required", {
                description: "AI analysis suggests this issue needs human attention.",
              });
              onShowGuidance(
                result.reason,
                result.guidance || "Manual investigation required.",
                result.errorAnalysis
              );
              return;
            }
            break;
          default:
            break;
        }

        throw new Error(result.message || `Failed to generate AI fix (${response.status})`);
      }

      // Handle streaming response
      reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      if (!reader) {
        throw new Error("No response body received from server");
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.type === "content") {
                  fullText += data.content;
                  onStreamingUpdate?.(fullText);
                } else if (data.type === "done") {
                  // Streaming complete
                  console.log("AI Fix completed:", data);
                  console.log("Total text received:", fullText.length, "characters");
                } else if (data.type === "error") {
                  console.error("Stream error:", data.error);
                  throw new Error(data.error || "AI fix generation error");
                }
              } catch (parseError) {
                // Only log if it's not a JSON parse error (empty lines are expected in SSE)
                if (parseError instanceof SyntaxError && line.trim() === "") {
                  continue;
                }
                console.error("Error parsing SSE data:", parseError, "Line:", line);
              }
            }
          }
        }
      } finally {
        // Always release the reader
        reader.releaseLock();
        reader = null;
      }

      // Check if we received any content
      if (!fullText || fullText.trim().length === 0) {
        throw new Error("No output generated from AI. Please try again.");
      }

      // Parse the complete response
      const { script, explanation, confidence } = parseAIResponse(fullText);

      if (!script || script.length < 10) {
        console.error("Parsing failed. Full text received:", fullText);
        throw new Error(
          `AI generated invalid or empty fix. Received ${fullText.length} characters but could not extract valid code. The issue may require manual investigation.`
        );
      }

      console.log("Successfully parsed fix script, length:", script.length);

      toast.success("AI fix generated successfully", {
        description: `Confidence: ${Math.round(confidence * 100)}%`,
      });

      onAIFixSuccess(script, explanation, confidence);
    } catch (error) {
      console.error("AI fix request failed:", error);

      // Provide specific error messages
      let errorDescription = "Please try again in a few moments or investigate manually.";
      if (error instanceof Error) {
        if (error.message.includes("network") || error.message.includes("fetch")) {
          errorDescription = "Network connection error. Please check your connection and try again.";
        } else if (error.message.includes("timeout")) {
          errorDescription = "Request timed out. Please try again.";
        } else if (error.message.includes("No output generated")) {
          errorDescription = "AI did not generate any output. Please try again.";
        } else if (error.message.includes("manual investigation") || error.message.includes("invalid or empty fix")) {
          errorDescription = error.message;
        } else {
          errorDescription = error.message;
        }
      }

      console.error("AI Fix final error:", errorDescription);

      toast.error("AI fix service unavailable", {
        description: errorDescription,
        duration: 5000,
      });

      // Show fallback guidance
      onShowGuidance(
        "api_error",
        "The AI fix service is currently unavailable or cannot fix the issue. Please try again in a few moments or proceed with manual investigation."
      );
    } finally {
      // Cleanup: release reader if still locked
      if (reader) {
        try {
          reader.releaseLock();
        } catch {
          // Ignore errors during cleanup
        }
      }
      setIsProcessing(false);
      onAnalyzing?.(false);
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <Button
      size="sm"
      onClick={handleAIFix}
      disabled={isProcessing || !failedScript?.trim()}
      className="flex items-center gap-2 mr-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0 shadow-lg transition-all duration-200"
    >
      {isProcessing ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Analyzing...
        </>
      ) : (
        <>
          <Sparkles className="h-4 w-4" />
          AI Fix
        </>
      )}
    </Button>
  );
}
