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
  // New column defs remount every cell, which closes an open row menu. Parents pass fresh
  // handler lambdas each render, so read them through a ref and rebuild only when one appears or goes.
  const handlers = { onEditProject, onManageLocations, onManageIncidentPolicy, onDeleteProject, onRestoreProject };
  const latest = React.useRef(handlers);
  latest.current = handlers;
  const present = (Object.keys(handlers) as (keyof typeof handlers)[]).filter((k) => handlers[k]).join();
  const columns = React.useMemo(() => {
    const via = (key: keyof typeof handlers) =>
      present.split(",").includes(key) ? (project: Project) => latest.current[key]?.(project) : undefined;
    return createProjectColumns(via("onEditProject"), canManageProject, via("onManageLocations"), via("onManageIncidentPolicy"), via("onDeleteProject"), via("onRestoreProject"), restoringIds);
  }, [present, canManageProject, restoringIds]);

   
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
      }}
    />
  );
}