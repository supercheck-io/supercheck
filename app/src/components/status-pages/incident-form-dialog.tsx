"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { createIncident, type CreateIncidentData } from "@/actions/create-incident";
import { toast } from "sonner";

type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved" | "scheduled";
type IncidentImpact = "none" | "minor" | "major" | "critical";
type ComponentStatus = "operational" | "degraded_performance" | "partial_outage" | "major_outage" | "under_maintenance";

type Component = {
  id: string;
  name: string;
};

type IncidentFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statusPageId: string;
  components: Component[];
  onSuccess: () => void;
};

const statusOptions: { value: IncidentStatus; label: string; color: string }[] = [
  { value: "investigating", label: "Investigating", color: "text-orange-600" },
  { value: "identified", label: "Identified", color: "text-yellow-600" },
  { value: "monitoring", label: "Monitoring", color: "text-blue-600" },
  { value: "resolved", label: "Resolved", color: "text-green-600" },
  { value: "scheduled", label: "Scheduled Maintenance", color: "text-purple-600" },
];

const impactOptions: { value: IncidentImpact; label: string; color: string }[] = [
  { value: "none", label: "None", color: "text-gray-600" },
  { value: "minor", label: "Minor", color: "text-yellow-600" },
  { value: "major", label: "Major", color: "text-orange-600" },
  { value: "critical", label: "Critical", color: "text-red-600" },
];

const componentStatusOptions: { value: ComponentStatus; label: string }[] = [
  { value: "operational", label: "Operational" },
  { value: "degraded_performance", label: "Degraded Performance" },
  { value: "partial_outage", label: "Partial Outage" },
  { value: "major_outage", label: "Major Outage" },
  { value: "under_maintenance", label: "Under Maintenance" },
];

export function IncidentFormDialog({
  open,
  onOpenChange,
  statusPageId,
  components,
  onSuccess,
}: IncidentFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    body: "",
    status: "investigating" as IncidentStatus,
    impact: "minor" as IncidentImpact,
    componentStatus: "partial_outage" as ComponentStatus,
    affectedComponentIds: [] as string[],
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setFormData({
        name: "",
        body: "",
        status: "investigating",
        impact: "minor",
        componentStatus: "partial_outage",
        affectedComponentIds: [],
      });
    }
  }, [open]);

  const handleComponentToggle = (componentId: string) => {
    setFormData(prev => ({
      ...prev,
      affectedComponentIds: prev.affectedComponentIds.includes(componentId)
        ? prev.affectedComponentIds.filter(id => id !== componentId)
        : [...prev.affectedComponentIds, componentId],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const createData: CreateIncidentData = {
        statusPageId,
        name: formData.name,
        body: formData.body || undefined,
        status: formData.status,
        impact: formData.impact,
        affectedComponentIds: formData.affectedComponentIds,
        componentStatus: formData.componentStatus,
        deliverNotifications: true,
      };

      const result = await createIncident(createData);

      if (result.success) {
        toast.success("Incident created successfully");
        onSuccess();
        onOpenChange(false);
      } else {
        toast.error("Failed to create incident", {
          description: result.message || "An unexpected error occurred",
        });
      }
    } catch (error) {
      console.error("Failed to create incident:", error);
      toast.error("Failed to create incident", {
        description: "An unexpected error occurred",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Incident</DialogTitle>
          <DialogDescription>
            Report an incident to communicate service disruptions to your users
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Incident Title *</Label>
            <Input
              id="name"
              placeholder="Database connectivity issues"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              disabled={isSubmitting}
            />
            <p className="text-sm text-muted-foreground">
              A brief title describing the incident
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">Initial Update Message *</Label>
            <Textarea
              id="body"
              placeholder="We are currently investigating connectivity issues with our database..."
              value={formData.body}
              onChange={(e) => setFormData({ ...formData, body: e.target.value })}
              rows={4}
              disabled={isSubmitting}
              required
            />
            <p className="text-sm text-muted-foreground">
              Initial message to be displayed on the status page
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="status">Incident Status *</Label>
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="impact">Impact Level *</Label>
              <Select
                value={formData.impact}
                onValueChange={(value: IncidentImpact) =>
                  setFormData({ ...formData, impact: value })
                }
                disabled={isSubmitting}
              >
                <SelectTrigger id="impact">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {impactOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <span className={option.color}>{option.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Affected Components *</Label>
            <div className="border rounded-lg p-4 space-y-2 max-h-48 overflow-y-auto">
              {components.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No components available. Create components first.
                </p>
              ) : (
                components.map((component) => (
                  <div key={component.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`component-${component.id}`}
                      checked={formData.affectedComponentIds.includes(component.id)}
                      onCheckedChange={() => handleComponentToggle(component.id)}
                      disabled={isSubmitting}
                    />
                    <Label
                      htmlFor={`component-${component.id}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {component.name}
                    </Label>
                  </div>
                ))
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Select which components are affected by this incident
            </p>
          </div>

          {formData.affectedComponentIds.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="componentStatus">Set Component Status To *</Label>
              <Select
                value={formData.componentStatus}
                onValueChange={(value: ComponentStatus) =>
                  setFormData({ ...formData, componentStatus: value })
                }
                disabled={isSubmitting}
              >
                <SelectTrigger id="componentStatus">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {componentStatusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                All selected components will be set to this status
              </p>
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
            <Button type="submit" disabled={isSubmitting || components.length === 0}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSubmitting ? "Creating..." : "Create Incident"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
