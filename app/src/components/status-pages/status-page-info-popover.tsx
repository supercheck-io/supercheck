import React from "react";
import { Info, BookOpen } from "lucide-react";
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
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
          <Info className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 mt-2" side="right" sideOffset={8}>
        <div>
          <div className="flex items-center space-x-2 mb-3">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-semibold text-sm">Quick Setup Guide</h4>
          </div>
          <div className="space-y-3">
            {statusPageSteps.map((step, index) => (
              <div
                key={index}
                className="flex items-start space-x-3 p-2 rounded-md bg-muted/30"
              >
                {step.icon && (
                  <step.icon className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                )}
                <div>
                  <p className="font-medium text-sm">{step.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
