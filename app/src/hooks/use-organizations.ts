"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { ORGANIZATION_CHANGED_KEY } from "@/lib/organization-navigation";

export interface OrganizationSummary {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  subscriptionPlan?: "plus" | "pro" | "unlimited" | null;
  subscriptionStatus?: "active" | "canceled" | "past_due" | "none" | null;
  subscriptionEndsAt?: string | null;
}

export function useOrganizations() {
  useEffect(() => {
    const onChange = (event: StorageEvent) => {
      if (event.key === ORGANIZATION_CHANGED_KEY && event.newValue) window.location.reload();
    };
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  }, []);
  const query = useQuery({
    queryKey: ["organizations"],
    queryFn: async (): Promise<OrganizationSummary[]> => {
      const response = await fetch("/api/organizations");
      if (!response.ok) throw new Error("Failed to load organizations");
      const result = await response.json();
      return result.data;
    },
    staleTime: 0,
  });
  return { ...query, activeOrganization: query.data?.find(org => org.isActive) };
}
