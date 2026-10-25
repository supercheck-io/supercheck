"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AIK6AnalyzeViewer } from "./ai-k6-analyze-viewer";

// K6 run metrics interface
interface K6RunMetrics {
    p95ResponseTimeMs?: number | null;
    p99ResponseTimeMs?: number | null;
    avgResponseTimeMs?: number | null;
    totalRequests?: number | null;
    failedRequests?: number | null;
    vusMax?: number | null;
}

export interface K6RunData {
    runId: string;
    status?: string;
    startedAt?: string;
    durationMs?: number | null;
    requestRate?: number | null;
    metrics: K6RunMetrics;
    reportS3Url?: string | null;
}

interface AIK6AnalyzeButtonProps {
    baselineRun: K6RunData;
    compareRun: K6RunData;
    jobName?: string;
    disabled?: boolean;
}

export function AIK6AnalyzeButton({
    baselineRun,
    compareRun,
    jobName,
    disabled = false,
}: AIK6AnalyzeButtonProps) {
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
            const response = await fetch("/api/ai/analyze-k6", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    baselineRun: { ...baselineRun, jobName },
                    compareRun: { ...compareRun, jobName },
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage =
                    errorData.message || `Request failed with status ${response.status}`;

                if (response.status === 401) {
                    toast.error("Authentication required. Please log in and try again.");
                } else if (response.status === 429) {
                    toast.error("Too many requests. Please wait before trying again.");
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
            console.error("AI k6 analysis failed:", error);
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
                className="flex items-center gap-2 shrink-0 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-purple-500/30 hover:border-purple-500/50 hover:from-purple-500/20 hover:to-pink-500/20"
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
                <AIK6AnalyzeViewer
                    open={isViewerOpen}
                    onClose={() => {
                        setIsViewerOpen(false);
                        setAnalysisContent("");
                    }}
                    content={analysisContent}
                    isStreaming={isStreaming}
                    baselineRunId={baselineRun.runId}
                    compareRunId={compareRun.runId}
                    jobName={jobName}
                />
            )}
        </>
    );
}

