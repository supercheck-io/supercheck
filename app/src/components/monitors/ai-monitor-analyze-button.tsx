"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AIMonitorAnalyzeViewer } from "./ai-monitor-analyze-viewer";

interface AIMonitorAnalyzeButtonProps {
    monitorId: string;
    monitorName: string;
    monitorType: string;
    disabled?: boolean;
}

export function AIMonitorAnalyzeButton({
    monitorId,
    monitorName,
    monitorType,
    disabled = false,
}: AIMonitorAnalyzeButtonProps) {
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
            const response = await fetch("/api/ai/analyze-monitor", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    monitorId,
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
            console.error("AI monitor analysis failed:", error);
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
                className="flex items-center gap-2 shrink-0"
                aria-label={isLoading ? "Analyzing" : "AI Analyze"}
                title="AI Analyze"
            >
                {isLoading ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="hidden 2xl:inline">Analyzing...</span>
                    </>
                ) : (
                    <>
                        <Sparkles className="h-4 w-4 text-ai" />
                        {/* Icon-only below 2xl (1536px) so the detail header stays on one line. */}
                        <span className="hidden 2xl:inline">AI Analyze</span>
                    </>
                )}
            </Button>

            {isViewerOpen && (
                <AIMonitorAnalyzeViewer
                    open={isViewerOpen}
                    onClose={() => {
                        setIsViewerOpen(false);
                        setAnalysisContent("");
                    }}
                    content={analysisContent}
                    isStreaming={isStreaming}
                    monitorId={monitorId}
                    monitorName={monitorName}
                    monitorType={monitorType}
                />
            )}
        </>
    );
}
