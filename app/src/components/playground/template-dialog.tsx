"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Editor } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { TestType } from "@/db/schema/types";
import { CodeTemplate, getTemplatesByType } from "./template-data";
import { Code2, Check, LayoutTemplate } from "lucide-react";
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
  const [selectedTemplate, setSelectedTemplate] = useState<CodeTemplate | null>(
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
    if (selectedTemplate) {
      onApply(selectedTemplate.code);
      onOpenChange(false);
    }
  };

  // Select first template by default when dialog opens
  if (open && !selectedTemplate && templates.length > 0) {
    setSelectedTemplate(templates[0]);
  }

  // Reset selection when dialog closes
  if (!open && selectedTemplate) {
    setSelectedTemplate(null);
  }

  const isPerformance = testType === "performance";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] h-[90vh] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="h-5 w-5 text-primary" />
            <DialogTitle className="text-2xl">Code Templates</DialogTitle>
          </div>
          <DialogDescription className="text-base">
            Select a template to quickly get started with {isPerformance ? "k6 performance" : "Playwright"} testing
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Template Cards Section */}
          <div className="w-full md:w-2/5 border-b md:border-b-0 md:border-r">
            <ScrollArea className="h-full">
              <div className="p-6 space-y-6">
                {Object.entries(templatesByCategory).map(([category, categoryTemplates]) => (
                  <div key={category}>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                      {category}
                    </h3>
                    <div className="space-y-2">
                      {categoryTemplates.map((template) => (
                        <Card
                          key={template.id}
                          className={cn(
                            "cursor-pointer transition-all duration-200 hover:shadow-md hover:border-primary/50",
                            selectedTemplate?.id === template.id
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "hover:bg-accent/50"
                          )}
                          onClick={() => setSelectedTemplate(template)}
                        >
                          <CardHeader className="p-4">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <CardTitle className="text-base font-semibold truncate">
                                    {template.name}
                                  </CardTitle>
                                  {selectedTemplate?.id === template.id && (
                                    <Check className="h-4 w-4 text-primary flex-shrink-0" />
                                  )}
                                </div>
                                <CardDescription className="text-sm line-clamp-2">
                                  {template.description}
                                </CardDescription>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {template.tags.map((tag) => (
                                <Badge
                                  key={tag}
                                  variant="outline"
                                  className="text-xs"
                                >
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </CardHeader>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Monaco Editor Section */}
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
                    defaultLanguage={isPerformance ? "javascript" : "typescript"}
                    value={selectedTemplate.code}
                    theme={resolvedTheme === "dark" ? "vs-dark" : "warm-light"}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
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
        <div className="border-t px-6 py-4 flex items-center justify-between bg-muted/30">
          <div className="text-sm text-muted-foreground">
            {templates.length} template{templates.length !== 1 ? "s" : ""} available
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
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
      </DialogContent>
    </Dialog>
  );
}
