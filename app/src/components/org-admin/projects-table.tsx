"use client";

import * as React from "react";
import { AdminDataTable } from "@/components/admin/admin-data-table";
import { ProjectTableToolbar } from "./project-table-toolbar";
import { createProjectColumns, type Project } from "./project-columns";

interface ProjectsTableProps {
  projects: Project[];
  onCreateProject: () => void;
  onEditProject?: (project: Project) => void;
  canCreateProjects?: boolean;
  canManageProject?: boolean;
}



export function ProjectsTable({ projects, onCreateProject, onEditProject, canCreateProjects = false, canManageProject = false }: ProjectsTableProps) {
  const columns = React.useMemo(() => createProjectColumns(onEditProject, canManageProject), [onEditProject, canManageProject]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomToolbar = React.useCallback(({ table }: { table: any }) => (
    <ProjectTableToolbar table={table} onCreateProject={onCreateProject} canCreateProjects={canCreateProjects} />
  ), [onCreateProject, canCreateProjects]);

  return (
    <AdminDataTable
      columns={columns}
      data={projects}
      toolbar={CustomToolbar}
      title="Projects"
      description="Manage projects within your organization. Create, edit, and organize projects."
      itemName="projects"
      meta={{
        globalFilterColumns: ["name", "description"],
      }}
    />
  );
}