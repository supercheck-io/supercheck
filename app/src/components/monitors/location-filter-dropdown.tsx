"use client";

import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapPin } from "lucide-react";
import { getLocationMetadata, type MonitoringLocation } from "@/lib/location-service";

interface LocationFilterDropdownProps {
  selectedLocation: "all" | string;
  availableLocations: string[];
  onLocationChange: (location: "all" | string) => void;
  className?: string;
}

export function LocationFilterDropdown({
  selectedLocation,
  availableLocations,
  onLocationChange,
  className = "",
}: LocationFilterDropdownProps) {
  if (availableLocations.length <= 1) {
    return null; // Don't show dropdown if only one location
  }

  return (
    <Select
      value={selectedLocation}
      onValueChange={(value) => onLocationChange(value)}
    >
      <SelectTrigger className={`w-[200px] ${className}`}>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Locations</SelectItem>
        {availableLocations.map((location) => {
          const metadata = getLocationMetadata(location as MonitoringLocation);
          return (
            <SelectItem key={location} value={location}>
              <div className="flex items-center gap-2">
                {metadata?.flag && <span>{metadata.flag}</span>}
                <span>{metadata?.name || location}</span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
