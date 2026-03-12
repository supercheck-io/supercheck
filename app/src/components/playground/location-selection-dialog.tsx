"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  buildPerformanceLocationOptions,
  getPerformanceLocationOption,
  type PerformanceLocation,
} from "./performance-locations";
import { LocationMapCard } from "@/components/location/location-map-card";
import type { MonitoringLocation } from "@/lib/location-service";
import { useAvailableLocations } from "@/hooks/use-locations";

export type { PerformanceLocation } from "./performance-locations";

interface LocationSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (location: PerformanceLocation) => void;
  /** Pre-selected location. Falls back to the first available option when not provided. */
  defaultLocation?: PerformanceLocation;
}

export function LocationSelectionDialog({
  open,
  onOpenChange,
  onSelect,
  defaultLocation,
}: LocationSelectionDialogProps) {
  const [selected, setSelected] =
    useState<PerformanceLocation>(defaultLocation ?? "global");

  // Fetch dynamic locations from API
  const { locations: dynamicLocations, hasRestrictions } = useAvailableLocations();

  // Build options from dynamic data
  const locationOptions = useMemo(() => {
    if (dynamicLocations.length > 0) {
      return buildPerformanceLocationOptions(dynamicLocations, {
        includeGlobal: !hasRestrictions,
      });
    }
    // Minimal fallback while loading
    return buildPerformanceLocationOptions([], { includeGlobal: true });
  }, [dynamicLocations, hasRestrictions]);

  const fallbackLocation = useMemo(() => {
    // If the caller provided a default and it exists in options, use it.
    if (defaultLocation && locationOptions.some((option) => option.value === defaultLocation)) {
      return defaultLocation;
    }

    // Otherwise, prefer the first *non-global* option (a real location),
    // falling back to the first option (which may be "global").
    const firstReal = locationOptions.find((o) => o.value !== "global");
    return firstReal?.value ?? locationOptions[0]?.value ?? "global";
  }, [defaultLocation, locationOptions]);

  // Non-global location codes for the map
  const locationCodes = useMemo(
    () =>
      locationOptions
        .filter((o) => o.value !== "global")
        .map((o) => o.value),
    [locationOptions]
  );

  // Track previous open state to detect transitions
  const wasOpen = useRef(open);

  // Sync default location when dialog opens (not while already open)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setTimeout(() => setSelected(fallbackLocation), 0);
    }
    wasOpen.current = open;
  }, [fallbackLocation, open]);

  const selectedOption = getPerformanceLocationOption(selected, locationOptions);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Select Execution Location</DialogTitle>
          <DialogDescription>
            Choose the geographical region where this k6 performance test should
            execute.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.55fr)_minmax(0,1.45fr)]">
          <RadioGroup
            value={selected}
            onValueChange={(value) => setSelected(value as PerformanceLocation)}
            className="space-y-2"
          >
            {locationOptions.map((option) => (
              <Label
                key={option.value}
                htmlFor={`location-${option.value}`}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 transition hover:border-primary/60 hover:bg-card/80"
              >
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  {option.flag && (
                    <span className="text-xl">{option.flag}</span>
                  )}
                  <span className="text-sm">{option.name}</span>
                </div>
                <RadioGroupItem
                  id={`location-${option.value}`}
                  value={option.value}
                  className="h-3.5 w-3.5"
                />
              </Label>
            ))}
          </RadioGroup>
          <LocationMapCard
            locations={
              (selected === "global"
                ? locationCodes
                : selected
                  ? [selected]
                  : []) as MonitoringLocation[]
            }
            size="compact"
            badgeContent={
              selectedOption ? (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {selectedOption.flag && (
                    <span className="text-xl leading-none">
                      {selectedOption.flag}
                    </span>
                  )}
                  {selectedOption.name}
                </span>
              ) : (
                "Select a location"
              )
            }
            emptyMessage="Select a location to preview its coverage."
            className="bg-card/60"
          >
            {selectedOption && (
              <div className="rounded-xl border border-border/60 bg-background/60 p-4">
                <div className="flex items-center gap-3">
                  {selectedOption.flag && (
                    <span className="text-3xl leading-none">
                      {selectedOption.flag}
                    </span>
                  )}
                  <p className="text-sm font-semibold text-foreground">
                    {selectedOption.name}
                  </p>
                </div>
                <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                  {selected === "global"
                    ? "Selecting Global routes virtual users through any one of the randomly selected geographies based on availability."
                    : `Selecting ${selectedOption.name} routes virtual users through this geography so performance numbers reflect conditions near that region.`}
                </p>
              </div>
            )}
          </LocationMapCard>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSelect(selected);
              onOpenChange(false);
            }}
          >
            Run Test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
