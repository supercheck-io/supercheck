"use client";

import { useState } from "react";
import { clearProjectsCache } from "@/hooks/use-project-context";
import { useOrganizations } from "@/hooks/use-organizations";
import { announceProjectChange, reloadProjectContext } from "@/lib/project-navigation";

export function OnboardingOrganizationSelector() {
  const { data: organizations = [], activeOrganization } = useOrganizations();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (organizations.length < 2) return null;
  return (
    <>
    <label className="flex min-w-0 items-center gap-2 text-sm">
      Organization
      <select
        className="max-w-64 rounded-md border bg-background px-2 py-2"
        value={activeOrganization?.id ?? ""}
        disabled={pending}
        onChange={async (event) => {
          const organizationId = event.target.value;
          if (!organizations.some(item => item.id === organizationId)) return;
          setPending(true);
          setError(null);
          try {
            const response = await fetch("/api/organizations/switch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ organizationId }),
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || "Failed to select organization");
            announceProjectChange();
            reloadProjectContext(clearProjectsCache);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to select organization");
          } finally {
            setPending(false);
          }
        }}
      >
        {!activeOrganization && (
          <option value="" disabled>
            Select an organization
          </option>
        )}
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name || "Organization"}
          </option>
        ))}
      </select>
    </label>
    {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
    </>
  );
}
