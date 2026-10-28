"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  createManualSreIncident,
  type SreIncidentListItem,
} from "@/actions/sre-incidents";
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
import { Textarea } from "@/components/ui/textarea";
import { checkRolePermissionsClient } from "@/lib/rbac/permissions-client";
import { useProjectContext } from "@/hooks/use-project-context";
import {
  getSreEvidenceGraphQueryKey,
  getSreIncidentAnalyticsQueryKey,
  getSreIncidentsQueryKey,
} from "@/lib/sre/query-keys";

/** "New incident" button (permission gated) plus its create dialog. */
export function NewIncidentAction() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    projectId,
    currentProject,
    loading: projectLoading,
    error: projectError,
  } = useProjectContext();
  const canCreate = Boolean(
    !projectLoading &&
      !projectError &&
      currentProject?.userRole &&
      checkRolePermissionsClient(currentProject.userRole, {
        sre_incident: ["create"],
      }),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] =
    useState<SreIncidentListItem["severity"]>("sev3");
  const [summary, setSummary] = useState("");
  const [isPending, startTransition] = useTransition();

  const resetForm = () => {
    setTitle("");
    setSeverity("sev3");
    setSummary("");
  };

  const handleCreateIncident = () => {
    if (!canCreate || isPending) return;
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
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getSreIncidentsQueryKey(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: getSreIncidentAnalyticsQueryKey(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: getSreEvidenceGraphQueryKey(projectId),
        }),
      ]);
      router.push(`/incidents/${result.incident.id}`);
    });
  };

  return (
    <>
      {projectError && (
        <p role="status" className="text-sm text-muted-foreground">
          Permissions unavailable. Refresh to try again.
        </p>
      )}
      {(canCreate || projectLoading) && (
        <Button
          type="button"
          className="h-8"
          disabled={!canCreate}
          aria-busy={projectLoading || undefined}
          title={projectLoading ? "Loading permissions..." : undefined}
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New incident
        </Button>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create incident</DialogTitle>
            <DialogDescription>
              For problems no alert caught, such as a customer report.
              Failing monitors and jobs open incidents automatically.
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
              <Select
                value={severity}
                onValueChange={(value) =>
                  setSeverity(value as SreIncidentListItem["severity"])
                }
              >
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
            <Button
              type="button"
              onClick={handleCreateIncident}
              disabled={isPending || !title.trim()}
            >
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
    </>
  );
}
