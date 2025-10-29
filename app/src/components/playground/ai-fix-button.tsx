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
}

export function AIFixButton({
  testId,
  failedScript,
  testType,
  isVisible,
  onAIFixSuccess,
  onShowGuidance,
  onAnalyzing,
}: AIFixButtonProps) {
  const [isProcessing, setIsProcessing] = useState(false);

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
      const response = await fetch("/api/ai/fix-test", {
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

      const result = await response.json();

      if (!response.ok) {
        // Handle different error types with appropriate user messaging
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
            }
            break;
          default:
            break;
        }
      }

      if (result.success) {
        // AI successfully generated a fix
        toast.success("AI fix generated successfully", {
          description: `Confidence: ${Math.round(
            (result.confidence || 0.5) * 100
          )}%`,
        });

        onAIFixSuccess(
          result.fixedScript,
          result.explanation,
          result.confidence || 0.5
        );
      } else {
        // AI determined the issue is not fixable
        const reason = result.reason || "unknown";
        const guidance = result.guidance || "Manual investigation required.";

        toast.info("Manual investigation required", {
          description: "AI analysis suggests this issue needs human attention.",
        });

        onShowGuidance(reason, guidance, result.errorAnalysis);
      }
    } catch (error) {
      console.error("AI fix request failed:", error);

      toast.error("AI fix service unavailable", {
        description:
          "Please try again in a few moments or investigate manually.",
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
