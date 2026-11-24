"use client";

import type { ReactNode } from "react";
import { format } from "date-fns";
import { Clock, Code2, ExternalLink, FileSearch, FileText, ScrollText, ShieldCheck, type LucideIcon } from "lucide-react";
import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { IconChip } from "@/components/ui/icon-chip";
import { isSafeEvidenceSourceUri } from "@/lib/sre/evidence-source-uri";
import { cn } from "@/lib/utils";

/** `children` replaces the default "View" button as the dialog trigger (for example a citation chip). */
/** Saved incident evidence, or the evidence a Copilot reply cited. */
type EvidenceDetailsItem = Pick<
  SreIncidentDetail["evidence"][number],
  "title" | "summary" | "sourceUri" | "citationQuery" | "rawContentExcerpt"
> & { observedAt: Date | string | null };

function Section({ icon: Icon, iconClass, label, children }: { icon: LucideIcon; iconClass: string; label: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", iconClass)} aria-hidden="true" />
        {label}
      </h3>
      {children}
    </section>
  );
}

export function EvidenceDetailsDialog({ item, children }: { item: EvidenceDetailsItem; children?: React.ReactNode }) {
  const external = /^https?:/i.test(item.sourceUri);
  const observed = item.observedAt ? new Date(item.observedAt) : null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        {children ?? <Button variant="ghost" size="sm" aria-label={`View evidence: ${item.title}`}>View</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] gap-5 overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="flex-row items-start gap-3 space-y-0 pr-6 text-left">
          <IconChip icon={FileSearch} tone="ai" size="md" />
          <div className="min-w-0 space-y-1">
            <DialogTitle className="break-words text-base leading-snug">{item.title}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1" suppressHydrationWarning>
                <Clock className="h-3.5 w-3.5 text-type-purple" aria-hidden="true" />
                {observed && !Number.isNaN(observed.getTime()) ? `Observed ${format(observed, "MMM d, yyyy HH:mm:ss")}` : "Observed time not recorded"}
              </span>
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                Saved copy, viewing it does not query the provider again
              </span>
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <Section icon={FileText} iconClass="text-type-sky" label="Summary">
            <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3">{item.summary || "No summary recorded."}</p>
          </Section>
          {item.citationQuery && (
            <Section icon={Code2} iconClass="text-type-teal" label="Query reference">
              <pre className="whitespace-pre-wrap break-all rounded-md border bg-muted/30 p-3 font-mono text-xs">{item.citationQuery}</pre>
            </Section>
          )}
          {item.rawContentExcerpt && (
            <Section icon={ScrollText} iconClass="text-type-indigo" label="Saved excerpt">
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 font-mono text-xs">{item.rawContentExcerpt}</pre>
            </Section>
          )}
        </div>
        {isSafeEvidenceSourceUri(item.sourceUri) && (
          <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            {external ? <p className="text-xs text-muted-foreground">The source may need provider sign-in or access to its private network.</p> : <span />}
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <a href={item.sourceUri} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
                Open original source
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
