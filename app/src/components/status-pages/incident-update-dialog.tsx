"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { updateIncidentStatus, type UpdateIncidentStatusData } from "@/actions/update-incident-status";
import { toast } from "sonner";

type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved" | "scheduled";

type Incident = {
  id: string;
  name: string;
  status: IncidentStatus;
};

type IncidentUpdateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statusPageId: string;
  incident: Incident | null;
  onSuccess: () => void;
};

const statusOptions: { value: IncidentStatus; label: string; color: string }[] = [
  { value: "investigating", label: "Investigating", color: "text-orange-600" },
  { value: "identified", label: "Identified", color: "text-yellow-600" },
  { value: "monitoring", label: "Monitoring", color: "text-blue-600" },
  { value: "resolved", label: "Resolved", color: "text-green-600" },
  { value: "scheduled", label: "Scheduled Maintenance", color: "text-purple-600" },
];

export function IncidentUpdateDialog({
  open,
  onOpenChange,
  statusPageId,
  incident,
  onSuccess,
}: IncidentUpdateDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    status: "investigating" as IncidentStatus,
    body: "",
    restoreComponentStatus: false,
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (open && incident) {
      setFormData({
        status: incident.status,
        body: "",
        restoreComponentStatus: false,
      });
    }
  }, [open, incident]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incident) return;

    setIsSubmitting(true);

    try {
      const updateData: UpdateIncidentStatusData = {
        incidentId: incident.id,
        statusPageId,
        status: formData.status,
        body: formData.body,
        deliverNotifications: true,
        restoreComponentStatus: formData.restoreComponentStatus,
      };

      const result = await updateIncidentStatus(updateData);

      if (result.success) {
        toast.success("Incident updated successfully");
        onSuccess();
        onOpenChange(false);
      } else {
        toast.error("Failed to update incident", {
          description: result.message || "An unexpected error occurred",
        });
      }
    } catch (error) {
      console.error("Failed to update incident:", error);
      toast.error("Failed to update incident", {
        description: "An unexpected error occurred",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!incident) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Update Incident</DialogTitle>
          <DialogDescription>
            Post an update to communicate the current status to your users
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-sm font-medium">{incident.name}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Current status: <span className="capitalize">{incident.status.replace(/_/g, ' ')}</span>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">New Status *</Label>
            <Select
              value={formData.status}
              onValueChange={(value: IncidentStatus) =>
                setFormData({ ...formData, status: value })
              }
              disabled={isSubmitting}
            >
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className={option.color}>{option.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Update the incident status to reflect the current situation
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">Update Message *</Label>
            <Textarea
              id="body"
              placeholder="We have identified the issue and are working on a fix..."
              value={formData.body}
              onChange={(e) => setFormData({ ...formData, body: e.target.value })}
              rows={4}
              disabled={isSubmitting}
              required
            />
            <p className="text-sm text-muted-foreground">
              Describe what has changed or what progress has been made
            </p>
          </div>

          {formData.status === "resolved" && (
            <div className="flex items-start space-x-2 p-4 bg-green-50 dark:bg-green-950 rounded-lg">
              <Checkbox
                id="restoreStatus"
                checked={formData.restoreComponentStatus}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, restoreComponentStatus: checked === true })
                }
                disabled={isSubmitting}
              />
              <div className="space-y-1">
                <Label
                  htmlFor="restoreStatus"
                  className="text-sm font-medium cursor-pointer"
                >
                  Restore affected components to operational
                </Label>
                <p className="text-xs text-muted-foreground">
                  All components affected by this incident will be set to &quot;Operational&quot; status
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSubmitting ? "Posting..." : "Post Update"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
