"use client";

import { ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjectContextSafe } from "@/hooks/use-project-context";

/** Switches the project whose connectors are listed; hidden for a single-project org. */
export function ConnectorProjectSwitch() {
  const context = useProjectContextSafe();
  if (!context?.currentProject || context.projects.length < 2) return null;

  const { currentProject, projects, switchProject } = context;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="flex h-8"
        >
          Switch project
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-64 min-w-48 overflow-y-auto">
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            disabled={project.id === currentProject.id}
            onClick={() => void switchProject(project.id, "/org-admin?tab=integrations")}
          >
            <span className="truncate">{project.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
