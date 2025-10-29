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
  monitorIds?: string[]; // For backward compatibility
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
  const [formData, setFormData] = useState({
    name: component?.name || "",
    description: component?.description || "",
    status: component?.status || ("operational" as ComponentStatus),
    monitorId: component?.monitorId || "none",
    monitorIds: component?.monitorIds || [],
  });
  const [monitorSearchTerm, setMonitorSearchTerm] = useState("");
  const [isMonitorDropdownOpen, setIsMonitorDropdownOpen] = useState(false);
  const monitorDropdownRef = useRef<HTMLDivElement>(null);

  // Reset form when dialog opens with new component data
  useEffect(() => {
    if (open) {
      setFormData({
        name: component?.name || "",
        description: component?.description || "",
        status: component?.status || "operational",
        monitorId: component?.monitorId || "none",
        monitorIds: component?.monitorIds || [],
      });
      setMonitorSearchTerm("");
      setIsMonitorDropdownOpen(false);
    }
  }, [open, component]);

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
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Filter monitors based on search term
  const filteredMonitors = monitors.filter(
    (monitor) =>
      monitor.name.toLowerCase().includes(monitorSearchTerm.toLowerCase()) ||
      monitor.type.toLowerCase().includes(monitorSearchTerm.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (component) {
        // Update existing component
        const updateData: UpdateComponentData = {
          id: component.id,
          statusPageId,
          name: formData.name,
          description: formData.description || null,
          status: formData.status,
          monitorIds: formData.monitorIds,
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
        // Create new component
        const createData: CreateComponentData = {
          statusPageId,
          name: formData.name,
          description: formData.description || undefined,
          status: formData.status,
          monitorIds: formData.monitorIds,
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {component ? "Edit Component" : "Add Component"}
          </DialogTitle>
          <DialogDescription>
            {component
              ? "Update the component details and status"
              : "Add a new component to track the health of a service or feature"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Component Name *</Label>
            <Input
              id="name"
              placeholder="API Server"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              required
              disabled={isSubmitting}
            />
            <p className="text-sm text-muted-foreground">
              A descriptive name for this service component
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="RESTful API for client applications"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              rows={3}
              disabled={isSubmitting}
            />
            <p className="text-sm text-muted-foreground">
              Optional description of what this component does
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Status *</Label>
            <Select
              value={formData.status}
              onValueChange={(value: ComponentStatus) =>
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
              Current operational status of this component
            </p>
          </div>

          <div className="space-y-2">
            <Label>Linked Monitors (Optional)</Label>
            <div ref={monitorDropdownRef} className="relative">
              {/* Search input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search monitors by name or type..."
                  value={monitorSearchTerm}
                  onChange={(e) => {
                    setMonitorSearchTerm(e.target.value);
                    setIsMonitorDropdownOpen(true);
                  }}
                  onFocus={() => setIsMonitorDropdownOpen(true)}
                  className="pl-10"
                  disabled={isSubmitting}
                />
              </div>

              {/* Dropdown */}
              {isMonitorDropdownOpen && (
                <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {monitors.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      No monitors available
                    </div>
                  ) : filteredMonitors.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      No monitors found matching &quot;{monitorSearchTerm}&quot;
                    </div>
                  ) : (
                    <div className="p-1">
                      {filteredMonitors.map((monitor) => (
                        <div
                          key={monitor.id}
                          className="flex items-center p-2 hover:bg-accent rounded cursor-pointer"
                          onClick={() => {
                            if (!formData.monitorIds.includes(monitor.id)) {
                              setFormData({
                                ...formData,
                                monitorIds: [
                                  ...formData.monitorIds,
                                  monitor.id,
                                ],
                              });
                            }
                            setMonitorSearchTerm("");
                            setIsMonitorDropdownOpen(false);
                          }}
                        >
                          <Checkbox
                            checked={formData.monitorIds.includes(monitor.id)}
                            className="mr-3"
                            disabled={isSubmitting}
                          />
                          <div className="flex-1">
                            <div className="font-medium text-sm">
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

            {/* Selected monitors badges */}
            {formData.monitorIds.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {formData.monitorIds.map((monitorId) => {
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
                        onClick={() => {
                          setFormData({
                            ...formData,
                            monitorIds: formData.monitorIds.filter(
                              (id) => id !== monitorId
                            ),
                          });
                        }}
                        className="ml-1 hover:text-destructive p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ) : null;
                })}
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Search and select multiple monitors to link with this component
              for reference only (status updates are manual via incidents)
            </p>
          </div>

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
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {isSubmitting
                ? "Saving..."
                : component
                ? "Update Component"
                : "Add Component"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
