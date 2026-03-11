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
import { useCreateLocation } from "@/hooks/use-locations";
import { toast } from "sonner";

interface AddLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddLocationDialog({ open, onOpenChange }: AddLocationDialogProps) {
  const createLocation = useCreateLocation();
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [region, setRegion] = React.useState("");
  const [flag, setFlag] = React.useState("");
  const [lat, setLat] = React.useState("");
  const [lon, setLon] = React.useState("");
  const [isDefault, setIsDefault] = React.useState(false);
  const [sortOrder, setSortOrder] = React.useState("0");

  const resetForm = React.useCallback(() => {
    setCode("");
    setName("");
    setRegion("");
    setFlag("");
    setLat("");
    setLon("");
    setIsDefault(false);
    setSortOrder("0");
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!code.trim() || !name.trim()) {
      toast.error("Code and name are required");
      return;
    }

    // Validate code format: 2-63 chars, lowercase alphanumeric + hyphens
    if (code.length < 2 || !/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(code)) {
      toast.error(
        "Code must be lowercase letters, numbers, and hyphens (2-63 chars)"
      );
      return;
    }

    const coordinates =
      lat.trim() && lon.trim()
        ? { lat: parseFloat(lat), lon: parseFloat(lon) }
        : undefined;

    if (coordinates && (isNaN(coordinates.lat) || isNaN(coordinates.lon))) {
      toast.error("Coordinates must be valid numbers");
      return;
    }

    try {
      await createLocation.mutateAsync({
        code: code.trim(),
        name: name.trim(),
        region: region.trim() || undefined,
        flag: flag.trim() || undefined,
        coordinates,
        isDefault,
        sortOrder: parseInt(sortOrder, 10) || 0,
      });
      toast.success(`Location "${name.trim()}" created`);
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create location"
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Location</DialogTitle>
            <DialogDescription>
              Create a new execution location. Workers with a matching{" "}
              <code className="rounded bg-muted px-1 text-xs">
                WORKER_LOCATION
              </code>{" "}
              will automatically pick up jobs.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {/* Code */}
            <div className="space-y-2">
              <Label htmlFor="location-code">
                Code <span className="text-destructive">*</span>
              </Label>
              <Input
                id="location-code"
                placeholder="e.g. us-west, ap-south"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                }
                maxLength={63}
                required
              />
              <p className="text-xs text-muted-foreground">
                Immutable identifier. Lowercase letters, numbers, hyphens.
              </p>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="location-name">
                Display Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="location-name"
                placeholder="e.g. US West, Asia South"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
              />
            </div>

            {/* Region + Flag row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="location-region">Region</Label>
                <Input
                  id="location-region"
                  placeholder="e.g. Portland"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location-flag">Flag</Label>
                <Input
                  id="location-flag"
                  placeholder="e.g. 🇺🇸"
                  value={flag}
                  onChange={(e) => setFlag(e.target.value)}
                  maxLength={8}
                />
              </div>
            </div>

            {/* Coordinates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="location-lat">Latitude</Label>
                <Input
                  id="location-lat"
                  type="number"
                  step="any"
                  placeholder="e.g. 45.5231"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location-lon">Longitude</Label>
                <Input
                  id="location-lon"
                  type="number"
                  step="any"
                  placeholder="e.g. -122.6765"
                  value={lon}
                  onChange={(e) => setLon(e.target.value)}
                />
              </div>
            </div>

            {/* Default + Sort order */}
            <div className="grid grid-cols-2 gap-3 items-end">
              <div className="flex items-center gap-2">
                <Switch
                  id="location-default"
                  checked={isDefault}
                  onCheckedChange={setIsDefault}
                />
                <Label htmlFor="location-default" className="cursor-pointer">
                  Default location
                </Label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="location-sort">Sort Order</Label>
                <Input
                  id="location-sort"
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
            <Button type="submit" disabled={createLocation.isPending}>
              {createLocation.isPending ? "Creating…" : "Create Location"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
