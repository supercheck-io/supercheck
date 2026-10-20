import React from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { statusPageSteps } from "./data";

export function StatusPageInfoPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          aria-label="Quick setup guide"
        >
          <Info className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[28rem] max-w-[calc(100vw-2rem)]"
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={16}
      >
        <h4 className="text-sm font-semibold">Quick setup guide</h4>
        <p className="mb-3 text-xs text-muted-foreground">
          Six steps from draft to a live status page.
        </p>
        <ol className="space-y-1">
          {statusPageSteps.map((step, index) => (
            <li
              key={step.title}
              className="flex items-start gap-3 rounded-md p-2 hover:bg-muted/40"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <step.icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  <span className="mr-1.5 text-muted-foreground">
                    {index + 1}.
                  </span>
                  {step.title}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </PopoverContent>
    </Popover>
  );
}
