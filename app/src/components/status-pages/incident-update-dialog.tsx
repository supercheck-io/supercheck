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
import {
  updateIncidentStatus,
  type UpdateIncidentStatusData,
} from "@/actions/update-incident-status";
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

const updateFormSchema = z.object({
  status: z.enum([
    "investigating",
    "identified",
    "monitoring",
    "resolved",
    "scheduled",
  ]),
  body: z
    .string()
    .min(10, "Message must be at least 10 characters")
    .max(5000, "Message is too long"),
  restoreComponentStatus: z.boolean(),
});

type UpdateFormData = z.infer<typeof updateFormSchema>;

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

export function IncidentUpdateDialog({
  open,
  onOpenChange,
  statusPageId,
  incident,
  onSuccess,
}: IncidentUpdateDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors },
  } = useForm<UpdateFormData>({
    resolver: zodResolver(updateFormSchema),
    defaultValues: {
      status: "investigating",
      body: "",
      restoreComponentStatus: false,
    },
  });

  const status = watch("status");

  // Reset form when dialog opens
  useEffect(() => {
    if (open && incident) {
      reset({
        status: incident.status,
        body: "",
        restoreComponentStatus: false,
      });
    }
  }, [open, incident, reset]);

  const onSubmit = async (data: UpdateFormData) => {
    if (!incident) return;
    setIsSubmitting(true);

    try {
      const updateData: UpdateIncidentStatusData = {
        incidentId: incident.id,
        statusPageId,
        status: data.status,
        body: data.body,
        deliverNotifications: true,
        restoreComponentStatus: data.restoreComponentStatus,
      };

      const result = await updateIncidentStatus(updateData);

      if (result.success) {
        toast.success("Incident updated");
        onSuccess();
        onOpenChange(false);
      } else {
        toast.error("Failed to update incident", {
          description: result.message || "An unexpected error occurred",
        });
      }
    } catch (error) {
      console.error("Failed to update incident:", error);
      toast.error("Failed to update incident");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!incident) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update Incident</DialogTitle>
          <DialogDescription>
            Post a status update for your users
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="p-2.5 bg-muted rounded-md">
            <p className="text-sm font-medium truncate">{incident.name}</p>
            <p className="text-xs text-muted-foreground">
              Current:{" "}
              <span className="capitalize">
                {incident.status.replace(/_/g, " ")}
              </span>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>New Status *</Label>
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
            <Label htmlFor="body">Update Message *</Label>
            <Textarea
              id="body"
              placeholder="Describe progress or what has changed..."
              {...register("body")}
              rows={3}
              disabled={isSubmitting}
            />
            {errors.body && (
              <p className="text-xs text-red-500">{errors.body.message}</p>
            )}
          </div>

          {status === "resolved" && (
            <Controller
              control={control}
              name="restoreComponentStatus"
              render={({ field }) => (
                <div className="flex items-center gap-2 p-2.5 bg-green-50 dark:bg-green-950 rounded-md">
                  <Checkbox
                    id="restoreStatus"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isSubmitting}
                  />
                  <Label
                    htmlFor="restoreStatus"
                    className="text-sm cursor-pointer"
                  >
                    Restore components to operational
                  </Label>
                </div>
              )}
            />
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
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Post Update
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
