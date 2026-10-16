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
    location.coordinates?.lat?.toString() || ""
  );
  const [lon, setLon] = React.useState(
    location.coordinates?.lon?.toString() || ""
  );
  const [isDefault, setIsDefault] = React.useState(location.isDefault);
  const [supportsBrowser, setSupportsBrowser] = React.useState(location.supportsBrowser);
  const [supportsK6, setSupportsK6] = React.useState(location.supportsK6);
  const [sortOrder, setSortOrder] = React.useState(
    location.sortOrder.toString()
  );

  // Sync form when location prop changes (switching between locations)
  React.useEffect(() => {
    setName(location.name);
    setRegion(location.region || "");
    setFlag(location.flag || "");
    setLat(location.coordinates?.lat?.toString() || "");
    setLon(location.coordinates?.lon?.toString() || "");
    setIsDefault(location.isDefault);
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
        error instanceof Error ? error.message : "Failed to update location"
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Location</DialogTitle>
            <DialogDescription>
              Update location details. The code (
              <code className="rounded bg-muted px-1 text-xs">
                {location.code}
              </code>
              ) is immutable.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {/* Code (read-only) */}
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={location.code} disabled className="opacity-60" />
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
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="edit-location-browser"
                  checked={supportsBrowser}
                  onCheckedChange={setSupportsBrowser}
                />
                <Label htmlFor="edit-location-browser" className="cursor-pointer">
                  Browser execution (Playwright)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="edit-location-k6"
                  checked={supportsK6}
                  onCheckedChange={setSupportsK6}
                />
                <Label htmlFor="edit-location-k6" className="cursor-pointer">
                  Performance tests (k6)
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                HTTP, SSL, ping and port monitors are always available in an enabled location.
              </p>
            </div>

            {/* Default + Sort order */}
            <div className="grid grid-cols-2 gap-3 items-end">
              <div className="flex items-center gap-2">
                <Switch
                  id="edit-location-default"
                  checked={isDefault}
                  onCheckedChange={setIsDefault}
                />
                <Label
                  htmlFor="edit-location-default"
                  className="cursor-pointer"
                >
                  Default location
                </Label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-location-sort">Sort Order</Label>
                <Input
                  id="edit-location-sort"
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateLocation.isPending}>
              {updateLocation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
