"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Check, XCircle } from "lucide-react";
import * as monaco from "monaco-editor";

interface AICreateViewerProps {
  currentScript: string;
  generatedScript: string;
  explanation: string;
  isVisible: boolean;
  onAccept: (script: string) => void;
  onReject: () => void;
  onClose: () => void;
}

export function AICreateViewer({
  currentScript,
  generatedScript,
  explanation,
  isVisible,
  onAccept,
  onReject,
  onClose,
}: AICreateViewerProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const diffEditorInstance = useRef<monaco.editor.IStandaloneDiffEditor | null>(
    null
  );
  const [editedScript, setEditedScript] = useState(generatedScript);

  useEffect(() => {
    setEditedScript(generatedScript);
  }, [generatedScript]);

  useEffect(() => {
    if (!isVisible || !editorRef.current) {
      return;
    }

    // Clean up previous editor instance if it exists
    if (diffEditorInstance.current) {
      diffEditorInstance.current.dispose();
      diffEditorInstance.current = null;
    }

    // Create diff editor instance
    const diffEditor = monaco.editor.createDiffEditor(editorRef.current, {
      theme: "vs-dark",
      readOnly: false,
      automaticLayout: true,
      renderSideBySide: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: "on",
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 10,
      lineNumbersMinChars: 3,
    });

    // Set original and modified models
    const originalModel = monaco.editor.createModel(
      currentScript || "// No existing script",
      "javascript"
    );
    const modifiedModel = monaco.editor.createModel(
      generatedScript,
      "javascript"
    );

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });

    // Track changes to the modified model
    modifiedModel.onDidChangeContent(() => {
      const value = modifiedModel.getValue();
      setEditedScript(value);
    });

    diffEditorInstance.current = diffEditor;

    // Cleanup on unmount
    return () => {
      if (diffEditorInstance.current) {
        diffEditorInstance.current.dispose();
        diffEditorInstance.current = null;
      }
      originalModel.dispose();
      modifiedModel.dispose();
    };
  }, [isVisible, currentScript, generatedScript]);

  const handleAccept = () => {
    onAccept(editedScript);
  };

  const handleReject = () => {
    onReject();
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-7xl max-h-[90vh] bg-gray-900 rounded-lg shadow-2xl flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="text-lg font-semibold text-white">
              AI Generated Test Code
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Explanation Section */}
        {explanation && (
          <div className="px-6 py-3 bg-gray-800/50 border-b border-gray-700">
            <div className="text-sm text-gray-300">
              <div className="font-semibold mb-1 text-blue-400">What was created:</div>
              <div className="whitespace-pre-wrap">{explanation}</div>
            </div>
          </div>
        )}

        {/* Diff Editor */}
        <div className="flex-1 overflow-hidden">
          <div className="h-full w-full" ref={editorRef}></div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-700 bg-gray-800/30">
          <div className="text-sm text-gray-400">
            Left: Current Script | Right: Generated Code (editable)
          </div>
          <div className="flex gap-3">
            <Button
              onClick={handleReject}
              variant="outline"
              size="sm"
              className="gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-600"
            >
              <XCircle className="h-4 w-4" />
              Discard
            </Button>
            <Button
              onClick={handleAccept}
              size="sm"
              className="gap-2 bg-green-600 hover:bg-green-700 text-white"
            >
              <Check className="h-4 w-4" />
              Accept & Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
