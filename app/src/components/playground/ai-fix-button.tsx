"use client";

import { useEffect, useRef, useState } from "react";
import { readAiStream } from "./read-ai-stream";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface AIFixButtonProps {
  testId: string;
  failedScript: string;
  testType: string;
  isVisible: boolean;
  disabled?: boolean;
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
  onStreamingEnd?: () => void;
}

export function AIFixButton({
  testId,
  failedScript,
  testType,
  isVisible,
  disabled,
  onAIFixSuccess,
  onShowGuidance,
  onAnalyzing,
  onStreamingStart,
  onStreamingUpdate,
  onStreamingEnd,
}: AIFixButtonProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Abort the in-flight request on unmount so the server stops generating.
  useEffect(() => () => abortRef.current?.abort(), []);

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
    } catch {
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

    let hasStreamingStarted = false;
    let hasStreamingEnded = false;

    const endStreamingSafely = () => {
      if (hasStreamingStarted && !hasStreamingEnded) {
        onStreamingEnd?.();
        hasStreamingEnded = true;
      }
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/ai/fix-test-stream", {
        method: "POST",
        signal: controller.signal,
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
          case 402:
            toast.error("Subscription required", {
              description: "An active subscription is required to use AI fix.",
            });
            return;
          case 429:
            if (result.reason === "ai_credits_exhausted") {
              toast.error("AI credits exhausted", {
                description: "You have used all your AI credits for this period.",
              });
              return;
            }
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
            } else if (result.reason === "report_not_available") {
              toast.info("Report not ready yet", {
                description: "Wait for the run's report to finish uploading, then try AI Fix again.",
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

      // Open the diff viewer only once the server has accepted the request,
      // so an error response never leaves an empty "improved" dialog behind.
      onStreamingStart?.();
      hasStreamingStarted = true;

      const fullText = await readAiStream(response, onStreamingUpdate);
      endStreamingSafely();

      // Check if we received any content
      if (!fullText || fullText.trim().length === 0) {
        throw new Error("No output generated from AI. Please try again.");
      }

      // Parse the complete response
      const { script, explanation, confidence } = parseAIResponse(fullText);

      if (!script || script.length < 10) {
        throw new Error(
          `AI generated invalid or empty fix. Received ${fullText.length} characters but could not extract valid code. The issue may require manual investigation.`
        );
      }

      toast.success("AI fix generated successfully", {
        description: `Confidence: ${Math.round(confidence * 100)}%`,
      });

      onAIFixSuccess(script, explanation, confidence);
    } catch (error) {
      endStreamingSafely();
      if (controller.signal.aborted) return; // unmounted

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
      endStreamingSafely();
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
      disabled={disabled || isProcessing || !failedScript?.trim()}
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
