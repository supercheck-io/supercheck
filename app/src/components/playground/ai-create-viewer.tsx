"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Check, XCircle, Loader2, Wand2 } from "lucide-react";
import { Editor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

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
  const [currentGeneratedScript, setCurrentGeneratedScript] = useState(
    generatedScript
  );
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monaco = useMonaco();
  const isMountedRef = useRef(true);

  // Drive Monaco directly during streaming to avoid React re-render flicker
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (isStreaming && streamingContent && model) {
      model.setValue(streamingContent);
      return;
    }

    if (!isStreaming && generatedScript && model) {
      model.setValue(generatedScript);
      return;
    }

    if (!isStreaming && generatedScript) {
      setCurrentGeneratedScript(generatedScript);
    }
  }, [generatedScript, isStreaming, streamingContent]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      const instance = editorRef.current;
      if (instance) {
        const model = instance.getModel();
        if (model) {
          model.dispose();
        }
        instance.dispose();
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border rounded-lg shadow-xl w-[90vw] max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex flex-col gap-3 p-4 border-b bg-gray-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white">
              <Wand2 className="h-5 w-5 text-indigo-400" />
              <h3 className="text-lg font-semibold">AI Generated Script</h3>
              {isStreaming && (
                <span className="flex items-center text-xs text-purple-300 gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Generating…
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-gray-400 hover:text-white hover:bg-gray-800 h-7 w-7 p-0"
              disabled={isStreaming}
              aria-label="Close"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          <div className="bg-gray-800 rounded px-3 py-3">
            <div className="text-sm text-gray-200 space-y-2">
              {bulletPoints.map((point, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full mt-2 flex-shrink-0"></div>
                  <span className="leading-relaxed">{point}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 grid grid-rows-[1fr_auto]">
          <div className="h-full bg-[#1e1e1e]">
            <Editor
              height="65vh"
              defaultLanguage="typescript"
              theme="vs-dark"
              value={currentGeneratedScript}
              onChange={(value) => {
                if (value !== undefined && !isStreaming) {
                  setCurrentGeneratedScript(value);
                }
              }}
              onMount={(instance) => {
                editorRef.current = instance;
              }}
              options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                fontSize: 13,
                automaticLayout: true,
                smoothScrolling: true,
              }}
            />
          </div>
          <div className="border-t p-4 bg-card flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              Original: {currentScript.length} chars · Generated:{" "}
              {currentGeneratedScript.length} chars
            </div>
            <div className="flex justify-end items-center gap-2">
              <Button variant="outline" onClick={onReject}>
                Discard
              </Button>
              <Button onClick={() => onAccept(currentGeneratedScript)}>
                <Check className="h-4 w-4 mr-2" />
                Apply to Editor
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
