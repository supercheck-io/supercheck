"use client";

import { useEffect, useRef, useCallback, memo } from "react";
import { Editor, useMonaco } from "@monaco-editor/react";
import type { editor as editorType } from "monaco-editor";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { registerMonacoThemes, getMonacoTheme } from "@/lib/monaco-config";

type LineStyle = "error" | "warn" | "success" | "info";

const styleToColor: Record<LineStyle, string> = {
  error: "#dc2626", // red-600
  warn: "#ea580c", // orange-600
  success: "#16a34a", // green-600
  info: "#64748b", // slate-600
};

const styleToDarkColor: Record<LineStyle, string> = {
  error: "#fca5a5", // red-300
  warn: "#fed7aa", // orange-200
  success: "#86efac", // green-300
  info: "#cbd5e1", // slate-300
};

const classifyLine = (line: string): LineStyle | null => {
  const trimmedLine = line.trimStart();
  const firstChar = trimmedLine.charAt(0);

  // ONLY: Checkmark as first character = success (green)
  if (firstChar === "✓" || firstChar === "✔") {
    return "success";
  }

  // ONLY: Cross as first character = error (red)
  if (firstChar === "✗" || firstChar === "✘") {
    return "error";
  }

  // Everything else = no formatting
  return null;
};

const filterAndProcessLogs = (content: string): string => {
  const lines = content.split(/\r?\n/);
  const processedLines = lines.filter(
    (line) => !line.includes("web dashboard:")
  );
  return processedLines.join("\n");
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
    emptyMessage = "******** Logs will appear here soon ********",
    hideLineNumbers = false,
    readOnly = true,
  }: MonacoConsoleViewerProps) => {
    const monaco = useMonaco();
    const { resolvedTheme } = useTheme();
    const editorRef = useRef<editorType.IStandaloneCodeEditor | null>(null);
    const isInitializing = useRef(false);
    const previousContentRef = useRef<string>("");
    const decorationsRef = useRef<string[]>([]);

    // Initialize console language - use shared theme registration
    useEffect(() => {
      if (!monaco || isInitializing.current) return;

      isInitializing.current = true;

      try {
        // Register the console log language
        if (!monaco.languages.getEncodedLanguageId("console-log")) {
          monaco.languages.register({ id: "console-log" });
        }

        // Register shared Monaco themes (idempotent)
        registerMonacoThemes(monaco);
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

    // Build decorations - extracted logic for reusability
    const buildDecorations =
      useCallback((): editorType.IModelDeltaDecoration[] => {
        if (!monaco) return [];

        // Use filtered content for decorations to match what's displayed
        const filteredContent = filterAndProcessLogs(content);
        const lines = filteredContent.split(/\r?\n/);
        const newDecorations: editorType.IModelDeltaDecoration[] = [];
        const isDark = resolvedTheme === "dark";

        lines.forEach((line, index) => {
          const lineStyle = classifyLine(line);

          // Only apply formatting if line starts with check or cross mark or section header
          if (lineStyle === null) return;

          const color = isDark
            ? styleToDarkColor[lineStyle]
            : styleToColor[lineStyle];

          const options: editorType.IModelDecorationOptions = {
            isWholeLine: true,
            minimap: { color, position: 2 },
            overviewRuler: { color, position: 2 },
          };

          // Apply glyph margin icon and text color for all line styles
          options.glyphMarginClassName = `console-glyph-${lineStyle}`;
          options.inlineClassName = `console-line-${lineStyle}`;

          newDecorations.push({
            range: new monaco.Range(index + 1, 1, index + 1, 500),
            options: options as editorType.IModelDecorationOptions,
          });
        });

        return newDecorations;
      }, [content, resolvedTheme, monaco]);

    // Update theme when it changes - use shared getMonacoTheme
    useEffect(() => {
      if (!monaco) return;

      try {
        monaco.editor.setTheme(getMonacoTheme(resolvedTheme));
      } catch {
        // Theme might not be defined yet
      }
    }, [resolvedTheme, monaco]);

    // Apply color decorations based on line content
    useEffect(() => {
      if (!editorRef.current || !monaco) return;

      const newDecorations = buildDecorations();

      // Clear old decorations and apply new ones
      decorationsRef.current = editorRef.current.deltaDecorations(
        decorationsRef.current,
        newDecorations
      );
    }, [content, resolvedTheme, monaco, buildDecorations]);

    const handleEditorDidMount = useCallback(
      (editor: editorType.IStandaloneCodeEditor) => {
        editorRef.current = editor;

        // Use shared getMonacoTheme helper
        const editorTheme = getMonacoTheme(resolvedTheme);
        try {
          monaco?.editor.setTheme(editorTheme);
        } catch {
          // Theme might not be defined yet
        }

        // Schedule decoration application after editor has been fully rendered
        // Use microtask to ensure editor model is ready and value has been set
        Promise.resolve().then(() => {
          if (editorRef.current && monaco) {
            const newDecorations = buildDecorations();
            decorationsRef.current = editorRef.current.deltaDecorations(
              decorationsRef.current,
              newDecorations
            );
          }
        });

        // Scroll to bottom
        const lineCount = editor.getModel()?.getLineCount() ?? 0;
        if (lineCount > 0) {
          editor.revealLine(lineCount, 0);
        }
      },
      [monaco, resolvedTheme, buildDecorations]
    );

    const displayContent = !content
      ? emptyMessage
      : filterAndProcessLogs(content);

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
          onChange={() => { }}
          onMount={handleEditorDidMount}
          loading={
            <div className="flex h-full w-full items-center justify-center bg-card">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
          options={
            {
              readOnly,
              lineNumbers: hideLineNumbers ? "off" : "on",
              glyphMargin: true,
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
