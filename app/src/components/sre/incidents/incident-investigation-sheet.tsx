"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export type InvestigationSection = {
  id: string;
  title: string;
  /** Sections without content for this incident are left out. */
  content: React.ReactNode | null;
};

/** Right-hand sheet that holds everything behind "Investigation details". */
export function IncidentInvestigationSheet({
  open,
  onOpenChange,
  sections,
  expanded,
  onExpandedChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: InvestigationSection[];
  expanded: string[];
  onExpandedChange: (value: string[]) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-2xl" data-testid="investigation-sheet">
        <SheetHeader className="border-b">
          <SheetTitle>Investigation details</SheetTitle>
          <SheetDescription>Run controls, hypotheses, steps, evidence and reports for this incident.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <Accordion type="multiple" value={expanded} onValueChange={onExpandedChange}>
            {sections
              .filter((section) => section.content !== null)
              .map((section) => (
                <AccordionItem key={section.id} value={section.id} id={`incident-section-${section.id}`}>
                  <AccordionTrigger>{section.title}</AccordionTrigger>
                  <AccordionContent>{section.content}</AccordionContent>
                </AccordionItem>
              ))}
          </Accordion>
        </div>
      </SheetContent>
    </Sheet>
  );
}
