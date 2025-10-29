"use client";

import * as React from "react";
import { AdminDataTable } from "./admin-data-table";
import { OrgTableToolbar } from "./org-table-toolbar";
import { createOrgColumns, AdminOrganization } from "./org-columns";

interface OrgTableProps {
  organizations: AdminOrganization[];
}

export function OrgTable({ organizations }: OrgTableProps) {
  const columns = React.useMemo(() => createOrgColumns(), []);

  return (
    <AdminDataTable
      columns={columns}
      data={organizations}
      toolbar={OrgTableToolbar}
      title="Organizations"
      description="Manage organizations and their settings"
      itemName="organizations"
      meta={{
        globalFilterColumns: ["name", "ownerEmail"],
      }}
    />
  );
}