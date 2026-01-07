"use client";

import { useState, useEffect, useRef } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Loader2, X, Search } from "lucide-react";
import {
  createComponent,
  type CreateComponentData,
} from "@/actions/create-component";
import {
  updateComponent,
  type UpdateComponentData,
} from "@/actions/update-component";
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
});

type ComponentFormData = z.infer<typeof componentFormSchema>;

const statusOptions: {
  value: ComponentStatus;
  label: string;
  color: string;
}[] = [
    { value: "operational", label: "Operational", color: "text-green-600" },
    {
      value: "degraded_performance",
      label: "Degraded Performance",
      color: "text-yellow-600",
    },
    {
      value: "partial_outage",
      label: "Partial Outage",
      color: "text-orange-600",
    },
    { value: "major_outage", label: "Major Outage", color: "text-red-600" },
    {
      value: "under_maintenance",
      label: "Under Maintenance",
      color: "text-blue-600",
    },
  ];

export function ComponentFormDialog({
  open,
  onOpenChange,
  statusPageId,
  component,
  monitors,
  onSuccess,
}: ComponentFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [monitorSearchTerm, setMonitorSearchTerm] = useState("");
  const [isMonitorDropdownOpen, setIsMonitorDropdownOpen] = useState(false);
  const monitorDropdownRef = useRef<HTMLDivElement>(null);

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
    },
  });

  const monitorIds = watch("monitorIds");

  // Reset form when dialog opens with new component data
  useEffect(() => {
    if (open) {
      reset({
        name: component?.name || "",
        description: component?.description || "",
        status: component?.status || "operational",
        monitorIds: component?.monitorIds || [],
      });
      setMonitorSearchTerm("");
      setIsMonitorDropdownOpen(false);
    }
  }, [open, component, reset]);

  // Click outside handler for dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        monitorDropdownRef.current &&
        !monitorDropdownRef.current.contains(event.target as Node)
      ) {
        setIsMonitorDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredMonitors = monitors.filter(
    (monitor) =>
      monitor.name.toLowerCase().includes(monitorSearchTerm.toLowerCase()) ||
      monitor.type.toLowerCase().includes(monitorSearchTerm.toLowerCase())
  );

  const onSubmit = async (data: ComponentFormData) => {
    setIsSubmitting(true);

    try {
      if (component) {
        const updateData: UpdateComponentData = {
          id: component.id,
          statusPageId,
          name: data.name,
          description: data.description || null,
          status: data.status,
          monitorIds: data.monitorIds,
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
          showcase: true,
          onlyShowIfDegraded: false,
          position: 0,
          aggregationMethod: "worst_case",
          failureThreshold: 1,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] min-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {component ? "Edit Component" : "Add Component"}
          </DialogTitle>
          <DialogDescription>
            {component
              ? "Update component details"
              : "Track the health of a service or feature"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
            />
            {errors.description && (
              <p className="text-xs text-red-500">
                {errors.description.message}
              </p>
            )}
          </div>

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
            <Label>Linked Monitors</Label>
            <div ref={monitorDropdownRef} className="relative">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search monitors..."
                  value={monitorSearchTerm}
                  onChange={(e) => {
                    setMonitorSearchTerm(e.target.value);
                    setIsMonitorDropdownOpen(true);
                  }}
                  onFocus={() => setIsMonitorDropdownOpen(true)}
                  className="pl-8 h-9 text-sm"
                  disabled={isSubmitting}
                />
              </div>

              {isMonitorDropdownOpen && (
                <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-40 overflow-y-auto">
                  {monitors.length === 0 ? (
                    <div className="p-2 text-xs text-muted-foreground">
                      No monitors available
                    </div>
                  ) : filteredMonitors.length === 0 ? (
                    <div className="p-2 text-xs text-muted-foreground">
                      No matches found
                    </div>
                  ) : (
                    <div className="p-1">
                      {filteredMonitors.map((monitor) => (
                        <div
                          key={monitor.id}
                          className="flex items-center p-2 hover:bg-accent rounded cursor-pointer text-sm"
                          onClick={() => {
                            if (!monitorIds.includes(monitor.id)) {
                              setValue("monitorIds", [
                                ...monitorIds,
                                monitor.id,
                              ]);
                            }
                            setMonitorSearchTerm("");
                            setIsMonitorDropdownOpen(false);
                          }}
                        >
                          <Checkbox
                            checked={monitorIds.includes(monitor.id)}
                            className="mr-2"
                            disabled={isSubmitting}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              {monitor.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {monitor.type}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {monitorIds.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {monitorIds.map((monitorId) => {
                  const monitor = monitors.find((m) => m.id === monitorId);
                  return monitor ? (
                    <Badge
                      key={monitorId}
                      variant="secondary"
                      className="text-xs pr-1"
                    >
                      {monitor.name}
                      <button
                        type="button"
                        onClick={() =>
                          setValue(
                            "monitorIds",
                            monitorIds.filter((id) => id !== monitorId)
                          )
                        }
                        className="ml-1 hover:text-destructive p-0.5"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ) : null;
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Link monitors to track component health (optional)
            </p>
          </div>

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
              {component ? "Update" : "Add"} Component
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
