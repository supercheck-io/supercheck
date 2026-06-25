"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, FileSearch, Search } from "lucide-react";

import type { SreInvestigationHistoryItem } from "@/lib/sre/investigation-queries";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SreInvestigationsTableProps = {
  investigations: SreInvestigationHistoryItem[];
  loadError?: string | null;
};

function formatDuration(durationMs: number | null) {
  if (durationMs == null) {
    return "-";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatCost(costCents: number | null) {
  if (costCents == null) {
    return "-";
  }

  return `$${(costCents / 100).toFixed(2)}`;
}

function downloadInvestigation(item: SreInvestigationHistoryItem) {
  const blob = new Blob([JSON.stringify(item, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sre-investigation-${item.id}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function SreInvestigationsTable({ investigations, loadError = null }: SreInvestigationsTableProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [agentType, setAgentType] = useState("all");
  const hasActiveFilters = Boolean(query.trim()) || status !== "all" || agentType !== "all";

  const filteredInvestigations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return investigations.filter((item) => {
      const matchesStatus = status === "all" || item.status === status;
      const matchesAgentType = agentType === "all" || item.agentType === agentType;
      const searchable = [
        item.incidentTitle,
        item.rootCauseHypothesis,
        item.serviceName,
        item.severity,
        item.modelId,
        item.status,
        item.agentType,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesStatus && matchesAgentType && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [agentType, investigations, query, status]);

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>SRE investigations unavailable</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="rounded-3xl">
      <CardHeader className="border-b bg-muted/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <FileSearch className="h-5 w-5" />
              Investigation history
            </CardTitle>
            <CardDescription>
              Search completed and in-progress SRE agent runs by incident, service, model, status, and root-cause text.
            </CardDescription>
          </div>
          <Badge variant="secondary" className="w-fit rounded-full">{filteredInvestigations.length} visible</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search service, root cause, severity, model..."
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="timed_out">Timed out</SelectItem>
              <SelectItem value="aborted">Aborted</SelectItem>
            </SelectContent>
          </Select>
          <Select value={agentType} onValueChange={setAgentType}>
            <SelectTrigger><SelectValue placeholder="Agent" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              <SelectItem value="triage">Triage</SelectItem>
              <SelectItem value="investigation">Investigation</SelectItem>
              <SelectItem value="background">Background</SelectItem>
              <SelectItem value="sre_ai">SRE AI</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setQuery("");
              setStatus("all");
              setAgentType("all");
            }}
            disabled={!hasActiveFilters}
          >
            Clear
          </Button>
        </div>

        <div className="overflow-x-auto rounded-2xl border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead>Incident</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInvestigations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    {hasActiveFilters ? "No SRE investigations match the current filters." : "No SRE investigations have been recorded yet."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredInvestigations.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-[360px]">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.incidentId ? (
                            <Link href={`/incidents/${item.incidentId}`} className="font-medium hover:underline">
                              {item.incidentNumber ? `#${item.incidentNumber} ` : ""}{item.incidentTitle ?? "Untitled incident"}
                            </Link>
                          ) : (
                            <span className="font-medium">Unscoped investigation</span>
                          )}
                          <Badge variant="outline" className="capitalize">{item.agentType}</Badge>
                        </div>
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {item.rootCauseHypothesis ?? "No root-cause summary captured yet."}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === "completed" ? "secondary" : "outline"} className="capitalize">
                        {item.status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>{item.serviceName ?? "-"}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {item.evidenceCount} evidence
                        <p className="text-xs text-muted-foreground">{item.toolCallCount} tools · {item.recommendationCount} recs</p>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.modelId}</TableCell>
                    <TableCell>{formatDuration(item.durationMs)}</TableCell>
                    <TableCell>{formatCost(item.estimatedCostCents)}</TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="outline" size="sm" onClick={() => downloadInvestigation(item)}>
                        <Download className="h-4 w-4" />
                        Export
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
