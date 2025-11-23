"use client";

import { useEffect, useState } from "react";
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
  PERFORMANCE_LOCATION_OPTIONS,
  PERFORMANCE_LOCATIONS,
  getPerformanceLocationOption,
  type PerformanceLocation,
} from "./performance-locations";
import { LocationMapCard } from "@/components/location/location-map-card";
import type { MonitoringLocation } from "@/lib/location-service";

export type { PerformanceLocation } from "./performance-locations";

interface LocationSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (location: PerformanceLocation) => void;
  defaultLocation?: PerformanceLocation;
}

export function LocationSelectionDialog({
  open,
  onOpenChange,
  onSelect,
  defaultLocation = "GLOBAL",
}: LocationSelectionDialogProps) {
  const [selected, setSelected] = useState<PerformanceLocation>(
    defaultLocation
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelected(defaultLocation);
  }, [defaultLocation, open]);

  const selectedOption = getPerformanceLocationOption(selected);

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
            {PERFORMANCE_LOCATION_OPTIONS.map((option) => (
              <Label
                key={option.value}
                htmlFor={`location-${option.value}`}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 transition hover:border-primary/60 hover:bg-card/80"
              >
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  {option.flag && <span className="text-sm">{option.flag}</span>}
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
              (selected === "GLOBAL"
                ? PERFORMANCE_LOCATIONS
                : selected
                ? [selected]
                : []) as MonitoringLocation[]
            }
            size="compact"
            badgeContent={
              selectedOption ? (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {selectedOption.flag && (
                    <span className="text-base leading-none">
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
                    <span className="text-2xl leading-none">
                      {selectedOption.flag}
                    </span>
                  )}
                  <p className="text-sm font-semibold text-foreground">
                    {selectedOption.name}
                  </p>
                </div>
                <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                  {selected === "GLOBAL"
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
