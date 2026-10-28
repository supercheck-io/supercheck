"use client";

import Image from "next/image";
import { useState } from "react";
import { Check, Copy, Play } from "lucide-react";
import { versioned } from "../../lib/assets";

const CLI_INSTALL = "npm install -g @supercheck/cli";
const YOUTUBE_VIDEO_ID = "A9CzmekuvfI";

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

export function DemoVideo() {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-[0_1px_2px_rgb(0_0_0/0.04),0_24px_48px_-24px_rgb(0_0_0/0.25)]">
      {isPlaying ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${YOUTUBE_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
          title="Supercheck product demo"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
          ref={(frame) => frame?.focus()}
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsPlaying(true)}
          className="group absolute inset-0 h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-fd-primary focus-visible:ring-inset"
          aria-label="Play the product demo video"
        >
          <Image
            src={versioned("/supercheck-screenshot.webp")}
            alt="Supercheck monitor detail view with availability and response time charts"
            fill
            sizes="(min-width: 1152px) 1152px, 100vw"
            className="object-cover object-top"
            priority
          />
          <span className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
          <span className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-md bg-fd-background/95 px-3 py-2 text-sm font-medium text-fd-foreground shadow-sm ring-1 ring-fd-border sm:bottom-6 sm:left-6">
            <Play className="size-4 fill-current" aria-hidden="true" />
            Watch the product demo
          </span>
        </button>
      )}
    </div>
  );
}
