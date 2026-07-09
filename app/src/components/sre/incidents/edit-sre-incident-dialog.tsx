"use client";

import { useState, useTransition } from "react";
import { Loader2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  updateSreIncident,
  type SreIncidentDetail,
  type SreIncidentListItem,
} from "@/actions/sre-incidents";
import type { SreServiceListItem } from "@/actions/sre-services";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

type EditSreIncidentDialogProps = {
  incident: SreIncidentDetail["incident"];
  services: SreServiceListItem[];
  canUpdate: boolean;
};

type FieldErrors = Record<string, string[] | undefined>;

const noServiceValue = "__unmapped__";

function firstError(fieldErrors: FieldErrors | undefined, field: string) {
  return fieldErrors?.[field]?.[0] ?? null;
}

export function EditSreIncidentDialog({
  incident,
  services,
  canUpdate,
}: EditSreIncidentDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [title, setTitle] = useState(incident.title);
  const [severity, setSeverity] =
    useState<SreIncidentListItem["severity"]>(incident.severity);
  const [status, setStatus] =
    useState<SreIncidentListItem["status"]>(incident.status);
  const [primaryServiceId, setPrimaryServiceId] = useState(
    incident.primaryServiceId ?? noServiceValue,
  );

  if (!canUpdate) {
    return null;
  }

  const handleSubmit = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFieldErrors({ title: ["Incident title is required"] });
      return;
    }

    startTransition(async () => {
      const result = await updateSreIncident({
        id: incident.id,
        title: trimmedTitle,
        severity,
        status,
        primaryServiceId:
          primaryServiceId === noServiceValue ? null : primaryServiceId,
      });

      if (!result.success) {
        setFieldErrors(result.fieldErrors);
        toast.error(result.fieldErrors?.title?.[0] ?? result.error);
        return;
      }

      toast.success(result.message);
      setOpen(false);
      router.refresh();
    });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      return;
    }

    setFieldErrors(undefined);
    setTitle(incident.title);
    setSeverity(incident.severity);
    setStatus(incident.status);
    setPrimaryServiceId(incident.primaryServiceId ?? noServiceValue);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Pencil className="h-4 w-4" />
          Edit incident
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit incident</DialogTitle>
          <DialogDescription>
            Update incident ownership and response state without changing
            evidence or investigation history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="incident-title">Title</Label>
            <Input
              id="incident-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={500}
              aria-invalid={Boolean(firstError(fieldErrors, "title"))}
            />
            {firstError(fieldErrors, "title") && (
              <p className="text-xs text-destructive">
                {firstError(fieldErrors, "title")}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="incident-severity">Severity</Label>
              <Select
                value={severity}
                onValueChange={(value) =>
                  setSeverity(value as SreIncidentListItem["severity"])
                }
              >
                <SelectTrigger id="incident-severity">
                  <SelectValue />
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
              <Label htmlFor="incident-status">Status</Label>
              <Select
                value={status}
                onValueChange={(value) =>
                  setStatus(value as SreIncidentListItem["status"])
                }
              >
                <SelectTrigger id="incident-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="triggered">Triggered</SelectItem>
                  <SelectItem value="investigating">Investigating</SelectItem>
                  <SelectItem value="identified">Identified</SelectItem>
                  <SelectItem value="recommendations_ready">
                    Recommendations ready
                  </SelectItem>
                  <SelectItem value="user_applying_fix">
                    User applying fix
                  </SelectItem>
                  <SelectItem value="verifying">Verifying</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="incident-service">Service</Label>
            <Select value={primaryServiceId} onValueChange={setPrimaryServiceId}>
              <SelectTrigger id="incident-service">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={noServiceValue}>Unmapped</SelectItem>
                {services.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {firstError(fieldErrors, "primaryServiceId") && (
              <p className="text-xs text-destructive">
                {firstError(fieldErrors, "primaryServiceId")}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !title.trim()}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
