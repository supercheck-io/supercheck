"use client";

import { ExternalLink } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { CopyValueButton } from "../copy-value-button";
import type { StepProps } from "./step-types";

export const CLI_COMMANDS = [
  { label: "Sign in", command: "npx supercheck login --json" },
  { label: "Start a project", command: "npx supercheck init --skip-examples" },
  { label: "See what is set up", command: "npx supercheck onboard --json" },
  { label: "Preview a deploy", command: "npx supercheck deploy --dry-run --json" },
];

export const CODING_RECIPE_URL = "https://supercheck.io/docs/cli/after-ship-check";

/** Copy-only panel; credentials are only entered in the browser. */
export function DeveloperStep({ features }: StepProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Set up from your terminal or a coding agent. The browser steps create the same things, and credentials are only entered in the browser.</p>
      <ul className="space-y-2">
        {CLI_COMMANDS.map((item) => (
          <li key={item.command} className="flex items-center gap-3 rounded-lg border px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <code className="block truncate font-mono text-sm">{item.command}</code>
            </div>
            <CopyValueButton value={item.command} label={`Copy ${item.command}`} />
          </li>
        ))}
      </ul>
      {features.codingRecipe ? (
        <Alert variant="info">
          <a className="inline-flex items-center gap-1 font-medium underline underline-offset-4" href={CODING_RECIPE_URL} target="_blank" rel="noreferrer">
            Follow the coding-agent recipe <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </Alert>
      ) : null}
    </div>
  );
}
