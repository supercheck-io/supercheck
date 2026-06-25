import { Clock, Siren } from "lucide-react";
import Link from "next/link";

import type { SreIncidentListItem } from "@/actions/sre-incidents";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type SreIncidentsListProps = {
  incidents: SreIncidentListItem[];
  loadError: string | null;
};

const severityClasses: Record<SreIncidentListItem["severity"], string> = {
  sev1: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
  sev2: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300",
  sev3: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  sev4: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
};

const statusClasses: Record<SreIncidentListItem["status"], string> = {
  triggered: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
  investigating: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300",
  identified: "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900/60 dark:bg-purple-950/40 dark:text-purple-300",
  recommendations_ready: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-300",
  user_applying_fix: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300",
  verifying: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
};

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatStatus(value: string) {
  return value.replace(/_/g, " ");
}

export function SreIncidentsList({ incidents, loadError }: SreIncidentsListProps) {
  if (loadError) {
    return (
      <DashboardEmptyState
        className="min-h-[420px]"
        title="Incidents unavailable"
        description={loadError}
        icon={<Siren className="h-10 w-10" />}
      />
    );
  }

  return (
    <div className="space-y-4 pt-6">
      <div className="mb-4 -mt-2 flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-2xl font-semibold">Incidents</h2>
          <p className="text-sm text-muted-foreground">
            Manage SRE incidents, evidence, recommendations, and verification
          </p>
        </div>
      </div>

      {incidents.length === 0 ? (
        <DashboardEmptyState
          className="min-h-[420px]"
          title="No SRE incidents yet"
          description="Create an incident from the SRE Alerts tab when an alert needs investigation, evidence collection, or follow-up."
          icon={<Siren className="h-10 w-10" />}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Incident</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Alerts</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incidents.map((incident) => (
                <TableRow key={incident.id}>
                  <TableCell className="min-w-[320px] whitespace-normal">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">#{incident.incidentNumber}</Badge>
                        <Link href={`/incidents/${incident.id}`} className="font-medium text-primary hover:underline">
                          {incident.title}
                        </Link>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Created {formatDate(incident.createdAt)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("uppercase", severityClasses[incident.severity])}>
                      {incident.severity}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("capitalize", statusClasses[incident.status])}>
                      {formatStatus(incident.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{incident.primaryServiceName ?? "Unmapped"}</TableCell>
                  <TableCell>{incident.alertCount}</TableCell>
                  <TableCell>
                    <div className="inline-flex items-center gap-1 text-sm">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      {formatDate(incident.updatedAt)}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
