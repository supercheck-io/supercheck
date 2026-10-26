import Link from "next/link";
import { Circle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  {
    title: "Connect a source",
    description: "Link the tools your team already uses so investigations have evidence to read.",
    href: "/connected-apps",
    action: "Connect a source",
  },
  {
    title: "Enable alerts",
    description: "Attach notification channels to your monitors so failures open incidents.",
    href: "/alerts",
    action: "Set up alerts",
  },
  {
    title: "Run a sample investigation",
    description: "Ask Copilot to investigate an incident or a failing monitor and review the cited evidence.",
    href: "/copilot",
    action: "Open Copilot",
  },
] as const;

export function IncidentsFirstRunChecklist() {
  return (
    <Card data-testid="incidents-first-run" className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle className="text-lg">No incidents yet</CardTitle>
        <CardDescription>
          Incidents open from alerts, or you can create one manually. Three steps to get the most out of them:
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex items-start gap-3">
              <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium">
                  {index + 1}. {step.title}
                </p>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link href={step.href}>{step.action}</Link>
              </Button>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
