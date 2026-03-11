"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Globe, MapPin, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useLocations, type LocationData } from "@/hooks/use-locations";
import {
  getProjectLocationRestrictions,
  setProjectLocationRestrictions,
} from "@/actions/project-locations";

interface ProjectLocationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
}

export function ProjectLocationsDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: ProjectLocationsDialogProps) {
  const { locations: allLocations, isLoading: locationsLoading } = useLocations();
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [restrictionEntries, setRestrictionEntries] = React.useState<
    Array<{ locationId: string; code: string; name: string }>
  >([]);
  const [restrictionsLoaded, setRestrictionsLoaded] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Load current restrictions when dialog opens
  React.useEffect(() => {
    if (!open) {
      setRestrictionsLoaded(false);
      setLoadError(false);
      setRestrictionEntries([]);
      return;
    }

    (async () => {
      const result = await getProjectLocationRestrictions(projectId);
      if (result.success && result.data) {
        setSelectedIds(new Set(result.data.map((r) => r.locationId)));
        setRestrictionEntries(result.data);
        setRestrictionsLoaded(true);
      } else if (result.success && !result.data) {
        // Empty means "all locations" — leave selectedIds empty
        setSelectedIds(new Set());
        setRestrictionEntries([]);
        setRestrictionsLoaded(true);
      } else {
        // Load failed — block save to prevent destructive empty-set write
        setLoadError(true);
        toast.error("Failed to load location restrictions");
      }
    })();
  }, [open, projectId]);

  // Show all enabled locations + any disabled locations still in restrictions
  const visibleLocations: LocationData[] = React.useMemo(() => {
    const all = allLocations ?? [];
    const enabled = all.filter((l) => l.isEnabled);

    // Build set of IDs already present in allLocations
    const knownIds = new Set(all.map((l) => l.id));

    // Create stubs for restriction entries whose locations are not in allLocations
    // (i.e. disabled locations that useLocations() doesn't return)
    const disabledStubs: LocationData[] = restrictionEntries
      .filter((r) => !knownIds.has(r.locationId))
      .map((r) => ({
        id: r.locationId,
        code: r.code,
        name: r.name,
        region: null,
        flag: null,
        coordinates: null,
        isEnabled: false,
        isDefault: false,
        sortOrder: 999,
        createdAt: "",
        updatedAt: "",
      }));

    // Also include any disabled locations that ARE in allLocations and are selected
    const disabledButSelected = all.filter(
      (l) => !l.isEnabled && selectedIds.has(l.id)
    );

    return [...enabled, ...disabledButSelected, ...disabledStubs];
  }, [allLocations, selectedIds, restrictionEntries]);

  const enabledLocationIds = React.useMemo(
    () => new Set((allLocations ?? []).filter((l) => l.isEnabled).map((l) => l.id)),
    [allLocations]
  );

  const allSelected = selectedIds.size === 0;

  const handleToggle = (locationId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(locationId);
      } else {
        next.delete(locationId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    // "All locations" means no restrictions → empty set
    setSelectedIds(new Set());
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Strip disabled location IDs — only save enabled locations
      const idsToSave = Array.from(selectedIds).filter((id) =>
        enabledLocationIds.has(id)
      );
      const result = await setProjectLocationRestrictions(
        projectId,
        idsToSave
      );
      if (result.success) {
        toast.success("Location restrictions updated");
        onOpenChange(false);
      } else {
        toast.error(result.error ?? "Failed to update restrictions");
      }
    } finally {
      setSaving(false);
    }
  };

  const loading = locationsLoading || (!restrictionsLoaded && !loadError);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Location Restrictions
          </DialogTitle>
          <DialogDescription>
            Control which locations are available for{" "}
            <span className="font-medium">{projectName}</span>. When no
            specific locations are selected, all enabled locations are available.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm">Failed to load restrictions. Close and try again.</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[320px] overflow-y-auto py-2">
            {/* "All Locations" option */}
            <label className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer">
              <Checkbox
                checked={allSelected}
                onCheckedChange={() => handleSelectAll()}
              />
              <Globe className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="text-sm font-medium">
                  All Locations (no restrictions)
                </span>
              </div>
            </label>

            <div className="border-t" />

            {/* Individual location checkboxes */}
            {visibleLocations.map((location) => {
              const isDisabled = !enabledLocationIds.has(location.id);
              return (
                <label
                  key={location.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                    isDisabled
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-muted/50 cursor-pointer"
                  }`}
                >
                  <Checkbox
                    checked={selectedIds.has(location.id)}
                    onCheckedChange={(checked) =>
                      handleToggle(location.id, !!checked)
                    }
                    disabled={isDisabled}
                  />
                  <span className="text-base">{location.flag ?? "📍"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {location.name}
                      {isDisabled && (
                        <span className="ml-2 text-xs text-muted-foreground font-normal">
                          (disabled)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {location.code}
                      {location.region && ` · ${location.region}`}
                    </div>
                  </div>
                </label>
              );
            })}

            {visibleLocations.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No enabled locations configured.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading || saving || loadError}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
