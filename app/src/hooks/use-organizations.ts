"use client";

import { useQuery } from "@tanstack/react-query";

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
