"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { LocationWithStatus } from "@/app/api/admin/locations/route";

// ── Types ───────────────────────────────────────────────────────

export interface LocationData {
  id: string;
  code: string;
  name: string;
  region: string | null;
  flag: string | null;
  coordinates: { lat: number; lon: number } | null;
  isEnabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminLocationsResponse {
  locations: LocationWithStatus[];
  unregisteredLocations: string[];
}

export interface AvailableLocationsResponse {
  locations: LocationData[];
  hasRestrictions: boolean;
}

// ── Query Keys ─────────────────────────────────────────────────

export const LOCATIONS_QUERY_KEY = ["locations"] as const;
export const ADMIN_LOCATIONS_QUERY_KEY = ["admin", "locations"] as const;
export const AVAILABLE_LOCATIONS_QUERY_KEY = ["locations", "available"] as const;

// ── Fetch Functions ────────────────────────────────────────────

export async function fetchLocations(): Promise<LocationData[]> {
  const response = await fetch("/api/locations");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error || "Failed to fetch locations");
  return data.data;
}

export async function fetchAdminLocations(): Promise<AdminLocationsResponse> {
  const response = await fetch("/api/admin/locations");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.success)
    throw new Error(data.error || "Failed to fetch admin locations");
  return data.data;
}

export async function fetchAvailableLocations(
  projectId?: string
): Promise<AvailableLocationsResponse> {
  const searchParams = new URLSearchParams();
  if (projectId) {
    searchParams.set("projectId", projectId);
  }

  const query = searchParams.toString();
  const response = await fetch(
    query ? `/api/locations/available?${query}` : "/api/locations/available"
  );

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || "Failed to fetch available locations");
  }
  return data.data;
}

// ── Hooks ──────────────────────────────────────────────────────

/** Fetch enabled locations for any authenticated user (e.g. location pickers). */
export function useLocations() {
  const query = useQuery({
    queryKey: LOCATIONS_QUERY_KEY,
    queryFn: fetchLocations,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    refetchOnReconnect: false,
  });

  return {
    locations: query.data ?? [],
    isLoading: query.isPending && query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

/** Fetch all locations with worker status and unregistered alerts (Super Admin). */
export function useAdminLocations() {
  const query = useQuery({
    queryKey: ADMIN_LOCATIONS_QUERY_KEY,
    queryFn: fetchAdminLocations,
    staleTime: 30 * 1000, // 30s — admin needs fresher data
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    refetchOnReconnect: false,
  });

  return {
    locations: query.data?.locations ?? [],
    unregisteredLocations: query.data?.unregisteredLocations ?? [],
    isLoading: query.isPending && query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

export function useAvailableLocations(projectId?: string) {
  const query = useQuery({
    queryKey: [...AVAILABLE_LOCATIONS_QUERY_KEY, projectId ?? "current"],
    queryFn: () => fetchAvailableLocations(projectId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    refetchOnReconnect: false,
  });

  return {
    locations: query.data?.locations ?? [],
    hasRestrictions: query.data?.hasRestrictions ?? false,
    isLoading: query.isPending && query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

/** Invalidation helper for admin mutations. */
export function useLocationInvalidation() {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ADMIN_LOCATIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: AVAILABLE_LOCATIONS_QUERY_KEY });
    },
    invalidateAdmin: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_LOCATIONS_QUERY_KEY });
    },
  };
}

// ── Mutations ──────────────────────────────────────────────────

export function useCreateLocation() {
  const { invalidateAll } = useLocationInvalidation();

  return useMutation({
    mutationFn: async (body: {
      code: string;
      name: string;
      region?: string;
      flag?: string;
      coordinates?: { lat: number; lon: number };
      isDefault?: boolean;
      sortOrder?: number;
    }) => {
      const response = await fetch("/api/admin/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to create location");
      }
      return data.data;
    },
    onSuccess: () => invalidateAll(),
  });
}

export function useUpdateLocation() {
  const { invalidateAll } = useLocationInvalidation();

  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      region?: string | null;
      flag?: string | null;
      coordinates?: { lat: number; lon: number } | null;
      isEnabled?: boolean;
      isDefault?: boolean;
      sortOrder?: number;
    }) => {
      const response = await fetch(`/api/admin/locations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to update location");
      }
      return data.data;
    },
    onSuccess: () => invalidateAll(),
  });
}

export function useDeleteLocation() {
  const { invalidateAll } = useLocationInvalidation();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/admin/locations/${id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to delete location");
      }
      return data;
    },
    onSuccess: () => invalidateAll(),
  });
}
