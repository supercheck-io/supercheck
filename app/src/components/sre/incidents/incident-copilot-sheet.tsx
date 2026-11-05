"use client";

import Link from "next/link";

import { SreCopilotPageClient } from "@/components/sre/sre-copilot-page-client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** Copilot chat scoped to one incident, beside the page. Mounted only while open, so closed pages load no chat history. */
export function IncidentCopilotSheet({
  open,
  onOpenChange,
  incidentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-[560px] lg:max-w-[680px]" data-testid="incident-copilot-sheet">
        <SheetHeader className="border-b px-6 pr-12">
          <SheetTitle>Copilot</SheetTitle>
          <SheetDescription>
            Ask about this incident and its evidence.{" "}
            <Link className="underline underline-offset-4" href={`/copilot?incident=${incidentId}`}>
              Open full page
            </Link>
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1">{open && <SreCopilotPageClient initialIncidentId={incidentId} />}</div>
      </SheetContent>
    </Sheet>
  );
}
