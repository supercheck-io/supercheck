"use client";

import { useState } from "react";
import { useProjectContext } from "@/hooks/use-project-context";

export function OnboardingProjectSelector() {
  const { projects, projectId, switchProject } = useProjectContext();
  const [pending, setPending] = useState(false);
  if (projects.length < 2) return null;
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm">
      Project
      <select
        className="max-w-64 rounded-md border bg-background px-2 py-2"
        value={projectId ?? ""}
        disabled={pending}
        onChange={async event => {
          setPending(true);
          await switchProject(event.target.value);
          setPending(false);
        }}
      >
        {!projectId && <option value="" disabled>Select a project</option>}
        {projects.map(project => (
          <option key={project.id} value={project.id}>
            {project.name}{project.organizationName ? ` · ${project.organizationName}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
