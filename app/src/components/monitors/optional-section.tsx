import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** The bordered collapsible card the monitor forms use for optional settings (Authentication, Advanced, ...). */
export function OptionalSection({
  title,
  description,
  open,
  onOpenChange,
  children,
  testId,
}: {
  title: ReactNode;
  description: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Card>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <CardHeader
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenChange(!open);
              }
            }}
            className="cursor-pointer rounded-t-lg pb-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={testId}
          >
            <div className="flex items-center space-x-2">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <CardTitle className="text-base">{title}</CardTitle>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">Optional</span>
            </div>
            <CardDescription className="text-sm">{description}</CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
