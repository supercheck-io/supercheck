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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { InfoHint, InfoHintText } from "@/components/status-pages/info-hint";
import { cn } from "@/lib/utils";
import { ChevronDown, Loader2 } from "lucide-react";
import {
  createIncident,
  type CreateIncidentData,
} from "@/actions/create-incident";
import { getSreIncidents } from "@/actions/sre-incidents";
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

const incidentFormSchema = z
  .object({
    sreIncidentId: z.string(),
    scheduledFor: z.string(),
    scheduledUntil: z.string(),
    deliverNotifications: z.boolean(),
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
    affectedComponentIds: z
      .array(z.string())
      .min(1, "Select at least one affected component"),
  })
  .superRefine((data, ctx) => {
    if (data.status !== "scheduled") return;

    if (!data.scheduledFor) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduledFor"],
        message: "Start time is required",
      });
    }
    if (!data.scheduledUntil) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduledUntil"],
        message: "End time is required",
      });
    }
    if (
      data.scheduledFor &&
      data.scheduledUntil &&
      new Date(data.scheduledFor) >= new Date(data.scheduledUntil)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduledUntil"],
        message: "End time must be after the start time",
      });
    }
    if (data.scheduledUntil && new Date(data.scheduledUntil) <= new Date()) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduledUntil"],
        message: "End time must be in the future",
      });
    }
  });

type IncidentFormData = z.infer<typeof incidentFormSchema>;

const statusOptions: {
  value: IncidentStatus;
  label: string;
  dotClassName: string;
}[] = [
  {
    value: "investigating",
    label: "Investigating",
    dotClassName: "bg-orange-500",
  },
  { value: "identified", label: "Identified", dotClassName: "bg-yellow-500" },
  { value: "monitoring", label: "Monitoring", dotClassName: "bg-blue-500" },
  { value: "resolved", label: "Resolved", dotClassName: "bg-green-500" },
  { value: "scheduled", label: "Scheduled", dotClassName: "bg-purple-500" },
];

const impactOptions: {
  value: IncidentImpact;
  label: string;
  dotClassName: string;
}[] = [
  { value: "none", label: "None", dotClassName: "bg-gray-400" },
  { value: "minor", label: "Minor", dotClassName: "bg-yellow-500" },
  { value: "major", label: "Major", dotClassName: "bg-orange-500" },
  { value: "critical", label: "Critical", dotClassName: "bg-red-500" },
];

const componentStatusOptions: { value: ComponentStatus; label: string }[] = [
  { value: "operational", label: "Operational" },
  { value: "degraded_performance", label: "Degraded performance" },
  { value: "partial_outage", label: "Partial outage" },
  { value: "major_outage", label: "Major outage" },
  { value: "under_maintenance", label: "Under maintenance" },
];

export function IncidentFormDialog({
  open,
  onOpenChange,
  statusPageId,
  components,
  onSuccess,
}: IncidentFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSreLinkOpen, setIsSreLinkOpen] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<IncidentFormData>({
    resolver: zodResolver(incidentFormSchema),
    defaultValues: {
      name: "",
      sreIncidentId: "",
      scheduledFor: "",
      scheduledUntil: "",
      deliverNotifications: true,
      body: "",
      status: "investigating",
      impact: "minor",
      componentStatus: "partial_outage",
      affectedComponentIds: [],
    },
  });

  const status = watch("status");
  const affectedComponentIds = watch("affectedComponentIds");

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      reset({
        name: "",
        sreIncidentId: "",
        scheduledFor: "",
        scheduledUntil: "",
        deliverNotifications: true,
        body: "",
        status: "investigating",
        impact: "minor",
        componentStatus: "partial_outage",
        affectedComponentIds: [],
      });
      setIsSreLinkOpen(false);
    }
  }, [open, reset]);

  const [sreIncidents, setSreIncidents] = useState<
    Array<{ id: string; title: string }>
  >([]);
  useEffect(() => {
    if (open)
      void getSreIncidents().then((result) => {
        if (result.success) setSreIncidents(result.incidents);
      });
  }, [open]);

  const onSubmit = async (data: IncidentFormData) => {
    setIsSubmitting(true);

    try {
      const createData: CreateIncidentData = {
        statusPageId,
        name: data.name,
        sreIncidentId: data.sreIncidentId || undefined,
        scheduledFor:
          data.status === "scheduled" && data.scheduledFor
            ? new Date(data.scheduledFor)
            : undefined,
        scheduledUntil:
          data.status === "scheduled" && data.scheduledUntil
            ? new Date(data.scheduledUntil)
            : undefined,
        deliverNotifications: data.deliverNotifications,
        body: data.body || undefined,
        status: data.status,
        impact: data.impact,
        affectedComponentIds: data.affectedComponentIds,
        componentStatus: data.componentStatus,
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

  const linkedSreIncident = sreIncidents.find(
    (incident) => incident.id === watch("sreIncidentId"),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Create Incident</DialogTitle>
          <DialogDescription>
            Report a service disruption to your users.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
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
                rows={4}
                disabled={isSubmitting}
                className="resize-none"
              />
              {errors.body && (
                <p className="text-xs text-red-500">{errors.body.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                This update is published immediately. You can add more updates
                from the incident page.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="incident-status">Status *</Label>
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id="incident-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <span className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "h-2 w-2 rounded-full",
                                  option.dotClassName,
                                )}
                              />
                              {option.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="incident-impact">Impact *</Label>
                <Controller
                  control={control}
                  name="impact"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id="incident-impact">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {impactOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <span className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "h-2 w-2 rounded-full",
                                  option.dotClassName,
                                )}
                              />
                              {option.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            {status === "scheduled" && (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-medium">Maintenance window</h3>
                  <p className="text-xs text-muted-foreground">
                    Starts and completes automatically. Alerts are suppressed
                    while the window is active.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="maintenance-start">
                      Starts (your local time)
                    </Label>
                    <Input
                      id="maintenance-start"
                      type="datetime-local"
                      {...register("scheduledFor")}
                      disabled={isSubmitting}
                    />
                    {errors.scheduledFor && (
                      <p className="text-xs text-red-500">
                        {errors.scheduledFor.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="maintenance-end">
                      Ends (your local time)
                    </Label>
                    <Input
                      id="maintenance-end"
                      type="datetime-local"
                      {...register("scheduledUntil")}
                      disabled={isSubmitting}
                    />
                    {errors.scheduledUntil && (
                      <p className="text-xs text-red-500">
                        {errors.scheduledUntil.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label id="affected-components-label">
                  Affected Components *
                </Label>
                <span className="text-xs text-muted-foreground">
                  {affectedComponentIds.length} selected
                </span>
              </div>
              <Controller
                control={control}
                name="affectedComponentIds"
                render={({ field }) => (
                  <div
                    role="group"
                    aria-labelledby="affected-components-label"
                    aria-describedby={
                      errors.affectedComponentIds
                        ? "affected-components-error"
                        : undefined
                    }
                    className="max-h-44 overflow-y-auto rounded-lg border"
                  >
                    {components.length === 0 ? (
                      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                        No components available. Add a component first.
                      </p>
                    ) : (
                      components.map((component) => (
                        <div
                          key={component.id}
                          className="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                        >
                          <Checkbox
                            id={`component-${component.id}`}
                            checked={field.value.includes(component.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                field.onChange([...field.value, component.id]);
                              } else {
                                field.onChange(
                                  field.value.filter(
                                    (id) => id !== component.id,
                                  ),
                                );
                              }
                            }}
                            disabled={isSubmitting}
                          />
                          <Label
                            htmlFor={`component-${component.id}`}
                            className="flex-1 cursor-pointer text-sm font-normal"
                          >
                            {component.name}
                          </Label>
                        </div>
                      ))
                    )}
                  </div>
                )}
              />
              {errors.affectedComponentIds && (
                <p
                  id="affected-components-error"
                  role="alert"
                  className="text-xs text-red-500"
                >
                  {errors.affectedComponentIds.message}
                </p>
              )}
            </div>

            {affectedComponentIds.length > 0 && (
              <div className="space-y-1.5 sm:max-w-[50%]">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="incident-component-status">
                    Component status during incident *
                  </Label>
                  <InfoHint label="Component status">
                    <InfoHintText>
                      Sets the status shown for every affected component while
                      the incident is active.
                    </InfoHintText>
                  </InfoHint>
                </div>
                <Controller
                  control={control}
                  name="componentStatus"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id="incident-component-status">
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

            <Collapsible open={isSreLinkOpen} onOpenChange={setIsSreLinkOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      isSreLinkOpen && "rotate-180",
                    )}
                  />
                  Link internal SRE incident
                  <span className="font-normal">
                    · {linkedSreIncident?.title ?? "None"}
                  </span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <Controller
                  control={control}
                  name="sreIncidentId"
                  render={({ field }) => (
                    <Select
                      value={field.value || "none"}
                      onValueChange={(value) =>
                        field.onChange(value === "none" ? "" : value)
                      }
                      disabled={isSubmitting}
                    >
                      <SelectTrigger
                        id="public-sre-incident"
                        aria-label="Linked SRE incident"
                      >
                        <SelectValue placeholder="No linked SRE incident" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          No linked SRE incident
                        </SelectItem>
                        {sreIncidents.map((incident) => (
                          <SelectItem key={incident.id} value={incident.id}>
                            {incident.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Only the title and message you write here are published.
                  Internal evidence and investigation notes stay private.
                </p>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <div className="flex flex-col gap-3 border-t bg-muted/30 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <Checkbox
                id="incident-notify"
                checked={watch("deliverNotifications")}
                onCheckedChange={(value) =>
                  setValue("deliverNotifications", value === true, {
                    shouldDirty: true,
                  })
                }
                disabled={isSubmitting}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <Label htmlFor="incident-notify" className="font-medium">
                  Notify subscribers
                </Label>
                <p className="text-xs text-muted-foreground">
                  Sends updates through the channels enabled for this page.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
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
                title={
                  components.length === 0
                    ? "Add a component before creating an incident"
                    : undefined
                }
              >
                {isSubmitting && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                Create Incident
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
