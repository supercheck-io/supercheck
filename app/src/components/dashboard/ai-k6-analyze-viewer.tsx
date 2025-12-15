"use client";

import { useEffect, useRef } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Copy, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Editor, { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

interface AIK6AnalyzeViewerProps {
    open: boolean;
    onClose: () => void;
    content: string;
    isStreaming: boolean;
    baselineRunId: string;
    compareRunId: string;
    jobName?: string;
}

export function AIK6AnalyzeViewer({
    open,
    onClose,
    content,
    isStreaming,
    baselineRunId,
    compareRunId,
    jobName,
}: AIK6AnalyzeViewerProps) {
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<Monaco | null>(null);

    // Scroll to bottom when streaming new content
    useEffect(() => {
        if (editorRef.current && content && isStreaming) {
            const lineCount = editorRef.current.getModel()?.getLineCount() || 1;
            editorRef.current.revealLine(lineCount);
        }
    }, [content, isStreaming]);

    const handleEditorMount = (
        editor: editor.IStandaloneCodeEditor,
        monaco: Monaco
    ) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        // Configure markdown language
        monaco.languages.setLanguageConfiguration("markdown", {
            wordPattern:
                /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
        });
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            toast.success("Report copied to clipboard");
        } catch {
            toast.error("Failed to copy report");
        }
    };

    const handleDownload = () => {
        try {
            const blob = new Blob([content], { type: "text/markdown" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `k6-comparison-${baselineRunId.substring(0, 8)}-vs-${compareRunId.substring(0, 8)}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast.success("Report downloaded");
        } catch {
            toast.error("Failed to download report");
        }
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-7xl h-[80vh] flex flex-col min-w-6xl">
                <DialogHeader className="flex flex-row items-center justify-between gap-4 pb-4 border-b">
                    <div className="flex items-center gap-2">
                        <div className="rounded-md bg-gradient-to-r from-purple-500/20 to-pink-500/20 p-1.5">
                            <Sparkles className="h-4 w-4 text-purple-500" />
                        </div>
                        <div>
                            <DialogTitle className="flex items-center gap-2">
                                k6 Performance Comparison Analysis
                                {isStreaming && (
                                    <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                                )}
                            </DialogTitle>
                            <DialogDescription className="text-xs">
                                {jobName ? `${jobName} • ` : ""}
                                Baseline: {baselineRunId.substring(0, 8)} → Compare: {compareRunId.substring(0, 8)}
                            </DialogDescription>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 mr-8">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCopy}
                            disabled={!content || isStreaming}
                            className="flex items-center gap-1"
                        >
                            <Copy className="h-3.5 w-3.5" />
                            Copy
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDownload}
                            disabled={!content || isStreaming}
                            className="flex items-center gap-1"
                        >
                            <Download className="h-3.5 w-3.5" />
                            Download
                        </Button>
                    </div>
                </DialogHeader>

                <div className="flex-1 min-h-0 border rounded-md overflow-hidden">
                    {content ? (
                        <Editor
                            height="100%"
                            language="markdown"
                            theme="vs-dark"
                            value={content}
                            onMount={handleEditorMount}
                            options={{
                                readOnly: true,
                                minimap: { enabled: false },
                                wordWrap: "on",
                                lineNumbers: "off",
                                scrollBeyondLastLine: false,
                                fontSize: 14,
                                padding: { top: 16, bottom: 16 },
                                folding: true,
                                renderWhitespace: "none",
                                automaticLayout: true,
                                scrollbar: {
                                    vertical: "visible",
                                    horizontal: "hidden",
                                    verticalScrollbarSize: 8,
                                },
                            }}
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                            {isStreaming ? (
                                <div className="flex items-center gap-2">
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                    <span>Generating analysis...</span>
                                </div>
                            ) : (
                                <span>No analysis available</span>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex justify-end pt-4 border-t">
                    <Button variant="outline" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
