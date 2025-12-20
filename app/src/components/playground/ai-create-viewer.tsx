"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Check, Sparkles, Loader2 } from "lucide-react";
import { Editor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useTheme } from "next-themes";
import { getMonacoTheme } from "@/lib/monaco-config";

interface AICreateViewerProps {
  currentScript: string;
  generatedScript: string;
  explanation: string;
  isVisible: boolean;
  onAccept: (script: string) => void;
  onReject: () => void;
  onClose: () => void;
  isStreaming?: boolean;
  streamingContent?: string;
}

export function AICreateViewer({
  currentScript,
  generatedScript,
  explanation,
  isVisible,
  onAccept,
  onReject,
  onClose,
  isStreaming = false,
  streamingContent = "",
}: AICreateViewerProps) {
  const [currentGeneratedScript, setCurrentGeneratedScript] =
    useState(generatedScript);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monaco = useMonaco();
  const isMountedRef = useRef(true);
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme !== "light";
  const editorTheme = getMonacoTheme(resolvedTheme);

  // Update editor during streaming - avoid setState to prevent re-renders
  useEffect(() => {
    if (!isStreaming || !streamingContent) return;

    try {
      const model = editorRef.current?.getModel();
      if (model && !model.isDisposed?.()) {
        model.setValue(streamingContent);
      }
    } catch {
      // Silently ignore model errors during streaming
    }

    // Return cleanup function to suppress promise rejection warnings
    return () => {
      // Cleanup
    };
  }, [streamingContent, isStreaming]);

  // Update editor when streaming ends
  useEffect(() => {
    if (isStreaming) return;

    if (generatedScript) {
      try {
        const model = editorRef.current?.getModel();
        if (model && !model.isDisposed?.()) {
          model.setValue(generatedScript);
        } else {
          // Defer state update to avoid synchronous setState in effect
          setTimeout(() => setCurrentGeneratedScript(generatedScript), 0);
        }
      } catch {
        // Defer state update to avoid synchronous setState in effect
        setTimeout(() => setCurrentGeneratedScript(generatedScript), 0);
      }
    }
  }, [generatedScript, isStreaming]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      // Let Monaco handle its own cleanup
      try {
        if (
          editorRef.current &&
          typeof editorRef.current.dispose === "function"
        ) {
          editorRef.current.dispose();
        }
      } catch {
        // Silently ignore cleanup errors
      }
    };
  }, []);

  useEffect(() => {
    if (monaco) {
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

  if (!isVisible) {
    return null;
  }

  const getBulletPoints = (text: string): string[] => {
    const points: string[] = [];
    const raw =
      text ||
      "AI generated a updated script. Review and apply it if it matches your intent.";

    const segments = raw
      .split(/[.\n]/)
      .map((s) => s.trim())
      .filter((p) => p.length > 20)
      .slice(0, 3);

    if (segments.length === 0) {
      return [raw];
    }

    segments.forEach((s) => {
      let clean = s.replace(/\*\*/g, "");
      if (!clean.match(/[.!?:]$/)) clean += ".";
      points.push(clean);
    });

    return points;
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
  const bulletDotClasses = isDarkTheme ? "bg-indigo-500" : "bg-indigo-600";
  const footerClasses = isDarkTheme
    ? "bg-gray-800 border-t border-gray-700 text-gray-400"
    : "bg-slate-100 border-t border-gray-200 text-gray-600";
  const discardButtonClasses = isDarkTheme
    ? "h-9 px-4 text-sm bg-transparent border-red-600 text-red-400 hover:bg-red-600 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
    : "h-9 px-4 text-sm bg-transparent border-red-500 text-red-600 hover:bg-red-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div
        className={`w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl rounded-lg overflow-hidden ${containerClasses}`}
      >
        <div className={`flex-shrink-0 px-4 py-3 ${headerClasses}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-gradient-to-r from-purple-500/20 to-pink-500/20 p-1.5">
                <Sparkles className="h-4 w-4 text-purple-500" />
              </div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                Supercheck AI - Generated Script
                {isStreaming && (
                  <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                )}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className={`h-7 w-7 p-0 ${isDarkTheme
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
                    className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${bulletDotClasses}`}
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
          <Editor
            height="500px"
            defaultLanguage="typescript"
            theme={editorTheme}
            value={currentGeneratedScript}
            onChange={(value) => {
              if (value !== undefined && !isStreaming) {
                setCurrentGeneratedScript(value);
              }
            }}
            onMount={(instance) => {
              editorRef.current = instance;
            }}
            loading={
              <div className="flex h-full w-full items-center justify-center bg-card">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }
            options={{
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              fontSize: 13,
              automaticLayout: true,
              smoothScrolling: true,
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
            }}
          />
        </div>

        <div className={`flex-shrink-0 px-4 py-2 ${footerClasses}`}>
          <div className="flex items-center justify-between">
            <div className="text-xs flex items-center gap-4">
              <span>Original: {currentScript.length} chars</span>
              <span className="hidden sm:inline">•</span>
              <span>Generated: {currentGeneratedScript.length} chars</span>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={onReject}
                disabled={isStreaming}
                className={discardButtonClasses}
              >
                <X className="h-4 w-4 mr-1" />
                Discard
              </Button>
              <Button
                onClick={() => onAccept(currentGeneratedScript)}
                disabled={isStreaming}
                className="h-9 px-4 text-sm bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="h-4 w-4 mr-1" />
                {isStreaming ? "Generating..." : "Apply to Editor"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
