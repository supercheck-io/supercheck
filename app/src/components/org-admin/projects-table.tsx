"use client";

import * as React from "react";
import { AdminDataTable } from "@/components/admin/admin-data-table";
import { ProjectTableToolbar } from "./project-table-toolbar";
import { createProjectColumns, type Project } from "./project-columns";

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
  const columns = React.useMemo(() => createProjectColumns(onEditProject, canManageProject, onManageLocations, onManageIncidentPolicy, onDeleteProject, onRestoreProject, restoringIds), [onEditProject, canManageProject, onManageLocations, onManageIncidentPolicy, onDeleteProject, onRestoreProject, restoringIds]);

   
  const CustomToolbar = React.useCallback(({ table }: { table: any }) => (
    <ProjectTableToolbar table={table} onCreateProject={onCreateProject} canCreateProjects={canCreateProjects} />
  ), [onCreateProject, canCreateProjects]);

  return (
    <AdminDataTable
      columns={columns}
      data={projects}
      toolbar={CustomToolbar}
      itemName="projects"
      keepPageOnDataChange // the page re-renders with a fresh rows array (restores, refetches); stay on the current page
      meta={{
        globalFilterColumns: ["name", "description"],
      }}
    />
  );
}