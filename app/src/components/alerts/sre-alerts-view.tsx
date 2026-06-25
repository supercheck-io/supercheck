"use client";

import { useDeferredValue, useState, useTransition } from "react";
import { AlertTriangle, BellRing, CheckCircle2, Clock, Search, Siren } from "lucide-react";
import { toast } from "sonner";

import { createSreIncidentFromAlert } from "@/actions/sre-incidents";
import type { AlertHistory } from "@/components/alerts/schema";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type SreAlertSeverity = "sev1" | "sev2" | "sev3" | "sev4";
type SreAlertStatus = "firing" | "resolved" | "pending" | "notification_failed";

type DerivedSreAlert = {
  id: string;
  fingerprint: string;
  targetName: string;
  targetType: string;
  source: string;
  serviceHint: string;
  type: string;
  message: string;
  severity: SreAlertSeverity;
  status: SreAlertStatus;
  notificationProvider: string;
  timestamp: string;
  duplicateCount: number;
};

type SreAlertsViewProps = {
  alerts: AlertHistory[];
  isLoading: boolean;
};

const severityClasses: Record<SreAlertSeverity, string> = {
  sev1: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
  sev2: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300",
  sev3: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  sev4: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
};

const statusClasses: Record<SreAlertStatus, string> = {
  firing: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  pending: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300",
  notification_failed: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
};

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function deriveSeverity(alert: AlertHistory): SreAlertSeverity {
  const type = alert.type.toLowerCase();
  const message = alert.message.toLowerCase();

  if (message.includes("sev1") || message.includes("critical") || type.includes("timeout")) {
    return "sev1";
  }

  if (type.includes("failure") || type.includes("failed")) {
    return "sev2";
  }

  if (type.includes("ssl") || message.includes("expir")) {
    return "sev3";
  }

  return "sev4";
}

function deriveStatus(alert: AlertHistory): SreAlertStatus {
  const type = alert.type.toLowerCase();

  if (alert.status === "pending") return "pending";
  if (alert.status === "failed") return "notification_failed";
  if (type.includes("recovery") || type.includes("success")) return "resolved";

  return "firing";
}

function deriveSource(alert: AlertHistory) {
  if (alert.targetType === "monitor") return "Monitor";
  if (alert.type.toLowerCase().includes("job")) return "Job";
  return titleCase(alert.targetType);
}

function deriveServiceHint(alert: AlertHistory) {
  const target = alert.targetName.trim();
  if (!target) return "Unmapped service";

  return target
    .replace(/\s+(monitor|job|check|test)$/i, "")
    .replace(/\s+-\s+(monitor|job|check|test)$/i, "")
    .trim() || target;
}

function deriveFingerprint(alert: AlertHistory) {
  return [alert.targetType, alert.targetId || alert.targetName, alert.type]
    .join(":")
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function deriveSreAlerts(alerts: AlertHistory[]) {
  const fingerprintCounts = new Map<string, number>();
  for (const alert of alerts) {
    const fingerprint = deriveFingerprint(alert);
    fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) ?? 0) + 1);
  }

  return alerts.map((alert): DerivedSreAlert => {
    const fingerprint = deriveFingerprint(alert);
    return {
      id: alert.id,
      fingerprint,
      targetName: alert.targetName,
      targetType: alert.targetType,
      source: deriveSource(alert),
      serviceHint: deriveServiceHint(alert),
      type: titleCase(alert.type),
      message: alert.message,
      severity: deriveSeverity(alert),
      status: deriveStatus(alert),
      notificationProvider: alert.notificationProvider,
      timestamp: alert.timestamp,
      duplicateCount: fingerprintCounts.get(fingerprint) ?? 1,
    };
  });
}

function alertMatches(alert: DerivedSreAlert, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;

  return [
    alert.targetName,
    alert.source,
    alert.serviceHint,
    alert.type,
    alert.message,
    alert.fingerprint,
    alert.notificationProvider,
  ].some((value) => value.toLowerCase().includes(query));
}

export function SreAlertsView({ alerts, isLoading }: SreAlertsViewProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [incidentByAlertId, setIncidentByAlertId] = useState<Record<string, number>>({});
  const [pendingAlertId, setPendingAlertId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const derivedAlerts = deriveSreAlerts(alerts);
  const sourceOptions = Array.from(new Set(derivedAlerts.map((alert) => alert.source))).sort();
  const firingCount = derivedAlerts.filter((alert) => alert.status === "firing").length;
  const sevOneTwoCount = derivedAlerts.filter((alert) => alert.severity === "sev1" || alert.severity === "sev2").length;
  const deduplicatedCount = derivedAlerts.filter((alert) => alert.duplicateCount > 1).length;

  const filteredAlerts = derivedAlerts.filter((alert) => {
    const matchesStatus = statusFilter === "all" || alert.status === statusFilter;
    const matchesSeverity = severityFilter === "all" || alert.severity === severityFilter;
    const matchesSource = sourceFilter === "all" || alert.source === sourceFilter;
    return matchesStatus && matchesSeverity && matchesSource && alertMatches(alert, deferredSearch);
  });

  const handleCreateIncident = (alertHistoryId: string) => {
    setPendingAlertId(alertHistoryId);
    startTransition(async () => {
      const result = await createSreIncidentFromAlert({ alertHistoryId });
      setPendingAlertId(null);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setIncidentByAlertId((current) => ({
        ...current,
        [alertHistoryId]: result.incident.incidentNumber,
      }));
      toast.success(result.message);
    });
  };

  if (isLoading && alerts.length === 0) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <SuperCheckLoading size="md" message="Deriving SRE alerts..." />
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <DashboardEmptyState
        className="min-h-[60vh]"
        title="No SRE alerts yet"
        description="SRE alerts are derived from alert history. They will appear here after monitors or jobs emit notifications."
        icon={<Siren className="h-12 w-12" />}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <CardTitle className="text-2xl font-semibold">SRE Alerts</CardTitle>
          <CardDescription>
            Alert-history events normalized into investigation-ready signals with derived severity and fingerprints.
          </CardDescription>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <BellRing className="h-3.5 w-3.5" />
            Firing
          </div>
          <p className="mt-2 text-2xl font-semibold">{firingCount}</p>
        </div>
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            Sev1 / Sev2
          </div>
          <p className="mt-2 text-2xl font-semibold">{sevOneTwoCount}</p>
        </div>
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Repeated fingerprints
          </div>
          <p className="mt-2 text-2xl font-semibold">{deduplicatedCount}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="relative lg:max-w-sm lg:flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search target, service, fingerprint..."
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="lg:w-48">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="firing">Firing</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="notification_failed">Notification failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="lg:w-40">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="sev1">SEV1</SelectItem>
            <SelectItem value="sev2">SEV2</SelectItem>
            <SelectItem value="sev3">SEV3</SelectItem>
            <SelectItem value="sev4">SEV4</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="lg:w-44">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {sourceOptions.map((source) => (
              <SelectItem key={source} value={source}>
                {source}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Signal</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Fingerprint</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead className="w-36" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAlerts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                  No SRE alerts match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              filteredAlerts.map((alert) => (
                <TableRow key={alert.id}>
                  <TableCell className="min-w-[280px] whitespace-normal">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{alert.targetName}</span>
                        <Badge variant="secondary">{alert.serviceHint}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{alert.type}</p>
                      <p className="line-clamp-2 max-w-xl text-xs text-muted-foreground">{alert.message}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("uppercase", severityClasses[alert.severity])}>
                      {alert.severity}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("capitalize", statusClasses[alert.status])}>
                      {alert.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <p>{alert.source}</p>
                      <p className="text-xs text-muted-foreground">{alert.notificationProvider}</p>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate font-mono text-xs">
                    {alert.fingerprint}
                    {alert.duplicateCount > 1 && (
                      <Badge variant="outline" className="ml-2 font-sans text-[11px]">
                        x{alert.duplicateCount}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="inline-flex items-center gap-1 text-sm">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      {formatTimestamp(alert.timestamp)}
                    </div>
                  </TableCell>
                  <TableCell>
                    {incidentByAlertId[alert.id] ? (
                      <Badge variant="secondary">Incident #{incidentByAlertId[alert.id]}</Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCreateIncident(alert.id)}
                        disabled={isPending && pendingAlertId === alert.id}
                      >
                        {isPending && pendingAlertId === alert.id ? "Creating..." : "Create incident"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
