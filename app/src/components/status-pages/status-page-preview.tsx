"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ExternalLink, Eye, Tally4, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type StatusPagePreviewProps = {
  statusPageId: string;
  statusPageName: string;
};

/** Opens the signed-in preview of a status page in the full-screen overlay used for test and k6 reports. */
export function StatusPagePreview({ statusPageId, statusPageName }: StatusPagePreviewProps) {
  const [open, setOpen] = useState(false);
  const previewUrl = `/status-pages/${statusPageId}/public`;

  // Keys pressed inside the same-origin preview never reach this document, so Escape is also heard there.
  const listenInFrame = (frame: HTMLIFrameElement) => {
    frame.contentDocument?.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) setOpen(false);
    });
  };

  return (
    // The dialog primitive traps focus, makes the page behind inert, locks scrolling and closes on Escape.
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button variant="outline" className="border-2 hover:bg-muted">
          <Eye className="mr-2 h-4 w-4" />
          Preview
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-card/80 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-lg border bg-card shadow-lg focus:outline-none sm:inset-8"
        >
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <div className="flex min-w-0 items-center gap-2">
              <Tally4 className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <DialogPrimitive.Title className="truncate text-xl font-semibold">{statusPageName}</DialogPrimitive.Title>
              <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">Preview</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={previewUrl} target="_blank" rel="noopener noreferrer" aria-label="Open in new tab">
                  <ExternalLink className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Open in new tab</span>
                </a>
              </Button>
              <DialogPrimitive.Close asChild>
                <Button className="cursor-pointer bg-secondary hover:bg-secondary/90" size="sm" aria-label="Close preview">
                  <X className="h-4 w-4 text-secondary-foreground" />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>
          <iframe
            src={previewUrl}
            title={`${statusPageName} preview`}
            className="h-full w-full flex-grow border-0 bg-background"
            onLoad={(event) => listenInFrame(event.currentTarget)}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
