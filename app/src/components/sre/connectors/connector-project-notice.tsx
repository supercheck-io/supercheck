"use client";

import { ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjectContext } from "@/hooks/use-project-context";

/** Says which project the connector list belongs to and lets the user change it. */
export function ConnectorProjectNotice() {
  const { currentProject, projects, switchProject } = useProjectContext();
  if (!currentProject) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p className="min-w-0 text-sm text-muted-foreground">
        Connectors for project{" "}
        <span className="font-medium text-foreground">
          {currentProject.name}
        </span>
        . AI SRE uses them to investigate incidents in this project.
      </p>
      {projects.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
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
      )}
    </div>
  );
}
