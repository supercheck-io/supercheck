"use client";

import { useState } from "react";
import { useProjectContext } from "@/hooks/use-project-context";

export function OnboardingOrganizationSelector() {
  const { projects, currentProject, switchProject } = useProjectContext();
  const [pending, setPending] = useState(false);
  const organizations = Array.from(
    new Map(
      projects.map((project) => [project.organizationId, project]),
    ).values(),
  );
  if (organizations.length < 2) return null;
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm">
      Organization
      <select
        className="max-w-64 rounded-md border bg-background px-2 py-2"
        value={currentProject?.organizationId ?? ""}
        disabled={pending}
        onChange={async (event) => {
          const project = organizations.find(
            (item) => item.organizationId === event.target.value,
          );
          if (!project) return;
          setPending(true);
          try {
            await switchProject(project.id);
          } finally {
            setPending(false);
          }
        }}
      >
        {!currentProject && (
          <option value="" disabled>
            Select an organization
          </option>
        )}
        {organizations.map((project) => (
          <option key={project.organizationId} value={project.organizationId}>
            {project.organizationName || "Organization"}
          </option>
        ))}
      </select>
    </label>
  );
}
