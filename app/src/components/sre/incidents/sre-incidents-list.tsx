"use client";

import { useState, useTransition } from "react";
import { Clock, Loader2, Plus, Siren } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createManualSreIncident, type SreIncidentListItem } from "@/actions/sre-incidents";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
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
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<SreIncidentListItem["severity"]>("sev3");
  const [summary, setSummary] = useState("");
  const [isPending, startTransition] = useTransition();

  const resetForm = () => {
    setTitle("");
    setSeverity("sev3");
    setSummary("");
  };

  const handleCreateIncident = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error("Incident title is required");
      return;
    }

    startTransition(async () => {
      const result = await createManualSreIncident({
        title: trimmedTitle,
        severity,
        summary: summary.trim() || null,
      });

      if (!result.success) {
        toast.error(result.fieldErrors?.title?.[0] ?? result.error);
        return;
      }

      toast.success(result.message);
      setDialogOpen(false);
      resetForm();
      router.push(`/incidents/${result.incident.id}`);
      router.refresh();
    });
  };

  if (loadError) {
    return (
      <DashboardEmptyState
        className="min-h-[260px]"
        title="Incidents unavailable"
        description={loadError}
        icon={<Siren className="h-10 w-10" />}
      />
    );
  }

  return (
    <div className="space-y-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="text-xl font-semibold">Incident queue</h2>
          <p className="text-sm text-muted-foreground">
            Create incidents manually or from alert signals, then investigate them here.
          </p>
        </div>
        <Button type="button" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          New incident
        </Button>
      </div>

      {incidents.length === 0 ? (
        <DashboardEmptyState
          className="min-h-[260px]"
          title="No incidents yet"
          description="Create one manually, or create one from an alert signal when it needs investigation."
          icon={<Siren className="h-10 w-10" />}
          action={
            <Button type="button" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              New incident
            </Button>
          }
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
                  <TableCell className="min-w-[320px] whitespace-normal py-2.5">
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
                  <TableCell className="py-2.5">
                    <Badge variant="outline" className={cn("uppercase", severityClasses[incident.severity])}>
                      {incident.severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2.5">
                    <Badge variant="outline" className={cn("capitalize", statusClasses[incident.status])}>
                      {formatStatus(incident.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2.5">{incident.primaryServiceName ?? "Unmapped"}</TableCell>
                  <TableCell className="py-2.5">{incident.alertCount}</TableCell>
                  <TableCell className="py-2.5">
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create incident</DialogTitle>
            <DialogDescription>
              Use this when an incident did not start from an alert. Alert-created incidents still come from the Alerts page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="manual-incident-title">Title</Label>
              <Input
                id="manual-incident-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Checkout API failures"
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-incident-severity">Severity</Label>
              <Select value={severity} onValueChange={(value) => setSeverity(value as SreIncidentListItem["severity"])}>
                <SelectTrigger id="manual-incident-severity">
                  <SelectValue placeholder="Select severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sev1">SEV1 - Critical</SelectItem>
                  <SelectItem value="sev2">SEV2 - High</SelectItem>
                  <SelectItem value="sev3">SEV3 - Medium</SelectItem>
                  <SelectItem value="sev4">SEV4 - Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-incident-summary">Initial notes</Label>
              <Textarea
                id="manual-incident-summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="What is known so far?"
                rows={4}
                maxLength={2000}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleCreateIncident} disabled={isPending || !title.trim()}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create incident"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
