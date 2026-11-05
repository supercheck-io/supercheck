"use client";

import { useState } from "react";
import { Check, Copy, Play } from "lucide-react";

const CLI_INSTALL = "npm install -g @supercheck/cli";

export function CopyCommand() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CLI_INSTALL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable in insecure contexts
    }
  };

  return (
    <div className="inline-flex max-w-full items-center gap-3 rounded-md border border-fd-border bg-fd-card py-1.5 pr-1.5 pl-3 font-mono text-[13px]">
      <span className="select-none text-fd-muted-foreground">$</span>
      <code className="min-w-0 truncate">{CLI_INSTALL}</code>
      <button
        type="button"
        onClick={handleCopy}
        className="rounded p-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground focus-visible:outline-2 focus-visible:outline-fd-primary"
        aria-label={copied ? "Copied" : "Copy install command"}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

const OVERVIEW_VIDEO_ID = "D9dqy93zL9o";

/** Hero screenshot that swaps in place for the YouTube player on click, so nothing from YouTube loads until then. */
export function HeroVideo({ children }: { children: React.ReactNode }) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${OVERVIEW_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1`}
        title="Supercheck overview video"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="absolute inset-0 size-full"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label="Play the Supercheck overview video (3 minutes)"
      className="group absolute inset-0 size-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fd-primary"
    >
      {children}
      <span className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/30" aria-hidden="true" />
      <span
        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 whitespace-nowrap rounded-full bg-fd-background/95 py-3 pl-3 pr-5 text-sm font-medium text-fd-foreground shadow-lg ring-1 ring-fd-border transition-transform group-hover:scale-105"
        aria-hidden="true"
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-fd-primary text-fd-primary-foreground">
          <Play className="ml-0.5 size-4 fill-current" />
        </span>
        Watch the overview · 3 min
      </span>
    </button>
  );
}
