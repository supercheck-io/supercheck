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
import {
  createIncident,
  type CreateIncidentData,
} from "@/actions/create-incident";
import { toast } from "sonner";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

type IncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved"
  | "scheduled";
type IncidentImpact = "none" | "minor" | "major" | "critical";
type ComponentStatus =
  | "operational"
  | "degraded_performance"
  | "partial_outage"
  | "major_outage"
  | "under_maintenance";

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

const incidentFormSchema = z.object({
  name: z.string().min(1, "Title is required").max(200, "Title is too long"),
  body: z
    .string()
    .min(1, "Message is required")
    .max(5000, "Message is too long"),
  status: z.enum([
    "investigating",
    "identified",
    "monitoring",
    "resolved",
    "scheduled",
  ]),
  impact: z.enum(["none", "minor", "major", "critical"]),
  componentStatus: z.enum([
    "operational",
    "degraded_performance",
    "partial_outage",
    "major_outage",
    "under_maintenance",
  ]),
  affectedComponentIds: z.array(z.string()),
});

type IncidentFormData = z.infer<typeof incidentFormSchema>;

const statusOptions: { value: IncidentStatus; label: string; color: string }[] =
  [
    {
      value: "investigating",
      label: "Investigating",
      color: "text-orange-600",
    },
    { value: "identified", label: "Identified", color: "text-yellow-600" },
    { value: "monitoring", label: "Monitoring", color: "text-blue-600" },
    { value: "resolved", label: "Resolved", color: "text-green-600" },
    { value: "scheduled", label: "Scheduled", color: "text-purple-600" },
  ];

const impactOptions: { value: IncidentImpact; label: string; color: string }[] =
  [
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

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors },
  } = useForm<IncidentFormData>({
    resolver: zodResolver(incidentFormSchema),
    defaultValues: {
      name: "",
      body: "",
      status: "investigating",
      impact: "minor",
      componentStatus: "partial_outage",
      affectedComponentIds: [],
    },
  });

  const affectedComponentIds = watch("affectedComponentIds");

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      reset({
        name: "",
        body: "",
        status: "investigating",
        impact: "minor",
        componentStatus: "partial_outage",
        affectedComponentIds: [],
      });
    }
  }, [open, reset]);

  const onSubmit = async (data: IncidentFormData) => {
    setIsSubmitting(true);

    try {
      const createData: CreateIncidentData = {
        statusPageId,
        name: data.name,
        body: data.body || undefined,
        status: data.status,
        impact: data.impact,
        affectedComponentIds: data.affectedComponentIds,
        componentStatus: data.componentStatus,
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
      <DialogContent className="max-w-4xl max-h-[90vh] min-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Incident</DialogTitle>
          <DialogDescription>
            Report a service disruption to your users
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Title *</Label>
            <Input
              id="name"
              placeholder="Database connectivity issues"
              {...register("name")}
              disabled={isSubmitting}
            />
            {errors.name && (
              <p className="text-xs text-red-500">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="body">Initial Message *</Label>
            <Textarea
              id="body"
              placeholder="We are investigating..."
              {...register("body")}
              rows={3}
              disabled={isSubmitting}
            />
            {errors.body && (
              <p className="text-xs text-red-500">{errors.body.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status *</Label>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
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
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Impact *</Label>
              <Controller
                control={control}
                name="impact"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
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
                )}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Affected Components *</Label>
            <Controller
              control={control}
              name="affectedComponentIds"
              render={({ field }) => (
                <div className="border rounded-md p-3 space-y-2 max-h-32 overflow-y-auto bg-muted/20">
                  {components.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      No components available
                    </p>
                  ) : (
                    components.map((component) => (
                      <div
                        key={component.id}
                        className="flex items-center space-x-2"
                      >
                        <Checkbox
                          id={`component-${component.id}`}
                          checked={field.value.includes(component.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              field.onChange([...field.value, component.id]);
                            } else {
                              field.onChange(
                                field.value.filter((id) => id !== component.id)
                              );
                            }
                          }}
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
              )}
            />
          </div>

          {affectedComponentIds.length > 0 && (
            <div className="space-y-1.5">
              <Label>Set Component Status *</Label>
              <Controller
                control={control}
                name="componentStatus"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
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
                )}
              />
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting || components.length === 0}
            >
              {isSubmitting && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Create Incident
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
