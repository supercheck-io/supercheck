"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Eye, Tally4, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type StatusPagePreviewProps = {
  statusPageId: string;
  statusPageName: string;
};

/** Opens the signed-in preview of a status page in the full-screen overlay used for test and k6 reports. */
export function StatusPagePreview({ statusPageId, statusPageName }: StatusPagePreviewProps) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previewUrl = `/status-pages/${statusPageId}/public`;

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <Button variant="outline" className="border-2 hover:bg-muted" onClick={() => setOpen(true)}>
        <Eye className="mr-2 h-4 w-4" />
        Preview
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 bg-card/80 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="status-page-preview-title"
            className="fixed inset-2 flex flex-col overflow-hidden rounded-lg border bg-card shadow-lg sm:inset-8"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <div className="flex min-w-0 items-center gap-2">
                <Tally4 className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <h2 id="status-page-preview-title" className="truncate text-xl font-semibold">
                  {statusPageName}
                </h2>
                <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">Preview</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">Open in new tab</span>
                  </a>
                </Button>
                <Button
                  ref={closeRef}
                  className="cursor-pointer bg-secondary hover:bg-secondary/90"
                  size="sm"
                  aria-label="Close preview"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-4 w-4 text-secondary-foreground" />
                </Button>
              </div>
            </div>
            <iframe src={previewUrl} title={`${statusPageName} preview`} className="h-full w-full flex-grow border-0 bg-background" />
          </div>
        </div>
      )}
    </>
  );
}
