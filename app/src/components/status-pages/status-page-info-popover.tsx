import React from "react";
import { Info, Tally4 } from "lucide-react";
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
            <Tally4 className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-semibold text-sm">Status Page</h4>
          </div>
          <div className="space-y-2">
            {statusPageSteps.map((step, index) => (
              <div
                key={index}
                className="flex items-start space-x-3 p-1 rounded-md "
              >
                <div className="text-xs text-muted-foreground mt-0.5 font-bold">
                  {index + 1}.
                </div>
                <p className="text-xs font-medium text-muted-foreground leading-relaxed">
                  {step}
                </p>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
