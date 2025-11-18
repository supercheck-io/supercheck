"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Editor } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { TestType } from "@/db/schema/types";
import { CodeTemplate, getTemplatesByType } from "./template-data";
import { Code2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testType: TestType;
  onApply: (code: string) => void;
}

export function TemplateDialog({
  open,
  onOpenChange,
  testType,
  onApply,
}: TemplateDialogProps) {
  const { resolvedTheme } = useTheme();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null
  );

  // Get templates for the current test type
  const templates = getTemplatesByType(testType);

  // Group templates by category
  const templatesByCategory = templates.reduce((acc, template) => {
    if (!acc[template.category]) {
      acc[template.category] = [];
    }
    acc[template.category].push(template);
    return acc;
  }, {} as Record<string, CodeTemplate[]>);

  const handleApply = () => {
    const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
    if (selectedTemplate) {
      onApply(selectedTemplate.code);
      onOpenChange(false);
    }
  };

  // Select first template by default when dialog opens
  if (open && !selectedTemplateId && templates.length > 0) {
    setSelectedTemplateId(templates[0].id);
  }

  // Reset selection when dialog closes
  if (!open && selectedTemplateId) {
    setSelectedTemplateId(null);
  }

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const isPerformance = testType === "performance";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] h-[85vh] p-0 gap-0 min-w-[1300px]">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center gap-2">
         
            <DialogTitle className="text-2xl">Code Templates</DialogTitle>
          </div>
          <DialogDescription className="text-base">
            Select a template to quickly get started with{" "}
            {isPerformance ? "k6 performance" : "Playwright"} testing
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Template Selection Section with Radio Buttons */}
          <div className="w-[35%] border-r overflow-auto">
            <div className="p-6">
              <RadioGroup
                value={selectedTemplateId || ""}
                onValueChange={setSelectedTemplateId}
                className="space-y-6"
              >
                {Object.entries(templatesByCategory).map(
                  ([category, categoryTemplates]) => (
                    <div key={category}>
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                        {category}
                      </h3>
                      <div className="space-y-2">
                        {categoryTemplates.map((template) => (
                          <Label
                            key={template.id}
                            htmlFor={`template-${template.id}`}
                            className={cn(
                              "flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/60 px-4 py-3 transition hover:border-primary/60 hover:bg-card/80",
                              selectedTemplateId === template.id &&
                                "border-primary bg-primary/5"
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm leading-tight mb-1">
                                {template.name}
                              </p>
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {template.description}
                              </p>
                            </div>
                            <RadioGroupItem
                              id={`template-${template.id}`}
                              value={template.id}
                              className="h-4 w-4 flex-shrink-0"
                            />
                          </Label>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </RadioGroup>
            </div>
          </div>

          {/* Monaco Editor Section - Takes More Space */}
          <div className="flex-1 flex flex-col">
            {selectedTemplate ? (
              <>
                <div className="border-b px-6 py-3 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Code2 className="h-4 w-4" />
                        {selectedTemplate.name}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {selectedTemplate.description}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-hidden">
                  <Editor
                    height="100%"
                    defaultLanguage={
                      isPerformance ? "javascript" : "typescript"
                    }
                    value={selectedTemplate.code}
                    theme={resolvedTheme === "dark" ? "vs-dark" : "warm-light"}
                    options={{
                      readOnly: true,
                      minimap: { enabled: true },
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                      lineNumbers: "on",
                      folding: true,
                      fontSize: 13.5,
                      padding: { top: 16, bottom: 16 },
                      renderLineHighlight: "none",
                      contextmenu: false,
                      selectOnLineNumbers: true,
                      selectionHighlight: false,
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Code2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">Select a template to preview</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer with Actions */}
        <DialogFooter className="border-t px-6 py-4 bg-muted/30">
          <div className="flex items-center justify-between w-full">
            <div className="text-sm text-muted-foreground">
              {templates.length} template{templates.length !== 1 ? "s" : ""}{" "}
              available
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleApply}
                disabled={!selectedTemplate}
                className="gap-2"
              >
                <Check className="h-4 w-4" />
                Apply Template
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
