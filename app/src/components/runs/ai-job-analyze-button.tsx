"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AIJobAnalyzeViewer } from "./ai-job-analyze-viewer";

interface AIJobAnalyzeButtonProps {
    runId: string;
    jobName: string;
    jobType: string;
    disabled?: boolean;
}

export function AIJobAnalyzeButton({
    runId,
    jobName,
    jobType,
    disabled = false,
}: AIJobAnalyzeButtonProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [isViewerOpen, setIsViewerOpen] = useState(false);
    const [analysisContent, setAnalysisContent] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);

    const handleAnalyze = async () => {
        setIsLoading(true);
        setAnalysisContent("");
        setIsStreaming(true);
        setIsViewerOpen(true);

        try {
            const response = await fetch("/api/ai/analyze-job", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    runId,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage =
                    errorData.message || `Request failed with status ${response.status}`;

                if (response.status === 401) {
                    toast.error("Authentication required. Please log in and try again.");
                } else if (response.status === 402) {
                    toast.error(errorData.message || "Subscription required for AI features.");
                } else if (response.status === 429) {
                    toast.error(errorData.message || "Too many requests. Please wait before trying again.");
                } else {
                    toast.error(errorMessage);
                }

                setIsViewerOpen(false);
                setIsLoading(false);
                setIsStreaming(false);
                return;
            }

            // Handle SSE streaming response
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error("No response body");
            }

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });

                // Process SSE events
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            if (data.type === "content") {
                                setAnalysisContent((prev) => prev + data.content);
                            } else if (data.type === "done") {
                                setIsStreaming(false);
                            } else if (data.type === "error") {
                                toast.error(data.error || "Analysis failed");
                                setIsStreaming(false);
                            }
                        } catch {
                            // Ignore parsing errors for incomplete chunks
                        }
                    }
                }
            }

            setIsLoading(false);
            setIsStreaming(false);
        } catch (error) {
            console.error("AI job analysis failed:", error);
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to generate AI analysis"
            );
            setIsViewerOpen(false);
            setIsLoading(false);
            setIsStreaming(false);
        }
    };

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                onClick={handleAnalyze}
                disabled={disabled || isLoading}
                className="h-9 px-3 flex items-center gap-2 shrink-0 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-purple-500/30 hover:border-purple-500/50 hover:from-purple-500/20 hover:to-pink-500/20"
            >
                {isLoading ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Analyzing...
                    </>
                ) : (
                    <>
                        <Sparkles className="h-4 w-4 text-purple-500" />
                        AI Analyze
                    </>
                )}
            </Button>

            {isViewerOpen && (
                <AIJobAnalyzeViewer
                    open={isViewerOpen}
                    onClose={() => {
                        setIsViewerOpen(false);
                        setAnalysisContent("");
                    }}
                    content={analysisContent}
                    isStreaming={isStreaming}
                    runId={runId}
                    jobName={jobName}
                    jobType={jobType}
                />
            )}
        </>
    );
}
