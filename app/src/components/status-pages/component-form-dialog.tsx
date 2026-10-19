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
  DialogFooter,
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
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { InfoHint, InfoHintText } from "@/components/status-pages/info-hint";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import {
  createComponent,
  type CreateComponentData,
} from "@/actions/create-component";
import {
  updateComponent,
  type UpdateComponentData,
} from "@/actions/update-component";
import { getSreServices } from "@/actions/sre-services";
import { toast } from "sonner";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

type ComponentStatus =
  | "operational"
  | "degraded_performance"
  | "partial_outage"
  | "major_outage"
  | "under_maintenance";

type Component = {
  id: string;
  name: string;
  description: string | null;
  status: ComponentStatus;
  monitorId: string | null;
  monitorIds?: string[];
  monitors?: Array<{ id: string; weight?: number }>;
  aggregationMethod?:
    | "worst_case"
    | "best_case"
    | "majority_vote"
    | "weighted_average";
  failureThreshold?: number;
  autoCreateIncidents?: boolean;
  serviceId?: string | null;
  showcase: boolean;
  onlyShowIfDegraded: boolean;
  position: number;
};

type Monitor = {
  id: string;
  name: string;
  type: string;
};

type ComponentFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statusPageId: string;
  component?: Component;
  monitors: Monitor[];
  onSuccess: () => void;
};

const componentFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  description: z.string().max(500, "Description is too long").optional(),
  status: z.enum([
    "operational",
    "degraded_performance",
    "partial_outage",
    "major_outage",
    "under_maintenance",
  ]),
  monitorIds: z.array(z.string()),
  monitorWeights: z.record(z.string(), z.number().int().min(1).max(100)),
  showcase: z.boolean(),
  onlyShowIfDegraded: z.boolean(),
  aggregationMethod: z.enum([
    "worst_case",
    "best_case",
    "majority_vote",
    "weighted_average",
  ]),
  failureThreshold: z.number().int().min(1).max(100),
  autoCreateIncidents: z.boolean(),
  serviceId: z.string(),
});

type ComponentFormData = z.infer<typeof componentFormSchema>;

const statusOptions: {
  value: ComponentStatus;
  label: string;
  dotClassName: string;
}[] = [
  {
    value: "operational",
    label: "Operational",
    dotClassName: "bg-green-500",
  },
  {
    value: "degraded_performance",
    label: "Degraded performance",
    dotClassName: "bg-yellow-500",
  },
  {
    value: "partial_outage",
    label: "Partial outage",
    dotClassName: "bg-orange-500",
  },
  {
    value: "major_outage",
    label: "Major outage",
    dotClassName: "bg-red-500",
  },
  {
    value: "under_maintenance",
    label: "Under maintenance",
    dotClassName: "bg-blue-500",
  },
];

const aggregationOptions = [
  {
    value: "worst_case",
    label: "Worst monitor",
    description: "A single failing monitor decides the component status.",
  },
  {
    value: "best_case",
    label: "Best monitor",
    description: "Only fails when every linked monitor fails.",
  },
  {
    value: "majority_vote",
    label: "Majority vote",
    description: "Follows the status most monitors report.",
  },
  {
    value: "weighted_average",
    label: "Weighted average",
    description: "Combines monitor statuses using per-monitor weights.",
  },
] as const;

export function ComponentFormDialog({
  open,
  onOpenChange,
  statusPageId,
  component,
  monitors,
  onSuccess,
}: ComponentFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMonitorPickerOpen, setIsMonitorPickerOpen] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ComponentFormData>({
    resolver: zodResolver(componentFormSchema),
    defaultValues: {
      name: "",
      description: "",
      status: "operational",
      monitorIds: [],
      monitorWeights: {},
      showcase: true,
      onlyShowIfDegraded: false,
      aggregationMethod: "worst_case",
      failureThreshold: 1,
      autoCreateIncidents: false,
      serviceId: "",
    },
  });

  const monitorIds = watch("monitorIds");
  const monitorWeights = watch("monitorWeights");
  const aggregationMethod = watch("aggregationMethod");
  const showcase = watch("showcase");

  const [services, setServices] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  useEffect(() => {
    if (open) {
      void getSreServices().then((result) => {
        if (result.success) setServices(result.services);
      });
    }
  }, [open]);

  // Reset form when dialog opens with new component data
  useEffect(() => {
    if (open) {
      reset({
        name: component?.name || "",
        description: component?.description || "",
        status: component?.status || "operational",
        monitorIds: component?.monitorIds || [],
        monitorWeights: Object.fromEntries(
          (component?.monitors ?? []).map((monitor) => [
            monitor.id,
            monitor.weight,
          ]),
        ),
        showcase: component?.showcase ?? true,
        onlyShowIfDegraded: component?.onlyShowIfDegraded ?? false,
        aggregationMethod: component?.aggregationMethod ?? "worst_case",
        failureThreshold: component?.failureThreshold ?? 1,
        autoCreateIncidents: component?.autoCreateIncidents ?? false,
        serviceId: component?.serviceId ?? "",
      });
      setIsMonitorPickerOpen(false);
    }
  }, [open, component, reset]);

  const toggleMonitor = (monitorId: string) => {
    if (monitorIds.includes(monitorId)) {
      setValue(
        "monitorIds",
        monitorIds.filter((id) => id !== monitorId),
        { shouldDirty: true },
      );
      return;
    }

    setValue("monitorIds", [...monitorIds, monitorId], { shouldDirty: true });
    setValue(`monitorWeights.${monitorId}`, monitorWeights?.[monitorId] ?? 1, {
      shouldDirty: true,
    });
  };

  const onSubmit = async (data: ComponentFormData) => {
    setIsSubmitting(true);

    try {
      // Degraded-only visibility has no effect while the component is hidden.
      const onlyShowIfDegraded = data.showcase
        ? data.onlyShowIfDegraded
        : false;

      if (component) {
        const updateData: UpdateComponentData = {
          id: component.id,
          statusPageId,
          name: data.name,
          description: data.description || null,
          status: data.status,
          monitorIds: data.monitorIds,
          monitorWeights: data.monitorWeights,
          showcase: data.showcase,
          onlyShowIfDegraded,
          aggregationMethod: data.aggregationMethod,
          failureThreshold: data.failureThreshold,
          autoCreateIncidents: data.autoCreateIncidents,
          serviceId: data.serviceId || null,
        };

        const result = await updateComponent(updateData);

        if (result.success) {
          toast.success("Component updated successfully");
          onSuccess();
          onOpenChange(false);
        } else {
          toast.error("Failed to update component", {
            description: result.message || "An unexpected error occurred",
          });
        }
      } else {
        const createData: CreateComponentData = {
          statusPageId,
          name: data.name,
          description: data.description || undefined,
          status: data.status,
          monitorIds: data.monitorIds,
          monitorWeights: data.monitorWeights,
          showcase: data.showcase,
          onlyShowIfDegraded,
          position: 0,
          aggregationMethod: data.aggregationMethod,
          failureThreshold: data.failureThreshold,
          autoCreateIncidents: data.autoCreateIncidents,
          serviceId: data.serviceId || null,
        };

        const result = await createComponent(createData);

        if (result.success) {
          toast.success("Component created successfully");
          onSuccess();
          onOpenChange(false);
        } else {
          toast.error("Failed to create component", {
            description: result.message || "An unexpected error occurred",
          });
        }
      }
    } catch (error) {
      console.error("Failed to submit component:", error);
      toast.error("Failed to save component", {
        description: "An unexpected error occurred",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const linkedService = services.find(
    (service) => service.id === watch("serviceId"),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>
            {component ? "Edit Component" : "Add Component"}
          </DialogTitle>
          <DialogDescription>
            {component
              ? "Update what visitors see and how health is calculated."
              : "Track the health of a service or feature on your status page."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {/* Basics */}
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold">Basics</h3>
                <p className="text-xs text-muted-foreground">
                  What visitors see in the component list.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  placeholder="API Server"
                  {...register("name")}
                  disabled={isSubmitting}
                />
                {errors.name && (
                  <p className="text-xs text-red-500">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="RESTful API for client applications"
                  {...register("description")}
                  rows={2}
                  disabled={isSubmitting}
                  className="resize-none"
                />
                {errors.description && (
                  <p className="text-xs text-red-500">
                    {errors.description.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5 sm:max-w-[50%]">
                <Label htmlFor="component-status">Status *</Label>
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id="component-status">
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
                <p className="text-xs text-muted-foreground">
                  {monitorIds.length > 0
                    ? "Linked monitors recalculate this automatically."
                    : "Manual status until a monitor is linked."}
                </p>
              </div>
            </section>

            {/* Monitors */}
            <section className="space-y-3 border-t pt-5">
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-semibold">Monitors</h3>
                <InfoHint label="Monitor linking">
                  <InfoHintText>
                    Linked monitors drive component health. Components without
                    monitors keep the status you set manually.
                  </InfoHintText>
                </InfoHint>
              </div>

              <Popover
                modal
                open={isMonitorPickerOpen}
                onOpenChange={setIsMonitorPickerOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={isMonitorPickerOpen}
                    className="w-full justify-between font-normal"
                    disabled={isSubmitting}
                  >
                    <span className="truncate text-muted-foreground">
                      {monitorIds.length > 0
                        ? `${monitorIds.length} monitor${
                            monitorIds.length === 1 ? "" : "s"
                          } linked`
                        : "Link monitors (optional)"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[var(--radix-popover-trigger-width)] p-0"
                  align="start"
                >
                  <Command>
                    <CommandInput placeholder="Search monitors..." />
                    <CommandList>
                      <CommandEmpty>
                        {monitors.length === 0
                          ? "No monitors available in this project."
                          : "No monitors match your search."}
                      </CommandEmpty>
                      <CommandGroup>
                        {monitors.map((monitor) => {
                          const isSelected = monitorIds.includes(monitor.id);
                          return (
                            <CommandItem
                              key={monitor.id}
                              value={`${monitor.name} ${monitor.type} ${monitor.id}`}
                              onSelect={() => toggleMonitor(monitor.id)}
                            >
                              <span
                                className={cn(
                                  "mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                                  isSelected
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "opacity-50",
                                )}
                              >
                                {isSelected && <Check className="h-3 w-3" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">
                                  {monitor.name}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {monitor.type}
                                </span>
                              </span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {monitorIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {monitorIds.map((monitorId) => {
                    const monitor = monitors.find((m) => m.id === monitorId);
                    return monitor ? (
                      <Badge
                        key={monitorId}
                        variant="secondary"
                        className="gap-1 pr-1 font-normal"
                      >
                        {monitor.name}
                        <button
                          type="button"
                          onClick={() => toggleMonitor(monitorId)}
                          aria-label={`Remove ${monitor.name}`}
                          className="rounded-sm p-0.5 hover:bg-background/60 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ) : null;
                  })}
                </div>
              )}

              {monitorIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No monitors linked. Status stays manual.
                </p>
              ) : (
                <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Label htmlFor="component-aggregation">
                          Aggregation
                        </Label>
                        <InfoHint label="Status aggregation">
                          <InfoHintText>
                            How monitor states combine into one component
                            status.
                          </InfoHintText>
                        </InfoHint>
                      </div>
                      <Controller
                        control={control}
                        name="aggregationMethod"
                        render={({ field }) => (
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                            disabled={isSubmitting}
                          >
                            <SelectTrigger id="component-aggregation">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {aggregationOptions.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                      <p className="text-xs text-muted-foreground">
                        {
                          aggregationOptions.find(
                            (option) => option.value === aggregationMethod,
                          )?.description
                        }
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Label htmlFor="component-threshold">
                          Failing monitors required
                        </Label>
                        <InfoHint label="Failure threshold">
                          <InfoHintText>
                            Counts failing monitors, not consecutive checks. At
                            or above this number, the aggregation above decides
                            the component status. Monitor alert thresholds are
                            configured on each monitor.
                          </InfoHintText>
                        </InfoHint>
                      </div>
                      <Input
                        id="component-threshold"
                        type="number"
                        min={1}
                        max={100}
                        {...register("failureThreshold", {
                          valueAsNumber: true,
                        })}
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>

                  {aggregationMethod === "weighted_average" && (
                    <div className="space-y-3 border-t pt-3">
                      <p className="text-xs text-muted-foreground">
                        Weight each monitor from 1 to 100.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {monitorIds.map((monitorId) => {
                          const monitor = monitors.find(
                            (m) => m.id === monitorId,
                          );
                          if (!monitor) return null;
                          return (
                            <div key={monitorId} className="space-y-1">
                              <Label
                                htmlFor={`monitor-weight-${monitorId}`}
                                className="text-xs font-normal text-muted-foreground"
                              >
                                {monitor.name}
                              </Label>
                              <Controller
                                control={control}
                                name={`monitorWeights.${monitorId}`}
                                render={({ field }) => (
                                  <MonitorWeightInput
                                    id={`monitor-weight-${monitorId}`}
                                    value={field.value}
                                    onChange={field.onChange}
                                    onBlur={field.onBlur}
                                    disabled={isSubmitting}
                                  />
                                )}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-3 border-t pt-3">
                    <Checkbox
                      id="component-auto-incidents"
                      checked={watch("autoCreateIncidents")}
                      onCheckedChange={(value) =>
                        setValue("autoCreateIncidents", value === true, {
                          shouldDirty: true,
                        })
                      }
                      disabled={isSubmitting}
                      className="mt-0.5"
                    />
                    <div className="space-y-0.5">
                      <Label
                        htmlFor="component-auto-incidents"
                        className="font-medium"
                      >
                        Publish outage and recovery incidents automatically
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Creates a public incident when this component degrades.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Visibility */}
            <section className="space-y-4 border-t pt-5">
              <div>
                <h3 className="text-sm font-semibold">Visibility</h3>
                <p className="text-xs text-muted-foreground">
                  Control where this component appears.
                </p>
              </div>

              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="component-showcase"
                    checked={showcase}
                    onCheckedChange={(value) => {
                      const nextValue = value === true;
                      setValue("showcase", nextValue, { shouldDirty: true });
                      if (!nextValue) {
                        setValue("onlyShowIfDegraded", false, {
                          shouldDirty: true,
                        });
                      }
                    }}
                    disabled={isSubmitting}
                    className="mt-0.5"
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor="component-showcase" className="font-medium">
                      Show on the public status page
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Hidden components leave the public component list but keep
                      tracking health in the dashboard.
                    </p>
                  </div>
                </div>

                <div
                  className={cn(
                    "flex items-start gap-3",
                    !showcase && "opacity-50",
                  )}
                >
                  <Checkbox
                    id="component-degraded-only"
                    checked={watch("onlyShowIfDegraded")}
                    onCheckedChange={(value) =>
                      setValue("onlyShowIfDegraded", value === true, {
                        shouldDirty: true,
                      })
                    }
                    disabled={isSubmitting || !showcase}
                    className="mt-0.5"
                  />
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="component-degraded-only"
                      className="font-medium"
                    >
                      Show only when degraded
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Keeps the list quiet while everything is operational.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="component-service">
                    Linked internal service
                  </Label>
                  <InfoHint label="Service linking">
                    <InfoHintText>
                      Services hold internal ownership and dependencies. Linking
                      one does not publish any service details.
                    </InfoHintText>
                  </InfoHint>
                </div>
                <Controller
                  control={control}
                  name="serviceId"
                  render={({ field }) => (
                    <Select
                      value={field.value || "none"}
                      onValueChange={(value) =>
                        field.onChange(value === "none" ? "" : value)
                      }
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id="component-service">
                        <SelectValue placeholder="No linked service" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No linked service</SelectItem>
                        {services.map((service) => (
                          <SelectItem key={service.id} value={service.id}>
                            {service.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {linkedService && (
                  <p className="text-xs text-muted-foreground">
                    Linked to {linkedService.name}. Internal only.
                  </p>
                )}
              </div>
            </section>
          </div>

          <DialogFooter className="border-t bg-muted/30 px-6 py-3">
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
              {component ? "Update" : "Add"} Component
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


function MonitorWeightInput({
  id,
  value,
  onChange,
  onBlur,
  disabled,
}: {
  id: string;
  value: number | undefined;
  onChange: (value: number) => void;
  onBlur: () => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value ?? 1));

  return (
    <Input
      id={id}
      type="number"
      min={1}
      max={100}
      value={draft}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        const next = event.target.valueAsNumber;
        if (!Number.isNaN(next) && next >= 1 && next <= 100) {
          onChange(next);
        }
      }}
      onBlur={() => {
        const next = Math.trunc(Number(draft));
        if (draft.trim() === "" || Number.isNaN(next)) {
          setDraft(String(value ?? 1));
        } else if (next < 1) {
          setDraft("1");
          onChange(1);
        } else if (next > 100) {
          setDraft("100");
          onChange(100);
        }
        onBlur();
      }}
      disabled={disabled}
    />
  );
}
