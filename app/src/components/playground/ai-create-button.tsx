"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Wand2, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface AICreateButtonProps {
  currentScript: string;
  testType: string;
  isVisible: boolean;
  disabled?: boolean;
  onAICreateSuccess: (
    generatedScript: string,
    explanation: string
  ) => void;
  onAnalyzing?: (isAnalyzing: boolean) => void;
  onStreamingStart?: () => void;
  onStreamingUpdate?: (text: string) => void;
  onStreamingEnd?: () => void;
}

export function AICreateButton({
  currentScript,
  testType,
  isVisible,
  disabled,
  onAICreateSuccess,
  onAnalyzing,
  onStreamingStart,
  onStreamingUpdate,
  onStreamingEnd,
}: AICreateButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [userRequest, setUserRequest] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
    setUserRequest("");
  };

  const handleCloseDialog = () => {
    if (!isProcessing) {
      setIsDialogOpen(false);
      setUserRequest("");
    }
  };

  const parseAIResponse = (fullText: string): {
    script: string;
    explanation: string;
  } => {
    try {
      // Try to extract GENERATED_SCRIPT and EXPLANATION sections
      const scriptMatch = fullText.match(
        /GENERATED_SCRIPT:\s*```(?:javascript|typescript|js|ts)?\s*([\s\S]*?)```/i
      );
      const explanationMatch = fullText.match(
        /EXPLANATION:\s*([\s\S]*?)(?:$)/i
      );

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
            : "AI-generated test code based on your request.";

          return {
            script: largestBlock,
            explanation,
          };
        }
      }

      const script = scriptMatch ? scriptMatch[1].trim() : "";
      const explanation = explanationMatch
        ? explanationMatch[1].trim()
        : "AI-generated test code based on your request.";

      return {
        script,
        explanation,
      };
    } catch {
      // Return empty to trigger error handling
      return {
        script: "",
        explanation: "Failed to parse AI response",
      };
    }
  };

  const handleGenerate = async () => {
    if (!userRequest.trim()) {
      toast.error("Please describe what you want", {
        description: "Enter a description of the test you want to create.",
      });
      return;
    }

    if (userRequest.trim().length < 10) {
      toast.error("Description too short", {
        description: "Please provide a more detailed description (at least 10 characters).",
      });
      return;
    }

    setIsProcessing(true);
    onAnalyzing?.(true);
    onStreamingStart?.(); // Notify parent that streaming has started

    let reader: ReadableStreamDefaultReader<Uint8Array> | null | undefined = null;

    try {
      const response = await fetch("/api/ai/create-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userRequest: userRequest.trim(),
          testType,
          currentScript: currentScript || "",
        }),
      });

      if (!response.ok) {
        let result;
        try {
          result = await response.json();
        } catch {
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }

        switch (response.status) {
          case 401:
            toast.error("Authentication required", {
              description: "Please log in to use AI create feature.",
            });
            return;
          case 429:
            toast.error("Rate limit exceeded", {
              description: "Please wait before making another AI create request.",
            });
            return;
          case 400:
            toast.error("Invalid request", {
              description: result.message || "Please check your input and try again.",
            });
            return;
          default:
            throw new Error(result.message || `Failed to generate test code (${response.status})`);
        }
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
                  onStreamingUpdate?.(fullText); // Update parent with streaming content
                } else if (data.type === "done") {
                  // Streaming complete
                  onStreamingEnd?.();
                } else if (data.type === "error") {
                  throw new Error(data.error || "AI generation error");
                }
              } catch (parseError) {
                // Only skip if it's a JSON parse error (empty lines are expected in SSE)
                if (parseError instanceof SyntaxError && line.trim() === "") {
                  continue;
                }
                // Silently ignore parsing errors
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
      const { script, explanation } = parseAIResponse(fullText);

      if (!script || script.length < 10) {
        throw new Error(
          `AI generated invalid or empty code. Received ${fullText.length} characters but could not extract valid code. Please try again with a more detailed description.`
        );
      }

      toast.success("Test code generated successfully", {
        description: "Review and apply the generated code to your editor.",
      });

      onAICreateSuccess(script, explanation);
      setIsDialogOpen(false);
      setUserRequest("");
    } catch (error) {
      // Provide specific error messages
      let errorDescription = "Please try again in a few moments.";
      if (error instanceof Error) {
        if (error.message.includes("network") || error.message.includes("fetch")) {
          errorDescription = "Network connection error. Please check your connection and try again.";
        } else if (error.message.includes("timeout")) {
          errorDescription = "Request timed out. Please try again.";
        } else if (error.message.includes("No output generated")) {
          errorDescription = "AI did not generate any output. Please try again or rephrase your request.";
        } else if (error.message.includes("invalid or empty code")) {
          errorDescription = error.message;
        } else {
          errorDescription = error.message;
        }
      }

      toast.error("AI create service unavailable", {
        description: errorDescription,
        duration: 5000,
      });
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
    <>
      <Button
        size="sm"
        onClick={handleOpenDialog}
        disabled={disabled || isProcessing}
        className="flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0 shadow-lg transition-all duration-200"
      >
        <Wand2 className="h-4 w-4" />
        AI Create
      </Button>

      <Dialog open={isDialogOpen} onOpenChange={handleCloseDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-purple-500" />
              AI Create Test
            </DialogTitle>
            <DialogDescription>
              Describe what you want to test, and AI will generate a complete test script for you.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="user-request" className="text-sm font-medium">
                What do you want to test?
              </label>
              <Textarea
                id="user-request"
                placeholder={`Example: "Create a test that logs into the application, navigates to the user profile page, and verifies the user's email is displayed correctly"`}
                value={userRequest}
                onChange={(e) => setUserRequest(e.target.value)}
                disabled={isProcessing}
                className="min-h-[120px] resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Be specific about the actions, verifications, and expected outcomes.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCloseDialog}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={isProcessing || !userRequest.trim()}
              className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Generating...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Generate
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
