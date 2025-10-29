import React from "react";
import { Info, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { monitorTypes } from "./data";

export function MonitorTypesPopover() {
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
            <Globe className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-semibold text-sm">Uptime Monitor Types</h4>
          </div>
          <div className="space-y-3">
            {monitorTypes.map((type) => (
              <div key={type.value} className="flex items-start space-x-3 p-2 rounded-md bg-muted/30">
                {type.icon && (
                  <type.icon className={`h-4 w-4 ${type.color} mt-0.5 flex-shrink-0`} />
                )}
                <div>
                  <p className="font-medium text-sm">{type.label}</p>
                  <p className="text-xs text-muted-foreground">{type.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
} 