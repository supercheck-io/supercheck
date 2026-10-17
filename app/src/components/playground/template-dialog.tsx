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
import { Input } from "@/components/ui/input";
import { Code2, Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMonacoTheme } from "@/lib/monaco-config";

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
    null,
  );

  const [query, setQuery] = useState("");

  // Get templates for the current test type
  const templates = getTemplatesByType(testType);

  // Group templates by category
  const filteredTemplates = templates.filter((template) =>
    [template.name, template.description, template.category, ...template.tags]
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const templatesByCategory = filteredTemplates.reduce(
    (acc, template) => {
      if (!acc[template.category]) {
        acc[template.category] = [];
      }
      acc[template.category].push(template);
      return acc;
    },
    {} as Record<string, CodeTemplate[]>,
  );

  const selectedTemplate =
    filteredTemplates.find((t) => t.id === selectedTemplateId) ??
    filteredTemplates[0];

  const handleApply = () => {
    if (selectedTemplate) {
      onApply(selectedTemplate.code);
      onOpenChange(false);
    }
  };

  // Select first template by default when dialog opens
  if (
    open &&
    !templates.some((t) => t.id === selectedTemplateId) &&
    templates.length > 0
  ) {
    setSelectedTemplateId(templates[0].id);
  }

  // Reset selection when dialog closes
  if (!open && (selectedTemplateId || query)) {
    setSelectedTemplateId(null);
    setQuery("");
  }

  const isPerformance = testType === "performance";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[calc(100%-2rem)] max-w-[1500px] sm:max-w-[1500px] h-[90dvh] flex-col p-0 gap-0">
        <DialogHeader className="px-4 sm:px-6 pt-6 pb-4 border-b shrink-0 pr-12">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-2xl">Code Templates</DialogTitle>
          </div>
          <DialogDescription className="text-base">
            Choose a starting point for{" "}
            {isPerformance ? "k6 performance" : "Playwright"} testing. Applying
            a template replaces the code in your editor; it does not save or run
            it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row overflow-hidden">
          {/* Template Selection Section with Radio Buttons */}
          <div className="flex h-[40%] min-h-0 shrink-0 flex-col border-b md:border-b-0 md:border-r md:h-auto md:w-[35%]">
            <div className="relative m-4 mb-0 shrink-0">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
              />
              <Input
                aria-label="Search templates"
                placeholder="Search templates…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
              />
            </div>
            <div className="min-h-0 overflow-auto p-4">
              <RadioGroup
                aria-label="Code templates"
                value={selectedTemplate?.id || ""}
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
                              selectedTemplate?.id === template.id &&
                                "border-primary bg-primary/5",
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
                  ),
                )}
              </RadioGroup>
              {filteredTemplates.length === 0 && (
                <p role="status" className="py-6 text-sm text-muted-foreground">
                  No matching templates. Try another search.
                </p>
              )}
            </div>
          </div>

          {/* Monaco Editor Section - Takes More Space */}
          <div className="min-h-0 min-w-0 flex-1 flex flex-col">
            {selectedTemplate ? (
              <>
                <div className="shrink-0 border-b px-4 sm:px-6 py-3 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Code2 className="h-4 w-4" />
                        {selectedTemplate.name}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {selectedTemplate.description}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {selectedTemplate.setup ??
                          (isPerformance
                            ? "Demo targets and thresholds are examples. Use your own authorized target and tune the load before running."
                            : "Adapt demo URLs, selectors, and assertions to your application before running.")}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <Editor
                    height="100%"
                    language={isPerformance ? "javascript" : "typescript"}
                    value={selectedTemplate.code}
                    theme={getMonacoTheme(resolvedTheme)}
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
        <DialogFooter className="shrink-0 border-t px-4 sm:px-6 py-4 bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
            <div className="text-sm text-muted-foreground">
              {filteredTemplates.length} of {templates.length} template
              {templates.length !== 1 ? "s" : ""} available
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
