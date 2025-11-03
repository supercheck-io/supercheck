"use client";

import { useEffect, useRef, useCallback, memo } from "react";
import { Editor, useMonaco } from "@monaco-editor/react";
import type { editor as editorType } from "monaco-editor";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

type LineStyle = "error" | "warn" | "success" | "info";

const styleToColor: Record<LineStyle, string> = {
  error: "#ef4444", // red-500
  warn: "#f59e0b", // amber-500
  success: "#10b981", // emerald-500
  info: "#64748b", // slate-600
};

const styleToDarkColor: Record<LineStyle, string> = {
  error: "#fca5a5", // red-300
  warn: "#fbbf24", // amber-400
  success: "#6ee7b7", // emerald-400
  info: "#cbd5e1", // slate-300
};

const classifyLine = (line: string): LineStyle => {
  const normalized = line.toLowerCase();
  if (
    normalized.includes("error") ||
    normalized.includes("panic") ||
    normalized.includes("fatal")
  ) {
    return "error";
  }
  if (normalized.includes("warn")) {
    return "warn";
  }
  if (
    normalized.includes("threshold") &&
    (normalized.includes("passed") || normalized.includes("satisfied"))
  ) {
    return "success";
  }
  return "info";
};

export interface MonacoConsoleViewerProps {
  content: string;
  className?: string;
  emptyMessage?: string;
  hideLineNumbers?: boolean;
  readOnly?: boolean;
}

export const MonacoConsoleViewer = memo(
  ({
    content,
    className,
    emptyMessage = "Console output will appear here once available.",
    hideLineNumbers = false,
    readOnly = true,
  }: MonacoConsoleViewerProps) => {
    const monaco = useMonaco();
    const { resolvedTheme } = useTheme();
    const editorRef = useRef<editorType.IStandaloneCodeEditor | null>(null);
    const isInitializing = useRef(false);
    const previousContentRef = useRef<string>("");
    const decorationsRef = useRef<string[]>([]);

    // Initialize console language - use same theme as playground
    useEffect(() => {
      if (!monaco || isInitializing.current) return;

      isInitializing.current = true;

      try {
        // Register the console log language
        if (!monaco.languages.getEncodedLanguageId("console-log")) {
          monaco.languages.register({ id: "console-log" });
        }
      } catch (err) {
        console.error("Failed to initialize Monaco console viewer:", err);
      }
    }, [monaco]);

    // Auto-scroll to bottom when content changes
    useEffect(() => {
      if (editorRef.current && content !== previousContentRef.current) {
        previousContentRef.current = content;
        const lineCount = editorRef.current.getModel()?.getLineCount() ?? 0;
        if (lineCount > 0) {
          editorRef.current.revealLine(lineCount, 0);
        }
      }
    }, [content]);

    // Apply color decorations based on line content
    useEffect(() => {
      if (!editorRef.current || !monaco) return;

      const lines = content.split(/\r?\n/);
      const newDecorations: editorType.IModelDeltaDecoration[] = [];
      const isDark = resolvedTheme === "dark";

      lines.forEach((line, index) => {
        if (!line.trim()) return;

        const lineStyle = classifyLine(line);
        const color = isDark
          ? styleToDarkColor[lineStyle]
          : styleToColor[lineStyle];

        newDecorations.push({
          range: new monaco.Range(index + 1, 1, index + 1, 1),
          options: {
            isWholeLine: true,
            minimap: { color, position: 2 },
            overviewRulerColor: color,
            glyphMarginClassName: `console-glyph-${lineStyle}`,
          } as editorType.IModelDecorationOptions,
        });
      });

      // Apply decorations
      decorationsRef.current = editorRef.current.deltaDecorations(
        decorationsRef.current,
        newDecorations
      );
    }, [content, resolvedTheme, monaco]);

    const handleEditorDidMount = useCallback(
      (editor: editorType.IStandaloneCodeEditor) => {
        editorRef.current = editor;

        // Use same theme as playground editor
        const editorTheme = resolvedTheme === "dark" ? "vs-dark" : "warm-light";
        try {
          monaco?.editor.setTheme(editorTheme);
        } catch {
          // Theme might not be defined yet
        }

        // Scroll to bottom
        const lineCount = editor.getModel()?.getLineCount() ?? 0;
        if (lineCount > 0) {
          editor.revealLine(lineCount, 0);
        }
      },
      [monaco, resolvedTheme]
    );

    const displayContent = !content ? emptyMessage : content;

    return (
      <div
        className={cn(
          "h-full w-full overflow-hidden  border border-border/50 relative",
          className
        )}
      >
        <Editor
          height="100%"
          defaultLanguage="console-log"
          value={displayContent}
          onChange={() => {}}
          onMount={handleEditorDidMount}
          options={
            {
              readOnly,
              lineNumbers: hideLineNumbers ? "off" : "on",
              glyphMargin: false,
              folding: false,
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              wrappingIndent: "indent",
              formatOnPaste: false,
              formatOnType: false,
              fontFamily: "Menlo, Monaco, 'Courier New', monospace",
              fontSize: 13,
              lineHeight: 1.6,
              fontLigatures: false,
              smoothScrolling: true,
              scrollbar: {
                vertical: "auto",
                horizontal: "auto",
                useShadows: true,
                verticalSliderSize: 8,
                horizontalSliderSize: 8,
              },
              contextmenu: false,
              renderLineHighlight: "none",
              overviewRulerLanes: 1,
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              mouseWheelZoom: false,
              mouseWheelScrollSensitivity: 1,
              automaticLayout: true,
              renderWhitespace: "none",
              bracketPairColorization: {
                enabled: false,
              },
            } as editorType.IEditorOptions
          }
          theme={resolvedTheme === "dark" ? "vs-dark" : "warm-light"}
        />
      </div>
    );
  }
);

MonacoConsoleViewer.displayName = "MonacoConsoleViewer";
