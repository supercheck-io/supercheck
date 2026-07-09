"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  CheckCircle2,
  Loader2,
  SearchCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type SreInvestigationPanelProps = {
  incidentId: string;
  hasPrimaryService: boolean;
  serviceMappingHref: string;
  evidenceReferences?: Array<{
    id: string;
    title: string;
    evidenceType: string;
  }>;
};

type ReadinessItem = {
  label: string;
  description: string;
  ready: boolean;
  action?: {
    label: string;
    href: string;
  };
};

function ReadinessRow({ item }: { item: ReadinessItem }) {
  return (
    <div className="flex items-start gap-3 border-b py-3 last:border-b-0">
      {item.ready ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
      ) : (
        <TriangleAlert className="mt-0.5 h-4 w-4 text-amber-500" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{item.label}</p>
          <Badge variant="outline" className="capitalize">
            {item.ready ? "Ready" : "Needs attention"}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
        {!item.ready && item.action && (
          <Button asChild variant="link" className="mt-1 h-auto p-0 text-sm">
            <Link href={item.action.href}>{item.action.label}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export function SreInvestigationPanel({
  incidentId,
  hasPrimaryService,
  serviceMappingHref,
  evidenceReferences = [],
}: SreInvestigationPanelProps) {
  const router = useRouter();
  const [useLiveConnectors, setUseLiveConnectors] = useState(false);
  const [isInvestigating, startInvestigationTransition] = useTransition();

  const readinessItems: ReadinessItem[] = [
    {
      label: "Stored evidence",
      ready: evidenceReferences.length > 0,
      description:
        evidenceReferences.length > 0
          ? `${evidenceReferences.length} evidence item${evidenceReferences.length === 1 ? "" : "s"} available for citations.`
          : "Generate a brief or collect evidence before relying on an investigation summary.",
    },
    {
      label: "Service mapping",
      ready: hasPrimaryService,
      description: hasPrimaryService
        ? "Live connector tools can be scoped to the incident service."
        : "Map a primary service before using live connector tools.",
      action: hasPrimaryService
        ? undefined
        : { label: "Map service", href: serviceMappingHref },
    },
    {
      label: "Connector tools",
      ready: !useLiveConnectors || hasPrimaryService,
      description: useLiveConnectors
        ? "Connectors will run read-only with service scope and output limits."
        : "Live connectors are optional; stored evidence can still support the investigation.",
    },
  ];

  const runInvestigation = () => {
    startInvestigationTransition(async () => {
      const response = await fetch("/api/sre/investigate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ incidentId, useLiveConnectors }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        summary?: string;
      } | null;

      if (!response.ok) {
        toast.error(body?.error ?? "SRE investigation failed");
        return;
      }

      toast.success("Investigation completed", {
        description: body?.summary
          ? body.summary.slice(0, 120)
          : "Incident summary updated",
      });
      router.refresh();
    });
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-lg">Investigation</CardTitle>
            <CardDescription>
              Run a read-only check from stored evidence and optional live
              connector data.
            </CardDescription>
          </div>
          <Button
            className="w-full sm:w-auto"
            onClick={runInvestigation}
            disabled={isInvestigating}
          >
            {isInvestigating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <SearchCheck className="mr-2 h-4 w-4" />
            )}
            Run investigation
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3 rounded-lg border bg-muted/10 p-4">
          <Switch
            id="live-connectors"
            checked={useLiveConnectors}
            disabled={!hasPrimaryService || isInvestigating}
            onCheckedChange={setUseLiveConnectors}
          />
          <div className="space-y-1">
            <Label htmlFor="live-connectors">Use live connector tools</Label>
            <p className="text-sm text-muted-foreground">
              Optional read-only connector execution. Requires a mapped primary
              service.
            </p>
            {!hasPrimaryService && (
              <Badge variant="outline">Primary service required</Badge>
            )}
          </div>
        </div>

        <div className="rounded-lg border px-4">
          {readinessItems.map((item) => (
            <ReadinessRow key={item.label} item={item} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
