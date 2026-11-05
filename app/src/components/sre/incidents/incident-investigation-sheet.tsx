"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** Right-hand sheet behind "View investigation": one scrolling report (see InvestigationReport). */
export function IncidentInvestigationSheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-[600px] md:max-w-[680px] lg:max-w-[760px]" data-testid="investigation-sheet">
        <SheetHeader className="border-b px-6 pr-12">
          <SheetTitle>Investigation</SheetTitle>
          <SheetDescription>Conclusion, ranked hypotheses and the evidence behind them.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
