"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

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
