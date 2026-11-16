"use client";

import * as React from "react";
import { AdminDataTable } from "@/components/admin/admin-data-table";
import { ProjectTableToolbar } from "./project-table-toolbar";
import { createProjectColumns, type Project, type ProjectActions } from "./project-columns";

interface ProjectsTableProps {
  projects: Project[];
  onCreateProject: () => void;
  onEditProject?: (project: Project) => void;
  onManageLocations?: (project: Project) => void;
  onManageIncidentPolicy?: (project: Project) => void;
  /** Owners and admins only: omit to hide the action. */
  onDeleteProject?: (project: Project) => void;
  /** Owners and admins: restore a soft-deleted row. */
  onRestoreProject?: (project: Project) => void;
  restoringIds?: ReadonlySet<string>;
  canCreateProjects?: boolean;
  canManageProject?: boolean;
}



export function ProjectsTable({ projects, onCreateProject, onEditProject, onManageLocations, onManageIncidentPolicy, onDeleteProject, onRestoreProject, restoringIds, canCreateProjects = false, canManageProject = false }: ProjectsTableProps) {
  // Stable defs: new ones remount every cell, which would close an open row menu on any parent re-render.
  const columns = React.useMemo(() => createProjectColumns(), []);

   
  const CustomToolbar = React.useCallback(({ table }: { table: any }) => (
    <ProjectTableToolbar table={table} onCreateProject={onCreateProject} canCreateProjects={canCreateProjects} />
  ), [onCreateProject, canCreateProjects]);

  return (
    <AdminDataTable
      columns={columns}
      data={projects}
      toolbar={CustomToolbar}
      itemName="projects"
      meta={{
        globalFilterColumns: ["name", "description"],
        projectActions: { onEditProject, canManageProject, onManageLocations, onManageIncidentPolicy, onDeleteProject, onRestoreProject, restoringIds } satisfies ProjectActions,
      }}
    />
  );
}