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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUpdateLocation } from "@/hooks/use-locations";
import { toast } from "sonner";
import type { LocationWithStatus } from "@/app/api/admin/locations/route";

interface EditLocationDialogProps {
  location: LocationWithStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditLocationDialog({
  location,
  open,
  onOpenChange,
}: EditLocationDialogProps) {
  const updateLocation = useUpdateLocation();
  const [name, setName] = React.useState(location.name);
  const [region, setRegion] = React.useState(location.region || "");
  const [flag, setFlag] = React.useState(location.flag || "");
  const [lat, setLat] = React.useState(
    location.coordinates?.lat?.toString() || "",
  );
  const [lon, setLon] = React.useState(
    location.coordinates?.lon?.toString() || "",
  );
  const [isDefault, setIsDefault] = React.useState(location.isDefault && location.isEnabled);
  const [supportsBrowser, setSupportsBrowser] = React.useState(
    location.supportsBrowser,
  );
  const [supportsK6, setSupportsK6] = React.useState(location.supportsK6);
  const [sortOrder, setSortOrder] = React.useState(
    location.sortOrder.toString(),
  );

  // Sync form when location prop changes (switching between locations)
  React.useEffect(() => {
    setName(location.name);
    setRegion(location.region || "");
    setFlag(location.flag || "");
    setLat(location.coordinates?.lat?.toString() || "");
    setLon(location.coordinates?.lon?.toString() || "");
    setIsDefault(location.isDefault && location.isEnabled);
    setSupportsBrowser(location.supportsBrowser);
    setSupportsK6(location.supportsK6);
    setSortOrder(location.sortOrder.toString());
  }, [location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    const coordinates =
      lat.trim() && lon.trim()
        ? { lat: parseFloat(lat), lon: parseFloat(lon) }
        : null;

    if (coordinates && (isNaN(coordinates.lat) || isNaN(coordinates.lon))) {
      toast.error("Coordinates must be valid numbers");
      return;
    }

    try {
      await updateLocation.mutateAsync({
        id: location.id,
        name: name.trim(),
        region: region.trim() || null,
        flag: flag.trim() || null,
        coordinates,
        isDefault,
        supportsBrowser,
        supportsK6,
        sortOrder: parseInt(sortOrder, 10) || 0,
      });
      toast.success(`Location "${name.trim()}" updated`);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update location",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl">
        <form
          onSubmit={handleSubmit}
          className="flex max-h-[calc(100dvh-2rem)] flex-col"
        >
          <DialogHeader className="shrink-0 px-6 pb-4 pt-6 text-left">
            <DialogTitle>Edit Location</DialogTitle>
            <DialogDescription>
              Update location details. The code (
              <code className="rounded bg-muted px-1 text-xs">
                {location.code}
              </code>
              ) is immutable.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 space-y-5 overflow-y-auto px-6 pb-6">
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Code (read-only) */}
              <div className="space-y-2">
                <Label htmlFor="edit-location-code">Code</Label>
                <Input
                  id="edit-location-code"
                  value={location.code}
                  disabled
                  className="opacity-60"
                />
              </div>

              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="edit-location-name">
                  Display Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="edit-location-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  required
                />
              </div>
            </div>

            {/* Region + Flag */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-location-region">Region</Label>
                <Input
                  id="edit-location-region"
                  placeholder="e.g. Portland"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-location-flag">Flag</Label>
                <Input
                  id="edit-location-flag"
                  placeholder="e.g. 🇺🇸"
                  value={flag}
                  onChange={(e) => setFlag(e.target.value)}
                  maxLength={10}
                />
              </div>
            </div>

            {/* Coordinates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-location-lat">Latitude</Label>
                <Input
                  id="edit-location-lat"
                  type="number"
                  step="any"
                  placeholder="e.g. 45.5231"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-location-lon">Longitude</Label>
                <Input
                  id="edit-location-lon"
                  type="number"
                  step="any"
                  placeholder="e.g. -122.6765"
                  value={lon}
                  onChange={(e) => setLon(e.target.value)}
                />
              </div>
            </div>

            {/* Workload capabilities */}
            <div
              className="space-y-3 border-t pt-5"
              role="group"
              aria-labelledby="edit-location-capabilities"
            >
              <h3
                id="edit-location-capabilities"
                className="text-sm font-medium"
              >
                Execution capabilities
              </h3>
              <div className="flex items-center justify-between gap-4">
                <Label
                  htmlFor="edit-location-browser"
                  className="cursor-pointer leading-5"
                >
                  Browser execution (Playwright)
                </Label>
                <Switch
                  className="shrink-0"
                  id="edit-location-browser"
                  aria-describedby="edit-location-capabilities-help"
                  checked={supportsBrowser}
                  onCheckedChange={setSupportsBrowser}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label
                  htmlFor="edit-location-k6"
                  className="cursor-pointer leading-5"
                >
                  Performance tests (k6)
                </Label>
                <Switch
                  className="shrink-0"
                  id="edit-location-k6"
                  aria-describedby="edit-location-capabilities-help"
                  checked={supportsK6}
                  onCheckedChange={setSupportsK6}
                />
              </div>
              <p
                id="edit-location-capabilities-help"
                className="text-xs leading-relaxed text-muted-foreground"
              >
                HTTP, SSL, ping and port monitors are always available in an
                enabled location.
              </p>
            </div>

            {/* Default + Sort order */}
            <div className="space-y-4 border-t pt-5">
              <div className="flex items-center justify-between gap-4">
                <Label
                  htmlFor="edit-location-default"
                  className="cursor-pointer leading-5"
                >
                  Default location
                </Label>
                <Switch
                  className="shrink-0"
                  id="edit-location-default"
                  checked={isDefault}
                  disabled={!location.isEnabled && !isDefault}
                  onCheckedChange={setIsDefault}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="edit-location-sort">Sort Order</Label>
                <Input
                  id="edit-location-sort"
                  className="w-24"
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="grid shrink-0 grid-cols-2 gap-3 border-t bg-muted/20 px-6 py-4 sm:flex sm:items-center sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto sm:min-w-28"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="w-full sm:w-auto sm:min-w-28"
              disabled={updateLocation.isPending}
            >
              {updateLocation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
