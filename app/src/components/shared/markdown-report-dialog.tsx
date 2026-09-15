"use client";

import { useEffect, useRef } from "react";
import Editor, { type Monaco, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Copy, Download, Loader2, Sparkles } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getMonacoTheme, registerMonacoThemes } from "@/lib/monaco-config";

type MarkdownReportDialogProps = {
  open: boolean;
  onClose: () => void;
  content: string;
  isStreaming: boolean;
  title: string;
  description: string;
  downloadFilename: string;
  loadingMessage: string;
};

/** A consistent, read-only Markdown report experience for AI-generated reports. */
export function MarkdownReportDialog({
  open,
  onClose,
  content,
  isStreaming,
  title,
  description,
  downloadFilename,
  loadingMessage,
}: MarkdownReportDialogProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monaco = useMonaco();
  const { resolvedTheme } = useTheme();
  const editorTheme = getMonacoTheme(resolvedTheme);

  useEffect(() => {
    if (monaco && editorRef.current) {
      monaco.editor.setTheme(editorTheme);
    }
  }, [monaco, editorTheme]);

  useEffect(() => {
    if (editorRef.current && content && isStreaming) {
      const lineCount = editorRef.current.getModel()?.getLineCount() ?? 1;
      editorRef.current.revealLine(lineCount);
    }
  }, [content, isStreaming]);

  const handleEditorMount = (
    instance: editor.IStandaloneCodeEditor,
    editorMonaco: Monaco,
  ) => {
    editorRef.current = instance;
    registerMonacoThemes(editorMonaco);
    editorMonaco.editor.setTheme(editorTheme);
    editorMonaco.languages.setLanguageConfiguration("markdown", {
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
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Report downloaded");
    } catch {
      toast.error("Failed to download report");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="h-[80vh] min-w-6xl max-w-7xl flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between gap-4 border-b pb-4">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-gradient-to-r from-purple-500/20 to-pink-500/20 p-1.5">
              <Sparkles className="h-4 w-4 text-purple-500" />
            </div>
            <div>
              <DialogTitle className="flex items-center gap-2">
                {title}
                {isStreaming && (
                  <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                )}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {description}
              </DialogDescription>
            </div>
          </div>
          <div className="mr-8 flex items-center gap-2">
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

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
          {content ? (
            <Editor
              height="100%"
              language="markdown"
              theme={editorTheme}
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
            <div className="flex h-full items-center justify-center text-muted-foreground">
              {isStreaming ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>{loadingMessage}</span>
                </div>
              ) : (
                <span>No report available</span>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t pt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
