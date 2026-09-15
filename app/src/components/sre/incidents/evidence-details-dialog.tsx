"use client";

import { ExternalLink } from "lucide-react";
import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { isSafeEvidenceSourceUri } from "@/lib/sre/evidence-source-uri";

export function EvidenceDetailsDialog({ item }: { item: SreIncidentDetail["evidence"][number] }) {
  const external = /^https?:/i.test(item.sourceUri);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`View evidence: ${item.title}`}>View</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-words">{item.title}</DialogTitle>
          <DialogDescription>Saved evidence for this incident. Viewing it does not run another provider query.</DialogDescription>
        </DialogHeader>
        <dl className="space-y-4 text-sm">
          <div><dt className="font-medium">Summary</dt><dd className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{item.summary || "No summary recorded."}</dd></div>
          <div><dt className="font-medium">Observed</dt><dd suppressHydrationWarning>{item.observedAt ? new Date(item.observedAt).toLocaleString() : "Not recorded"}</dd></div>
          <div><dt className="font-medium">Evidence ID</dt><dd className="break-all font-mono text-xs">{item.id}</dd></div>
          {item.citationQuery && <div><dt className="font-medium">Query reference</dt><dd className="mt-1 whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">{item.citationQuery}</dd></div>}
          {item.rawContentExcerpt && <div><dt className="font-medium">Saved excerpt</dt><dd className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">{item.rawContentExcerpt}</dd></div>}
        </dl>
        {isSafeEvidenceSourceUri(item.sourceUri) && (
          <div className="space-y-2 border-t pt-4">
            <Button asChild variant="outline"><a href={item.sourceUri} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>Open original source <ExternalLink className="ml-2 h-4 w-4" /></a></Button>
            {external && <p className="text-xs text-muted-foreground">The original source may require provider sign-in or access to its private network.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
