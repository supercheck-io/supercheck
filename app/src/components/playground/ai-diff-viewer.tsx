"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Check, Wand2, X } from "lucide-react";
import { toast } from "sonner";

// Import Monaco Editor properly
import { DiffEditor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useTheme } from "next-themes";

interface AIDiffViewerProps {
  originalScript: string;
  fixedScript: string;
  explanation: string;
  isVisible: boolean;
  onAccept: (acceptedScript: string) => void;
  onReject: () => void;
  onClose: () => void;
  isStreaming?: boolean;
  streamingContent?: string;
}

export function AIDiffViewer({
  originalScript,
  fixedScript,
  explanation,
  isVisible,
  onAccept,
  onReject,
  onClose,
  isStreaming = false,
  streamingContent = "",
}: AIDiffViewerProps) {
  const [currentFixedScript, setCurrentFixedScript] = useState(fixedScript);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const monaco = useMonaco();
  const isMountedRef = useRef(true);
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme !== "light";
  const editorTheme = isDarkTheme ? "vs-dark" : "warm-light";

  const scrollEditorsToTop = useCallback(() => {
    if (!editorRef.current) return;
    const modifiedEditor = editorRef.current.getModifiedEditor?.();
    const originalEditor = editorRef.current.getOriginalEditor?.();
    modifiedEditor?.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
    originalEditor?.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
  }, []);

  // Update editor during streaming - avoid setState to prevent re-renders
  useEffect(() => {
    if (!isStreaming || !streamingContent) return;

    const modifiedEditor = editorRef.current?.getModifiedEditor?.();
    if (modifiedEditor) {
      try {
        const model = modifiedEditor.getModel();
        if (model && !model.isDisposed?.()) {
          model.setValue(streamingContent);
        }
      } catch {
        // Silently ignore model errors during streaming
      }
    }

    // Return cleanup function to suppress promise rejection warnings
    return () => {
      // Cleanup
    };
  }, [streamingContent, isStreaming]);

  // Update editor when streaming ends
  useEffect(() => {
    if (isStreaming) return;

    if (fixedScript) {
      setCurrentFixedScript(fixedScript);
      const modifiedEditor = editorRef.current?.getModifiedEditor?.();
      if (modifiedEditor) {
        try {
          const model = modifiedEditor.getModel();
          if (model && !model.isDisposed?.()) {
            model.setValue(fixedScript);
          }
        } catch {
          // Silently ignore model errors
        }
      }
      scrollEditorsToTop();
    }
  }, [isStreaming, fixedScript, scrollEditorsToTop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      // Clean up editor - let the editor handle its own model disposal
      if (editorRef.current) {
        try {
          // Dispose the editor itself - it will handle model cleanup
          if (typeof editorRef.current.dispose === "function") {
            editorRef.current.dispose();
          }
        } catch {
          // Silently ignore cleanup errors
        }
      }
    };
  }, []);

  // Configure Monaco when available
  useEffect(() => {
    if (monaco) {
      // Set JavaScript defaults similar to main editor
      monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ESNext,
        allowNonTsExtensions: true,
        moduleResolution:
          monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        module: monaco.languages.typescript.ModuleKind.CommonJS,
        lib: ["es2020", "dom"],
      });
    }
  }, [monaco]);

  useEffect(() => {
    if (monaco && editorTheme) {
      monaco.editor.setTheme(editorTheme);
    }
  }, [monaco, editorTheme]);

  const handleEditorDidMount = (editor: editor.IStandaloneDiffEditor) => {
    // Check if component is still mounted before proceeding
    if (!isMountedRef.current) {
      return;
    }

    editorRef.current = editor;

    try {
      // Configure diff editor options properly
      editor.updateOptions({
        renderSideBySide: true,
        enableSplitViewResizing: false,
        renderOverviewRuler: false,
        diffCodeLens: false,
        originalEditable: false,
        ignoreTrimWhitespace: false,
        renderIndicators: true,
        maxComputationTime: 5000,
        maxFileSize: 20,
      });

      // Get both editors and configure them properly
      const modifiedEditor = editor.getModifiedEditor();
      const originalEditor = editor.getOriginalEditor();

      // Configure scrollbar options for both editors
      const scrollbarConfig = {
        vertical: "auto" as const,
        horizontal: "auto" as const,
        verticalScrollbarSize: 12,
        horizontalScrollbarSize: 12,
        useShadows: true,
        verticalHasArrows: false,
        horizontalHasArrows: false,
        alwaysConsumeMouseWheel: false,
      };

      if (modifiedEditor) {
        modifiedEditor.updateOptions({
          scrollbar: scrollbarConfig,
          readOnly: false,
          wordWrap: "off",
          lineNumbers: "on",
          glyphMargin: false,
        });
        // Set focus to modified editor after a short delay, only if still mounted
        setTimeout(() => {
          if (isMountedRef.current && modifiedEditor) {
            modifiedEditor.focus();
          }
        }, 100);
      }

      if (originalEditor) {
        originalEditor.updateOptions({
          scrollbar: scrollbarConfig,
          readOnly: true,
          wordWrap: "off",
          lineNumbers: "on",
          glyphMargin: false,
        });
      }

      // Force layout update, only if still mounted
      setTimeout(() => {
        if (isMountedRef.current && editor) {
          editor.layout();
        }
      }, 200);
    } catch (error) {
      console.error("[AI Diff] Error configuring editor:", error);
    }
  };

  const handleAccept = () => {
    try {
      let acceptedScript = currentFixedScript; // Default to the fixed script

      // Try to get content from the modified editor if available
      if (editorRef.current) {
        const modifiedEditor = editorRef.current.getModifiedEditor?.();
        if (modifiedEditor && typeof modifiedEditor.getValue === "function") {
          const editorContent = modifiedEditor.getValue();
          if (editorContent && editorContent.trim()) {
            acceptedScript = editorContent;
          }
        }
      }

      if (!acceptedScript || !acceptedScript.trim()) {
        toast.error("Cannot accept empty script");
        return;
      }

      // Let parent component handle success toast to avoid duplicates
      onAccept(acceptedScript);
    } catch (error) {
      console.error("Error accepting AI fix:", error);
      // Let parent handle error toast, just fallback to the fixed script
      onAccept(currentFixedScript);
    }
  };

  const handleReject = () => {
    toast.info("AI fix rejected", {
      description: "Original script remains unchanged.",
    });
    onReject();
  };

  if (!isVisible) {
    return null;
  }

  // Convert explanation to clean, professional bullet points
  const getBulletPoints = (text: string): string[] => {
    const fixes: string[] = [];

    // Try to split by natural sentence boundaries or line breaks first
    let points: string[] = [];

    // Check if the text has numbered lists (1. 2. 3.)
    if (text.match(/^\d+\./m)) {
      points = text.split(/(?=\d+\.)/g).filter((p) => p.trim().length > 10);
    }
    // Check if the text has bullet points (- or •)
    else if (text.match(/^[-•]/m)) {
      points = text.split(/(?=[-•])/g).filter((p) => p.trim().length > 10);
    }
    // Otherwise split by sentences but be more conservative
    else {
      points = text.split(/[.\n]/).filter((p) => p.trim().length > 20);
    }

    // Clean up each point minimally
    points.slice(0, 3).forEach((point) => {
      let cleanPoint = point
        .replace(/\*\*/g, "") // Remove markdown bold
        .replace(/^\d+\.\s*/, "") // Remove numbering
        .replace(/^[-•]\s*/, "") // Remove bullets
        .trim();

      // Only remove obvious action prefixes, keep the rest intact
      cleanPoint = cleanPoint.replace(
        /^(Fixed|Added|Updated|Changed):\s*/i,
        ""
      );

      // Ensure it starts with capital and ends properly
      if (cleanPoint && cleanPoint.length > 8) {
        cleanPoint = cleanPoint.charAt(0).toUpperCase() + cleanPoint.slice(1);

        // Only add period if it doesn't already end with punctuation
        if (!cleanPoint.match(/[.!?:]$/)) {
          cleanPoint += ".";
        }

        fixes.push(cleanPoint);
      }
    });

    return fixes.length > 0 ? fixes : ["Test script has been improved."];
  };

  const bulletPoints = getBulletPoints(explanation);
  const containerClasses = isDarkTheme
    ? "bg-gray-900 border border-gray-700"
    : "bg-white border border-gray-200";
  const headerClasses = isDarkTheme
    ? "bg-gray-900 border-b border-gray-700 text-white"
    : "bg-white border-b border-gray-200 text-gray-900";
  const summaryClasses = isDarkTheme
    ? "bg-gray-800 text-gray-300"
    : "bg-slate-100 text-gray-700";
  const footerClasses = isDarkTheme
    ? "bg-gray-800 border-t border-gray-700 text-gray-400"
    : "bg-slate-100 border-t border-gray-200 text-gray-600";
  const badgeOriginal = isDarkTheme ? "bg-red-500/70" : "bg-red-500/40";
  const badgeFixed = isDarkTheme ? "bg-green-500/70" : "bg-green-500/40";
  const rejectButtonClasses = isDarkTheme
    ? "h-9 px-4 text-sm bg-transparent border-red-600 text-red-400 hover:bg-red-600 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
    : "h-9 px-4 text-sm bg-transparent border-red-500 text-red-600 hover:bg-red-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed";
  const acceptButtonClasses = isDarkTheme
    ? "h-9 px-4 text-sm bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
    : "h-9 px-4 text-sm bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div
        className={`w-full max-w-5xl max-h-[95vh] flex flex-col shadow-2xl rounded-lg overflow-hidden ${containerClasses}`}
      >
        <div className={`flex-shrink-0 px-4 py-3 ${headerClasses}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Wand2
                className={`h-5 w-5 ${isDarkTheme ? "text-white" : "text-gray-900"}`}
              />
              <h2 className="text-base font-semibold flex items-center gap-2">
                AI Fix Review
                {isStreaming && (
                  <span className="text-xs text-purple-500 font-normal animate-pulse">
                    AI is generating...
                  </span>
                )}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className={`h-7 w-7 p-0 ${
                isDarkTheme
                  ? "text-gray-400 hover:text-white hover:bg-gray-800"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              }`}
              disabled={isStreaming}
              aria-label="Close"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          <div className={`rounded px-3 py-3 ${summaryClasses}`}>
            <div className="text-sm space-y-2">
              {bulletPoints.map((point, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div
                    className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${badgeFixed}`}
                  />
                  <span className="leading-relaxed">{point}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          className={`${isDarkTheme ? "bg-gray-900" : "bg-white"} relative`}
          style={{ height: "500px" }}
        >
          <style jsx>{`
            .monaco-diff-editor .editor.modified {
              border-left: 1px solid ${isDarkTheme ? "#404040" : "#e5e7eb"};
            }
          `}</style>
          <DiffEditor
            height="500px"
            language="javascript"
            original={originalScript}
            modified={currentFixedScript}
            onMount={handleEditorDidMount}
            options={{
              fontSize: 12,
              fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
              lineNumbers: "on",
              renderSideBySide: true,
              enableSplitViewResizing: false,
              readOnly: false,
              minimap: { enabled: false },
              wordWrap: "off",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderOverviewRuler: false,
              diffCodeLens: false,
              renderIndicators: true,
              originalEditable: false,
              ignoreTrimWhitespace: false,
              folding: false,
              glyphMargin: false,
              contextmenu: false,
              scrollbar: {
                vertical: "auto",
                horizontal: "auto",
                verticalScrollbarSize: 12,
                horizontalScrollbarSize: 12,
                useShadows: true,
                verticalHasArrows: false,
                horizontalHasArrows: false,
                alwaysConsumeMouseWheel: false,
              },
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
            }}
            theme={editorTheme}
          />
        </div>

        <div className={`flex-shrink-0 px-4 py-2 ${footerClasses}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${badgeOriginal}`} />
                <span>Original</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${badgeFixed}`} />
                <span>AI Fixed</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                type="button"
                onClick={handleReject}
                disabled={isStreaming}
                className={rejectButtonClasses}
              >
                <X className="h-4 w-4 mr-1" />
                Reject
              </Button>
              <Button
                type="button"
                onClick={handleAccept}
                disabled={isStreaming}
                className={acceptButtonClasses}
              >
                <Check className="h-4 w-4 mr-1" />
                Accept & Apply
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
