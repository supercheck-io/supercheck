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
  onStreamingUpdate,
}: AIFixButtonProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const parseAIResponse = (fullText: string): {
    script: string;
    explanation: string;
    confidence: number;
  } => {
    try {
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
        const codeBlocks = fullText.match(
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
        }
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
      console.error("Error parsing AI response:", error);
      // Return fallback values
      return {
        script: fullText,
        explanation: "Script has been fixed",
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
        const result = await response.json();

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

        throw new Error(result.message || "Failed to generate AI fix");
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      if (!reader) {
        throw new Error("No response body");
      }

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
              } else if (data.type === "error") {
                throw new Error(data.error);
              }
            } catch (parseError) {
              console.error("Error parsing SSE data:", parseError);
            }
          }
        }
      }

      // Parse the complete response
      const { script, explanation, confidence } = parseAIResponse(fullText);

      if (!script || script.length < 10) {
        throw new Error("AI generated invalid or empty fix");
      }

      toast.success("AI fix generated successfully", {
        description: `Confidence: ${Math.round(confidence * 100)}%`,
      });

      onAIFixSuccess(script, explanation, confidence);
    } catch (error) {
      console.error("AI fix request failed:", error);

      toast.error("AI fix service unavailable", {
        description:
          error instanceof Error
            ? error.message
            : "Please try again in a few moments or investigate manually.",
      });

      // Show fallback guidance
      onShowGuidance(
        "api_error",
        "The AI fix service is currently unavailable or cannot fix the issue. Please try again in a few moments or proceed with manual investigation."
      );
    } finally {
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
